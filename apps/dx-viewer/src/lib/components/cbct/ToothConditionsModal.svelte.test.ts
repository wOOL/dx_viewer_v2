import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ToothConditionsModal from './ToothConditionsModal.svelte';

// A CBCT "Missing tooth (segmentation gap)" finding is a deterministic geometry
// derivation — it has NO AI confidence. The modal must NOT fabricate a confidence %
// for such a finding (the callers used to default to 0 / 0.9, so the same finding read
// "0%" via the 3D mesh and "90%" via the report). The pill renders only for a real
// confidence — matching ToothDetailCard.
describe('ToothConditionsModal (component)', () => {
	it('omits the confidence pill for a finding with no confidence, shows it for a real one', () => {
		const { container } = render(ToothConditionsModal, {
			tooth: 5,
			open: true,
			conditions: [
				{ name: 'Missing tooth (segmentation gap)' }, // no confidence (geometry gap)
				{ name: 'Calculus', confidence: 0.72 } // a real AI confidence
			],
			onclose: vi.fn()
		});
		const text = container.textContent ?? '';
		expect(text).toContain('Missing tooth (segmentation gap)');
		expect(text).toContain('Calculus');
		// The real confidence renders as a pill…
		expect(text).toContain('72%');
		// …and the gap finding gets NO fabricated/NaN pill: exactly one % pill total.
		expect(text).not.toContain('NaN');
		const pills = Array.from(container.querySelectorAll('li span')).filter((s) =>
			/%$/.test(s.textContent?.trim() ?? '')
		);
		expect(pills.length).toBe(1);
	});

	it('renders no pills at all when no condition has a confidence (pure CBCT case)', () => {
		const { container } = render(ToothConditionsModal, {
			tooth: 8,
			open: true,
			conditions: [{ name: 'Missing tooth (segmentation gap)' }],
			onclose: vi.fn()
		});
		const text = container.textContent ?? '';
		expect(text).toContain('Missing tooth (segmentation gap)');
		expect(text).not.toContain('%');
		expect(text).not.toContain('NaN');
	});
});
