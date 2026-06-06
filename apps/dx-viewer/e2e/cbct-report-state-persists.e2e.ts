import { test, expect, type Page } from '@playwright/test';
import { STUDIES, url, waitFor3dReady } from './helpers';
import { seedCbctStudy, readAll } from './seed';

// CBCT report sign-off + per-tooth approvals were localStorage-only; a clinician signing on
// laptop A lost the signature on laptop B. LOCAL-FIRST: they now persist to the
// `cbctReportState` store in IndexedDB. This proves the round-trip by:
//   1. seeding the segmented CBCT study,
//   2. signing ("Approve all and sign") → the "Signed" banner appears,
//   3. waiting for the debounced write to land in IndexedDB (signedAt set),
//   4. reloading — onMount pulls the state back from IndexedDB and re-renders Signed.
const cbct = STUDIES.cbctSeg;

async function signedAt(page: Page, studyId: string): Promise<string | null> {
	const rows = await readAll<{ study: string; signedAt?: string | null }>(page, 'cbctReportState');
	return rows.find((r) => r.study === studyId)?.signedAt ?? null;
}

test('CBCT sign-off survives a fresh-browser reload (IndexedDB-backed)', async ({ page }) => {
	const ok = await seedCbctStudy(page, cbct.patient, cbct.study, 'CBCT Report Patient');
	test.skip(!ok, 'test_images CBCT fixtures not present');

	await page.goto(url.cbct(cbct) + '?view=report');
	await waitFor3dReady(page, { timeout: 60_000 });

	// 1) Press "Approve all and sign". The banner ("Signed · …") should appear.
	await page.getByRole('button', { name: /Approve all and sign/i }).click();
	await expect(page.getByText(/Signed/).first()).toBeVisible({ timeout: 5_000 });

	// 2) Wait for the debounced persist to land in IndexedDB.
	await expect.poll(() => signedAt(page, cbct.study), { timeout: 10_000 }).not.toBeNull();

	// 3) Reload — onMount pulls the state from IndexedDB and re-renders Signed.
	await page.reload();
	await waitFor3dReady(page, { timeout: 60_000 });
	await expect(page.getByText(/Signed/).first()).toBeVisible({ timeout: 10_000 });
});
