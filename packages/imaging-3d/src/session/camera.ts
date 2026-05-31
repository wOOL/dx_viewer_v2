// @ts-nocheck — vtk.js objects intentionally untyped at boundary.
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';

import type { AssetMount } from './vtk-internal.js';

export const SLICE_AXIS_COLORS = Object.freeze({
	axial: { rgb: [0.94, 0.78, 0.39], hex: '#F0C764' },
	coronal: { rgb: [0.36, 0.83, 0.79], hex: '#5DD4C9' },
	sagittal: { rgb: [0.91, 0.48, 0.62], hex: '#E87B9F' }
} as const);

export function applyInitialView(renderer: unknown, renWin: unknown, mounts: AssetMount[]): void {
	const r = renderer as {
		getActiveCamera: () => {
			setFocalPoint: (x: number, y: number, z: number) => void;
			setPosition: (x: number, y: number, z: number) => void;
			setViewUp: (x: number, y: number, z: number) => void;
			azimuth: (deg: number) => void;
			elevation: (deg: number) => void;
		};
		computeVisiblePropBounds: () => number[];
		resetCamera: () => void;
		resetCameraClippingRange: () => void;
	};
	const primary = mounts[0];
	if (!primary) return;
	const cam = r.getActiveCamera();
	const bounds = r.computeVisiblePropBounds();
	const cx = (bounds[0]! + bounds[1]!) / 2;
	const cy = (bounds[2]! + bounds[3]!) / 2;
	const cz = (bounds[4]! + bounds[5]!) / 2;
	const diag = Math.hypot(bounds[1]! - bounds[0]!, bounds[3]! - bounds[2]!, bounds[5]! - bounds[4]!);

	if (primary.kind === 'volume' || primary.kind === 'labels') {
		// Standard dental CBCT anterior-superior view:
		//   - Camera sits in front of the patient (anterior, world +Y) and
		//     slightly above the bite plane, looking down at the volume.
		//   - View-up is world +Z (patient superior) so the mandible sits at
		//     the BOTTOM of the screen and the maxilla above it — the
		//     orientation a clinician expects when opening a 3D reconstruction.
		//   - A small azimuth puts the patient's right slightly off-axis so
		//     the user reads it as a 3/4 view, not a flat orthographic head-on.
		// The previous combination of +Y position + (0,0,1) up + elevation(+15)
		// produced a confusing tilt where the jaw appeared upside-down on some
		// NIfTI orientations. Setting position to include +Z offset directly
		// instead of relying on elevation gives a deterministic result.
		cam.setFocalPoint(cx, cy, cz);
		cam.setPosition(cx, cy + diag * 1.2, cz + diag * 0.35);
		cam.setViewUp(0, 0, 1);
		r.resetCameraClippingRange();
		cam.azimuth(15);
		r.resetCameraClippingRange();
	} else {
		// Mesh-only assets (IOS): standard 3/4 orbit view, no anatomy-specific tilt.
		r.resetCamera();
		cam.azimuth(25);
		cam.elevation(-12);
		r.resetCameraClippingRange();
	}
	(renWin as { render: () => void }).render();
}

export function computePlaneBounds(renderer: unknown): [number, number, number, number, number, number] {
	const r = renderer as {
		getActors: () => Array<{ getVisibility: () => boolean; getBounds: () => number[] }>;
		computeVisiblePropBounds: () => number[];
	};
	const actors = r.getActors();
	if (actors && actors.length > 0) {
		let merged: number[] | null = null;
		actors.forEach((actor) => {
			if (!actor.getVisibility()) return;
			const b = actor.getBounds();
			if (!b || b[1]! < b[0]!) return;
			if (!merged) merged = [b[0]!, b[1]!, b[2]!, b[3]!, b[4]!, b[5]!];
			else {
				merged[0] = Math.min(merged[0]!, b[0]!);
				merged[1] = Math.max(merged[1]!, b[1]!);
				merged[2] = Math.min(merged[2]!, b[2]!);
				merged[3] = Math.max(merged[3]!, b[3]!);
				merged[4] = Math.min(merged[4]!, b[4]!);
				merged[5] = Math.max(merged[5]!, b[5]!);
			}
		});
		if (merged) return merged as [number, number, number, number, number, number];
	}
	const fallback = r.computeVisiblePropBounds();
	if (!fallback || !isFinite(fallback[0]!) || fallback[1]! < fallback[0]!) {
		return [0, 1, 0, 1, 0, 1];
	}
	return [fallback[0]!, fallback[1]!, fallback[2]!, fallback[3]!, fallback[4]!, fallback[5]!];
}

export interface PlaneIndicators {
	setPosition(world: { x: number; y: number; z: number }): void;
	/**
	 * Update a single axis of the plane indicators — used when the slice-scrub
	 * slider moves just one slice. The other two planes stay where they were.
	 */
	setAxisPosition(axis: 'x' | 'y' | 'z', value: number): void;
	setVisible(visible: boolean): void;
	dispose(): void;
}

export function createPlaneIndicators(renderer: unknown, bounds: [number, number, number, number, number, number]): PlaneIndicators {
	function makeFrame(rgb: readonly number[]) {
		const polyData = vtkPolyData.newInstance();
		const pts = new Float32Array(4 * 3);
		(polyData as { getPoints: () => { setData: (a: Float32Array, n: number) => void } }).getPoints().setData(pts, 3);
		const cells = new Uint32Array([2, 0, 1, 2, 1, 2, 2, 2, 3, 2, 3, 0]);
		const lines = vtkCellArray.newInstance({ values: cells });
		(polyData as { setLines: (l: unknown) => void }).setLines(lines);
		const mapper = vtkMapper.newInstance();
		mapper.setInputData(polyData);
		const actor = vtkActor.newInstance();
		actor.setMapper(mapper);
		const prop = actor.getProperty();
		prop.setColor(rgb[0]!, rgb[1]!, rgb[2]!);
		prop.setLineWidth(2);
		prop.setLighting(false);
		actor.setVisibility(false);
		(renderer as { addActor: (a: unknown) => void }).addActor(actor);
		return { actor, mapper, polyData, pts };
	}

	const axial = makeFrame(SLICE_AXIS_COLORS.axial.rgb);
	const coronal = makeFrame(SLICE_AXIS_COLORS.coronal.rgb);
	const sagittal = makeFrame(SLICE_AXIS_COLORS.sagittal.rgb);

	// Cache the last full position so a per-axis update can re-compose with
	// the other axes' current values. Seeded to the centre of `bounds` so the
	// first per-axis call places the planes at the volume's centroid.
	const current: { x: number; y: number; z: number } = {
		x: (bounds[0] + bounds[1]) / 2,
		y: (bounds[2] + bounds[3]) / 2,
		z: (bounds[4] + bounds[5]) / 2
	};

	function update(world: { x: number; y: number; z: number }): void {
		const xMin = bounds[0],
			xMax = bounds[1],
			yMin = bounds[2],
			yMax = bounds[3],
			zMin = bounds[4],
			zMax = bounds[5];
		axial.pts.set([
			xMin, yMin, world.z, xMax, yMin, world.z,
			xMax, yMax, world.z, xMin, yMax, world.z
		]);
		coronal.pts.set([
			xMin, world.y, zMin, xMax, world.y, zMin,
			xMax, world.y, zMax, xMin, world.y, zMax
		]);
		sagittal.pts.set([
			world.x, yMin, zMin, world.x, yMax, zMin,
			world.x, yMax, zMax, world.x, yMin, zMax
		]);
		for (const f of [axial, coronal, sagittal]) {
			const pd = f.polyData as { getPoints: () => { modified: () => void }; modified: () => void };
			pd.getPoints().modified();
			pd.modified();
			(f.actor as { setVisibility: (b: boolean) => void }).setVisibility(true);
		}
	}

	return {
		setPosition(world) {
			current.x = world.x;
			current.y = world.y;
			current.z = world.z;
			update(world);
		},
		setAxisPosition(axis, value) {
			current[axis] = value;
			update(current);
		},
		setVisible(visible) {
			const v = !!visible;
			(axial.actor as { setVisibility: (b: boolean) => void }).setVisibility(v);
			(coronal.actor as { setVisibility: (b: boolean) => void }).setVisibility(v);
			(sagittal.actor as { setVisibility: (b: boolean) => void }).setVisibility(v);
		},
		dispose() {
			for (const f of [axial, coronal, sagittal]) {
				try { (renderer as { removeActor: (a: unknown) => void }).removeActor(f.actor); } catch { /* ignore */ }
				try {
					(f.actor as { delete: () => void }).delete();
					(f.mapper as { delete: () => void }).delete();
					(f.polyData as { delete: () => void }).delete();
				} catch { /* ignore */ }
			}
		}
	};
}
