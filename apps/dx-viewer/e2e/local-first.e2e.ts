import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedXrayStudies } from './seed';

// LOCAL-FIRST end-to-end: patient data lives in the browser's IndexedDB, the server runs
// only stateless AI. This drives the whole local lifecycle against the real backend:
//   upload a 2D X-ray (real AI inference) → it persists locally → Export to a .zip →
//   clear IndexedDB ("cleared browser data") → the app is empty → Import opens the
//   RESTORE-OPTIONS dialog (replaces the old confirm()) → Replace restores the data →
//   re-importing the SAME file: Replace stays allowed (equal versions), Merge is a
//   disabled no-op (row-level idempotence) → deleting the study writes a TOMBSTONE and
//   makes local strictly newer → the dialog now DISABLES Replace (gate) and reports the
//   deleted item as suppressed (no resurrection) → a fresh-device merge UNIONS a backup's
//   patients into existing local data without touching it.
// Export/Import/Merge are fully local (no PB writes), so this leaves no server state.

const FIXTURE = '/home/yang/appv3/test_images/image1.jpg';

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

async function clearLocalDb(page: import('@playwright/test').Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((res) => {
				const r = indexedDB.deleteDatabase('dxv-local');
				r.onsuccess = r.onerror = r.onblocked = () => res();
			})
	);
}

/** Pick the export zip on the hidden input and wait for the restore-options dialog. */
async function importAndOpenDialog(
	page: import('@playwright/test').Page,
	zipPath: string
): Promise<void> {
	await page.getByTestId('import-file').click();
	await page.locator('input[type="file"][accept*="zip"]').setInputFiles(zipPath);
	await expect(page.getByTestId('merge-dialog')).toBeVisible({ timeout: 30_000 });
}

test('local-first: upload → export → clear → restore dialog → tombstone → merge', async ({
	page
}) => {
	test.skip(!process.env.E2E_PASSWORD, 'needs an authenticated session');
	test.setTimeout(240_000);

	// --- Upload a 2D X-ray (real AI). Study is stored ONLY in IndexedDB. ---
	await page.goto('/upload');
	await page.getByRole('textbox', { name: /patient/i }).fill('LocalFirst E2E');
	await page.locator('input[type="file"]').setInputFiles(FIXTURE);
	await page
		.getByRole('button', {
			name: /Run analysis|Analyse starten|Lancer l'analyse|Ejecutar análisis/i
		})
		.click();

	// Lands on the 2D viewer once analysis completes.
	await page.waitForURL(/\/viewer\//, { timeout: 120_000 });
	await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
	expect(await localCount(page, 'studies')).toBe(1);
	const patientId = /\/viewer\/([^/]+)\//.exec(page.url())?.[1];
	expect(patientId).toBeTruthy();

	// --- Export to a .zip (captured download). ---
	await page.goto('/settings');
	const exportBtn = page.getByTestId('export-file');
	await expect(exportBtn).toBeVisible();
	const downloadPromise = page.waitForEvent('download');
	await exportBtn.click();
	const download = await downloadPromise;
	const zipPath = join(tmpdir(), `dxv-e2e-${Date.now()}.zip`);
	await download.saveAs(zipPath);
	expect(readFileSync(zipPath).length).toBeGreaterThan(0);

	// --- Simulate "cleared browser data": delete the local-first IndexedDB. ---
	await clearLocalDb(page);
	await page.goto('/studies');
	await expect(
		page.getByText(/No analyses|Noch keine Analysen|Aucune analyse|Sin análisis/i)
	).toBeVisible();
	expect(await localCount(page, 'studies')).toBe(0);

	// --- Import the .zip: the restore-options dialog replaces the old confirm().
	// Local is EMPTY → Replace is allowed; use it (the original destructive restore). ---
	await page.goto('/settings');
	await importAndOpenDialog(page, zipPath);
	await expect(page.getByTestId('replace-confirm')).toBeEnabled();
	await page.getByTestId('replace-confirm').click();
	await expect(page.getByRole('status')).toHaveText(
		/Import complete|Import abgeschlossen|Import terminé|Importación completada/i,
		{ timeout: 30_000 }
	);
	expect(await localCount(page, 'studies')).toBe(1);

	// --- Re-importing the SAME backup: equal dataVersions keep Replace allowed
	// (re-import is idempotent), and Merge is a DISABLED no-op — every row is already
	// up to date, so there is nothing to merge. ---
	await importAndOpenDialog(page, zipPath);
	await expect(page.getByTestId('replace-confirm')).toBeEnabled();
	await expect(page.getByTestId('merge-confirm')).toBeDisabled();
	await page.getByTestId('replace-confirm').click();
	await expect(page.getByRole('status')).toHaveText(
		/Import complete|Import abgeschlossen|Import terminé|Importación completada/i,
		{ timeout: 30_000 }
	);
	expect(await localCount(page, 'studies')).toBe(1); // unchanged (idempotent)

	// --- A real local write (deleting the study, patient kept) bumps the local
	// dataVersion past the export's AND writes a delete tombstone. ---
	await page.goto(`/patients/${patientId}`);
	// FMX view renders the slot grid (no per-tile delete) — switch to the linear list.
	// (toBeVisible WAITS for hydration; a bare isVisible() races the page load.)
	const fmxSwitch = page.getByRole('checkbox', { name: 'FMX' }).first();
	await expect(fmxSwitch).toBeVisible({ timeout: 15_000 });
	await fmxSwitch.uncheck();
	page.once('dialog', (d) => void d.accept()); // the study-delete confirm (not the import flow)
	// The study tile's delete affordance (exact match — "Delete patient" etc. is longer).
	await page
		.getByRole('button', { name: /^(Delete|Supprimer|Eliminar|Löschen)$/ })
		.first()
		.click();
	await expect.poll(async () => localCount(page, 'studies'), { timeout: 15_000 }).toBe(0);

	// --- Import again: local-newer now DISABLES Replace (the gate, unchanged), and the
	// tombstone suppresses the deleted study from the merge — the dialog says so and
	// Merge is disabled (nothing else differs). The deleted study CANNOT resurrect. ---
	await page.goto('/settings');
	await importAndOpenDialog(page, zipPath);
	await expect(page.getByTestId('replace-confirm')).toBeDisabled();
	await expect(page.getByTestId('merge-suppressed')).toHaveText(/1/);
	await expect(page.getByTestId('merge-confirm')).toBeDisabled();
	await page.getByTestId('merge-cancel').click();
	await expect(page.getByTestId('merge-dialog')).not.toBeVisible();
	expect(await localCount(page, 'studies')).toBe(0); // nothing overwritten, nothing resurrected

	// --- MERGE scenario: a backup unions INTO existing local data. Build a second
	// backup holding patient Y, then merge it into a fresh device that already has its
	// own patient Z — Z must survive, Y (and the kept patient P0) must arrive. ---
	await seedXrayStudies(page, [
		{ patient: 'mrgseedpaty0001', study: 'mrgseedstdy0001', patientName: 'Merge Patient Y' }
	]);
	await page.goto('/settings');
	const download2Promise = page.waitForEvent('download');
	await exportBtn.click();
	const zip2Path = join(tmpdir(), `dxv-e2e-merge-${Date.now()}.zip`);
	await (await download2Promise).saveAs(zip2Path);

	await clearLocalDb(page);
	await page.goto('/studies');
	await seedXrayStudies(page, [
		{ patient: 'mrgseedpatz0002', study: 'mrgseedstdz0002', patientName: 'Local Patient Z' }
	]);
	expect(await localCount(page, 'patients')).toBe(1);

	await page.goto('/settings');
	await importAndOpenDialog(page, zip2Path);
	// The seeded Z write stamped a NEWER local dataVersion → Replace is gated off; the
	// non-destructive Merge is exactly the escape hatch this dead-end used to lack.
	await expect(page.getByTestId('replace-confirm')).toBeDisabled();
	await expect(page.getByTestId('merge-confirm')).toBeEnabled();
	await page.getByTestId('merge-confirm').click();
	await expect(page.getByRole('status')).toHaveText(
		/Merge complete|Fusion terminée|Fusión completada|Zusammenführung abgeschlossen/i,
		{ timeout: 60_000 }
	);
	// Union: local Z untouched + backup's P0 and Y added (S1 stays deleted — it is not
	// in zip2 at all; it was tombstoned before that export).
	expect(await localCount(page, 'patients')).toBe(3);
	expect(await localCount(page, 'studies')).toBe(2);

	// Re-merging the SAME backup is a no-op: everything is already up to date.
	await importAndOpenDialog(page, zip2Path);
	await expect(page.getByTestId('merge-confirm')).toBeDisabled();
	await expect(page.getByTestId('replace-confirm')).toBeDisabled(); // merged state is newer
	await page.getByTestId('merge-cancel').click();
	expect(await localCount(page, 'patients')).toBe(3); // unchanged

	// --- Cleanup: drop the local data so the shared demo browser state stays clean. ---
	await clearLocalDb(page);
});
