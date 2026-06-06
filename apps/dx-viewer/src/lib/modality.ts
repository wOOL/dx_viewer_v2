// Single source of truth for rendering a study modality as a localized label.
// Used by the patient page (tile captions + printout) and TopBar history.

export type Modality = 'xray' | 'panoramic' | 'cbct' | 'ios' | 'photo';

const MODALITY_KEY: Record<string, string> = {
	xray: 'common.modalityXray',
	panoramic: 'common.modalityPanoramic',
	cbct: 'common.modalityCbct',
	ios: 'common.modalityIos',
	photo: 'common.modalityPhoto'
};

export function modalityLabel(modality: string | undefined, t: (key: string) => string): string {
	if (!modality) return '';
	const key = MODALITY_KEY[modality];
	return key ? t(key) : modality;
}

// Only these modalities store a viewable raster bitmap on `image` (jpg/png). CBCT
// and IOS store a raw volume / mesh (.nii.gz / .nrrd / .obj / .stl …) there, which
// an `<img src=imageDataUrl>` renders as a BROKEN image — so any thumbnail/printout
// must fall back to a placeholder for them instead of an <img>.
const RASTER_MODALITIES = new Set(['xray', 'panoramic', 'photo']);

export function hasViewableImage(modality: string | undefined): boolean {
	return !!modality && RASTER_MODALITIES.has(modality);
}

// The "3D" modalities — CBCT volumes and IOS meshes. These are the ones gated behind
// the per-user `enable3d` preference (the 3D AI is segmentation-only / premature, so
// it's hidden unless the clinician explicitly turns it on in Settings). Single source
// of truth so the route guard, patient tabs, upload, and quick-analyze all agree.
const THREE_D_MODALITIES = new Set(['cbct', 'ios']);

export function isThreeDModality(modality: string | undefined): boolean {
	return !!modality && THREE_D_MODALITIES.has(modality);
}

// Which upload modalities a user can choose, given their account opt-ins. X-ray is
// ALWAYS available (the base modality); Panoramic, CBCT/IOS and Photo each appear only
// when their toggle is on. Pure so the upload picker + its tests share one definition.
export interface ModalityFlags {
	panoramic: boolean;
	threeD: boolean;
	photo: boolean;
}
export function availableModalities(f: ModalityFlags): Modality[] {
	const out: Modality[] = ['xray'];
	if (f.panoramic) out.push('panoramic');
	if (f.threeD) out.push('cbct', 'ios');
	if (f.photo) out.push('photo');
	return out;
}
// Show the modality picker only when there's an actual choice — with every opt-in off,
// X-ray is the sole modality, so the picker is pointless (the upload defaults to X-ray).
export function showModalityPicker(f: ModalityFlags): boolean {
	return availableModalities(f).length > 1;
}
