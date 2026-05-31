/**
 * Plain-English descriptions for AI labels — used when the dentist enables
 * "patient mode" so the same findings can be shown to a patient without
 * clinical jargon.
 *
 * Mirrors the structure of @be-certain/pb-openapi/constants's DISEASE_LABELS
 * and SEG_ID2CLS so any new class added there shows up here as `'Unknown'`
 * (fail visible, not silent).
 */

import type { AnatomyClassId, DiseaseLabel } from '@be-certain/core/types';

const DISEASE_PATIENT: Record<DiseaseLabel, string> = {
	0: 'Very early decay (outer layer)',
	1: 'Early decay (outer layer)',
	2: 'Decay reaching the second layer',
	3: 'Decay deep in the second layer',
	4: 'Decay close to the nerve',
	5: 'Minor bone loss',
	6: 'Bone loss around the crown',
	7: 'Bone loss reaching the middle',
	8: 'Bone loss near the root tip',
	9: 'Tartar build-up',
	10: 'Possible infection at the root tip',
	11: 'Tooth resorbing from the inside',
	12: 'Tooth resorbing from the outside',
	13: 'Gap under a filling',
	14: 'Open edge on a filling',
	15: 'Tooth root left behind',
	16: 'Missing filling material on the crown',
	17: 'Uncertain finding — review',
	18: 'Filling material extending too far',
	19: 'Other finding'
};

const ANATOMY_PATIENT: Record<AnatomyClassId, string> = {
	0: 'Outer enamel',
	1: 'Inner tooth layer',
	2: 'Root layer',
	3: 'Tooth nerve',
	4: 'Jawbone',
	5: 'Existing filling',
	6: 'Background'
};

export function patientDisease(id: number): string {
	return DISEASE_PATIENT[id as DiseaseLabel] ?? 'Other finding';
}

export function patientAnatomy(id: number): string {
	return ANATOMY_PATIENT[id as AnatomyClassId] ?? 'Unknown structure';
}
