// @ts-nocheck — vtk.js objects intentionally untyped at boundary.
// Register OpenGL render-node classes for vtkActor / vtkVolume / vtkImageSlice
// with the render-window's view-node factory. Without these side-effect imports
// the OpenGL backend can't find a render-node for any scene-graph object and
// `renNode.traverse(...)` throws "undefined is not an object".
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';

import {
	isGzip,
	gunzipToArrayBuffer,
	readBytes
} from '../loaders/index.js';
import { parseNiftiHeader, readNiftiImage } from '../parsers/nifti.js';
import { parseNrrd } from '../parsers/nrrd.js';
import { parseObj } from '../parsers/obj.js';
import { parseGlb, parseGltf } from '../parsers/gltf.js';
import type { AssetDescriptor, SessionCallbacks, SessionStageInfo, SessionProgressInfo, LabelSchema } from '../types/index.js';
import { DxViewerError, ERROR_CODES } from '../types/index.js';

export type { SessionStageInfo, SessionProgressInfo };
import {
	mountVolume,
	mountMesh,
	mountLabelMeshes,
	mountGltfSegmentation,
	type AssetMount,
	type Affine4x4,
	type ParsedAsset
} from './vtk-internal.js';
import {
	applyInitialView,
	computePlaneBounds,
	createPlaneIndicators
} from './camera.js';
import { validateCreateSessionInput } from './validation.js';

export interface SessionOptions {
	container: Element;
	assets: AssetDescriptor[];
	callbacks?: SessionCallbacks;
	/** Background RGB triplet in 0–1 floats. Defaults to the clinical token palette `#0F1C26`. */
	background?: [number, number, number];
}

export interface Session {
	getInfo(): {
		assets: Array<{ kind: AssetMount['kind']; visible: boolean } & Record<string, unknown>>;
		cameraBounds: number[];
		anatomyBounds: [number, number, number, number, number, number];
	};
	getMountImageData(index: number): unknown | null;
	setAssetVisibility(index: number, visible: boolean): void;
	setLabelVisibility(assetIndex: number, labelId: number, visible: boolean): boolean;
	setLabelVisibilityBulk(assetIndex: number, updates: Array<{ labelId: number; visible: boolean }>): void;
	/** Per-label opacity in 0..1. Returns false if the asset doesn't support per-label control. */
	setLabelOpacity(assetIndex: number, labelId: number, opacity: number): boolean;
	setCrosshair(world: { x: number; y: number; z: number }): void;
	/**
	 * Move a single plane indicator without disturbing the other two — used
	 * when the slice-scrub slider moves just one slice. setCrosshair() is
	 * still the right call when click-to-pick should sync all three planes.
	 */
	setPlaneAxisPosition(axis: 'x' | 'y' | 'z', value: number): void;
	hideCrosshair(): void;
	resetCamera(): void;
	setBackgroundColor(rgb: [number, number, number]): void;
	/** Toggle FXAA post-process antialiasing on the render window — live. */
	setUseFXAA(enabled: boolean): void;
	/**
	 * Stream a new asset into the existing renderer without rebuilding the session.
	 * Used for local-first flow: mount the volume immediately, then append the
	 * backend's segmentation overlay when inference completes.
	 */
	appendAsset(asset: AssetDescriptor, callbacks?: SessionCallbacks): Promise<number>;
	dispose(): void;
}

/** Default background — `--bg` token (#0F1C26) in 0–1 RGB. */
const DEFAULT_BACKGROUND: [number, number, number] = [0.058, 0.11, 0.149];

async function loadAsset(asset: AssetDescriptor, onProgress: (fraction: number) => void): Promise<ParsedAsset> {
	const ab = await readBytes(asset.source, onProgress);
	if ((asset.kind === 'volume' || asset.kind === 'labels') && asset.format === 'nifti') {
		const decompressed = isGzip(ab) ? gunzipToArrayBuffer(ab) : ab;
		const header = parseNiftiHeader(decompressed);
		const imageBuf = readNiftiImage(header, decompressed);
		return {
			...header,
			imageBuf,
			_assetKind: asset.kind,
			_schema: (asset as { schema?: LabelSchema }).schema,
			_presentation: (asset as { presentation?: 'standalone' | 'context' }).presentation
		} as ParsedAsset;
	}
	if ((asset.kind === 'volume' || asset.kind === 'labels') && asset.format === 'nrrd') {
		const decompressed = isGzip(ab) ? gunzipToArrayBuffer(ab) : ab;
		const parsed = parseNrrd(decompressed);
		return {
			...parsed,
			_assetKind: asset.kind,
			_schema: (asset as { schema?: LabelSchema }).schema,
			_presentation: (asset as { presentation?: 'standalone' | 'context' }).presentation
		} as ParsedAsset;
	}
	if (asset.kind === 'mesh' && asset.format === 'obj') {
		const parsed = parseObj(ab);
		return { ...parsed, _assetKind: 'mesh' } as ParsedAsset;
	}
	if (asset.kind === 'gltf-segmentation') {
		const parsed = asset.format === 'glb' ? parseGlb(ab) : parseGltf(new TextDecoder().decode(new Uint8Array(ab)));
		return { ...parsed, _assetKind: 'gltf-segmentation', _schema: asset.schema } as ParsedAsset;
	}
	throw new DxViewerError(
		ERROR_CODES.UNSUPPORTED_FORMAT,
		`No loader for kind='${asset.kind}', format='${(asset as { format: string }).format}'`
	);
}

/**
 * Compose the volume's voxel→world affine with a Y↔Z axis swap.
 *
 * Empirical observation on a real `pred_seg.gltf` from `/api/ai/cbct_seg_inference`
 * (verified against /Users/josh/Downloads/ToothFairy3F_007_0000.nii.gz):
 *
 *   - Input volume dims (NIfTI):  (X=410, Y=410, Z=255)
 *   - GLTF bounds:                 (X=1..409, Y=0..254, Z=6..290)
 *
 * So GLTF X matches volume X, GLTF Y's extent matches volume Z's extent, and
 * GLTF Z's extent fits inside volume Y. The backend (presumably trimesh or
 * a similar exporter) re-orients the marching-cubes output from the voxel grid's
 * Z-up convention into GLTF's Y-up convention. Without correcting for this
 * swap, the mesh sits at the wrong world position — its Y is rendered against
 * the volume's Y axis (~123mm range) but only covers ~76mm; its Z extends
 * above the top of the volume.
 *
 * The fix: post-multiply `indexToWorld` by a permutation matrix that swaps
 * the Y and Z input axes. Equivalent to: `(x,y,z)_world = indexToWorld · (x, z, y)_gltf`.
 * In a 4×4 column-major matrix this means swapping columns 1 and 2 — the
 * coefficients that say "how does input-Y/input-Z contribute to output XYZ".
 *
 * vtk.js: ImageData.computeTransforms writes indexToWorld column-major
 * (Common/DataModel/ImageData.js:160-171). setUserMatrix expects column-major
 * too (Prop3D.js:86-90, uses gl-matrix). So treating the flat array as
 * column-major and swapping cols 1↔2 is the right operation.
 */
function buildWorldTransform(imageData: unknown): Affine4x4 | null {
	const id = imageData as { getIndexToWorld?: () => ArrayLike<number> };
	if (!id || typeof id.getIndexToWorld !== 'function') return null;
	const m = id.getIndexToWorld();
	if (!m || m.length < 16) return null;
	// Swap columns 1 and 2: GLTF's Y axis → volume's voxel Z, GLTF's Z → voxel Y.
	return [
		m[0]!, m[1]!, m[2]!, m[3]!,           // col 0 (X): unchanged
		m[8]!, m[9]!, m[10]!, m[11]!,         // col 1 (was vol-Z col): now responds to GLTF Y
		m[4]!, m[5]!, m[6]!, m[7]!,           // col 2 (was vol-Y col): now responds to GLTF Z
		m[12]!, m[13]!, m[14]!, m[15]!        // col 3 (translation): unchanged
	];
}

function mountAsset(renderer: unknown, parsed: ParsedAsset, priorMounts: AssetMount[]): AssetMount {
	if (parsed._assetKind === 'volume') return mountVolume(renderer, parsed);
	if (parsed._assetKind === 'mesh') return mountMesh(renderer, parsed as ParsedAsset & { format: 'obj' } as never);
	if (parsed._assetKind === 'labels') {
		if (!parsed._schema) {
			throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'labels asset missing schema');
		}
		return mountLabelMeshes(renderer, parsed, parsed._schema);
	}
	if (parsed._assetKind === 'gltf-segmentation') {
		// If a volume or labels mount is already in place, treat the GLTF as
		// living in that volume's voxel-index space and apply the volume's
		// affine on top — matches what the AI seg endpoint actually returns
		// (mesh extracted directly from the voxel grid, no patient-space xform).
		const volumeMount = priorMounts.find((m) => m.kind === 'volume' || m.kind === 'labels');
		const transform = volumeMount?.imageData ? buildWorldTransform(volumeMount.imageData) : null;
		return mountGltfSegmentation(renderer, parsed as never, parsed._schema, transform);
	}
	throw new DxViewerError(ERROR_CODES.UNSUPPORTED_FORMAT, `No mount path for ${(parsed as { _assetKind: string })._assetKind}`);
}

export async function createSession(options: SessionOptions): Promise<Session> {
	validateCreateSessionInput(options);
	const { container, assets, callbacks } = options;
	const onStage = callbacks?.onStage ?? (() => {});
	const onProgress = callbacks?.onProgress ?? (() => {});

	const loaded: ParsedAsset[] = [];
	for (let i = 0; i < assets.length; i++) {
		const asset = assets[i]!;
		onStage({ phase: 'loading', assetIndex: i, kind: asset.kind, format: asset.format, via: asset.source.kind });
		const parsed = await loadAsset(asset, (fraction) => onProgress({ fraction, assetIndex: i }));
		loaded.push(parsed);
	}

	onStage({ phase: 'building' });
	await new Promise((r) => setTimeout(r, 16));

	const renderWindow = vtkGenericRenderWindow.newInstance({
		background: options.background ?? DEFAULT_BACKGROUND
	});
	renderWindow.setContainer(container as HTMLElement);
	renderWindow.resize();
	const renderer = renderWindow.getRenderer();
	const renWin = renderWindow.getRenderWindow();
	// FXAA antialiasing — kills the stair-step aliasing on mesh silhouettes
	// (visible especially on segmentation surfaces where marching cubes
	// triangles are large relative to screen pixels). Cheap post-process pass.
	try { renWin.setUseFXAA?.(true); } catch { /* ignore on older vtk.js */ }
	// Two-light setup so the segmentation reads as 3D from any angle. vtk's
	// default single headlight collapses to flat shading when the surface
	// normal aligns with the camera. A fill light from the opposite side
	// reveals shape on the shadowed half.
	try {
		const cam = renderer.getActiveCamera();
		const key = (renderer as { addLight?: (l: unknown) => void; makeLight?: () => { setLightTypeToCameraLight?: () => void; setPosition?: (x: number, y: number, z: number) => void; setIntensity?: (i: number) => void; setColor?: (r: number, g: number, b: number) => void; setFocalPoint?: (x: number, y: number, z: number) => void } });
		// vtk.js auto-adds a headlight on first render; we just dim it and add
		// a fill. If makeLight isn't available we skip — the default headlight
		// alone still works, just less revealing.
		if (typeof (renderer as { addLight?: unknown }).addLight === 'function' && typeof (renderer as { makeLight?: unknown }).makeLight === 'function') {
			const fill = key.makeLight!();
			fill.setLightTypeToCameraLight?.();
			fill.setPosition?.(-1, 0.3, 0.5);
			fill.setFocalPoint?.(0, 0, 0);
			fill.setIntensity?.(0.45);
			fill.setColor?.(1, 1, 1);
			(renderer as { addLight: (l: unknown) => void }).addLight(fill);
		}
		void cam;
	} catch { /* ignore — fall back to default lighting */ }

	onStage({ phase: 'rendering' });
	await new Promise((r) => setTimeout(r, 16));

	const mounts: AssetMount[] = [];
	try {
		// Mount in order; later assets see earlier mounts via the third arg so a
		// gltf-segmentation can read the volume's affine for world-space placement.
		for (const parsed of loaded) mounts.push(mountAsset(renderer, parsed, mounts));
	} catch (err) {
		for (const m of mounts) {
			try { m.dispose(); } catch { /* ignore */ }
		}
		try { renderWindow.delete(); } catch { /* ignore */ }
		throw err;
	}

	applyInitialView(renderer, renWin, mounts);
	const anatomyBounds = computePlaneBounds(renderer);
	const planeIndicators = createPlaneIndicators(renderer, anatomyBounds);

	let disposed = false;

	// Defer through rAF — same ResizeObserver-loop fix as slice-view.ts.
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

	// Retina/HiDPI: ResizeObserver doesn't fire on display DPR change (CSS
	// dimensions stay the same; only the drawing-buffer size needs updating).
	// Listen for window `resize` and trigger a re-resize when DPR shifts.
	let lastDpr = window.devicePixelRatio || 1;
	const onWindowResize = () => {
		const dpr = window.devicePixelRatio || 1;
		if (dpr !== lastDpr) {
			lastDpr = dpr;
			scheduleResize();
		}
	};
	window.addEventListener('resize', onWindowResize);

	onStage({ phase: 'ready' });

	function requireMount(index: number): AssetMount {
		if (disposed) throw new DxViewerError(ERROR_CODES.SESSION_DISPOSED, 'Session has been disposed');
		if (typeof index !== 'number' || index < 0 || index >= mounts.length) {
			throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, `Asset index ${index} out of range (have ${mounts.length} mounts)`, {
				index,
				mountsLength: mounts.length
			});
		}
		return mounts[index]!;
	}

	return {
		getInfo() {
			if (disposed) throw new DxViewerError(ERROR_CODES.SESSION_DISPOSED, 'Session has been disposed');
			return {
				assets: mounts.map((m) => ({ kind: m.kind, visible: m.isVisible(), ...m.info })),
				cameraBounds: renderer.computeVisiblePropBounds(),
				anatomyBounds
			};
		},
		getMountImageData(index) {
			const m = requireMount(index);
			return m.imageData ?? null;
		},
		setAssetVisibility(index, visible) {
			const m = requireMount(index);
			if (typeof visible !== 'boolean') {
				throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'setAssetVisibility(index, visible): visible must be boolean', { visible });
			}
			m.setVisible(visible);
			renWin.render();
		},
		setLabelVisibility(assetIndex, labelId, visible) {
			const m = requireMount(assetIndex);
			if (!m.setLabelVisibility) {
				throw new DxViewerError(
					ERROR_CODES.INVALID_ASSETS,
					`Asset at index ${assetIndex} does not support per-label visibility (kind='${m.kind}')`,
					{ assetIndex, kind: m.kind }
				);
			}
			if (typeof visible !== 'boolean') {
				throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'setLabelVisibility: visible must be boolean', { visible });
			}
			const ok = m.setLabelVisibility(labelId, visible);
			if (ok) renWin.render();
			return ok;
		},
		setLabelVisibilityBulk(assetIndex, updates) {
			const m = requireMount(assetIndex);
			if (!m.setLabelVisibility) {
				throw new DxViewerError(
					ERROR_CODES.INVALID_ASSETS,
					`Asset at index ${assetIndex} does not support per-label visibility (kind='${m.kind}')`
				);
			}
			if (!Array.isArray(updates)) {
				throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'setLabelVisibilityBulk: updates must be an array', { updates });
			}
			for (const u of updates) {
				if (typeof u.visible !== 'boolean') {
					throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'setLabelVisibilityBulk: update.visible must be boolean', { update: u });
				}
			}
			for (const u of updates) m.setLabelVisibility(u.labelId, u.visible);
			renWin.render();
		},
		setLabelOpacity(assetIndex, labelId, opacity) {
			const m = requireMount(assetIndex);
			if (!m.setLabelOpacity) return false;
			const ok = m.setLabelOpacity(labelId, opacity);
			if (ok) renWin.render();
			return ok;
		},
		setCrosshair(world) {
			if (disposed) return;
			if (!world || typeof world.x !== 'number' || typeof world.y !== 'number' || typeof world.z !== 'number') {
				throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'setCrosshair requires {x, y, z}', { world });
			}
			planeIndicators.setPosition(world);
			renWin.render();
		},
		setPlaneAxisPosition(axis, value) {
			if (disposed) return;
			if (typeof value !== 'number' || !Number.isFinite(value)) return;
			planeIndicators.setAxisPosition(axis, value);
			renWin.render();
		},
		hideCrosshair() {
			if (disposed) return;
			planeIndicators.setVisible(false);
			renWin.render();
		},
		resetCamera() {
			if (disposed) return;
			applyInitialView(renderer, renWin, mounts);
		},
		setBackgroundColor(rgb) {
			if (disposed) return;
			if (!Array.isArray(rgb) || rgb.length !== 3) {
				throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'setBackgroundColor requires [r,g,b]', { rgb });
			}
			renderer.setBackground(rgb[0], rgb[1], rgb[2]);
			renWin.render();
		},
		setUseFXAA(enabled) {
			if (disposed) return;
			try { renWin.setUseFXAA?.(!!enabled); } catch { /* ignore on older vtk.js */ }
			renWin.render();
		},
		async appendAsset(asset, appendCallbacks) {
			if (disposed) throw new DxViewerError(ERROR_CODES.SESSION_DISPOSED, 'Session has been disposed');
			const cbStage = appendCallbacks?.onStage ?? onStage;
			const cbProgress = appendCallbacks?.onProgress ?? onProgress;
			const assetIndex = mounts.length;
			cbStage({ phase: 'loading', assetIndex, kind: asset.kind, format: asset.format, via: asset.source.kind });
			const parsed = await loadAsset(asset, (fraction) => cbProgress({ fraction, assetIndex }));
			if (disposed) throw new DxViewerError(ERROR_CODES.SESSION_DISPOSED, 'Session disposed mid-append');
			cbStage({ phase: 'building', assetIndex });
			// Pass existing mounts so the appended asset (e.g. backend gltf seg)
			// can read the volume's affine and align to world space.
			const mount = mountAsset(renderer, parsed, mounts);
			// mountAsset already added the actor/volume to the renderer. If
			// dispose() landed during that synchronous call (or the previous
			// await), we'd leak: the renderer is about to be deleted but the
			// new mount isn't yet in mounts[] so the session's dispose loop
			// won't reach it. Roll back here.
			if (disposed) {
				try { mount.dispose(); } catch { /* ignore */ }
				throw new DxViewerError(ERROR_CODES.SESSION_DISPOSED, 'Session disposed mid-append');
			}
			mounts.push(mount);
			cbStage({ phase: 'rendering', assetIndex });
			renWin.render();
			cbStage({ phase: 'ready', assetIndex });
			return assetIndex;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			try { ro.disconnect(); } catch { /* ignore */ }
			try { window.removeEventListener('resize', onWindowResize); } catch { /* ignore */ }
			try { planeIndicators.dispose(); } catch { /* ignore */ }
			for (const m of mounts) {
				try { m.dispose(); } catch { /* ignore */ }
			}
			try { renderWindow.delete(); } catch { /* ignore */ }
		}
	};
}
