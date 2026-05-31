/**
 * Colour palette for inference labels rendered over the cropped X-ray.
 *
 * Hand-picked for contrast against the dark radiograph background and
 * grouped by clinical family so neighbouring categories read at a glance:
 *   caries — warm reds → ambers
 *   bone loss — cool blues
 *   calculus / overhang — greens
 *   periapical / resorption — magenta family
 *   restoration concerns — cyan / teal
 *   anatomy — tooth-anatomy conventional hues
 *
 * Static hex strings (not CSS tokens) so the diagnostic colour-coding does
 * not shift if the design system retokens, and so the same colours appear in
 * print/PDF export where CSS custom properties don't always carry.
 */

import type { AnatomyClassId, DiseaseLabel } from '@be-certain/core/types';

const DISEASE_PALETTE: Record<DiseaseLabel, string> = {
	// Dental caries — graded outer→inner, warm red gradient
	0: '#FFD78A', // Grade 1: Outer Enamel — pale amber (least severe)
	1: '#FFB266', // Grade 2: Inner Enamel
	2: '#FF8A4C', // Grade 3: Outer Dentin
	3: '#F25C3B', // Grade 4: Middle Dentin
	4: '#D33A2A', // Grade 5: Inner Dentin (most severe)

	// Bone loss — graded mild→severe, cool blue gradient
	5: '#A8D8FF', // Stage 1: <15%
	6: '#6FB6F2', // Stage 2: Coronal Third
	7: '#4791D6', // Stage 3: Mid Third
	8: '#2666AA', // Stage 4: Apical Third

	9: '#5DD4A6', // Calculus — mint green
	10: '#E87BD3', // Periapical Radiolucency — magenta
	11: '#C97BE8', // Internal Resorption — violet
	12: '#A55BD6', // External Resorption — deep violet
	13: '#5DCCC9', // Restoration Radiolucency — teal
	14: '#7DD3B4', // Open Margin — sea-green
	15: '#FF9F66', // Remaining Root — orange
	16: '#FFC04C', // Missing Coronal Restoration — gold
	17: '#9FB1C4', // Unsure — neutral
	18: '#6DCB6D', // Overhang — green
	19: '#B8B8B8' // Other — grey
};

const ANATOMY_PALETTE: Record<AnatomyClassId, string> = {
	0: '#F5E9C8', // Enamel — cream
	1: '#E8C998', // Dentin — ivory
	2: '#C9A479', // Root Dentin — darker ivory
	3: '#FF6B6B', // Pulp — red
	4: '#BFC8D1', // Bone — bone-grey
	5: '#7BD0F5', // Restoration — cyan
	6: '#5A7088' // Background — muted
};

export function diseaseColor(id: number): string {
	return DISEASE_PALETTE[id as DiseaseLabel] ?? '#B8B8B8';
}

export function anatomyColor(id: number): string {
	return ANATOMY_PALETTE[id as AnatomyClassId] ?? '#B8B8B8';
}

/** Tooth numbers are wayfinding, not findings — single neutral hue. */
export const TOOTH_NUMBER_COLOR = '#F0C764';
