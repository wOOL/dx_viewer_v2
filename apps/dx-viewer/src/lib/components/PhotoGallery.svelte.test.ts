import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import PhotoGallery from './PhotoGallery.svelte';
import type { StoredStudy } from '$lib/types';

// A camera photo is a study with modality 'photo' (no inference). The gallery is
// reused by the patient page and the 2D viewer's Photos tab.
function photo(id: string, capturedAt = '2026-05-20T10:00:00.000Z'): StoredStudy {
	return {
		id,
		patientId: 'p1',
		patientName: 'Test Patient',
		capturedAt,
		modality: 'photo',
		imageDataUrl: 'data:image/png;base64,iVBORw0KGgo='
	};
}

describe('PhotoGallery (component)', () => {
	it('shows the empty state + "Add photo" shortcut when there are no photos', () => {
		const onAdd = vi.fn();
		const { container } = render(PhotoGallery, { photos: [], onAdd });
		expect(container.textContent ?? '').toContain('No photos yet');
		const addBtn = container.querySelector('.add-btn') as HTMLButtonElement | null;
		expect(addBtn).not.toBeNull();
		addBtn!.click();
		expect(onAdd).toHaveBeenCalledOnce();
	});

	it('renders one thumbnail per photo and opens the lightbox on click', async () => {
		const { container } = render(PhotoGallery, { photos: [photo('a'), photo('b')] });
		expect(container.querySelectorAll('.tile').length).toBe(2);
		// No lightbox until a thumbnail is opened.
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		(container.querySelector('.tile button') as HTMLButtonElement).click();
		await tick();
		expect(container.querySelector('[role="dialog"]')).not.toBeNull();
	});

	it('calls onDelete with the study id from the grid delete button (without opening the lightbox)', () => {
		const onDelete = vi.fn();
		const { container } = render(PhotoGallery, { photos: [photo('x1')], onDelete });
		const del = container.querySelector('.tile .del') as HTMLButtonElement | null;
		expect(del).not.toBeNull();
		del!.click();
		expect(onDelete).toHaveBeenCalledWith('x1');
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('every grid tile carries a UNIQUE accessible name (date-bound), not the generic "View"', () => {
		const a: StoredStudy = { ...photo('a'), capturedAt: '2026-05-01T00:00:00.000Z' };
		const b: StoredStudy = { ...photo('b'), capturedAt: '2026-05-20T00:00:00.000Z' };
		const { container } = render(PhotoGallery, { photos: [a, b] });
		const tiles = [
			...container.querySelectorAll('.tile button:first-child')
		] as HTMLButtonElement[];
		expect(tiles.length).toBe(2);
		const labels = tiles.map((t) => t.getAttribute('aria-label')?.trim());
		// Pre-fix: both were "View" → same label. After fix: unique per photo.
		expect(new Set(labels).size).toBe(2);
		// And the label should *include* something identifying (the date string).
		for (const l of labels) expect(l).toMatch(/2026/);
	});

	it('deletes the active photo from the lightbox and closes it', async () => {
		const onDelete = vi.fn();
		const { container } = render(PhotoGallery, { photos: [photo('only')], onDelete });
		(container.querySelector('.tile button') as HTMLButtonElement).click();
		await tick();
		const lbDelete = container.querySelector('.lb-btn.danger') as HTMLButtonElement | null;
		expect(lbDelete).not.toBeNull();
		lbDelete!.click();
		await tick();
		expect(onDelete).toHaveBeenCalledWith('only');
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	// #86 — opening the lightbox must move keyboard focus into the dialog (proves
	// the use:focusTrap directive is wired, not just that the action unit-passes).
	it('moves focus into the lightbox dialog when it opens', async () => {
		const { container } = render(PhotoGallery, { photos: [photo('a'), photo('b')] });
		(container.querySelector('.tile button') as HTMLButtonElement).click();
		await tick();
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog).not.toBeNull();
		expect(dialog.contains(document.activeElement)).toBe(true);
	});

	// FIX A — the lightbox is keyed to the photo's stable id, NOT its array index. If
	// `photos` shrinks/reorders while the lightbox is open (parent date-filter or tab
	// change, a two-tab delete, the studies-store 100s token re-bake reassigning the
	// list), an index would now point at a DIFFERENT photo (PHI mismatch) or out of
	// bounds (blank dialog). Keyed by id it must keep showing the SAME photo.
	it('keeps showing the same photo (by id) when an EARLIER photo is removed', async () => {
		const a = photo('a', '2026-05-01T00:00:00.000Z');
		const b = photo('b', '2026-05-02T00:00:00.000Z');
		const c = photo('c', '2026-05-03T00:00:00.000Z');
		const { container, rerender } = render(PhotoGallery, { photos: [a, b, c] });

		// Open the lightbox on the MIDDLE photo 'b' (grid index 1).
		const tiles = container.querySelectorAll('.tile button');
		(tiles[1] as HTMLButtonElement).click();
		await tick();
		expect(container.querySelector('[role="dialog"]')).not.toBeNull();
		const captionB = container.querySelector('.lb-cap')?.textContent;
		// 'b' has a unique capture date, so the caption uniquely identifies the photo.
		expect(captionB).toMatch(/2026/);

		// Remove the EARLIER photo 'a' → 'b' shifts from index 1 to index 0. An
		// index-keyed lightbox would now show 'c'; keyed by id it must still show 'b'.
		await rerender({ photos: [b, c] });
		await tick();
		expect(container.querySelector('[role="dialog"]')).not.toBeNull();
		expect(container.querySelector('.lb-cap')?.textContent).toBe(captionB);
	});

	// FIX A — if the photo open in the lightbox is itself removed, the lightbox must
	// CLOSE rather than render a blank/undefined dialog.
	it('closes the lightbox when the active photo is removed from the list', async () => {
		const a = photo('a');
		const b = photo('b');
		const c = photo('c');
		const { container, rerender } = render(PhotoGallery, { photos: [a, b, c] });

		(container.querySelectorAll('.tile button')[1] as HTMLButtonElement).click(); // open 'b'
		await tick();
		expect(container.querySelector('[role="dialog"]')).not.toBeNull();

		await rerender({ photos: [a, c] }); // remove the active 'b'
		await tick();
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	// FIX C — a rapid double-click on a tile's delete button must invoke onDelete only
	// ONCE for that id (a 2nd call would hit an already-deleted id and surface a
	// spurious failure alert). The button is also disabled while the delete is in flight.
	it('invokes onDelete only once on a rapid double-click (grid tile)', async () => {
		let resolveDelete!: () => void;
		const onDelete = vi.fn(() => new Promise<void>((r) => (resolveDelete = r)));
		const { container } = render(PhotoGallery, { photos: [photo('a'), photo('b')], onDelete });

		const del = container.querySelector('.tile .del') as HTMLButtonElement;
		expect(del).not.toBeNull();
		del.click();
		del.click();
		await tick();

		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(onDelete).toHaveBeenCalledWith('a');
		expect(del.disabled).toBe(true);

		// Re-enabled once the parent's promise settles.
		resolveDelete();
		await tick();
		await tick();
		expect(del.disabled).toBe(false);
	});

	// FIX C — the same re-entrancy guard applies to the lightbox delete button.
	it('invokes onDelete only once on a rapid double-click (lightbox)', async () => {
		let resolveDelete!: () => void;
		const onDelete = vi.fn(() => new Promise<void>((r) => (resolveDelete = r)));
		const { container } = render(PhotoGallery, { photos: [photo('only')], onDelete });

		(container.querySelector('.tile button') as HTMLButtonElement).click();
		await tick();
		const lbDelete = container.querySelector('.lb-btn.danger') as HTMLButtonElement;
		expect(lbDelete).not.toBeNull();
		lbDelete.click();
		lbDelete.click();
		await tick();

		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(onDelete).toHaveBeenCalledWith('only');
		resolveDelete();
	});

	// FIX B — a tile <img> whose protected-file token has expired/404'd must degrade
	// to a placeholder instead of a broken-image glyph.
	it('shows a placeholder when a tile image fails to load', async () => {
		const { container } = render(PhotoGallery, { photos: [photo('a')] });

		const img = container.querySelector('.tile img') as HTMLImageElement;
		expect(img).not.toBeNull();

		// Firing the img's error event (what a 404'd protected-file URL does) must swap
		// in the placeholder. (Svelte 5 delegates the listener, so img.onerror stays
		// null — assert the observable behaviour, not the DOM property.)
		img.dispatchEvent(new Event('error'));
		await tick();

		// The broken <img> is gone, replaced by the .ph placeholder box.
		expect(container.querySelector('.tile img')).toBeNull();
		expect(container.querySelector('.tile .ph')).not.toBeNull();
	});

	// FIX B — the lightbox image degrades to a placeholder too.
	it('shows a placeholder in the lightbox when its image fails to load', async () => {
		const { container } = render(PhotoGallery, { photos: [photo('a')] });
		(container.querySelector('.tile button') as HTMLButtonElement).click();
		await tick();

		const img = container.querySelector('.lb-img') as HTMLImageElement;
		expect(img).not.toBeNull();
		img.dispatchEvent(new Event('error'));
		await tick();

		expect(container.querySelector('.lb-img')).toBeNull();
		expect(container.querySelector('.lb-ph')).not.toBeNull();
	});
});

/*
 * Playwright E2E note (write, do NOT run) — the two-tab / date-filter lightbox case.
 *
 * Covers FIX A in the real app, where `photos` is reassigned out from under an open
 * lightbox by something OTHER than the user's own delete click (so a unit re-render
 * can't fully stand in for it):
 *
 *   Date-filter variant
 *   1. Sign in (storageState) and open a patient that has photos on two different
 *      capture dates (so the patient page's visit-date filter actually splits them).
 *   2. Open the photo lightbox on a photo from the LATER date and remember which
 *      photo it is (match the <img src> file id / the .lb-cap date — not the grid
 *      position).
 *   3. While the lightbox is open, switch the patient page's capture-date filter to
 *      the EARLIER date. This reassigns PhotoGallery's `photos` to a different,
 *      shorter list that no longer contains the open photo. Assert the dialog has
 *      CLOSED — never a shifted or blank dialog.
 *
 *   Two-tab variant
 *   4. Open the same patient in two tabs. In tab A, open the lightbox on a LATER
 *      photo. In tab B, delete an EARLIER photo than the one open in tab A.
 *   5. Back in tab A, after the studies store refreshes / re-bakes file URLs (the
 *      background ~100s token re-bake also reassigns the array), assert tab A's
 *      lightbox STILL shows the same photo by id (its .lb-cap is unchanged) — proving
 *      the lightbox is keyed to the photo id, not to a now-stale array index.
 */
