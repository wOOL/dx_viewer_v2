import { test, expect } from '@playwright/test';

// Subscription/billing resilience regressions. Both are pure-intercept (no prod data
// is mutated): we fault the relevant backend call and assert the UI degrades correctly.

test.describe('billing resilience', () => {
	// refreshSubscription runs on every (app)-shell mount with no retry UI. It used to do
	// `catch { this.subscription = null }`, so a transient PB blip silently downgraded a
	// PAYING clinician to "unsubscribed" for the whole session. The fix KEEPS the cached
	// (known-good) subscription on a thrown fetch. Repro: load the app (sub cached on the
	// initial successful fetch), then SPA-navigate to /billing with the subscriptions fetch
	// faulted — the active panel must still render.
	test('a transient subscription-fetch error does not drop a paying user', async ({ page }) => {
		await page.goto('/studies');
		// App shell rendered ⇒ the (app) layout already awaited refreshSubscription, so the
		// demo's active subscription is cached in the auth store.
		await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 30_000 });

		// Now fault every subsequent subscriptions fetch.
		await page.route('**/api/collections/subscriptions/records*', (r) =>
			r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
		);

		// SPA-navigate to /billing via the user menu (a full page load would reset the
		// store and lose the cached sub — defeating the test). billing.onMount calls
		// refreshSubscription, which now hits the 500.
		await page.getByRole('button', { name: 'User menu' }).click();
		await page.getByRole('menuitem', { name: 'Billing' }).click();
		await page.waitForURL('**/billing**', { timeout: 15_000 });

		// The cached active subscription is KEPT → the active panel renders, NOT the paywall.
		await expect(page.getByText('Current plan active')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText('No active subscription')).toHaveCount(0);
	});

	// startCheckout was the one billing catch that surfaced the RAW backend error string
	// (`e.body.error` / `e.message`, English) instead of routing through the localized
	// status mapper like loadPlans/cancelSubscription. Make the demo look unsubscribed (so
	// the Subscribe buttons render) and fault the checkout endpoint with a raw English body;
	// the UI must show the localized message, not the raw string.
	test('a checkout failure shows a localized message, not a raw backend string', async ({
		page
	}) => {
		// Empty (successful) subscriptions result → the paywall + Subscribe buttons render.
		await page.route('**/api/collections/subscriptions/records*', (r) =>
			r.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ page: 1, perPage: 1, totalItems: 0, totalPages: 0, items: [] })
			})
		);
		const RAW = 'ZZZ_RAW_BACKEND_ERROR_ZZZ';
		await page.route('**/api/stripe/create-checkout-session', (r) =>
			r.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: RAW })
			})
		);

		await page.goto('/billing');
		const subscribe = page.getByRole('button', { name: /subscribe/i }).first();
		await expect(subscribe).toBeVisible({ timeout: 30_000 });
		await subscribe.click();

		// Localized api.serverError (en: "Server error (500) — please try again in a moment.")
		await expect(page.getByText(/Server error \(500\)/)).toBeVisible({ timeout: 15_000 });
		// …and the raw backend string never reaches the UI (the pre-fix behaviour).
		await expect(page.getByText(RAW)).toHaveCount(0);
	});
});
