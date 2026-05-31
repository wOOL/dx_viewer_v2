/**
 * Discriminated-union descriptors for 3D viewer inputs.
 *
 * Validation lives in `../session/validation.ts` and runs at every public
 * entry point — unknown variants throw `DxViewerError` rather than silently
 * falling through to a wrong-but-rendering result.
 */

export type SourceLocator =
	| { kind: 'url'; url: string }
	| { kind: 'file'; file: Blob | File };

export type VolumePresentation = 'standalone' | 'context';
export type VolumeFormat = 'nifti' | 'nrrd';
export type MeshFormat = 'obj';
export type LabelsFormat = 'nifti' | 'nrrd';
export type GltfFormat = 'gltf' | 'glb';

export interface LabelGroup {
	name: string;
	color: string;
}

export interface LabelEntry {
	name: string;
	group: string;
}

export interface LabelSchema {
	name: string;
	groupOrder: readonly string[];
	groups: Record<string, LabelGroup>;
	labels: Record<number, LabelEntry>;
}

export type AssetDescriptor =
	| {
			kind: 'volume';
			format: VolumeFormat;
			presentation: VolumePresentation;
			source: SourceLocator;
	  }
	| { kind: 'mesh'; format: MeshFormat; source: SourceLocator }
	| {
			kind: 'labels';
			format: LabelsFormat;
			schema: LabelSchema;
			source: SourceLocator;
	  }
	| {
			/** GLTF/GLB segmentation returned by `/api/ai/cbct_seg_inference` or `/api/ai/ios_seg_inference`. */
			kind: 'gltf-segmentation';
			format: GltfFormat;
			source: SourceLocator;
			schema?: LabelSchema;
	  };

export interface ResolvedLabel {
	id: number;
	name: string;
	groupKey: string;
	group: string;
	color: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Stable error codes — used by the UI to map error → copy without parsing English. */
export const ERROR_CODES = Object.freeze({
	LIBRARY_NOT_LOADED: 'LIBRARY_NOT_LOADED',
	CONTAINER_INVALID: 'CONTAINER_INVALID',
	INVALID_ASSETS: 'INVALID_ASSETS',
	INVALID_SOURCE: 'INVALID_SOURCE',
	UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
	NETWORK_ERROR: 'NETWORK_ERROR',
	NOT_A_NIFTI_FILE: 'NOT_A_NIFTI_FILE',
	NOT_AN_NRRD_FILE: 'NOT_AN_NRRD_FILE',
	NOT_AN_OBJ_FILE: 'NOT_AN_OBJ_FILE',
	NOT_A_GLTF_FILE: 'NOT_A_GLTF_FILE',
	UNSUPPORTED_DATATYPE: 'UNSUPPORTED_DATATYPE',
	SESSION_DISPOSED: 'SESSION_DISPOSED'
} as const);

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class DxViewerError extends Error {
	override readonly name = 'DxViewerError';
	readonly code: ErrorCode;
	readonly detail: unknown;
	constructor(code: ErrorCode, message: string, detail: unknown = null) {
		super(message);
		this.code = code;
		this.detail = detail;
	}
}

// ─── Callbacks & info ────────────────────────────────────────────────────────

export type SessionPhase = 'loading' | 'building' | 'rendering' | 'ready';

export interface SessionStageInfo {
	phase: SessionPhase;
	assetIndex?: number;
	kind?: AssetDescriptor['kind'];
	format?: string;
	via?: SourceLocator['kind'];
}

export interface SessionProgressInfo {
	fraction: number;
	assetIndex?: number;
}

export interface SessionCallbacks {
	onStage?: (info: SessionStageInfo) => void;
	onProgress?: (info: SessionProgressInfo) => void;
}

export interface AssetInfo {
	kind: AssetDescriptor['kind'];
	format: string;
	dims?: [number, number, number];
	spacing?: [number, number, number];
	range?: [number, number];
	visible: boolean;
}

export interface SessionInfo {
	assets: AssetInfo[];
	cameraBounds: [number, number, number, number, number, number];
}
