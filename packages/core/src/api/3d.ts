import { authHeaders, type PBClient } from './client.js';
import { logger } from '../logger/index.js';
import type { CbctSegMetaData } from '../types/index.js';

const log = logger.scoped('api-3d');

/** Upstream proxy timeout for 3D inference endpoints (PB_Backend.md §6.3 / 6.4). */
const DEFAULT_3D_TIMEOUT_MS = 300_000;

export interface CbctSegOptions {
	/** Include `input_mesh.obj` alongside `pred_seg.gltf` in the response zip. Default true (seg only). */
	segOnly?: boolean;
	/** Return raw RGB voxel array (`results.json`) instead of `pred_seg.gltf`. Default false. */
	returnJson?: boolean;
	/** Override the default 300s timeout (ms). */
	timeoutMs?: number;
	/** Optional AbortSignal — composed with the timeout. */
	signal?: AbortSignal;
}

export interface IosSegOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

/**
 * `POST /api/ai/cbct_seg_inference` — volumetric CBCT segmentation.
 * Accepts `.nii.gz`, `.nrrd`, `.mha`, or `.gipl`. Returns a zip blob.
 */
export async function cbctSegInference(pb: PBClient, file: File | Blob, options: CbctSegOptions = {}): Promise<Blob> {
	const stop = logger.time('api-3d', 'cbctSegInference');
	const meta: CbctSegMetaData = {
		seg_only: options.segOnly ?? true,
		return_json: options.returnJson ?? false
	};
	const fd = new FormData();
	fd.append('input_file', file);
	fd.append('meta_data', JSON.stringify(meta));

	log.info('cbctSegInference start', { size: file.size, meta });
	const blob = await postMultipart(pb, '/api/ai/cbct_seg_inference', fd, options.timeoutMs ?? DEFAULT_3D_TIMEOUT_MS, options.signal);
	stop({ outSize: blob.size });
	return blob;
}

/**
 * `POST /api/ai/ios_seg_inference` — intra-oral scan mesh segmentation.
 * Accepts `.obj`, `.stl`, or `.ply`. Returns a binary `.glb` blob.
 */
export async function iosSegInference(pb: PBClient, file: File | Blob, options: IosSegOptions = {}): Promise<Blob> {
	const stop = logger.time('api-3d', 'iosSegInference');
	const fd = new FormData();
	fd.append('input_file', file);

	log.info('iosSegInference start', { size: file.size });
	const blob = await postMultipart(pb, '/api/ai/ios_seg_inference', fd, options.timeoutMs ?? DEFAULT_3D_TIMEOUT_MS, options.signal);
	stop({ outSize: blob.size });
	return blob;
}

async function postMultipart(
	pb: PBClient,
	path: string,
	body: FormData,
	timeoutMs: number,
	externalSignal?: AbortSignal
): Promise<Blob> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);
	const onExternalAbort = () => controller.abort(externalSignal!.reason);
	if (externalSignal) {
		if (externalSignal.aborted) controller.abort(externalSignal.reason);
		else externalSignal.addEventListener('abort', onExternalAbort);
	}

	try {
		// Normalise the join: PocketBase's baseUrl may end with `/`, and `path` starts with `/`.
		// A double slash here triggers a 301 redirect that CORS preflight cannot follow.
		const base = pb.baseUrl.endsWith('/') ? pb.baseUrl.slice(0, -1) : pb.baseUrl;
		const res = await fetch(`${base}${path}`, {
			method: 'POST',
			headers: authHeaders(pb),
			body,
			signal: controller.signal
		});
		if (!res.ok) throw await parseApiError(res);
		return await res.blob();
	} finally {
		clearTimeout(timeoutId);
		externalSignal?.removeEventListener('abort', onExternalAbort);
	}
}

/**
 * Parse a non-2xx response into a thrown Error that mimics PocketBase's
 * `ClientResponseError` shape — so `resolveErrorMessage` and
 * `isApiPaywallError` work uniformly across the 2D (pb.send) and 3D (fetch)
 * code paths. Known status codes get human-readable messages so the UI can
 * surface something actionable.
 */
async function parseApiError(res: Response): Promise<Error> {
	let body: unknown = null;
	try {
		const ct = res.headers.get('content-type') ?? '';
		body = ct.includes('json') ? await res.json() : await res.text();
	} catch {
		// ignore
	}
	const upstream =
		typeof body === 'object' && body !== null && 'message' in body && typeof (body as { message: unknown }).message === 'string'
			? (body as { message: string }).message
			: null;
	const message = upstream ?? friendlyStatusMessage(res.status);
	const err = new Error(message) as Error & { status: number; response: unknown };
	err.status = res.status;
	err.response = body;
	return err;
}

/**
 * Map common HTTP failures to actionable copy. 403 paywall messages come
 * straight from the upstream body (caught above) so the paywall guard can
 * match them — only "no upstream body" cases fall here.
 */
function friendlyStatusMessage(status: number): string {
	if (status === 401) return 'Authentication required. Sign in again to continue.';
	if (status === 403) return 'You are not authorised to use this endpoint.';
	if (status === 413) return 'File too large for the AI service. Try a smaller file, compress it, or contact support if you believe this is in error.';
	if (status === 415) return 'Unsupported file type for this endpoint.';
	if (status === 429) return 'Too many requests. Please wait a moment and try again.';
	if (status === 502 || status === 503 || status === 504) return 'The AI service is temporarily unavailable. Please retry shortly.';
	if (status >= 500) return 'The server hit an unexpected error. Please try again or contact support.';
	return `Request failed (${status})`;
}
