import { test, expect } from '@playwright/test';

// No-subscription Stripe checkout — the regression guard for the first-time-subscriber
// 400 bug. A fresh signup has NO stripeCustomerId, so create-checkout-session takes the
// ELSE branch (stripe.pb.js:195) that sets `customer_email = user.getString("email")`.
// That line previously read `user.email` (undefined in the PB JSVM) → Stripe 400 → a
// brand-new user could NEVER subscribe. This test signs up a throwaway account through
// the real UI, reaches the paywall, clicks Subscribe, and asserts the endpoint returns a
// real checkout.stripe.com URL (HTTP 200) instead of the old 400.
//
// Runs in a CLEAN context (no demo storageState — the demo account is already subscribed
// and would show the "plan active" panel, never the paywall / the else branch).
const PB_URL = 'https://pbapi.becertain.ai';

test.describe('no-subscription Stripe checkout (first-time subscriber)', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	// Unique throwaway identity per run so reruns don't collide on unique-email.
	const stamp = `${process.pid}${Math.floor(performance.now())}`.replace(/\D/g, '').slice(-10);
	const EMAIL = `e2e-nosub-${stamp}@becertain.ai`;
	const PASSWORD = 'E2eNoSub!2026';
	const NAME = 'E2E No-Sub Tester';

	test('a fresh account can start Stripe checkout (else-branch returns a real URL, not 400)', async ({
		page
	}) => {
		// Capture the actual checkout-session response (status + payload). We intercept the
		// REQUEST (not page.on('response')) and read the body from the APIResponse here —
		// page.on('response')+res.json() races the page's own window.location redirect to
		// Stripe, which can reject the in-flight body read (the redirect tears the frame
		// down). route.fetch() gives us a navigation-independent copy, deterministically.
		const checkout: { status: number; url?: string; error?: string; settled: boolean } = {
			status: 0,
			settled: false
		};
		await page.route('**/api/stripe/create-checkout-session', async (route) => {
			try {
				const res = await route.fetch();
				checkout.status = res.status();
				try {
					const j = await res.json();
					checkout.url = j?.url;
					checkout.error = j?.error;
				} catch {
					/* non-JSON / error body */
				}
				checkout.settled = true;
				await route.fulfill({ response: res });
			} catch (e) {
				checkout.error = (e as Error).message;
				checkout.settled = true;
				await route.abort();
			}
		});
		// Don't actually leave for Stripe — abort the top-level redirect to checkout.
		await page.route('https://checkout.stripe.com/**', (r) => r.abort());

		// 1. Sign up through the real UI → auth.signup auto-logs-in and redirects to
		//    /billing?onboarding=1 (the paywall). One checkbox on the page = the terms.
		await page.goto('/signup');
		await page.locator('#name').fill(NAME);
		await page.locator('#email').fill(EMAIL);
		await page.locator('#password').fill(PASSWORD);
		await page.locator('#confirm').fill(PASSWORD);
		await page.locator('input[type="checkbox"]').check();
		await page.getByRole('button', { name: 'Create account', exact: true }).click();

		// 2. Land on the paywall — the Subscribe buttons confirm a no-subscription user
		//    (an active sub renders the "plan active" panel with no Subscribe buttons).
		await page.waitForURL('**/billing**', { timeout: 30_000 });
		const subscribeBtns = page.getByRole('button', { name: /subscribe/i });
		await expect(subscribeBtns.first()).toBeVisible({ timeout: 30_000 });

		// 3. Click the first plan's Subscribe → create-checkout-session ELSE branch.
		await subscribeBtns.first().click();

		// 4. The endpoint must return 200 with a real Stripe checkout URL — the fix.
		//    Wait for the intercept to settle, then assert status + URL together.
		await expect
			.poll(() => checkout.settled, {
				timeout: 30_000,
				message: () => `checkout-session request never completed`
			})
			.toBe(true);
		expect(checkout.status, `checkout error: ${checkout.error ?? '(none)'}`).toBe(200);
		expect(checkout.url, 'checkout-session response should carry a Stripe URL').toContain(
			'checkout.stripe.com'
		);

		// The old bug surfaced "Checkout failed" (the 400 body). It must not appear.
		await expect(page.getByText('Checkout failed')).toHaveCount(0);
	});

	// Best-effort cleanup: delete the throwaway user via the PB REST API (users.deleteRule
	// = self) so prod doesn't accumulate rows. request context is independent of the page;
	// swallow any failure — this is cleanup, not an assertion.
	test.afterAll(async ({ request }) => {
		try {
			const auth = await request.post(`${PB_URL}/api/collections/users/auth-with-password`, {
				data: { identity: EMAIL, password: PASSWORD }
			});
			if (!auth.ok()) return;
			const { token, record } = await auth.json();
			await request.delete(`${PB_URL}/api/collections/users/records/${record.id}`, {
				headers: { Authorization: token }
			});
		} catch {
			/* best effort */
		}
	});
});
