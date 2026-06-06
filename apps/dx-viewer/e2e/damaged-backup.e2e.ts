import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedXrayStudies } from './seed';

// DAMAGED-ARCHIVE SALVAGE: a truncated backup zip (the classic interrupted-download
// shape) must not be a dead end. The import preview only reads the archive HEAD, so it
// looks fine; the strict apply then fails on the missing tail blob — and instead of a
// bare error the dialog reopens in salvage mode (casualty list, Replace forced off) and
// a merge-only recovery brings back every study whose binaries survived.

async function localCount(
	page: import('@playwright/test').Page,
	store: 'studies' | 'patients'
): Promise<number> {
	return page.evaluate(async (storeName) => {
		const db: IDBDatabase = await new Promise((res, rej) => {
			const r = indexedDB.open('dxv-local');
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		});
		if (!db.objectStoreNames.contains(storeName)) {
			db.close();
			return 0;
		}
		const n: number = await new Promise((res, rej) => {
			const req = db.transaction(storeName).objectStore(storeName).count();
			req.onsuccess = () => res(req.result);
			req.onerror = () => rej(req.error);
		});
		db.close();
		return n;
	}, store);
}

/** Cut the archive INSIDE the last file entry's data (header parsed, data incomplete,
 *  central directory gone) — exactly what an interrupted download produces. */
function truncateInsideLastEntry(bytes: Buffer): Buffer {
	let last = -1;
	for (let i = bytes.length - 4; i >= 0; i--) {
		if (
			bytes[i] === 0x50 &&
			bytes[i + 1] === 0x4b &&
			bytes[i + 2] === 0x03 &&
			bytes[i + 3] === 0x04
		) {
			last = i;
			break;
		}
	}
	if (last <= 0) throw new Error('no local file header found');
	return bytes.subarray(0, last + 60);
}

test('damaged backup: salvage dialog → merge-only recovery of the intact study', async ({
	page
}) => {
	test.skip(!process.env.E2E_PASSWORD, 'needs an authenticated session');
	test.setTimeout(120_000);

	// Two patients, one study each. Zip entry order is studyId-ascending, so the
	// 'zzz…' study's blob is LAST — the one the truncation kills.
	await seedXrayStudies(page, [
		{ patient: 'dmgpataaa000001', study: 'dmgstdaaa000001', patientName: 'Damaged E2E Intact' },
		{ patient: 'dmgpatzzz000001', study: 'zzzdmgstd000001', patientName: 'Damaged E2E Lost' }
	]);
	await page.goto('/settings');
	const downloadPromise = page.waitForEvent('download');
	await page.getByTestId('export-file').click();
	const download = await downloadPromise;
	const zipPath = join(tmpdir(), `dxv-e2e-damaged-${Date.now()}.zip`);
	await download.saveAs(zipPath);
	const truncatedPath = join(tmpdir(), `dxv-e2e-truncated-${Date.now()}.zip`);
	writeFileSync(truncatedPath, truncateInsideLastEntry(readFileSync(zipPath)));

	// Fresh device: clear the local DB, let the app recreate it.
	await page.evaluate(
		() =>
			new Promise<void>((res) => {
				const r = indexedDB.deleteDatabase('dxv-local');
				r.onsuccess = r.onerror = r.onblocked = () => res();
			})
	);
	await page.goto('/settings');

	// Import the truncated file. A SMALL archive fits a single read chunk, so even the
	// "light" preview processes the whole damaged stream → the strict preview throws and
	// the dialog opens DIRECTLY in salvage mode. (For multi-chunk archives whose head is
	// clean, the same salvage dialog appears at the strict APPLY instead — same wiring,
	// covered at the unit level.)
	await page.getByTestId('import-file').click();
	await page.locator('input[type="file"][accept*="zip"]').setInputFiles(truncatedPath);
	await expect(page.getByTestId('merge-dialog')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId('merge-damage')).toBeVisible();
	await expect(page.getByTestId('merge-damage')).toContainText('Damaged E2E Lost');
	await expect(page.getByTestId('replace-confirm')).toBeDisabled(); // forced off on damage

	// Salvage merge: the intact study returns; the lost one (and its would-be-empty
	// patient) does not.
	await page.getByTestId('merge-confirm').click();
	await expect(page.getByRole('status')).toHaveText(
		/Merge complete|Fusion terminée|Fusión completada|Zusammenführung abgeschlossen/i,
		{ timeout: 30_000 }
	);
	expect(await localCount(page, 'studies')).toBe(1);
	expect(await localCount(page, 'patients')).toBe(1);

	// Cleanup: drop the local data so the shared demo browser state stays clean.
	await page.evaluate(
		() =>
			new Promise<void>((res) => {
				const r = indexedDB.deleteDatabase('dxv-local');
				r.onsuccess = r.onerror = r.onblocked = () => res();
			})
	);
});
