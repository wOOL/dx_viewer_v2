/**
 * `@be-certain/imaging-3d`
 *
 * 3D medical-imaging primitives extracted from the BeCertain dx-viewer demo:
 *   - `./types`    — discriminated unions for source/asset descriptors + DxViewerError
 *   - `./loaders`  — fetch/file/gzip/zip helpers + classifyFile()
 *   - `./parsers`  — NIfTI / NRRD / OBJ / GLTF parsers
 *   - `./session`  — createSession() and createSliceView() (framework-agnostic VTK wrappers)
 *   - `./labels`   — label schemas (ToothFairy3) + resolveLabel()
 *   - `./svelte`   — Viewer3DSession (Svelte 5 runes wrapper) — the only runes-using file
 */

export * from './types/index.js';
export * from './loaders/index.js';
export * from './parsers/index.js';
export * from './labels/index.js';
// session intentionally NOT in the main barrel — heavy VTK imports.
// Consumers import directly from '@be-certain/imaging-3d/session'.
