/// <reference path="./pako.d.ts" />
// Client-side parsing of CBCT volumes (.nii, .nii.gz, .nrrd) into a uniform
// shape we can render with a canvas-based MPR viewer.
//
// We use nifti-reader-js for NIfTI, nrrd-js for NRRD, and pako for gzip.
// The output is a typed-array volume + dimensions + voxel spacing.

import * as nifti from 'nifti-reader-js';
// @ts-expect-error nrrd-js has no types
import * as nrrdJs from 'nrrd-js';
import pako from 'pako';

export interface Volume {
	data: Float32Array;
	dims: [number, number, number]; // X Y Z (i j k)
	spacing: [number, number, number]; // mm
	min: number;
	max: number;
	// Suggested window/level for visualisation
	defaultWindow: number;
	defaultLevel: number;
}

// Upper bound on total voxels we'll accept from a header. A degenerate header
// (a 0 / negative / non-integer dimension) yields a width*height === 0 slice
// that the MPR panes render as a silent black frame with NO error; an absurd
// product would attempt a multi-GB typed-array allocation. We validate dims
// right after parsing and THROW so the existing `cbct.volumeParseFailed` banner
// (CbctWorkspace's loadVolumeFromBlob catch) surfaces it. 1e9 voxels is a sane
// ceiling — far above any real CBCT (a 1024³ volume is ~1.07e9, already absurd
// for a dental scan) yet bounded.
const MAX_VOXELS = 1_000_000_000;

function validateDims(dims: [number, number, number]): void {
	const [nx, ny, nz] = dims;
	for (const d of dims) {
		if (!Number.isInteger(d) || d <= 0) {
			throw new Error(
				`Invalid volume dimensions ${nx}×${ny}×${nz} (each must be a positive integer)`
			);
		}
	}
	// nx/ny/nz are positive integers here, so the product is exact and positive.
	if (nx * ny * nz > MAX_VOXELS) {
		throw new Error(
			`Volume too large: ${nx}×${ny}×${nz} = ${nx * ny * nz} voxels exceeds the ${MAX_VOXELS} cap`
		);
	}
}

function suggestWindow(data: Float32Array): { window: number; level: number } {
	// Compute a robust window by sampling and using 1st/99th percentile.
	const sampleCount = Math.min(100_000, data.length);
	const stride = Math.max(1, Math.floor(data.length / sampleCount));
	const samples: number[] = [];
	for (let i = 0; i < data.length; i += stride) samples.push(data[i]);
	samples.sort((a, b) => a - b);
	const lo = samples[Math.floor(samples.length * 0.01)];
	const hi = samples[Math.floor(samples.length * 0.99)];
	const window = Math.max(1, hi - lo);
	const level = (lo + hi) / 2;
	return { window, level };
}

function statsAndWindow(data: Float32Array) {
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (v < min) min = v;
		if (v > max) max = v;
	}
	const { window, level } = suggestWindow(data);
	return { min, max, defaultWindow: window, defaultLevel: level };
}

async function readArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
	return await blob.arrayBuffer();
}

function isGz(buf: ArrayBuffer): boolean {
	const v = new Uint8Array(buf);
	return v.length > 2 && v[0] === 0x1f && v[1] === 0x8b;
}

function decompressIfGz(buf: ArrayBuffer): ArrayBuffer {
	if (!isGz(buf)) return buf;
	const out = pako.ungzip(new Uint8Array(buf));
	return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function toFloat32(typed: ArrayLike<number> & ArrayBufferView): Float32Array {
	if (typed instanceof Float32Array) return typed;
	const out = new Float32Array(typed.length);
	for (let i = 0; i < typed.length; i++) out[i] = typed[i] as number;
	return out;
}

async function parseNifti(buf: ArrayBuffer): Promise<Volume> {
	const decompressed = decompressIfGz(buf);
	if (!nifti.isNIFTI(decompressed)) throw new Error('Not a NIfTI file');
	const header = nifti.readHeader(decompressed);
	if (!header) throw new Error('NIfTI header parse failed');
	const image = nifti.readImage(header, decompressed);

	let typed: ArrayLike<number> & ArrayBufferView;
	switch (header.datatypeCode) {
		case nifti.NIFTI1.TYPE_INT8:
			typed = new Int8Array(image);
			break;
		case nifti.NIFTI1.TYPE_UINT8:
			typed = new Uint8Array(image);
			break;
		case nifti.NIFTI1.TYPE_INT16:
			typed = new Int16Array(image);
			break;
		case nifti.NIFTI1.TYPE_UINT16:
			typed = new Uint16Array(image);
			break;
		case nifti.NIFTI1.TYPE_INT32:
			typed = new Int32Array(image);
			break;
		case nifti.NIFTI1.TYPE_UINT32:
			typed = new Uint32Array(image);
			break;
		case nifti.NIFTI1.TYPE_FLOAT32:
			typed = new Float32Array(image);
			break;
		case nifti.NIFTI1.TYPE_FLOAT64:
			typed = new Float64Array(image);
			break;
		default:
			throw new Error(`Unsupported NIfTI datatype ${header.datatypeCode}`);
	}
	const dims: [number, number, number] = [header.dims[1], header.dims[2], header.dims[3]];
	validateDims(dims);
	const data = toFloat32(typed);
	const spacing: [number, number, number] = [
		header.pixDims[1] || 1,
		header.pixDims[2] || 1,
		header.pixDims[3] || 1
	];
	const stats = statsAndWindow(data);
	return { data, dims, spacing, ...stats };
}

async function parseNrrd(buf: ArrayBuffer): Promise<Volume> {
	const parsed: {
		dimension?: number;
		sizes: number[];
		spacings?: number[];
		spaceDirections?: (number[] | null)[];
		buffer: ArrayBuffer | ArrayLike<number>;
		data?: ArrayBufferView; // some forks expose `data`
		type: string; // 'uint8', 'int16', etc.
	} = nrrdJs.parse(decompressIfGz(buf));
	const sizes = parsed.sizes;
	if (sizes.length < 3) throw new Error('NRRD must have 3 dimensions');
	const dims: [number, number, number] = [sizes[0], sizes[1], sizes[2]];
	validateDims(dims);
	let spacing: [number, number, number] = [1, 1, 1];
	if (parsed.spacings && parsed.spacings.length >= 3) {
		spacing = [parsed.spacings[0] || 1, parsed.spacings[1] || 1, parsed.spacings[2] || 1];
	} else if (parsed.spaceDirections) {
		const sp = parsed.spaceDirections;
		spacing = [
			sp[0] ? Math.hypot(...(sp[0] as number[])) : 1,
			sp[1] ? Math.hypot(...(sp[1] as number[])) : 1,
			sp[2] ? Math.hypot(...(sp[2] as number[])) : 1
		];
	}
	// nrrd-js returns `buffer` as ArrayBuffer (raw bytes). Wrap in a typed view
	// keyed off `parsed.type`.
	const rawBuf = parsed.buffer as ArrayBuffer;
	const t = (parsed.type || 'uint8').toLowerCase();
	let typed: ArrayBufferView & ArrayLike<number>;
	switch (t) {
		case 'int8':
			typed = new Int8Array(rawBuf);
			break;
		case 'uint8':
		case 'uchar':
			typed = new Uint8Array(rawBuf);
			break;
		case 'int16':
		case 'short':
			typed = new Int16Array(rawBuf);
			break;
		case 'uint16':
		case 'ushort':
			typed = new Uint16Array(rawBuf);
			break;
		case 'int32':
		case 'int':
			typed = new Int32Array(rawBuf);
			break;
		case 'uint32':
		case 'uint':
			typed = new Uint32Array(rawBuf);
			break;
		case 'float':
		case 'float32':
			typed = new Float32Array(rawBuf);
			break;
		case 'double':
		case 'float64':
			typed = new Float64Array(rawBuf) as unknown as Float32Array;
			break;
		default:
			typed = new Uint8Array(rawBuf);
	}
	const data = toFloat32(typed);
	const stats = statsAndWindow(data);
	return { data, dims, spacing, ...stats };
}

export async function loadVolumeFromBlob(blob: Blob, filename: string): Promise<Volume> {
	const buf = await readArrayBuffer(blob);
	const lower = filename.toLowerCase();
	if (lower.endsWith('.nii') || lower.endsWith('.nii.gz')) {
		return parseNifti(buf);
	}
	if (lower.endsWith('.nrrd')) {
		return parseNrrd(buf);
	}
	// Sniff: try NIfTI first, then NRRD. We swallow the NIfTI error so we can
	// fall through to the NRRD parser; the final NRRD error preserves the
	// original cause for diagnostics.
	let niftiErr: unknown;
	try {
		return await parseNifti(buf);
	} catch (e) {
		niftiErr = e;
	}
	try {
		return await parseNrrd(buf);
	} catch (e) {
		const niftiMsg = niftiErr ? ` (NIfTI: ${(niftiErr as Error).message})` : '';
		throw new Error(
			`Unsupported volume format for ${filename}: ${(e as Error).message}${niftiMsg}`,
			{ cause: e }
		);
	}
}

export type Axis = 'axial' | 'coronal' | 'sagittal';

/**
 * Extract a 2D slice from a volume given the axis and slice index.
 * Returns Uint8ClampedArray RGBA pixels for direct ImageData consumption.
 * Slice index is 0-based.
 */
export function sliceVolume(
	vol: Volume,
	axis: Axis,
	idx: number,
	opts: { window: number; level: number; invert?: boolean; slab?: number },
	// Optional reusable RGBA scratch buffer. When the caller passes one sized
	// exactly width*height*4 it is overwritten in place (the loop below sets every
	// pixel — R/G/B and the alpha 255 — so there's no stale data) and returned as
	// `rgba`. This lets MprPane avoid a fresh multi-MB Uint8ClampedArray on every
	// W/L drag, slice scroll, slab change and locale re-render frame. A missing or
	// wrong-sized buffer is ignored and a fresh one is allocated, so the existing
	// callers (CbctReport, the tests) are unaffected.
	reuse?: Uint8ClampedArray<ArrayBuffer>
): { rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
	const [nx, ny, nz] = vol.dims;
	// Slab thickness (MIP): when > 0, max-project over ±slab voxels along the slice axis
	// (a thick-slab MIP, like DiagnoCat). 0 = a single slice (default, unchanged).
	const slab = Math.max(0, Math.round(opts.slab ?? 0));
	let width: number;
	let height: number;
	if (axis === 'axial') {
		width = nx;
		height = ny;
	} else if (axis === 'coronal') {
		width = nx;
		height = nz;
	} else {
		width = ny;
		height = nz;
	}

	const rgba =
		reuse && reuse.length === width * height * 4
			? reuse
			: new Uint8ClampedArray(width * height * 4);
	const win = Math.max(1, opts.window);
	const lo = opts.level - win / 2;
	const stride = vol.data;
	for (let v = 0; v < height; v++) {
		for (let u = 0; u < width; u++) {
			let raw: number;
			if (axis === 'axial') {
				// Z=idx slice: index = x + y*nx + z*nx*ny (MIP over z when slab > 0).
				if (slab > 0) {
					let mx = -Infinity;
					const z0 = Math.max(0, idx - slab);
					const z1 = Math.min(nz - 1, idx + slab);
					for (let z = z0; z <= z1; z++) {
						const val = stride[u + v * nx + z * nx * ny];
						if (val > mx) mx = val;
					}
					raw = mx;
				} else raw = stride[u + v * nx + idx * nx * ny];
			} else if (axis === 'coronal') {
				// Y=idx slice (MIP over y when slab > 0).
				const zRow = height - v - 1;
				if (slab > 0) {
					let mx = -Infinity;
					const y0 = Math.max(0, idx - slab);
					const y1 = Math.min(ny - 1, idx + slab);
					for (let y = y0; y <= y1; y++) {
						const val = stride[u + y * nx + zRow * nx * ny];
						if (val > mx) mx = val;
					}
					raw = mx;
				} else raw = stride[u + idx * nx + zRow * nx * ny];
			} else {
				// Sagittal X=idx slice (MIP over x when slab > 0).
				const zRow = height - v - 1;
				if (slab > 0) {
					let mx = -Infinity;
					const x0 = Math.max(0, idx - slab);
					const x1 = Math.min(nx - 1, idx + slab);
					for (let x = x0; x <= x1; x++) {
						const val = stride[x + u * nx + zRow * nx * ny];
						if (val > mx) mx = val;
					}
					raw = mx;
				} else raw = stride[idx + u * nx + zRow * nx * ny];
			}
			let g = ((raw - lo) / win) * 255;
			if (g < 0) g = 0;
			if (g > 255) g = 255;
			if (opts.invert) g = 255 - g;
			const o = (v * width + u) * 4;
			rgba[o] = g;
			rgba[o + 1] = g;
			rgba[o + 2] = g;
			rgba[o + 3] = 255;
		}
	}
	return { rgba, width, height };
}

/**
 * Build a panoramic-style reformat by MAX-projecting through a thick coronal slab
 * (along Y). Produces an X×Z image where every tooth in the slab contributes its
 * brightest voxel, so the whole arch shows at once — unlike a single coronal slice.
 * Shared by the Report panoramic and the Panoramic view so both look identical.
 */
export function renderPanoramicMip(
	vol: Volume,
	opts: { window: number; level: number; invert?: boolean; slabHalf?: number }
): { rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
	const [nx, ny, nz] = vol.dims;
	const width = nx;
	const height = nz;
	const arr = new Float32Array(width * height);
	// Half-thickness of the MIP slab (in voxels) along the projection axis. The MIP-slab
	// tool varies this; default to the original ~min(20, ny/3). Clamp to a valid range.
	const slabHalf =
		opts.slabHalf != null
			? Math.max(1, Math.min(Math.floor(ny / 2) - 1, Math.round(opts.slabHalf)))
			: Math.min(20, Math.floor(ny / 3));
	const center = Math.floor(ny / 2);
	const y0 = Math.max(0, center - slabHalf);
	const y1 = Math.min(ny - 1, center + slabHalf);
	for (let z = 0; z < nz; z++) {
		for (let x = 0; x < nx; x++) {
			let max = -Infinity;
			for (let y = y0; y <= y1; y++) {
				const val = vol.data[x + y * nx + z * nx * ny];
				if (val > max) max = val;
			}
			arr[x + (nz - z - 1) * nx] = max;
		}
	}
	const rgba = new Uint8ClampedArray(width * height * 4);
	const win = Math.max(1, opts.window);
	const lo = opts.level - win / 2;
	for (let i = 0; i < arr.length; i++) {
		let g = ((arr[i] - lo) / win) * 255;
		if (g < 0) g = 0;
		if (g > 255) g = 255;
		if (opts.invert) g = 255 - g;
		rgba[i * 4] = g;
		rgba[i * 4 + 1] = g;
		rgba[i * 4 + 2] = g;
		rgba[i * 4 + 3] = 255;
	}
	return { rgba, width, height };
}

export function maxSliceIndex(vol: Volume, axis: Axis): number {
	if (axis === 'axial') return vol.dims[2] - 1;
	if (axis === 'coronal') return vol.dims[1] - 1;
	return vol.dims[0] - 1;
}
