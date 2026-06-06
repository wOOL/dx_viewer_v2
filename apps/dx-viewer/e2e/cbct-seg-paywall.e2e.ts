import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedCbctRaw, seedIosRaw, seedCbctStudy } from './seed';

// A1 — the CBCT + IOS "Run segmentation" buttons fire a BILLABLE AI call
// (/api/ai/cbct_seg_inference, /api/ai/ios_seg_inference). They must, like the 2D
// X-ray paths, (1) proactively gate on the subscription (open the PaywallModal and
// NOT call the AI when there's no active sub) and (2) translate a backend 403 into
// the same PaywallModal.
//
// NOTE (read before adapting): the demo account used by the E2E suite IS subscribed
// (the whole suite depends on that to exercise the viewers), so this spec CANNOT
// observe the no-sub proactive-paywall branch end-to-end without a SEPARATE,
// unsubscribed storageState. Two ways to make it fully assert, both done centrally:
//   (a) add an unsubscribed account + project/fixture, navigate as that user to a RAW
//       (un-segmented) study and click "Run segmentation" → assert the paywall dialog
//       opens and that NO request to /api/ai/*_seg_inference was made; or
//   (b) route.fulfill() the seg endpoint with a 403 for the subscribed account and
//       assert the dialog opens (covers the catch-side defense-in-depth branch).
// Until then the tests below are best-effort: they assert the wiring is present
// (the Run-CTA exists on a raw study, and the soft-paywall dialog markup is reachable)
// and intercept the AI call so a subscribed run can't actually bill during CI.

const cbctRaw = STUDIES.cbctRaw; // a CBCT with NO segmentation → shows the Run-AI CTA
const iosRaw = STUDIES.iosRaw; // an IOS with NO segmentation → shows the Run-AI CTA

// LOCAL-FIRST: seed RAW (image-only, un-segmented) CBCT + IOS studies so the viewers show
// the "Run AI segmentation" CTA — the billable entry point this spec gates.
test.describe('3D segmentation paywall (A1)', () => {
	test.beforeEach(async ({ page }) => {
		const okC = await seedCbctRaw(page, cbctRaw.patient, cbctRaw.study);
		const okI = await seedIosRaw(page, iosRaw.patient, iosRaw.study);
		test.skip(!okC || !okI, 'test_images 3D fixtures not present');
	});
	test('CBCT raw study shows a Run-segmentation CTA (the billable entry point)', async ({
		page
	}) => {
		await page.goto(url.cbct(cbctRaw) + '?view=volume');
		// A RAW (un-segmented) CBCT renders NO <canvas> in the volume view — the
		// Volume3D canvas only mounts once a gltfBlob (segmentation mesh) exists. The
		// "Run AI Segmentation" CTA appears once the raw grayscale volume has parsed
		// (volumeLoaded), which is the slow path (15-30s), so don't gate on a canvas
		// (waitFor3dReady) — wait directly for the CTA, which is what this test asserts.
		await expect(page.getByRole('button', { name: /Run.*segmentation/i }).first()).toBeVisible({
			timeout: 90_000
		});
	});

	test('IOS raw study shows a Run-segmentation CTA (the billable entry point)', async ({
		page
	}) => {
		await page.goto(url.ios(iosRaw));
		// IOS shows the raw scan (or the empty-state) with a Run button.
		await expect(page.getByRole('button', { name: /Run.*segmentation/i }).first()).toBeVisible({
			timeout: 60_000
		});
	});

	// Catch-side defense-in-depth: force the seg endpoint to 403 and assert the soft
	// paywall opens instead of a raw error banner. Works with the SUBSCRIBED demo
	// account because we fake the server's 403 — proving shouldPaywall(_, 403) wiring.
	test('CBCT: a 403 from the seg endpoint opens the PaywallModal (not a raw error)', async ({
		page
	}) => {
		await page.route('**/api/ai/cbct_seg_inference', (route) =>
			route.fulfill({
				status: 403,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Inactive Subscription' })
			})
		);
		await page.goto(url.cbct(cbctRaw) + '?view=volume');
		// Wait for the Run-segmentation CTA itself (a raw CBCT has no <canvas>, so
		// waitFor3dReady is the wrong gate — see the first CBCT test). The CTA shows
		// once the raw volume parses (volumeLoaded), the slow path.
		const runBtn = page.getByRole('button', { name: /Run.*segmentation/i }).first();
		await expect(runBtn).toBeVisible({ timeout: 90_000 });
		await runBtn.click();
		// PaywallModal is role="dialog" aria-labelledby="paywall-title".
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
		// And it routes to billing, not a generic error toast.
		await expect(page.getByRole('button', { name: /View plans|Plans|Billing/i })).toBeVisible();
	});

	test('IOS: a 403 from the seg endpoint opens the PaywallModal (not a raw error)', async ({
		page
	}) => {
		await page.route('**/api/ai/ios_seg_inference', (route) =>
			route.fulfill({
				status: 403,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Inactive Subscription' })
			})
		);
		await page.goto(url.ios(iosRaw));
		await page
			.getByRole('button', { name: /Run.*segmentation/i })
			.first()
			.click();
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
	});

	// V5, LOCAL-FIRST EDITION (replaces the pre-migration 403-on-file-token skeleton —
	// the cached segmentation now loads from IndexedDB via a blob: URL, so an HTTP 403
	// can't happen; the equivalent real failure is a CORRUPT cached blob, e.g. a bad
	// write or partial import). It must surface the retry banner (cbct.segLoadFailed),
	// NOT silently fall back to the empty Run-AI CTA as if no segmentation existed.
	// A PK-prefixed garbage blob is used: the zip sniff routes it into JSZip.loadAsync,
	// which throws deterministically into the banner path.
	test('CBCT: a CORRUPT cached segmentation shows the load-failed banner, not the Run-AI CTA', async ({
		page
	}) => {
		const cbctSeg = STUDIES.cbctSeg;
		const ok = await seedCbctStudy(page, cbctSeg.patient, cbctSeg.study, 'CBCT Seg Patient');
		test.skip(!ok, 'test_images CBCT fixtures not present');

		// Corrupt the seeded segmentation blob IN PLACE (keep the row's other fields).
		await page.evaluate(
			async ({ study }) => {
				const db: IDBDatabase = await new Promise((res, rej) => {
					const r = indexedDB.open('dxv-local');
					r.onsuccess = () => res(r.result);
					r.onerror = () => rej(r.error);
				});
				const row: Record<string, unknown> = await new Promise((res, rej) => {
					const req = db.transaction('files').objectStore('files').get([study, 'segmentation']);
					req.onsuccess = () => res(req.result);
					req.onerror = () => rej(req.error);
				});
				if (!row) throw new Error('seeded segmentation row missing');
				row.blob = new Blob(
					[new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9, 9, 9, 9, 9])], // PK.. + junk
					{ type: 'application/zip' }
				);
				await new Promise<void>((res, rej) => {
					const tx = db.transaction('files', 'readwrite');
					tx.objectStore('files').put(row);
					tx.oncomplete = () => res();
					tx.onerror = () => rej(tx.error);
				});
				db.close();
			},
			{ study: cbctSeg.study }
		);

		await page.goto(url.cbct(cbctSeg) + '?view=volume');
		const banner = page.getByRole('alert');
		await expect(banner).toBeVisible({ timeout: 30_000 });
		await expect(banner).toHaveText(
			/Couldn't load the saved 3D model|3D-Modell|modèle 3D|modelo 3D/i
		);
	});
});
