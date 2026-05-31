import { DxViewerError, ERROR_CODES } from '../types/index.js';

/**
 * OBJ mesh parser. Handles `v X Y Z [R G B]` (trimesh extension) and
 * `f i j k [...]` (fan-triangulated for n-gons).
 *
 * Skips vn / vt / g / o / s / usemtl / mtllib — only positions + faces +
 * optional vertex colors are needed.
 *
 * Ported from `viewer-3d.js` lines 567–614.
 */

export interface ParsedObj {
	format: 'obj';
	positions: Float32Array;
	colors: Float32Array | null;
	triangles: Uint32Array;
}

export function parseObj(ab: ArrayBuffer): ParsedObj {
	const text = new TextDecoder('utf-8').decode(new Uint8Array(ab));
	const positions: number[] = [];
	const colors: number[] = [];
	const triangles: number[] = [];
	let sawColors = false;
	const lines = text.split('\n');
	for (let li = 0; li < lines.length; li++) {
		const line = lines[li]!;
		if (!line || line[0] === '#') continue;
		const sp = line.charCodeAt(0);
		if (sp === 0x76 /* 'v' */ && line[1] === ' ') {
			const parts = line.split(/\s+/);
			const x = parts[1] !== undefined ? +parts[1] : NaN;
			const y = parts[2] !== undefined ? +parts[2] : NaN;
			const z = parts[3] !== undefined ? +parts[3] : NaN;
			if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
				throw new DxViewerError(ERROR_CODES.NOT_AN_OBJ_FILE, `Malformed vertex on line ${li + 1}: '${line}'`);
			}
			positions.push(x, y, z);
			if (parts.length >= 7) {
				colors.push(+parts[4]!, +parts[5]!, +parts[6]!);
				sawColors = true;
			}
		} else if (sp === 0x66 /* 'f' */ && line[1] === ' ') {
			const parts = line.split(/\s+/);
			const idx: number[] = [];
			for (let p = 1; p < parts.length; p++) {
				const tok = parts[p];
				if (!tok) continue;
				const slash = tok.indexOf('/');
				const i = parseInt(slash === -1 ? tok : tok.slice(0, slash), 10);
				if (i > 0) idx.push(i - 1);
				else if (i < 0) idx.push(positions.length / 3 + i);
			}
			for (let t = 1; t < idx.length - 1; t++) {
				triangles.push(idx[0]!, idx[t]!, idx[t + 1]!);
			}
		}
	}
	if (positions.length === 0 || triangles.length === 0) {
		throw new DxViewerError(ERROR_CODES.NOT_AN_OBJ_FILE, 'OBJ contained no vertices or faces');
	}
	return {
		format: 'obj',
		positions: new Float32Array(positions),
		colors: sawColors ? new Float32Array(colors) : null,
		triangles: new Uint32Array(triangles)
	};
}
