// Shared reactive state for the CBCT workspace — window/level, slice indices,
// crosshair position, layer visibility, layout, tool mode.

import type { Volume, Axis } from './volumeLoader';

export type CbctTool = 'pan' | 'wl' | 'measure' | 'angle' | 'crosshair' | 'annotate';
export type LayoutMode = 'mpr' | 'volume' | 'panoramic' | 'report';

export interface MprState {
	axial: number;
	coronal: number;
	sagittal: number;
}

// A linear measurement on one MPR slice. a/b are slice-pixel coords; mm is the
// real-world distance (computed from voxel spacing at commit time).
export interface CbctMeasurement {
	axis: Axis;
	slice: number;
	a: [number, number];
	b: [number, number];
	mm: number;
}

// A 3-point angle on one MPR slice. The angle is measured at `vertex`, between
// the rays vertex→a and vertex→c. Slice-pixel coords; deg computed at commit.
export interface CbctAngle {
	axis: Axis;
	slice: number;
	a: [number, number];
	vertex: [number, number];
	c: [number, number];
	deg: number;
}

// A text pin on one MPR slice. p is slice-pixel coords.
export interface CbctAnnotation {
	axis: Axis;
	slice: number;
	p: [number, number];
	text: string;
}

export function createCbctState() {
	let volume = $state<Volume | null>(null);
	let slice = $state<MprState>({ axial: 0, coronal: 0, sagittal: 0 });
	let windowVal = $state(2000);
	let levelVal = $state(0);
	let invert = $state(false);
	let tool = $state<CbctTool>('crosshair');
	let layoutMode = $state<LayoutMode>('report');
	let crosshair = $state(true);
	let zoom = $state(1);
	// Bumped by resetMprViews() to signal each MPR pane to reset its LOCAL
	// pan/zoom (those live in MprPane, so a shared nonce coordinates the reset).
	let mprResetNonce = $state(0);
	let measurements = $state<CbctMeasurement[]>([]);
	let angles = $state<CbctAngle[]>([]);
	let annotations = $state<CbctAnnotation[]>([]);
	let slabThickness = $state(0); // MPR slab MIP half-thickness (voxels); 0 = single slice
	let activeAxis = $state<Axis>('axial'); // pane the cursor is over → target of keyboard slice scroll

	function setVolume(v: Volume) {
		volume = v;
		slice = {
			axial: Math.floor(v.dims[2] / 2),
			coronal: Math.floor(v.dims[1] / 2),
			sagittal: Math.floor(v.dims[0] / 2)
		};
		windowVal = v.defaultWindow;
		levelVal = v.defaultLevel;
		clearMarkups(); // new volume → drop any prior markups
	}

	function addMeasurement(m: CbctMeasurement) {
		measurements = [...measurements, m];
	}
	function addAngle(a: CbctAngle) {
		angles = [...angles, a];
	}
	function addAnnotation(a: CbctAnnotation) {
		annotations = [...annotations, a];
	}
	function clearMarkups() {
		measurements = [];
		angles = [];
		annotations = [];
	}

	// Restore persisted markups (linear/angle/annotation) — used to survive a reload.
	function loadMarkups(data: {
		measurements?: CbctMeasurement[];
		angles?: CbctAngle[];
		annotations?: CbctAnnotation[];
	}) {
		measurements = data.measurements ?? [];
		angles = data.angles ?? [];
		annotations = data.annotations ?? [];
	}

	function resetWL() {
		if (!volume) return;
		windowVal = volume.defaultWindow;
		levelVal = volume.defaultLevel;
	}

	function resetMprViews() {
		mprResetNonce++;
	}

	return {
		get volume() {
			return volume;
		},
		get slice() {
			return slice;
		},
		set slice(v: MprState) {
			slice = v;
		},
		get windowVal() {
			return windowVal;
		},
		set windowVal(v: number) {
			windowVal = v;
		},
		get levelVal() {
			return levelVal;
		},
		set levelVal(v: number) {
			levelVal = v;
		},
		get invert() {
			return invert;
		},
		set invert(v: boolean) {
			invert = v;
		},
		get tool() {
			return tool;
		},
		set tool(v: CbctTool) {
			tool = v;
		},
		get layoutMode() {
			return layoutMode;
		},
		set layoutMode(v: LayoutMode) {
			layoutMode = v;
		},
		get crosshair() {
			return crosshair;
		},
		set crosshair(v: boolean) {
			crosshair = v;
		},
		get slabThickness() {
			return slabThickness;
		},
		set slabThickness(v: number) {
			slabThickness = v;
		},
		get activeAxis() {
			return activeAxis;
		},
		set activeAxis(v: Axis) {
			activeAxis = v;
		},
		get zoom() {
			return zoom;
		},
		set zoom(v: number) {
			zoom = v;
		},
		get mprResetNonce() {
			return mprResetNonce;
		},
		get measurements() {
			return measurements;
		},
		get angles() {
			return angles;
		},
		get annotations() {
			return annotations;
		},
		setVolume,
		resetWL,
		resetMprViews,
		addMeasurement,
		loadMarkups,
		addAngle,
		addAnnotation,
		clearMarkups
	};
}

export type CbctStore = ReturnType<typeof createCbctState>;
