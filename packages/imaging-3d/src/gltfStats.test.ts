import { describe, it, expect } from 'vitest';
import {
	prettifyMeshName,
	deriveToothMapping,
	extractGlbJson,
	parseGltfStats,
	layerSortRank,
	type MeshStats,
	type MeshInfo,
	type ToothMapping
} from './gltfStats';

describe('layerSortRank (CBCT Layers ordering)', () => {
	const info = (name: string): MeshInfo => ({
		name,
		color: [0, 0, 0],
		triangles: 0,
		bbox: { x: 0, y: 0, z: 0 }
	});

	it('orders jaws → teeth (FDI anatomic order) → canals → unmapped, name-independently', () => {
		// Generic VTK-style names (what the AI actually ships) — a name-prefix sort
		// would alphabetise these; the rank uses the geometry classification instead.
		const infos = [
			info('Mesh 1'), // tooth 16
			info('Mesh 2'), // jaw
			info('Mesh 3'), // tooth 18
			info('Mesh 4'), // canal
			info('Mesh 5'), // jaw
			info('Mesh 6') // unmapped
		];
		const mapping: ToothMapping = {
			byFdi: { 16: 0, 18: 2 },
			jawMeshes: [1, 4],
			canalMeshes: [3]
		};
		const rank = layerSortRank(infos, mapping);
		const order = infos.map((m) => m.name).sort((a, b) => (rank[a] ?? 1e9) - (rank[b] ?? 1e9));
		// jaws (insertion order) → teeth (18 before 16 per FDI sequence) → canal → unmapped
		expect(order).toEqual(['Mesh 2', 'Mesh 5', 'Mesh 3', 'Mesh 1', 'Mesh 4', 'Mesh 6']);
	});

	it('ranks teeth numerically by FDI sequence, not by string', () => {
		// FDI 11 sorts AFTER 18..12 in the anatomic sequence (not "11" < "18" string-wise).
		const infos = [info('a'), info('b'), info('c')];
		const mapping: ToothMapping = {
			byFdi: { 11: 0, 18: 1, 14: 2 },
			jawMeshes: [],
			canalMeshes: []
		};
		const rank = layerSortRank(infos, mapping);
		// FDI order is 18,17,16,15,14,…,11 → 18 < 14 < 11
		expect(rank['b']).toBeLessThan(rank['c']); // 18 < 14
		expect(rank['c']).toBeLessThan(rank['a']); // 14 < 11
	});
});

// Build a minimal binary GLB container: 12-byte header + one JSON chunk.
function makeGlb(
	jsonStr: string,
	opts: { magic?: number; chunk0Len?: number; chunk0Type?: number } = {}
): ArrayBuffer {
	const json = new TextEncoder().encode(jsonStr);
	const buf = new ArrayBuffer(12 + 8 + json.length);
	const dv = new DataView(buf);
	dv.setUint32(0, opts.magic ?? 0x46546c67, true); // "glTF"
	dv.setUint32(4, 2, true); // version
	dv.setUint32(8, buf.byteLength, true); // total length
	dv.setUint32(12, opts.chunk0Len ?? json.length, true); // chunk0 length
	dv.setUint32(16, opts.chunk0Type ?? 0x4e4f534a, true); // "JSON"
	new Uint8Array(buf, 20).set(json);
	return buf;
}

describe('parseGltfStats (feeds the clinical deriveToothMapping)', () => {
	it('computes triangle count, bbox + centre, and colour per mesh', () => {
		const stats = parseGltfStats({
			accessors: [
				{ count: 100, min: [0, 0, 0], max: [2, 4, 6] }, // POSITION
				{ count: 30 } // indices → 10 triangles
			],
			materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.2, 0.1, 1] } }],
			meshes: [
				{ name: 'Tooth 11', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }
			]
		});
		expect(stats.count).toBe(1);
		expect(stats.totalTriangles).toBe(10); // indices.count / 3
		const m = stats.meshInfos[0]!;
		expect(m.name).toBe('Tooth 11');
		expect(m.triangles).toBe(10);
		expect(m.bbox).toEqual({ x: 2, y: 4, z: 6 }); // max - min
		expect(m.center).toEqual({ x: 1, y: 2, z: 3 }); // (min+max)/2
		expect(m.color).toEqual([0.5, 0.2, 0.1]);
		expect(stats.bbox).toEqual({ x: 2, y: 4, z: 6 }); // global = union of one mesh
	});

	it('falls back to POSITION count for triangles when there are no indices', () => {
		const stats = parseGltfStats({
			accessors: [{ count: 36, min: [0, 0, 0], max: [1, 1, 1] }],
			meshes: [{ name: 'Mesh', primitives: [{ attributes: { POSITION: 0 } }] }]
		});
		expect(stats.meshInfos[0]!.triangles).toBe(12); // 36 / 3
	});

	it('accepts a JSON string and tolerates a mesh with no position min/max', () => {
		const stats = parseGltfStats(
			JSON.stringify({ meshes: [{ name: 'X', primitives: [{ attributes: {} }] }] })
		);
		expect(stats.count).toBe(1);
		expect(stats.meshInfos[0]!.bbox).toEqual({ x: 0, y: 0, z: 0 });
		expect(stats.meshInfos[0]!.center).toBeUndefined(); // no min/max → no centre
	});
});

describe('extractGlbJson', () => {
	it('extracts the JSON chunk from a well-formed GLB', () => {
		expect(extractGlbJson(makeGlb('{"a":1}'))).toBe('{"a":1}');
	});
	it('returns null (does NOT throw) when chunk0Len runs past the buffer — truncated GLB', () => {
		const buf = makeGlb('{"a":1}', { chunk0Len: 9999 });
		expect(() => extractGlbJson(buf)).not.toThrow();
		expect(extractGlbJson(buf)).toBeNull();
	});
	it('returns null for a bad magic, a too-short buffer, or a non-JSON first chunk', () => {
		expect(extractGlbJson(makeGlb('{}', { magic: 0xdeadbeef }))).toBeNull();
		expect(extractGlbJson(new ArrayBuffer(8))).toBeNull();
		expect(extractGlbJson(makeGlb('{}', { chunk0Type: 0x004e4942 }))).toBeNull(); // "BIN" chunk
	});
});

describe('prettifyMeshName', () => {
	it('hides AI temp/auto-generated names but keeps real ones', () => {
		expect(prettifyMeshName('tmpwtp1c449pb_ai_in_XOGjS9', 0)).toBe('Mesh 1');
		expect(prettifyMeshName('foo_ai_out_bar', 2)).toBe('Mesh 3');
		expect(prettifyMeshName('mesh0', 4)).toBe('Mesh 5');
		expect(prettifyMeshName('', 0)).toBe('Mesh 1');
		expect(prettifyMeshName('Lower Molar', 0)).toBe('Lower Molar');
	});
});

describe('deriveToothMapping (#44 CBCT FDI ↔ mesh)', () => {
	const mesh = (
		name: string,
		bbox: { x: number; y: number; z: number },
		center: { x: number; y: number; z: number }
	): MeshInfo => ({ name, color: [1, 1, 1], triangles: 100, bbox, center });

	it('separates jaws and canals, and maps teeth to FDI by arch + position', () => {
		const meshInfos: MeshInfo[] = [
			// 0,1: two large jaws (huge bbox volume)
			mesh('jaw1', { x: 100, y: 100, z: 60 }, { x: 0, y: 0, z: 0 }),
			mesh('jaw2', { x: 100, y: 100, z: 55 }, { x: 0, y: 0, z: 5 }),
			// 2: a thin mandibular-canal-shaped mesh (high aspect, tiny volume)
			mesh('canal', { x: 2, y: 2, z: 40 }, { x: 0, y: 0, z: 0 }),
			// 3,4: upper teeth (high Z), 5: lower tooth (low Z)
			mesh('upperLeft', { x: 8, y: 8, z: 8 }, { x: -20, y: 0, z: 30 }),
			mesh('upperRight', { x: 8, y: 8, z: 8 }, { x: 20, y: 0, z: 30 }),
			mesh('lower', { x: 8, y: 8, z: 8 }, { x: 0, y: 0, z: -30 })
		];
		const stats: MeshStats = { count: meshInfos.length, totalTriangles: 600, meshInfos };
		const m = deriveToothMapping(stats);

		expect(m.jawMeshes).toHaveLength(2);
		expect(m.jawMeshes).toEqual(expect.arrayContaining([0, 1]));
		expect(m.canalMeshes).toContain(2);

		// All three teeth get an FDI; the values are the tooth mesh indices.
		const mappedIdxs = Object.values(m.byFdi);
		expect(mappedIdxs).toEqual(expect.arrayContaining([3, 4, 5]));

		// Upper teeth → upper FDI codes (11-28); lower tooth → lower codes (31-48).
		const fdiOf = (idx: number) => Number(Object.keys(m.byFdi).find((f) => m.byFdi[+f] === idx));
		expect(fdiOf(3)).toBeGreaterThanOrEqual(11);
		expect(fdiOf(3)).toBeLessThanOrEqual(28);
		expect(fdiOf(5)).toBeGreaterThanOrEqual(31);
		expect(fdiOf(5)).toBeLessThanOrEqual(48);
	});

	it('returns empty mappings for an empty mesh list', () => {
		const m = deriveToothMapping({ count: 0, totalTriangles: 0, meshInfos: [] });
		expect(m.byFdi).toEqual({});
		expect(m.jawMeshes).toEqual([]);
	});
});
