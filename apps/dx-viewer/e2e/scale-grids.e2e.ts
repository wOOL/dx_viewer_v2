import { test, expect } from '@playwright/test';
import { seedXrayStudies, FINDING_COUNTS_2D, type SeedStudy } from './seed';

// SCALE lens: every other spec seeds a handful of rows, so the suite is blind to
// behaviors that only break at clinic scale (the absent-pagination crash class). Seed
// 300 patients (1 study each, one shared tiny image blob) through the local-first
// harness and drive the heavy surfaces FUNCTIONALLY — pagination pages, search narrows,
// dashboard renders. No timing assertions (load-sensitive = flake); a pathological
// regression surfaces as a timeout instead.

function id15(prefix: string, n: number): string {
	// [a-z0-9]{15}: prefix + zero-padded index, e.g. scalepat0000042
	const num = String(n).padStart(15 - prefix.length, '0');
	return (prefix + num).slice(0, 15);
}

const N = 300;

test('grids stay functional at 300 patients (pagination + search + dashboard)', async ({
	page
}) => {
	test.skip(!process.env.E2E_PASSWORD, 'needs an authenticated session');
	test.setTimeout(180_000);

	await page.goto('/studies');
	const studies: SeedStudy[] = Array.from({ length: N }, (_, i) => ({
		patient: id15('scalepat', i),
		study: id15('scalestd', i),
		patientName: `Scale Patient ${String(i).padStart(3, '0')}`,
		capturedAt: new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString(),
		findingCounts: FINDING_COUNTS_2D
	}));
	await seedXrayStudies(page, studies);

	// Patients grid: renders, paginates (not all 300 tiles at once), page 2 works.
	await page.goto('/patients');
	await expect(page.getByText('Scale Patient', { exact: false }).first()).toBeVisible({
		timeout: 30_000
	});
	const tiles = await page.locator('a[href^="/patients/"]').count();
	expect(tiles).toBeLessThan(N); // paginated, never all 300 in the DOM
	const nextPage = page.getByRole('button', { name: /next|→|»/i }).first();
	if (await nextPage.isEnabled().catch(() => false)) {
		await nextPage.click();
		await expect(page.getByText('Scale Patient', { exact: false }).first()).toBeVisible();
	}

	// Search narrows to a unique patient.
	await page.goto('/studies');
	const search = page.getByRole('textbox', { name: /search/i }).first();
	await expect(search).toBeVisible({ timeout: 15_000 });
	await search.fill('Scale Patient 123');
	// .first(): the dropdown shows the match AND a "See all results for…" button.
	await expect(page.getByText('Scale Patient 123').first()).toBeVisible({ timeout: 10_000 });

	// Dashboard metrics render with the full count (no unbounded-render hang).
	await expect(page.getByText(String(N), { exact: true }).first()).toBeVisible({
		timeout: 15_000
	});

	// Streaming zip at ENTRY-COUNT scale, FULL ROUND-TRIP: export 300 studies, wipe,
	// import them back (both fflate directions + the 300-row importUser bulkPut + the
	// gate's empty-local path are unit-tested only with single-digit entries).
	await page.goto('/settings');
	const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
	await page.getByTestId('export-file').click();
	const download = await downloadPromise;
	const zipPath = await download.path();
	const stream = await download.createReadStream();
	let bytes = 0;
	for await (const chunk of stream) bytes += (chunk as Buffer).length;
	expect(bytes).toBeGreaterThan(10_000); // 300 entries + manifest, deflated

	// Wipe ("cleared browser data") → import the export back → all 300 return.
	await page.evaluate(
		() =>
			new Promise<void>((res) => {
				const r = indexedDB.deleteDatabase('dxv-local');
				r.onsuccess = r.onerror = r.onblocked = () => res();
			})
	);
	await page.goto('/settings');
	await page.getByTestId('import-file').click();
	await page.locator('input[type="file"][accept*="zip"]').setInputFiles(zipPath);
	// The restore-options dialog (replaced the old confirm()) — preview a 300-entry plan,
	// then take the destructive Replace path (local is empty → gate allows it).
	await expect(page.getByTestId('merge-dialog')).toBeVisible({ timeout: 60_000 });
	await page.getByTestId('replace-confirm').click();
	await expect(page.getByRole('status')).toHaveText(
		/Import complete|Import abgeschlossen|Import terminé|Importación completada/i,
		{ timeout: 60_000 }
	);
	const restored = await page.evaluate(async () => {
		const db: IDBDatabase = await new Promise((res, rej) => {
			const r = indexedDB.open('dxv-local');
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		});
		const n: number = await new Promise((res, rej) => {
			const req = db.transaction('studies').objectStore('studies').count();
			req.onsuccess = () => res(req.result);
			req.onerror = () => rej(req.error);
		});
		db.close();
		return n;
	});
	expect(restored).toBe(N);

	// Cleanup: drop the whole local DB (shared demo browser state stays clean).
	await page.evaluate(
		() =>
			new Promise<void>((res) => {
				const r = indexedDB.deleteDatabase('dxv-local');
				r.onsuccess = r.onerror = r.onblocked = () => res();
			})
	);
});
