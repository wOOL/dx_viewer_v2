// @ts-nocheck — vtk.js per-class modules ship without TypeScript declarations.
// We type the public surface (Session, SliceView, AssetMount) in the modules
// that consume these helpers; here we treat the vtk objects as `any` since
// authoring against the missing types would not catch bugs the spec doesn't
// already cover.

import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPolyDataNormals from '@kitware/vtk.js/Filters/Core/PolyDataNormals';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';

import type { LabelSchema } from '../types/index.js';
import { DxViewerError, ERROR_CODES } from '../types/index.js';
import {
	computeNiftiAffine,
	IDENTITY_DIRECTION,
	niftiTypedArray,
	type Affine,
	type ParsedNifti
} from '../parsers/nifti.js';
import { computeNrrdAffine, type ParsedNrrd } from '../parsers/nrrd.js';
import type { ParsedObj } from '../parsers/obj.js';
import type { ParsedGltf } from '../parsers/gltf.js';
import { resolveLabel } from '../labels/resolve.js';
import { logger } from '@be-certain/core/logger';

const log = logger.scoped('3d/vtk');

// ─── Parsed-asset shape sent into mount* helpers ─────────────────────────────

export type ParsedAsset =
	| (ParsedNifti & { _assetKind: 'volume' | 'labels'; _schema?: LabelSchema; _presentation?: 'standalone' | 'context' })
	| (ParsedNrrd & { _assetKind: 'volume' | 'labels'; _schema?: LabelSchema; _presentation?: 'standalone' | 'context' })
	| (ParsedObj & { _assetKind: 'mesh' })
	| (ParsedGltf & { _assetKind: 'gltf-segmentation'; _schema?: LabelSchema });

// ─── Mount interface returned by each mount* helper ──────────────────────────

export interface AssetMount {
	kind: 'volume' | 'mesh' | 'labels' | 'gltf-segmentation';
	imageData?: unknown;
	info: Record<string, unknown>;
	setVisible(v: boolean): void;
	isVisible(): boolean;
	setLabelVisibility?(labelId: number, visible: boolean): boolean;
	getLabelVisibility?(labelId: number): boolean;
	/** 0 = fully transparent, 1 = fully opaque. Per-label override on top of asset-level visibility. */
	setLabelOpacity?(labelId: number, opacity: number): boolean;
	dispose(): void;
}

// ─── Volume image data + poly data builders ──────────────────────────────────

interface BuiltImageData {
	imageData: unknown;
	scalars: ArrayBufferView;
	dims: [number, number, number];
	spacing: [number, number, number];
	origin: [number, number, number];
	direction: number[];
	affineSource: Affine['source'];
}

export function buildVolumeImageData(parsed: ParsedAsset): BuiltImageData {
	let dims: [number, number, number];
	let typedArray: ArrayBufferView;
	let affine: Affine;
	if (parsed.format === 'nifti') {
		dims = [parsed.dims[1]!, parsed.dims[2]!, parsed.dims[3]!];
		typedArray = niftiTypedArray(parsed.datatype, parsed.imageBuf);
		affine = computeNiftiAffine(parsed);
	} else if (parsed.format === 'nrrd') {
		dims = parsed.dims;
		typedArray = parsed.typedArray;
		affine = computeNrrdAffine(parsed.meta);
	} else {
		throw new DxViewerError(ERROR_CODES.UNSUPPORTED_FORMAT, `buildVolumeImageData: unexpected format ${(parsed as { format: string }).format}`);
	}

	const imageData = vtkImageData.newInstance();
	imageData.setDimensions(dims[0], dims[1], dims[2]);
	imageData.setSpacing(affine.spacing[0], affine.spacing[1], affine.spacing[2]);
	imageData.setOrigin(affine.origin[0], affine.origin[1], affine.origin[2]);
	log.debug('buildVolumeImageData', {
		dims, spacing: affine.spacing, origin: affine.origin,
		direction_rowMajor: affine.direction,
		affineSource: affine.source
	});
	if (typeof imageData.setDirection === 'function') {
		// vtk.js's `ImageData.computeTransforms` (verified in the installed copy
		// at Common/DataModel/ImageData.js:160-171) reads this 9-element array
		// COLUMN-major — `direction[0..2]` is column 0 of the rotation block,
		// `direction[3..5]` is column 1, `direction[6..8]` is column 2.
		//
		// Our parsed direction is ROW-major (NIfTI convention: direction[row*3+col]
		// = R[row][col]; see parsers/nifti.ts:195-199). Without transposing here,
		// vtk.js builds R^T instead of R, so the volume renders with a transposed
		// rotation. For axis-aligned scans R == R^T so this is invisible; for any
		// obliquely-acquired CBCT the volume sits at a slightly wrong orientation
		// and any GLTF actor placed via vtkImageData.getIndexToWorld() inherits
		// the same wrong frame.
		const d = affine.direction;
		imageData.setDirection([
			d[0]!, d[3]!, d[6]!,   // column 0 = [R[0][0], R[1][0], R[2][0]]
			d[1]!, d[4]!, d[7]!,   // column 1 = [R[0][1], R[1][1], R[2][1]]
			d[2]!, d[5]!, d[8]!    // column 2 = [R[0][2], R[1][2], R[2][2]]
		]);
	}
	imageData.getPointData().setScalars(
		vtkDataArray.newInstance({
			name: 'Scalars',
			values: typedArray,
			numberOfComponents: 1
		})
	);
	return {
		imageData,
		scalars: typedArray,
		dims,
		spacing: affine.spacing,
		origin: affine.origin,
		direction: affine.direction,
		affineSource: affine.source
	};
}

interface MeshLike {
	positions: Float32Array;
	colors: Float32Array | null;
	triangles: Uint32Array;
}

function buildPolyData(parsed: MeshLike, options: { smoothNormals?: boolean } = {}): unknown {
	const polyData = vtkPolyData.newInstance();
	polyData.getPoints().setData(parsed.positions, 3);
	const triCount = parsed.triangles.length / 3;
	const cellData = new Uint32Array(triCount * 4);
	for (let t = 0; t < triCount; t++) {
		cellData[t * 4 + 0] = 3;
		cellData[t * 4 + 1] = parsed.triangles[t * 3 + 0]!;
		cellData[t * 4 + 2] = parsed.triangles[t * 3 + 1]!;
		cellData[t * 4 + 3] = parsed.triangles[t * 3 + 2]!;
	}
	polyData.setPolys(vtkCellArray.newInstance({ values: cellData }));
	// Both OBJ and GLTF parsers normalise colors to Float32 [0,1] per-vertex RGB
	// (alpha stripped). Skip if the layout doesn't match the position count —
	// safer than writing misaligned scalars.
	if (parsed.colors && parsed.colors.length === parsed.positions.length) {
		const rgb = new Uint8Array(parsed.colors.length);
		for (let i = 0; i < parsed.colors.length; i++) {
			rgb[i] = Math.max(0, Math.min(255, Math.round(parsed.colors[i]! * 255)));
		}
		polyData.getPointData().setScalars(
			vtkDataArray.newInstance({
				name: 'Colors',
				values: rgb,
				numberOfComponents: 3,
				dataType: 'Uint8Array'
			})
		);
	}
	// Compute per-vertex smooth normals so Phong shading reads as actual
	// curvature instead of faceted triangles. Marching cubes output from the
	// AI service has 5-10° face-to-face angles — well below the default 30°
	// feature angle, so this produces clean smooth shading without flattening
	// genuine edges (e.g. tooth occlusal grooves).
	if (options.smoothNormals !== false) {
		try {
			const normals = vtkPolyDataNormals.newInstance({
				featureAngle: 30,
				computePointNormals: true,
				computeCellNormals: false,
				splitting: false
			});
			normals.setInputData(polyData);
			normals.update();
			const withNormals = normals.getOutputData(0);
			try { normals.delete(); } catch { /* ignore */ }
			return withNormals;
		} catch {
			// Fall back to raw polydata — vtk.js Mapper will compute flat
			// face normals which still renders, just less smoothly.
			return polyData;
		}
	}
	return polyData;
}

// ─── Volume mount ────────────────────────────────────────────────────────────

const VOLUME_PRESETS = {
	standalone: {
		opacity: [[0, 0], [0.25, 0], [0.4, 0.02], [0.6, 0.18], [0.8, 0.55], [0.95, 0.92], [1, 0.98]],
		color: [[0.25, 0.1, 0.07, 0.05], [0.55, 0.78, 0.65, 0.52], [0.78, 0.96, 0.9, 0.78], [0.95, 1, 0.98, 0.92], [1, 1, 1, 1]]
	},
	context: {
		opacity: [[0, 0], [0.3, 0], [0.55, 0.02], [0.75, 0.1], [0.9, 0.22], [1, 0.28]],
		color: [[0.3, 0.5, 0.5, 0.55], [0.65, 0.78, 0.82, 0.88], [1, 0.95, 0.97, 1]]
	}
} as const;

function computeRange(arr: ArrayBufferView): [number, number] {
	const a = arr as unknown as { length: number; [i: number]: number };
	let min = Infinity;
	let max = -Infinity;
	const stride = Math.max(1, Math.floor(a.length / 2_000_000));
	for (let i = 0; i < a.length; i += stride) {
		const v = a[i]!;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return [min, max];
}

export function mountVolume(renderer: unknown, parsed: ParsedAsset): AssetMount {
	const built = buildVolumeImageData(parsed);
	const { imageData, scalars, dims, spacing, affineSource } = built;
	const [dataMin, dataMax] = computeRange(scalars);
	const presentation = (parsed as { _presentation?: keyof typeof VOLUME_PRESETS })._presentation;
	if (presentation !== 'standalone' && presentation !== 'context') {
		throw new DxViewerError(
			ERROR_CODES.INVALID_ASSETS,
			`mountVolume: parsed._presentation must be 'standalone' or 'context' (got ${String(presentation)})`,
			{ presentation }
		);
	}
	const preset = VOLUME_PRESETS[presentation];

	const mapper = vtkVolumeMapper.newInstance();
	mapper.setInputData(imageData);
	mapper.setSampleDistance(0.7);

	const volume = vtkVolume.newInstance();
	volume.setMapper(mapper);
	const prop = volume.getProperty();
	prop.setInterpolationTypeToLinear();
	prop.setShade(true);
	prop.setAmbient(0.25);
	prop.setDiffuse(0.75);
	prop.setSpecular(0.3);
	prop.setSpecularPower(10);
	prop.setUseGradientOpacity(0, true);
	prop.setGradientOpacityMinimumValue(0, 0);
	prop.setGradientOpacityMinimumOpacity(0, 0.0);
	prop.setGradientOpacityMaximumValue(0, (dataMax - dataMin) * 0.15);
	prop.setGradientOpacityMaximumOpacity(0, 1.0);

	const range = dataMax - dataMin;
	const lerp = (t: number) => dataMin + range * t;
	const ofun = vtkPiecewiseFunction.newInstance();
	preset.opacity.forEach(([t, a]) => ofun.addPoint(lerp(t!), a!));
	const ctfun = vtkColorTransferFunction.newInstance();
	preset.color.forEach(([t, r, g, b]) => ctfun.addRGBPoint(lerp(t!), r!, g!, b!));
	prop.setRGBTransferFunction(0, ctfun);
	prop.setScalarOpacity(0, ofun);

	(renderer as { addVolume: (v: unknown) => void }).addVolume(volume);

	return {
		kind: 'volume',
		imageData,
		// Expose the parsed row-major direction so downstream consumers
		// (slice-view's chooseVoxelAxis, mountLabelMeshes' transformPolyDataToWorld)
		// don't have to round-trip through vtk's column-major getDirection().
		info: { dims, spacing, direction: built.direction, range: [dataMin, dataMax], presentation, affineSource, format: parsed.format },
		setVisible(v) {
			volume.setVisibility(!!v);
		},
		isVisible() {
			return !!volume.getVisibility();
		},
		dispose() {
			try { (renderer as { removeVolume: (v: unknown) => void }).removeVolume(volume); } catch { /* ignore */ }
			// Matches the demo: vtkVolume's property holds refs to ctfun/ofun via
			// setRGBTransferFunction/setScalarOpacity, and macro.chain releases them
			// when volume.delete() cascades. Calling ctfun/ofun.delete() ourselves
			// triggers "cannot operate on deleted instance" warnings without a
			// measurable leak benefit. GC reclaims the small JS wrappers.
			try { volume.delete(); mapper.delete(); imageData.delete(); } catch { /* ignore */ }
		}
	};
}

// ─── Mesh mount ──────────────────────────────────────────────────────────────

export function mountMesh(renderer: unknown, parsed: ParsedObj): AssetMount {
	const polyData = buildPolyData(parsed);
	const mapper = vtkMapper.newInstance();
	mapper.setInputData(polyData);
	if (parsed.colors) {
		mapper.setScalarVisibility(true);
		mapper.setScalarModeToUsePointData();
		mapper.setColorModeToDirectScalars();
	} else {
		mapper.setScalarVisibility(false);
	}
	const actor = vtkActor.newInstance();
	actor.setMapper(mapper);
	const prop = actor.getProperty();
	prop.setColor(0.93, 0.9, 0.82);
	prop.setAmbient(0.3);
	prop.setDiffuse(0.85);
	prop.setSpecular(0.25);
	prop.setSpecularPower(20);
	prop.setInterpolationToPhong();
	(renderer as { addActor: (a: unknown) => void }).addActor(actor);

	const vertexCount = parsed.positions.length / 3;
	const faceCount = parsed.triangles.length / 3;
	const bounds = (polyData as { getBounds: () => number[] }).getBounds();
	return {
		kind: 'mesh',
		info: { vertexCount, faceCount, bounds, hasColors: !!parsed.colors },
		setVisible(v) { actor.setVisibility(!!v); },
		isVisible() { return !!actor.getVisibility(); },
		dispose() {
			try { (renderer as { removeActor: (a: unknown) => void }).removeActor(actor); } catch { /* ignore */ }
			try { actor.delete(); mapper.delete(); (polyData as { delete: () => void }).delete(); } catch { /* ignore */ }
		}
	};
}

// ─── GLTF segmentation mount ─────────────────────────────────────────────────

/**
 * Mount each GLTF primitive as its own actor, indexed by `labelId` from
 * the primitive's `extras`. The backend's `pred_seg.gltf` is expected to
 * tag each labelled structure as a separate primitive.
 *
 * Primitives without a labelId get synthetic negative ids (-1, -2, …) so
 * they never collide with real labelIds from the schema.
 */
/**
 * 4×4 column-major matrix used as a vtkActor user transform. Maps the GLTF's
 * native coordinate system (typically voxel-index space `[0..dim)` straight
 * out of the segmentation network) into the parent volume's world space.
 */
export type Affine4x4 = number[];

export function mountGltfSegmentation(
	renderer: unknown,
	parsed: ParsedGltf,
	schema?: LabelSchema,
	worldTransform?: Affine4x4 | null
): AssetMount {
	const labelMounts = new Map<number, { actor: unknown; mapper: unknown; polyData: unknown }>();
	const structures: Array<{ id: number; name: string; groupKey: string; group: string; color: string; vertexCount: number }> = [];
	let unlabeledSeq = -1;

	// TEMP DIAGNOSTIC — characterises the backend's GLTF coordinate space so we
	// can confirm whether the volume's indexToWorld transform is the right thing
	// to apply. Logs the overall bounding box, the first primitive's bounds, and
	// whether any primitive carries a labelId we can map to anatomy.
	if (parsed.primitives.length > 0) {
		let xMin = Infinity, xMax = -Infinity;
		let yMin = Infinity, yMax = -Infinity;
		let zMin = Infinity, zMax = -Infinity;
		let labeledCount = 0;
		for (const p of parsed.primitives) {
			if (p.labelId !== undefined) labeledCount++;
			for (let i = 0; i < p.positions.length; i += 3) {
				const x = p.positions[i]!, y = p.positions[i + 1]!, z = p.positions[i + 2]!;
				if (x < xMin) xMin = x; if (x > xMax) xMax = x;
				if (y < yMin) yMin = y; if (y > yMax) yMax = y;
				if (z < zMin) zMin = z; if (z > zMax) zMax = z;
			}
		}
		const first = parsed.primitives[0]!;
		log.debug('mountGltfSegmentation', {
			primitiveCount: parsed.primitives.length,
			primitivesWithLabelId: labeledCount,
			schemaName: schema?.name ?? null,
			worldTransformGiven: !!worldTransform,
			worldTransform: worldTransform
				? `[ ${worldTransform.slice(0, 4).map((n) => n.toFixed(3)).join(', ')} | ${worldTransform.slice(4, 8).map((n) => n.toFixed(3)).join(', ')} | ${worldTransform.slice(8, 12).map((n) => n.toFixed(3)).join(', ')} | ${worldTransform.slice(12, 16).map((n) => n.toFixed(3)).join(', ')} ]`
				: null,
			gltfBoundsMin: [xMin, yMin, zMin],
			gltfBoundsMax: [xMax, yMax, zMax],
			gltfExtent: [xMax - xMin, yMax - yMin, zMax - zMin],
			firstPrimitive: {
				labelId: first.labelId,
				vertexCount: first.positions.length / 3,
				triangleCount: first.triangles.length / 3,
				hasColors: !!first.colors,
				materialColor: first.materialColor,
				firstFewVertices: Array.from(first.positions.slice(0, 9)).map((n) => Math.round(n * 1000) / 1000)
			}
		});
	}

	for (let i = 0; i < parsed.primitives.length; i++) {
		const prim = parsed.primitives[i]!;
		const id = prim.labelId ?? unlabeledSeq--;
		const polyData = buildPolyData(prim);
		const mapper = vtkMapper.newInstance();
		mapper.setInputData(polyData);

		let r = 0.85;
		let g = 0.85;
		let b = 0.85;
		let name = `Primitive ${i}`;
		let groupKey = 'other';
		let groupName = 'Other';
		let colorHex = '#D6CFC1';
		if (prim.materialColor) {
			[r, g, b] = prim.materialColor;
		}
		if (schema && prim.labelId !== undefined) {
			const resolved = resolveLabel(schema, prim.labelId);
			name = resolved.name;
			groupKey = resolved.groupKey;
			groupName = resolved.group;
			colorHex = resolved.color;
			[r, g, b] = hexToFloatRgb(resolved.color);
		}

		mapper.setScalarVisibility(prim.colors !== null);
		if (prim.colors) {
			mapper.setScalarModeToUsePointData();
			mapper.setColorModeToDirectScalars();
		}

		const actor = vtkActor.newInstance();
		actor.setMapper(mapper);
		const prop = actor.getProperty();
		prop.setColor(r, g, b);
		prop.setAmbient(0.3);
		prop.setDiffuse(0.7);
		prop.setSpecular(0.2);
		prop.setSpecularPower(20);
		prop.setInterpolationToPhong();
		// Place this label into the parent volume's world space. Without this
		// the GLTF (typically in voxel-index space [0..dim) from the seg net)
		// renders at the wrong origin/rotation relative to the CBCT volume.
		if (worldTransform) {
			(actor as { setUserMatrix: (m: number[]) => void }).setUserMatrix(worldTransform);
		}
		(renderer as { addActor: (a: unknown) => void }).addActor(actor);

		if (labelMounts.has(id)) {
			// Two primitives sharing a labelId: keep the first, log the collision, dispose the second.
			try { (renderer as { removeActor: (a: unknown) => void }).removeActor(actor); } catch { /* ignore */ }
			try { actor.delete(); mapper.delete(); (polyData as { delete: () => void }).delete(); } catch { /* ignore */ }
			continue;
		}
		labelMounts.set(id, { actor, mapper, polyData });
		structures.push({ id, name, groupKey, group: groupName, color: colorHex, vertexCount: prim.positions.length / 3 });
	}

	return {
		kind: 'gltf-segmentation',
		info: { labelCount: structures.length, structures, schemaName: schema?.name ?? null },
		setVisible(v) {
			for (const m of labelMounts.values()) (m.actor as { setVisibility: (b: boolean) => void }).setVisibility(!!v);
		},
		isVisible() {
			const first = labelMounts.values().next().value;
			return first ? !!(first.actor as { getVisibility: () => boolean }).getVisibility() : false;
		},
		setLabelVisibility(labelId, visible) {
			const m = labelMounts.get(labelId);
			if (!m) return false;
			(m.actor as { setVisibility: (b: boolean) => void }).setVisibility(!!visible);
			return true;
		},
		getLabelVisibility(labelId) {
			const m = labelMounts.get(labelId);
			return m ? !!(m.actor as { getVisibility: () => boolean }).getVisibility() : false;
		},
		setLabelOpacity(labelId, opacity) {
			const m = labelMounts.get(labelId);
			if (!m) return false;
			const clamped = Math.max(0, Math.min(1, opacity));
			const prop = (m.actor as { getProperty: () => { setOpacity: (o: number) => void } }).getProperty();
			prop.setOpacity(clamped);
			return true;
		},
		dispose() {
			for (const m of labelMounts.values()) {
				try { (renderer as { removeActor: (a: unknown) => void }).removeActor(m.actor); } catch { /* ignore */ }
				try {
					(m.actor as { delete: () => void }).delete();
					(m.mapper as { delete: () => void }).delete();
					(m.polyData as { delete: () => void }).delete();
				} catch { /* ignore */ }
			}
		}
	};
}

// ─── Marching-cubes label mount (for labels NIfTI/NRRD assets) ───────────────

interface LabelStat {
	voxels: number;
	xMin: number;
	xMax: number;
	yMin: number;
	yMax: number;
	zMin: number;
	zMax: number;
}

function scanLabelStatistics(scalars: ArrayBufferView, dims: [number, number, number]): Map<number, LabelStat> {
	const a = scalars as unknown as { length: number; [i: number]: number };
	const [W, H, D] = dims;
	const stats = new Map<number, LabelStat>();
	let idx = 0;
	for (let z = 0; z < D; z++) {
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++, idx++) {
				const v = a[idx]!;
				let e = stats.get(v);
				if (!e) {
					e = { voxels: 0, xMin: W, xMax: -1, yMin: H, yMax: -1, zMin: D, zMax: -1 };
					stats.set(v, e);
				}
				e.voxels++;
				if (x < e.xMin) e.xMin = x;
				if (x > e.xMax) e.xMax = x;
				if (y < e.yMin) e.yMin = y;
				if (y > e.yMax) e.yMax = y;
				if (z < e.zMin) e.zMin = z;
				if (z > e.zMax) e.zMax = z;
			}
		}
	}
	return stats;
}

function extractBinarySubvolume(
	scalars: ArrayBufferView,
	dims: [number, number, number],
	labelId: number,
	bbox: LabelStat,
	padding: number
): { buffer: Uint8Array; dims: [number, number, number]; origin: [number, number, number] } {
	const a = scalars as unknown as { [i: number]: number };
	const [W, H] = dims;
	const x0 = Math.max(0, bbox.xMin - padding);
	const x1 = Math.min(dims[0] - 1, bbox.xMax + padding);
	const y0 = Math.max(0, bbox.yMin - padding);
	const y1 = Math.min(dims[1] - 1, bbox.yMax + padding);
	const z0 = Math.max(0, bbox.zMin - padding);
	const z1 = Math.min(dims[2] - 1, bbox.zMax + padding);
	const sw = x1 - x0 + 1;
	const sh = y1 - y0 + 1;
	const sd = z1 - z0 + 1;
	const out = new Uint8Array(sw * sh * sd);
	for (let z = z0; z <= z1; z++) {
		for (let y = y0; y <= y1; y++) {
			const srcRow = z * W * H + y * W;
			const dstRow = (z - z0) * sw * sh + (y - y0) * sw;
			for (let x = x0; x <= x1; x++) {
				if (a[srcRow + x] === labelId) out[dstRow + (x - x0)] = 1;
			}
		}
	}
	return { buffer: out, dims: [sw, sh, sd], origin: [x0, y0, z0] };
}

function transformPolyDataToWorld(polyData: unknown, parentImageData: unknown, subVoxelOrigin: [number, number, number], parentDirection: number[]): void {
	const parent = parentImageData as { indexToWorld?: (ijk: number[]) => number[] };
	const offset = typeof parent.indexToWorld === 'function' ? parent.indexToWorld(subVoxelOrigin) : subVoxelOrigin.slice();
	const D = parentDirection;
	const pd = polyData as {
		getPoints: () => { getData: () => Float32Array; modified: () => void };
		getPointData: () => { getNormals: () => { getData: () => Float32Array; modified: () => void } | null };
		getPolys: () => { getData: () => Uint32Array };
		modified: () => void;
	};
	const pts = pd.getPoints().getData();
	for (let i = 0; i < pts.length; i += 3) {
		const px = pts[i]!;
		const py = pts[i + 1]!;
		const pz = pts[i + 2]!;
		pts[i] = offset[0]! + D[0]! * px + D[1]! * py + D[2]! * pz;
		pts[i + 1] = offset[1]! + D[3]! * px + D[4]! * py + D[5]! * pz;
		pts[i + 2] = offset[2]! + D[6]! * px + D[7]! * py + D[8]! * pz;
	}
	pd.getPoints().modified();
	const normalsArray = pd.getPointData().getNormals();
	if (normalsArray) {
		const n = normalsArray.getData();
		for (let i = 0; i < n.length; i += 3) {
			const nx = n[i]!;
			const ny = n[i + 1]!;
			const nz = n[i + 2]!;
			n[i] = D[0]! * nx + D[1]! * ny + D[2]! * nz;
			n[i + 1] = D[3]! * nx + D[4]! * ny + D[5]! * nz;
			n[i + 2] = D[6]! * nx + D[7]! * ny + D[8]! * nz;
		}
		normalsArray.modified();
	}
	const det =
		D[0]! * (D[4]! * D[8]! - D[5]! * D[7]!) -
		D[1]! * (D[3]! * D[8]! - D[5]! * D[6]!) +
		D[2]! * (D[3]! * D[7]! - D[4]! * D[6]!);
	if (det < 0) {
		const cellData = pd.getPolys().getData();
		for (let i = 0; i < cellData.length;) {
			const n = cellData[i]!;
			if (n === 3) {
				const tmp = cellData[i + 2]!;
				cellData[i + 2] = cellData[i + 3]!;
				cellData[i + 3] = tmp;
			}
			i += n + 1;
		}
		pd.modified();
	}
}

export function hexToFloatRgb(hex: string): [number, number, number] {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) return [0.5, 0.5, 0.5];
	const n = parseInt(m[1]!, 16);
	return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

const MIN_LABEL_VOXELS = 50;

export function mountLabelMeshes(renderer: unknown, parsed: ParsedAsset, schema: LabelSchema): AssetMount {
	const built = buildVolumeImageData(parsed);
	const { imageData, scalars, dims, spacing } = built;
	const voxelVolumeMm3 = spacing[0] * spacing[1] * spacing[2];
	const stats = scanLabelStatistics(scalars, dims);
	const labelMounts = new Map<number, { actor: unknown; mapper: unknown; polyData: unknown; subImage: unknown }>();
	const structures: Array<{ id: number; name: string; groupKey: string; group: string; color: string; voxels: number; volumeMm3: number }> = [];
	let totalLabeledVoxels = 0;
	// Use the parsed (row-major) direction directly. imageData.getDirection()
	// returns the column-major form we hand to vtk, which transformPolyDataToWorld
	// can't consume without re-transposing — easier to keep one copy alive.
	const parentDirection = built.direction ?? IDENTITY_DIRECTION;

	const ids = [...stats.keys()].sort((a, b) => a - b);
	for (const id of ids) {
		if (id === 0) continue;
		const stat = stats.get(id)!;
		totalLabeledVoxels += stat.voxels;
		if (stat.voxels < MIN_LABEL_VOXELS) continue;

		const sub = extractBinarySubvolume(scalars, dims, id, stat, 1);
		const subImage = vtkImageData.newInstance();
		subImage.setDimensions(sub.dims[0], sub.dims[1], sub.dims[2]);
		subImage.setSpacing(spacing[0], spacing[1], spacing[2]);
		subImage.setOrigin(0, 0, 0);
		subImage.getPointData().setScalars(
			vtkDataArray.newInstance({ name: 'Scalars', values: sub.buffer, numberOfComponents: 1 })
		);

		const mc = vtkImageMarchingCubes.newInstance({
			contourValue: 0.5,
			computeNormals: true,
			mergePoints: true
		});
		mc.setInputData(subImage);
		mc.update();
		const polyData = mc.getOutputData(0);

		if ((polyData as { getNumberOfPoints: () => number }).getNumberOfPoints() === 0) {
			try { (subImage as { delete: () => void }).delete(); } catch { /* ignore */ }
			continue;
		}
		// Intentionally NOT calling mc.delete() — matches the demo. The polyData
		// returned by getOutputData(0) is the filter's output port; eagerly
		// disposing mc here risks "already deleted" warnings when polyData.delete()
		// runs in the per-label dispose below. Letting GC reclaim the filter's
		// small JS wrapper is safer than racing the dispose order.

		transformPolyDataToWorld(polyData, imageData, sub.origin, parentDirection);

		const entry = resolveLabel(schema, id);
		const [r, g, b] = hexToFloatRgb(entry.color);
		const mapper = vtkMapper.newInstance();
		mapper.setInputData(polyData);
		mapper.setScalarVisibility(false);
		const actor = vtkActor.newInstance();
		actor.setMapper(mapper);
		const prop = actor.getProperty();
		prop.setColor(r, g, b);
		prop.setAmbient(0.3);
		prop.setDiffuse(0.7);
		prop.setSpecular(0.2);
		prop.setSpecularPower(20);
		prop.setInterpolationToPhong();
		(renderer as { addActor: (a: unknown) => void }).addActor(actor);
		labelMounts.set(id, { actor, mapper, polyData, subImage });
		structures.push({ id, name: entry.name, groupKey: entry.groupKey, group: entry.group, color: entry.color, voxels: stat.voxels, volumeMm3: stat.voxels * voxelVolumeMm3 });
	}

	return {
		kind: 'labels',
		imageData,
		info: {
			dims,
			spacing,
			direction: built.direction,
			labelCount: structures.length,
			labeledVoxels: totalLabeledVoxels,
			totalVolumeMm3: totalLabeledVoxels * voxelVolumeMm3,
			structures,
			schemaName: schema.name,
			affineSource: built.affineSource
		},
		setVisible(v) {
			for (const m of labelMounts.values()) (m.actor as { setVisibility: (b: boolean) => void }).setVisibility(!!v);
		},
		isVisible() {
			const first = labelMounts.values().next().value;
			return first ? !!(first.actor as { getVisibility: () => boolean }).getVisibility() : false;
		},
		setLabelVisibility(labelId, visible) {
			const m = labelMounts.get(labelId);
			if (!m) return false;
			(m.actor as { setVisibility: (b: boolean) => void }).setVisibility(!!visible);
			return true;
		},
		getLabelVisibility(labelId) {
			const m = labelMounts.get(labelId);
			return m ? !!(m.actor as { getVisibility: () => boolean }).getVisibility() : false;
		},
		setLabelOpacity(labelId, opacity) {
			const m = labelMounts.get(labelId);
			if (!m) return false;
			const clamped = Math.max(0, Math.min(1, opacity));
			const prop = (m.actor as { getProperty: () => { setOpacity: (o: number) => void } }).getProperty();
			prop.setOpacity(clamped);
			return true;
		},
		dispose() {
			for (const m of labelMounts.values()) {
				try { (renderer as { removeActor: (a: unknown) => void }).removeActor(m.actor); } catch { /* ignore */ }
				try {
					(m.actor as { delete: () => void }).delete();
					(m.mapper as { delete: () => void }).delete();
					(m.polyData as { delete: () => void }).delete();
					(m.subImage as { delete: () => void }).delete();
				} catch { /* ignore */ }
			}
			try { (imageData as { delete: () => void }).delete(); } catch { /* ignore */ }
		}
	};
}
