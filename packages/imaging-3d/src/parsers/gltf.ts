import { logger } from '@be-certain/core/logger';
import { DxViewerError, ERROR_CODES } from '../types/index.js';

const log = logger.scoped('3d/gltf');

/**
 * Minimal GLTF / GLB parser tuned for the backend's segmentation output:
 * extracts one or more triangle meshes (positions + optional vertex colors
 * + triangle indices). Materials, animations, cameras, skins, and any
 * primitive whose mode isn't TRIANGLES / TRIANGLE_STRIP / TRIANGLE_FAN are
 * intentionally ignored.
 *
 * `/api/ai/cbct_seg_inference` returns `pred_seg.gltf`; `/api/ai/ios_seg_inference`
 * returns a `.glb`. Both route through `parseGltf` / `parseGlb`.
 */

export interface ParsedGltfPrimitive {
	positions: Float32Array;
	/** Per-vertex RGB, normalized to [0, 1]. Always 3 components — alpha stripped. */
	colors: Float32Array | null;
	triangles: Uint32Array;
	/** Optional per-primitive label id from extras. */
	labelId?: number;
	/** Optional per-primitive RGB material colour (0–1 floats). */
	materialColor?: [number, number, number];
}

export interface ParsedGltf {
	format: 'gltf' | 'glb';
	primitives: ParsedGltfPrimitive[];
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_CHUNK_JSON = 0x4e4f534a; // "JSON"
const GLB_CHUNK_BIN = 0x004e4942; // "BIN\0"

// GLTF 2.0 primitive.mode values; default is 4 (TRIANGLES).
const PRIM_TRIANGLES = 4;
const PRIM_TRIANGLE_STRIP = 5;
const PRIM_TRIANGLE_FAN = 6;

interface GltfJson {
	asset?: { version: string };
	scene?: number;
	scenes?: Array<{ nodes?: number[] }>;
	nodes?: Array<{ mesh?: number; children?: number[] }>;
	meshes?: Array<{ primitives: GltfPrimitiveDef[] }>;
	accessors?: GltfAccessor[];
	bufferViews?: GltfBufferView[];
	buffers?: Array<{ uri?: string; byteLength: number }>;
	materials?: Array<{
		pbrMetallicRoughness?: { baseColorFactor?: number[] };
		extras?: Record<string, unknown>;
	}>;
}

interface GltfPrimitiveDef {
	attributes: { POSITION?: number; COLOR_0?: number };
	indices?: number;
	material?: number;
	mode?: number;
	extras?: Record<string, unknown>;
}

interface GltfAccessor {
	bufferView?: number;
	byteOffset?: number;
	componentType: number;
	count: number;
	type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';
	normalized?: boolean;
}

interface GltfBufferView {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
}

type TypedArrayCtor = {
	new (buffer: ArrayBuffer, byteOffset?: number, length?: number): ArrayBufferView & { length: number };
	BYTES_PER_ELEMENT: number;
};

const COMPONENT_TYPES: Record<number, { size: number; ctor: TypedArrayCtor; normMax: number }> = {
	5120: { size: 1, ctor: Int8Array as unknown as TypedArrayCtor, normMax: 127 },
	5121: { size: 1, ctor: Uint8Array as unknown as TypedArrayCtor, normMax: 255 },
	5122: { size: 2, ctor: Int16Array as unknown as TypedArrayCtor, normMax: 32767 },
	5123: { size: 2, ctor: Uint16Array as unknown as TypedArrayCtor, normMax: 65535 },
	5125: { size: 4, ctor: Uint32Array as unknown as TypedArrayCtor, normMax: 4294967295 },
	5126: { size: 4, ctor: Float32Array as unknown as TypedArrayCtor, normMax: 1 }
};

const TYPE_COUNTS: Record<string, number> = {
	SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16
};

/** Parse a `.glb` (binary GLTF). Embedded BIN chunk holds all buffer data. */
export function parseGlb(ab: ArrayBuffer): ParsedGltf {
	if (ab.byteLength < 12) {
		throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, 'File too small to be a GLB');
	}
	const dv = new DataView(ab);
	if (dv.getUint32(0, true) !== GLB_MAGIC) {
		throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, 'GLB magic missing');
	}
	const version = dv.getUint32(4, true);
	if (version !== 2) {
		throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, `GLB version ${version} not supported (need 2)`);
	}
	let offset = 12;
	let json: GltfJson | null = null;
	let bin: ArrayBuffer | null = null;
	while (offset < ab.byteLength) {
		const chunkLen = dv.getUint32(offset, true);
		const chunkType = dv.getUint32(offset + 4, true);
		const chunkStart = offset + 8;
		if (chunkType === GLB_CHUNK_JSON) {
			const jsonBytes = new Uint8Array(ab, chunkStart, chunkLen);
			json = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));
		} else if (chunkType === GLB_CHUNK_BIN) {
			bin = ab.slice(chunkStart, chunkStart + chunkLen);
		}
		offset = chunkStart + chunkLen;
	}
	if (!json) throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, 'GLB has no JSON chunk');
	const buffers = bin ? [bin] : [];
	return { format: 'glb', primitives: extractPrimitives(json, buffers) };
}

/** Parse a `.gltf` JSON file. External `.bin` files passed via `externalBuffers` keyed by URI. */
export function parseGltf(text: string, externalBuffers: Record<string, ArrayBuffer> = {}): ParsedGltf {
	const json = JSON.parse(text) as GltfJson;
	const buffers: ArrayBuffer[] = (json.buffers ?? []).map((b) => {
		if (b.uri && b.uri.startsWith('data:')) return decodeDataUri(b.uri);
		if (b.uri && externalBuffers[b.uri]) return externalBuffers[b.uri]!;
		if (b.uri) {
			throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, `GLTF references external buffer '${b.uri}' but none was provided`, { uri: b.uri });
		}
		throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, 'GLTF buffer has no uri (use parseGlb for embedded binary)');
	});
	return { format: 'gltf', primitives: extractPrimitives(json, buffers) };
}

function extractPrimitives(json: GltfJson, buffers: ArrayBuffer[]): ParsedGltfPrimitive[] {
	if (!json.meshes || !json.accessors || !json.bufferViews) return [];
	const out: ParsedGltfPrimitive[] = [];
	const accessors = json.accessors;
	const bufferViews = json.bufferViews;
	const materials = json.materials ?? [];

	// TEMP DIAGNOSTIC — surface where (if anywhere) the backend tags label info.
	// Our current parser only looks at primitive.extras.labelId and
	// material.extras.labelId. If primitives all come back as "Primitive N" the
	// backend's tagging is elsewhere (mesh.name, material.name, custom extras key).
	const meshShape = json.meshes.slice(0, 2).map((m, mi) => ({
		meshIndex: mi,
		meshName: (m as { name?: string }).name,
		primitives: m.primitives.map((p) => ({
			extras: p.extras ?? null,
			materialIdx: p.material,
			materialName: p.material !== undefined ? (materials[p.material] as { name?: string } | undefined)?.name ?? null : null,
			materialExtras: p.material !== undefined ? materials[p.material]?.extras ?? null : null
		}))
	}));
	log.debug('gltf raw structure (first 2 meshes)', {
		meshCount: json.meshes.length,
		materialCount: materials.length,
		nodeCount: json.nodes?.length ?? 0,
		nodeNames: json.nodes?.slice(0, 5).map((n) => (n as { name?: string }).name) ?? [],
		meshShape
	});

	for (const mesh of json.meshes) {
		for (const prim of mesh.primitives) {
			const mode = prim.mode ?? PRIM_TRIANGLES;
			if (mode !== PRIM_TRIANGLES && mode !== PRIM_TRIANGLE_STRIP && mode !== PRIM_TRIANGLE_FAN) {
				continue; // points / lines / line-strips — not renderable as a triangle mesh
			}
			const posIdx = prim.attributes.POSITION;
			if (posIdx === undefined) continue;
			const positions = readFloatVec(accessors[posIdx]!, bufferViews, buffers);

			let colors: Float32Array | null = null;
			if (prim.attributes.COLOR_0 !== undefined) {
				colors = readColors(accessors[prim.attributes.COLOR_0]!, bufferViews, buffers);
			}

			const triCount = positions.length / 3;
			let indices: number[] | Uint32Array;
			if (prim.indices !== undefined) {
				indices = readIndices(accessors[prim.indices]!, bufferViews, buffers);
			} else {
				indices = new Uint32Array(triCount);
				for (let i = 0; i < triCount; i++) indices[i] = i;
			}
			const triangles = stitchTriangles(indices, mode);

			const material = prim.material !== undefined ? materials[prim.material] : undefined;
			const baseColor = material?.pbrMetallicRoughness?.baseColorFactor;
			const materialColor: [number, number, number] | undefined =
				baseColor && baseColor.length >= 3 ? [baseColor[0]!, baseColor[1]!, baseColor[2]!] : undefined;
			const labelExtras = (prim.extras?.['labelId'] ?? material?.extras?.['labelId']) as number | string | undefined;
			const labelId = labelExtras !== undefined ? Number(labelExtras) : undefined;
			out.push({ positions, colors, triangles, ...(labelId !== undefined ? { labelId } : {}), ...(materialColor ? { materialColor } : {}) });
		}
	}
	return out;
}

/** Re-assemble TRIANGLES, TRIANGLE_STRIP, or TRIANGLE_FAN into a flat triangle list. */
function stitchTriangles(indices: number[] | Uint32Array, mode: number): Uint32Array {
	if (mode === PRIM_TRIANGLES) {
		// Already a triangle list — just normalise to Uint32Array.
		return indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
	}
	const n = indices.length;
	if (n < 3) return new Uint32Array(0);
	const out = new Uint32Array((n - 2) * 3);
	let o = 0;
	if (mode === PRIM_TRIANGLE_STRIP) {
		for (let i = 0; i < n - 2; i++) {
			// Flip winding on odd triangles to keep consistent orientation.
			if (i % 2 === 0) {
				out[o++] = indices[i]!; out[o++] = indices[i + 1]!; out[o++] = indices[i + 2]!;
			} else {
				out[o++] = indices[i + 1]!; out[o++] = indices[i]!; out[o++] = indices[i + 2]!;
			}
		}
		return out;
	}
	// TRIANGLE_FAN
	const center = indices[0]!;
	for (let i = 1; i < n - 1; i++) {
		out[o++] = center; out[o++] = indices[i]!; out[o++] = indices[i + 1]!;
	}
	return out;
}

/** Read an accessor and return it as a Float32Array (positions / normals). */
function readFloatVec(accessor: GltfAccessor, bufferViews: GltfBufferView[], buffers: ArrayBuffer[]): Float32Array {
	const view = readAccessor(accessor, bufferViews, buffers);
	if (view instanceof Float32Array) return view;
	// Promote integer accessors to floats (rare for positions but legal).
	const out = new Float32Array(view.length);
	for (let i = 0; i < view.length; i++) out[i] = view[i]!;
	return out;
}

/**
 * Read COLOR_0 → Float32Array RGB in [0,1]. Handles VEC3/VEC4 and all
 * component types per GLTF 2.0 spec. Alpha is stripped; uint8/uint16 are
 * normalized regardless of `accessor.normalized` because the spec mandates
 * normalisation for COLOR_0.
 */
function readColors(accessor: GltfAccessor, bufferViews: GltfBufferView[], buffers: ArrayBuffer[]): Float32Array {
	const ct = COMPONENT_TYPES[accessor.componentType];
	if (!ct) throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, `Unsupported COLOR_0 componentType ${accessor.componentType}`);
	const comps = TYPE_COUNTS[accessor.type] ?? 0;
	if (comps !== 3 && comps !== 4) {
		throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, `COLOR_0 must be VEC3 or VEC4 (got ${accessor.type})`);
	}
	const raw = readAccessor(accessor, bufferViews, buffers);
	const norm = ct.normMax;
	const out = new Float32Array(accessor.count * 3);
	for (let i = 0; i < accessor.count; i++) {
		out[i * 3 + 0] = (raw[i * comps + 0]! as number) / norm;
		out[i * 3 + 1] = (raw[i * comps + 1]! as number) / norm;
		out[i * 3 + 2] = (raw[i * comps + 2]! as number) / norm;
	}
	return out;
}

/** Read indices accessor and return a number[] (Uint32Array if already aligned). */
function readIndices(accessor: GltfAccessor, bufferViews: GltfBufferView[], buffers: ArrayBuffer[]): number[] | Uint32Array {
	const view = readAccessor(accessor, bufferViews, buffers);
	if (view instanceof Uint32Array) return view;
	// Promote 8/16-bit indices to a plain array for stitching; caller handles conversion.
	const n = view.length;
	const arr = new Array<number>(n);
	for (let i = 0; i < n; i++) arr[i] = view[i]! as number;
	return arr;
}

/**
 * Read an accessor as a typed-array view, aligned-safely. If the combined
 * offset isn't aligned to BYTES_PER_ELEMENT, the bytes are copied via slice
 * (TypedArray constructors reject misaligned offsets with RangeError).
 */
function readAccessor(accessor: GltfAccessor, bufferViews: GltfBufferView[], buffers: ArrayBuffer[]): Float32Array | Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array {
	const ct = COMPONENT_TYPES[accessor.componentType];
	if (!ct) throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, `Unsupported GLTF componentType ${accessor.componentType}`);
	const elementCount = TYPE_COUNTS[accessor.type] ?? 1;
	const total = accessor.count * elementCount;
	if (accessor.bufferView === undefined) {
		return new ct.ctor(new ArrayBuffer(total * ct.size)) as unknown as Float32Array;
	}
	const view = bufferViews[accessor.bufferView];
	if (!view) throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, `Missing bufferView ${accessor.bufferView}`);
	const buffer = buffers[view.buffer];
	if (!buffer) throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, `Missing buffer ${view.buffer}`);
	const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	const byteLen = total * ct.size;
	// TypedArray constructors require offset % BYTES_PER_ELEMENT === 0; copy out if not aligned.
	const ab = offset % ct.size === 0 ? buffer : buffer.slice(offset, offset + byteLen);
	const ctorOffset = offset % ct.size === 0 ? offset : 0;
	return new ct.ctor(ab, ctorOffset, total) as unknown as Float32Array;
}

function decodeDataUri(uri: string): ArrayBuffer {
	const comma = uri.indexOf(',');
	if (comma === -1) throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, 'Malformed data URI in GLTF buffer');
	const meta = uri.slice(5, comma);
	const data = uri.slice(comma + 1);
	if (meta.endsWith(';base64')) {
		const bin = atob(data);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out.buffer;
	}
	throw new DxViewerError(ERROR_CODES.NOT_A_GLTF_FILE, 'Only base64-encoded data URIs are supported in GLTF buffers');
}
