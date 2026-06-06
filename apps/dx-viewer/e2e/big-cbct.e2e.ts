import { test, expect } from '@playwright/test';
import { STUDIES, url, waitFor3dReady, waitForCbctVolume } from './helpers';

// The full-resolution CBCT (~88 MB .nii.gz; decompresses to a large float volume —
// the "Large volumes can take 1–5 minutes" path). This guards the big-volume
// pipeline: every view must parse + render without crashing/OOM and within a sane
// budget (a regression that makes the parse hang, or the #87/#90 voxel re-surface
// blow up on a large segmentation, would trip these).
const big = STUDIES.cbctSeg; // 5kduik758ngj76r — a full-resolution volume

test.describe('big CBCT (full-resolution volume)', () => {
	test('MPR parses + renders the large volume within budget, no crash', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));

		const t0 = Date.now();
		await page.goto(url.cbct(big) + '?view=mpr');
		await waitForCbctVolume(page, { timeout: 120_000 });
		const elapsed = Date.now() - t0;

		// Generous hang-guard (normal is ~25–30s) — fails only on a gross regression.
		expect(elapsed, `large-volume MPR became ready in ${elapsed}ms`).toBeLessThan(90_000);
		expect(errors, errors.join('\n')).toEqual([]);
	});

	test('3D volume view re-surfaces + renders the large segmentation', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));

		await page.goto(url.cbct(big) + '?view=volume');
		await waitFor3dReady(page, { timeout: 120_000 });
		await expect(page.locator('canvas').first()).toBeVisible();
		expect(errors, errors.join('\n')).toEqual([]);
	});

	test('panoramic reformat renders for the large volume', async ({ page }) => {
		await page.goto(url.cbct(big) + '?view=panoramic');
		await waitFor3dReady(page, { timeout: 120_000 });
		await expect(page.locator('canvas').first()).toBeVisible();
		await expect(page.locator('button.pano-tool').first()).toBeVisible();
	});
});
