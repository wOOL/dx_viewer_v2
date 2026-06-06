// Library-safe replacement for SvelteKit's `$app/environment`.`browser`.
// True in real browsers; false in SSR, vitest node projects, and extension
// service workers (no `window` there — which is the correct semantic for the
// cookie/localStorage code paths this guards).
export const browser = typeof window !== 'undefined';
