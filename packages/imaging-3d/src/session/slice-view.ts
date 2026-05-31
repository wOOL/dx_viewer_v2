// @ts-nocheck — vtk.js objects intentionally untyped at boundary.
// Register OpenGL render-node classes for vtkImageSlice (slice views render
// vtkImageSlice + vtkImageMapper). Same registration the main session needs —
// see session.ts. Side-effect imports are idempotent, so duplicating is safe
// and keeps slice-view usable standalone.
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkCoordinate from '@kitware/vtk.js/Rendering/Core/Coordinate';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';
import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';

import { logger } from '@be-certain/core/logger';
import { IDENTITY_DIRECTION } from '../parsers/nifti.js';
import { DxViewerError, ERROR_CODES } from '../types/index.js';

const log = logger.scoped('3d/slice');

export type SliceAxis = 'axial' | 'coronal' | 'sagittal';

interface AxisConfig {
	worldAxis: 0 | 1 | 2;
	viewUp: [number, number, number];
	normal: [number, number, number];
}

const SLICE_AXIS_MAP: Record<SliceAxis, AxisConfig> = {
	sagittal: { worldAxis: 0, viewUp: [0, 0, 1], normal: [1, 0, 0] },
	coronal: { worldAxis: 1, viewUp: [0, 0, 1], normal: [0, 1, 0] },
	axial: { worldAxis: 2, viewUp: [0, 1, 0], normal: [0, 0, 1] }
};

function chooseVoxelAxis(direction: number[], worldAxisIdx: number): { voxelAxis: 0 | 1 | 2; sign: 1 | -1 } {
	let bestVoxel: 0 | 1 | 2 = 0;
	let bestMag = -1;
	let bestSign: 1 | -1 = 1;
	for (let voxel = 0 as 0 | 1 | 2; voxel < 3; voxel = (voxel + 1) as 0 | 1 | 2) {
		const comp = direction[worldAxisIdx * 3 + voxel]!;
		const mag = Math.abs(comp);
		if (mag > bestMag) {
			bestMag = mag;
			bestVoxel = voxel;
			bestSign = comp >= 0 ? 1 : -1;
		}
		if (voxel === 2) break;
	}
	return { voxelAxis: bestVoxel, sign: bestSign };
}

export interface SliceViewOptions {
	container: Element;
	imageData: unknown;
	axis: SliceAxis;
	initialSlice?: number;
	windowLevel?: { window: number; level: number };
	/**
	 * Row-major 9-element rotation matrix (NIfTI convention, `direction[row*3+col]
	 * = R[row][col]`). vtk.js stores its own direction column-major internally
	 * (see vtk-internal.ts:buildVolumeImageData), so we can't recover the
	 * row-major form from `imageData.getDirection()` without re-transposing —
	 * the caller passes it explicitly instead.
	 */
	direction?: number[];
	onSliceChanged?: (slice: number) => void;
	onPick?: (e: { axis: SliceAxis; world: { x: number; y: number; z: number } }) => void;
}

export interface SliceView {
	axis: SliceAxis;
	sliceRange: [number, number];
	worldRange: [number, number];
	worldStep: number;
	worldAxis: number;
	sliceVoxelAxis: number;
	sliceSign: number;
	spacing: [number, number, number];
	origin: [number, number, number];
	dims: number[];
	bounds: number[];
	indexToWorld(i: number, j: number, k: number): number[] | null;
	worldToIndex(x: number, y: number, z: number): number[] | null;
	getWorldPos(): number | null;
	setWorldPos(worldCoord: number): void;
	getSlice(): number;
	setSlice(n: number): void;
	setWindowLevel(window: number, level: number): void;
	worldToCss(x: number, y: number, z: number): { left: number; top: number } | null;
	dispose(): void;
}

export function createSliceView(options: SliceViewOptions): SliceView {
	if (!options || typeof options !== 'object') {
		throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'createSliceView requires an options object');
	}
	const { container, imageData, axis, initialSlice, windowLevel } = options;
	if (!(container instanceof Element)) {
		throw new DxViewerError(ERROR_CODES.CONTAINER_INVALID, 'options.container must be a DOM Element');
	}
	const id = imageData as { getDimensions?: () => number[]; getSpacing?: () => number[]; getOrigin?: () => number[]; getBounds?: () => number[]; getDirection?: () => number[]; indexToWorld?: (ijk: number[]) => number[]; worldToIndex?: (xyz: number[]) => number[] };
	if (!id || typeof id.getDimensions !== 'function') {
		throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'options.imageData must be a vtkImageData', { imageData });
	}
	const axisCfg = SLICE_AXIS_MAP[axis];
	if (!axisCfg) {
		throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, `options.axis must be one of: ${Object.keys(SLICE_AXIS_MAP).join(', ')}`, { axis });
	}

	const dims = id.getDimensions!();
	const spacing = id.getSpacing!() as [number, number, number];
	const origin = id.getOrigin!() as [number, number, number];
	const bounds = id.getBounds!();
	// Prefer the row-major direction passed by the caller (see SliceViewOptions
	// JSDoc). Only fall back to identity if it wasn't provided — vtk.js's
	// getDirection() returns column-major and would silently give the wrong
	// answer in chooseVoxelAxis.
	const directionMatrix = options.direction ?? IDENTITY_DIRECTION;
	const { voxelAxis: sliceVoxelAxis, sign: sliceSign } = chooseVoxelAxis(directionMatrix, axisCfg.worldAxis);
	const sliceMax = Math.max(0, (dims[sliceVoxelAxis] ?? 1) - 1);
	const startSlice = typeof initialSlice === 'number' ? Math.max(0, Math.min(sliceMax, initialSlice)) : Math.floor(sliceMax / 2);

	const worldRangeMin = bounds[axisCfg.worldAxis * 2]!;
	const worldRangeMax = bounds[axisCfg.worldAxis * 2 + 1]!;
	const worldStep = Math.max(0.001, (worldRangeMax - worldRangeMin) / Math.max(1, sliceMax));
	log.debug(`createSliceView ${axis}`, {
		dims, sliceVoxelAxis, sliceSign, sliceMax, startSlice,
		bounds, worldRangeMin, worldRangeMax, worldStep,
		hasRange: worldRangeMax > worldRangeMin,
		directionPassed: options.direction ? 'yes (row-major)' : 'no (fell back to identity)'
	});

	const renderWindow = vtkGenericRenderWindow.newInstance({ background: [0.04, 0.07, 0.1] });
	renderWindow.setContainer(container as HTMLElement);
	renderWindow.resize();
	const renderer = renderWindow.getRenderer();
	const renWin = renderWindow.getRenderWindow();

	const mapper = vtkImageMapper.newInstance();
	mapper.setInputData(imageData);
	mapper.setSlicingMode(sliceVoxelAxis);
	mapper.setSlice(startSlice);

	const slice = vtkImageSlice.newInstance();
	slice.setMapper(mapper);
	const prop = slice.getProperty();
	if (windowLevel) {
		prop.setColorWindow(windowLevel.window);
		prop.setColorLevel(windowLevel.level);
	} else {
		prop.setColorWindow(2000);
		prop.setColorLevel(800);
	}
	renderer.addActor(slice);

	const cam = renderer.getActiveCamera();
	cam.setParallelProjection(true);
	const [vx, vy, vz] = axisCfg.viewUp;
	cam.setViewUp(vx, vy, vz);
	const [nx, ny, nz] = axisCfg.normal;
	const cx = (bounds[0]! + bounds[1]!) / 2;
	const cy = (bounds[2]! + bounds[3]!) / 2;
	const cz = (bounds[4]! + bounds[5]!) / 2;
	const span = Math.max(bounds[1]! - bounds[0]!, bounds[3]! - bounds[2]!, bounds[5]! - bounds[4]!);
	cam.setFocalPoint(cx, cy, cz);
	cam.setPosition(cx + nx * span * 2, cy + ny * span * 2, cz + nz * span * 2);
	renderer.resetCamera();
	if (axis === 'axial') {
		cam.setParallelScale(cam.getParallelScale() / 1.45);
	} else {
		const dx = bounds[1]! - bounds[0]!;
		const dy = bounds[3]! - bounds[2]!;
		const dz = bounds[5]! - bounds[4]!;
		const inPlane = axis === 'coronal' ? [dx, dz] : [dy, dz];
		const minor = Math.min(inPlane[0]!, inPlane[1]!);
		cam.setParallelScale((minor / 2) * 1.18);
	}
	renWin.render();

	const interactor = renderWindow.getInteractor();
	let interactorStyle: unknown = null;
	if (interactor) {
		interactorStyle = vtkInteractorStyleImage.newInstance();
		const s = interactorStyle as { setInteractionMode?: (m: string) => void };
		if (s.setInteractionMode) s.setInteractionMode('IMAGE_SLICING');
		interactor.setInteractorStyle(interactorStyle);
	}

	let lastSliceObserved = mapper.getSlice();
	const sliceSubscription = mapper.onModified(() => {
		const cur = mapper.getSlice();
		if (cur !== lastSliceObserved) {
			lastSliceObserved = cur;
			options.onSliceChanged?.(cur);
		}
	});

	const propPicker = vtkCellPicker.newInstance();
	const downState = { x: 0, y: 0, t: 0 };
	const onPointerDown = (e: PointerEvent) => {
		if (e.button !== 0) return;
		downState.x = e.clientX;
		downState.y = e.clientY;
		downState.t = Date.now();
	};
	const onPointerUp = (e: PointerEvent) => {
		if (e.button !== 0) return;
		if (!options.onPick) return;
		const dx = Math.abs(e.clientX - downState.x);
		const dy = Math.abs(e.clientY - downState.y);
		const dt = Date.now() - downState.t;
		if (dx > 4 || dy > 4 || dt > 500) return;
		const rect = container.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const lx = (e.clientX - rect.left) * dpr;
		const ly = (rect.height - (e.clientY - rect.top)) * dpr;
		propPicker.pick([lx, ly, 0], renderer);
		const pos = propPicker.getPickPosition() as number[];
		if (pos && pos.length === 3) {
			options.onPick({ axis, world: { x: pos[0]!, y: pos[1]!, z: pos[2]! } });
		}
	};
	container.addEventListener('pointerdown', onPointerDown as EventListener);
	container.addEventListener('pointerup', onPointerUp as EventListener);

	let disposed = false;

	// Defer the resize through rAF: vtk's renderWindow.resize() mutates the
	// canvas size, which the browser detects on its next layout pass and feeds
	// back into ResizeObserver, producing "ResizeObserver loop completed with
	// undelivered notifications" warnings. The rAF lets the current observer
	// batch finish before we mutate.
	let resizeScheduled = false;
	const scheduleResize = () => {
		if (resizeScheduled || disposed) return;
		resizeScheduled = true;
		requestAnimationFrame(() => {
			resizeScheduled = false;
			if (disposed) return;
			renderWindow.resize();
			renWin.render();
		});
	};
	const ro = new ResizeObserver(scheduleResize);
	ro.observe(container);

	// Retina/HiDPI tracking: vtk's GenericRenderWindow.resize() reads
	// `container.clientWidth * devicePixelRatio` for the drawing buffer size.
	// When the user drags the window between displays of different DPR (e.g.
	// internal Retina → external 1×), the container's CSS size doesn't
	// change so the ResizeObserver above never fires — vtk's canvas stays
	// at the old DPR and renders blurry/stretched. Browsers do fire the
	// window `resize` event on DPR change, so listen there too.
	let lastDpr = window.devicePixelRatio || 1;
	const onWindowResize = () => {
		const dpr = window.devicePixelRatio || 1;
		if (dpr !== lastDpr) {
			lastDpr = dpr;
			scheduleResize();
		}
	};
	window.addEventListener('resize', onWindowResize);

	const coord = vtkCoordinate.newInstance();
	coord.setCoordinateSystemToWorld();
	const cachedDims = id.getDimensions!().slice();
	const hasIndexToWorld = typeof id.indexToWorld === 'function';
	const hasWorldToIndex = typeof id.worldToIndex === 'function';

	const _indexToWorld = (i: number, j: number, k: number): number[] => {
		if (hasIndexToWorld) return id.indexToWorld!([i, j, k]);
		return [origin[0]! + i * spacing[0]!, origin[1]! + j * spacing[1]!, origin[2]! + k * spacing[2]!];
	};
	const _worldToIndex = (x: number, y: number, z: number): number[] => {
		if (hasWorldToIndex) return id.worldToIndex!([x, y, z]);
		return [(x - origin[0]!) / spacing[0]!, (y - origin[1]!) / spacing[1]!, (z - origin[2]!) / spacing[2]!];
	};

	const sliceToWorld = (voxelIdx: number): number => {
		const ijk = [cachedDims[0]! / 2, cachedDims[1]! / 2, cachedDims[2]! / 2];
		ijk[sliceVoxelAxis] = voxelIdx;
		const xyz = _indexToWorld(ijk[0]!, ijk[1]!, ijk[2]!);
		return xyz[axisCfg.worldAxis]!;
	};

	return {
		axis,
		sliceRange: [0, sliceMax],
		worldRange: [Math.min(worldRangeMin, worldRangeMax), Math.max(worldRangeMin, worldRangeMax)],
		worldStep,
		worldAxis: axisCfg.worldAxis,
		sliceVoxelAxis,
		sliceSign,
		spacing,
		origin,
		dims: cachedDims,
		bounds,
		indexToWorld(i, j, k) {
			if (disposed) return null;
			return _indexToWorld(i, j, k);
		},
		worldToIndex(x, y, z) {
			if (disposed) return null;
			return _worldToIndex(x, y, z);
		},
		getWorldPos() {
			if (disposed) return null;
			return sliceToWorld(mapper.getSlice());
		},
		setWorldPos(worldCoord) {
			if (disposed) return;
			const centreWorld = _indexToWorld(cachedDims[0]! / 2, cachedDims[1]! / 2, cachedDims[2]! / 2);
			const probe = centreWorld.slice();
			probe[axisCfg.worldAxis] = worldCoord;
			const ijk = _worldToIndex(probe[0]!, probe[1]!, probe[2]!);
			const clamped = Math.max(0, Math.min(sliceMax, Math.round(ijk[sliceVoxelAxis]!)));
			mapper.setSlice(clamped);
			renWin.render();
		},
		getSlice() {
			return mapper.getSlice();
		},
		setSlice(n) {
			if (disposed) return;
			const clamped = Math.max(0, Math.min(sliceMax, n | 0));
			mapper.setSlice(clamped);
			renWin.render();
		},
		setWindowLevel(window, level) {
			if (disposed) return;
			prop.setColorWindow(window);
			prop.setColorLevel(level);
			renWin.render();
		},
		worldToCss(x, y, z) {
			if (disposed) return null;
			coord.setValue(x, y, z);
			const disp = coord.getComputedDisplayValue(renderer) as number[] | null;
			if (!disp || disp.length < 2) return null;
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			const cssX = disp[0]! / dpr;
			const cssY = disp[1]! / dpr;
			return { left: cssX, top: rect.height - cssY };
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			try { ro.disconnect(); } catch { /* ignore */ }
			try { window.removeEventListener('resize', onWindowResize); } catch { /* ignore */ }
			try { container.removeEventListener('pointerdown', onPointerDown as EventListener); } catch { /* ignore */ }
			try { container.removeEventListener('pointerup', onPointerUp as EventListener); } catch { /* ignore */ }
			try { sliceSubscription?.unsubscribe?.(); } catch { /* ignore */ }
			try { renderer.removeActor(slice); } catch { /* ignore */ }
			try { slice.delete(); mapper.delete(); } catch { /* ignore */ }
			try { (interactorStyle as { delete?: () => void } | null)?.delete?.(); } catch { /* ignore */ }
			try { propPicker.delete(); } catch { /* ignore */ }
			try { coord.delete(); } catch { /* ignore */ }
			try { renderWindow.delete(); } catch { /* ignore */ }
		}
	};
}
