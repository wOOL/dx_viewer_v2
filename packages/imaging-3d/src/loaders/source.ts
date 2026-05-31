import { DxViewerError, ERROR_CODES, type SourceLocator } from '../types/index.js';

export type ProgressFn = (fraction: number) => void;

/**
 * Read bytes from a typed SourceLocator with progress reporting.
 * URL: fetch + stream; File: Blob.stream(). Same chunk loop drains both.
 *
 * Ported from `viewer-3d.js` lines 175–218.
 */
export async function readBytes(source: SourceLocator, onProgress: ProgressFn = noopProgress): Promise<ArrayBuffer> {
	if (source.kind === 'url') return readBytesFromUrl(source.url, onProgress);
	if (source.kind === 'file') return readBytesFromBlob(source.file, onProgress);
	throw new DxViewerError(ERROR_CODES.INVALID_SOURCE, `Unknown source.kind '${(source as { kind: string }).kind}'`, { source });
}

async function readBytesFromUrl(url: string, onProgress: ProgressFn): Promise<ArrayBuffer> {
	let resp: Response;
	try {
		resp = await fetch(url);
	} catch (err) {
		throw new DxViewerError(
			ERROR_CODES.NETWORK_ERROR,
			`Network error fetching ${url}: ${(err as Error).message}`,
			{ url, cause: err }
		);
	}
	if (!resp.ok) {
		throw new DxViewerError(ERROR_CODES.NETWORK_ERROR, `HTTP ${resp.status} for ${url}`, { url, status: resp.status });
	}
	const total = parseInt(resp.headers.get('Content-Length') ?? '0', 10);
	if (!resp.body) {
		// Some test harnesses give a Response without a streaming body; fall back to .arrayBuffer().
		const buf = await resp.arrayBuffer();
		onProgress(1);
		return buf;
	}
	return drainStream(resp.body, total, onProgress);
}

function readBytesFromBlob(blob: Blob, onProgress: ProgressFn): Promise<ArrayBuffer> {
	return drainStream(blob.stream() as ReadableStream<Uint8Array>, blob.size, onProgress);
}

async function drainStream(stream: ReadableStream<Uint8Array>, total: number, onProgress: ProgressFn): Promise<ArrayBuffer> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.byteLength;
		if (total > 0) onProgress(received / total);
	}
	const out = new Uint8Array(received);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	chunks.length = 0; // release intermediate references for GC
	return out.buffer;
}

function noopProgress(_: number): void {
	// no-op
}
