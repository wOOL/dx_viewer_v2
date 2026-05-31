import type { LabelSchema } from '../types/index.js';

/**
 * ToothFairy3 (FDI) label schema — verbatim port of
 * `marketting-demo/dx-viewer/project/components/labels-toothfairy3.js`.
 *
 * The viewer module is schema-agnostic. A customer with a different label
 * taxonomy drops in their own LabelSchema (same shape) and the rest of the
 * pipeline keeps working.
 */

const GROUPS = {
	bone: { name: 'Jaws', color: '#D6CFC1' },
	nerve: { name: 'Nerves & canals', color: '#E84B3A' },
	sinus: { name: 'Sinuses & airway', color: '#6FB3C9' },
	tooth_p: { name: 'Permanent teeth', color: '#F0EBD8' },
	tooth_d: { name: 'Deciduous teeth', color: '#E5D9B6' },
	work: { name: 'Dental work', color: '#F0C764' },
	pulp: { name: 'Pulp & soft tissue', color: '#C66E58' },
	other: { name: 'Other', color: '#7B8794' }
} as const;

const LABELS: Record<number, { name: string; group: keyof typeof GROUPS }> = {
	1: { name: 'Mandible (lower jaw)', group: 'bone' },
	2: { name: 'Maxilla (upper jaw)', group: 'bone' },
	3: { name: 'IAN — left', group: 'nerve' },
	4: { name: 'IAN — right', group: 'nerve' },
	5: { name: 'Maxillary sinus — left', group: 'sinus' },
	6: { name: 'Maxillary sinus — right', group: 'sinus' },
	7: { name: 'Pharynx', group: 'sinus' },
	8: { name: 'Bridge', group: 'work' },
	9: { name: 'Crown', group: 'work' },
	10: { name: 'Implant', group: 'work' },

	// FDI permanent — upper right
	11: { name: 'UR central incisor (11)', group: 'tooth_p' },
	12: { name: 'UR lateral incisor (12)', group: 'tooth_p' },
	13: { name: 'UR canine (13)', group: 'tooth_p' },
	14: { name: 'UR 1st premolar (14)', group: 'tooth_p' },
	15: { name: 'UR 2nd premolar (15)', group: 'tooth_p' },
	16: { name: 'UR 1st molar (16)', group: 'tooth_p' },
	17: { name: 'UR 2nd molar (17)', group: 'tooth_p' },
	18: { name: 'UR 3rd molar (18)', group: 'tooth_p' },

	// FDI permanent — upper left
	21: { name: 'UL central incisor (21)', group: 'tooth_p' },
	22: { name: 'UL lateral incisor (22)', group: 'tooth_p' },
	23: { name: 'UL canine (23)', group: 'tooth_p' },
	24: { name: 'UL 1st premolar (24)', group: 'tooth_p' },
	25: { name: 'UL 2nd premolar (25)', group: 'tooth_p' },
	26: { name: 'UL 1st molar (26)', group: 'tooth_p' },
	27: { name: 'UL 2nd molar (27)', group: 'tooth_p' },
	28: { name: 'UL 3rd molar (28)', group: 'tooth_p' },

	// FDI permanent — lower left
	31: { name: 'LL central incisor (31)', group: 'tooth_p' },
	32: { name: 'LL lateral incisor (32)', group: 'tooth_p' },
	33: { name: 'LL canine (33)', group: 'tooth_p' },
	34: { name: 'LL 1st premolar (34)', group: 'tooth_p' },
	35: { name: 'LL 2nd premolar (35)', group: 'tooth_p' },
	36: { name: 'LL 1st molar (36)', group: 'tooth_p' },
	37: { name: 'LL 2nd molar (37)', group: 'tooth_p' },
	38: { name: 'LL 3rd molar (38)', group: 'tooth_p' },

	// FDI permanent — lower right
	41: { name: 'LR central incisor (41)', group: 'tooth_p' },
	42: { name: 'LR lateral incisor (42)', group: 'tooth_p' },
	43: { name: 'LR canine (43)', group: 'tooth_p' },
	44: { name: 'LR 1st premolar (44)', group: 'tooth_p' },
	45: { name: 'LR 2nd premolar (45)', group: 'tooth_p' },
	46: { name: 'LR 1st molar (46)', group: 'tooth_p' },
	47: { name: 'LR 2nd molar (47)', group: 'tooth_p' },
	48: { name: 'LR 3rd molar (48)', group: 'tooth_p' },

	// FDI deciduous (mixed dentition)
	51: { name: 'Deciduous UR central (51)', group: 'tooth_d' },
	52: { name: 'Deciduous UR lateral (52)', group: 'tooth_d' },
	53: { name: 'Deciduous UR canine (53)', group: 'tooth_d' },
	54: { name: 'Deciduous UR 1st molar (54)', group: 'tooth_d' },
	55: { name: 'Deciduous UR 2nd molar (55)', group: 'tooth_d' },
	61: { name: 'Deciduous UL central (61)', group: 'tooth_d' },
	62: { name: 'Deciduous UL lateral (62)', group: 'tooth_d' },
	63: { name: 'Deciduous UL canine (63)', group: 'tooth_d' },
	64: { name: 'Deciduous UL 1st molar (64)', group: 'tooth_d' },
	65: { name: 'Deciduous UL 2nd molar (65)', group: 'tooth_d' },
	71: { name: 'Deciduous LL central (71)', group: 'tooth_d' },
	72: { name: 'Deciduous LL lateral (72)', group: 'tooth_d' },
	73: { name: 'Deciduous LL canine (73)', group: 'tooth_d' },
	74: { name: 'Deciduous LL 1st molar (74)', group: 'tooth_d' },
	75: { name: 'Deciduous LL 2nd molar (75)', group: 'tooth_d' },
	76: { name: 'Deciduous LL 2nd molar (76)', group: 'tooth_d' },
	81: { name: 'Deciduous LR central (81)', group: 'tooth_d' },
	82: { name: 'Deciduous LR lateral (82)', group: 'tooth_d' },
	83: { name: 'Deciduous LR canine (83)', group: 'tooth_d' },
	84: { name: 'Deciduous LR 1st molar (84)', group: 'tooth_d' },
	85: { name: 'Deciduous LR 2nd molar (85)', group: 'tooth_d' }
};

const GROUP_ORDER = ['bone', 'tooth_p', 'tooth_d', 'work', 'nerve', 'sinus', 'pulp', 'other'] as const;

export const ToothFairy3LabelSchema: LabelSchema = Object.freeze({
	name: 'ToothFairy3 (FDI)',
	groupOrder: GROUP_ORDER,
	groups: GROUPS,
	labels: LABELS
});
