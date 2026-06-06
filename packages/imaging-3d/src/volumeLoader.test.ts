import { describe, it, expect } from 'vitest';
import {
	sliceVolume,
	maxSliceIndex,
	renderPanoramicMip,
	loadVolumeFromBlob,
	type Volume
} from './volumeLoader';

// Synthetic 2×2×3 volume (index = x + y*nx + z*nx*ny). Only the voxel at
// (x=1, y=1, z=1) is bright; the z=0 and z=2 planes are empty.
function makeVolume(): Volume {
	const nx = 2;
	const ny = 2;
	const nz = 3;
	const data = new Float32Array(nx * ny * nz);
	data[1 + 1 * nx + 1 * nx * ny] = 1000; // index 7
	return {
		data,
		dims: [nx, ny, nz],
		spacing: [0.5, 0.5, 0.5],
		min: 0,
		max: 1000,
		defaultWindow: 1000,
		defaultLevel: 500
	};
}

const WL = { window: 1000, level: 500 }; // lo = 0 → grayscale = raw/1000*255
const BRIGHT_PX = (1 * 2 + 1) * 4; // pixel (u=1, v=1) RGBA offset in a width-2 slice

// --- minimal volume-file builders for the parse-path (V6a) tests -----------

// Build a raw-encoded NRRD blob. `sizes` is written verbatim into the header so
// callers can inject degenerate dimensions; voxel data defaults to a uchar ramp
// sized for the (valid) product. Pass dataLen to override the byte count.
function makeNrrdBlob(sizes: string, dataLen?: number): Blob {
	const header =
		`NRRD0004\n` +
		`type: uchar\n` +
		`dimension: 3\n` +
		`sizes: ${sizes}\n` +
		`encoding: raw\n` +
		`\n`;
	const headerBytes = new TextEncoder().encode(header);
	const dims = sizes
		.trim()
		.split(/\s+/)
		.map((s) => parseInt(s, 10));
	const product =
		dataLen ?? (dims.length >= 3 && dims.every((d) => d > 0) ? dims[0] * dims[1] * dims[2] : 0);
	const data = new Uint8Array(product);
	for (let i = 0; i < data.length; i++) data[i] = i % 256;
	const out = new Uint8Array(headerBytes.length + data.length);
	out.set(headerBytes, 0);
	out.set(data, headerBytes.length);
	return new Blob([out]);
}

// Build a NIfTI-1 blob (little-endian, 352-byte header + uint8 voxel data).
function makeNiftiBlob(nx: number, ny: number, nz: number, dataLen?: number): Blob {
	const headerLen = 352;
	const product = dataLen ?? (nx > 0 && ny > 0 && nz > 0 ? nx * ny * nz : 0);
	const buf = new ArrayBuffer(headerLen + product);
	const dv = new DataView(buf);
	dv.setInt32(0, 348, true); // sizeof_hdr -> identifies little-endian
	dv.setInt16(40, 3, true); // dim[0] = ndim
	dv.setInt16(42, nx, true); // dim[1]
	dv.setInt16(44, ny, true); // dim[2]
	dv.setInt16(46, nz, true); // dim[3]
	dv.setInt16(70, 2, true); // datatype = uint8 (DT_UINT8)
	dv.setInt16(72, 8, true); // bitpix = 8 — REQUIRED: nifti-reader-js sizes the image as voxels*(bitpix/8); without it readImage returns 0 bytes
	dv.setFloat32(80, 1, true); // pixdim[1]
	dv.setFloat32(84, 1, true); // pixdim[2]
	dv.setFloat32(88, 1, true); // pixdim[3]
	dv.setFloat32(108, headerLen, true); // vox_offset
	// magic "n+1\0" at byte 344 marks a single-file NIfTI-1.
	const magic = new Uint8Array(buf, 344, 4);
	magic.set([0x6e, 0x2b, 0x31, 0x00]);
	const data = new Uint8Array(buf, headerLen);
	for (let i = 0; i < data.length; i++) data[i] = i % 256;
	return new Blob([buf]);
}

describe('maxSliceIndex', () => {
	it('returns the last index for each axis', () => {
		const v = makeVolume();
		expect(maxSliceIndex(v, 'axial')).toBe(2); // nz - 1
		expect(maxSliceIndex(v, 'coronal')).toBe(1); // ny - 1
		expect(maxSliceIndex(v, 'sagittal')).toBe(1); // nx - 1
	});
});

describe('sliceVolume', () => {
	const v = makeVolume();

	it('produces the correct in-plane dimensions per axis', () => {
		expect(sliceVolume(v, 'axial', 0, WL)).toMatchObject({ width: 2, height: 2 });
		expect(sliceVolume(v, 'coronal', 0, WL)).toMatchObject({ width: 2, height: 3 });
		expect(sliceVolume(v, 'sagittal', 0, WL)).toMatchObject({ width: 2, height: 3 });
	});

	it('maps voxel intensity through window/level to grayscale', () => {
		// z=1 axial slice: the bright voxel reads full white; z=0 is black.
		expect(sliceVolume(v, 'axial', 1, WL).rgba[BRIGHT_PX]).toBe(255);
		expect(sliceVolume(v, 'axial', 0, WL).rgba[BRIGHT_PX]).toBe(0);
	});

	it('slab MIP pulls the bright voxel from an adjacent slice (#20)', () => {
		// At z=0 the pixel is black; a 1-voxel slab MIP projects z∈[0,1] → the bright
		// z=1 voxel shows through.
		const single = sliceVolume(v, 'axial', 0, WL).rgba[BRIGHT_PX];
		const slabbed = sliceVolume(v, 'axial', 0, { ...WL, slab: 1 }).rgba[BRIGHT_PX];
		expect(single).toBe(0);
		expect(slabbed).toBe(255);
	});

	// The bright voxel is at (x=1,y=1,z=1); pixel (u=1,v=1) = BRIGHT_PX in every
	// axis since the in-plane width is 2 and zRow=height-1-z maps z=1→v=1.
	it('coronal slab MIP projects across Y (the y=idx scrub axis)', () => {
		// y=0 plane is empty; a 1-voxel slab at idx=0 projects y∈[0,1] → bright y=1 shows.
		expect(sliceVolume(v, 'coronal', 1, WL).rgba[BRIGHT_PX]).toBe(255); // single slice y=1
		expect(sliceVolume(v, 'coronal', 0, WL).rgba[BRIGHT_PX]).toBe(0); // single slice y=0
		expect(sliceVolume(v, 'coronal', 0, { ...WL, slab: 1 }).rgba[BRIGHT_PX]).toBe(255); // slab pulls it in
	});

	it('sagittal slab MIP projects across X (the x=idx scrub axis)', () => {
		expect(sliceVolume(v, 'sagittal', 1, WL).rgba[BRIGHT_PX]).toBe(255); // single slice x=1
		expect(sliceVolume(v, 'sagittal', 0, WL).rgba[BRIGHT_PX]).toBe(0); // single slice x=0
		expect(sliceVolume(v, 'sagittal', 0, { ...WL, slab: 1 }).rgba[BRIGHT_PX]).toBe(255); // slab pulls it in
	});

	it('invert flips the grayscale', () => {
		expect(sliceVolume(v, 'axial', 1, WL).rgba[BRIGHT_PX]).toBe(255);
		expect(sliceVolume(v, 'axial', 1, { ...WL, invert: true }).rgba[BRIGHT_PX]).toBe(0);
	});

	it('writes opaque RGBA (alpha = 255) gray triples', () => {
		const { rgba } = sliceVolume(v, 'axial', 1, WL);
		expect(rgba[BRIGHT_PX]).toBe(rgba[BRIGHT_PX + 1]);
		expect(rgba[BRIGHT_PX + 1]).toBe(rgba[BRIGHT_PX + 2]);
		expect(rgba[BRIGHT_PX + 3]).toBe(255);
	});
});

describe('sliceVolume reusable buffer (V6b)', () => {
	const v = makeVolume();

	it('reuses a correctly-sized buffer in place (same backing array)', () => {
		// axial slice is 2*2 → 16 RGBA bytes.
		const scratch = new Uint8ClampedArray(2 * 2 * 4);
		const { rgba } = sliceVolume(v, 'axial', 1, WL, scratch);
		expect(rgba).toBe(scratch); // no allocation — same buffer returned
		expect(rgba[BRIGHT_PX]).toBe(255); // and it's correctly filled
	});

	it('ignores a wrong-sized buffer and allocates a fresh one', () => {
		const tooSmall = new Uint8ClampedArray(8); // not 2*2*4
		const { rgba, width, height } = sliceVolume(v, 'axial', 1, WL, tooSmall);
		expect(rgba).not.toBe(tooSmall);
		expect(rgba.length).toBe(width * height * 4);
		expect(rgba[BRIGHT_PX]).toBe(255);
	});

	it('produces identical pixels whether or not a reuse buffer is passed', () => {
		const a = sliceVolume(v, 'coronal', 0, { ...WL, slab: 1 });
		const scratch = new Uint8ClampedArray(a.rgba.length);
		const b = sliceVolume(v, 'coronal', 0, { ...WL, slab: 1 }, scratch);
		expect(b.rgba).toBe(scratch);
		expect(Array.from(b.rgba)).toEqual(Array.from(a.rgba));
	});

	it('fully overwrites a reused buffer (no stale pixels carry over)', () => {
		// Render a bright slice into the buffer, then a dark slice into the SAME
		// buffer — the previously-bright pixel must be cleared, proving every byte
		// (incl. alpha) is rewritten so reuse is safe.
		const scratch = new Uint8ClampedArray(2 * 2 * 4);
		sliceVolume(v, 'axial', 1, WL, scratch); // bright at BRIGHT_PX
		expect(scratch[BRIGHT_PX]).toBe(255);
		const { rgba } = sliceVolume(v, 'axial', 0, WL, scratch); // dark slice, reuse
		expect(rgba).toBe(scratch);
		expect(rgba[BRIGHT_PX]).toBe(0);
		expect(rgba[BRIGHT_PX + 3]).toBe(255); // alpha still opaque
	});
});

describe('renderPanoramicMip', () => {
	const v = makeVolume();

	it('produces an X×Z image (nx wide, nz tall)', () => {
		expect(renderPanoramicMip(v, WL)).toMatchObject({ width: 2, height: 3 });
	});

	it('max-projects the bright voxel through the Y slab onto its (x,z) pixel', () => {
		// Bright voxel (x=1,y=1,z=1) → arr[x + (nz-z-1)*nx] = arr[1 + 1*2] = arr[3] → offset 12.
		const { rgba } = renderPanoramicMip(v, WL);
		expect(rgba[3 * 4]).toBe(255); // bright
		expect(rgba[0]).toBe(0); // an empty (x=0,z=2) pixel
		expect(rgba[3 * 4 + 3]).toBe(255); // opaque
	});

	it('honours invert', () => {
		expect(renderPanoramicMip(v, { ...WL, invert: true }).rgba[3 * 4]).toBe(0);
	});
});

describe('loadVolumeFromBlob dimension validation (V6a)', () => {
	it('parses a valid small NRRD volume', async () => {
		const vol = await loadVolumeFromBlob(makeNrrdBlob('2 2 2'), 'tiny.nrrd');
		expect(vol.dims).toEqual([2, 2, 2]);
		expect(vol.data.length).toBe(8);
	});

	it('throws on an NRRD with a zero dimension (no silent empty volume)', async () => {
		await expect(loadVolumeFromBlob(makeNrrdBlob('0 2 2', 0), 'zero.nrrd')).rejects.toThrow();
	});

	it('throws on an NRRD with an absurd dimension product (over the voxel cap)', async () => {
		// 2000 * 2000 * 2000 = 8e9 voxels, well past the 1e9 ceiling. Header-only
		// (no voxel bytes) so the parser reaches the dim check before any big alloc.
		await expect(
			loadVolumeFromBlob(makeNrrdBlob('2000 2000 2000', 0), 'huge.nrrd')
		).rejects.toThrow();
	});

	it('parses a valid small NIfTI volume', async () => {
		const vol = await loadVolumeFromBlob(makeNiftiBlob(2, 2, 2), 'tiny.nii');
		expect(vol.dims).toEqual([2, 2, 2]);
		expect(vol.data.length).toBe(8);
	});

	it('throws on a NIfTI with a zero dimension (no silent empty volume)', async () => {
		await expect(loadVolumeFromBlob(makeNiftiBlob(0, 2, 2, 0), 'zero.nii')).rejects.toThrow();
	});

	it('throws on a NIfTI with an absurd dimension product (over the voxel cap)', async () => {
		// int16 dims cap at 32767; 1100^3 ≈ 1.33e9 voxels, past the 1e9 ceiling.
		await expect(
			loadVolumeFromBlob(makeNiftiBlob(1100, 1100, 1100, 0), 'huge.nii')
		).rejects.toThrow();
	});
});
