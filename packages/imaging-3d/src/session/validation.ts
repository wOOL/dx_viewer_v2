import {
	DxViewerError,
	ERROR_CODES,
	type AssetDescriptor,
	type SourceLocator,
	type SessionCallbacks
} from '../types/index.js';

const VALID_ASSET_KINDS = new Set(['volume', 'mesh', 'labels', 'gltf-segmentation']);
const VALID_VOLUME_FORMATS = new Set(['nifti', 'nrrd']);
const VALID_MESH_FORMATS = new Set(['obj']);
const VALID_LABELS_FORMATS = new Set(['nifti', 'nrrd']);
const VALID_GLTF_FORMATS = new Set(['gltf', 'glb']);
const VALID_SOURCE_KINDS = new Set(['url', 'file']);
const VALID_VOLUME_PRESENTATIONS = new Set(['standalone', 'context']);

export function validateSource(source: SourceLocator, where: string): void {
	if (!source || typeof source !== 'object') {
		throw new DxViewerError(ERROR_CODES.INVALID_SOURCE, `${where}.source must be an object with a 'kind' discriminator`, { source });
	}
	if (!VALID_SOURCE_KINDS.has(source.kind)) {
		throw new DxViewerError(ERROR_CODES.INVALID_SOURCE, `${where}.source.kind must be one of: ${[...VALID_SOURCE_KINDS].join(', ')}`, {
			source
		});
	}
	if (source.kind === 'url') {
		if (typeof source.url !== 'string' || source.url.length === 0) {
			throw new DxViewerError(ERROR_CODES.INVALID_SOURCE, `${where}.source.url must be a non-empty string`, { source });
		}
	} else if (source.kind === 'file') {
		if (!(source.file instanceof Blob)) {
			throw new DxViewerError(ERROR_CODES.INVALID_SOURCE, `${where}.source.file must be a Blob or File`, { source });
		}
	}
}

export function validateAsset(asset: AssetDescriptor, idx: number): void {
	const where = `assets[${idx}]`;
	if (!asset || typeof asset !== 'object') {
		throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, `${where} must be an object`, { asset });
	}
	if (!VALID_ASSET_KINDS.has(asset.kind)) {
		throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, `${where}.kind must be one of: ${[...VALID_ASSET_KINDS].join(', ')}`, { asset });
	}
	const validFormats =
		asset.kind === 'volume'
			? VALID_VOLUME_FORMATS
			: asset.kind === 'mesh'
				? VALID_MESH_FORMATS
				: asset.kind === 'gltf-segmentation'
					? VALID_GLTF_FORMATS
					: VALID_LABELS_FORMATS;
	if (!validFormats.has(asset.format)) {
		throw new DxViewerError(
			ERROR_CODES.UNSUPPORTED_FORMAT,
			`${where}.format must be one of: ${[...validFormats].join(', ')} for kind '${asset.kind}'`,
			{ asset }
		);
	}
	validateSource(asset.source, where);
	if (asset.kind === 'volume') {
		if (!VALID_VOLUME_PRESENTATIONS.has(asset.presentation)) {
			throw new DxViewerError(
				ERROR_CODES.INVALID_ASSETS,
				`${where}.presentation must be one of: ${[...VALID_VOLUME_PRESENTATIONS].join(', ')}`,
				{ asset }
			);
		}
	}
	if (asset.kind === 'labels') {
		const s = asset.schema;
		if (!s || typeof s !== 'object' || !s.groups || !s.labels) {
			throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, `${where}.schema must be a {groups, labels} object`, { asset });
		}
	}
	if (asset.kind === 'gltf-segmentation' && asset.schema !== undefined) {
		const s = asset.schema;
		if (typeof s !== 'object' || !s.groups || !s.labels) {
			throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, `${where}.schema must be a {groups, labels} object if provided`, { asset });
		}
	}
}

export interface CreateSessionInput {
	container: Element;
	assets: AssetDescriptor[];
	callbacks?: SessionCallbacks;
}

export function validateCreateSessionInput(input: unknown): asserts input is CreateSessionInput {
	if (!input || typeof input !== 'object') {
		throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'createSession requires an options object');
	}
	const { container, assets, callbacks } = input as CreateSessionInput;
	if (!(container instanceof Element)) {
		throw new DxViewerError(ERROR_CODES.CONTAINER_INVALID, 'options.container must be a DOM Element');
	}
	if (!Array.isArray(assets) || assets.length === 0) {
		throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'options.assets must be a non-empty array');
	}
	assets.forEach(validateAsset);
	if (callbacks !== undefined && (callbacks === null || typeof callbacks !== 'object')) {
		throw new DxViewerError(ERROR_CODES.INVALID_ASSETS, 'options.callbacks must be an object if provided');
	}
}
