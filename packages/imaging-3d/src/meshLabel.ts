// Translate well-known AI-shipped mesh names to the active UI locale AND the
// active tooth-numbering preference.
//
// The AI ships meshes labelled "Tooth 11", "Tooth 12", … (English-only, FDI).
// The CBCT workspace already builds a localized `meshNameLabel` map from
// segmentation metadata, but the IOS workspace renders `m.name` raw — so a
// French clinician saw "Tooth 18" sitting in the layers panel while the
// rest of the surface said "Dent 18". This helper recognises the few well-
// known prefixes ("Tooth <FDI>", "Mesh N", "Jaw", "Canal") and routes them
// through i18n keys we already ship; unknown strings pass through unchanged.
//
// The tooth NUMBER must also follow `dxv:toothNumbering` (default Universal),
// exactly like the chart / overlays / report / hover label — otherwise the
// Layers panel showed FDI ("Tooth 18") while the tooth chart on the same
// screen showed Universal ("1") for that tooth (vein #17/#37/#77: a numbering
// preference must reach EVERY renderer). "Mesh N" carries an index, not an
// FDI, so it is left untouched.

import { toothDisplay } from '@be-certain/core/constants';

const TOOTH_PATTERN = /^Tooth\s+(\d+)$/i;
const MESH_PATTERN = /^Mesh\s+(\d+)$/i;

export function meshDisplayName(raw: string, t: (key: string) => string): string {
	if (!raw) return raw;
	const tooth = raw.match(TOOTH_PATTERN);
	if (tooth) return `${t('cbct.tooth')} ${toothDisplay(Number(tooth[1]))}`;
	const mesh = raw.match(MESH_PATTERN);
	if (mesh) return `${t('cbct.mesh')} ${mesh[1]}`;
	if (raw.toLowerCase() === 'jaw') return t('cbct.jaw');
	if (raw.toLowerCase() === 'canal') return t('cbct.canal');
	return raw;
}
