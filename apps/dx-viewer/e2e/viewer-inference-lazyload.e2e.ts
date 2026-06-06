import { test, expect } from '@playwright/test';
import { STUDIES, url, nonTransparentPixels } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// C1 lazy-load proof. The studies-list refresh no longer pulls each study's
// `inference` blob (bounded memory at scale — STUDY_LIST_FIELDS); the 2D viewer
// now fetches it lazily per patient via studies.ensureInference(). The AI overlay
// is drawn ONLY from study.inference, so if the lazy load didn't fire (or wired
// up wrong) the overlay would be permanently blank — a serious regression. This
// asserts the overlay actually paints AFTER the lazy fetch resolves.
//
// The AUTHORITATIVE signal is the overlay canvas gaining pixels (same as the
// trusted viewer-2d.e2e): the overlay is a separate, untainted 2D canvas
// (masks/boxes/labels only — no cross-origin image), so getImageData on it is
// readable. It paints from disease_result + anatomy_result, i.e. EVERY mask the
// inference carries, so non-zero pixels prove the lazily-loaded inference reached
// the renderer end-to-end.
//
// We deliberately do NOT assert the FindingsPanel's numeric count as a hard gate:
// that header (`findings.detected`) is (a) i18n-interpolated, so its exact text is
// locale-dependent, and (b) counts only taxonomy-mapped findings that clear the
// confidence threshold — it can legitimately read 0 while the overlay is fully
// painted (e.g. detections are only the catch-all Unsure/Other classes). The
// overlay pixels are the correct, unambiguous proof of the lazy load.
const OVERLAY = 'canvas.pointer-events-none';

test.describe('2D viewer lazy inference load (C1)', () => {
	test('AI overlay renders after the lazily-loaded inference arrives', async ({ page }) => {
		const pageErrors: Error[] = [];
		page.on('pageerror', (e) => pageErrors.push(e));

		await page.goto('/studies');
		await seedXrayStudies(page, [
			{
				patient: STUDIES.xray2d.patient,
				study: STUDIES.xray2d.study,
				patientName: 'Test Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		await page.goto(url.viewer2d(STUDIES.xray2d));

		// The overlay canvas mounts immediately (empty); it only gains pixels once
		// ensureInference resolves and the redraw runs. Poll until it has content —
		// that transition (empty → painted) IS the lazy load firing end-to-end. A
		// brief initial "0 pixels" while the fetch is in flight is expected; we poll
		// through it. A permanently-empty overlay after the timeout would be a real
		// C1 regression (inference fetched but never reached the renderer).
		await expect(page.locator(OVERLAY).first()).toBeVisible();
		await expect
			.poll(() => nonTransparentPixels(page, OVERLAY), {
				timeout: 30_000,
				message:
					'overlay never painted — lazily-loaded inference did not reach the 2D overlay renderer (C1 regression)'
			})
			.toBeGreaterThan(200);

		// The lazy fetch + redraw must not have thrown along the way.
		expect(pageErrors, `page errors during lazy inference load: ${pageErrors.join('; ')}`).toEqual(
			[]
		);
	});
});
