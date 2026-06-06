import { test, expect, type Page } from '@playwright/test';
import { STUDIES, url, waitFor3dReady, waitForCbctVolume } from './helpers';
import { seedCbctStudy, readAll } from './seed';

const cbct = STUDIES.cbctSeg;

// LOCAL-FIRST: seed a segmented CBCT study (tooth.nrrd volume + the demo's ORIGINAL 31-mesh
// cbct-seg.zip, byte-identical, recovered from the pre-wipe snapshot) into IndexedDB. Markups
// now persist to the `cbctReportState` store, so we read them from IndexedDB rather than the
// old dxv:cbct:markups localStorage key.
async function cbctMarkupCount(page: Page, studyId: string): Promise<number> {
	const rows = await readAll<{ study: string; markups?: { measurements?: unknown[] } }>(
		page,
		'cbctReportState'
	);
	return rows.find((r) => r.study === studyId)?.markups?.measurements?.length ?? 0;
}

test.describe('CBCT viewer', () => {
	test.beforeEach(async ({ page }) => {
		const ok = await seedCbctStudy(page, cbct.patient, cbct.study, 'CBCT E2E Patient');
		test.skip(!ok, 'test_images CBCT fixtures (tooth.nrrd + cbct-seg.zip) not present');
	});

	test('MPR view loads the slice panes', async ({ page }) => {
		await page.goto(url.cbct(cbct) + '?view=mpr');
		await waitForCbctVolume(page);
		// The three orthogonal panes are labelled (CSS uppercases the capitalised text).
		await expect(page.getByText('Axial').first()).toBeVisible();
		await expect(page.getByText('Sagittal').first()).toBeVisible();
		await expect(page.getByText('Coronal').first()).toBeVisible();
	});

	test('slab-thickness (MIP) tool cycles through thicknesses', async ({ page }) => {
		await page.goto(url.cbct(cbct) + '?view=mpr');
		await waitForCbctVolume(page);
		const slab = page.locator('button[aria-label="Slab thickness"]');
		await expect(slab).toBeVisible();
		const offTitle = await slab.getAttribute('title');
		expect(offTitle).toMatch(/off/i);
		await slab.click();
		await expect.poll(() => slab.getAttribute('title')).toMatch(/slices/i);
	});

	test('3D volume view renders a mesh', async ({ page }) => {
		await page.goto(url.cbct(cbct) + '?view=volume');
		await waitFor3dReady(page);
		await expect(page.locator('canvas').first()).toBeVisible();
	});

	test('Report view shows findings (not the all-empty state) (#85)', async ({ page }) => {
		await page.goto(url.cbct(cbct) + '?view=report');
		await waitFor3dReady(page);
		// The #85 regression made every report open with a category pre-filter that
		// hid all findings → the "no findings" empty-state. It must not appear.
		await expect(page.getByText(/Tooth-level findings will appear here/i)).toHaveCount(0);

		// The conditions modal must NOT fabricate a confidence for the synthesized
		// "Missing tooth (segmentation gap)" finding (a geometry gap has no AI score; the
		// report previously defaulted to 0.9 → a bogus "90%"). Open a tooth card's
		// Conditions modal and assert it shows no percentage pill.
		const more = page.getByTestId('tooth-more').first();
		await expect(more).toBeVisible();
		// Trigger the handler directly: the dense report right-column overlaps the click
		// point at the test viewport (a layout-density artifact, not what we're testing —
		// we're asserting the modal's CONTENT has no fabricated confidence).
		await more.evaluate((el) => (el as HTMLElement).click());
		const modal = page.getByRole('dialog', { name: /conditions/i });
		await expect(modal).toBeVisible();
		await expect(modal.getByText(/\d+\s*%/)).toHaveCount(0);
	});

	test('MPR linear measurement is persisted to IndexedDB (cbctReportState)', async ({ page }) => {
		await page.goto(url.cbct(cbct) + '?view=mpr');
		await waitForCbctVolume(page);

		await page.locator('button[aria-label="Linear measurement"]').click();
		await page.waitForTimeout(300);

		// Drag inside the axial pane canvas (top-left, first in DOM) using its real
		// bounding box — hardcoded screen coords were flaky across layouts.
		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('axial pane canvas not found');
		await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 10 });
		await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.65, { steps: 10 });
		await page.mouse.up();

		// LOCAL-FIRST: markups ride the `cbctReportState` store (was localStorage-only). The
		// debounced save (350ms) lands the measurement in IndexedDB.
		await expect
			.poll(() => cbctMarkupCount(page, cbct.study), { timeout: 15_000 })
			.toBeGreaterThan(0);

		// Survives a reload (save path) — restore-render is proven on the IOS sibling.
		await page.reload();
		await waitForCbctVolume(page);
		expect(await cbctMarkupCount(page, cbct.study)).toBeGreaterThan(0);
	});

	test('Panoramic view is interactive (tool strip present) (#20)', async ({ page }) => {
		await page.goto(url.cbct(cbct) + '?view=panoramic');
		await waitFor3dReady(page);
		await expect(page.locator('canvas').first()).toBeVisible();
		// The #20 fix replaced a static MIP with an interactive PanoramicCanvas — its
		// tool strip (Ruler/Pan/Crosshair/slab/zoom/overlays) is the regression signal.
		await expect(page.locator('button.pano-tool')).toHaveCount(6);
		await expect(page.locator('button[title^="Ruler"]')).toBeVisible();
	});

	test('left-rail slice tools only appear in the MPR layout (not 3D / Panoramic)', async ({
		page
	}) => {
		// The rail's measure/angle/etc. act on the MPR panes; in 3D they are inert and in
		// Panoramic they duplicated that view's own ruler. They must be hidden there.
		const measure = page.locator('button[aria-label="Linear measurement"]');

		await page.goto(url.cbct(cbct) + '?view=volume');
		await waitFor3dReady(page);
		await expect(measure).toHaveCount(0);

		await page.goto(url.cbct(cbct) + '?view=panoramic');
		await waitFor3dReady(page);
		await expect(measure).toHaveCount(0); // no rail ruler here…
		await expect(page.locator('button[title^="Ruler"]')).toBeVisible(); // …only the pano's own

		await page.goto(url.cbct(cbct) + '?view=mpr');
		await waitForCbctVolume(page);
		await expect(measure).toBeVisible(); // present where it actually works
	});

	test('MPR pane maximize toggles to a single pane', async ({ page }) => {
		await page.goto(url.cbct(cbct) + '?view=mpr');
		await waitForCbctVolume(page);
		const maximize = page.locator('button[aria-label="Maximize pane"]').first();
		await maximize.click();
		// After maximizing, that control flips to "Restore layout".
		await expect(page.locator('button[aria-label="Restore layout"]').first()).toBeVisible();
	});

	test('Layers panel follows the tooth-numbering preference (CbctWorkspace.meshNameLabel)', async ({
		page
	}) => {
		// Sibling of the IOS check, but a DISTINCT renderer: the CBCT Layers labels come
		// from CbctWorkspace.meshNameLabel (deriveToothMapping → toothDisplay), not
		// meshLabel.meshDisplayName. FDI-only lower-jaw numbers (33-38, 41-48) can't appear
		// under Universal (1-32), so they discriminate which scheme the layer CHECKBOXES use.
		const fdiOnly = /Tooth (3[3-8]|4[1-8])/;
		const layerCb = (re: RegExp) => page.getByRole('checkbox', { name: re });

		// volume view shows the seg mesh + the Layers sidebar without the slow raw-volume parse.
		await page.goto(url.cbct(cbct) + '?view=volume');
		await waitFor3dReady(page);
		await page.evaluate(() => localStorage.removeItem('dxv:toothNumbering'));
		await page.reload();
		await waitFor3dReady(page);
		await expect(layerCb(/^Tooth /i).first()).toBeVisible({ timeout: 60_000 }); // layers populated
		// poll (not a one-shot count): the layer checkboxes render progressively.
		await expect.poll(() => layerCb(fdiOnly).count()).toBe(0); // Universal → no FDI-only labels

		await page.evaluate(() => localStorage.setItem('dxv:toothNumbering', 'fdi'));
		await page.reload();
		await waitFor3dReady(page);
		await expect(layerCb(/^Tooth /i).first()).toBeVisible({ timeout: 60_000 });
		await expect.poll(() => layerCb(fdiOnly).count()).toBeGreaterThan(0); // FDI → lower-jaw FDI

		await page.evaluate(() => localStorage.removeItem('dxv:toothNumbering'));
	});

	test('Layers list is ordered jaws → teeth → canals (not alphabetical)', async ({ page }) => {
		// The AI ships generic VTK mesh names, so the old name-prefix sort fell back to
		// alphabetical → "Canal 1" sorted FIRST (before the jaws + teeth). The geometry-
		// derived rank now orders jaws first; the first layer checkbox must be a Jaw.
		await page.goto(url.cbct(cbct) + '?view=volume');
		await waitFor3dReady(page);
		// The only checkboxes are the Layers (per-mesh + reduce-noise); the first one in
		// DOM order, once the mesh list populates, must be the leading Jaw — retries until
		// the panel settles (before that, only the trailing reduce-noise checkbox exists).
		await expect(page.getByRole('checkbox').first()).toHaveAccessibleName(/^Jaw/i, {
			timeout: 60_000
		});
	});

	test('anatomy sidebar reports no Sinus row (model has no sinus class — fabricated-content)', async ({
		page
	}) => {
		// Pre-fix the anatomy section listed a hardcoded "Sinus: 0" alongside the real
		// teeth/jaws/canals, falsely implying the sinus was assessed and found clear. The
		// CBCT segmentation model emits no sinus class, so the row was removed.
		await page.goto(url.cbct(cbct) + '?view=volume');
		await waitFor3dReady(page);
		// A populated layer checkbox ⇒ meshStats loaded ⇒ the anatomy counts are derived.
		await expect(page.getByRole('checkbox').first()).toHaveAccessibleName(/^(Jaw|Tooth)/i, {
			timeout: 60_000
		});
		// The per-instance anatomy rows are shown (so this isn't the small "Structures: N"
		// branch that never had a sinus row) ...
		await expect(page.getByText('Canals', { exact: true })).toBeVisible();
		// ... but there is NO Sinus row.
		await expect(page.getByText('Sinus', { exact: true })).toHaveCount(0);
	});
});
