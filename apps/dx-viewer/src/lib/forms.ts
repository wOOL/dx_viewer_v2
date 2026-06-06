// Pure form/state helpers shared by the billing, account, signup, login, and
// password-reset pages.
//
// These exist to close confirmed missing-safeguard gaps:
//   - A5: an empty (but successful) Stripe plan list rendered a dead-end paywall
//     with no cards and no error → `planListState` distinguishes empty from error.
//   - A7: profile save sent an untrimmed/blank name (persisting an empty name that
//     renders blank in the TopBar/Sidebar), and signup accepted a whitespace-only
//     password (`'        '`.length === 8 passes a naive length check). The pure
//     validators below trim first and reject whitespace-only / over-long input.
//   - A1: the auth-flow catch blocks did `err.message ?? localizedFallback`, but a
//     PocketBase `ClientResponseError` ALWAYS has a truthy `.message` (raw English),
//     so the localized fallback was dead and non-English users saw English.
//     `authErrorMessage` maps by `.status` to a localized key instead.
//   - A5 (email): only native `type=email required` guarded the email field;
//     `isValidEmail` adds a trimmed, permissive format check before the SDK call.
//
// Kept framework-free so the branch logic is unit-testable without rendering the
// Svelte route components.

/** Max accepted length for the profile display name. Long enough for real names,
 *  short enough to avoid layout-breaking / abusive input in the TopBar/Sidebar. */
export const MAX_NAME_LENGTH = 100;

/** Minimum password length (mirrors the signup `<input minlength="8">`). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Trim a patient/display name and hard-cap it at {@link MAX_NAME_LENGTH}. The
 * `<input maxlength>` on each form is the first line of defence, but a paste that
 * bypasses the attribute, a programmatic set, or a form that simply forgot the cap
 * would otherwise persist a 10k-char name to PB and break every place it renders
 * (avatars, cards, the printout header). Applied at the STORE persist sites
 * (renamePatient / findOrCreatePatient) so it's enforced no matter which caller
 * forgot — defence at the choke point, not just the UI.
 */
export function capName(name: string): string {
	return (name ?? '').trim().slice(0, MAX_NAME_LENGTH);
}

export type ProfileValidation =
	| { valid: true; name: string }
	| { valid: false; reason: 'empty' | 'tooLong' };

/**
 * Validate (and normalize) the editable profile fields before persisting.
 * Returns the trimmed name on success so the caller saves the normalized value.
 *
 * - whitespace-only / empty name → invalid ('empty')
 * - trimmed name longer than {@link MAX_NAME_LENGTH} → invalid ('tooLong')
 */
export function validateProfile(input: { name: string }): ProfileValidation {
	const name = (input.name ?? '').trim();
	if (name.length === 0) return { valid: false, reason: 'empty' };
	if (name.length > MAX_NAME_LENGTH) return { valid: false, reason: 'tooLong' };
	return { valid: true, name };
}

/**
 * A password is acceptable only if, after trimming surrounding whitespace, it
 * still meets the minimum length. This rejects the all-whitespace password that
 * a naive `password.length < 8` check lets through.
 *
 * Note: we deliberately validate against the *trimmed* length rather than
 * mutating the password — the raw value is still sent to the backend.
 */
export function isAcceptablePassword(pw: string): boolean {
	return (pw ?? '').trim().length >= MIN_PASSWORD_LENGTH;
}

/**
 * Permissive client-side email validity check used to short-circuit obviously
 * invalid submissions before hitting the SDK. Trims first, then requires a
 * `local@domain.tld` shape. Intentionally NOT a TLD allow-list — it must not
 * reject legitimate addresses, only catch empty / whitespace / clearly malformed
 * input (the only guard today is native `type=email required`).
 */
export function isValidEmail(s: string): boolean {
	const v = (s ?? '').trim();
	if (!v) return false;
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Shape of a PocketBase `ClientResponseError` (only the parts we read). The SDK
 * nests per-field validation errors under `data.data.<field>.message`, carries a
 * top-level `.message` summary, and a numeric `.status` (0 == no HTTP response /
 * network failure / aborted). Modelled loosely so a plain `Error` or a thrown
 * non-Error value can be passed too.
 */
export type SaveError = {
	message?: string;
	status?: number;
	data?: { data?: Record<string, { message?: string }> };
};

/**
 * What a page should display after a *failed* server call. Either a localization
 * `key` the caller resolves through `$_(...)`, or a ready-to-render `text` (a PB
 * field-validation summary / server `.message`, which is already a sentence and
 * has no translation key of its own).
 *
 * The discriminant is which property is present (exactly one always is).
 */
export type SaveErrorMessage = { key: string } | { text: string };

/**
 * Pick the message to show when `users.update(...)` itself fails (500 / timeout /
 * validation) — the *real* save-failure path, distinct from a post-save local
 * persistence hiccup.
 *
 * Precedence:
 *   1. PB per-field validation errors (`data.data`) → a `"field: message"` summary,
 *      which is the most specific, actionable signal.
 *   2. A non-empty top-level `.message` (e.g. a network/timeout string).
 *   3. Otherwise → the generic localized `account.saveFailed` key.
 *
 * Returning a key (not a raw string) for the fallback is the whole point: it stops
 * a raw, non-localized SDK/storage string from leaking into the UI.
 */
export function accountSaveErrorMessage(err: unknown): SaveErrorMessage {
	const e = (err ?? {}) as SaveError;
	const fieldErrors = e.data?.data;
	if (fieldErrors && typeof fieldErrors === 'object') {
		const parts = Object.entries(fieldErrors)
			.map(([field, info]) => {
				const msg = info?.message?.trim();
				return msg ? `${field}: ${msg}` : '';
			})
			.filter((s) => s.length > 0);
		if (parts.length > 0) return { text: parts.join('; ') };
	}
	const message = typeof e.message === 'string' ? e.message.trim() : '';
	if (message.length > 0) return { text: message };
	return { key: 'account.saveFailed' };
}

/**
 * Map an auth-flow error (login / signup / OTP / password reset) to a localized
 * message key (or a raw server field message when there's no translation).
 *
 * ROOT FIX for A1: every auth catch block did `err.message ?? localizedFallback`,
 * but a PocketBase `ClientResponseError` ALWAYS carries a truthy `.message` (raw
 * English, e.g. "Failed to authenticate."), so the localized fallback was dead and
 * non-English users saw English. Map by `.status` instead:
 *   - 0 (network failure / abort / no HTTP response) → `api.networkError`
 *   - 400 / 401 / 403 / 404 (bad credentials / forbidden / unknown account) →
 *     `login.errInvalidCredentials`
 *   - anything else (5xx, unexpected) → `api.serverError`
 *
 * Pass `{ fields: true }` only on pages that already surface PocketBase field
 * errors (signup): a present `email`/`password` field message is then preferred
 * (e.g. "email already in use"), since it has no translation key and is the most
 * actionable signal. Email takes precedence over password.
 *
 * Returns either `{ key }` (look up via `$_(key)`) or `{ text }` (show as-is).
 */
export function authErrorMessage(err: unknown, opts: { fields?: boolean } = {}): SaveErrorMessage {
	const e = (err ?? {}) as SaveError;

	// Prefer a genuine server field message only where the page shows them.
	if (opts.fields) {
		const fieldErrors = e.data?.data ?? {};
		const emailMsg = fieldErrors.email?.message?.trim();
		if (emailMsg) return { text: emailMsg };
		const passwordMsg = fieldErrors.password?.message?.trim();
		if (passwordMsg) return { text: passwordMsg };
	}

	const status = e.status;

	// status 0 == no HTTP response (network down, CORS, aborted request).
	if (status === 0) return { key: 'api.networkError' };

	// 4xx auth failures: bad credentials / unknown account / forbidden / not found.
	if (status === 400 || status === 401 || status === 403 || status === 404) {
		return { key: 'login.errInvalidCredentials' };
	}

	// 5xx and anything unexpected (including no status at all).
	return { key: 'api.serverError' };
}

/**
 * General server-call error → localized message, by HTTP status. Same status
 * mapping as {@link authErrorMessage} but named for non-auth callers (billing,
 * consent, any page that does `apiJson`/`pb.collection(...)` and showed a RAW
 * `(err as Error).message` before — a PB ClientResponseError always has a truthy
 * English `.message`, so those leaked untranslated). Use this in catch blocks that
 * have no field-level errors to surface.
 *   - 0 (network down / abort / no response) → `api.networkError`
 *   - 4xx → `api.requestError`
 *   - 5xx / unknown → `api.serverError`
 */
export function serverErrorMessage(err: unknown): SaveErrorMessage {
	const e = (err ?? {}) as SaveError;
	const status = e.status;
	if (status === 0) return { key: 'api.networkError' };
	if (typeof status === 'number' && status >= 400 && status < 500) {
		return { key: 'api.requestFailed' };
	}
	return { key: 'api.serverError' };
}

/**
 * Resolve a {@link SaveErrorMessage} to a display string. Pass the i18n `$_` (and
 * optionally values for an interpolated key like `api.serverError`'s `{status}`).
 * A `{ text }` result is already a sentence and is returned verbatim; a `{ key }`
 * is looked up. Centralises the `'key' in m ? $_(m.key) : m.text` branch every
 * caller would otherwise repeat.
 */
export function resolveErrorMessage(
	m: SaveErrorMessage,
	t: (key: string, opts?: { values?: Record<string, string | number> }) => string,
	values?: Record<string, string | number>
): string {
	return 'key' in m ? t(m.key, values ? { values } : undefined) : m.text;
}

/**
 * Localization key for a failed OPERATION that has its own contextual fallback (an AI
 * run, quick-analyze, a batch upload item, a quick-assign save). The 403 / paywall case
 * is handled by the caller; this is the NON-403 path.
 *
 * ROOT FIX (A1 sibling-drift): these catch blocks preferred `err.body.message` then
 * `err.message` over a localized fallback key,
 * but the backend's non-403 messages are raw English-technical strings ("AI service
 * unavailable…", "Internal:…", "AI Error") and a PocketBase ClientResponseError ALWAYS
 * carries a truthy English `.message`, so the localized fallback was dead and non-English
 * clinicians saw English on every failure. Map by status instead:
 *   - 0 (network down / abort / no response) → the more actionable `api.networkError`
 *   - anything else (5xx / unexpected) → the caller's localized `fallbackKey`
 * Returns a key the caller resolves with `$_(...)`. Never surfaces the raw `.message`.
 */
export function operationErrorKey(err: unknown, fallbackKey: string): string {
	if (isQuotaError(err)) return 'api.storageFull';
	const status = (err as { status?: number })?.status;
	if (status === 0) return 'api.networkError';
	return fallbackKey;
}

/** True for an IndexedDB/storage quota failure (DOMException QuotaExceededError, also
 *  legacy WebKit code 22 / Firefox NS_ERROR_DOM_QUOTA_REACHED code 1014). LOCAL-FIRST:
 *  a full disk is a real failure mode for 300 MB CBCTs stored in the browser — it must
 *  surface as "device storage full", not as a misleading generic "analysis failed". */
export function isQuotaError(err: unknown): boolean {
	if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
		return err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014;
	}
	return (err as { name?: string })?.name === 'QuotaExceededError';
}

export type PlanListState = 'loading' | 'error' | 'empty' | 'ready';

/**
 * Classify the plan-grid render state so the billing page can show a distinct,
 * actionable empty-state instead of an unsubscribed paywall with zero cards.
 *
 * Precedence: loading first, then a network/fetch error, then a successful but
 * empty list, otherwise ready. An error takes precedence over emptiness because
 * a thrown fetch leaves `plans` empty too, and the error message is the more
 * useful signal in that case.
 */
export function planListState(input: {
	loading: boolean;
	plans: unknown[];
	error: string;
}): PlanListState {
	if (input.loading) return 'loading';
	if (input.error) return 'error';
	if (input.plans.length === 0) return 'empty';
	return 'ready';
}
