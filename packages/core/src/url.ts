// Validate a post-login `?next=` redirect target so a crafted link can't bounce a
// freshly-authenticated user off-site (an open redirect). The only legitimate
// value is a same-origin pathname that the root layout sets when it kicks an
// unauthenticated user to /login (encodeURIComponent(page.url.pathname)). Anything
// that resolves to a DIFFERENT origin is rejected in favour of the fallback:
//   - an absolute URL            "https://evil.com/x"
//   - a protocol-relative host   "//evil.com"
//   - a backslash trick the URL parser folds into "//host"  "/\evil.com"
//   - a non-http scheme          "javascript:…", "data:…", "mailto:…"
// Resolving `raw` against the real origin and comparing origins catches all of
// these in one check (and normalizes a same-origin absolute URL back to a path).
export function safeNextPath(
	raw: string | null | undefined,
	fallback: string,
	origin: string
): string {
	if (!raw) return fallback;
	try {
		const u = new URL(raw, origin);
		if (u.origin !== origin) return fallback; // resolved off-origin → reject
		return u.pathname + u.search + u.hash; // same-origin → safe relative target
	} catch {
		return fallback; // unparseable → fall back
	}
}
