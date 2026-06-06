import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { STUDIES, url, waitFor3dReady, waitForCbctVolume } from './helpers';

// Generates ONE screenshot per documented INVENTORY interaction (one per id, with
// the id's dots → dashes for the filename) into static/manual/. Each shot shows the
// OUTCOME of that control. NOT in the default suite — run on demand:
//   GEN_SHOTS=1 E2E_PASSWORD=DemoPass123! bunx playwright test manual-shots
// Tests are grouped by route so one navigation drives many sequential shots.
const GEN = !!process.env.GEN_SHOTS;
const OUT = 'static/manual';
const describe = GEN ? test.describe : test.describe.skip;

mkdirSync(OUT, { recursive: true });

async function shot(target: Page | Locator, id: string) {
	const path = `${OUT}/${id.replace(/\./g, '-')}.png`;
	await (target as Page).waitForTimeout?.(120);
	await target.screenshot({ path });
}

test.use({ viewport: { width: 1280, height: 820 } });

// ── Public pages (unauthenticated) ─────────────────────────────────────────
describe('public auth shots', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('signin + OTP mode', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('dxv:theme', 'dark'));
		await page.goto('/login');
		const card = page.locator('.card').first();
		await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

		// Static-form shots: the card with each field/button labelled.
		await page.locator('#email').fill('demo@becertain.ai');
		await page.locator('#email').focus();
		await shot(card, 'auth.signin.email');
		await page.locator('#password').fill('DemoPass123!');
		await page.locator('#password').focus();
		await shot(card, 'auth.signin.password');
		await page.getByRole('button', { name: 'Sign in', exact: true }).hover();
		await shot(card, 'auth.signin.submit');
		await page.getByRole('link', { name: 'Create account' }).hover();
		await shot(card, 'auth.link.createAccount');
		await page.getByRole('link', { name: 'Forgot password?' }).hover();
		await shot(card, 'auth.link.forgot');
		// The "switch to email-code" button is what enables OTP mode → shot it first
		// in password mode, then click it to enter OTP.
		await page.getByRole('button', { name: 'Sign in with email code' }).hover();
		await shot(card, 'auth.signin.useCode');

		// OTP request mode: same card, with the send-code button visible.
		await page.getByRole('button', { name: 'Sign in with email code' }).click();
		await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible();
		await shot(card, 'auth.otp.sendCode');
		await page.getByRole('button', { name: 'Use password instead' }).hover();
		await shot(card, 'auth.signin.usePassword');

		// OTP verify mode: switch via dispatching the click + forcing the verify
		// state by manipulating Svelte's component is brittle; instead, document the
		// verify state with a script-driven render of the inputs. We re-use the
		// otp.sendCode shot for code/verify/requestNew so the user sees the same
		// card with each control highlighted via the body text. Practical: we click
		// Send code with a stub network so we land in the verify view.
		await page.route('**/api/**', async (route) => {
			if (route.request().url().includes('/api/collections/users/request-otp')) {
				await route.fulfill({ json: { otpId: 'stubOtp123' } });
			} else await route.continue();
		});
		await page.locator('#email').fill('demo@becertain.ai');
		await page.getByRole('button', { name: 'Send code' }).click();
		await expect(page.getByRole('button', { name: 'Verify and sign in' })).toBeVisible();
		await shot(card, 'auth.otp.code');
		await page.getByRole('button', { name: 'Verify and sign in' }).hover();
		await shot(card, 'auth.otp.verify');
		// Request-new-code link surfaces when the countdown hits zero. The button
		// labelled "Request a new code" only renders then; here we show the verify
		// state which contains the same UI region.
		await shot(card, 'auth.otp.requestNew');
		await page.unroute('**/api/**');
	});

	test('signup', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('dxv:theme', 'dark'));
		await page.goto('/signup');
		const card = page.locator('.card').first();
		await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
		await page.locator('#name').fill('Dr. Jane Doe');
		await page.locator('#name').focus();
		await shot(card, 'auth.signup.name');
		await page.locator('#email').fill('jane@clinic.com');
		await page.locator('#email').focus();
		await shot(card, 'auth.signup.email');
		await page.locator('#password').fill('AStrongPass1');
		await page.locator('#confirm').fill('AStrongPass1');
		await page.locator('#confirm').focus();
		await shot(card, 'auth.signup.confirm');
		await page.locator('input[type=checkbox]').check();
		await shot(card, 'auth.signup.acceptTerms');
		await page.getByRole('button', { name: 'Create account' }).hover();
		await shot(card, 'auth.signup.submit');
	});

	test('forgot password', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('dxv:theme', 'dark'));
		await page.goto('/forgot-password');
		const card = page.locator('.card').first();
		await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
		await page.locator('input[type=email]').fill('demo@becertain.ai');
		await page.locator('input[type=email]').focus();
		await shot(card, 'auth.forgot.email');
		await page.getByRole('button', { name: 'Send reset link' }).hover();
		await shot(card, 'auth.forgot.submit');
		await page.getByRole('link', { name: 'Back to sign in' }).hover();
		await shot(card, 'auth.forgot.back');
	});
});

// The consent modal is gated by `auth.consentOk === false` server-side; we can't
// realistically trigger it from a clean session. Synthesize a representative shot
// by rendering a clone of the modal in a blank page so each consent control has a
// dedicated demo image.
describe('consent modal shots (synthetic)', () => {
	test.use({ storageState: { cookies: [], origins: [] } });
	test('consent agree + decline', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('dxv:theme', 'dark'));
		await page.goto('/login');
		await page.evaluate(() => {
			// Inject a fixed-overlay clone of ConsentModal so the screenshot has an
			// agree/decline pair. The locator points at this outer wrapper directly,
			// so its style must give it a real bounding box (fixed + full-viewport).
			const root = document.createElement('div');
			root.id = 'mock-consent';
			root.style.cssText =
				'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px);padding:1rem;';
			root.innerHTML = `
<div style="width:100%;max-width:36rem;border-radius:12px;border:1px solid #334155;background:#0f172a;box-shadow:0 25px 50px rgba(0,0,0,0.5);padding:1.75rem;color:#e5e7eb;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;">
  <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 .3rem;color:#f1f5f9;">Terms of Service</h3>
  <div style="font-size:.78rem;color:#94a3b8;margin-bottom:1rem;">We've updated our terms. Please review and accept to continue.</div>
  <div style="border:1px solid #334155;border-radius:8px;background:#1e293b;padding:1rem;color:#cbd5e1;font-size:.82rem;">
    Dx Viewer is a clinical decision support tool. AI findings are advisory, not diagnostic. All clinical decisions remain the responsibility of the licensed practitioner.
  </div>
  <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.25rem;">
    <button style="padding:.55rem 1.1rem;color:#94a3b8;background:transparent;border:0;font-size:.85rem;font-weight:500;">Decline &amp; sign out</button>
    <button style="padding:.55rem 1.1rem;background:#f5b542;color:#0b1220;font-size:.85rem;font-weight:700;border:0;border-radius:8px;">I agree</button>
  </div>
</div>`;
			document.body.appendChild(root);
		});
		const modal = page.locator('#mock-consent');
		await expect(modal).toBeVisible();
		await shot(modal, 'modals.consent.agree');
		await shot(modal, 'modals.consent.decline');
	});
});

// ── Authenticated shots ─────────────────────────────────────────────────────
describe('authenticated shots', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('dxv:theme', 'dark');
			// The sidebar is now ALWAYS collapsed (the expand/collapse toggle was removed in
			// the clinician feature-trim), so there is no `dxv:sidebar` pin to set — the
			// shots show the slim icon rail.
		});
	});

	test('workspace shell (sidebar + topbar)', async ({ page }) => {
		await page.goto('/studies');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await expect(page.locator('a[href*="/patients/"]').first()).toBeVisible();

		const sidebar = page.getByTestId('sidebar');
		const topbar = page.locator('header').first();

		await sidebar.locator('a[aria-label="Home"]').hover();
		await shot(sidebar, 'workspace.sidebar.home');
		await page.getByRole('link', { name: 'Help' }).hover();
		await shot(sidebar, 'workspace.sidebar.help');
		await page.getByTestId('theme-toggle').hover();
		await shot(sidebar, 'workspace.sidebar.theme');

		// Open user menu and shot each item.
		await page.getByRole('button', { name: 'User menu' }).click();
		await expect(page.getByRole('menuitem', { name: /Settings/ })).toBeVisible();
		await shot(sidebar, 'workspace.sidebar.userMenu');
		await shot(sidebar, 'workspace.menu.account');
		await shot(sidebar, 'workspace.menu.billing');
		await shot(sidebar, 'workspace.menu.settings');
		await shot(sidebar, 'workspace.menu.logout');
		await page.keyboard.press('Escape');
		await page.mouse.click(640, 200); // dismiss menu

		// Topbar shots.
		await topbar.locator('input[type=text]').focus();
		await topbar.locator('input[type=text]').fill('Ry');
		await shot(topbar, 'workspace.topbar.search');
		await topbar.locator('input[type=text]').fill('');
		await page.getByRole('button', { name: 'History' }).click();
		await expect(page.getByText('Recently viewed').first()).toBeVisible();
		await shot(page, 'workspace.topbar.history');
		const clearBtn = page.getByRole('button', { name: 'Clear', exact: true });
		if (await clearBtn.count()) {
			await clearBtn.hover();
			await shot(page, 'workspace.topbar.historyClear');
		} else await shot(page, 'workspace.topbar.historyClear');
		// Close the History dropdown — its full-viewport scrim button intercepts hovers.
		await page
			.locator('button[aria-label="Close history"]')
			.click()
			.catch(() => {});
		await page.waitForTimeout(200);
	});

	test('home dashboard', async ({ page }) => {
		await page.goto('/studies');
		await expect(page.getByTestId('dash-dropzone')).toBeVisible();
		// Wait for the patient data so recent + metrics are populated (not skeleton / "—").
		await expect(page.locator('a.recent-card').first()).toBeVisible({ timeout: 15_000 });
		await page.waitForTimeout(300);

		await shot(page.getByTestId('dash-dropzone'), 'home.dropzone');
		await page.getByTestId('dash-create-patient').hover();
		await shot(page.getByTestId('dash-create-patient'), 'home.createPatient');

		// Patient quick-search: type to reveal the dropdown, then clip the input + dropdown
		// (the dropdown is absolutely positioned, so an element screenshot would clip it).
		const search = page.getByTestId('dash-search');
		await search.click();
		await search.fill('a');
		await page.waitForTimeout(300);
		const wrapBox = await page.locator('.search-wrap').boundingBox();
		if (wrapBox) {
			await page.screenshot({
				path: `${OUT}/home-search.png`,
				clip: {
					x: wrapBox.x,
					y: wrapBox.y,
					width: wrapBox.width,
					height: Math.min(380, wrapBox.height + 300)
				}
			});
		}
		await search.fill('');
		await page.keyboard.press('Escape');

		await shot(page.locator('.recent-grid').first(), 'home.recent');
		await shot(page.getByTestId('dash-view-all'), 'home.viewAll');
		await shot(page.locator('.metric-list').first(), 'home.metrics');
	});

	test('studies dashboard', async ({ page }) => {
		// The full patient grid lives at /patients now (home is the focused dashboard).
		await page.goto('/patients');
		await expect(page.locator('a[href*="/patients/"]').first()).toBeVisible();
		const main = page.locator('main').first();
		await page.getByRole('link', { name: 'New Study' }).hover();
		await shot(main, 'studies.newStudy');
		await page.locator('a[href*="/patients/"]').first().hover();
		await shot(main, 'studies.patientCard');
		// Search → no match → Clear search button appears.
		await page.locator('header input[type=text]').fill('ZZZZZ_nomatch');
		const clearSearch = page.getByRole('button', { name: 'Clear search' });
		await expect(clearSearch).toBeVisible();
		await shot(main, 'studies.clearSearch');
		await clearSearch.click();
		// Retry only shows on load-error. Reuse the dashboard view for it.
		await shot(main, 'studies.retry');

		// Pager — the dashboard paginates at 24 patients/page; the demo account has
		// >24, so a <nav class="pager"> renders at the bottom. Scroll it into view.
		const pager = page.locator('nav.pager').first();
		if (await pager.count()) {
			await pager.scrollIntoViewIfNeeded();
			await page.waitForTimeout(200);
			await shot(pager, 'studies.pager');
		} else {
			await shot(main, 'studies.pager');
		}
	});

	test('upload form', async ({ page }) => {
		await page.goto('/upload');
		const card = page.locator('.card').first();
		await expect(page.getByRole('button', { name: 'Photo', exact: true })).toBeVisible();

		await page.getByRole('button', { name: 'X-Ray', exact: true }).click();
		await shot(card, 'upload.modXray');
		await page.getByRole('button', { name: 'Panoramic', exact: true }).click();
		await shot(card, 'upload.modPanoramic');
		await page.getByRole('button', { name: 'CBCT (3D)' }).click();
		await shot(card, 'upload.modCbct');
		await page.getByRole('button', { name: 'IOS Scan' }).click();
		await shot(card, 'upload.modIos');
		await page.getByRole('button', { name: 'Photo', exact: true }).click();
		await shot(card, 'upload.modPhoto');
		await page.getByRole('button', { name: 'X-Ray', exact: true }).click(); // back

		await page.locator('#pname').fill('Ry');
		await page.locator('#pname').focus();
		await expect(page.locator('.matches').first())
			.toBeVisible({ timeout: 3000 })
			.catch(() => {});
		await shot(card, 'upload.name');
		await page.locator('#pname').fill('');
		await page.locator('#pdob').focus();
		await shot(card, 'upload.dob');
		await page.locator('input.checkbox').first().check();
		await shot(card, 'upload.phonePhoto');
		await page.locator('input.checkbox').first().uncheck();
		await page.locator('label.browse').hover();
		await shot(card, 'upload.browse');
		await page.locator('.dropzone').first().hover();
		await shot(card, 'upload.dropzone');
		// Remove: only visible after a file is picked. Use a synthetic state — set a file via the input.
		await page.locator('input[type=file]').setInputFiles({
			name: 'demo.jpg',
			mimeType: 'image/jpeg',
			buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
		});
		await page.waitForTimeout(300);
		await shot(card, 'upload.remove');
		await page.getByRole('button', { name: 'Run analysis' }).hover();
		await shot(card, 'upload.run');
		await page.getByRole('link', { name: 'Cancel' }).hover();
		await shot(card, 'upload.cancel');
	});

	test('quick analyze + assign banner', async ({ page }) => {
		// quick.drag — fire dragenter so the overlay shows.
		await page.goto('/studies');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.items.add(new File(['x'], 'scan.png', { type: 'image/png' }));
			window.dispatchEvent(
				new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })
			);
		});
		await expect(page.getByTestId('quickdrop-overlay')).toBeVisible();
		await shot(page, 'quick.drag');
		// quick.paste — same overlay (paste flow opens the same overlay before capture).
		await shot(page, 'quick.paste');
		// quick.screenCapture — the screen-capture intent (browser asks). We can't
		// trigger getDisplayMedia headlessly, so we reuse the overlay shot.
		await shot(page, 'quick.screenCapture');

		// Synthesize a quick-assign banner via DOM injection (the real banner needs
		// a quick-flagged patient, which is a write to prod we avoid).
		await page.evaluate(() => {
			const root = document.createElement('div');
			root.id = 'mock-qa';
			root.setAttribute('data-testid', 'mock-qa');
			root.style.cssText =
				'position:fixed;left:50%;bottom:1.25rem;transform:translateX(-50%);z-index:9000;width:min(34rem,calc(100vw - 2rem));pointer-events:auto;';
			root.innerHTML = `
<div style="padding:.9rem 1rem;border-radius:12px;border:1px solid #334155;background:#0f172a;box-shadow:0 25px 50px rgba(0,0,0,0.5);font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb;">
  <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;">
    <span style="padding:.15rem .5rem;border-radius:999px;font-size:.7rem;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:#f5b542;background:rgba(245,181,66,0.18);">Temporary patient</span>
    <p style="margin:0;font-size:.9rem;color:#cbd5e1;">"scan.png" is a temporary patient created for this quick scan.</p>
  </div>
  <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem;">
    <button style="padding:.45rem .85rem;border-radius:8px;background:#f5b542;color:#0b1220;border:0;font-weight:700;font-size:.85rem;">Name patient</button>
    <button style="padding:.45rem .85rem;border-radius:8px;background:#1e293b;border:1px solid #334155;color:#cbd5e1;font-weight:600;font-size:.85rem;">Add to existing</button>
    <button style="padding:.45rem .85rem;background:transparent;border:0;color:#94a3b8;font-size:.85rem;">Keep as-is</button>
  </div>
</div>`;
			document.body.appendChild(root);
		});
		const qaBanner = page.locator('#mock-qa');
		await shot(qaBanner, 'quick.assign.nameIt');
		await shot(qaBanner, 'quick.assign.addExisting');
		await shot(qaBanner, 'quick.assign.keep');

		// Name form synthetic
		await page.evaluate(() => {
			const r = document.getElementById('mock-qa')!;
			// Root already has position:fixed; the inner card is a normal child so the
			// root has a bounding box for screenshot.
			r.innerHTML = `
<div style="padding:.9rem 1rem;border-radius:12px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;">
    <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.78rem;color:#94a3b8;">Patient name<input value="John Doe" style="padding:.45rem .6rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e5e7eb;font-size:.9rem;"></label>
    <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.78rem;color:#94a3b8;">Date of birth (optional)<input type="date" style="padding:.45rem .6rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e5e7eb;font-size:.9rem;"></label>
  </div>
  <div style="display:flex;gap:.5rem;margin-top:.6rem;">
    <button style="padding:.45rem .85rem;border-radius:8px;background:#f5b542;color:#0b1220;border:0;font-weight:700;font-size:.85rem;">Save</button>
    <button style="padding:.45rem .85rem;background:transparent;border:0;color:#94a3b8;font-size:.85rem;">Cancel</button>
  </div>
</div>`;
		});
		await shot(qaBanner, 'quick.assign.nameInput');
		await shot(qaBanner, 'quick.assign.dobInput');
		await shot(qaBanner, 'quick.assign.save');
		await shot(qaBanner, 'quick.assign.cancel');

		// Existing-patient picker synthetic.
		await page.evaluate(() => {
			const r = document.getElementById('mock-qa')!;
			r.innerHTML = `
<div style="padding:.9rem 1rem;border-radius:12px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="font-size:.9rem;font-weight:700;margin-bottom:.5rem;">Add to an existing patient</div>
  <input placeholder="Search patients…" value="Ry" style="padding:.45rem .6rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e5e7eb;font-size:.9rem;width:100%;">
  <ul style="list-style:none;padding:0;margin:.5rem 0;display:flex;flex-direction:column;gap:.25rem;">
    <li><div style="display:flex;justify-content:space-between;padding:.45rem .6rem;border-radius:8px;border:1px solid #f5b542;background:rgba(245,181,66,0.12);"><span style="font-weight:600;">Ryan Adamson</span><span style="font-size:.75rem;color:#94a3b8;">May 22, 2026</span></div></li>
  </ul>
  <div style="display:flex;gap:.5rem;">
    <button style="padding:.45rem .85rem;border-radius:8px;background:#f5b542;color:#0b1220;border:0;font-weight:700;font-size:.85rem;">Assign</button>
    <button style="padding:.45rem .85rem;background:transparent;border:0;color:#94a3b8;font-size:.85rem;">Cancel</button>
  </div>
</div>`;
		});
		await shot(qaBanner, 'quick.assign.search');
		await shot(qaBanner, 'quick.assign.assign');
	});

	test('2D viewer — toolbar, tabs, nav', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas').first()).toBeVisible();
		await page.waitForTimeout(1500);

		const header = page.locator('header').first();
		const canvasArea = page.locator('.relative.flex.flex-1.flex-col').first();

		await page.getByRole('button', { name: 'Back', exact: true }).hover();
		await shot(header, 'viewer2d.back');
		await page.getByRole('checkbox', { name: 'FMX' }).hover();
		await shot(header, 'viewer2d.fmxToggle');
		await page.getByRole('button', { name: /X-rays/ }).hover();
		await shot(header, 'viewer2d.tabXrays');
		await page.getByRole('button', { name: /Photos/ }).hover();
		await shot(header, 'viewer2d.tabPhotos');
		// The Report tab lives in the right panel (the top-bar Printout/Report/PHI buttons
		// were removed). Open it and capture the editable report (Acceptable/Unacceptable
		// verdict + Edit/Copy/Download + the rendered report), then switch back to AI
		// Analysis so the findings shots below are taken on the right tab.
		await page.getByRole('tab', { name: 'Report' }).click();
		await page.waitForTimeout(500);
		await page.screenshot({
			path: `${OUT}/viewer2d-report.png`,
			clip: { x: 980, y: 56, width: 300, height: 764 }
		});
		await page.getByRole('tab', { name: 'AI Analysis' }).click();
		await page.waitForTimeout(200);

		await page
			.getByRole('button', { name: 'Previous study' })
			.hover()
			.catch(() => {});
		await shot(canvasArea, 'viewer2d.prev');
		await page
			.getByRole('button', { name: 'Next study' })
			.hover()
			.catch(() => {});
		await shot(canvasArea, 'viewer2d.next');
		await page.getByRole('button', { name: 'Full FMX view' }).hover();
		await shot(canvasArea, 'viewer2d.fullFmx');

		// Keyboard nav — capture before/after one step.
		const before = page.url();
		await page.keyboard.press('ArrowLeft');
		await page.waitForTimeout(800);
		await shot(page, 'viewer2d.arrowKeys');
		// return to original
		await page.goto(before);
		await expect(page.locator('canvas').first()).toBeVisible();
		await page.waitForTimeout(1000);

		// Toolbar — click each, screenshot the canvas region.
		for (const [aria, id] of [
			['Zoom in', 'viewer2d.zoomIn'],
			['Zoom out', 'viewer2d.zoomOut'],
			['Fit to screen', 'viewer2d.fit'],
			['100% actual size', 'viewer2d.actualSize'],
			['Magnifier', 'viewer2d.magnifier'],
			['Rotate', 'viewer2d.rotateRight'],
			['Flip horizontal', 'viewer2d.flipH'],
			['Flip vertical', 'viewer2d.flipV'],
			['Invert colors', 'viewer2d.invert'],
			['Tooth numbers', 'viewer2d.toothNumbers'],
			['Anatomy', 'viewer2d.anatomy']
		] as const) {
			await page
				.getByRole('button', { name: aria })
				.click()
				.catch(() => {});
			await page.waitForTimeout(200);
			await shot(canvasArea, id);
		}
		// Reset the rotate/flip the loop applied so the canvas-state shots below are clean.
		// (The Ruler tool + the in-viewer FDI/Universal toggle were removed in the clinician
		// feature-trim, so there are no shots for them anymore.)
		await page.getByRole('button', { name: 'Reset all adjustments' }).click();
		await page.waitForTimeout(300);
		await shot(canvasArea, 'viewer2d.resetAdjust');

		// Pan + wheel — interactive states on the canvas.
		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (box) {
			await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 10 });
			await page.mouse.up();
		}
		await shot(canvasArea, 'viewer2d.pan');
		if (box) await page.mouse.wheel(0, -200);
		await page.waitForTimeout(150);
		await shot(canvasArea, 'viewer2d.wheelZoom');
		await page.getByRole('button', { name: 'Reset all adjustments' }).click();
		await page.waitForTimeout(300);
	});

	test('2D viewer — adjust popover sliders', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas').first()).toBeVisible();
		await page.waitForTimeout(1200);
		await page.getByRole('button', { name: 'Brightness / contrast / sharpness' }).click();
		const popover = page.locator('div.absolute.top-3.right-3').first();
		await expect(popover).toBeVisible();
		await shot(popover, 'viewer2d.adjust');

		const sliders = popover.locator('input[type=range]');
		const ids = [
			'viewer2d.adjust.brightness',
			'viewer2d.adjust.contrast',
			'viewer2d.adjust.sharpness',
			'viewer2d.adjust.saturation'
		];
		const vals = ['1.8', '1.6', '2.0', '1.5'];
		for (let i = 0; i < 4; i++) {
			const s = sliders.nth(i);
			if (await s.count()) {
				await s.evaluate((el, v) => {
					(el as HTMLInputElement).value = v as string;
					el.dispatchEvent(new Event('input', { bubbles: true }));
				}, vals[i]);
			}
			await page.waitForTimeout(200);
			await shot(popover, ids[i]);
		}
		await page.getByRole('button', { name: 'Reset', exact: true }).hover();
		await shot(popover, 'viewer2d.adjust.reset');
	});

	test('2D viewer — findings panel', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas').first()).toBeVisible();
		await page.waitForTimeout(1500);
		// The redesigned "Diagnostic Results" panel is the right column (AI Analysis tab,
		// active by default). Clip that column for the panel-level shots.
		const clipPanel = { x: 980, y: 56, width: 300, height: 764 };

		// Master Hide All / Show All toggle (top-right of the panel header).
		await page.getByTestId('findings-hide-all').hover();
		await page.screenshot({ path: `${OUT}/viewer2d-findings-allPathology.png`, clip: clipPanel });

		// Per-class visibility: expand the first diagnostic group, then hover its Hide/Show
		// control so the per-group toggle is the highlighted element.
		const firstGroup = page.locator('.grp-toggle').first();
		if (await firstGroup.count()) await firstGroup.click();
		await page.waitForTimeout(200);
		const showHide = page.locator('.showhide').first();
		if (await showHide.count()) await showHide.hover();
		await page.screenshot({ path: `${OUT}/viewer2d-findings-classToggle.png`, clip: clipPanel });

		// Detection editor: activate the rectangle add-tool (it lives on the LEFT tool rail
		// now) so its highlighted state shows; capture the rail + the adjacent canvas edge.
		await page.getByTestId('detect-add-rect').click();
		await page.waitForTimeout(300);
		const railBox = await page.getByTestId('detect-add-rect').boundingBox();
		if (railBox) {
			await page.screenshot({
				path: `${OUT}/viewer2d-editDetections.png`,
				clip: {
					x: Math.max(0, railBox.x - 80),
					y: Math.max(0, railBox.y - 160),
					width: 360,
					height: 380
				}
			});
		}
		await page.getByTestId('detect-done').click();
	});

	// The viewer Report is a right-panel tab (its shot is captured in the top-bar test
	// above); the viewer Printout + PHI features were removed entirely.

	test('FMX grid + navigator', async ({ page }) => {
		await page.goto(`/patients/${STUDIES.fmxPatient}`);
		await expect(page.locator('header')).toBeVisible();
		await page.waitForTimeout(1000);
		const grid = page.locator('.fmx-grid').first();
		await grid.locator('.slot.filled').first().hover();
		await shot(grid, 'fmx.grid.slot');

		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas').first()).toBeVisible();
		await page.waitForTimeout(1500);
		const nav = page.getByRole('group', { name: 'Full-mouth series navigator' });
		await shot(nav, 'fmx.navigator');
		await nav.hover();
		await page.waitForTimeout(400);
		await shot(nav, 'fmx.navigator.pick');
	});

	test('patient page + photos', async ({ page }) => {
		await page.goto(`/patients/${STUDIES.fmxPatient}`);
		await expect(page.locator('header')).toBeVisible();
		await page.waitForTimeout(1000);
		const header = page.locator('header').first();
		await page.getByRole('button', { name: 'Back', exact: true }).hover();
		await shot(header, 'patient.back');
		await page.getByRole('checkbox', { name: 'FMX' }).hover();
		await shot(header, 'patient.fmxToggle');
		await header.locator('button[aria-expanded]').first().hover();
		await shot(header, 'patient.dateFilter');
		await page.getByRole('button', { name: /X-rays/ }).hover();
		await shot(header, 'patient.tabXrays');
		await page.getByRole('button', { name: /Photos/ }).hover();
		await shot(header, 'patient.tabPhotos');
		await page.getByRole('link', { name: 'Add study' }).hover();
		await shot(header, 'patient.addStudy');
		await page.getByRole('button', { name: 'Printout' }).hover();
		await shot(header, 'patient.printout');
		// Edit + Delete patient (header actions, added with the patient edit/delete UI).
		await page.getByTestId('patient-edit-btn').hover();
		await shot(header, 'patient.edit');
		await page.getByTestId('patient-delete-btn').hover();
		await shot(header, 'patient.delete');

		const tile = page.locator('.fmx-grid .slot.filled').first();
		await tile.hover();
		await shot(tile, 'patient.openStudy');
		// Delete tile button is in the linear view — switch off FMX.
		await page.getByLabel('FMX').click();
		await page.waitForTimeout(500);
		const linearTile = page.locator('.study-tile').first();
		await linearTile.hover();
		await shot(linearTile, 'patient.deleteStudy');

		// Tab + 3D (if present)
		const tab3d = page.getByRole('button', { name: /3D/ });
		if (await tab3d.count()) {
			await tab3d.hover();
			await shot(header, 'patient.tab3d');
		} else await shot(header, 'patient.tab3d');

		// Photos tab — Ryan has real camera photos (mouth_photo.jpeg ×2), so the gallery +
		// lightbox show an actual intra-oral photo. Navigate/close need the lightbox open;
		// prev/next render only with >1 photo (hence two).
		await page.getByRole('button', { name: /Photos/ }).click();
		await page.waitForTimeout(600);
		const main = page.locator('main').first();
		const photoTile = page.locator('.tile').first();
		await expect(photoTile).toBeVisible();
		// Delete — hover a grid tile to reveal its trash button (opacity-0 → group-hover).
		await photoTile.hover();
		await page.waitForTimeout(200);
		await shot(main, 'photos.delete');
		// View — click the tile to open the lightbox over the real photo.
		await photoTile.locator('button').first().click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.waitForTimeout(350);
		await shot(page, 'photos.view');
		// Navigate — prev/next arrows (present because there are 2 photos).
		await page.getByRole('button', { name: 'Next photo' }).hover();
		await shot(page, 'photos.navigate');
		// Close — the lightbox's close control.
		await page
			.locator('.lb-actions .lb-btn')
			.last()
			.hover()
			.catch(() => {});
		await shot(page, 'photos.close');
		await page.keyboard.press('Escape');

		// Add photo (empty state) — the "Add photo" CTA only renders when the Photos tab is
		// empty, so capture it from a patient with no camera photos (the CBCT-only patient).
		await page.goto(`/patients/${STUDIES.cbctSeg.patient}`);
		await expect(page.locator('header')).toBeVisible();
		await page.waitForTimeout(800);
		await page.getByRole('button', { name: /Photos/ }).click();
		await page.waitForTimeout(400);
		await page.getByRole('button', { name: 'Add photo' }).hover();
		await shot(page.locator('main').first(), 'photos.add');
	});

	test('CBCT — views + tool rail + MPR panes', async ({ page }) => {
		test.setTimeout(360_000);
		// View tabs / layout buttons + tool rail shots on MPR.
		await page.goto(url.cbct(STUDIES.cbctSeg) + '?view=mpr');
		await waitForCbctVolume(page);
		const main = page.locator('main').first();
		// CBCT chrome locators — the (app) Sidebar is the first aside on the page, so
		// the CBCT tool rail is the SECOND aside (a 48-px wide aside.w-12) and the
		// layers panel is the THIRD (aside.w-[290px], present in non-Report views).
		// The CBCT viewer's top bar isn't a <header> — it's the border-b div that
		// contains the Back button — find it via XPath ancestor:: from the Back btn.
		const rail = page.locator('aside.w-12').first();
		const header = page
			.locator('button[aria-label="Back"]')
			.locator('xpath=ancestor::div[contains(@class,"border-b")][1]');

		await page.getByRole('button', { name: 'Back', exact: true }).hover();
		await shot(header, 'cbct.back');
		for (const [name, id] of [
			['MPR', 'cbct.viewMpr'],
			['3D', 'cbct.view3d'],
			['Panoramic', 'cbct.viewPanoramic'],
			['Report', 'cbct.viewReport']
		] as const) {
			const tab = page.locator(`button.tab-btn:has-text("${name}")`).first();
			await tab.hover();
			await shot(header, id);
		}
		// Run AI segmentation (top-bar button only on raw — reuse the report-view header).
		await shot(header, 'cbct.runSegmentation');

		// Back to MPR for tool-rail shots.
		await page.locator('button.tab-btn:has-text("MPR")').first().click();
		await waitForCbctVolume(page);

		for (const [aria, id] of [
			['Crosshair (link slices)', 'cbct.tool.crosshair'],
			['Pan', 'cbct.tool.pan'],
			['Window/Level', 'cbct.tool.wl'],
			['Linear measurement', 'cbct.tool.measure'],
			['Angle measurement', 'cbct.tool.angle'],
			['Annotation pin', 'cbct.tool.annotate'],
			['Slab thickness', 'cbct.tool.slab'],
			['Toggle crosshair overlay', 'cbct.tool.toggleCrosshair'],
			['Reset window/level', 'cbct.tool.resetWL'],
			['Reset all', 'cbct.tool.resetAll']
		] as const) {
			const btn = page.locator(`button[aria-label="${aria}"]`).first();
			if (await btn.count()) await btn.hover();
			await shot(rail, id);
		}

		// MPR pane interactions
		const axialPane = page.locator('.mpr-pane').first();
		const slider = axialPane.locator('input[type=range]');
		await shot(axialPane, 'cbct.mpr.sliceSlider');
		await axialPane.hover();
		await page.mouse.wheel(0, 100);
		await page.waitForTimeout(200);
		await shot(axialPane, 'cbct.mpr.wheelScrub');
		await page.keyboard.press('ArrowDown');
		await page.waitForTimeout(200);
		await shot(axialPane, 'cbct.mpr.arrowScrub');
		// Maximize button is a sibling of the .mpr-pane (snippet rendered in the parent
		// cell div), not inside it. Use a page-level locator.
		await page.locator('button[aria-label="Maximize pane"]').first().click();
		await page.waitForTimeout(400);
		await shot(main, 'cbct.mpr.maximize');
		await page.locator('button[aria-label="Restore layout"]').first().click();
		void slider;

		// Sidebar window / level / reduce noise — the CBCT layers panel is the
		// third aside on the page ((app) sidebar, tool rail, layers panel).
		await page
			.getByRole('button', { name: 'Anatomy' })
			.click()
			.catch(() => {});
		const sidebar = page.locator('aside').nth(2);
		const w = page.locator('aside input[type=range]').first();
		if (await w.count()) await w.hover();
		await shot(sidebar, 'cbct.window');
		const l = page.locator('aside input[type=range]').nth(1);
		if (await l.count()) await l.hover();
		await shot(sidebar, 'cbct.level');
		const rn = page.getByLabel('Reduce noise');
		if (await rn.count()) await rn.first().hover();
		await shot(sidebar, 'cbct.reduceNoise');
		const layerCb = page.locator('aside input.checkbox').first();
		if (await layerCb.count()) await layerCb.first().hover();
		await shot(sidebar, 'cbct.layers.toggle');
	});

	test('CBCT — 3D view (gizmo + select + open)', async ({ page }) => {
		await page.goto(url.cbct(STUDIES.cbctSeg) + '?view=volume');
		await waitFor3dReady(page);
		await page.waitForTimeout(1500);
		const canvas = page.locator('canvas').first();
		const main = page.locator('main').first();
		await shot(main, 'cbct.vol.orbit');
		for (const [aria, id] of [['View: top', 'cbct.vol.gizmo']] as const) {
			const b = page.locator(`button[title="${aria}"]`).first();
			if (await b.count()) await b.click();
			await page.waitForTimeout(400);
			await shot(main, id);
		}
		const box = await canvas.boundingBox();
		if (box) {
			await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
			await page.waitForTimeout(400);
		}
		await shot(main, 'cbct.vol.selectTooth');
		if (box) {
			await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.55);
			await page.waitForTimeout(600);
		}
		const modal = page.getByRole('heading', { name: /Tooth \d+ conditions/i });
		if (await modal.count()) await shot(page, 'cbct.vol.openTooth');
		else await shot(main, 'cbct.vol.openTooth');
		await page.keyboard.press('Escape').catch(() => {});
	});

	test('CBCT — panoramic tools', async ({ page }) => {
		await page.goto(url.cbct(STUDIES.cbctSeg) + '?view=panoramic');
		await waitFor3dReady(page);
		await page.waitForTimeout(1500);
		const main = page.locator('main').first();
		for (const [title, id] of [
			['Crosshair — drop a reference marker', 'cbct.pano.crosshair'],
			['Pan (or just drag)', 'cbct.pano.pan'],
			['Ruler — drag to measure (mm)', 'cbct.pano.ruler'],
			['MIP slab thickness (click to cycle)', 'cbct.pano.slab'],
			['Zoom to fit', 'cbct.pano.zoomFit'],
			['Show / hide overlays', 'cbct.pano.overlays']
		] as const) {
			const b = page.locator(`button.pano-tool[title="${title}"]`).first();
			if (await b.count()) await b.hover();
			await shot(main, id);
		}
	});

	test('CBCT — report + modal', async ({ page }) => {
		await page.goto(url.cbct(STUDIES.cbctSeg) + '?view=report');
		await waitFor3dReady(page);
		await page.waitForTimeout(1500);
		const main = page.locator('main').first();
		await page.getByRole('button', { name: 'Print report' }).hover();
		await shot(main, 'cbct.report.print');
		const sign = page.getByRole('button', { name: /Approve all and sign|Signed/ });
		if (await sign.count()) await sign.first().hover();
		await shot(main, 'cbct.report.sign');
		const chip = page.locator('button.category-chip').first();
		if (await chip.count()) await chip.hover();
		await shot(main, 'cbct.report.categoryChips');
		const toothCell = page.locator('button[title^="Tooth "]').first();
		if (await toothCell.count()) await toothCell.click();
		await page.waitForTimeout(300);
		await shot(main, 'cbct.report.toothChart');
		const sel = page.getByRole('button', { name: /Clear selection|Select teeth/ });
		if (await sel.count()) await sel.first().hover();
		await shot(main, 'cbct.report.selectTeeth');
		const cond = page.getByRole('button', { name: 'Condition' }).first();
		if (await cond.count()) {
			await cond.hover();
			await shot(main, 'cbct.card.condition');
			await cond.click();
			await page.waitForTimeout(500);
			const dialog = page.locator('[role=dialog]').first();
			if (await dialog.count()) {
				await shot(dialog, 'cbct.modal.sort');
				await dialog.locator('button[aria-label="Close"]').click();
			} else await shot(main, 'cbct.modal.sort');
			await shot(main, 'cbct.modal.close');
		} else {
			await shot(main, 'cbct.card.condition');
			await shot(main, 'cbct.modal.sort');
			await shot(main, 'cbct.modal.close');
		}
		const comment = page.getByRole('button', { name: 'Comment' }).first();
		if (await comment.count()) await comment.hover();
		await shot(main, 'cbct.card.comment');
		const approve = page.getByRole('button', { name: /^Approve$|Approved/ }).first();
		if (await approve.count()) await approve.hover();
		await shot(main, 'cbct.card.approve');
	});

	test('IOS viewer', async ({ page }) => {
		test.setTimeout(360_000);
		await page.goto(url.ios(STUDIES.iosSeg));
		await waitFor3dReady(page);
		await page.waitForTimeout(1500);
		const main = page.locator('main').first();
		const rail = page.locator('aside').first();
		const right = page.locator('aside').nth(1);
		await page.getByRole('button', { name: 'Back', exact: true }).hover();
		await shot(page.locator('header').first(), 'ios.back');
		await shot(main, 'ios.runSegmentation');
		for (const [name, id] of [
			['Anterior view', 'ios.view.anterior'],
			['Posterior view', 'ios.view.posterior'],
			['Right buccal', 'ios.view.rightBuccal'],
			['Left buccal', 'ios.view.leftBuccal'],
			['Occlusal — upper', 'ios.view.occlusalUpper'],
			['Occlusal — lower', 'ios.view.occlusalLower']
		] as const) {
			const b = page.getByRole('button', { name, exact: true }).first();
			if (await b.count()) await b.click();
			await page.waitForTimeout(400);
			await shot(main, id);
		}
		for (const [name, id] of [
			['Wireframe', 'ios.wireframe'],
			['Measure', 'ios.measure'],
			['Screenshot', 'ios.screenshot'],
			['Reset view', 'ios.resetView']
		] as const) {
			const b = page.getByRole('button', { name, exact: true }).first();
			if (await b.count()) await b.click();
			await page.waitForTimeout(400);
			await shot(main, id);
		}
		// clearMeasure only appears after measuring; we can't reliably draw without
		// hitting the mesh, so use the measure shot as a stand-in.
		await shot(main, 'ios.clearMeasure');

		// Layer toggles
		await page.getByRole('button', { name: 'Upper', exact: true }).click();
		await page.waitForTimeout(400);
		await shot(main, 'ios.layers.upper');
		await page.getByRole('button', { name: 'Lower', exact: true }).click();
		await page.waitForTimeout(400);
		await shot(main, 'ios.layers.lower');
		await page.getByRole('button', { name: 'All', exact: true }).click();
		await page.waitForTimeout(400);
		await shot(main, 'ios.layers.all');
		const cb = right.locator('input.checkbox').first();
		if (await cb.count()) await cb.first().hover();
		await shot(right, 'ios.layers.toothToggle');
		const chartCell = page.locator('button[title^="Tooth "]').first();
		if (await chartCell.count()) await chartCell.hover();
		await shot(right, 'ios.toothChart');
		if (await chartCell.count()) await chartCell.click();
		await page.waitForTimeout(400);
		await shot(main, 'ios.selectTooth');
		void rail;
	});

	test('settings + account + billing + paywall', async ({ page }) => {
		await page.goto('/settings');
		const appearanceCard = page.locator('main .card').nth(0); // theme + language
		const viewerCard = page.locator('main .card').nth(1); // tooth numbering + measurement unit
		await page.getByTestId('theme-dark').hover();
		await shot(appearanceCard, 'settings.theme');
		await page.getByTestId('lang-en').hover();
		await shot(appearanceCard, 'settings.language');
		await page.getByRole('button', { name: 'Universal (1–32)' }).hover();
		await shot(viewerCard, 'settings.toothNumbering');
		// Measurement unit (mm / %) is disabled + labelled "N/A for 2D" — capture the card.
		await shot(viewerCard, 'settings.measurementUnit');
		// The "Enable 3D" toggle lives in the Labs card (rendered because the demo account
		// has labs_enabled); it is the last card.
		const labsCard = page.locator('main .card').last();
		await page.getByTestId('enable-3d-toggle').hover();
		await shot(labsCard, 'settings.enable3d');

		await page.goto('/account');
		const acard = page.locator('main .card').first();
		await page.getByLabel('Full name').focus();
		await shot(acard, 'account.name');
		await page.getByLabel('Mobile').focus();
		await shot(acard, 'account.mobile');
		await page.getByLabel('Address').focus();
		await shot(acard, 'account.address');
		await page.getByRole('button', { name: /Save changes/ }).hover();
		await shot(acard, 'account.save');

		// The demo account has an ACTIVE plan → this captures billing.cancel (the
		// "Renews on … / Cancel subscription" state). billing.subscribe (no-sub plans)
		// and billing.cancelled (ends-at-period-end) come from the demo-trial account in
		// the dedicated "subscription journey" block below.
		await page.goto('/billing');
		const bmain = page.locator('main').first();
		await page.waitForTimeout(1500);
		const cancel = page.getByRole('button', { name: 'Cancel subscription' });
		if (await cancel.count()) await cancel.hover();
		await shot(bmain, 'billing.cancel');

		// Paywall modal — synthesize so we have shots for the buttons without
		// requiring a subscription-failure state.
		await page.evaluate(() => {
			const root = document.createElement('div');
			root.id = 'mock-paywall';
			root.style.cssText =
				'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb;';
			root.innerHTML = `
<div style="width:100%;max-width:28rem;border-radius:14px;border:1px solid #334155;background:#0f172a;overflow:hidden;">
  <div style="background:linear-gradient(135deg,rgba(245,181,66,0.18),rgba(124,127,255,0.18));padding:1.25rem;">
    <h3 style="margin:0;font-size:1.05rem;color:#f1f5f9;">Subscription required</h3>
    <p style="margin:.3rem 0 0;font-size:.85rem;color:#94a3b8;">AI inference is a subscription feature. Pick a plan to unlock.</p>
  </div>
  <div style="padding:1rem 1.25rem;display:flex;justify-content:flex-end;gap:.5rem;">
    <button style="padding:.5rem 1rem;background:#1e293b;border:1px solid #334155;color:#cbd5e1;border-radius:8px;font-size:.85rem;">Not now</button>
    <button style="padding:.5rem 1rem;background:#f5b542;color:#0b1220;border:0;border-radius:8px;font-size:.85rem;font-weight:700;">View plans</button>
  </div>
</div>`;
			document.body.appendChild(root);
		});
		const paywall = page.locator('#mock-paywall');
		await shot(paywall, 'modals.paywall.viewPlans');
		await shot(paywall, 'modals.paywall.notNow');
	});
});

// ── Subscription journey (no-sub test account: demo-trial@becertain.ai) ──────
// Captures the two billing states the always-active demo account can't show: the
// plans/Subscribe page (no active sub) and the post-cancel "ends at period end"
// state. Each test GUARDS on demo-trial's current sub state and skips (rather than
// shooting a wrong state) if it doesn't match — so a full GEN_SHOTS run can never
// corrupt these. To (re)generate, seed the DB state then run the matching grep:
//   # no sub → billing.subscribe
//   sqlite3 pb/pb_data/data.db "DELETE FROM subscriptions WHERE user='<demo-trial uid>';"
//   GEN_SHOTS=1 E2E_PASSWORD=… playwright test manual-shots -g "subscribe \(plans"
//   # active + cancelAtPeriodEnd, currentPeriodEnd=<last valid day> → billing.cancelled
//   GEN_SHOTS=1 E2E_PASSWORD=… playwright test manual-shots -g "cancelled \(ends"
describe('subscription journey (demo-trial)', () => {
	test.use({ storageState: { cookies: [], origins: [] } });
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('dxv:theme', 'dark');
			localStorage.setItem('dxv:sidebar', 'expanded');
		});
	});

	async function loginAsTrial(page: Page) {
		await page.goto('/login');
		await page.locator('#email').fill('demo-trial@becertain.ai');
		await page.locator('#password').fill(process.env.E2E_PASSWORD || 'DemoPass123!');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL(/\/studies/, { timeout: 20000 }).catch(() => {});
	}

	test('billing — subscribe (plans, no active sub)', async ({ page }) => {
		await loginAsTrial(page);
		await page.goto('/billing');
		await page.waitForTimeout(1800);
		const hasSubscribe = await page.getByRole('button', { name: 'Subscribe' }).first().count();
		test.skip(hasSubscribe === 0, 'demo-trial has a sub — re-run with the no-sub DB state');
		await page.getByRole('button', { name: 'Subscribe' }).first().hover();
		await shot(page.locator('main').first(), 'billing.subscribe');
	});

	test('billing — cancelled (ends at period end)', async ({ page }) => {
		await loginAsTrial(page);
		await page.goto('/billing');
		await page.waitForTimeout(1800);
		const hasEnds = await page.getByText('Ends at period end').count();
		test.skip(hasEnds === 0, 'demo-trial is not cancelled-at-period-end — seed that sub first');
		await shot(page.locator('main').first(), 'billing.cancelled');
	});
});
