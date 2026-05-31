import * as m from '$lib/paraglide/messages';
import { cbctSegInference, iosSegInference, type PBClient } from '@be-certain/core/api';
import { AsyncHandler } from '@be-certain/core/async';
import { resolveErrorMessage } from '@be-certain/core/errors';
import { logger } from '@be-certain/core/logger';
import { isApiPaywallError } from '@be-certain/core/subscription';
import { findEntry, unzipBlob } from '@be-certain/imaging-3d/loaders';
import { ToothFairy3LabelSchema } from '@be-certain/imaging-3d/labels';
import { Viewer3DSession, type ViewerContainers } from '@be-certain/imaging-3d/svelte';

const log = logger.scoped('volume-3d');

/**
 * Top-level lifecycle of the user's uploaded asset:
 *   idle → mounting → ready  (or → error on failure)
 *
 * Mirrors the marketing-demo behaviour: the file is parsed and mounted locally
 * the moment it lands, with no backend gate. The viewport is interactive in
 * ~1s — same UX as the demo. Backend segmentation is layered on top
 * asynchronously and tracked separately so a slow / failed / paywalled
 * inference call never blocks the volume view.
 */
export type Volume3DStage = 'idle' | 'mounting' | 'ready' | 'error';

/** Independent state machine for the segmentation overlay. */
export type SegmentationStage = 'idle' | 'inferring' | 'mounting' | 'ready' | 'paywall' | 'error';

export type Volume3DKind = 'cbct' | 'ios' | 'gltf';

export class Volume3DSession {
	stage = $state<Volume3DStage>('idle');
	error = $state<string | null>(null);
	kind = $state<Volume3DKind | null>(null);
	fileName = $state<string | null>(null);
	viewer = new Viewer3DSession();

	/** Segmentation overlay state — independent of the main volume stage. */
	segStage = $state<SegmentationStage>('idle');
	segError = $state<string | null>(null);
	inferenceHandler = new AsyncHandler<Blob>();

	/**
	 * Bumped on every `resetState()`. Each `run*Segmentation` captures the
	 * current value at entry and re-checks it after every `await`; if a newer
	 * load has started in the meantime, it bails before touching state. Pairs
	 * with `inferenceController` which actually cancels the in-flight fetch.
	 */
	private runToken = 0;
	private inferenceController: AbortController | null = null;

	constructor(private pb: PBClient) {}

	/** Mirrors the inner Viewer3DSession progress during the mounting stage. */
	get progress(): number {
		return this.stage === 'mounting' ? this.viewer.progress : 0;
	}

	/**
	 * CBCT path:
	 *   1. Mount the user's NIfTI/NRRD volume locally → 'ready' (interactive).
	 *   2. In parallel, ship the file to /api/ai/cbct_seg_inference.
	 *   3. When the zip comes back, extract pred_seg.gltf/glb and appendAsset
	 *      it as a gltf-segmentation overlay on the existing renderer.
	 *
	 * If inference fails or 403s, the volume view stays — only segStage flips.
	 */
	async loadCbct(file: File, containers: ViewerContainers): Promise<void> {
		this.resetState();
		this.kind = 'cbct';
		this.fileName = file.name;
		const format = file.name.toLowerCase().endsWith('.nrrd') ? 'nrrd' : 'nifti';

		// 1. Mount volume locally.
		if (!(await this.mountVolume(file, format, containers))) return;

		// 2. Inference + overlay (fire-and-forget; do not await — caller returns now).
		this.runCbctSegmentation(file).catch((err) => log.error('CBCT seg pipeline crashed', err));
	}

	/**
	 * IOS path:
	 *   - OBJ:    mount locally, then inference → glb overlay.
	 *   - STL/PLY: no local parser, so render-on-inference only. The segStage UI
	 *     carries the message in that case.
	 */
	async loadIos(file: File, containers: ViewerContainers): Promise<void> {
		this.resetState();
		this.kind = 'ios';
		this.fileName = file.name;
		const name = file.name.toLowerCase();

		if (name.endsWith('.obj')) {
			const ok = await this.mountInitial(containers, [
				{ kind: 'mesh', format: 'obj', source: { kind: 'file', file } }
			]);
			if (!ok) return;
			this.runIosSegmentation(file).catch((err) => log.error('IOS seg pipeline crashed', err));
			return;
		}

		// Fallback: backend-only path for STL/PLY (no local parser).
		const token = this.runToken;
		this.segStage = 'inferring';
		this.inferenceController = new AbortController();
		const signal = this.inferenceController.signal;
		const blob = await this.inferenceHandler.run(
			() => iosSegInference(this.pb, file, { signal }),
			300_000,
			m.dx_viewer_3d_inference_timeout()
		);
		if (token !== this.runToken) return;
		if (!blob) return this.flagSegmentationFailure(signal);
		this.segStage = 'mounting';
		const segFile = new File([blob], 'segmentation.glb');
		const ok = await this.mountInitial(containers, [
			{
				kind: 'gltf-segmentation',
				format: 'glb',
				source: { kind: 'file', file: segFile },
				schema: ToothFairy3LabelSchema
			}
		]);
		if (token !== this.runToken) return;
		if (ok) this.segStage = 'ready';
	}

	/** Mount a pre-segmented `.gltf` / `.glb` directly — no backend inference. */
	async loadGltf(file: File, containers: ViewerContainers): Promise<void> {
		this.resetState();
		this.kind = 'gltf';
		this.fileName = file.name;
		await this.mountInitial(containers, [
			{
				kind: 'gltf-segmentation',
				format: file.name.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf',
				source: { kind: 'file', file },
				schema: ToothFairy3LabelSchema
			}
		]);
	}

	private async mountVolume(
		file: File,
		format: 'nifti' | 'nrrd',
		containers: ViewerContainers
	): Promise<boolean> {
		return this.mountInitial(containers, [
			{ kind: 'volume', format, presentation: 'context', source: { kind: 'file', file } }
		]);
	}

	private async mountInitial(
		containers: ViewerContainers,
		assets: Parameters<Viewer3DSession['mount']>[1]
	): Promise<boolean> {
		this.stage = 'mounting';
		try {
			await this.viewer.mount(containers, assets);
			this.stage = 'ready';
			return true;
		} catch (err) {
			log.error('Initial mount failed', err);
			this.error = resolveErrorMessage(err, m.dx_viewer_3d_segmentation_failed());
			this.stage = 'error';
			return false;
		}
	}

	private async runCbctSegmentation(file: File): Promise<void> {
		const token = this.runToken;
		this.segStage = 'inferring';
		this.inferenceController = new AbortController();
		const signal = this.inferenceController.signal;
		const blob = await this.inferenceHandler.run(
			() => cbctSegInference(this.pb, file, { signal }),
			300_000,
			m.dx_viewer_3d_inference_timeout()
		);
		// Superseded by another load? Bail without touching state.
		if (token !== this.runToken) return;
		if (!blob) return this.flagSegmentationFailure(signal);
		this.segStage = 'mounting';
		try {
			const entries = await unzipBlob(blob);
			if (token !== this.runToken) return;
			const seg = findEntry(entries, '.gltf') ?? findEntry(entries, '.glb');
			if (!seg) throw new Error('CBCT response zip contained no .gltf/.glb segmentation');
			const segFile = new File([new Uint8Array(seg.bytes)], seg.name);
			await this.viewer.appendAsset({
				kind: 'gltf-segmentation',
				format: seg.name.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf',
				source: { kind: 'file', file: segFile },
				schema: ToothFairy3LabelSchema
			});
			if (token !== this.runToken) return;
			this.segStage = 'ready';
		} catch (err) {
			if (token !== this.runToken) return;
			log.error('CBCT segmentation mount failed', err);
			this.segError = resolveErrorMessage(err, m.dx_viewer_3d_segmentation_failed());
			this.segStage = 'error';
		}
	}

	private async runIosSegmentation(file: File): Promise<void> {
		const token = this.runToken;
		this.segStage = 'inferring';
		this.inferenceController = new AbortController();
		const signal = this.inferenceController.signal;
		const blob = await this.inferenceHandler.run(
			() => iosSegInference(this.pb, file, { signal }),
			300_000,
			m.dx_viewer_3d_inference_timeout()
		);
		if (token !== this.runToken) return;
		if (!blob) return this.flagSegmentationFailure(signal);
		this.segStage = 'mounting';
		try {
			const segFile = new File([blob], 'segmentation.glb');
			await this.viewer.appendAsset({
				kind: 'gltf-segmentation',
				format: 'glb',
				source: { kind: 'file', file: segFile },
				schema: ToothFairy3LabelSchema
			});
			if (token !== this.runToken) return;
			this.segStage = 'ready';
		} catch (err) {
			if (token !== this.runToken) return;
			log.error('IOS segmentation mount failed', err);
			this.segError = resolveErrorMessage(err, m.dx_viewer_3d_segmentation_failed());
			this.segStage = 'error';
		}
	}

	private flagSegmentationFailure(signal: AbortSignal): void {
		// Suppress the error UI when the abort was our own doing (user dropped
		// another file). Without this check, the cancelled run flashes a
		// "request aborted" error before the new run takes over the segStage.
		if (signal.aborted) {
			this.segStage = 'idle';
			return;
		}
		if (isApiPaywallError(this.inferenceHandler.error)) {
			this.segStage = 'paywall';
			return;
		}
		this.segError = this.inferenceHandler.error ?? m.dx_viewer_3d_inference_failed();
		this.segStage = 'error';
	}

	private resetState(): void {
		this.error = null;
		this.segError = null;
		this.segStage = 'idle';
		this.inferenceHandler.reset();
		// Cancel any in-flight inference from the previous file. Without this
		// the previous file's GLTF would be appendAsset()'d into the new
		// session's renderer at the wrong coordinates — and worse, the
		// previous file's runToken-stale state writes might race the new run.
		this.inferenceController?.abort(new Error('Superseded by new load'));
		this.inferenceController = null;
		this.runToken++;
	}

	dispose(): void {
		this.inferenceController?.abort(new Error('Disposed'));
		this.inferenceController = null;
		this.runToken++;
		this.viewer.dispose();
		this.stage = 'idle';
		this.error = null;
		this.segError = null;
		this.segStage = 'idle';
		this.kind = null;
		this.fileName = null;
		this.inferenceHandler.reset();
	}
}
