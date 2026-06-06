import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FmxNavigator from './FmxNavigator.svelte';
import type { StoredStudy } from '$lib/types';

function xray(id: string, teeth: number[]): StoredStudy {
	return {
		id,
		patientId: 'p',
		patientName: 'P',
		capturedAt: '2026-05-01T00:00:00Z',
		modality: 'xray',
		imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
		inference: {
			extra: { number_result: { result: { labels: teeth.map((t) => t - 1) } } }
		} as unknown as StoredStudy['inference']
	};
}

describe('FmxNavigator (component)', () => {
	it('marks the current frame and navigates when another frame is clicked', () => {
		const a = xray('a', [1, 2, 3]); // → slot "Teeth 1-3"
		const b = xray('b', [7, 8, 9, 10]); // → slot "Teeth 7-10"
		const onPick = vi.fn();
		const { container } = render(FmxNavigator, { studies: [a, b], currentStudyId: 'a', onPick });

		// "You are here" — the current study's frame is marked.
		const current = container.querySelector('[aria-current="true"]');
		expect(current).not.toBeNull();
		expect(current?.getAttribute('aria-label')).toContain('Teeth 1-3');

		// Clicking a different populated frame opens that study.
		const other = container.querySelector(
			'button[aria-label="Teeth 7-10"]'
		) as HTMLButtonElement | null;
		expect(other).not.toBeNull();
		other!.click();
		expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
	});

	it('exposes a labelled navigator group', () => {
		const { container } = render(FmxNavigator, {
			studies: [xray('a', [1, 2, 3])],
			currentStudyId: 'a'
		});
		expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBeTruthy();
	});

	it('expands on focus-within so keyboard users see thumbnails (parity with hover)', async () => {
		const a = xray('a', [1, 2, 3]);
		const b = xray('b', [7, 8, 9, 10]);
		const { container } = render(FmxNavigator, { studies: [a, b], currentStudyId: 'a' });
		const nav = container.querySelector('.nav') as HTMLElement;
		// Collapsed at rest.
		expect(nav.classList.contains('expanded')).toBe(false);
		// Focus a cell — must dispatch focusin to the .nav root.
		const cell = container.querySelector('button.cell.filled') as HTMLButtonElement;
		cell.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		// Allow Svelte's $state update to flush.
		await new Promise((r) => setTimeout(r, 0));
		expect(nav.classList.contains('expanded')).toBe(true);
	});
});
