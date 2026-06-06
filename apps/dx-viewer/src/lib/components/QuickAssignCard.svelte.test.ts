import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import QuickAssignCard from './QuickAssignCard.svelte';
import { studies } from '$lib/stores/studies.svelte';
import type { StoredPatient } from '$lib/types';

function quickPatient(): StoredPatient {
	return {
		id: 'q1',
		name: 'Quick scan',
		initials: 'QS',
		studies: [],
		lastCapture: '2026-01-01T00:00:00.000Z',
		totalToothCount: 0,
		ringColors: ['#000', '#111'],
		quick: true
	};
}

afterEach(() => vi.restoreAllMocks());

describe('QuickAssignCard (#97 error surfacing)', () => {
	it('surfaces an error (instead of silently re-enabling) when naming the patient fails', async () => {
		vi.spyOn(studies, 'renamePatient').mockRejectedValue(new Error('network boom'));
		const { container } = render(QuickAssignCard, { patient: quickPatient() });

		(container.querySelector('[data-testid="qa-name"]') as HTMLButtonElement).click();
		await tick();
		const input = container.querySelector('input[type="text"]') as HTMLInputElement;
		input.value = 'Jane Doe';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		(container.querySelector('form') as HTMLFormElement).requestSubmit();

		await vi.waitFor(() => {
			const e = container.querySelector('.err[role="alert"]');
			const txt = e?.textContent ?? '';
			// An error is surfaced (not silently swallowed)…
			expect(txt.length).toBeGreaterThan(0);
			// …and it's the LOCALIZED message, not the raw English `.message` (A1 fix):
			// a non-English clinician must not see "network boom".
			expect(txt).not.toContain('network boom');
		});
	});

	it('shows no error initially', () => {
		const { container } = render(QuickAssignCard, { patient: quickPatient() });
		expect(container.querySelector('.err[role="alert"]')).toBeNull();
	});
});
