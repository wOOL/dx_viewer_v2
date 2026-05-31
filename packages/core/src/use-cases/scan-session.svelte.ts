import PocketBase from 'pocketbase';
import { findXRay, getInference } from '../api/detection.js';
import { AsyncHandler, isAbortError } from '../async/handler.svelte.js';
import { resolveErrorMessage } from '../errors/index.js';
import { logger } from '../logger/index.js';
import { DISEASE_LABELS, type AnalysisResponse, type DiseaseLabel, type InferenceMetaData, type XrayFinding, type XrayResponse } from '../types/index.js';
import { captureScreenAsDataUrl, extractXRayRegion } from '../utils/index.js';

const log = logger.scoped('scan');

export type ScanStep = 'idle' | 'capturing' | 'analyzing' | 'annotating' | 'complete';

/**
 * Localised messages used as fallbacks when the underlying error has no useful
 * message. Apps inject their own (paraglide etc.); sane English defaults are
 * provided so the class works standalone.
 */
export interface ScanSessionMessages {
	captureFailed: () => string;
	errorTimeout: () => string;
	noXrayFound: () => string;
	analysisFailed: () => string;
}

const defaultMessages: ScanSessionMessages = {
	captureFailed: () => 'Failed to capture image',
	errorTimeout: () => 'The operation timed out',
	noXrayFound: () => 'No X-ray detected in the image',
	analysisFailed: () => 'Analysis failed'
};

/**
 * Orchestrates capture → find_xray → inference pipeline.
 *
 * Reactive via Svelte 5 runes. Use the same class from any SvelteKit app:
 *
 *   const session = new ScanSession(pb, { captureFailed: m.capture_failed, … });
 *   await session.startCapture();
 *   if (session.step === 'complete') render(session.findings);
 */
export class ScanSession {
	private pb: PocketBase;
	private messages: ScanSessionMessages;
	private getInferenceOverrides?: () => Partial<InferenceMetaData> | undefined;

	step = $state<ScanStep>('idle');
	capturedImage = $state<string | null>(null);
	croppedImage = $state<string | null>(null);
	annotatedImage = $state<string | null>(null);
	analysis = $state<AnalysisResponse | null>(null);
	findings = $state<XrayFinding[]>([]);
	error = $state<string | null>(null);
	/** File name when loaded via `loadFromFile`; null for screen-capture runs. */
	fileName = $state<string | null>(null);

	captureHandler = new AsyncHandler<string>();
	analysisHandler = new AsyncHandler<XrayResponse>();
	annotationHandler = new AsyncHandler<AnalysisResponse>();

	/**
	 * Monotonic counter incremented at the start of every run (and on reset).
	 * Each async stage checks `if (epoch !== this.runEpoch) return` after its
	 * await — stale responses from a previous upload silently lose to the
	 * newer run instead of clobbering the UI.
	 */
	private runEpoch = 0;

	/**
	 * AbortController for the currently-active analysis run. Aborted on every
	 * new run + on `reset()` so an in-flight `/api/ai/find_xray` or
	 * `/api/ai/inference` fetch is torn down at the network layer rather than
	 * left running to its natural conclusion. The `runEpoch` check still
	 * applies — abort is the bandwidth-saving half, epoch is the correctness
	 * half.
	 */
	private inflight: AbortController | null = null;

	private newRun(): { epoch: number; signal: AbortSignal } {
		this.inflight?.abort();
		const controller = new AbortController();
		this.inflight = controller;
		const epoch = ++this.runEpoch;
		return { epoch, signal: controller.signal };
	}

	/**
	 * @param inferenceOverrides Called immediately before each `getInference`
	 * request so the returned object can reflect live user preferences.
	 */
	constructor(
		pb: PocketBase,
		messages: Partial<ScanSessionMessages> = {},
		inferenceOverrides?: () => Partial<InferenceMetaData> | undefined
	) {
		this.pb = pb;
		this.messages = { ...defaultMessages, ...messages };
		this.getInferenceOverrides = inferenceOverrides;
	}

	async startCapture(): Promise<void> {
		const { epoch, signal } = this.newRun();
		this.error = null;
		this.step = 'capturing';
		log.info('Starting capture');

		try {
			const imageData = await captureScreenAsDataUrl();
			if (epoch !== this.runEpoch) return;
			log.debug('Image captured successfully');
			this.capturedImage = imageData;
			await this.analyze(imageData, epoch, signal);
		} catch (e: unknown) {
			if (epoch !== this.runEpoch || isAbortError(e)) return;
			log.error('Capture failed', e);
			this.error = resolveErrorMessage(e, this.messages.captureFailed());
			this.step = 'idle';
		}
	}

	/**
	 * Skip the capture step and run analysis on a pre-captured data URL. The
	 * dashboard's "Capture from window" button uses this — it does the capture
	 * inside the click handler so the browser's user-gesture requirement for
	 * `getDisplayMedia` is preserved, then hands the data URL off to the viewer.
	 */
	async analyzeFromDataUrl(dataUrl: string): Promise<void> {
		const { epoch, signal } = this.newRun();
		this.error = null;
		this.step = 'analyzing';
		this.capturedImage = dataUrl;
		await this.analyze(dataUrl, epoch, signal);
	}

	/**
	 * Run the analysis pipeline starting from a user-supplied file. Mirrors
	 * `startCapture()` but reads the file via `FileReader` instead of going
	 * through screen capture. The dashboard's file-handoff flow calls this.
	 */
	async loadFromFile(file: File): Promise<void> {
		const { epoch, signal } = this.newRun();
		this.error = null;
		this.step = 'analyzing';
		this.fileName = file.name;
		log.info('Loading file', { name: file.name, size: file.size, type: file.type });

		try {
			const imageData = await readFileAsDataUrl(file);
			if (epoch !== this.runEpoch) return;
			this.capturedImage = imageData;
			await this.analyze(imageData, epoch, signal);
		} catch (e: unknown) {
			if (epoch !== this.runEpoch || isAbortError(e)) return;
			log.error('File load failed', e);
			this.error = resolveErrorMessage(e, this.messages.captureFailed());
			this.step = 'idle';
		}
	}

	private async analyze(imageData: string, epoch: number, signal: AbortSignal): Promise<void> {
		this.step = 'analyzing';
		log.info('Analyzing image for X-ray');
		const stop = logger.time('scan', 'analyze');

		const xrayResult = await this.analysisHandler.run(
			() => findXRay(this.pb, imageData, undefined, signal),
			30_000,
			this.messages.errorTimeout()
		);
		if (epoch !== this.runEpoch || signal.aborted) return;

		if (!xrayResult?.extra.xrayfound || !xrayResult.result) {
			log.warn('No X-ray found in image');
			this.error = this.analysisHandler.error ?? this.messages.noXrayFound();
			this.step = 'idle';
			return;
		}

		log.debug('X-ray detected, cropping region');
		const croppedImage = await extractXRayRegion(imageData, xrayResult.result, xrayResult.extra);
		if (epoch !== this.runEpoch || signal.aborted) return;
		this.croppedImage = croppedImage;
		stop();
		await this.annotate(croppedImage, epoch, signal);
	}

	private async annotate(croppedImage: string, epoch: number, signal: AbortSignal): Promise<void> {
		this.step = 'annotating';
		log.info('Running inference');
		const stop = logger.time('scan', 'annotate');

		const overrides = this.getInferenceOverrides?.();
		const result = await this.annotationHandler.run(
			() => getInference(this.pb, croppedImage, overrides, signal),
			60_000,
			this.messages.errorTimeout()
		);
		if (epoch !== this.runEpoch || signal.aborted) return;

		if (!result) {
			// AsyncHandler returns null on both genuine errors AND aborts; we
			// already filtered aborts above via `signal.aborted`, so anything
			// that lands here is a real failure.
			log.error('Annotation failed', this.annotationHandler.error);
			this.error = this.annotationHandler.error ?? this.messages.analysisFailed();
			this.step = 'idle';
			return;
		}

		this.analysis = result;
		this.annotatedImage = result.detection;
		const diseases = result.extra.disease_result.result;
		this.findings = diseases.bboxes.map((bbox, i) => ({
			disease: DISEASE_LABELS[diseases.labels[i] as DiseaseLabel] ?? 'Unknown',
			confidence: diseases.scores[i] ?? 0,
			bbox: bbox as [number, number, number, number]
		}));
		log.info('Scan complete', { findings: this.findings.length });
		stop();
		this.step = 'complete';
	}

	reset(): void {
		log.debug('Session reset');
		// Tear down any in-flight request — both for bandwidth and to make sure
		// PocketBase's auto-cancel doesn't cancel a fresh run started after us.
		this.inflight?.abort();
		this.inflight = null;
		this.runEpoch++;
		this.step = 'idle';
		this.capturedImage = null;
		this.croppedImage = null;
		this.annotatedImage = null;
		this.analysis = null;
		this.findings = [];
		this.error = null;
		this.fileName = null;
		this.captureHandler.reset();
		this.analysisHandler.reset();
		this.annotationHandler.reset();
	}
}

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
		reader.readAsDataURL(file);
	});
}
