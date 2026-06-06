import { test, expect, type Page } from '@playwright/test';
import { STUDIES, url, nonTransparentPixels } from './helpers';
import { seedXrayStudies, readUserEdits, FINDING_COUNTS_2D } from './seed';

// 2D x-ray viewer regressions. LOCAL-FIRST: the demo server is empty, so each test seeds
// its studies into IndexedDB (a real frozen AI inference + the real X-ray, or a gray
// fallback) before navigating. Detection edits persist to the LOCAL store, so the
// editor assertions read userEdits straight from IndexedDB (readUserEdits) — no PB.
//
// The AI-overlay layer is a separate, untainted 2D canvas (masks/boxes/labels only), so
// getImageData on it is readable and we assert overlay content + toggles by pixel count.
const OVERLAY = 'canvas.pointer-events-none';
const PATIENT = STUDIES.xray2d.patient;
const STUDY = STUDIES.xray2d.study;
const SIBLING_STUDY = 'seedsibxray0001'; // a NEWER sibling so the target isn't at index 0
const PATIENT_NAME = 'Test Patient';

// xrayStudies inherits the patient's DESC (newest-first) order, and prevStudy requires
// currentIdx > 0 — so the target study must NOT be the newest. Seed a newer sibling so the
// target sits at index 1 with a working "Previous study" affordance.
async function seed(page: Page) {
	await page.goto('/studies');
	await seedXrayStudies(page, [
		{
			patient: PATIENT,
			study: SIBLING_STUDY,
			patientName: PATIENT_NAME,
			capturedAt: '2026-06-01T00:00:00.000Z',
			findingCounts: FINDING_COUNTS_2D
		},
		{
			patient: PATIENT,
			study: STUDY,
			patientName: PATIENT_NAME,
			capturedAt: '2025-01-01T00:00:00.000Z',
			findingCounts: FINDING_COUNTS_2D
		}
	]);
}

async function overlayReady(page: Page) {
	await expect(page.locator(OVERLAY).first()).toBeVisible();
	await expect
		.poll(() => nonTransparentPixels(page, OVERLAY), { timeout: 30_000 })
		.toBeGreaterThan(200);
}

test.describe('2D viewer', () => {
	test.beforeEach(async ({ page }) => {
		await seed(page);
	});

	test('renders the AI finding overlay (#92)', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
	});

	test('a valid study never surfaces the image-load error panel (local-first empty-URL guard)', async ({
		page
	}) => {
		// LOCAL-FIRST: imageUrl resolves lazily (ensurePatientImages), so XrayCanvas mounts with
		// imageUrl=''. That transient empty state must NOT flash the "Couldn't load this image"
		// panel (setting img.src='' fires onerror) — only a genuine failure should. Once the
		// image has loaded (overlayReady draws over it), the error panel must be absent.
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		await expect(page.getByText("Couldn't load this image")).toHaveCount(0);
	});

	test('Hide All / Show All toggles the whole finding overlay (redesigned panel)', async ({
		page
	}) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		const baseline = await nonTransparentPixels(page, OVERLAY);
		const hideAll = page.getByTestId('findings-hide-all');
		await hideAll.click();
		await expect.poll(() => nonTransparentPixels(page, OVERLAY)).toBeLessThan(baseline);
		await hideAll.click();
		await expect.poll(() => nonTransparentPixels(page, OVERLAY)).toBeGreaterThanOrEqual(baseline);
	});

	test('per-group Hide/Show controls the overlay (Diagnostic Results)', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		const baseline = await nonTransparentPixels(page, OVERLAY);
		const pill = page.locator('.showhide:not(:disabled)').first();
		await pill.click();
		await expect.poll(() => nonTransparentPixels(page, OVERLAY)).toBeLessThan(baseline);
		await pill.click();
		await expect.poll(() => nonTransparentPixels(page, OVERLAY)).toBeGreaterThanOrEqual(baseline);
	});

	test('the 2D viewer shows the real patient name (PHI control removed)', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.getByText(PATIENT_NAME).first()).toBeVisible();
		await expect(page.getByTestId('phi-toggle')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /Printout/ })).toHaveCount(0);
	});

	test('Diagnostic Results shows only non-zero disease groups (no 0 rows, no Other Findings)', async ({
		page
	}) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		await expect(page.getByText('Diagnostic Results')).toBeVisible();
		const counts = page.locator('.grp-count');
		await expect(counts.first()).toBeVisible();
		const vals = await counts.allTextContents();
		expect(vals.length).toBeGreaterThan(0);
		expect(vals.every((v) => v.trim() !== '0')).toBe(true);
		for (const fake of [
			'Other Findings',
			'Non-Pathology',
			'Crown',
			'Bridge',
			'Implant',
			'Root Canal',
			'Impaction',
			'Filling',
			'Tooth Parts',
			'Measurements',
			'Wrong detection'
		]) {
			await expect(page.getByText(fake, { exact: true })).toHaveCount(0);
		}
	});

	test('findings can be viewed By tooth and a tooth click highlights it', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		await page.getByRole('tab', { name: 'By tooth' }).click();
		const toothRows = page.locator('.tooth-row');
		await expect(toothRows.first()).toBeVisible();
		await expect(page.getByText(/^Tooth \d+$/).first()).toBeVisible();
		await toothRows.first().click();
		await expect(toothRows.first()).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('tab', { name: 'By disease' }).click();
		await expect(page.locator('.grp').first()).toBeVisible();
	});

	// Detection editor: draw a rectangle → pick a disease → it persists to the study's
	// userEdits (in IndexedDB) AND flows into the findings count.
	test('can add a detection that persists locally + flows into the findings', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);

		const findingsHeader = page
			.locator('.text-\\[10px\\]', { hasText: /findings? detected/ })
			.first();
		const baseText = (await findingsHeader.textContent()) ?? '';
		const baseN = parseInt(baseText.match(/\d+/)?.[0] ?? '0', 10);

		const canvas = page.locator('canvas').first();
		const box = (await canvas.boundingBox())!;
		await page.getByTestId('detect-add-rect').click();
		await page.mouse.move(box.x + 180, box.y + 180);
		await page.mouse.down();
		await page.mouse.move(box.x + 300, box.y + 280, { steps: 8 });
		await page.mouse.up();

		await expect(page.getByText('Select a finding')).toBeVisible();
		await page.getByTestId('detect-pick-calculus').click();
		await page.getByTestId('detect-done').click();

		// Persisted to the local store (the AI inference is untouched).
		await expect
			.poll(async () => (await readUserEdits(page, STUDY))?.added?.length ?? 0, { timeout: 15_000 })
			.toBe(1);
		// And it flowed into the findings count (+1).
		await expect
			.poll(async () => {
				const t = (await findingsHeader.textContent()) ?? '';
				return parseInt(t.match(/\d+/)?.[0] ?? '0', 10);
			})
			.toBe(baseN + 1);
	});

	// A FREEFORM detection keeps the clinician's actual trajectory (a curve), not a box.
	// ROOT CAUSE (was a real bug, now fixed): the freeform's `points` come from `freePoints`,
	// a Svelte 5 `$state` PROXY array, which got embedded into userEdits.added[].points. When
	// saveUserEdits → putInference wrote userEdits to IndexedDB, structured-clone threw
	// DataCloneError on the proxy → the save SILENTLY failed → added=undefined. (The rect-add
	// path has no nested `points`, so it cloned + persisted fine — which is why only freeform
	// broke.) Fixed at the localDb write choke point (toPlain() strips proxies); see the
	// localDb proxy regression test.
	test('freeform add preserves the drawn outline (not a rectangle)', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);

		const canvas = page.locator('canvas').first();
		const b = (await canvas.boundingBox())!;
		const cx = b.x + 250;
		const cy = b.y + 250;
		const r = 50;
		await page.getByTestId('detect-add-free').click();
		await page.mouse.move(cx + r, cy);
		await page.mouse.down();
		for (let a = 0; a <= 360; a += 20) {
			const rad = (a * Math.PI) / 180;
			await page.mouse.move(cx + r * Math.cos(rad), cy + r * Math.sin(rad), { steps: 2 });
		}
		await page.mouse.up();

		await expect(page.getByText('Select a finding')).toBeVisible();
		await page.getByTestId('detect-pick-calculus').click();
		await page.getByTestId('detect-done').click();

		await expect
			.poll(
				async () => {
					const f = (await readUserEdits(page, STUDY))?.added?.find((x) => x.kind === 'free');
					return f?.points?.length ?? 0;
				},
				{ timeout: 15_000 }
			)
			.toBeGreaterThan(8);
	});

	// ── Detection-editor INTERACTION regressions ────────────────────────────────
	// A high confidence threshold filters the AI detections out of the hit-test, leaving
	// the user-added box (score 1) as the ONLY hoverable box — a deterministic hover target.
	async function addedBoxes(page: Page) {
		return (await readUserEdits(page, STUDY))?.added ?? [];
	}
	async function drawTopRect(
		page: Page,
		box: { x: number; y: number },
		a: [number, number],
		bb: [number, number]
	) {
		await page.getByTestId('detect-add-rect').click();
		await page.mouse.move(box.x + a[0], box.y + a[1]);
		await page.mouse.down();
		await page.mouse.move(box.x + bb[0], box.y + bb[1], { steps: 8 });
		await page.mouse.up();
		await expect(page.getByText('Select a finding')).toBeVisible();
		await page.getByTestId('detect-pick-calculus').click();
		await page.getByTestId('detect-done').click();
	}

	test('hover hide/remove button stays reachable as the cursor moves to it', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('dxv:confThres', '0.95'));
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		const canvas = page.locator('canvas').first();
		const box = (await canvas.boundingBox())!;
		await drawTopRect(page, box, [120, 60], [260, 150]);
		await expect.poll(async () => (await addedBoxes(page)).length, { timeout: 15_000 }).toBe(1);

		await page.mouse.move(box.x + 190, box.y + 105);
		const hideBtn = page.getByTestId('detect-hide');
		await expect(hideBtn).toBeVisible();
		await page.mouse.move(box.x + 180, box.y + 58, { steps: 4 });
		await page.mouse.move(box.x + 170, box.y + 44, { steps: 4 });
		await expect(hideBtn).toBeVisible();
		await hideBtn.click();
		await expect.poll(async () => (await addedBoxes(page)).length, { timeout: 15_000 }).toBe(0);
	});

	test('a resize handle is grabbable from the box edge (drag widens the box)', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('dxv:confThres', '0.95'));
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		const canvas = page.locator('canvas').first();
		const box = (await canvas.boundingBox())!;
		await drawTopRect(page, box, [120, 70], [260, 170]);
		await expect.poll(async () => (await addedBoxes(page)).length, { timeout: 15_000 }).toBe(1);
		const before = (await addedBoxes(page))[0]!.box;
		const w0 = before[2]! - before[0]!;

		await page.mouse.move(box.x + 190, box.y + 120);
		await page.mouse.move(box.x + 263, box.y + 120);
		await page.mouse.down();
		await page.mouse.move(box.x + 340, box.y + 120, { steps: 10 });
		await page.mouse.up();

		await expect
			.poll(
				async () => {
					const bx = (await addedBoxes(page))[0]?.box;
					return bx ? bx[2]! - bx[0]! : 0;
				},
				{ timeout: 15_000 }
			)
			.toBeGreaterThan(w0 + 20);
	});

	test('the disease picker stays on-screen for a detection drawn near the bottom edge', async ({
		page
	}) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		const canvas = page.locator('canvas').first();
		const c = (await canvas.boundingBox())!;
		await page.getByTestId('detect-add-rect').click();
		await page.mouse.move(c.x + 150, c.y + c.height - 240);
		await page.mouse.down();
		await page.mouse.move(c.x + 290, c.y + c.height - 180, { steps: 8 });
		await page.mouse.up();

		const picker = page.locator('.edit-picker');
		await expect(picker).toBeVisible();
		await expect(page.getByText('Select a finding')).toBeVisible();
		const pb = (await picker.boundingBox())!;
		expect(pb.y).toBeGreaterThanOrEqual(c.y - 1);
		expect(pb.x).toBeGreaterThanOrEqual(c.x - 1);
		expect(pb.y + pb.height).toBeLessThanOrEqual(c.y + c.height + 1);
		expect(pb.x + pb.width).toBeLessThanOrEqual(c.x + c.width + 1);
		await picker.getByRole('button', { name: 'Cancel' }).click();
	});

	// Same root cause as the freeform-add test above (DataCloneError on the $state-proxy
	// `points` array silently dropped the saved freeform); fixed by the localDb toPlain() choke
	// point, so this now persists + asserts the no-bbox-resize behaviour.
	test('a freeform detection is not bbox-resizable (an edge drag leaves it unchanged)', async ({
		page
	}) => {
		await page.addInitScript(() => localStorage.setItem('dxv:confThres', '0.95'));
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		const canvas = page.locator('canvas').first();
		const b = (await canvas.boundingBox())!;
		const cx = b.x + 200;
		const cy = b.y + 110;
		const r = 42;
		await page.getByTestId('detect-add-free').click();
		await page.mouse.move(cx + r, cy);
		await page.mouse.down();
		for (let a = 0; a <= 360; a += 20) {
			const rad = (a * Math.PI) / 180;
			await page.mouse.move(cx + r * Math.cos(rad), cy + r * Math.sin(rad), { steps: 2 });
		}
		await page.mouse.up();
		await expect(page.getByText('Select a finding')).toBeVisible();
		await page.getByTestId('detect-pick-calculus').click();
		await page.getByTestId('detect-done').click();

		await expect.poll(async () => (await addedBoxes(page)).length, { timeout: 15_000 }).toBe(1);
		const before = (await addedBoxes(page))[0]!.box;

		await page.mouse.move(cx, cy);
		await page.mouse.move(cx + r + 3, cy);
		await page.mouse.down();
		await page.mouse.move(cx + r + 90, cy, { steps: 10 });
		await page.mouse.up();

		const after = (await addedBoxes(page))[0]!.box;
		expect(after).toEqual(before);
	});

	test('switching studies clears a pending detection (no cross-study leak)', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);
		const canvas = page.locator('canvas').first();
		const c = (await canvas.boundingBox())!;
		await page.getByTestId('detect-add-rect').click();
		await page.mouse.move(c.x + 150, c.y + 150);
		await page.mouse.down();
		await page.mouse.move(c.x + 260, c.y + 230, { steps: 6 });
		await page.mouse.up();
		await expect(page.getByText('Select a finding')).toBeVisible();

		// Navigate to the older sibling study (SPA nav → same route component).
		await page.getByRole('button', { name: 'Previous study' }).click();
		await expect(page.getByText('Select a finding')).toHaveCount(0);
		await expect(page.getByTestId('detect-add-rect')).toHaveAttribute('aria-pressed', 'false');
	});

	// Hiding an AI detection persists across reload; the "Restore hidden (N)" control gives
	// the recovery path. Seed a hidden detection directly into the local store, then restore.
	test('hidden AI detections can be restored (no permanent loss)', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await overlayReady(page);

		// Seed one hidden AI detection into IndexedDB, then reload so the viewer reads it.
		await page.evaluate(async (studyId) => {
			const db: IDBDatabase = await new Promise((res, rej) => {
				const r = indexedDB.open('dxv-local');
				r.onsuccess = () => res(r.result);
				r.onerror = () => rej(r.error);
			});
			const store = db.transaction('inferences', 'readwrite').objectStore('inferences');
			const rec: { studyId: string; user: string; inference: unknown } = await new Promise(
				(res) => {
					const q = store.get(studyId);
					q.onsuccess = () => res(q.result);
				}
			);
			rec.userEdits = { hidden: [0], added: [], resized: {} } as never;
			await new Promise<void>((res) => {
				const p = store.put(rec);
				p.onsuccess = () => res();
			});
			db.close();
		}, STUDY);
		await page.reload();
		await overlayReady(page);

		const restore = page.getByTestId('detect-restore-hidden');
		await expect(restore).toBeVisible({ timeout: 30_000 });
		await restore.click();
		await expect
			.poll(async () => (await readUserEdits(page, STUDY))?.hidden?.length ?? 0, {
				timeout: 15_000
			})
			.toBe(0);
		await expect(restore).toHaveCount(0);
	});
});
