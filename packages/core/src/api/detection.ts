import PocketBase from 'pocketbase';
import { logger } from '../logger/index.js';
import type { AnalysisResponse, InferenceMetaData, InferenceRequest, XrayResponse } from '../types/index.js';
import { stripBase64Prefix } from '../utils/image.js';

const log = logger.scoped('api');

const DEFAULT_FIND_XRAY_CONF = 0.9;

const DEFAULT_INFERENCE_META: InferenceMetaData = {
	ensure_dim: true,
	disease_segment: true,
	disease_meta_data: { conf_thres: 0.1 },
	number_meta_data: { conf_thres: 0.1, fdi_number: false },
	anatomy_meta_data: { conf_thres: 0.3 }
};

/**
 * Send a captured image to the AI backend to locate X-ray regions.
 *
 * Pass an `AbortSignal` to let the caller cancel the underlying fetch when a
 * new analysis supersedes this one — PocketBase's `send()` extends
 * `RequestInit`, so the signal is forwarded directly to `fetch`. Aborted
 * requests reject with a `ClientResponseError` carrying `isAbort: true`.
 */
export async function findXRay(
	pb: PocketBase,
	imageBase64: string,
	confThres = DEFAULT_FIND_XRAY_CONF,
	signal?: AbortSignal
): Promise<XrayResponse> {
	log.info('findXRay called', { confThres });
	const stop = logger.time('api', 'findXRay');
	const result = await pb.send('/api/ai/find_xray', {
		method: 'POST',
		body: {
			image_data: stripBase64Prefix(imageBase64),
			meta_data: { conf_thres: confThres }
		},
		signal
	});
	stop({ xrayFound: result.extra?.xrayfound });
	return result;
}

/**
 * Run disease classification inference on an extracted X-ray image.
 * See `findXRay` for details on the `signal` parameter.
 */
export async function getInference(
	pb: PocketBase,
	imageBase64: string,
	metaOverrides?: Partial<InferenceMetaData>,
	signal?: AbortSignal
): Promise<AnalysisResponse> {
	log.info('getInference called', { hasOverrides: !!metaOverrides });
	const stop = logger.time('api', 'getInference');
	const body: InferenceRequest = {
		image_data: stripBase64Prefix(imageBase64),
		meta_data: { ...DEFAULT_INFERENCE_META, ...metaOverrides }
	};
	const result = await pb.send<AnalysisResponse>('/api/ai/inference', {
		method: 'POST',
		body,
		signal
	});
	log.debug('getInference raw response keys', { keys: Object.keys(result), result });
	stop({ diseaseCount: result.extra?.disease_result?.result?.labels?.length });
	return result;
}
