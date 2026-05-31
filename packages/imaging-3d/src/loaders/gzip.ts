import { ungzip } from 'pako';

/** Detect the gzip magic (0x1F 0x8B). */
export function isGzip(ab: ArrayBuffer): boolean {
	if (ab.byteLength < 2) return false;
	const v = new Uint8Array(ab, 0, 2);
	return v[0] === 0x1f && v[1] === 0x8b;
}

/**
 * Decompress a gzipped buffer. `pako.ungzip` returns a `Uint8Array` view that
 * may share backing memory; we copy out so the source buffer can be released.
 */
export function gunzipToArrayBuffer(ab: ArrayBuffer): ArrayBuffer {
	const inflated = ungzip(new Uint8Array(ab));
	return inflated.buffer.slice(inflated.byteOffset, inflated.byteOffset + inflated.byteLength);
}
