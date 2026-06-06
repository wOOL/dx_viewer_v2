import { describe, it, expect } from 'vitest';
import { validatePatientEdit } from './patientEdit';
import { MIN_DOB_ISO, todayLocalISO } from './date';

describe('validatePatientEdit', () => {
	it('rejects an empty name', () => {
		const r = validatePatientEdit({ name: '', dob: '' });
		expect(r).toEqual({ ok: false, key: 'patient.errNameRequired' });
	});

	it('rejects a whitespace-only name', () => {
		const r = validatePatientEdit({ name: '   \t ', dob: '' });
		expect(r).toEqual({ ok: false, key: 'patient.errNameRequired' });
	});

	it('rejects a future DOB', () => {
		// One day past today's LOCAL date (validateDobISO compares to todayLocalISO()).
		const t = new Date();
		t.setDate(t.getDate() + 1);
		const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(
			t.getDate()
		).padStart(2, '0')}`;
		const r = validatePatientEdit({ name: 'Jane Roe', dob: tomorrow });
		expect(r).toEqual({ ok: false, key: 'upload.errFutureDob' });
	});

	it('rejects a pre-1900 DOB', () => {
		const r = validatePatientEdit({ name: 'Jane Roe', dob: '1899-12-31' });
		expect(r).toEqual({ ok: false, key: 'upload.errDobTooOld' });
		// Below the MIN_DOB_ISO floor specifically.
		expect('1899-12-31' < MIN_DOB_ISO).toBe(true);
	});

	it('rejects a malformed / impossible date string', () => {
		// validateDobISO does string-vs-bounds comparison: a non-date like a far-future
		// year sorts above today → future; an impossible-but-well-ordered string like a
		// pre-1900 value → tooOld. Either way a bad date never returns ok.
		const r = validatePatientEdit({ name: 'Jane Roe', dob: '0001-13-99' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.key.startsWith('upload.errDob')).toBe(true);
	});

	it('allows an empty DOB (DOB is optional)', () => {
		const r = validatePatientEdit({ name: 'Jane Roe', dob: '' });
		expect(r).toEqual({ ok: true, name: 'Jane Roe', dob: '' });
	});

	it('accepts a valid name + DOB and trims the name', () => {
		const r = validatePatientEdit({ name: '  Jane Roe  ', dob: '1990-06-15' });
		expect(r).toEqual({ ok: true, name: 'Jane Roe', dob: '1990-06-15' });
	});

	it('accepts the MIN_DOB_ISO and today boundaries', () => {
		expect(validatePatientEdit({ name: 'A', dob: MIN_DOB_ISO })).toEqual({
			ok: true,
			name: 'A',
			dob: MIN_DOB_ISO
		});
		expect(validatePatientEdit({ name: 'A', dob: todayLocalISO() })).toEqual({
			ok: true,
			name: 'A',
			dob: todayLocalISO()
		});
	});
});
