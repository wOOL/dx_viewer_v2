<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import * as THREE from 'three';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
	import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
	import { STLLoader } from 'three/addons/loaders/STLLoader.js';
	import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
	import isosurface from 'isosurface';
	import { prettifyMeshName } from '@be-certain/imaging-3d/gltfStats';
	import { assignFdiToGroups } from '@be-certain/imaging-3d/iosFdi';
	import { getRemesh, setRemesh, getRemeshGeoms } from '@be-certain/imaging-3d/remeshCache';
	import { disposeObject3D } from '@be-certain/imaging-3d/disposeObject3D';
	import { canDenoiseMesh } from '@be-certain/imaging-3d/denoiseGuard';
	import { isRenderableModel } from '@be-certain/imaging-3d/renderableModel';
	import { isDegenerateMeasure } from '@be-certain/imaging-3d/measure';
	import { toothDisplay } from '$lib/constants';
	import { measureKeyIntent } from '$lib/keyboard';

	const MAX_HIDDEN_COLORS = 64;

	interface MeshInfo {
		name: string;
		color: [number, number, number];
		triangles: number;
		bbox: { x: number; y: number; z: number };
		center?: { x: number; y: number; z: number };
		fdi?: number;
	}

	type ColorGroup = {
		key: string;
		displayName: string;
		fdi?: number;
		color: [number, number, number];
		vertexCount: number;
		center: { x: number; y: number; z: number };
	};

	interface MeshStats {
		count: number;
		totalTriangles: number;
		bbox: { x: number; y: number; z: number };
		meshInfos: MeshInfo[];
	}

	/** A committed surface measurement as two world-space endpoints (≈ mm). */
	interface MeasureSegment {
		a: [number, number, number];
		b: [number, number, number];
	}

	interface Props {
		gltfBlob: Blob | null;
		objBlob?: Blob | null;
		hiddenMeshes?: string[];
		reduceNoise?: boolean;
		wireframe?: boolean;
		background?: string;
		onstats?: (stats: MeshStats) => void;
		/** FDI tooth → index into the `meshes` array (CBCT only; from deriveToothMapping).
		 *  Lets a 3D click resolve to a tooth + the highlight find the right mesh. IOS
		 *  resolves teeth from its own vertex-colour groups instead. */
		fdiByMeshIndex?: Record<number, number>;
		/** Currently-selected tooth (FDI) to highlight, controlled by the parent. */
		selectedTooth?: number | null;
		/** Single-click a tooth in 3D (null = clicked empty space → deselect). */
		onselecttooth?: (fdi: number | null) => void;
		/** Double-click a tooth in 3D (open its detail). */
		onopentooth?: (fdi: number) => void;
		/** Show a floating tooth-number label while hovering the mesh (IOS). */
		hoverLabels?: boolean;
		/** Linear surface-measurement mode: clicks drop measurement points instead of
		 *  selecting teeth; two points commit a line + mm label. */
		measureMode?: boolean;
		/** Notified when the committed-measurement count changes (for the parent's UI). */
		onmeasurecount?: (n: number) => void;
		/** Notified with the full committed-measurement segment list (serializable
		 *  world-coord pairs) so the parent can persist them across reload (IOS). */
		onmeasurechange?: (segs: MeasureSegment[]) => void;
		/** Asked to leave measure mode (Escape with no pending point) — the parent
		 *  owns the measureMode flag, so it flips it off. */
		onexitmeasure?: () => void;
		/** Show the orientation widget (anatomical view snap) in the corner — CBCT 3D. */
		orientGizmo?: boolean;
	}

	const props: Props = $props();
	const gltfBlob = $derived(props.gltfBlob);
	const objBlob = $derived(props.objBlob ?? null);
	const hiddenMeshes = $derived(props.hiddenMeshes ?? []);
	const reduceNoise = $derived(props.reduceNoise ?? false);
	const wireframe = $derived(props.wireframe ?? false);
	const background = $derived(props.background ?? '#0e0f14');
	const onstats = $derived(props.onstats);

	// Drop islands below a triangle threshold. Off by default; can be enabled
	// from the workspace if AI output is unusually fragmented.
	function dropSmallComponents(
		geom: THREE.BufferGeometry,
		minTriangles: number
	): THREE.BufferGeometry {
		const idx = geom.getIndex();
		const pos = geom.getAttribute('position');
		if (!idx || !pos) return geom;
		const triCount = idx.count / 3;
		const parent = new Int32Array(pos.count);
		for (let i = 0; i < parent.length; i++) parent[i] = i;
		function find(x: number): number {
			while (parent[x] !== x) {
				parent[x] = parent[parent[x]];
				x = parent[x];
			}
			return x;
		}
		const indices = idx.array as Uint32Array;
		for (let t = 0; t < triCount; t++) {
			const a = indices[t * 3],
				b = indices[t * 3 + 1],
				c = indices[t * 3 + 2];
			const ra = find(a),
				rb = find(b);
			if (ra !== rb) parent[rb] = ra;
			const rc = find(c);
			if (ra !== rc) parent[rc] = ra;
		}
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive geometry scratch (union-find triangle counts)
		const triByRoot = new Map<number, number>();
		for (let t = 0; t < triCount; t++) {
			const r = find(indices[t * 3]);
			triByRoot.set(r, (triByRoot.get(r) ?? 0) + 1);
		}
		const keep: number[] = [];
		for (let t = 0; t < triCount; t++) {
			const r = find(indices[t * 3]);
			if ((triByRoot.get(r) ?? 0) >= minTriangles) {
				keep.push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
			}
		}
		if (keep.length === 0 || keep.length === indices.length) return geom;
		const out = geom.clone();
		out.setIndex(keep);
		return out;
	}

	let containerEl = $state<HTMLDivElement | null>(null);
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let animId = 0;
	let model: THREE.Object3D | null = null;
	let loadError = $state('');
	let isLoading = $state(false);
	// A brief note when the Reduce-noise cleanup is skipped because the mesh is too
	// large to denoise synchronously without freezing the tab (see denoiseGuard).
	let denoiseSkipped = $state(false);
	// Monotonic load token. loadGLTF/loadOBJ capture it at entry and bail after every
	// await if it has moved on — a rapid blob change (IOS rawBlob → segmented glb, or
	// a fresh seg landing while a cached one parses) starts a second load, and without
	// this the slower-finishing load would clobber the newer result / orphan a model.
	// Mirrors XrayCanvas's loadedKey stale-load guard (out-of-order completion).
	let loadSeq = 0;
	// Set when a WebGL context is lost; the render loop is stopped and we surface a
	// banner. On restore we re-init and reload the current blob.
	let contextLost = $state(false);
	// We keep two refs to each mesh's geometry so the Reduce-noise toggle can swap
	// between the raw (merged + normals) version and the cleaned (small-island-
	// dropped) version live without re-downloading the GLTF.
	//
	// `colorGroups` is populated for vertex-coloured meshes (IOS GLBs): each entry
	// is one quantised colour found in the COLOR_0 attribute, surfaced as a
	// virtual sub-mesh in the Layers panel so the user can hide individual teeth.
	let meshes = $state<
		{
			name: string;
			mesh: THREE.Mesh;
			rawGeom: THREE.BufferGeometry;
			cleanGeom?: THREE.BufferGeometry;
			colorGroups?: ColorGroup[];
		}[]
	>([]);

	// Quantise floats to 1/32 buckets so near-identical colours collapse into one
	// group (mesh blending / filtering may smear colours).
	function quantColor(
		r: number,
		g: number,
		b: number
	): { key: string; r8: number; g8: number; b8: number } {
		const q = (v: number) => Math.min(31, Math.max(0, Math.round(v * 31)));
		const qr = q(r),
			qg = q(g),
			qb = q(b);
		return {
			key: `${qr}_${qg}_${qb}`,
			r8: Math.round((qr / 31) * 255),
			g8: Math.round((qg / 31) * 255),
			b8: Math.round((qb / 31) * 255)
		};
	}

	// Spatial vertex-colour-group → FDI assignment lives in $lib/cbct/iosFdi (pure +
	// unit-tested; imported at the top of this module).

	// Inject a fragment-shader discard for hidden colour groups. We push a
	// `uHiddenColors` uniform (vec3 array, max 32) — every fragment whose vertex
	// colour is closer than 0.05 to any entry is discarded.
	function attachVertexColorHideShader(mesh: THREE.Mesh) {
		const mat = mesh.material as THREE.MeshStandardMaterial;
		const uniforms = {
			uHiddenColors: {
				value: new Array(MAX_HIDDEN_COLORS).fill(0).map(() => new THREE.Vector3(-1, -1, -1))
			},
			uHiddenCount: { value: 0 },
			// Tooth-selection highlight: when uSelActive > 0.5, fragments whose vertex
			// colour is NOT the selected tooth's colour are dimmed (so the selected
			// tooth pops). uSelColor = the selected tooth's quantised colour.
			uSelColor: { value: new THREE.Vector3(-1, -1, -1) },
			uSelActive: { value: 0 }
		};
		// store on the userData so we can update later
		(mesh as unknown as { __hideUniforms: typeof uniforms }).__hideUniforms = uniforms;
		mat.onBeforeCompile = (shader) => {
			shader.uniforms.uHiddenColors = uniforms.uHiddenColors;
			shader.uniforms.uHiddenCount = uniforms.uHiddenCount;
			shader.uniforms.uSelColor = uniforms.uSelColor;
			shader.uniforms.uSelActive = uniforms.uSelActive;
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				`#include <common>
uniform vec3 uHiddenColors[64];
uniform int uHiddenCount;
uniform vec3 uSelColor;
uniform float uSelActive;`
			);
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
// vColor may be vec3 (USE_COLOR) or vec4 (USE_COLOR_ALPHA) — swizzle to .rgb so
// the distance() overload resolves consistently. Skip the loop entirely when
// uHiddenCount is 0 to avoid sentinel comparisons (-1,-1,-1).
if (uHiddenCount > 0) {
  for (int i = 0; i < 64; i++) {
    if (i >= uHiddenCount) break;
    if (distance(vColor.rgb, uHiddenColors[i]) < 0.05) discard;
  }
}
// Selection highlight: dim every tooth except the selected one.
if (uSelActive > 0.5 && distance(vColor.rgb, uSelColor) >= 0.05) {
  diffuseColor.rgb *= 0.22;
}`
			);
		};
		mat.needsUpdate = true;
	}

	function applyHiddenColors(
		mesh: THREE.Mesh,
		hiddenDisplayNames: string[],
		colorGroups: { displayName: string; color: [number, number, number] }[]
	) {
		const u = (
			mesh as unknown as {
				__hideUniforms?: {
					uHiddenColors: { value: THREE.Vector3[] };
					uHiddenCount: { value: number };
				};
			}
		).__hideUniforms;
		if (!u) return;
		const matches = colorGroups.filter((g) => hiddenDisplayNames.includes(g.displayName));
		for (let i = 0; i < u.uHiddenColors.value.length; i++) {
			if (i < matches.length) {
				u.uHiddenColors.value[i].set(matches[i].color[0], matches[i].color[1], matches[i].color[2]);
			} else {
				u.uHiddenColors.value[i].set(-1, -1, -1);
			}
		}
		if (matches.length > MAX_HIDDEN_COLORS) {
			console.warn(
				`Volume3D: ${matches.length} hidden colours exceeds shader cap ${MAX_HIDDEN_COLORS}; extras ignored.`
			);
		}
		u.uHiddenCount.value = Math.min(matches.length, MAX_HIDDEN_COLORS);
	}

	function scanColorGroups(geom: THREE.BufferGeometry) {
		const col = geom.getAttribute('color');
		const pos = geom.getAttribute('position');
		if (!col || !pos) return null;
		type Group = {
			key: string;
			sumX: number;
			sumY: number;
			sumZ: number;
			vertexCount: number;
			r8: number;
			g8: number;
			b8: number;
		};
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive geometry scratch (vertex-colour grouping)
		const groups = new Map<string, Group>();
		for (let i = 0; i < col.count; i++) {
			const q = quantColor(col.getX(i), col.getY(i), col.getZ(i));
			const existing = groups.get(q.key);
			const x = pos.getX(i),
				y = pos.getY(i),
				z = pos.getZ(i);
			if (existing) {
				existing.sumX += x;
				existing.sumY += y;
				existing.sumZ += z;
				existing.vertexCount++;
			} else {
				groups.set(q.key, {
					key: q.key,
					sumX: x,
					sumY: y,
					sumZ: z,
					vertexCount: 1,
					r8: q.r8,
					g8: q.g8,
					b8: q.b8
				});
			}
		}
		// Adaptive threshold: max(50, meanGroupSize / 10). Lets small but real teeth
		// survive while still dropping near-zero blend artifacts.
		const all = [...groups.values()];
		if (all.length === 0) return null;
		const meanSize = all.reduce((a, g) => a + g.vertexCount, 0) / all.length;
		const minVertices = Math.max(50, Math.round(meanSize / 10));
		const out = all.filter((g) => g.vertexCount >= minVertices);
		if (out.length <= 1) return null;
		return out.map((g) => ({
			key: g.key,
			color: [g.r8 / 255, g.g8 / 255, g.b8 / 255] as [number, number, number],
			vertexCount: g.vertexCount,
			center: { x: g.sumX / g.vertexCount, y: g.sumY / g.vertexCount, z: g.sumZ / g.vertexCount }
		}));
	}

	// ─────────────── Tooth-click selection (raycast → FDI) ───────────────
	const raycaster = new THREE.Raycaster();
	// IOS: flattened vertex-colour groups (quantised colour key + FDI) for click→tooth.
	let colorPickGroups: { key: string; color: [number, number, number]; fdi?: number }[] = [];
	let isIos = false;

	function rebuildToothMaps() {
		colorPickGroups = meshes.flatMap((e) => e.colorGroups ?? []);
		isIos = colorPickGroups.length > 0;
	}

	// Resolve a pointer position to an FDI tooth number (null = nothing/no tooth hit).
	function pickToothAt(e: PointerEvent | MouseEvent): number | null {
		if (!renderer || !camera || !model) return null;
		const rect = renderer.domElement.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;
		const ndc = new THREE.Vector2(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(ndc, camera);
		const hits = raycaster
			.intersectObject(model, true)
			.filter((h) => (h.object as THREE.Mesh).visible);
		if (!hits.length) return null;
		const hit = hits[0];
		const mesh = hit.object as THREE.Mesh;
		if (isIos) {
			// IOS: read the vertex colour at the hit face → match a colour group → FDI.
			const col = (mesh.geometry as THREE.BufferGeometry).getAttribute('color');
			if (!col || !hit.face) return null;
			const q = quantColor(col.getX(hit.face.a), col.getY(hit.face.a), col.getZ(hit.face.a));
			return colorPickGroups.find((g) => g.key === q.key)?.fdi ?? null;
		}
		// CBCT: clicked mesh → its index in `meshes` → reverse the fdiByMeshIndex map.
		const idx = meshes.findIndex((m) => m.mesh === mesh);
		const map = props.fdiByMeshIndex;
		if (idx < 0 || !map) return null;
		for (const [fdi, mi] of Object.entries(map)) if (mi === idx) return Number(fdi);
		return null;
	}

	// Highlight the selected tooth: IOS dims every other tooth via the shader uniform;
	// CBCT fades every other mesh so the selected tooth stands out.
	function applyToothHighlight(fdi: number | null) {
		if (!model) return;
		if (isIos) {
			const sel = fdi != null ? colorPickGroups.find((g) => g.fdi === fdi) : undefined;
			for (const entry of meshes) {
				const u = (
					entry.mesh as unknown as {
						__hideUniforms?: {
							uSelColor: { value: THREE.Vector3 };
							uSelActive: { value: number };
						};
					}
				).__hideUniforms;
				if (!u) continue;
				if (sel) {
					u.uSelColor.value.set(sel.color[0], sel.color[1], sel.color[2]);
					u.uSelActive.value = 1;
				} else {
					u.uSelActive.value = 0;
				}
			}
			return;
		}
		const map = props.fdiByMeshIndex;
		const selIdx = fdi != null && map ? map[fdi] : undefined;
		for (let i = 0; i < meshes.length; i++) {
			const mat = meshes[i].mesh.material as THREE.MeshStandardMaterial | undefined;
			if (!mat || !('opacity' in mat)) continue;
			const dim = fdi != null && selIdx !== undefined && i !== selIdx;
			mat.opacity = dim ? 0.18 : 1;
			mat.transparent = dim;
			mat.needsUpdate = true;
		}
	}

	// ─────────────── Hover labels + linear surface measurement (IOS) ───────────────
	let hoverFdi = $state<number | null>(null);
	let hoverX = $state(0);
	let hoverY = $state(0);
	let measureGroup: THREE.Group | null = null;
	let measurePending: THREE.Vector3 | null = null;
	let measurePendingMarker: THREE.Mesh | null = null;
	let measureCount = 0;
	// Serializable copy of every committed segment (world coords ≈ mm) so the parent
	// can persist them across a reload and replay via loadMeasurements().
	let measureSegments: MeasureSegment[] = [];

	function modelScaleHint(): number {
		if (!model) return 5;
		const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
		return Math.max(size.x, size.y, size.z) * 0.035 || 5;
	}

	function ensureMeasureGroup(): THREE.Group | null {
		if (!measureGroup && scene) {
			measureGroup = new THREE.Group();
			scene.add(measureGroup);
		}
		return measureGroup;
	}

	function makeLabelSprite(text: string): THREE.Sprite {
		const pad = 10;
		const font = 36;
		const cnv = document.createElement('canvas');
		const cx = cnv.getContext('2d')!;
		cx.font = `${font}px system-ui`;
		cnv.width = Math.ceil(cx.measureText(text).width) + pad * 2;
		cnv.height = font + pad * 2;
		cx.font = `${font}px system-ui`;
		cx.fillStyle = 'rgba(10,10,12,0.78)';
		cx.fillRect(0, 0, cnv.width, cnv.height);
		cx.fillStyle = '#fde68a';
		cx.textBaseline = 'middle';
		cx.fillText(text, pad, cnv.height / 2);
		const tex = new THREE.CanvasTexture(cnv);
		tex.colorSpace = THREE.SRGBColorSpace;
		const sp = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
		);
		const s = modelScaleHint();
		sp.scale.set((cnv.width / cnv.height) * s, s, 1);
		return sp;
	}

	// Raycast a pointer to a 3D point on the visible mesh surface (world coords ≈ mm).
	function pickPoint3D(e: PointerEvent): THREE.Vector3 | null {
		if (!renderer || !camera || !model) return null;
		const rect = renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(ndc, camera);
		const hits = raycaster
			.intersectObject(model, true)
			.filter((h) => (h.object as THREE.Mesh).visible);
		return hits.length ? hits[0].point.clone() : null;
	}

	function addMeasurementLine(a: THREE.Vector3, b: THREE.Vector3) {
		const g = ensureMeasureGroup();
		if (!g) return;
		const line = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints([a, b]),
			new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false })
		);
		line.renderOrder = 999;
		g.add(line);
		const dotR = modelScaleHint() * 0.14;
		for (const p of [a, b]) {
			const dot = new THREE.Mesh(
				new THREE.SphereGeometry(dotR, 12, 12),
				new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthTest: false })
			);
			dot.position.copy(p);
			dot.renderOrder = 999;
			g.add(dot);
		}
		const sp = makeLabelSprite(
			`${a.distanceTo(b).toLocaleString($locale ?? undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`
		);
		sp.position.copy(a.clone().add(b).multiplyScalar(0.5));
		sp.renderOrder = 1000;
		g.add(sp);
		measureCount++;
		measureSegments = [...measureSegments, { a: [a.x, a.y, a.z], b: [b.x, b.y, b.z] }];
		props.onmeasurecount?.(measureCount);
		props.onmeasurechange?.(measureSegments);
	}

	function handleMeasureClick(e: PointerEvent) {
		const p = pickPoint3D(e);
		if (!p) return;
		if (!measurePending) {
			measurePending = p;
			const g = ensureMeasureGroup();
			if (g) {
				measurePendingMarker = new THREE.Mesh(
					new THREE.SphereGeometry(modelScaleHint() * 0.14, 12, 12),
					new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false })
				);
				measurePendingMarker.position.copy(p);
				measurePendingMarker.renderOrder = 1000;
				g.add(measurePendingMarker);
			}
		} else {
			// Ignore a degenerate 2nd click (≈ the 1st point — e.g. a fat-finger double-click):
			// committing it would persist a useless 0 mm segment. Mirrors the MprPane ruler's
			// bare-click guard. Keep the pending point + marker so a real 2nd click still measures.
			if (isDegenerateMeasure(measurePending.distanceTo(p), modelScaleHint())) return;
			if (measurePendingMarker && measureGroup) {
				measureGroup.remove(measurePendingMarker);
				measurePendingMarker = null;
			}
			addMeasurementLine(measurePending, p);
			measurePending = null;
		}
	}

	/** Abort an in-progress (one-click) measurement — removes the floating marker
	 *  and forgets the first point, so the user can back out without being forced
	 *  to drop a second point or clear every measurement. */
	function cancelPendingMeasurement() {
		if (measurePendingMarker && measureGroup) measureGroup.remove(measurePendingMarker);
		measurePendingMarker = null;
		measurePending = null;
	}

	/** Remove the most recently committed segment (keyboard undo). Rebuilds the
	 *  scene group from the trimmed list via loadMeasurements(), then notifies the
	 *  parent — loadMeasurements() only fires the callbacks for a non-empty list, so
	 *  the explicit notify here also covers undoing the final segment back to zero. */
	function undoLastMeasurement() {
		if (measureSegments.length === 0) return;
		loadMeasurements(measureSegments.slice(0, -1));
		props.onmeasurecount?.(measureCount);
		props.onmeasurechange?.(measureSegments);
	}

	// Keyboard back-out for the surface-measure tool (IOS). Escape cancels a pending
	// point or leaves the tool; Backspace/Delete undoes the last segment. Guarded so
	// it's inert unless measure mode is active and the user isn't typing in a field.
	function onMeasureKeydown(e: KeyboardEvent) {
		const intent = measureKeyIntent(e.key, {
			measureMode: props.measureMode,
			hasPending: measurePending !== null,
			hasSegments: measureSegments.length > 0,
			target: e.target
		});
		if (!intent) return;
		e.preventDefault();
		if (intent === 'cancel-pending') cancelPendingMeasurement();
		else if (intent === 'undo-last') undoLastMeasurement();
		else if (intent === 'exit-mode') props.onexitmeasure?.();
	}

	export function clearMeasurements() {
		if (measureGroup && scene) scene.remove(measureGroup);
		measureGroup = null;
		measurePending = null;
		measurePendingMarker = null;
		measureCount = 0;
		measureSegments = [];
		props.onmeasurecount?.(0);
		props.onmeasurechange?.(measureSegments);
	}

	/** Replay persisted measurements after the mesh is ready (parent restore on reload).
	 *  Replaces any existing segments so a double-call can't duplicate them. */
	export function loadMeasurements(segs: MeasureSegment[]) {
		if (measureGroup && scene) scene.remove(measureGroup);
		measureGroup = null;
		measureCount = 0;
		measureSegments = [];
		for (const s of segs) {
			addMeasurementLine(
				new THREE.Vector3(s.a[0], s.a[1], s.a[2]),
				new THREE.Vector3(s.b[0], s.b[1], s.b[2])
			);
		}
	}

	onMount(() => {
		init();
	});

	let resizeObserver: ResizeObserver | null = null;

	onDestroy(() => {
		cancelAnimationFrame(animId);
		// Disconnect the resize observer — otherwise it holds a reference to the
		// (now removed) container element. Modern browsers eventually clean these
		// up, but disconnect() is the safe explicit teardown.
		resizeObserver?.disconnect();
		resizeObserver = null;
		// Remove the WebGL context-loss listeners we added in init().
		detachContextLossHandlers();
		// Dispose every GPU resource the scene built — mesh geometries + materials +
		// material textures (model), the measurement Line/Sphere geometries+materials,
		// and the label/marker Sprite CanvasTextures (measureGroup). renderer.dispose()
		// alone frees NONE of these, so each opened-then-left study leaked them until
		// the browser dropped the WebGL context. Skip geometries still held by the
		// remesh cache (a same-blob reload reuses them). Traversing `scene` covers the
		// model + measureGroup + pending marker in one pass.
		const keep = remeshGeomKeepSet();
		disposeObject3D(scene, keep);
		// `model`/`measureGroup` may have been detached from `scene` (clear/replace)
		// but still hold live GPU resources — dispose them too (idempotent if already
		// freed via the scene traversal: their dispose() just no-ops the second time).
		disposeObject3D(model, keep);
		disposeObject3D(measureGroup, keep);
		disposeObject3D(measurePendingMarker, keep);
		controls?.dispose();
		renderer?.dispose();
		renderer?.domElement.remove();
		scene = null;
		model = null;
		measureGroup = null;
		measurePendingMarker = null;
	});

	// ─────────────── WebGL context-loss handling ───────────────
	// A lost GPU context (driver reset, too many live contexts — which a VRAM leak
	// accelerates — or a low-memory tab) makes the render loop silently no-op and the
	// canvas go black with no message. We stop the loop + surface a banner on loss,
	// and on restore re-init the renderer and reload the current blob.
	function onContextLost(e: Event) {
		// preventDefault tells the browser we'll handle restoration (enables the
		// matching restored event).
		e.preventDefault();
		contextLost = true;
		cancelAnimationFrame(animId);
	}
	function onContextRestored() {
		contextLost = false;
		// Rebuild the renderer/scene/camera and replay the current blob. reinitAfterRestore
		// guards against a failed re-init leaving a half-built viewer.
		reinitAfterRestore();
	}
	function attachContextLossHandlers() {
		const el = renderer?.domElement;
		if (!el) return;
		el.addEventListener('webglcontextlost', onContextLost as EventListener, false);
		el.addEventListener('webglcontextrestored', onContextRestored as EventListener, false);
	}
	function detachContextLossHandlers() {
		const el = renderer?.domElement;
		if (!el) return;
		el.removeEventListener('webglcontextlost', onContextLost as EventListener, false);
		el.removeEventListener('webglcontextrestored', onContextRestored as EventListener, false);
	}

	function reinitAfterRestore() {
		try {
			// Tear down the dead renderer + its listeners, then rebuild from scratch and
			// reload whichever blob is current. The remesh cache keeps geometry recompute
			// cheap; the keep-set is irrelevant here since we're rebuilding the scene.
			detachContextLossHandlers();
			controls?.dispose();
			renderer?.dispose();
			renderer?.domElement.remove();
			renderer = null;
			scene = null;
			model = null;
			measureGroup = null;
			measurePendingMarker = null;
			measureCount = 0;
			measureSegments = [];
			loadError = '';
			init();
			if (gltfBlob) loadGLTF(gltfBlob);
			else if (objBlob) loadOBJ(objBlob);
		} catch (err) {
			console.warn('WebGL context restore failed', err);
			loadError = $_('cbct.contextRestoreFailed');
		}
	}

	function init() {
		if (!containerEl) return;
		const w = containerEl.clientWidth;
		const h = containerEl.clientHeight;

		scene = new THREE.Scene();
		scene.background = new THREE.Color(background);

		camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 5000);
		camera.position.set(0, 0, 200);

		renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.setSize(w, h);
		// eslint-disable-next-line svelte/no-dom-manipulating -- canonical Three.js canvas mount (see CLAUDE.md); Svelte never renders into this container
		containerEl.appendChild(renderer.domElement);
		attachContextLossHandlers();

		controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;

		// Tooth-click selection. A press-release that barely moves is a click (select);
		// a drag is an orbit (OrbitControls handles it, we skip). Double-click opens detail.
		let downX = 0;
		let downY = 0;
		renderer.domElement.addEventListener('pointerdown', (e) => {
			downX = e.clientX;
			downY = e.clientY;
		});
		renderer.domElement.addEventListener('pointerup', (e) => {
			if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // was a drag
			if (props.measureMode) {
				handleMeasureClick(e);
				return;
			}
			props.onselecttooth?.(pickToothAt(e));
		});
		renderer.domElement.addEventListener('dblclick', (e) => {
			if (props.measureMode) return;
			const fdi = pickToothAt(e);
			if (fdi != null) props.onopentooth?.(fdi);
		});
		renderer.domElement.addEventListener('pointermove', (e) => {
			if (!props.hoverLabels) {
				if (hoverFdi !== null) hoverFdi = null;
				return;
			}
			const rect = renderer!.domElement.getBoundingClientRect();
			hoverX = e.clientX - rect.left;
			hoverY = e.clientY - rect.top;
			hoverFdi = pickToothAt(e);
		});

		const ambient = new THREE.AmbientLight(0xffffff, 0.6);
		scene.add(ambient);
		const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
		dir1.position.set(100, 100, 100);
		scene.add(dir1);
		const dir2 = new THREE.DirectionalLight(0xaaccff, 0.4);
		dir2.position.set(-100, -50, -100);
		scene.add(dir2);

		resizeObserver = new ResizeObserver(() => {
			if (!renderer || !camera || !containerEl) return;
			const w2 = containerEl.clientWidth;
			const h2 = containerEl.clientHeight;
			renderer.setSize(w2, h2);
			camera.aspect = w2 / h2;
			camera.updateProjectionMatrix();
		});
		resizeObserver.observe(containerEl);

		animate();
	}

	function animate() {
		animId = requestAnimationFrame(animate);
		controls?.update();
		if (renderer && scene && camera) renderer.render(scene, camera);
	}

	// Re-mesh a holey/broken voxel-segmentation surface into a clean WATERTIGHT one by
	// voxelizing its VOLUME and re-extracting an isosurface (surfaceNets, from the
	// `isosurface` lib). The AI's bone/jaw AND tooth meshes are porous, non-manifold shells
	// (~11% boundary edges even after welding) that smoothing/welding/decimation/hole-
	// filling can't repair — but re-surfacing the volume ignores the broken topology
	// entirely. Voxelize → morphological close (seal gaps) → flood-fill exterior →
	// surfaceNets. Returns a new geometry, or null on failure (caller keeps the original).
	function voxelRemesh(geom: THREE.BufferGeometry, targetAxis = 150): THREE.BufferGeometry | null {
		const posAttr = geom.getAttribute('position');
		if (!posAttr) return null;
		const pos = posAttr.array as ArrayLike<number>;
		const idxAttr = geom.getIndex();
		const idx = idxAttr ? (idxAttr.array as ArrayLike<number>) : null;
		const mn = [Infinity, Infinity, Infinity];
		const mx = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < pos.length; i += 3)
			for (let k = 0; k < 3; k++) {
				const v = pos[i + k];
				if (v < mn[k]) mn[k] = v;
				if (v > mx[k]) mx[k] = v;
			}
		const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
		const vs = Math.max(ext[0], ext[1], ext[2]) / targetAxis;
		if (!(vs > 0)) return null;
		const pad = 3;
		const nx = Math.ceil(ext[0] / vs) + 2 * pad;
		const ny = Math.ceil(ext[1] / vs) + 2 * pad;
		const nz = Math.ceil(ext[2] / vs) + 2 * pad;
		if (nx * ny * nz > 9_000_000) return null; // perf guard
		const gi = (x: number, y: number, z: number) => x + nx * (y + ny * z);
		const occ = new Uint8Array(nx * ny * nz);
		// Voxelize: barycentric-sample each triangle into the occupancy grid.
		const rasterize = (a: number, b: number, c: number) => {
			const Ax = pos[a],
				Ay = pos[a + 1],
				Az = pos[a + 2];
			const Bx = pos[b],
				By = pos[b + 1],
				Bz = pos[b + 2];
			const Cx = pos[c],
				Cy = pos[c + 1],
				Cz = pos[c + 2];
			const s = Math.max(
				1,
				Math.ceil(
					(Math.max(Math.hypot(Bx - Ax, By - Ay, Bz - Az), Math.hypot(Cx - Ax, Cy - Ay, Cz - Az)) /
						vs) *
						1.5
				)
			);
			for (let i = 0; i <= s; i++)
				for (let j = 0; j <= s - i; j++) {
					const u = i / s,
						v = j / s;
					const x = Math.floor((Ax + u * (Bx - Ax) + v * (Cx - Ax) - mn[0]) / vs) + pad;
					const y = Math.floor((Ay + u * (By - Ay) + v * (Cy - Ay) - mn[1]) / vs) + pad;
					const z = Math.floor((Az + u * (Bz - Az) + v * (Cz - Az) - mn[2]) / vs) + pad;
					if (x >= 0 && x < nx && y >= 0 && y < ny && z >= 0 && z < nz) occ[gi(x, y, z)] = 1;
				}
		};
		if (idx)
			for (let t = 0; t < idx.length; t += 3) rasterize(idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3);
		else for (let t = 0; t < pos.length; t += 9) rasterize(t, t + 3, t + 6);
		// Morphological close (dilate² then erode², 6-neighbour) to seal the gaps.
		const dil = (g: Uint8Array) => {
			const o = new Uint8Array(g.length);
			for (let z = 1; z < nz - 1; z++)
				for (let y = 1; y < ny - 1; y++)
					for (let x = 1; x < nx - 1; x++) {
						const k = gi(x, y, z);
						if (
							g[k] ||
							g[k - 1] ||
							g[k + 1] ||
							g[k - nx] ||
							g[k + nx] ||
							g[k - nx * ny] ||
							g[k + nx * ny]
						)
							o[k] = 1;
					}
			return o;
		};
		const ero = (g: Uint8Array) => {
			const o = new Uint8Array(g.length);
			for (let z = 1; z < nz - 1; z++)
				for (let y = 1; y < ny - 1; y++)
					for (let x = 1; x < nx - 1; x++) {
						const k = gi(x, y, z);
						if (
							g[k] &&
							g[k - 1] &&
							g[k + 1] &&
							g[k - nx] &&
							g[k + nx] &&
							g[k - nx * ny] &&
							g[k + nx * ny]
						)
							o[k] = 1;
					}
			return o;
		};
		let g = dil(occ);
		g = dil(g);
		g = ero(g);
		g = ero(g);
		// Flood-fill the exterior (from a padded corner) through empty voxels; whatever
		// the flood can't reach is interior → solid = shell + interior.
		const exo = new Uint8Array(g.length);
		const st: number[] = [0];
		exo[0] = 1;
		while (st.length) {
			const k = st.pop() as number;
			for (const nk of [k - 1, k + 1, k - nx, k + nx, k - nx * ny, k + nx * ny]) {
				if (nk < 0 || nk >= g.length || g[nk] || exo[nk]) continue;
				exo[nk] = 1;
				st.push(nk);
			}
		}
		const solid = new Uint8Array(g.length);
		for (let k = 0; k < g.length; k++) solid[k] = g[k] || !exo[k] ? 1 : 0;
		// Re-surface the solid volume (surfaceNets → smooth, watertight).
		const res = isosurface.surfaceNets([nx, ny, nz], (x, y, z) =>
			x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 1 : solid[gi(x, y, z)] ? -1 : 1
		);
		if (!res || !res.positions.length || !res.cells.length) return null;
		const verts = new Float32Array(res.positions.length * 3);
		for (let i = 0; i < res.positions.length; i++) {
			const p = res.positions[i];
			verts[i * 3] = (p[0] - pad) * vs + mn[0];
			verts[i * 3 + 1] = (p[1] - pad) * vs + mn[1];
			verts[i * 3 + 2] = (p[2] - pad) * vs + mn[2];
		}
		const tris: number[] = [];
		for (const c of res.cells) {
			if (c.length === 4) tris.push(c[0], c[1], c[2], c[0], c[2], c[3]);
			else if (c.length === 3) tris.push(c[0], c[1], c[2]);
		}
		const out = new THREE.BufferGeometry();
		out.setAttribute('position', new THREE.BufferAttribute(verts, 3));
		out.setIndex(tris);
		out.computeVertexNormals();
		return out;
	}

	// Geometries the remesh cache still references for the current blobs — these must
	// survive a model dispose (the cache hands them back on the next load; disposing
	// one would render a GPU-freed geometry + force a costly re-remesh).
	function remeshGeomKeepSet(): Set<unknown> {
		return new Set<unknown>([...getRemeshGeoms(gltfBlob), ...getRemeshGeoms(objBlob)]);
	}

	async function loadGLTF(blob: Blob) {
		if (!scene) return;
		// Stale-load guard: claim a sequence number; any later load supersedes us.
		const mySeq = ++loadSeq;
		if (model) {
			scene.remove(model);
			// Free the outgoing model's GPU resources (except cached remesh geometries,
			// which a re-load of the same blob will reuse).
			disposeObject3D(model, remeshGeomKeepSet());
			model = null;
			meshes = [];
		}
		isLoading = true;
		loadError = '';
		// Held outside the loader try/await so the finally below can revoke it
		// even on a GLTFLoader reject (corrupt/truncated file) — previously the
		// revoke after `load()` was skipped on throw, leaking the blob URL per
		// failed load.
		const url = URL.createObjectURL(blob);
		try {
			const loader = new GLTFLoader();
			const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
				loader.load(
					url,
					(g) => resolve(g as { scene: THREE.Object3D }),
					undefined,
					(err) => reject(err)
				);
			});
			// A newer load started while we awaited the loader — drop this result so the
			// slower load can't clobber the current one or orphan its model.
			if (mySeq !== loadSeq) {
				disposeObject3D(gltf.scene, remeshGeomKeepSet());
				return;
			}
			model = gltf.scene;
			const collected: {
				name: string;
				mesh: THREE.Mesh;
				rawGeom: THREE.BufferGeometry;
				cleanGeom?: THREE.BufferGeometry;
				colorGroups?: ColorGroup[];
			}[] = [];
			// Collect the meshes first, then process them in an async loop that yields
			// between meshes — the voxel re-mesh below is ~2.5s of CPU and doing it in one
			// synchronous traverse would freeze the tab (frozen spinner). Yielding keeps the
			// loading spinner animating and the tab responsive.
			const rawMeshes: THREE.Mesh[] = [];
			model.traverse((obj) => {
				const mesh = obj as THREE.Mesh;
				if (mesh.isMesh) rawMeshes.push(mesh);
			});
			let meshIndex = 0;
			for (const mesh of rawMeshes) {
				let geom = mesh.geometry as THREE.BufferGeometry | undefined;
				if (geom) {
					// Reuse the already-remeshed geometry for this blob if it's cached — switching
					// CBCT layouts (MPR ↔ 3D) remounts this component and would otherwise re-run the
					// ~2.5s remesh on the SAME segmentation. A cache hit is the bit-identical result,
					// so rendering is unchanged; only the recompute is skipped (see remeshCache).
					const cached = getRemesh(blob, meshIndex);
					if (cached) {
						geom = cached;
					} else {
						// AI bone/jaw AND tooth meshes are porous, non-manifold shells that render
						// with "holes" at any real zoom. Re-surface their VOLUME into a clean
						// watertight mesh (voxelize → morphological close → flood-fill → surfaceNets)
						// so they look solid + smooth. Big jaws get a fine grid (150 vox); the smaller,
						// more numerous tooth meshes a coarser one (48 vox) to keep total time ~2.5s.
						// Skipped: thin structures (nerve canals, <1000 tri — voxelizing a tube fattens
						// it) and vertex-coloured meshes (re-meshing would drop the colours).
						const triCount = geom.getIndex()
							? geom.getIndex()!.count / 3
							: (geom.getAttribute('position')?.count ?? 0) / 3;
						let remeshed = false;
						if (triCount > 1000 && !geom.getAttribute('color')) {
							try {
								const rm = voxelRemesh(geom, triCount > 30000 ? 150 : 48);
								if (rm) {
									geom = rm;
									remeshed = true;
								}
							} catch (e) {
								console.warn('voxelRemesh failed', e);
							}
						}
						if (!remeshed) {
							// VTK GLTFs ship duplicated per-triangle vertices and no NORMAL attribute;
							// weld so per-vertex normals smooth the surface. (Re-meshed geom is already
							// clean + indexed, so this is skipped for it.)
							try {
								geom = mergeVertices(geom, 1e-4);
							} catch (e) {
								console.warn('mergeVertices failed', e);
							}
						}
						geom.computeVertexNormals();
						setRemesh(blob, meshIndex, geom);
					}
					mesh.geometry = geom;
				}
				const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
				if (mat && 'side' in mat) {
					mat.side = THREE.DoubleSide;
					if ('emissive' in mat && mat.color) {
						mat.emissive = mat.color.clone().multiplyScalar(0.15);
					}
					mat.needsUpdate = true;
				}
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				const displayName = prettifyMeshName(mesh.name ?? '', meshIndex++);
				const rawGroups = scanColorGroups(geom!) ?? undefined;
				const colorGroups = rawGroups ? assignFdiToGroups(rawGroups) : undefined;
				if (colorGroups) {
					attachVertexColorHideShader(mesh);
				}
				collected.push({ name: displayName, mesh, rawGeom: geom!, colorGroups });
				// Yield to the event loop every few meshes so the spinner animates and the tab
				// stays responsive — but NOT every mesh: with the rAF render loop running, each
				// setTimeout(0) costs ~100ms+, so yielding on all 31 added ~4s. Every 6th keeps
				// it responsive for ~0.5s overhead.
				if (meshIndex % 6 === 0) {
					await new Promise<void>((r) => setTimeout(r, 0));
					// Superseded mid-processing — abandon this load. `model` (gltf.scene) was
					// never added to the scene yet, so dispose what we've built (skipping
					// cached remesh geometries) and bail before committing meshes/scene/stats.
					if (mySeq !== loadSeq) {
						disposeObject3D(model, remeshGeomKeepSet());
						return;
					}
				}
			}
			// Final guard before committing — a load could have superseded us on the very
			// last (non-yielding) batch of meshes.
			if (mySeq !== loadSeq) {
				disposeObject3D(model, remeshGeomKeepSet());
				return;
			}
			// D7: a structurally-valid GLTF/GLB with no isMesh nodes (or whose meshes
			// produce a degenerate/non-finite bounding box) would otherwise commit an
			// empty group, fit the camera to a zero box and fire onstats({count:0}) —
			// a silent BLACK viewport with no error. Mirror loadOBJ's empty/degenerate
			// guard: surface loadErrEmpty and do NOT commit the empty model. (Respects
			// the stale-load guard above — we only reach here as the current load.)
			const box = new THREE.Box3().setFromObject(model);
			const size = box.getSize(new THREE.Vector3());
			if (!isRenderableModel(collected.length, { x: size.x, y: size.y, z: size.z })) {
				disposeObject3D(model, remeshGeomKeepSet());
				model = null;
				meshes = [];
				loadError = $_('cbct.loadErrEmpty');
				return;
			}
			meshes = collected;
			scene.add(model);
			fitCameraToObject(model);
			if (onstats) {
				let totalTri = 0;
				const meshInfos: MeshInfo[] = [];
				for (const entry of collected) {
					const { mesh, name } = entry;
					const g = mesh.geometry as THREE.BufferGeometry;
					const idx = g.getIndex();
					const pos = g.getAttribute('position');
					const tri = idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
					totalTri += tri;
					if (entry.colorGroups && entry.colorGroups.length > 0) {
						for (const grp of entry.colorGroups) {
							meshInfos.push({
								name: grp.displayName,
								color: grp.color,
								triangles: Math.round(grp.vertexCount / 3),
								bbox: { x: 0, y: 0, z: 0 },
								center: grp.center,
								fdi: grp.fdi
							});
						}
					} else {
						const mb = new THREE.Box3().setFromObject(mesh);
						const ms = mb.getSize(new THREE.Vector3());
						const mc = mb.getCenter(new THREE.Vector3());
						const matColor = (mesh.material as THREE.MeshStandardMaterial)?.color;
						const col: [number, number, number] = matColor
							? [matColor.r, matColor.g, matColor.b]
							: [0.7, 0.7, 0.7];
						meshInfos.push({
							name,
							color: col,
							triangles: Math.round(tri),
							bbox: { x: ms.x, y: ms.y, z: ms.z },
							center: { x: mc.x, y: mc.y, z: mc.z }
						});
					}
				}
				onstats({
					count: meshInfos.length,
					totalTriangles: Math.round(totalTri),
					bbox: { x: size.x, y: size.y, z: size.z },
					meshInfos
				});
			}
		} catch (err) {
			// Show a friendly message, not the raw parser error (e.g. a GLTFLoader
			// "Unexpected token …" on a corrupt/truncated file) — that's unreadable to a
			// clinician. Keep the raw error in the console for debugging.
			// A superseded load that rejected (e.g. the old blob URL was revoked) must not
			// stamp an error over the current load.
			if (mySeq === loadSeq) {
				console.warn('3D model load/parse failed', err);
				loadError = $_('cbct.loadErrCorrupt');
			}
		} finally {
			URL.revokeObjectURL(url);
			// Only the current load owns the spinner — a stale load that bailed must leave
			// isLoading alone (the live load is still running).
			if (mySeq === loadSeq) isLoading = false;
		}
	}

	// Load a raw scan mesh (e.g. the original IOS .obj) for display before any AI
	// segmentation exists. No colour groups — a single neutral-shaded surface.
	async function loadOBJ(blob: Blob) {
		if (!scene) return;
		// Stale-load guard — see loadGLTF. IOS shows the raw scan (objBlob) first, then
		// swaps to the segmented glb; without this the raw-scan load can finish after the
		// segmentation load and clobber it (or leak its model).
		const mySeq = ++loadSeq;
		if (model) {
			scene.remove(model);
			disposeObject3D(model, remeshGeomKeepSet());
			model = null;
			meshes = [];
		}
		isLoading = true;
		loadError = '';
		try {
			// IOS raw scans arrive as OBJ, STL (ASCII *or* binary — the common IOS
			// export format), or PLY. Sniff the content and use the matching loader.
			// STL/PLY loaders return a BufferGeometry, so wrap those in a Mesh+Group
			// to match OBJLoader's Object3D shape for the traversal/stats below.
			const buf = await blob.arrayBuffer();
			// Superseded while reading the blob — drop this load (nothing built yet).
			if (mySeq !== loadSeq) return;
			const head = new TextDecoder()
				.decode(new Uint8Array(buf.slice(0, 256)))
				.toLowerCase()
				.trimStart();
			let obj: THREE.Object3D;
			if (head.startsWith('ply')) {
				obj = new THREE.Group();
				obj.add(new THREE.Mesh(new PLYLoader().parse(buf)));
			} else if (!head.startsWith('solid') && /(^|\n)\s*(v|vn|vt|f|o|g|mtllib)\s/.test(head)) {
				obj = new OBJLoader().parse(new TextDecoder().decode(buf));
			} else {
				// ASCII ("solid …") or binary STL — STLLoader.parse handles both.
				obj = new THREE.Group();
				obj.add(new THREE.Mesh(new STLLoader().parse(buf)));
			}
			model = obj;
			const collected: {
				name: string;
				mesh: THREE.Mesh;
				rawGeom: THREE.BufferGeometry;
				cleanGeom?: THREE.BufferGeometry;
				colorGroups?: ColorGroup[];
			}[] = [];
			let meshIndex = 0;
			let totalTri = 0;
			obj.traverse((o) => {
				const mesh = o as THREE.Mesh;
				if (!mesh.isMesh) return;
				const geom = mesh.geometry as THREE.BufferGeometry | undefined;
				if (geom && !geom.getAttribute('normal')) geom.computeVertexNormals();
				// Raw scans carry no useful material — apply a neutral enamel-ish surface.
				mesh.material = new THREE.MeshStandardMaterial({
					color: 0xd8d2c4,
					roughness: 0.85,
					metalness: 0.0,
					side: THREE.DoubleSide,
					emissive: new THREE.Color(0xd8d2c4).multiplyScalar(0.08)
				});
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				if (geom) {
					const idx = geom.getIndex();
					const pos = geom.getAttribute('position');
					totalTri += idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
				}
				collected.push({
					name: prettifyMeshName(mesh.name ?? '', meshIndex++),
					mesh,
					rawGeom: geom!
				});
			});
			meshes = collected;
			scene.add(obj);
			// A corrupt/degenerate scan (e.g. OBJLoader leniently parsing junk into
			// NaN-coordinate vertices) produces non-finite bounds and renders nothing.
			// Surface a clear error instead of a silently-blank viewport (matches the
			// explicit error CBCT shows on an unparseable volume).
			const box = new THREE.Box3().setFromObject(obj);
			const size = box.getSize(new THREE.Vector3());
			const degenerate =
				![size.x, size.y, size.z, box.min.x, box.min.y, box.min.z].every(Number.isFinite) ||
				(size.x === 0 && size.y === 0 && size.z === 0);
			if (degenerate) {
				scene.remove(obj);
				model = null;
				meshes = [];
				loadError = $_('cbct.loadErrEmpty');
				return;
			}
			fitCameraToObject(obj);
			if (onstats) {
				// count:0 — a raw scan has no per-tooth segmentation yet.
				onstats({
					count: 0,
					totalTriangles: Math.round(totalTri),
					bbox: { x: size.x, y: size.y, z: size.z },
					meshInfos: []
				});
			}
		} catch (err) {
			// Friendly message, not the raw loader/parse error (see the gltf catch above).
			// A superseded load that threw must not stamp an error over the current one.
			if (mySeq === loadSeq) {
				console.warn('scan mesh load/parse failed', err);
				loadError = $_('cbct.loadErrCorrupt');
			}
		} finally {
			// Only the current load owns the spinner.
			if (mySeq === loadSeq) isLoading = false;
		}
	}

	function fitCameraToObject(object: THREE.Object3D) {
		if (!camera || !controls) return;
		const box = new THREE.Box3().setFromObject(object);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		const fov = camera.fov * (Math.PI / 180);
		const distance = (maxDim * 1.6) / (2 * Math.tan(fov / 2));
		camera.position.copy(center).add(new THREE.Vector3(distance * 0.6, distance * 0.4, distance));
		camera.lookAt(center);
		controls.target.copy(center);
		controls.maxDistance = distance * 6;
		controls.minDistance = distance * 0.1;
		controls.update();
	}

	$effect(() => {
		// Segmentation (gltf/glb) wins; otherwise show the raw scan mesh if provided.
		if (gltfBlob) loadGLTF(gltfBlob);
		else if (objBlob) loadOBJ(objBlob);
	});

	// Per-mesh + per-colour-group visibility. CBCT GLTFs have separate meshes per
	// class so we hide whole meshes; IOS GLBs have one mesh with N colour groups
	// so we inject a discard shader and toggle uniform entries.
	$effect(() => {
		const hidden = hiddenMeshes;
		const list = meshes;
		if (!model) return;
		for (const entry of list) {
			if (entry.colorGroups && entry.colorGroups.length > 0) {
				entry.mesh.visible = true;
				applyHiddenColors(entry.mesh, hidden, entry.colorGroups);
			} else {
				entry.mesh.visible = !hidden.includes(entry.name);
			}
		}
	});

	// Reduce-noise effect: swap each mesh between raw + lazy-cleaned geometry
	// when the toggle changes. Caches the cleaned variant so subsequent toggles
	// are instant.
	$effect(() => {
		const wantClean = reduceNoise;
		const list = meshes;
		if (!model) return;
		let skippedAny = false;
		for (const entry of list) {
			let target: THREE.BufferGeometry = entry.rawGeom;
			if (wantClean) {
				if (!entry.cleanGeom) {
					// dropSmallComponents is a synchronous, un-yielded union-find over every
					// triangle — on a full-res CBCT jaw mesh (hundreds of thousands–millions
					// of tris) it hard-freezes the tab. Above the guard we skip the cleanup
					// for that mesh (keeping its raw geometry) and surface a brief note rather
					// than freezing; smaller meshes still clean.
					const idx = entry.rawGeom.getIndex();
					const triCount = idx
						? idx.count / 3
						: (entry.rawGeom.getAttribute('position')?.count ?? 0) / 3;
					if (!canDenoiseMesh(triCount)) {
						skippedAny = true;
						continue; // leave this mesh on its raw geometry
					}
					const cleaned = dropSmallComponents(entry.rawGeom, 150);
					cleaned.computeVertexNormals();
					entry.cleanGeom = cleaned;
				}
				if (entry.cleanGeom) target = entry.cleanGeom;
			}
			if (entry.mesh.geometry !== target) entry.mesh.geometry = target;
		}
		// Show the note only while Reduce-noise is on AND at least one mesh was too
		// large to clean; clears when the toggle is turned off.
		denoiseSkipped = wantClean && skippedAny;
	});

	// Wireframe mode — flip every material's wireframe flag.
	$effect(() => {
		const wf = wireframe;
		const list = meshes;
		if (!model) return;
		for (const { mesh } of list) {
			const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
			if (mat && 'wireframe' in mat) {
				mat.wireframe = wf;
				mat.needsUpdate = true;
			}
		}
	});

	// Tooth-selection highlight — rebuild the click maps after a load, then emphasise the
	// selected tooth. Re-runs when the selection (or the loaded mesh set) changes.
	$effect(() => {
		const sel = props.selectedTooth ?? null;
		void meshes;
		if (!model) return;
		rebuildToothMaps();
		applyToothHighlight(sel);
	});

	// Crosshair cursor while the surface-measure tool is active.
	$effect(() => {
		if (renderer) renderer.domElement.style.cursor = props.measureMode ? 'crosshair' : '';
	});

	export function resetView() {
		if (model) fitCameraToObject(model);
	}

	export function setView(view: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom') {
		if (!camera || !controls || !model) return;
		const box = new THREE.Box3().setFromObject(model);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		const fov = camera.fov * (Math.PI / 180);
		const distance = (maxDim * 1.6) / (2 * Math.tan(fov / 2));
		const dir = new THREE.Vector3();
		if (view === 'front') dir.set(0, 0, 1);
		else if (view === 'back') dir.set(0, 0, -1);
		else if (view === 'left') dir.set(-1, 0, 0);
		else if (view === 'right') dir.set(1, 0, 0);
		else if (view === 'top') dir.set(0, 1, 0);
		else dir.set(0, -1, 0);
		camera.position.copy(center).add(dir.multiplyScalar(distance));
		camera.lookAt(center);
		controls.target.copy(center);
		controls.update();
	}

	export function captureScreenshot(): string | null {
		if (!renderer || !scene || !camera) return null;
		// The renderer isn't created with preserveDrawingBuffer, so the drawing
		// buffer is only valid immediately after a render — draw, then read it.
		renderer.render(scene, camera);
		return renderer.domElement.toDataURL('image/png');
	}
</script>

<svelte:window onkeydown={onMeasureKeydown} />

<div bind:this={containerEl} class="relative h-full w-full" style="background: {background}">
	{#if isLoading}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-0/80 backdrop-blur-sm"
		>
			<span class="spinner text-3xl text-primary"></span>
			<div class="text-sm text-fg-1">{$_('cbct.loading3d')}</div>
		</div>
	{/if}
	{#if loadError}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-0/80 px-6 text-center"
		>
			<div class="text-danger-400 text-sm">{loadError}</div>
		</div>
	{/if}
	{#if contextLost}
		<!-- WebGL context lost: the canvas is black + the render loop is stopped. Show a
		     message + a manual reload (the browser usually fires webglcontextrestored,
		     but a full reload is the reliable fallback). -->
		<div
			class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg-0/90 px-6 text-center"
		>
			<div class="text-danger-400 text-sm">{$_('cbct.contextLost')}</div>
			<button
				type="button"
				class="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg-0 hover:bg-primary-hover"
				onclick={() => location.reload()}
			>
				{$_('common.reload')}
			</button>
		</div>
	{/if}
	{#if denoiseSkipped}
		<!-- Reduce-noise was skipped on at least one mesh that's too large to denoise
		     synchronously without freezing the tab (see denoiseGuard). -->
		<div
			class="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-bg-0/85 px-2 py-0.5 text-[11px] text-fg-1"
		>
			{$_('cbct.denoiseTooLarge')}
		</div>
	{/if}
	{#if hoverFdi != null}
		<div
			class="pointer-events-none absolute z-10 rounded bg-bg-0/85 px-1.5 py-0.5 text-[11px] font-medium text-fg-0 shadow"
			style="left:{hoverX + 12}px; top:{hoverY + 12}px"
		>
			{$_('cbct.tooth')}
			{toothDisplay(hoverFdi)}
		</div>
	{/if}
	{#if props.measureMode}
		<div
			class="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-bg-0/85 px-2 py-0.5 text-[11px] text-fg-1"
		>
			{$_('cbct.measureHint')}
		</div>
	{/if}
	{#if props.orientGizmo}
		<!-- Orientation widget — snap the camera to anatomical views (cube-gizmo equivalent). -->
		<div
			class="absolute right-3 bottom-3 z-10 grid grid-cols-3 gap-0.5 rounded-lg bg-bg-0/80 p-1 backdrop-blur-sm"
		>
			{#each [['top', 'cbct.gizmoTop'], ['front', 'cbct.gizmoFront'], ['right', 'cbct.gizmoRight'], ['bottom', 'cbct.gizmoBottom'], ['back', 'cbct.gizmoBack'], ['left', 'cbct.gizmoLeft']] as [v, labelKey] (v)}
				<button
					class="rounded px-1.5 py-1 text-[10px] font-medium text-fg-2 transition hover:bg-primary/25 hover:text-primary"
					title="{$_('cbct.view')}: {$_(labelKey)}"
					onclick={() => setView(v as 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom')}
					>{$_(labelKey)}</button
				>
			{/each}
		</div>
	{/if}
</div>
