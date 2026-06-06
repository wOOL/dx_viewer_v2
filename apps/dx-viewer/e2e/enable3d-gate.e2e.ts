import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// The "Enable 3D (CBCT/IOS) tools" account preference gates ALL 3D surfaces. The demo
// account ships with it ON (so the other 13 CBCT/IOS specs work), so this spec drives
// the Settings toggle to OFF, asserts the gate, then restores ON — with a finally that
// GUARANTEES the account is left ON regardless of assertion outcome, so test ordering
// can't leave the shared demo account in a 2D-only state.
//
// Runs serially (single worker would also do) and is the one spec that mutates the
// account-level pref; everything it changes it changes back.
test.describe.configure({ mode: 'serial' });

async function setToggle(page: import('@playwright/test').Page, on: boolean) {
	await page.goto('/settings');
	const toggle = page.getByTestId('enable-3d-toggle');
	await expect(toggle).toBeVisible();
	if ((await toggle.isChecked()) !== on) {
		await toggle.click();
		// The change persists to the user record ASYNC (auth.setThreeDEnabled → PB update +
		// authStore.save). The checkbox is `checked={auth.threeDEnabled}` (the gate source)
		// and `disabled={savingThreeD}`: a native-flip transient can satisfy toBeChecked
		// BEFORE the persist propagates to auth.user/the cookie, so an immediate goto would
		// read stale auth and the gate wouldn't redirect (the load-dependent flake). The
		// toggle re-ENABLES only once savingThreeD flips false in the persist's finally — by
		// then auth.threeDEnabled is updated — so wait for BOTH the checked state AND enabled.
		await expect(toggle).toBeChecked({ checked: on });
		await expect(toggle).toBeEnabled();
		// Belt-and-suspenders: confirm the reactive gate itself reflects the new value before
		// any caller navigates (toBeChecked already reads auth.threeDEnabled, but this guards
		// against the controlled-input native-flip transient under load).
		await expect.poll(async () => await toggle.isChecked(), { timeout: 10_000 }).toBe(on);
	}
}

test.describe('Enable 3D account gate', () => {
	test.afterAll(async ({ browser }) => {
		// Safety net: leave the demo account with 3D ON no matter what.
		const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
		const page = await ctx.newPage();
		try {
			await setToggle(page, true);
		} catch {
			/* best effort */
		} finally {
			await ctx.close();
		}
	});

	test('OFF hides 3D everywhere; ON restores it', async ({ page }) => {
		// LOCAL-FIRST: seed a CBCT study so the 3D tab appears (it renders only when the
		// patient has a cbct/ios study; the gating itself is flag-based). The tab + route
		// gate only read the study metadata + the enable3d flag — no volume blob needed.
		await seedXrayStudies(page, [
			{
				patient: STUDIES.cbctSeg.patient,
				study: 'seed3dgatestd01',
				patientName: '3D Gate Patient',
				modality: 'cbct',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		// --- Baseline ON: the 3D tab shows, and the CBCT route mounts (doesn't redirect). ---
		await setToggle(page, true);
		await page.goto(`/patients/${STUDIES.cbctSeg.patient}`);
		// Scope to the tab-pill row (a study tile can also contain "3D" in its label).
		const threeDTab = page.locator('button.tab-pill', { hasText: /3D/ });
		await expect(threeDTab).toBeVisible();

		// --- Turn 3D OFF ---
		await setToggle(page, false);

		// 1. The patient record no longer shows the 3D tab.
		await page.goto(`/patients/${STUDIES.cbctSeg.patient}`);
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await expect(page.locator('button.tab-pill', { hasText: /3D/ })).toHaveCount(0);

		// 2. A direct/bookmarked CBCT link redirects away (the viewer never mounts).
		await page.goto(url.cbct(STUDIES.cbctSeg));
		await expect(page).not.toHaveURL(/\/cbct\//);

		// 3. Same for IOS.
		await page.goto(url.ios(STUDIES.iosSeg));
		await expect(page).not.toHaveURL(/\/ios\//);

		// 4. The upload page no longer offers the CBCT / IOS modality buttons.
		await page.goto('/upload');
		await expect(page.getByRole('button', { name: /CBCT/ })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /IOS/ })).toHaveCount(0);
		// 2D modalities remain.
		await expect(page.getByRole('button', { name: /X-Ray/i }).first()).toBeVisible();

		// --- Turn 3D back ON → the surfaces return ---
		await setToggle(page, true);
		// The CBCT viewer is reachable again (the route no longer redirects away)…
		await page.goto(url.cbct(STUDIES.cbctSeg));
		await expect(page).toHaveURL(/\/cbct\//);
		// …and the patient record shows the 3D tab again, and the upload page offers the
		// CBCT/IOS modalities again.
		await page.goto(`/patients/${STUDIES.cbctSeg.patient}`);
		await expect(page.locator('button.tab-pill', { hasText: /3D/ })).toBeVisible();
		await page.goto('/upload');
		await expect(page.getByRole('button', { name: /CBCT/ })).toBeVisible();
	});
});
