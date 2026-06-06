import { test, expect } from '@playwright/test';
import { STUDIES } from './helpers';
import { seedCbctStudy } from './seed';

// printPatient() composes a print window of the patient's study tiles. A CBCT/IOS
// study stores a RAW volume/mesh on `image` (.nii.gz / .obj / …), not a bitmap —
// so rendering it as <img src=imageDataUrl> printed a BROKEN image. The tile must
// fall back to the modality placeholder (hasViewableImage() === false for 3D).
//
// This patient's only study is a CBCT, so the printout is a single 3D tile —
// it must be the ".ph" placeholder, never an <img> of the .nii.gz.
// LOCAL-FIRST: seed the CBCT study into IndexedDB for this patient.
const CBCT_PATIENT = STUDIES.cbctSeg.patient; // mfgxs9u3r6ejjms

test('patient printout uses a placeholder (not a broken <img>) for a 3D study', async ({
	page
}) => {
	const ok = await seedCbctStudy(
		page,
		CBCT_PATIENT,
		STUDIES.cbctSeg.study,
		'CBCT Printout Patient'
	);
	test.skip(!ok, 'test_images CBCT fixtures not present');
	await page.goto(`/patients/${CBCT_PATIENT}`);
	const printoutBtn = page.getByRole('button', { name: 'Printout' });
	await expect(printoutBtn).toBeVisible();

	const [popup] = await Promise.all([page.waitForEvent('popup'), printoutBtn.click()]);
	await popup.waitForLoadState('domcontentloaded');
	await expect(popup.locator('.tile').first()).toBeVisible();

	// The CBCT tile is the placeholder, captioned with the modality, and NOT an <img>.
	await expect(popup.locator('.tile .ph').first()).toBeVisible();
	await expect(popup.locator('.tile .ph').first()).toHaveText(/CBCT/i);
	// No tile renders the raw volume/mesh as an image.
	expect(await popup.locator('img[src*=".nii"], img[src*=".gz"], img[src*=".obj"]').count()).toBe(
		0
	);

	await popup.close();
});
