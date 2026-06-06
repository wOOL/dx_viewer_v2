<script lang="ts">
	import TopBar from '$lib/components/TopBar.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { studies } from '$lib/stores/studies.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { matchPatientsByName } from '$lib/patients';
	import { fileToBase64, fileToDataUrl } from '$lib/image';
	import { findXray, runInference, countFindings } from '$lib/ai';
	import { validateUploadFile, summarizeBatch, type FileOutcome } from '$lib/uploadValidation';
	import { availableModalities, showModalityPicker } from '$lib/modality';
	import { dropzoneClickOpensPicker } from '$lib/dropzone';
	import { MAX_NAME_LENGTH, operationErrorKey } from '$lib/forms';
	import { Upload, Image as ImageIcon, Camera, Boxes, Scan, X, Aperture } from 'lucide-svelte';
	import PaywallModal from '$lib/components/PaywallModal.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { _, locale } from 'svelte-i18n';
	import { validateDobISO, MIN_DOB_ISO } from '$lib/date';

	type Modality = 'xray' | 'panoramic' | 'cbct' | 'ios' | 'photo';

	let patientName = $state('');
	let patientDob = $state('');
	let modality = $state<Modality>('xray');
	let phoneSourced = $state(false);
	// Multi-file queue: clinicians upload an entire FMX (16+ films) in one go;
	// for CBCT/IOS a single volume per session is still the right answer. The
	// per-modality `multipleAllowed` flag below gates which modalities accept N>1.
	let files = $state<File[]>([]);
	let preview = $state<string | null>(null);
	let progress = $state<string>('');
	let progressPct = $state<number>(0);
	// Per-file index/total — surfaced in the progress strip when N>1 so the user
	// knows we're 3/16 through their FMX, not stuck on the first one.
	let batchTotal = $state(0);
	let batchDoneCount = $state(0);
	let error = $state('');
	let isProcessing = $state(false);
	let paywallOpen = $state(false);
	let paywallReason = $state('No Subscription');

	// Cap the DOB picker at today — a birth date in the future is invalid.
	// LOCAL today, not UTC: clinicians in timezones west of UTC otherwise saw the
	// DOB max set a day ahead (e.g. typing 2026-05-29 at 9pm Pacific gave them
	// 2026-05-30 because toISOString hops to UTC). Matches the localDateKey helper.
	const todayISO = (() => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	})();

	// Add-to-existing-patient. When a specific patient is chosen — via the patient
	// page's "Add study" (?patient=<id>) or by picking a match below — the new study
	// attaches to THAT patient BY ID, instead of re-matching name+DOB (which created a
	// duplicate patient whenever the typed name/DOB didn't exactly match the record —
	// the reported "every new study makes a new patient" bug). Leaving it unset keeps
	// the create-new-patient path.
	let targetPatientId = $state<string | null>(null);
	const targetPatient = $derived(targetPatientId ? studies.getPatient(targetPatientId) : null);
	// As you type a name (when not already locked to a patient), suggest existing
	// patients to add to — so adding to an existing record is discoverable, not a
	// fuzzy name+DOB guess.
	const patientMatches = $derived(
		targetPatientId ? [] : matchPatientsByName(studies.patients, patientName)
	);
	function selectExisting(p: { id: string; name: string; dob?: string }) {
		targetPatientId = p.id;
		patientName = p.name;
		patientDob = (p.dob ?? '').slice(0, 10);
	}
	function clearTarget() {
		targetPatientId = null;
	}

	onMount(async () => {
		// Guard refresh so a backend hiccup can't swallow the URL-param prefill
		// below — otherwise "Add study" from a patient page (?patient=<id>) would
		// land on a blank form with the patient/modality targeting silently
		// dropped, risking a duplicate patient on submit. Match the sibling pages.
		try {
			await studies.refresh();
		} catch {
			error = $_('upload.errLoadPatients');
		}
		// "Add study" from a patient page passes ?patient=<id> — prefill that
		// patient's name/DOB so the new study attaches to them (and the clinician
		// doesn't re-type, risking a typo → wrong/duplicate patient).
		const pid = page.url.searchParams.get('patient');
		if (pid) {
			const p = studies.getPatient(pid);
			if (p) {
				targetPatientId = pid; // attach by id — never create a duplicate of this patient
				patientName = p.name;
				patientDob = (p.dob ?? '').slice(0, 10); // date input wants YYYY-MM-DD
			}
		}
		// "Add photo" deep-links here as ?modality=photo so the right modality is
		// pre-selected (otherwise the user lands on X-ray and the photo would be
		// sent to the AI inference endpoint).
		const m = page.url.searchParams.get('modality');
		// Honour the deep-link only for a modality the user can actually use — a CBCT/IOS
		// link with 3D off, or a Photo link with Photos off, falls back to X-ray (the
		// picker won't show that button, so they'd otherwise be stuck on a hidden modality).
		const allowed =
			m === 'xray' ||
			(m === 'panoramic' && auth.panoramicEnabled) ||
			((m === 'cbct' || m === 'ios') && auth.threeDEnabled) ||
			(m === 'photo' && auth.photoEnabled);
		if (allowed) modality = m as Modality;
	});

	// Which modalities accept multi-file. CBCT (one volume per .nii.gz) and IOS
	// (one mesh per .obj/.stl/.ply) are inherently single-file; X-ray/Panoramic/
	// Photo are not.
	const multipleAllowed = $derived(
		modality === 'xray' || modality === 'panoramic' || modality === 'photo'
	);

	// Which modalities this user can pick (X-ray always; Panoramic / CBCT+IOS / Photo per
	// account opt-in). The picker is hidden entirely when X-ray is the only option.
	const modalityFlags = $derived({
		panoramic: auth.panoramicEnabled,
		threeD: auth.threeDEnabled,
		photo: auth.photoEnabled
	});
	const modCount = $derived(availableModalities(modalityFlags).length);
	const showPicker = $derived(showModalityPicker(modalityFlags));

	// If the selected modality becomes unavailable mid-session (an admin/Labs toggle flips,
	// or a re-auth drops a flag), fall back to X-ray — otherwise the form could submit a
	// now-disabled modality, creating a study the user can never see. X-ray is always allowed.
	$effect(() => {
		if (!availableModalities(modalityFlags).includes(modality)) modality = 'xray';
	});

	async function addFiles(picked: FileList | File[]) {
		const arr = Array.from(picked);
		if (arr.length === 0) return;
		// Validate each file against the CHOSEN modality BEFORE it joins the queue,
		// so an empty / oversized / wrong-type file is rejected up front with a
		// specific reason instead of failing late after the encode + AI + upload.
		const accepted: File[] = [];
		const rejected: string[] = [];
		for (const f of arr) {
			const v = validateUploadFile(f, modality, $locale ?? undefined);
			if (v.ok) accepted.push(f);
			else rejected.push($_(v.messageKey, { values: v.values }));
		}
		error = rejected.join(' ');
		if (accepted.length === 0) return;
		if (multipleAllowed) {
			// Append (clinician may pick a folder then drop a few more); but cap
			// at one if the modality is single-file (CBCT/IOS).
			files = [...files, ...accepted];
		} else {
			// Single-file modality: latest pick wins, don't accumulate.
			files = [accepted[0]];
		}
		// Only the FIRST file gets a preview thumbnail (the rest are listed by name).
		const head = files[0];
		preview =
			head && (modality === 'xray' || modality === 'panoramic' || modality === 'photo')
				? await fileToDataUrl(head)
				: null;
	}

	function removeFile(i: number) {
		files = files.filter((_, idx) => idx !== i);
		if (files.length === 0) preview = null;
		else if (i === 0)
			// Removed the head — refresh the preview from the new head.
			fileToDataUrl(files[0]).then((d) => (preview = d));
	}

	async function onFile(e: Event) {
		const t = e.target as HTMLInputElement;
		if (t.files) await addFiles(t.files);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
	}

	// The dropzone is rendered as role="button" tabindex="0" so it should be
	// click- and keyboard-activatable. Open the hidden file input on either.
	function activateDropzone(e: Event) {
		// Only open the picker for a click on the BARE dropzone surface. A click on
		// the nested <label> (Browse / Add more) or its <input> already opens the
		// file chooser natively; calling input.click() as well opens it TWICE in one
		// gesture, and browsers then intermittently drop the resulting `change` — the
		// picked file fails to register ~1/3 of the time. The Remove/X <button>
		// inside the zone must not open it either. (Keyboard activation passes the
		// focused dropzone div, which has none of those ancestors → still opens.)
		if (!dropzoneClickOpensPicker(e.target)) return;
		const input = (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(
			'input[type="file"]'
		);
		input?.click();
	}
	function onDropzoneKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			activateDropzone(e);
		}
	}

	// Switching modality changes the accepted file types, so drop any file picked
	// under the previous modality — otherwise a now-mismatched file lingers in the
	// form (e.g. a .jpg left selected after switching to CBCT) and would be submitted
	// to the wrong endpoint. Mirrors the Remove button's clear.
	function setModality(m: Modality) {
		if (m === modality) return;
		modality = m;
		files = [];
		preview = null;
	}

	async function submit() {
		if (files.length === 0 || !patientName.trim()) {
			error = $_('upload.errRequired');
			return;
		}
		// Native `min`/`max` block the picker, but a typed/pasted out-of-range date
		// can still reach here — guard the submit too. Both bounds: a future DOB AND
		// an absurd-past one (year-0001 etc.) that would otherwise flow into the
		// chart + printout. See validateDobISO.
		const dobCheck = validateDobISO(patientDob);
		if (dobCheck === 'future') {
			error = $_('upload.errFutureDob');
			return;
		}
		if (dobCheck === 'tooOld') {
			error = $_('upload.errDobTooOld');
			return;
		}
		error = '';
		isProcessing = true;
		progressPct = 5;
		batchTotal = files.length;
		batchDoneCount = 0;
		// If we create a NEW patient below but the study save then fails, delete that
		// patient so a failed upload doesn't leave an orphaned 0-study record (completes
		// the #40 orphan fix). Only a freshly-created patient is cleaned up, never an
		// existing one we're adding a study to.
		let createdPatientId: string | null = null;
		let firstStudySaved = false;
		let savedAnything = false;
		let firstStudyId: string | null = null;
		let patientId: string | null = null;
		// Per-file outcomes drive the all-ok / partial / all-failed summary below.
		const outcomes: FileOutcome[] = [];
		try {
			// Create (or find) the patient only once we're committed to saving a
			// study — for X-rays that's AFTER first inference succeeds, so a failed
			// inference no longer leaves an orphaned 0-study patient in the list.
			const makePatient = async () => {
				// A chosen existing patient → attach by id (no name/DOB re-match, no duplicate).
				if (targetPatientId) {
					const existing = studies.getPatient(targetPatientId);
					if (existing) return existing;
				}
				const { patient, created } = await studies.findOrCreatePatient({
					name: patientName.trim(),
					dob: patientDob || undefined
				});
				if (created) createdPatientId = patient.id;
				return patient;
			};

			for (let i = 0; i < files.length; i++) {
				const f = files[i];
				const stamp = files.length > 1 ? ` (${i + 1}/${files.length})` : '';

				// Per-file try/catch: a single bad film (AI 500, network blip, one
				// corrupt image) must NOT abandon the rest of the batch. Record the
				// failure and continue so files 6–16 still import; the summary after
				// the loop reports partial success. (A 403 paywall is re-thrown to the
				// outer handler — no point continuing an unsubscribed batch.)
				try {
					if (modality === 'xray' || modality === 'panoramic') {
						progress = $_('upload.encoding') + stamp;
						progressPct = 15;
						let b64 = await fileToBase64(f);
						let processedBlob: Blob = f;

						if (phoneSourced && modality === 'xray') {
							progress = $_('upload.locating') + stamp;
							progressPct = 30;
							try {
								const roi = await findXray(b64);
								if (!roi.extra.xrayfound || !roi.result) {
									// For a single-file submit this is fatal; for a batch we log
									// + record the miss and skip so the remaining films upload.
									if (files.length === 1) {
										error = $_('upload.errNoXray');
										isProcessing = false;
										return;
									}
									console.warn('find_xray missed on', f.name, '— skipping');
									outcomes.push({ name: f.name, ok: false, reason: $_('upload.errNoXray') });
									continue;
								}
								progress = $_('upload.cropping') + stamp;
								progressPct = 40;
								const cropped = await cropBlob(b64, roi.result);
								b64 = cropped.b64;
								processedBlob = cropped.blob;
							} catch (err) {
								console.warn('find_xray failed, continuing without crop', err);
							}
						}

						progress = $_('upload.inferring') + stamp;
						progressPct = 60;
						const inf = await runInference({
							image_data: b64,
							meta_data: {
								ensure_dim: true,
								disease_segment: true,
								anatomy_meta_data: { conf_thres: 0.3 },
								number_meta_data: { conf_thres: 0.1, fdi_number: false },
								disease_meta_data: { conf_thres: 0.1 },
								rule_meta_data: { segment_conf_thres: 0.3, limit_dim: 720 }
							}
						});

						progress = $_('upload.savingStudy') + stamp;
						progressPct = 90;
						const patient = await makePatient();
						patientId = patient.id;
						const study = await studies.addStudy({
							patientId: patient.id,
							modality,
							imageBlob: processedBlob,
							originalFilename: f.name,
							inference: inf,
							findingCounts: countFindings(inf)
						});
						if (!firstStudySaved) firstStudyId = study.id;
						firstStudySaved = true;
						savedAnything = true;
						batchDoneCount = i + 1;
						outcomes.push({ name: f.name, ok: true });
					} else if (modality === 'cbct') {
						progress = $_('upload.savingCbct');
						const patient = await makePatient();
						patientId = patient.id;
						const study = await studies.addStudy({
							patientId: patient.id,
							modality,
							imageBlob: f,
							originalFilename: f.name
						});
						if (!firstStudySaved) firstStudyId = study.id;
						firstStudySaved = true;
						savedAnything = true;
						batchDoneCount = i + 1;
						outcomes.push({ name: f.name, ok: true });
					} else if (modality === 'ios') {
						progress = $_('upload.savingIos');
						const patient = await makePatient();
						patientId = patient.id;
						const study = await studies.addStudy({
							patientId: patient.id,
							modality,
							imageBlob: f,
							originalFilename: f.name
						});
						if (!firstStudySaved) firstStudyId = study.id;
						firstStudySaved = true;
						savedAnything = true;
						batchDoneCount = i + 1;
						outcomes.push({ name: f.name, ok: true });
					} else if (modality === 'photo') {
						// A camera photo — no AI inference (and so no paywall): just store the
						// image under the patient and land on their Photos tab.
						progress = $_('upload.savingPhoto') + stamp;
						const patient = await makePatient();
						patientId = patient.id;
						await studies.addStudy({
							patientId: patient.id,
							modality,
							imageBlob: f,
							originalFilename: f.name
						});
						firstStudySaved = true;
						savedAnything = true;
						batchDoneCount = i + 1;
						outcomes.push({ name: f.name, ok: true });
					}
				} catch (perFileErr) {
					// Re-throw a 403 paywall so the outer handler opens the modal and
					// stops the batch; record any other failure and keep going.
					if ((perFileErr as { status?: number })?.status === 403) throw perFileErr;
					console.warn('upload failed on', f.name, perFileErr);
					outcomes.push({
						name: f.name,
						ok: false,
						// Localized: backend non-403 messages are raw English-technical (A1).
						reason: $_(operationErrorKey(perFileErr, 'upload.errInference'))
					});
				}
			}

			progressPct = 100;
			const summary = summarizeBatch(outcomes);
			// Nothing saved — either every phone X-ray missed find_xray, or every
			// file threw. Clean up a patient created solely for this empty batch so a
			// failed upload doesn't orphan a 0-study record, then surface it
			// (#82/#103 silent-failure vein; #40/#96 orphan vein).
			if (!savedAnything) {
				if (createdPatientId) studies.deletePatient(createdPatientId).catch(() => {});
				// If only find_xray missed (no thrown failures) keep the existing
				// X-ray-specific message; otherwise report the failures generically.
				const allXrayMiss =
					summary.state === 'all-failed' &&
					summary.failures.every((x) => x.reason === $_('upload.errNoXray'));
				error = allXrayMiss
					? $_('upload.errNoXrayBatch')
					: $_('upload.errAllFailed', { values: { count: outcomes.length } });
				return;
			}
			// Some saved, some failed → tell the user exactly which failed and STAY
			// on this page so they can read the summary; the saved films are already
			// persisted and reachable from the patient page, and re-uploading the
			// whole batch would duplicate the saved studies. Auto-navigating would
			// flash the summary away. (A single-file submit is never "partial", so
			// single-file navigation below is unaffected.)
			if (summary.state === 'partial') {
				const names = summary.failures.map((x) => x.name).join(', ');
				error = $_('upload.errPartial', {
					values: { saved: summary.saved, total: outcomes.length, files: names }
				});
				return;
			}

			// Navigation rule:
			// - single X-ray / panoramic → open that one study in the 2D viewer
			// - batch X-ray / panoramic OR multi-photo → land on the patient page
			//   (so the user sees the new tiles + FMX grid populated)
			// - CBCT / IOS → the dedicated 3D viewer for that single study
			if (
				(modality === 'xray' || modality === 'panoramic') &&
				files.length === 1 &&
				firstStudyId &&
				patientId
			) {
				await goto(
					resolve('/(app)/viewer/[patientId]/[studyId]', {
						patientId,
						studyId: firstStudyId
					}),
					{ replaceState: true }
				);
			} else if (modality === 'cbct' && firstStudyId && patientId) {
				await goto(
					resolve('/(app)/cbct/[patientId]/[studyId]', { patientId, studyId: firstStudyId }),
					{ replaceState: true }
				);
			} else if (modality === 'ios' && firstStudyId && patientId) {
				await goto(
					resolve('/(app)/ios/[patientId]/[studyId]', { patientId, studyId: firstStudyId }),
					{ replaceState: true }
				);
			} else if (patientId) {
				const tab = modality === 'photo' ? '?tab=photos' : '';
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()-built path + query string (resolve can't carry queries)
				await goto(`${resolve('/(app)/patients/[patientId]', { patientId })}${tab}`, {
					replaceState: true
				});
			}
		} catch (err) {
			// A new patient was created but no study saved → remove the orphan so a
			// failed upload doesn't litter the studies list with a 0-study record.
			if (createdPatientId && !savedAnything) {
				studies.deletePatient(createdPatientId).catch(() => {});
			}
			const m = (err as { status?: number; body?: { message?: string }; message?: string }) ?? {};
			if (m.status === 403 && m.body?.message) {
				paywallReason = m.body.message;
				paywallOpen = true;
			} else {
				// Localized: backend non-403 messages are raw English-technical (A1).
				error = $_(operationErrorKey(err, 'upload.errInference'));
			}
		} finally {
			isProcessing = false;
			batchTotal = 0;
			batchDoneCount = 0;
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

	// Browsers only match the LAST dot extension when filtering via the
	// `accept` attribute — `.nii.gz` would silently match nothing, so we list
	// `.gz` (covers .nii.gz and any user-gzipped volume) alongside the
	// uncompressed forms, plus the MIME hints in case the OS picker prefers
	// them over the extension check.
	const accept = $derived.by(() => {
		if (modality === 'cbct') return '.nii,.gz,.nrrd,.mha,.gipl,application/gzip,application/x-gzip';
		if (modality === 'ios') return '.obj,.stl,.ply';
		return 'image/*';
	});
</script>

<PaywallModal bind:open={paywallOpen} reason={paywallReason} />
<TopBar title={$_('common.newStudy')} showSearch={false} />

<main class="flex-1 overflow-y-auto px-8 py-7">
	<div class="mx-auto max-w-3xl">
		<div class="card">
			<h2 class="mb-1 text-lg font-bold text-fg-0">{$_('upload.heading')}</h2>
			<p class="mb-6 text-sm text-fg-2">{$_('upload.subheading')}</p>

			<!-- Modality choices are gated by account opt-ins: Panoramic, CBCT/IOS and Photo
			     each appear only when their toggle is on. The whole picker is hidden when
			     X-ray is the only option (nothing to choose). -->
			{#if showPicker}
				<div
					class="mb-5 grid gap-2"
					style:grid-template-columns="repeat({modCount}, minmax(0, 1fr))"
				>
					<button
						type="button"
						class="modality"
						class:active={modality === 'xray'}
						aria-pressed={modality === 'xray'}
						onclick={() => setModality('xray')}
					>
						<ImageIcon size={20} />
						<span>{$_('upload.modXray')}</span>
					</button>
					{#if auth.panoramicEnabled}
						<button
							type="button"
							class="modality"
							class:active={modality === 'panoramic'}
							aria-pressed={modality === 'panoramic'}
							onclick={() => setModality('panoramic')}
						>
							<Scan size={20} />
							<span>{$_('upload.modPanoramic')}</span>
						</button>
					{/if}
					{#if auth.threeDEnabled}
						<button
							type="button"
							class="modality"
							class:active={modality === 'cbct'}
							aria-pressed={modality === 'cbct'}
							onclick={() => setModality('cbct')}
						>
							<Boxes size={20} />
							<span>{$_('upload.modCbct')}</span>
						</button>
						<button
							type="button"
							class="modality"
							class:active={modality === 'ios'}
							aria-pressed={modality === 'ios'}
							onclick={() => setModality('ios')}
						>
							<Camera size={20} />
							<span>{$_('upload.modIos')}</span>
						</button>
					{/if}
					{#if auth.photoEnabled}
						<button
							type="button"
							class="modality"
							class:active={modality === 'photo'}
							aria-pressed={modality === 'photo'}
							onclick={() => setModality('photo')}
						>
							<Aperture size={20} />
							<span>{$_('upload.modPhoto')}</span>
						</button>
					{/if}
				</div>
			{/if}

			{#if targetPatient}
				<div class="addingto">
					<span>{$_('upload.addingTo', { values: { name: targetPatient.name } })}</span>
					<button type="button" class="useother" onclick={clearTarget}
						>{$_('upload.useDifferent')}</button
					>
				</div>
			{/if}
			<div class="grid grid-cols-2 gap-4">
				<div class="relative">
					<label for="pname" class="lbl">{$_('upload.patientName')}</label>
					<input
						id="pname"
						bind:value={patientName}
						placeholder={$_('upload.patientNamePlaceholder')}
						class="input"
						disabled={!!targetPatientId}
						autocomplete="off"
						maxlength={MAX_NAME_LENGTH}
					/>
					{#if patientMatches.length > 0}
						<div class="matches">
							<div class="matches-head">{$_('upload.existingMatches')}</div>
							{#each patientMatches as p (p.id)}
								<button type="button" class="match" onclick={() => selectExisting(p)}>
									<span class="match-name">{p.name}</span>
									<span class="match-meta"
										>{$_('studies.studyCount', { values: { count: p.studies.length } })}</span
									>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<div>
					<label for="pdob" class="lbl">{$_('upload.dob')}</label>
					<input
						id="pdob"
						type="date"
						min={MIN_DOB_ISO}
						max={todayISO}
						bind:value={patientDob}
						class="input"
						disabled={!!targetPatientId}
					/>
				</div>
			</div>

			{#if modality === 'xray'}
				<label class="mt-4 flex items-center gap-2 text-sm text-fg-2">
					<input type="checkbox" class="checkbox" bind:checked={phoneSourced} />
					<span>{$_('upload.phonePhoto')}</span>
				</label>
			{:else if modality === 'photo'}
				<p class="mt-4 text-xs text-fg-2">{$_('upload.photoNote')}</p>
			{/if}

			<div
				ondragover={(e) => e.preventDefault()}
				ondrop={onDrop}
				onclick={activateDropzone}
				onkeydown={onDropzoneKey}
				role="button"
				tabindex="0"
				class="dropzone mt-5 flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-bg-2 p-6 transition"
			>
				{#if files.length > 0 && preview && files.length === 1 && (modality === 'xray' || modality === 'panoramic' || modality === 'photo')}
					<!-- Single-file preview (existing UX) -->
					<div class="relative">
						<img src={preview} alt={$_('upload.previewAlt')} class="max-h-[260px] rounded-lg" />
						<button
							type="button"
							class="absolute -top-2 -right-2 rounded-full bg-bg-3 p-1 text-fg-0 transition hover:bg-bg-3"
							aria-label={$_('upload.remove')}
							onclick={() => removeFile(0)}
						>
							<X size={14} />
						</button>
					</div>
					<div class="text-xs text-fg-2">{files[0].name}</div>
					{#if multipleAllowed}
						<label class="mt-2 cursor-pointer text-xs text-primary hover:underline">
							{$_('upload.addMore')}
							<input type="file" multiple {accept} class="hidden" onchange={onFile} />
						</label>
					{/if}
				{:else if files.length > 0}
					<!-- Batch list (>1 file) OR single-file CBCT/IOS -->
					<div class="w-full max-w-md">
						<div class="mb-2 text-xs font-semibold text-fg-1">
							{files.length === 1
								? files[0].name
								: $_('upload.batchCount', { values: { n: files.length } })}
						</div>
						{#if files.length > 1}
							<ul
								class="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-bg-1 p-2"
							>
								{#each files as f, i (i + ':' + f.name)}
									<li class="flex items-center justify-between gap-2 text-xs">
										<span class="truncate text-fg-1">📄 {f.name}</span>
										<button
											type="button"
											class="text-fg-2 hover:text-danger"
											aria-label={$_('upload.remove')}
											onclick={() => removeFile(i)}
										>
											<X size={12} />
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<button
								type="button"
								class="mt-1 text-xs text-fg-2 hover:underline"
								onclick={() => removeFile(0)}>{$_('upload.remove')}</button
							>
						{/if}
						{#if multipleAllowed}
							<label class="mt-2 inline-flex cursor-pointer text-xs text-primary hover:underline">
								{$_('upload.addMore')}
								<input type="file" multiple {accept} class="hidden" onchange={onFile} />
							</label>
						{/if}
					</div>
				{:else}
					<div class="rounded-full bg-bg-3 p-3">
						<Upload size={24} class="text-fg-2" />
					</div>
					<div class="text-sm text-fg-1">{$_('upload.dropHere')}</div>
					<label
						class="browse cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition"
					>
						{$_('upload.browse')}
						<input
							type="file"
							multiple={multipleAllowed}
							{accept}
							class="hidden"
							onchange={onFile}
						/>
					</label>
					<div class="text-xs text-fg-2">
						{#if modality === 'cbct'}.nii.gz, .nrrd, .mha, .gipl{:else if modality === 'ios'}.obj,
							.stl, .ply{:else}.jpg, .png, .webp{/if}
					</div>
				{/if}
			</div>

			{#if isProcessing}
				<div class="mt-5">
					<div class="mb-2 flex items-center gap-2 text-sm text-fg-1">
						<span class="spinner"></span>
						{progress}
					</div>
					<div class="h-1.5 overflow-hidden rounded-full bg-bg-3">
						<div class="h-full bg-primary transition-all" style:width="{progressPct}%"></div>
					</div>
				</div>
			{/if}

			{#if error}
				<div
					class="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
					role="alert"
				>
					{error}
				</div>
			{/if}

			<div class="mt-6 flex justify-end gap-2">
				<a href={resolve('/(app)/studies')} class="btn-secondary">{$_('common.cancel')}</a>
				<button
					type="button"
					class="btn-primary"
					onclick={submit}
					disabled={isProcessing || files.length === 0 || !patientName.trim()}
				>
					{#if modality === 'photo'}
						{isProcessing ? $_('upload.savingPhoto') : $_('upload.savePhoto')}
					{:else if files.length > 1}
						{isProcessing
							? $_('upload.analyzingBatch', { values: { done: batchDoneCount, total: batchTotal } })
							: $_('upload.runBatch', { values: { n: files.length } })}
					{:else}
						{isProcessing ? $_('upload.analyzing') : $_('upload.run')}
					{/if}
				</button>
			</div>
		</div>
	</div>
</main>

<style>
	.card {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 1.5rem;
	}
	.dropzone:hover {
		border-color: var(--color-primary);
	}
	.browse {
		background: var(--color-primary);
		color: var(--color-on-primary);
	}
	.browse:hover {
		background: var(--color-primary-hover);
	}
	.modality {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.875rem 0.5rem;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		color: var(--color-fg-2);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}
	.modality:hover {
		border-color: var(--color-border-hover);
		color: var(--color-fg-0);
	}
	.modality.active {
		background: var(--color-primary-tint);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	.lbl {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-fg-2);
		margin-bottom: 0.35rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.input {
		width: 100%;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.6rem 0.75rem;
		color: var(--color-fg-0);
		font-size: 0.875rem;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.input:focus {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px var(--color-primary-tint);
	}
	.input:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
	.checkbox {
		accent-color: var(--color-primary);
	}
	.addingto {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding: 0.6rem 0.85rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-primary);
		background: var(--color-primary-tint);
		color: var(--color-fg-0);
		font-size: 0.85rem;
		font-weight: 600;
	}
	.useother {
		flex: none;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-primary);
		cursor: pointer;
	}
	.useother:hover {
		text-decoration: underline;
	}
	.matches {
		position: absolute;
		z-index: 20;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 14rem;
		overflow-y: auto;
		padding: 0.25rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		box-shadow: var(--shadow-pop);
	}
	.matches-head {
		padding: 0.35rem 0.5rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-fg-2);
	}
	.match {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 0.55rem;
		border-radius: calc(var(--radius-control) - 2px);
		text-align: left;
		cursor: pointer;
	}
	.match:hover {
		background: var(--color-bg-2);
	}
	.match-name {
		font-size: 0.875rem;
		color: var(--color-fg-0);
	}
	.match-meta {
		flex: none;
		font-size: 0.72rem;
		color: var(--color-fg-2);
	}
	.btn-primary {
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
		font-size: 0.875rem;
		padding: 0.6rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		font-weight: 500;
		font-size: 0.875rem;
		padding: 0.6rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}
	.btn-secondary:hover {
		color: var(--color-fg-0);
		border-color: var(--color-border-hover);
	}
</style>
