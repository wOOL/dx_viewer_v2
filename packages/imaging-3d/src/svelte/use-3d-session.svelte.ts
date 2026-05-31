import { resolveErrorMessage } from '@be-certain/core/errors';
import { logger } from '@be-certain/core/logger';

import { createSession, type Session, type SessionOptions, type SessionStageInfo } from '../session/session.js';
import { createSliceView, type SliceAxis, type SliceView } from '../session/slice-view.js';
import type { AssetDescriptor } from '../types/index.js';

export type { SliceView, SliceAxis };

const log = logger.scoped('viewer-3d');

export type ViewerStage = 'idle' | 'loading' | 'building' | 'rendering' | 'ready' | 'error';

export interface ViewerContainers {
	main: HTMLElement;
	axial?: HTMLElement;
	coronal?: HTMLElement;
	sagittal?: HTMLElement;
}

/**
 * Svelte 5 runes wrapper around `createSession` + `createSliceView`. The
 * single integration point between Svelte reactivity and the framework-
 * agnostic VTK pipeline — everything else in the package stays portable.
 */
export class Viewer3DSession {
	stage = $state<ViewerStage>('idle');
	progress = $state<number>(0);
	error = $state<string | null>(null);
	labelVisibility = $state<Record<number, boolean>>({});
	assets = $state<Array<{ kind: string; visible: boolean } & Record<string, unknown>>>([]);
	/** Anatomy bounds returned by the underlying session — used by SlicePane sliders. */
	anatomyBounds = $state<[number, number, number, number, number, number] | null>(null);
	/** Current world-coord position of each slice pane, kept reactive so the
	 * scrub slider in SlicePane stays in sync whether the slice was changed via
	 * the slider, the scroll wheel (vtkInteractorStyleImage), or click-to-pick. */
	slicePositions = $state<Record<SliceAxis, number | null>>({ axial: null, coronal: null, sagittal: null });

	/**
	 * The 3D crosshair point — derived from `slicePositions` so it represents
	 * the *current* intersection of the three slice planes, not a stale "last
	 * picked" coord. Updates automatically whether the user clicked on a slice
	 * (which sets all three positions at once), dragged a scrub slider (which
	 * sets one), or scroll-wheeled over a canvas. SlicePane reads this to
	 * draw its crosshair overlay lines, so they now follow scrub on any axis.
	 */
	crosshair = $derived.by<{ x: number; y: number; z: number } | null>(() => {
		const { sagittal, coronal, axial } = this.slicePositions;
		if (sagittal === null || coronal === null || axial === null) return null;
		// Axis mapping: world X = sagittal slice's world-axis,
		//               world Y = coronal,  world Z = axial.
		return { x: sagittal, y: coronal, z: axial };
	});

	private session: Session | null = null;
	/**
	 * Reactive so consumers passing `session.viewer.getSliceView(axis)` as a
	 * component prop see it flip from null → SliceView when wireSliceViews
	 * runs. Without `$state` here, SlicePane stays stuck at `sliceView=null`
	 * (slider disabled) even though the slice view exists and is rendering.
	 */
	private slices = $state<Partial<Record<SliceAxis, SliceView>>>({});
	private containers: ViewerContainers | null = null;
	/** Monotonic token used to detect concurrent mount() calls. */
	private mountToken = 0;

	async mount(containers: ViewerContainers, assets: AssetDescriptor[]): Promise<void> {
		const token = ++this.mountToken;
		this.disposeInternal();
		this.stage = 'loading';
		this.progress = 0;
		this.error = null;
		this.containers = containers;

		const totalAssets = assets.length || 1;

		try {
			const options: SessionOptions = {
				container: containers.main,
				assets,
				callbacks: {
					onStage: (info) => {
						if (token !== this.mountToken) return;
						if (info.phase === 'loading' || info.phase === 'building' || info.phase === 'rendering' || info.phase === 'ready') {
							this.stage = info.phase;
						}
					},
					onProgress: (info) => {
						if (token !== this.mountToken) return;
						const idx = info.assetIndex ?? 0;
						const fraction = Math.max(0, Math.min(1, info.fraction ?? 0));
						this.progress = Math.min(1, (idx + fraction) / totalAssets);
					}
				}
			};
			const session = await createSession(options);
			if (token !== this.mountToken) {
				// A newer mount started while we were awaiting — dispose what we built and exit.
				session.dispose();
				return;
			}
			this.session = session;
			const info = session.getInfo();
			this.assets = info.assets;
			this.anatomyBounds = info.anatomyBounds;
			this.wireSliceViews();

			this.stage = 'ready';
			this.progress = 1;
			log.info('Viewer ready', { assetCount: this.assets.length });
		} catch (err) {
			if (token !== this.mountToken) return; // newer mount already took over
			log.error('Viewer mount failed', err);
			this.error = resolveErrorMessage(err, 'Failed to load 3D viewer');
			this.stage = 'error';
			throw err;
		}
	}

	/**
	 * Append a new asset to the currently-mounted session. Used by the local-first
	 * flow: render the volume immediately, then add the backend's segmentation
	 * overlay when inference completes without rebuilding the renderer.
	 */
	async appendAsset(asset: AssetDescriptor): Promise<number> {
		if (!this.session) throw new Error('appendAsset called before mount');
		const idx = await this.session.appendAsset(asset);
		const info = this.session.getInfo();
		this.assets = info.assets;
		this.anatomyBounds = info.anatomyBounds;
		// If we just appended a volume/labels asset and slice panes weren't wired
		// yet (e.g. caller mounted a gltf-segmentation first), wire them now.
		this.wireSliceViews();
		return idx;
	}

	/**
	 * Wire slice panes to the first volume/labels asset's image data. Per-axis
	 * idempotent — re-running with a newly-bound container picks up that axis
	 * without disturbing the others. Containers can be passed (UI-side, after
	 * the SlicePane components have rendered and their bind:el targets exist)
	 * or omitted to use the containers passed to the most recent mount() call.
	 *
	 * This is public because the timing of when slice-pane DOM elements get
	 * bound depends on Svelte's render cycle, not on the session's lifecycle:
	 * for CBCT we mount the volume first, then SlicePane components render,
	 * THEN their canvas containers are available to feed to VTK. The component
	 * uses a $effect to call this whenever any of {assets, slice-pane refs}
	 * changes.
	 */
	wireSliceViews(containers?: ViewerContainers): void {
		if (containers) this.containers = containers;
		if (!this.session || !this.containers) return;
		const volumeIdx = this.assets.findIndex((a) => a.kind === 'volume' || a.kind === 'labels');
		if (volumeIdx < 0) return;
		const imageData = this.session.getMountImageData(volumeIdx);
		if (!imageData) return;
		const handlePick = (axis: SliceAxis, world: { x: number; y: number; z: number }) => {
			this.setCrosshair(world);
			log.debug('pick from slice', { axis, world });
		};
		const onSliceChanged = (axis: SliceAxis) => () => {
			const view = this.slices[axis];
			if (!view) return;
			const worldPos = view.getWorldPos();
			this.slicePositions = { ...this.slicePositions, [axis]: worldPos };
			// Keep the 3D plane indicator in sync with whatever moved the
			// slice: slider, scroll-wheel (vtkInteractorStyleImage), or click.
			if (worldPos !== null) {
				const worldAxis = axis === 'axial' ? 'z' : axis === 'coronal' ? 'y' : 'x';
				this.session?.setPlaneAxisPosition(worldAxis, worldPos);
			}
		};
		// Pull the row-major direction off the volume mount's info — see
		// SliceViewOptions JSDoc for why we can't read it from imageData directly.
		const direction = (this.assets[volumeIdx]?.['direction'] as number[] | undefined) ?? undefined;
		const c = this.containers;
		for (const ax of ['axial', 'coronal', 'sagittal'] as const) {
			if (this.slices[ax]) continue; // already wired for this axis
			const container = c[ax];
			if (!container) continue; // ref not yet bound
			// Defensive: on second-file load there's a small window where the
			// previous SlicePane was unmounted (its div detached from the DOM)
			// but the parent's $effect re-runs with the stale ref before the
			// new SlicePane has bound. createSliceView on a detached div
			// produces an orphaned WebGL canvas — exactly what burned Safari.
			if (!container.isConnected) continue;
			this.slices[ax] = createSliceView({
				container,
				imageData,
				axis: ax,
				direction,
				onPick: (e) => handlePick(ax, e.world),
				onSliceChanged: onSliceChanged(ax)
			});
			// Seed both the reactive slice position AND the 3D plane indicator
			// for this axis. The mapper.onModified subscription only fires on
			// *changes*, so the initial setSlice() inside createSliceView is
			// silent — without this explicit kick the gold/teal/rose wireframes
			// in the 3D scene stay invisible until the user first interacts.
			const initialPos = this.slices[ax]!.getWorldPos();
			this.slicePositions = { ...this.slicePositions, [ax]: initialPos };
			if (initialPos !== null) {
				const worldAxis = ax === 'axial' ? 'z' : ax === 'coronal' ? 'y' : 'x';
				this.session.setPlaneAxisPosition(worldAxis, initialPos);
			}
		}
	}

	setSliceWorldPos(axis: SliceAxis, world: number): void {
		const view = this.slices[axis];
		if (!view) return;
		view.setWorldPos(world);
		// The mapper.onModified subscription in wireSliceViews fires
		// onSliceChanged for us, which updates slicePositions AND the 3D
		// plane indicator. No direct call needed here.
	}

	getSliceView(axis: SliceAxis): SliceView | null {
		return this.slices[axis] ?? null;
	}

	/**
	 * Sync all three slice planes to a single world point — the standard
	 * MPR click-to-pick behaviour. Each call cascades through setSliceWorldPos
	 * which moves the slice's vtkImageMapper AND fires the onSliceChanged
	 * subscription that updates the 3D plane indicators + slicePositions.
	 * `crosshair` (now derived from slicePositions) follows automatically.
	 */
	setCrosshair(world: { x: number; y: number; z: number }): void {
		if (!this.session) return;
		this.setSliceWorldPos('sagittal', world.x);
		this.setSliceWorldPos('coronal', world.y);
		this.setSliceWorldPos('axial', world.z);
	}

	hideCrosshair(): void {
		this.session?.hideCrosshair();
	}

	setLabelVisibility(assetIndex: number, labelId: number, visible: boolean): void {
		if (!this.session) return;
		const ok = this.session.setLabelVisibility(assetIndex, labelId, visible);
		if (ok) this.labelVisibility = { ...this.labelVisibility, [labelId]: visible };
	}

	/** Per-label opacity (0..1). Distinct from labelVisibility — a structure can
	 *  be 0.3 opacity but still "visible" in the sense of receiving render passes. */
	labelOpacity = $state<Record<number, number>>({});

	setLabelOpacity(assetIndex: number, labelId: number, opacity: number): void {
		if (!this.session) return;
		const ok = this.session.setLabelOpacity(assetIndex, labelId, opacity);
		if (ok) this.labelOpacity = { ...this.labelOpacity, [labelId]: Math.max(0, Math.min(1, opacity)) };
	}

	setLabelVisibilityBulk(assetIndex: number, updates: Array<{ labelId: number; visible: boolean }>): void {
		if (!this.session) return;
		this.session.setLabelVisibilityBulk(assetIndex, updates);
		const next = { ...this.labelVisibility };
		for (const u of updates) next[u.labelId] = u.visible;
		this.labelVisibility = next;
	}

	setAssetVisibility(index: number, visible: boolean): void {
		this.session?.setAssetVisibility(index, visible);
		this.assets = this.assets.map((a, i) => (i === index ? { ...a, visible } : a));
	}

	setBackgroundColor(rgb: [number, number, number]): void {
		this.session?.setBackgroundColor(rgb);
	}

	/** Live FXAA toggle — applies without remounting the volume. */
	setUseFXAA(enabled: boolean): void {
		this.session?.setUseFXAA(enabled);
	}

	resetCamera(): void {
		this.session?.resetCamera();
	}

	dispose(): void {
		this.mountToken++;
		this.disposeInternal();
		this.stage = 'idle';
		this.progress = 0;
		this.error = null;
		this.crosshair = null;
		this.labelVisibility = {};
		this.assets = [];
		this.anatomyBounds = null;
		this.slicePositions = { axial: null, coronal: null, sagittal: null };
	}

	/** Tear down VTK resources without resetting reactive state — used between mount() calls. */
	private disposeInternal(): void {
		for (const s of Object.values(this.slices)) s?.dispose();
		this.slices = {};
		this.session?.dispose();
		this.session = null;
		this.containers = null;
	}
}

// Re-export the stage-info shape so consumers can type their own callbacks.
export type { SessionStageInfo };
