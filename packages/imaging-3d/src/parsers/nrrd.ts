import { gunzipToArrayBuffer } from '../loaders/gzip.js';
import { DxViewerError, ERROR_CODES } from '../types/index.js';
import { IDENTITY_DIRECTION, type Affine } from './nifti.js';

/**
 * NRRD parser. ASCII header lines terminated by `\n\n`, then binary payload.
 * Supports `encoding: raw` and `encoding: gzip` only. Big-endian rejected.
 *
 * Ported from `viewer-3d.js` lines 462–560.
 */

type TypedArrayConstructor =
	| Int8ArrayConstructor
	| Uint8ArrayConstructor
	| Int16ArrayConstructor
	| Uint16ArrayConstructor
	| Int32ArrayConstructor
	| Uint32ArrayConstructor
	| Float32ArrayConstructor
	| Float64ArrayConstructor;

interface NrrdTypeEntry {
	name: string;
	bytesPerSample: number;
	ctor: TypedArrayConstructor;
}

const NRRD_TYPE_MAP: Record<string, NrrdTypeEntry> = {
	'signed char': { name: 'int8', bytesPerSample: 1, ctor: Int8Array },
	int8: { name: 'int8', bytesPerSample: 1, ctor: Int8Array },
	int8_t: { name: 'int8', bytesPerSample: 1, ctor: Int8Array },
	uchar: { name: 'uint8', bytesPerSample: 1, ctor: Uint8Array },
	'unsigned char': { name: 'uint8', bytesPerSample: 1, ctor: Uint8Array },
	uint8: { name: 'uint8', bytesPerSample: 1, ctor: Uint8Array },
	uint8_t: { name: 'uint8', bytesPerSample: 1, ctor: Uint8Array },
	short: { name: 'int16', bytesPerSample: 2, ctor: Int16Array },
	'short int': { name: 'int16', bytesPerSample: 2, ctor: Int16Array },
	'signed short': { name: 'int16', bytesPerSample: 2, ctor: Int16Array },
	int16: { name: 'int16', bytesPerSample: 2, ctor: Int16Array },
	int16_t: { name: 'int16', bytesPerSample: 2, ctor: Int16Array },
	ushort: { name: 'uint16', bytesPerSample: 2, ctor: Uint16Array },
	'unsigned short': { name: 'uint16', bytesPerSample: 2, ctor: Uint16Array },
	uint16: { name: 'uint16', bytesPerSample: 2, ctor: Uint16Array },
	uint16_t: { name: 'uint16', bytesPerSample: 2, ctor: Uint16Array },
	int: { name: 'int32', bytesPerSample: 4, ctor: Int32Array },
	int32: { name: 'int32', bytesPerSample: 4, ctor: Int32Array },
	int32_t: { name: 'int32', bytesPerSample: 4, ctor: Int32Array },
	uint: { name: 'uint32', bytesPerSample: 4, ctor: Uint32Array },
	uint32: { name: 'uint32', bytesPerSample: 4, ctor: Uint32Array },
	uint32_t: { name: 'uint32', bytesPerSample: 4, ctor: Uint32Array },
	float: { name: 'float32', bytesPerSample: 4, ctor: Float32Array },
	double: { name: 'float64', bytesPerSample: 8, ctor: Float64Array }
};

export interface ParsedNrrd {
	format: 'nrrd';
	dims: [number, number, number];
	spacing: [number, number, number];
	typedArray: ArrayBufferView;
	meta: Record<string, string>;
}

/** Spacing must be positive — vtk affine math divides by it. */
function safeSpacing(n: number): number {
	return Number.isFinite(n) && n > 0 ? n : 1;
}

export function parseNrrd(ab: ArrayBuffer): ParsedNrrd {
	const bytes = new Uint8Array(ab);
	let hdrEnd = -1;
	for (let i = 0; i < bytes.length - 1; i++) {
		if (bytes[i] === 0x0a && bytes[i + 1] === 0x0a) {
			hdrEnd = i;
			break;
		}
	}
	if (hdrEnd === -1) {
		throw new DxViewerError(ERROR_CODES.NOT_AN_NRRD_FILE, 'No header terminator found');
	}
	const headerText = new TextDecoder('ascii').decode(bytes.subarray(0, hdrEnd));
	if (!headerText.startsWith('NRRD')) {
		throw new DxViewerError(ERROR_CODES.NOT_AN_NRRD_FILE, "Header does not start with 'NRRD' magic");
	}
	const meta: Record<string, string> = {};
	for (const raw of headerText.split('\n').slice(1)) {
		if (!raw || raw.startsWith('#')) continue;
		const ci = raw.indexOf(':');
		if (ci === -1) continue;
		const key = raw.slice(0, ci).trim().toLowerCase();
		meta[key] = raw.slice(ci + 1).trim();
	}
	const type = meta['type'];
	if (!type || !NRRD_TYPE_MAP[type]) {
		throw new DxViewerError(ERROR_CODES.UNSUPPORTED_DATATYPE, `NRRD type '${type ?? '<missing>'}' not supported`, { type });
	}
	const sizes = meta['sizes'];
	if (!sizes) {
		throw new DxViewerError(ERROR_CODES.NOT_AN_NRRD_FILE, "Missing 'sizes' field");
	}
	const dimsArr = sizes.split(/\s+/).map(Number);
	if (dimsArr.length !== 3) {
		throw new DxViewerError(ERROR_CODES.NOT_AN_NRRD_FILE, `Only 3D NRRD volumes supported (got ${dimsArr.length}D)`, {
			dims: dimsArr
		});
	}
	const dims: [number, number, number] = [dimsArr[0]!, dimsArr[1]!, dimsArr[2]!];

	let spacing: [number, number, number] = [1, 1, 1];
	const spaceDirs = meta['space directions'];
	if (spaceDirs) {
		const vectors = [...spaceDirs.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.split(',').map(Number));
		if (vectors.length === 3) {
			const [v0, v1, v2] = vectors as [number[], number[], number[]];
			spacing = [
				safeSpacing(Math.hypot(v0[0] ?? 0, v0[1] ?? 0, v0[2] ?? 0)),
				safeSpacing(Math.hypot(v1[0] ?? 0, v1[1] ?? 0, v1[2] ?? 0)),
				safeSpacing(Math.hypot(v2[0] ?? 0, v2[1] ?? 0, v2[2] ?? 0))
			];
		}
	} else if (meta['spacings']) {
		const s = meta['spacings'].split(/\s+/).map(Number);
		spacing = [safeSpacing(s[0] ?? 1), safeSpacing(s[1] ?? 1), safeSpacing(s[2] ?? 1)];
	}

	const encoding = (meta['encoding'] ?? 'raw').toLowerCase();
	const endian = (meta['endian'] ?? 'little').toLowerCase();
	if (endian !== 'little') {
		throw new DxViewerError(ERROR_CODES.UNSUPPORTED_DATATYPE, 'Big-endian NRRD not supported', { endian });
	}

	let payload = ab.slice(hdrEnd + 2);
	if (encoding === 'gzip' || encoding === 'gz') {
		payload = gunzipToArrayBuffer(payload);
	} else if (encoding !== 'raw') {
		throw new DxViewerError(
			ERROR_CODES.UNSUPPORTED_DATATYPE,
			`NRRD encoding '${encoding}' not supported (only 'raw' and 'gzip')`,
			{ encoding }
		);
	}

	const entry = NRRD_TYPE_MAP[type]!;
	const expected = dims[0] * dims[1] * dims[2] * entry.bytesPerSample;
	if (payload.byteLength < expected) {
		throw new DxViewerError(
			ERROR_CODES.NOT_AN_NRRD_FILE,
			`NRRD payload too small: got ${payload.byteLength} bytes, expected ${expected}`,
			{ got: payload.byteLength, expected }
		);
	}
	const typedArray = new entry.ctor(payload, 0, dims[0] * dims[1] * dims[2]) as ArrayBufferView;
	return { format: 'nrrd', dims, spacing, typedArray, meta };
}

/**
 * Decompose NRRD metadata into a `direction`, `origin`, `spacing` triple in
 * a canonical RAS world frame. NRRD's `space` field can be LPS (DICOM
 * default), RAS, LAS, etc. — without normalisation, files in different
 * conventions render mirrored relative to each other.
 *
 * Ported from `viewer-3d.js` lines 402–449.
 */
export function computeNrrdAffine(meta: Record<string, string>): Affine {
	let direction = IDENTITY_DIRECTION.slice();
	let origin: [number, number, number] = [0, 0, 0];
	let spacing: [number, number, number] = [1, 1, 1];
	let source: Affine['source'] = 'identity';

	const spaceDirs = meta['space directions'];
	if (spaceDirs) {
		const vectors = [...spaceDirs.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.split(',').map(Number));
		if (vectors.length === 3) {
			const [c0, c1, c2] = vectors as [number[], number[], number[]];
			spacing = [
				Math.hypot(c0[0] ?? 0, c0[1] ?? 0, c0[2] ?? 0),
				Math.hypot(c1[0] ?? 0, c1[1] ?? 0, c1[2] ?? 0),
				Math.hypot(c2[0] ?? 0, c2[1] ?? 0, c2[2] ?? 0)
			];
			const safe = (n: number) => (n > 0 ? n : 1);
			direction = [
				(c0[0] ?? 0) / safe(spacing[0]), (c1[0] ?? 0) / safe(spacing[1]), (c2[0] ?? 0) / safe(spacing[2]),
				(c0[1] ?? 0) / safe(spacing[0]), (c1[1] ?? 0) / safe(spacing[1]), (c2[1] ?? 0) / safe(spacing[2]),
				(c0[2] ?? 0) / safe(spacing[0]), (c1[2] ?? 0) / safe(spacing[1]), (c2[2] ?? 0) / safe(spacing[2])
			];
			source = 'space-directions';
		}
	} else if (meta['spacings']) {
		const s = meta['spacings'].split(/\s+/).map(Number);
		spacing = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1];
	}

	const spaceOrigin = meta['space origin'];
	if (spaceOrigin) {
		const m = spaceOrigin.match(/\(([^)]+)\)/);
		if (m) {
			const o = m[1]!.split(',').map(Number);
			origin = [o[0] ?? 0, o[1] ?? 0, o[2] ?? 0];
		}
	}

	const space = (meta['space'] ?? '').toLowerCase();
	const flipX = space.startsWith('left') || space.includes('left-');
	const flipY = space.includes('posterior');
	if (flipX) {
		direction[0] = -direction[0]!;
		direction[1] = -direction[1]!;
		direction[2] = -direction[2]!;
		origin[0] = -origin[0];
	}
	if (flipY) {
		direction[3] = -direction[3]!;
		direction[4] = -direction[4]!;
		direction[5] = -direction[5]!;
		origin[1] = -origin[1];
	}

	return { direction, origin, spacing, source };
}
