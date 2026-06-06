import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PatientCard from './PatientCard.svelte';
import type { StoredPatient } from '$lib/types';

function patient(): StoredPatient {
	return {
		id: 'abc123wxyz',
		name: 'Ryan Adamson',
		initials: 'RA',
		dob: '1990-01-01',
		studies: [],
		lastCapture: '2026-05-20T00:00:00.000Z',
		totalToothCount: 0,
		ringColors: ['#06b6d4', '#a855f7']
	};
}

describe('PatientCard', () => {
	// PHI masking was removed — the card always shows the real name / DOB / initials.
	it('shows the real name, initials and DOB', () => {
		const { container } = render(PatientCard, { patient: patient() });
		const text = container.textContent ?? '';
		expect(text).toContain('Ryan Adamson');
		expect(text).toContain('RA');
		expect(text).toContain('1990'); // DOB year shown
	});
});
