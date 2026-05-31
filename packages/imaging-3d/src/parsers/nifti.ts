import { DxViewerError, ERROR_CODES } from '../types/index.js';

/**
 * NIfTI-1 single-file (.nii / .nii.gz) parser.
 *
 * Ported from `viewer-3d.js` lines 235–459. Fixed 348-byte header,
 * little/big endian probed by the `sizeof_hdr` magic.
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

interface NiftiDtypeEntry {
	name: string;
	bytesPerSample: number;
	ctor: TypedArrayConstructor;
}

const NIFTI_DTYPE: Record<number, NiftiDtypeEntry> = {
	2: { name: 'uint8', bytesPerSample: 1, ctor: Uint8Array },
	4: { name: 'int16', bytesPerSample: 2, ctor: Int16Array },
	8: { name: 'int32', bytesPerSample: 4, ctor: Int32Array },
	16: { name: 'float32', bytesPerSample: 4, ctor: Float32Array },
	64: { name: 'float64', bytesPerSample: 8, ctor: Float64Array },
	256: { name: 'int8', bytesPerSample: 1, ctor: Int8Array },
	512: { name: 'uint16', bytesPerSample: 2, ctor: Uint16Array },
	768: { name: 'uint32', bytesPerSample: 4, ctor: Uint32Array }
};

export interface NiftiHeader {
	format: 'nifti';
	dims: number[];
	datatype: number;
	bitpix: number;
	pixDims: number[];
	voxOffset: number;
	littleEndian: boolean;
	qformCode: number;
	sformCode: number;
	quatB: number;
	quatC: number;
	quatD: number;
	qoffsetX: number;
	qoffsetY: number;
	qoffsetZ: number;
	srowX: [number, number, number, number];
	srowY: [number, number, number, number];
	srowZ: [number, number, number, number];
}

export interface ParsedNifti extends NiftiHeader {
	imageBuf: ArrayBuffer;
}

export function parseNiftiHeader(ab: ArrayBuffer): NiftiHeader {
	if (ab.byteLength < 352) {
		throw new DxViewerError(ERROR_CODES.NOT_A_NIFTI_FILE, 'File too small to be a NIfTI-1 header');
	}
	const dv = new DataView(ab);
	let little = true;
	let sizeofHdr = dv.getInt32(0, true);
	if (sizeofHdr !== 348) {
		sizeofHdr = dv.getInt32(0, false);
		if (sizeofHdr !== 348) {
			throw new DxViewerError(ERROR_CODES.NOT_A_NIFTI_FILE, 'sizeof_hdr is not 348 (any endian)');
		}
		little = false;
	}
	const dims: number[] = [];
	for (let i = 0; i < 8; i++) dims.push(dv.getInt16(40 + i * 2, little));
	const datatype = dv.getInt16(70, little);
	const bitpix = dv.getInt16(72, little);
	const pixDims: number[] = [];
	for (let i = 0; i < 8; i++) pixDims.push(dv.getFloat32(76 + i * 4, little));
	const voxOffset = dv.getFloat32(108, little);

	const qformCode = dv.getInt16(252, little);
	const sformCode = dv.getInt16(254, little);
	const quatB = dv.getFloat32(256, little);
	const quatC = dv.getFloat32(260, little);
	const quatD = dv.getFloat32(264, little);
	const qoffsetX = dv.getFloat32(268, little);
	const qoffsetY = dv.getFloat32(272, little);
	const qoffsetZ = dv.getFloat32(276, little);
	const srowX: [number, number, number, number] = [
		dv.getFloat32(280, little),
		dv.getFloat32(284, little),
		dv.getFloat32(288, little),
		dv.getFloat32(292, little)
	];
	const srowY: [number, number, number, number] = [
		dv.getFloat32(296, little),
		dv.getFloat32(300, little),
		dv.getFloat32(304, little),
		dv.getFloat32(308, little)
	];
	const srowZ: [number, number, number, number] = [
		dv.getFloat32(312, little),
		dv.getFloat32(316, little),
		dv.getFloat32(320, little),
		dv.getFloat32(324, little)
	];
	return {
		format: 'nifti',
		dims,
		datatype,
		bitpix,
		pixDims,
		voxOffset: voxOffset || 352,
		littleEndian: little,
		qformCode,
		sformCode,
		quatB,
		quatC,
		quatD,
		qoffsetX,
		qoffsetY,
		qoffsetZ,
		srowX,
		srowY,
		srowZ
	};
}

export function readNiftiImage(header: NiftiHeader, ab: ArrayBuffer): ArrayBuffer {
	const voxels =
		(header.dims[1] ?? 1) *
		(header.dims[2] ?? 1) *
		(header.dims[3] ?? 1) *
		((header.dims[4] ?? 0) > 0 ? (header.dims[4] ?? 1) : 1) *
		((header.dims[5] ?? 0) > 0 ? (header.dims[5] ?? 1) : 1);
	const bytes = voxels * (header.bitpix / 8);
	return ab.slice(header.voxOffset, header.voxOffset + bytes);
}

export function niftiTypedArray(datatype: number, imageBuf: ArrayBuffer): ArrayBufferView {
	const entry = NIFTI_DTYPE[datatype];
	if (!entry) {
		throw new DxViewerError(ERROR_CODES.UNSUPPORTED_DATATYPE, `NIfTI datatype code ${datatype} is not supported`, { datatype });
	}
	return new entry.ctor(imageBuf) as ArrayBufferView;
}

// ─── Affine decomposition ────────────────────────────────────────────────────

export interface Affine {
	/** Row-major 3×3, columns = unit voxel-axis vectors. */
	direction: number[];
	origin: [number, number, number];
	spacing: [number, number, number];
	source: 'sform' | 'qform' | 'space-directions' | 'identity';
}

export const IDENTITY_DIRECTION: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function identityAffine(spacing: [number, number, number]): Affine {
	return {
		direction: IDENTITY_DIRECTION.slice(),
		origin: [0, 0, 0],
		spacing: [spacing[0], spacing[1], spacing[2]],
		source: 'identity'
	};
}

export function computeNiftiAffine(header: NiftiHeader): Affine {
	const fallbackSpacing: [number, number, number] = [
		Math.abs(header.pixDims[1] ?? 1) || 1,
		Math.abs(header.pixDims[2] ?? 1) || 1,
		Math.abs(header.pixDims[3] ?? 1) || 1
	];

	// sform: explicit 3x4 affine — preferred when valid.
	if (header.sformCode > 0) {
		const m00 = header.srowX[0],
			m01 = header.srowX[1],
			m02 = header.srowX[2];
		const m10 = header.srowY[0],
			m11 = header.srowY[1],
			m12 = header.srowY[2];
		const m20 = header.srowZ[0],
			m21 = header.srowZ[1],
			m22 = header.srowZ[2];
		const sx = Math.hypot(m00, m10, m20);
		const sy = Math.hypot(m01, m11, m21);
		const sz = Math.hypot(m02, m12, m22);
		if (sx > 0 && sy > 0 && sz > 0) {
			return {
				direction: [
					m00 / sx, m01 / sy, m02 / sz,
					m10 / sx, m11 / sy, m12 / sz,
					m20 / sx, m21 / sy, m22 / sz
				],
				origin: [header.srowX[3], header.srowY[3], header.srowZ[3]],
				spacing: [sx, sy, sz],
				source: 'sform'
			};
		}
	}

	// qform: quaternion (b,c,d), a reconstructed.
	if (header.qformCode > 0) {
		let b = header.quatB,
			c = header.quatC,
			d = header.quatD;
		const sumSq = b * b + c * c + d * d;
		let a: number;
		if (sumSq <= 1.0) {
			a = Math.sqrt(Math.max(0, 1 - sumSq));
		} else {
			const n = Math.sqrt(sumSq);
			b /= n;
			c /= n;
			d /= n;
			a = 0;
		}
		const r00 = a * a + b * b - c * c - d * d;
		const r01 = 2 * (b * c - a * d);
		const r02 = 2 * (b * d + a * c);
		const r10 = 2 * (b * c + a * d);
		const r11 = a * a - b * b + c * c - d * d;
		const r12 = 2 * (c * d - a * b);
		const r20 = 2 * (b * d - a * c);
		const r21 = 2 * (c * d + a * b);
		const r22 = a * a - b * b - c * c + d * d;
		// pixDims[0] = qfac, sign of the z column. Treat 0 as 1.
		const qfac = (header.pixDims[0] ?? 1) < 0 ? -1 : 1;
		return {
			direction: [
				r00, r01, r02 * qfac,
				r10, r11, r12 * qfac,
				r20, r21, r22 * qfac
			],
			origin: [header.qoffsetX, header.qoffsetY, header.qoffsetZ],
			spacing: fallbackSpacing,
			source: 'qform'
		};
	}

	return identityAffine(fallbackSpacing);
}

/** Top-level convenience: parse + read image buffer + drop into one struct. */
export function parseNifti(ab: ArrayBuffer): ParsedNifti {
	const header = parseNiftiHeader(ab);
	const imageBuf = readNiftiImage(header, ab);
	return { ...header, imageBuf };
}
