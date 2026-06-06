import { describe, it, expect } from 'vitest';
import { detectModality, quickPatientName, quickDropDecision } from './quickAnalyze';

const f = (name: string, type = '') => ({ name, type });

describe('detectModality (one-click drop)', () => {
	it('detects CBCT volumes by extension', () => {
		for (const n of ['scan.nii', 'scan.nii.gz', 'scan.nrrd', 'scan.mha', 'scan.gipl', 'VOL.GZ']) {
			expect(detectModality(f(n)), n).toBe('cbct');
		}
	});

	it('detects IOS meshes by extension', () => {
		for (const n of ['arch.obj', 'arch.stl', 'arch.ply', 'ARCH.STL']) {
			expect(detectModality(f(n)), n).toBe('ios');
		}
	});

	it('detects images by extension or MIME (X-ray and panoramic both → image)', () => {
		expect(detectModality(f('xray.jpg'))).toBe('image');
		expect(detectModality(f('xray.jpeg'))).toBe('image');
		expect(detectModality(f('pano.png'))).toBe('image');
		expect(detectModality(f('p.webp'))).toBe('image');
		// No extension but an image MIME (common with drag-and-drop / pasted files).
		expect(detectModality(f('clipboard', 'image/png'))).toBe('image');
	});

	it('returns null for unsupported files', () => {
		expect(detectModality(f('notes.pdf'))).toBeNull();
		expect(detectModality(f('data.csv'))).toBeNull();
		expect(detectModality(f('archive.zip'))).toBeNull();
	});

	it('the three modality extension sets are non-overlapping', () => {
		expect(detectModality(f('a.stl'))).toBe('ios');
		expect(detectModality(f('a.nii'))).toBe('cbct');
		expect(detectModality(f('a.png'))).toBe('image');
	});
});

describe('quickPatientName', () => {
	it('uses the tidied file stem', () => {
		expect(quickPatientName(f('panoramic_001.jpg'))).toBe('panoramic 001');
		expect(quickPatientName(f('John-Doe-LR.png'))).toBe('John Doe LR');
	});

	it('strips compound extensions (.nii.gz / .tar.gz) without leaking a stray segment', () => {
		expect(quickPatientName(f('PatientScan.nii.gz'))).toBe('PatientScan');
		expect(quickPatientName(f('archive.tar.gz'))).toBe('archive');
		expect(quickPatientName(f('vol.nrrd'))).toBe('vol'); // single ext still works
	});

	it('falls back to a generic label when there is no usable stem', () => {
		expect(quickPatientName(f('.png'))).toBe('Quick scan');
		expect(quickPatientName(f(''))).toBe('Quick scan');
	});
});

describe('quickDropDecision (multi-file drop/paste safeguard)', () => {
	it('treats an empty drop/paste as none (e.g. a folder drop yields no files)', () => {
		expect(quickDropDecision(0)).toBe('none');
	});

	it('treats a negative count defensively as none', () => {
		expect(quickDropDecision(-1)).toBe('none');
	});

	it('analyzes a single file', () => {
		expect(quickDropDecision(1)).toBe('analyze');
	});

	it('flags two files as tooMany (does not silently analyze just the first)', () => {
		expect(quickDropDecision(2)).toBe('tooMany');
	});

	it('flags a full FMX batch (16 films) as tooMany', () => {
		expect(quickDropDecision(16)).toBe('tooMany');
	});
});
