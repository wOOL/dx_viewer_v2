import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MergeRestoreDialog from './MergeRestoreDialog.svelte';
import type { MergePlan } from '$lib/backup/merge';

// A minimal plan with one ADD (Merge enabled — emptiness is computed from the CHANGE
// ARRAYS, not the counts) and one UPDATE (the toggle renders, driven by the counts).
function planFixture(over: Partial<MergePlan> = {}): MergePlan {
	return {
		patients: {
			add: [{ id: 'p00000000000add', user: 'u', name: 'A', created: '', updated: '' }],
			update: [{ id: 'p00000000000upd', user: 'u', name: 'U', created: '', updated: '' }]
		},
		studies: { add: [], update: [] },
		inferences: { add: [], update: [] },
		studyReportState: { add: [], update: [] },
		cbctReportState: { add: [], update: [] },
		iosState: { add: [], update: [] },
		filesToFetch: { add: [], update: [] },
		suppressed: [],
		possibleDuplicates: [],
		orphansDropped: 0,
		backupDataVersion: 1,
		flippedStudies: [],
		counts: {
			patientsAdded: 1,
			patientsUpdated: 1,
			studiesAdded: 0,
			studiesUpdated: 0,
			stateAdded: 0,
			stateUpdated: 0,
			filesToFetch: 0,
			suppressed: 0,
			possibleDuplicates: 0,
			unchanged: 0
		},
		...over
	};
}

const settle = () => new Promise((r) => setTimeout(r));

describe('MergeRestoreDialog', () => {
	it('re-arms the updates toggle to ON on every open (a cancelled preview must not leak its uncheck)', async () => {
		// The dialog instance is long-lived in LocalDataCard (only the inner content is
		// gated on `open`), so component state survives a close — without the re-arm, an
		// uncheck from a previous preview would silently downgrade the NEXT merge to
		// adds-only, violating the default-ON design.
		const onMerge = vi.fn();
		const { container, rerender } = render(MergeRestoreDialog, {
			open: true,
			plan: planFixture(),
			replaceAllowed: false,
			onMerge
		});
		const checkbox = () =>
			container.querySelector('[data-testid="merge-updates-toggle"]') as HTMLInputElement;
		expect(checkbox().checked).toBe(true); // default ON
		checkbox().click();
		await settle();
		expect(checkbox().checked).toBe(false);

		// Close (cancel) and reopen — as if previewing a DIFFERENT backup later.
		await rerender({ open: false });
		await rerender({ open: true });
		await settle();
		expect(checkbox().checked).toBe(true); // re-armed, not leaked

		(container.querySelector('[data-testid="merge-confirm"]') as HTMLButtonElement).click();
		expect(onMerge).toHaveBeenCalledWith(true);
	});

	it('damage mode shows the casualty list and FORCES Replace off even when the gate allows', async () => {
		const { container } = render(MergeRestoreDialog, {
			open: true,
			plan: planFixture(),
			replaceAllowed: true, // gate would allow — damage must override
			damage: { lost: [{ name: 'Lost Patient', modality: 'xray' }], totalStudies: 2 }
		});
		const warning = container.querySelector('[data-testid="merge-damage"]');
		expect(warning).not.toBeNull();
		expect(warning!.textContent).toContain('Lost Patient');
		expect(warning!.textContent).toContain('1'); // {lost}
		expect(warning!.textContent).toContain('2'); // {total}
		// The modality renders through the shared localized label, never the raw enum.
		expect(warning!.textContent).toContain('X-ray');
		expect(warning!.textContent).not.toContain('(xray)');
		expect(
			(container.querySelector('[data-testid="replace-confirm"]') as HTMLButtonElement).disabled
		).toBe(true);
		expect(
			(container.querySelector('[data-testid="merge-confirm"]') as HTMLButtonElement).disabled
		).toBe(false); // salvage merge stays available
	});

	it('caps its height: a huge casualty list scrolls internally, action buttons stay reachable', async () => {
		// A badly truncated backup can lose hundreds of studies — the dialog must not grow
		// past the viewport (centered + overflow-hidden would push the buttons off-screen).
		const lost = Array.from({ length: 200 }, (_, i) => ({
			name: `Lost Patient ${i}`,
			modality: 'xray'
		}));
		const { container } = render(MergeRestoreDialog, {
			open: true,
			plan: planFixture(),
			replaceAllowed: false,
			damage: { lost, totalStudies: 220 }
		});
		await settle();
		const btn = container.querySelector('[data-testid="merge-confirm"]') as HTMLElement;
		const rect = btn.getBoundingClientRect();
		expect(rect.bottom).toBeGreaterThan(0);
		expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight); // reachable
	});

	it('disables Merge when the (toggle-effective) plan is empty, and Replace when gated off', async () => {
		// Plan with ONLY an update: unchecking the toggle makes the effective plan empty.
		const plan = planFixture({
			counts: {
				patientsAdded: 0,
				patientsUpdated: 1,
				studiesAdded: 0,
				studiesUpdated: 0,
				stateAdded: 0,
				stateUpdated: 0,
				filesToFetch: 0,
				suppressed: 0,
				possibleDuplicates: 0,
				unchanged: 0
			}
		});
		plan.patients.add = []; // ONLY the update remains — toggle OFF must empty the plan
		const { container } = render(MergeRestoreDialog, {
			open: true,
			plan,
			replaceAllowed: false
		});
		const mergeBtn = () =>
			container.querySelector('[data-testid="merge-confirm"]') as HTMLButtonElement;
		const replaceBtn = () =>
			container.querySelector('[data-testid="replace-confirm"]') as HTMLButtonElement;
		expect(replaceBtn().disabled).toBe(true); // gate refused
		expect(mergeBtn().disabled).toBe(false); // the update is mergeable while toggled ON
		(container.querySelector('[data-testid="merge-updates-toggle"]') as HTMLInputElement).click();
		await settle();
		expect(mergeBtn().disabled).toBe(true); // adds-only plan is empty → no-op
	});
});
