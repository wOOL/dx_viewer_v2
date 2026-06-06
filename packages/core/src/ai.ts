import { apiFetch, apiJson } from './pb';
import type { InferenceRequest, InferenceResponse, FindXrayResponse } from './types';

export async function findXray(imageBase64: string, conf_thres = 0.9): Promise<FindXrayResponse> {
	return apiJson<FindXrayResponse>('/api/ai/find_xray', {
		method: 'POST',
		body: JSON.stringify({ image_data: imageBase64, meta_data: { conf_thres } })
	});
}

export async function runInference(req: InferenceRequest): Promise<InferenceResponse> {
	return apiJson<InferenceResponse>('/api/ai/inference', {
		method: 'POST',
		body: JSON.stringify(req)
	});
}

export async function runCbctSeg(
	file: File,
	opts: { seg_only?: boolean; return_json?: boolean } = {},
	// D5: optional AbortSignal so the workspace can cancel this minutes-long BILLABLE
	// call when the user navigates away mid-run (the route remounts on {#key study.id}).
	// apiFetch forwards `signal` through to fetch; omitting it preserves prior behaviour.
	signal?: AbortSignal
): Promise<Blob> {
	const fd = new FormData();
	fd.append('input_file', file);
	fd.append('meta_data', JSON.stringify(opts));
	const res = await apiFetch('/api/ai/cbct_seg_inference', { method: 'POST', body: fd, signal });
	return res.blob();
}

export async function runIosSeg(file: File, signal?: AbortSignal): Promise<Blob> {
	const fd = new FormData();
	fd.append('input_file', file);
	fd.append('meta_data', JSON.stringify({}));
	const res = await apiFetch('/api/ai/ios_seg_inference', { method: 'POST', body: fd, signal });
	return res.blob();
}

export function countFindings(inf: InferenceResponse): Record<string, number> {
	const out: Record<string, number> = {};
	// A complete inference always carries disease/number results, but a partial or
	// malformed AI response (the #68 class) must NOT throw here: countFindings runs
	// in the upload flow as an argument to addStudy(), AFTER the patient has been
	// created — so a throw would both discard an otherwise-successful inference and
	// strand the just-created patient with 0 studies (the #40 orphan). Guard every
	// access (the consumers in FindingsPanel/XrayCanvas were already hardened by
	// #68; this sibling was missed) and degrade to partial counts.
	const diseaseLabels = inf?.extra?.disease_result?.result?.labels ?? [];
	for (const l of diseaseLabels) {
		const key = `dz_${l}`;
		out[key] = (out[key] ?? 0) + 1;
	}
	out.toothCount = inf?.extra?.number_result?.result?.labels?.length ?? 0;
	return out;
}
