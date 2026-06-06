import { describe, expect, it } from 'vitest';
import {
	modalityLabel,
	hasViewableImage,
	isThreeDModality,
	availableModalities,
	showModalityPicker
} from './modality';

// Stand-in for svelte-i18n's $_ — looks up keys in a fixture.
const fakeT = (table: Record<string, string>) => (key: string) => table[key] ?? key;

describe('modalityLabel', () => {
	const en = fakeT({
		'common.modalityXray': 'X-ray',
		'common.modalityPanoramic': 'Panoramic',
		'common.modalityCbct': 'CBCT',
		'common.modalityIos': 'IOS',
		'common.modalityPhoto': 'Photo'
	});
	const fr = fakeT({
		'common.modalityXray': 'Radio',
		'common.modalityPanoramic': 'Panoramique',
		'common.modalityCbct': 'CBCT',
		'common.modalityIos': 'Scan IO',
		'common.modalityPhoto': 'Photo'
	});

	it('maps each known modality through the i18n table (EN)', () => {
		expect(modalityLabel('xray', en)).toBe('X-ray');
		expect(modalityLabel('panoramic', en)).toBe('Panoramic');
		expect(modalityLabel('cbct', en)).toBe('CBCT');
		expect(modalityLabel('ios', en)).toBe('IOS');
		expect(modalityLabel('photo', en)).toBe('Photo');
	});

	it('maps each known modality through the i18n table (FR)', () => {
		expect(modalityLabel('xray', fr)).toBe('Radio');
		expect(modalityLabel('panoramic', fr)).toBe('Panoramique');
		expect(modalityLabel('ios', fr)).toBe('Scan IO');
	});

	it('returns the raw modality string when unknown (forward-compatible)', () => {
		expect(modalityLabel('mri', en)).toBe('mri');
	});

	it('returns an empty string when the modality is undefined', () => {
		expect(modalityLabel(undefined, en)).toBe('');
	});
});

describe('hasViewableImage', () => {
	it('is true only for raster modalities (a real bitmap on `image`)', () => {
		expect(hasViewableImage('xray')).toBe(true);
		expect(hasViewableImage('panoramic')).toBe(true);
		expect(hasViewableImage('photo')).toBe(true);
	});

	it('is false for CBCT/IOS — their `image` is a raw volume/mesh, not a bitmap', () => {
		// Guards the patient-printout regression: an <img src=.nii.gz/.obj> prints broken.
		expect(hasViewableImage('cbct')).toBe(false);
		expect(hasViewableImage('ios')).toBe(false);
	});

	it('is false for undefined / unknown modalities', () => {
		expect(hasViewableImage(undefined)).toBe(false);
		expect(hasViewableImage('mri')).toBe(false);
	});
});

describe('isThreeDModality (the enable3d gate)', () => {
	it('is true only for CBCT and IOS', () => {
		expect(isThreeDModality('cbct')).toBe(true);
		expect(isThreeDModality('ios')).toBe(true);
	});

	it('is false for the 2D modalities (always available, never gated)', () => {
		expect(isThreeDModality('xray')).toBe(false);
		expect(isThreeDModality('panoramic')).toBe(false);
		expect(isThreeDModality('photo')).toBe(false);
	});

	it('is false for undefined / unknown modalities', () => {
		expect(isThreeDModality(undefined)).toBe(false);
		expect(isThreeDModality('mri')).toBe(false);
	});

	it('is the exact complement of "viewable raster" for the real modalities (no overlap, no gap)', () => {
		// Every real study modality is either a 2D raster OR a 3D modality, never both —
		// so the gate (isThreeDModality) and the printout guard (hasViewableImage) can't
		// disagree about a given study.
		for (const m of ['xray', 'panoramic', 'photo', 'cbct', 'ios']) {
			expect(isThreeDModality(m)).toBe(!hasViewableImage(m));
		}
	});
});

describe('availableModalities + showModalityPicker (upload picker gating)', () => {
	const off = { panoramic: false, threeD: false, photo: false };

	it('offers only X-ray when every opt-in is off (default new user)', () => {
		expect(availableModalities(off)).toEqual(['xray']);
		// …and with a single option there is nothing to pick, so the picker is hidden.
		expect(showModalityPicker(off)).toBe(false);
	});

	it('adds Panoramic / CBCT+IOS / Photo per their toggle', () => {
		expect(availableModalities({ panoramic: true, threeD: false, photo: false })).toEqual([
			'xray',
			'panoramic'
		]);
		expect(availableModalities({ panoramic: false, threeD: true, photo: false })).toEqual([
			'xray',
			'cbct',
			'ios'
		]);
		expect(availableModalities({ panoramic: false, threeD: false, photo: true })).toEqual([
			'xray',
			'photo'
		]);
		expect(availableModalities({ panoramic: true, threeD: true, photo: true })).toEqual([
			'xray',
			'panoramic',
			'cbct',
			'ios',
			'photo'
		]);
	});

	it('shows the picker as soon as any modality beyond X-ray is enabled', () => {
		expect(showModalityPicker({ panoramic: true, threeD: false, photo: false })).toBe(true);
		expect(showModalityPicker({ panoramic: false, threeD: true, photo: false })).toBe(true);
		expect(showModalityPicker({ panoramic: false, threeD: false, photo: true })).toBe(true);
	});
});
