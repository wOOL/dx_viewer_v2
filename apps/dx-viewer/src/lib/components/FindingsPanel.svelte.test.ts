import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import FindingsPanel from './FindingsPanel.svelte';
import { DISEASE_CLASSES } from '$lib/constants';
import type { InferenceResponse } from '$lib/types';

// All disease classes visible by default (so a group reads as "shown" → its button is "Hide").
function layers(visible: number[] = DISEASE_CLASSES.map((c) => c.id)) {
	return {
		bboxes: true,
		toothNumbers: true,
		anatomy: false,
		diseaseSeg: false,
		measurements: false,
		visibleClasses: new Set<number>(visible)
	};
}

// Minimal inference with disease detections (0 = caries grade, 5 = bone loss, 9 = calculus).
// Includes a tooth box covering the disease boxes so the by-tooth grouping can assign them.
function inf(labels: number[], sources: ('ai' | 'user')[] = []): InferenceResponse {
	return {
		detection: '',
		tooth_numbers: '',
		segmentation: '',
		report: '',
		extra: {
			disease_result: {
				result: {
					bboxes: labels.map(() => [0, 0, 10, 10] as [number, number, number, number]),
					labels,
					scores: labels.map(() => 0.9),
					masks: [],
					sources
				},
				extra: { class_probs: [], bboxes_var: [] }
			},
			number_result: {
				result: { bboxes: [[0, 0, 20, 20]], labels: [0], scores: [0.9] }
			},
			anatomy_result: { result: { bboxes: [], labels: [], scores: [] }, extra: { anomaly: false } }
		}
	};
}

describe('FindingsPanel — Diagnostic Results (redesign)', () => {
	it('groups only caries + bone loss; other diseases are their own rows (no Other Findings)', () => {
		const { container } = render(FindingsPanel, {
			inference: inf([0, 5, 9]),
			layers: layers(),
			confThreshold: 0,
			onLayersChange: vi.fn()
		});
		const text = container.textContent ?? '';
		expect(text).toContain('Diagnostic Results');
		expect(text).toContain('Dental Caries');
		expect(text).toContain('Bone Loss');
		expect(text).toContain('Calculus'); // its own row, NOT bucketed
		expect(text).not.toContain('Other Findings');
		expect(text).not.toContain('Overhang'); // 0 findings → row hidden entirely
		// The removed Overlays / Measurements / refine-AI sections must be gone.
		expect(text).not.toContain('Measurements');
		expect(text).not.toContain('Wrong detection');
		expect(text).not.toContain('Tooth Parts');
		expect(container.querySelectorAll('.feedback').length).toBe(0);
	});

	it('only shows groups that have findings (zero-count rows are hidden)', () => {
		const { container } = render(FindingsPanel, {
			inference: inf([0, 0, 5]), // 2 caries, 1 bone loss, nothing else
			layers: layers(),
			confThreshold: 0,
			onLayersChange: vi.fn()
		});
		const counts = Array.from(container.querySelectorAll('.grp-count')).map((e) =>
			e.textContent?.trim()
		);
		// Only the two non-empty groups render — no Calculus/Periapical/... "0" rows.
		expect(counts).toEqual(['2', '1']);
		expect(counts.every((c) => c !== '0')).toBe(true);
	});

	it('switches to By tooth and lists the affected tooth', async () => {
		const onHighlight = vi.fn();
		const { container, getByRole } = render(FindingsPanel, {
			inference: inf([0, 5]),
			layers: layers(),
			confThreshold: 0,
			onLayersChange: vi.fn(),
			onHighlight
		});
		await (getByRole('tab', { name: 'By tooth' }).element() as HTMLButtonElement).click();
		await tick();
		const row = container.querySelector('.tooth-row') as HTMLButtonElement;
		expect(row).toBeTruthy();
		row.click(); // selecting a tooth highlights its detections
		expect(onHighlight).toHaveBeenCalled();
	});

	it("per-group Hide toggles that group's classes via onLayersChange", () => {
		const onLayersChange = vi.fn();
		const { container } = render(FindingsPanel, {
			inference: inf([0]),
			layers: layers(),
			confThreshold: 0,
			onLayersChange
		});
		// Dental Caries group "Hide" (all caries classes visible by default).
		const hideBtn = container.querySelector('.showhide') as HTMLButtonElement;
		expect(hideBtn.textContent?.trim()).toBe('Hide');
		hideBtn.click();
		expect(onLayersChange).toHaveBeenCalled();
		const next = onLayersChange.mock.calls[0][0].visibleClasses as Set<number>;
		// Caries class ids 0–4 were removed.
		expect([0, 1, 2, 3, 4].some((id) => next.has(id))).toBe(false);
	});

	it('Hide All clears every finding class', () => {
		const onLayersChange = vi.fn();
		const { getByTestId } = render(FindingsPanel, {
			inference: inf([0, 5]),
			layers: layers(),
			confThreshold: 0,
			onLayersChange
		});
		(getByTestId('findings-hide-all').element() as HTMLButtonElement).click();
		const next = onLayersChange.mock.calls[0][0].visibleClasses as Set<number>;
		expect([0, 5, 9].every((id) => !next.has(id))).toBe(true);
	});

	it('expanding a group lists findings; click highlights and the control edits', async () => {
		const onHighlight = vi.fn();
		const onEditFinding = vi.fn();
		const { container } = render(FindingsPanel, {
			inference: inf([0]),
			layers: layers(),
			confThreshold: 0,
			onLayersChange: vi.fn(),
			onHighlight,
			onEditFinding
		});
		// Expand Dental Caries (the first group toggle), then let Svelte re-render.
		(container.querySelector('.grp-toggle') as HTMLButtonElement).click();
		await tick();
		const row = container.querySelector('.fi-main') as HTMLButtonElement;
		expect(row).toBeTruthy();
		row.click(); // clicking the finding highlights its detection index (0)
		expect(onHighlight).toHaveBeenCalledWith([0]);
		(container.querySelector('.fi-edit') as HTMLButtonElement).click(); // hide/remove
		expect(onEditFinding).toHaveBeenCalledWith(0);
	});

	it('shows the author tag (not a confidence %) for a user-added finding', async () => {
		const { container } = render(FindingsPanel, {
			inference: inf([0], ['user']),
			layers: layers(),
			confThreshold: 0,
			onLayersChange: vi.fn()
		});
		(container.querySelector('.grp-toggle') as HTMLButtonElement).click();
		await tick();
		const cert = container.querySelector('.fi-cert')?.textContent ?? '';
		expect(cert).toContain('Added by you');
		expect(cert).not.toContain('%');
	});
});
