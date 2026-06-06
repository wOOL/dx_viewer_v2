import { describe, it, expect } from 'vitest';
import { autoTabDecision } from './patientTabs';

const base = { decidedFor: null, patientId: 'A', studyCount: 2, hasXrays: true, has3d: false };

describe('autoTabDecision', () => {
	it('defaults to X-rays when the patient has X-rays', () => {
		expect(autoTabDecision(base)).toBe('xrays');
		expect(autoTabDecision({ ...base, has3d: true })).toBe('xrays'); // both → X-rays
	});

	it('opens 3D when there are no X-rays but there are 3D scans', () => {
		expect(autoTabDecision({ ...base, hasXrays: false, has3d: true })).toBe('3d');
	});

	it('defaults to X-rays when there is neither (e.g. photos-only)', () => {
		expect(autoTabDecision({ ...base, hasXrays: false, has3d: false })).toBe('xrays');
	});

	it('decides only once per patient (so a manual tab switch sticks)', () => {
		// decidedFor already equals the current patient → no override.
		expect(autoTabDecision({ ...base, decidedFor: 'A' })).toBeNull();
	});

	it('RE-decides when the patient changes (the carry-over fix)', () => {
		// We last decided for A, but we are now showing B → decide again for B.
		expect(autoTabDecision({ ...base, decidedFor: 'A', patientId: 'B' })).toBe('xrays');
		expect(
			autoTabDecision({
				decidedFor: 'A',
				patientId: 'B',
				studyCount: 1,
				hasXrays: false,
				has3d: true
			})
		).toBe('3d');
	});

	it('waits until studies are loaded and a patient is resolved', () => {
		expect(autoTabDecision({ ...base, studyCount: 0 })).toBeNull();
		expect(autoTabDecision({ ...base, patientId: null })).toBeNull();
	});
});
