import { test, expect } from '@playwright/test';
import { STUDIES, url, waitFor3dReady } from './helpers';
import { seedIosStudy, seedStateRow } from './seed';

// IOS state — surface measurements + hidden meshes — used to be dxv:ios:* localStorage only.
// LOCAL-FIRST: it now rides the `iosState` store in IndexedDB. This seeds an iosState row with
// one synthetic measurement, opens the IOS workspace, and asserts the measurement is RESTORED
// — proven by a DOM-only-after-replay signal: the "Clear measurements" control renders ONLY
// when measureCount > 0, and a fresh load starts at 0, so its presence means restoreMeasures()
// replayed the IndexedDB-persisted segment.
const ios = STUDIES.iosSeg;

test('IOS surface measurements restore from IndexedDB on load (cross-device persistence)', async ({
	page
}) => {
	const ok = await seedIosStudy(page, ios.patient, ios.study, 'IOS State Patient');
	test.skip(!ok, 'test_images IOS fixtures not present');

	await seedStateRow(page, 'iosState', ios.study, {
		measures: [{ a: [0.1, 0.2, 0.3], b: [0.4, 0.5, 0.6] }],
		hiddenMeshes: []
	});

	await page.goto(url.ios(ios));
	await waitFor3dReady(page);

	// Clear button visible ⇒ measureCount > 0 ⇒ the seeded measure replayed from IndexedDB.
	await expect(page.getByRole('button', { name: 'Clear measurements' })).toBeVisible({
		timeout: 30_000
	});
});
