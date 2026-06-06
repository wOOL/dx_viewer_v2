import { describe, it, expect, vi, afterEach } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import ToothChart from './ToothChart.svelte';
import { prefs } from '$lib/stores/prefs.svelte';

// Component test (real browser via Playwright). ToothChart is keyed/ordered by FDI
// (onpick + findings are FDI) while the label follows the numbering preference.
describe('ToothChart (component)', () => {
	afterEach(() => prefs.setToothNumbering('universal'));

	it('renders all 32 teeth and rings exactly the highlighted one', () => {
		const { container } = render(ToothChart, { highlightTooth: [11], findingsByTooth: {} });
		expect(container.querySelectorAll('button').length).toBe(32);
		expect(container.querySelectorAll('.ring-primary').length).toBe(1);
	});

	it('applies severity styling to a tooth that has findings', () => {
		const { container } = render(ToothChart, {
			findingsByTooth: { 16: { severity: 'high', count: 2 } }
		});
		expect(container.querySelectorAll('.border-danger-500').length).toBeGreaterThan(0);
	});

	it('calls onpick with the FDI code (not the displayed number) on click', async () => {
		const onpick = vi.fn();
		const { container } = render(ToothChart, { onpick });
		// The first upper cell is FDI 18 (Diagnocat orders the upper row right→left).
		(container.querySelector('button') as HTMLElement).click();
		expect(onpick).toHaveBeenCalledWith(18);
	});

	it('every cell carries an aria-label ("Tooth N") and aria-pressed mirrors highlight', () => {
		const { container } = render(ToothChart, { highlightTooth: [11], findingsByTooth: {} });
		const cells = [...container.querySelectorAll('button')];
		for (const c of cells) {
			expect(c.getAttribute('aria-label')).toMatch(/Tooth \d+/);
			expect(['true', 'false']).toContain(c.getAttribute('aria-pressed'));
		}
		// Exactly one cell is pressed (matching highlightTooth=[11]).
		expect(cells.filter((c) => c.getAttribute('aria-pressed') === 'true').length).toBe(1);
	});

	it('S2-#3: switches the displayed labels reactively when the numbering preference changes, WITHOUT remounting', async () => {
		prefs.setToothNumbering('universal');
		await tick();
		const { container } = render(ToothChart, { findingsByTooth: {} });
		// The first upper cell is FDI 18 → Universal label "1".
		const firstCell = container.querySelector('button') as HTMLElement;
		expect(firstCell.textContent?.trim()).toBe('1');
		// Flip to FDI on the SHARED store — the same DOM node must update in place.
		prefs.setToothNumbering('fdi');
		await tick();
		expect(firstCell.textContent?.trim()).toBe('18');
		// And back to Universal.
		prefs.setToothNumbering('universal');
		await tick();
		expect(firstCell.textContent?.trim()).toBe('1');
	});
});
