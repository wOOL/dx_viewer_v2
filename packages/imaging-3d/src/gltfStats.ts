// Lightweight GLTF/GLB parser for mesh stats — runs without Three.js so callers
// can populate sidebar UI before mounting the renderer.

export interface MeshInfo {
	name: string;
	color: [number, number, number];
	triangles: number;
	bbox: { x: number; y: number; z: number };
	center?: { x: number; y: number; z: number };
	fdi?: number;
}

// The AI service often names meshes after its internal temp upload path
// (e.g. "tmpwtp1c449pb_ai_in_XOGjS9rce...") or VTK auto-generates "mesh0" etc.
// Map those to a clean display name so sidebar UI doesn't expose internals.
export function prettifyMeshName(raw: string, index: number): string {
	if (!raw) return `Mesh ${index + 1}`;
	if (/^tmp/i.test(raw) || /_ai_(in|out)_/i.test(raw)) return `Mesh ${index + 1}`;
	if (/^mesh\d+$/i.test(raw)) return `Mesh ${index + 1}`;
	return raw;
}

export interface MeshStats {
	count: number;
	totalTriangles: number;
	bbox?: { x: number; y: number; z: number };
	meshInfos: MeshInfo[];
}

// Extract the JSON manifest from a GLB binary (magic "glTF", version 2). The
// first chunk is the JSON manifest.
export function extractGlbJson(buf: ArrayBuffer): string | null {
	const v = new DataView(buf);
	// magic 0x46546C67 = "glTF" LE
	if (v.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67) return null;
	const totalLen = v.getUint32(8, true);
	if (totalLen > v.byteLength) return null;
	const chunk0Len = v.getUint32(12, true);
	const chunk0Type = v.getUint32(16, true);
	// chunk type 0x4E4F534A = "JSON" LE
	if (chunk0Type !== 0x4e4f534a) return null;
	// A truncated / malformed GLB (e.g. a partial download) can claim a chunk0Len
	// that runs past the buffer; `new Uint8Array(buf, 20, chunk0Len)` would THROW a
	// RangeError rather than honour this function's `| null` contract. Guard it.
	if (20 + chunk0Len > v.byteLength) return null;
	const bytes = new Uint8Array(buf, 20, chunk0Len);
	return new TextDecoder().decode(bytes);
}

interface RawGltf {
	accessors?: { count: number; min?: number[]; max?: number[] }[];
	materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
	meshes?: {
		name?: string;
		primitives: { attributes: { POSITION?: number }; indices?: number; material?: number }[];
	}[];
}

export function parseGltfStats(json: RawGltf | string): MeshStats {
	const j: RawGltf = typeof json === 'string' ? JSON.parse(json) : json;
	const accs = j.accessors ?? [];
	const mats = j.materials ?? [];
	const meshes = j.meshes ?? [];
	let totalTri = 0;
	const infos: MeshInfo[] = [];
	const gMin = [Infinity, Infinity, Infinity];
	const gMax = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < meshes.length; i++) {
		const m = meshes[i];
		const prim = m.primitives?.[0];
		if (!prim) continue;
		const posAcc = prim.attributes?.POSITION != null ? accs[prim.attributes.POSITION] : undefined;
		const idxAcc = prim.indices != null ? accs[prim.indices] : null;
		const tri = idxAcc ? idxAcc.count / 3 : posAcc ? posAcc.count / 3 : 0;
		totalTri += tri;
		const mat = prim.material != null ? mats[prim.material] : undefined;
		const col = mat?.pbrMetallicRoughness?.baseColorFactor ?? [0.7, 0.7, 0.7, 1];
		let bx = 0,
			by = 0,
			bz = 0;
		let cx = 0,
			cy = 0,
			cz = 0;
		let hasCenter = false;
		if (posAcc?.min && posAcc?.max) {
			bx = posAcc.max[0] - posAcc.min[0];
			by = posAcc.max[1] - posAcc.min[1];
			bz = posAcc.max[2] - posAcc.min[2];
			cx = (posAcc.min[0] + posAcc.max[0]) / 2;
			cy = (posAcc.min[1] + posAcc.max[1]) / 2;
			cz = (posAcc.min[2] + posAcc.max[2]) / 2;
			hasCenter = true;
			for (let k = 0; k < 3; k++) {
				gMin[k] = Math.min(gMin[k], posAcc.min[k]);
				gMax[k] = Math.max(gMax[k], posAcc.max[k]);
			}
		}
		infos.push({
			name: prettifyMeshName(m.name ?? '', i),
			color: [col[0], col[1], col[2]],
			triangles: Math.round(tri),
			bbox: { x: bx, y: by, z: bz },
			...(hasCenter && { center: { x: cx, y: cy, z: cz } })
		});
	}
	return {
		count: meshes.length,
		totalTriangles: Math.round(totalTri),
		bbox: { x: gMax[0] - gMin[0], y: gMax[1] - gMin[1], z: gMax[2] - gMin[2] },
		meshInfos: infos
	};
}

// Derive an approximate FDI tooth presence map from segmentation meshes.
//
// CBCT AI doesn't return tooth identifiers — just N meshes. We reverse-engineer:
//   1. Drop the 2 largest meshes by bbox volume (maxilla + mandible).
//   2. Drop any obvious canal-shaped meshes (extreme aspect ratio).
//   3. The remaining meshes get spatially sorted into FDI slots:
//      - Upper / lower split by mean Y of bbox center (CBCT is space-LPS, Y is A→P,
//        so we use Z which is I→S as the up axis).
//      - Within each arch, sort by X coordinate (R→L) and assign to FDI numbers.
//
// Returns a map: FDI number → mesh index in stats.meshInfos. Used by the tooth
// chart to colour cells that the AI segmented.
export interface ToothMapping {
	byFdi: Record<number, number>; // FDI → meshInfos index
	jawMeshes: number[]; // mesh indexes treated as jaws
	canalMeshes: number[]; // mesh indexes treated as canals
}

const UPPER_FDI_R_TO_L = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_FDI_R_TO_L = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

interface ScratchMesh {
	idx: number;
	vol: number;
	centerX: number;
	centerZ: number;
	aspect: number;
}

export function deriveToothMapping(stats: MeshStats): ToothMapping {
	const infos = stats.meshInfos;
	const out: ToothMapping = { byFdi: {}, jawMeshes: [], canalMeshes: [] };
	if (infos.length === 0) return out;

	const scratch: ScratchMesh[] = infos.map((m, i) => {
		const dims = [m.bbox.x, m.bbox.y, m.bbox.z].sort((a, b) => a - b);
		// Two elongation metrics — canals score high on at least one:
		//   - aspectMed = longest / median (catches uniformly elongated meshes)
		//   - aspectMin = longest / min (catches truly thin meshes)
		// We keep the max so curved canals (high min, lower median) still detect.
		const aspectMed = dims[1] > 0 ? dims[2] / dims[1] : 1;
		const aspectMin = dims[0] > 0 ? dims[2] / dims[0] : 1;
		const aspect = Math.max(aspectMed, aspectMin / 2);
		return {
			idx: i,
			vol: m.bbox.x * m.bbox.y * m.bbox.z,
			centerX: m.center?.x ?? 0,
			centerZ: m.center?.z ?? 0,
			aspect
		};
	});

	// Identify jaws by bbox volume. Up to 2 — but only count the 2nd if it's
	// substantially bigger than the median; a partial-arch scan has only 1.
	const sortedByVol = [...scratch].sort((a, b) => b.vol - a.vol);
	const medianVol = sortedByVol[Math.floor(sortedByVol.length / 2)]?.vol ?? 1;
	const jawCandidates = sortedByVol.filter((s) => s.vol > medianVol * 4);
	const jawIdxs = jawCandidates.slice(0, 2).map((s) => s.idx);
	out.jawMeshes = jawIdxs;

	// Drop canal-shaped meshes — longest dim is ≥2.5× the median dim, AND volume
	// is below the per-tooth median (excludes flat structures like the jaws).
	const nonJaw = scratch.filter((s) => !jawIdxs.includes(s.idx));
	const nonJawMedianVol = nonJaw.length ? nonJaw[Math.floor(nonJaw.length / 2)].vol : 1;
	const canalIdxs = nonJaw
		.filter((s) => s.aspect > 2.5 && s.vol < nonJawMedianVol * 0.8)
		.map((s) => s.idx);
	out.canalMeshes = canalIdxs;

	const candidateTeeth = scratch.filter(
		(s) => !jawIdxs.includes(s.idx) && !canalIdxs.includes(s.idx)
	);
	if (candidateTeeth.length === 0) return out;

	// If centers are missing (no posAcc.min/max), fall back to bbox-volume rank.
	const haveCenters = candidateTeeth.every((s) => s.centerX !== 0 || s.centerZ !== 0);
	if (!haveCenters) {
		candidateTeeth.sort((a, b) => b.vol - a.vol);
		const fdiOrder = [...UPPER_FDI_R_TO_L, ...LOWER_FDI_R_TO_L];
		for (let i = 0; i < Math.min(candidateTeeth.length, fdiOrder.length); i++) {
			out.byFdi[fdiOrder[i]] = candidateTeeth[i].idx;
		}
		return out;
	}

	// Have centers — split upper/lower by mean Z, then sort each arch by X.
	const meanZ = candidateTeeth.reduce((a, s) => a + s.centerZ, 0) / candidateTeeth.length;
	const upper = candidateTeeth
		.filter((s) => s.centerZ >= meanZ)
		.sort((a, b) => a.centerX - b.centerX);
	const lower = candidateTeeth
		.filter((s) => s.centerZ < meanZ)
		.sort((a, b) => a.centerX - b.centerX);
	for (let i = 0; i < Math.min(upper.length, UPPER_FDI_R_TO_L.length); i++) {
		out.byFdi[UPPER_FDI_R_TO_L[i]] = upper[i].idx;
	}
	for (let i = 0; i < Math.min(lower.length, LOWER_FDI_R_TO_L.length); i++) {
		out.byFdi[LOWER_FDI_R_TO_L[i]] = lower[i].idx;
	}
	return out;
}

// Layer-panel ordering for the CBCT Layers list: jaws → teeth (anatomic FDI
// sequence) → canals → unmapped. Returns a `mesh name → sort rank` map.
//
// We CANNOT route by the mesh name: the AI ships VTK-generated names ("mesh0",
// tmp paths) that prettify to "Mesh N", so a name-prefix sort ("Jaw"/"Tooth"/
// "Canal") matches nothing and silently collapses to an alphabetical fallback
// (Canal before Jaw before Tooth, and teeth string-ordered 1,10,11,…,2,…). The
// derived `ToothMapping` already classifies every mesh by geometry, so rank from
// that instead — locale- and name-independent.
const LAYER_FDI_ORDER = [
	18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41,
	31, 32, 33, 34, 35, 36, 37, 38
];

export function layerSortRank(
	meshInfos: MeshInfo[],
	mapping: ToothMapping
): Record<string, number> {
	const rank: Record<string, number> = {};
	mapping.jawMeshes.forEach((idx, i) => {
		const m = meshInfos[idx];
		if (m) rank[m.name] = i; // jaws first (0,1)
	});
	for (const [fdiStr, idx] of Object.entries(mapping.byFdi)) {
		const m = meshInfos[idx as number];
		if (m) {
			const fi = LAYER_FDI_ORDER.indexOf(Number(fdiStr));
			rank[m.name] = 100 + (fi < 0 ? 99 : fi); // teeth next, in anatomic FDI order
		}
	}
	mapping.canalMeshes.forEach((idx, i) => {
		const m = meshInfos[idx];
		if (m) rank[m.name] = 1000 + i; // canals last
	});
	return rank;
}

// Sniff blob → return stats if we can parse it without Three.js. Handles GLB
// binary (magic "glTF") and GLTF text JSON (may have UTF-8 BOM or leading
// whitespace).
export async function statsFromBlob(blob: Blob): Promise<MeshStats | null> {
	if (blob.size === 0) return null;
	const buf = await blob.arrayBuffer();
	const v = new DataView(buf);
	if (v.byteLength >= 4 && v.getUint32(0, true) === 0x46546c67) {
		// Wrap extraction too (defence-in-depth) so a malformed GLB degrades to null
		// instead of rejecting the promise — statsFromBlob's contract is `| null`.
		try {
			const json = extractGlbJson(buf);
			if (!json) return null;
			return parseGltfStats(json);
		} catch {
			return null;
		}
	}
	// GLTF text — strip BOM + leading whitespace, then require first non-WS char is '{' or '['.
	const text = new TextDecoder()
		.decode(buf)
		.replace(/^\uFEFF/, '')
		.trimStart();
	if (text.length > 0 && (text[0] === '{' || text[0] === '[')) {
		try {
			return parseGltfStats(text);
		} catch {
			return null;
		}
	}
	return null;
}
