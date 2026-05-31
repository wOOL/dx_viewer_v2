import type { AssetDescriptor } from '../types/index.js';

/**
 * The 2D files (.png/.jpg/.jpeg/.dcm) are not 3D assets but the marketing
 * demo's dashboard accepted them too — `classifyFile` returns this
 * sentinel for them so the UI layer can route to the 2D pipeline.
 */
export const TWO_D_ASSET = Symbol('TWO_D_ASSET');
export type ClassifiedFile = AssetDescriptor | typeof TWO_D_ASSET | null;

/**
 * Classify an uploaded file by extension → AssetDescriptor (3D) or
 * `TWO_D_ASSET` (2D pipeline) or `null` (unsupported).
 *
 * Filename extension is the single source of truth — we do not sniff
 * content. Ported from `dashboard.jsx`.
 */
export function classifyFile(file: File): ClassifiedFile {
	const n = file.name.toLowerCase();
	if (n.endsWith('.nii.gz') || n.endsWith('.nii')) {
		return {
			kind: 'volume',
			format: 'nifti',
			presentation: 'standalone',
			source: { kind: 'file', file }
		};
	}
	if (n.endsWith('.nrrd')) {
		return {
			kind: 'volume',
			format: 'nrrd',
			presentation: 'standalone',
			source: { kind: 'file', file }
		};
	}
	if (n.endsWith('.obj')) {
		return { kind: 'mesh', format: 'obj', source: { kind: 'file', file } };
	}
	if (n.endsWith('.gltf') || n.endsWith('.glb')) {
		return {
			kind: 'gltf-segmentation',
			format: n.endsWith('.glb') ? 'glb' : 'gltf',
			source: { kind: 'file', file }
		};
	}
	if (n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.dcm')) {
		return TWO_D_ASSET;
	}
	return null;
}

/** Human-readable list of accepted extensions for the upload widget. */
export const ACCEPTED_3D_EXTENSIONS = ['.nii', '.nii.gz', '.nrrd', '.obj', '.gltf', '.glb'] as const;
export const ACCEPTED_2D_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.dcm'] as const;
