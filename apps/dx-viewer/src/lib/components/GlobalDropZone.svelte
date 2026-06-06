<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { _, locale } from 'svelte-i18n';
	import { studies } from '$lib/stores/studies.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { fileToBase64 } from '$lib/image';
	import { findXray, runInference, countFindings } from '$lib/ai';
	import { operationErrorKey } from '$lib/forms';
	import {
		detectModality,
		quickPatientName,
		quickDropDecision,
		QUICK_INFERENCE_META
	} from '$lib/quickAnalyze';
	import { validateUploadFile } from '$lib/uploadValidation';
	import { isTextEntryTarget } from '$lib/keyboard';
	import PaywallModal from './PaywallModal.svelte';
	import { UploadCloud, Loader2 } from 'lucide-svelte';
	import { onMount } from 'svelte';

	// The home dashboard's "Drop or Upload X-Rays" file picker can't reach this
	// component's `analyze()` directly, so it dispatches a `dxv:quick-analyze`
	// CustomEvent<File> on window which we handle here — reusing the exact same flow
	// (modality detect, 3D gate, validation, patient creation, navigation, paywall).
	onMount(() => {
		const onQuickAnalyze = (e: Event) => {
			const file = (e as CustomEvent<File>).detail;
			if (file instanceof File && enabled && !processing) void analyze(file);
		};
		window.addEventListener('dxv:quick-analyze', onQuickAnalyze as EventListener);
		return () => window.removeEventListener('dxv:quick-analyze', onQuickAnalyze as EventListener);
	});

	// One-click drag-to-analyze: drop a file anywhere in the app and analysis
	// starts immediately — modality is inferred from the file, a patient is
	// auto-created, and the matching viewer opens. The New-Study form stays for
	// manual use, so this is disabled on /upload (its dropzone owns the drop).

	let dragDepth = $state(0);
	let processing = $state(false);
	let progressKey = $state('');
	let error = $state('');
	let paywallOpen = $state(false);
	let paywallReason = $state('No Subscription');

	const enabled = $derived(!page.url.pathname.startsWith('/upload'));
	const showOverlay = $derived(enabled && (dragDepth > 0 || processing || !!error));

	function hasFiles(e: DragEvent) {
		return Array.from(e.dataTransfer?.types ?? []).includes('Files');
	}

	function onDragEnter(e: DragEvent) {
		if (!enabled || processing || !hasFiles(e)) return;
		e.preventDefault();
		dragDepth++;
	}
	function onDragOver(e: DragEvent) {
		if (!enabled || processing || !hasFiles(e)) return;
		e.preventDefault(); // required so the browser will fire `drop`
	}
	function onDragLeave(e: DragEvent) {
		if (!enabled || processing || !hasFiles(e)) return;
		dragDepth = Math.max(0, dragDepth - 1);
	}
	async function onDrop(e: DragEvent) {
		if (!enabled || processing || !hasFiles(e)) return;
		e.preventDefault();
		dragDepth = 0;
		const files = e.dataTransfer?.files;
		switch (quickDropDecision(files?.length ?? 0)) {
			case 'analyze':
				await analyze(files![0]);
				break;
			case 'tooMany':
				// Quick-analyze spawns a patient + a navigation per file, so a batch
				// (e.g. a 16-film FMX) must not be processed here — point the user at
				// the New Study page instead of silently dropping all but the first.
				error = $_('quickdrop.multipleFiles');
				break;
			case 'none':
				// A folder drop (or a selection the browser exposes as no `files`)
				// reaches here even though the user clearly intended to add files.
				error = $_('quickdrop.noFiles');
				break;
		}
	}

	// Ctrl+V / Cmd+V a copied file (or pasted image) anywhere in the app → analyze
	// it, same as a drop. If the clipboard holds no analyzable image/3D file, open
	// the browser's screen-capture picker (screen / window / tab) and analyze a
	// grabbed frame as a 2D X-ray. Pastes into a text field are left alone.
	async function onPaste(e: ClipboardEvent) {
		if (!enabled || processing) return;
		if (isTextEntryTarget(e.target)) return;
		const files = e.clipboardData?.files;
		// A multi-file paste (e.g. several copied films) is the same asymmetric
		// batch case as a multi-file drop — guard it before the single-file path so
		// we don't silently analyze just the first.
		if ((files?.length ?? 0) > 1) {
			e.preventDefault();
			error = $_('quickdrop.multipleFiles');
			return;
		}
		const file = files?.[0];
		if (file && detectModality(file)) {
			e.preventDefault();
			await analyze(file);
		} else {
			e.preventDefault();
			// No analyzable file in the clipboard (e.g. a plain-text paste) → fall back
			// to the screen-capture picker. getDisplayMedia must run inside the paste
			// user-gesture, so call it first, before any other await.
			await captureScreenshotAndAnalyze();
		}
	}

	// No analyzable file in the clipboard → let the user screenshot a screen/window/
	// tab; the captured frame goes through the same 2D image flow (find_xray + crop
	// + inference), which is exactly the "photo of an X-ray monitor" use case.
	async function captureScreenshotAndAnalyze() {
		const md = navigator.mediaDevices;
		if (!md?.getDisplayMedia) {
			error = $_('quickdrop.captureError');
			return;
		}
		// Conditional Focus (Chromium): keep focus on THIS app after the user picks a
		// window/tab, instead of the browser switching to the captured surface.
		const CaptureControllerCtor = (
			window as unknown as {
				CaptureController?: new () => { setFocusBehavior?: (b: string) => void };
			}
		).CaptureController;
		const controller = CaptureControllerCtor ? new CaptureControllerCtor() : undefined;
		const opts = { video: true, audio: false } as DisplayMediaStreamOptions;
		if (controller) (opts as { controller?: unknown }).controller = controller;
		let stream: MediaStream;
		try {
			stream = await md.getDisplayMedia(opts);
		} catch (err) {
			// The user dismissed the picker → abort quietly; real failures show a message.
			if ((err as Error)?.name !== 'NotAllowedError') error = $_('quickdrop.captureError');
			return;
		}
		// Must run right after the promise resolves (before the track is consumed) —
		// "no-focus-change" leaves focus on Dx Viewer. No-op where unsupported.
		try {
			controller?.setFocusBehavior?.('no-focus-change');
		} catch {
			/* focus control unsupported on this browser — acceptable fallback */
		}
		processing = true;
		progressKey = 'quickdrop.capturing';
		error = '';
		let file: File;
		try {
			file = await frameFromStream(stream);
		} catch {
			processing = false;
			progressKey = '';
			error = $_('quickdrop.captureError');
			return;
		} finally {
			// Stop sharing immediately — we only need one frame.
			stream.getTracks().forEach((t) => t.stop());
		}
		await analyze(file);
	}

	async function frameFromStream(stream: MediaStream): Promise<File> {
		const video = document.createElement('video');
		video.srcObject = stream;
		video.muted = true;
		await video.play();
		// Wait one paint so the video has real dimensions + pixels to draw.
		await new Promise((r) => requestAnimationFrame(() => r(null)));
		const w = video.videoWidth || 1280;
		const h = video.videoHeight || 720;
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('no 2d context');
		ctx.drawImage(video, 0, 0, w, h);
		video.pause();
		video.srcObject = null;
		const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
		if (!blob) throw new Error('toBlob failed');
		return new File([blob], 'screenshot.jpg', { type: 'image/jpeg' });
	}

	async function analyze(file: File) {
		error = '';
		const modality = detectModality(file);
		if (!modality) {
			error = $_('quickdrop.unsupported');
			return;
		}
		// 3D gate: a CBCT/IOS drop is refused (with a notice) unless the user enabled
		// 3D tools — the app is 2D-only otherwise, so we never create an unviewable
		// study or route to the (gated-off) 3D viewer.
		if ((modality === 'cbct' || modality === 'ios') && !auth.threeDEnabled) {
			error = $_('quickdrop.threeDDisabled');
			return;
		}
		// Reject empty / oversized files BEFORE the long encode + AI round-trip so
		// the busy overlay never spins on a file that can't succeed (an oversized
		// CBCT/IOS would otherwise die at the ~100MB nginx/Cloudflare edge with a
		// 413 after a multi-minute upload). Wrong-type is already handled above.
		const v = validateUploadFile(file, modality, $locale ?? undefined);
		if (!v.ok) {
			error = $_(v.messageKey, { values: v.values });
			return;
		}
		processing = true;

		// Auto-create a patient just-in-time; if the study save then fails, delete the
		// freshly-created patient so a failed drop leaves no orphan (mirrors upload #96).
		let createdPatientId: string | null = null;
		let studySaved = false;
		const makePatient = async () => {
			const { patient, created } = await studies.findOrCreatePatient({
				name: quickPatientName(file, $_('quickdrop.fallbackName')),
				quick: true // temporary patient — the viewer offers to name/merge it afterwards
			});
			if (created) createdPatientId = patient.id;
			return patient;
		};

		try {
			let dest: string;
			if (modality === 'image') {
				progressKey = 'upload.encoding';
				let b64 = await fileToBase64(file);
				let blob: Blob = file;
				// Always locate + crop the X-ray (no confirmation). Graceful: if none is
				// found, analyze the whole image rather than failing the one-click flow.
				progressKey = 'upload.locating';
				try {
					const roi = await findXray(b64);
					if (roi.extra.xrayfound && roi.result) {
						progressKey = 'upload.cropping';
						const c = await cropBlob(b64, roi.result);
						b64 = c.b64;
						blob = c.blob;
					}
				} catch {
					/* find_xray failed — continue with the uncropped image */
				}
				progressKey = 'upload.inferring';
				const inf = await runInference({ image_data: b64, meta_data: QUICK_INFERENCE_META });
				progressKey = 'upload.savingStudy';
				const patient = await makePatient();
				const study = await studies.addStudy({
					patientId: patient.id,
					modality: 'xray',
					imageBlob: blob,
					originalFilename: file.name,
					inference: inf,
					findingCounts: countFindings(inf)
				});
				studySaved = true;
				dest = resolve('/(app)/viewer/[patientId]/[studyId]', {
					patientId: patient.id,
					studyId: study.id
				});
			} else if (modality === 'cbct') {
				progressKey = 'upload.savingCbct';
				const patient = await makePatient();
				const study = await studies.addStudy({
					patientId: patient.id,
					modality: 'cbct',
					imageBlob: file,
					originalFilename: file.name
				});
				studySaved = true;
				dest = resolve('/(app)/cbct/[patientId]/[studyId]', {
					patientId: patient.id,
					studyId: study.id
				});
			} else {
				progressKey = 'upload.savingIos';
				const patient = await makePatient();
				const study = await studies.addStudy({
					patientId: patient.id,
					modality: 'ios',
					imageBlob: file,
					originalFilename: file.name
				});
				studySaved = true;
				dest = resolve('/(app)/ios/[patientId]/[studyId]', {
					patientId: patient.id,
					studyId: study.id
				});
			}
			processing = false;
			progressKey = '';
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dest is resolve()-built above (rule can't trace variables)
			await goto(dest);
		} catch (err) {
			if (createdPatientId && !studySaved) studies.deletePatient(createdPatientId).catch(() => {});
			processing = false;
			progressKey = '';
			const m = (err as { status?: number; body?: { message?: string }; message?: string }) ?? {};
			if (m.status === 403 && m.body?.message) {
				paywallReason = m.body.message;
				paywallOpen = true;
			} else {
				// Localized: the backend's non-403 messages are raw English-technical, and a
				// PB ClientResponseError's .message is always English (A1) — never show them.
				error = $_(operationErrorKey(err, 'quickdrop.errGeneric'));
			}
		}
	}

	async function cropBlob(
		b64: string,
		roi: { x1: number; y1: number; x2: number; y2: number }
	): Promise<{ b64: string; blob: Blob }> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				const w = roi.x2 - roi.x1;
				const h = roi.y2 - roi.y1;
				const c = document.createElement('canvas');
				c.width = w;
				c.height = h;
				const ctx = c.getContext('2d');
				if (!ctx) {
					reject(new Error('canvas ctx'));
					return;
				}
				ctx.drawImage(img, roi.x1, roi.y1, w, h, 0, 0, w, h);
				c.toBlob(
					(blob) => {
						if (!blob) return reject(new Error('blob fail'));
						const out = c.toDataURL('image/jpeg', 0.92).split(',')[1] ?? '';
						resolve({ b64: out, blob });
					},
					'image/jpeg',
					0.92
				);
			};
			img.onerror = (e) => reject(e);
			img.src = 'data:image/jpeg;base64,' + b64;
		});
	}
</script>

<svelte:window
	ondragenter={onDragEnter}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	onpaste={onPaste}
/>
<PaywallModal bind:open={paywallOpen} reason={paywallReason} />

{#if showOverlay}
	<div class="overlay" class:interactive={processing || !!error} data-testid="quickdrop-overlay">
		<div class="panel">
			{#if processing}
				<Loader2 class="spin" size={40} />
				<div class="title">{$_(progressKey || 'upload.analyzing')}</div>
			{:else if error}
				<div class="title err">{error}</div>
				<button type="button" class="dismiss" onclick={() => (error = '')}
					>{$_('common.close')}</button
				>
			{:else}
				<div class="ring"><UploadCloud size={40} /></div>
				<div class="title">{$_('quickdrop.title')}</div>
				<div class="hint">{$_('quickdrop.hint')}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: color-mix(in oklab, var(--color-bg-0) 78%, transparent);
		backdrop-filter: blur(4px);
		pointer-events: none; /* let drag/drop reach the window while dragging */
	}
	.overlay.interactive {
		pointer-events: auto; /* processing / error → capture the dismiss click */
	}
	.panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		min-width: 320px;
		max-width: 460px;
		padding: 2.5rem 2rem;
		border-radius: var(--radius-card);
		border: 2px dashed var(--color-primary);
		background: var(--color-bg-1);
		box-shadow: var(--shadow-pop);
		text-align: center;
	}
	.ring {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 72px;
		width: 72px;
		border-radius: 50%;
		background: var(--color-primary-tint);
		color: var(--color-primary);
	}
	.title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-fg-0);
	}
	.title.err {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-danger);
	}
	.hint {
		font-size: 0.85rem;
		color: var(--color-fg-2);
	}
	.dismiss {
		margin-top: 0.5rem;
		padding: 0.45rem 1.1rem;
		border-radius: var(--radius-control);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}
	.dismiss:hover {
		color: var(--color-fg-0);
		border-color: var(--color-border-hover);
	}
	.panel :global(.spin) {
		color: var(--color-primary);
		animation: quickdrop-spin 0.8s linear infinite;
	}
	@keyframes quickdrop-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
