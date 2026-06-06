// Pure decision helpers for the CBCT + IOS 3D-segmentation flows. Extracted so the
// (untestable-in-isolation) Svelte workspaces can be covered by unit tests instead
// of only an E2E that needs an unsubscribed account / a real minutes-long inference.
//
// Two confirmed missing-safeguard bugs motivate these:
//
//  A1 — "Run segmentation" fires a BILLABLE AI call (cbct_seg_inference /
//       ios_seg_inference). The 2D X-ray paths translate a backend 403 into a
//       PaywallModal AND proactively gate before calling; the 3D buttons did
//       neither (they only set `error = raw message`). `shouldPaywall` decides
//       both the proactive guard (status omitted) and the catch-side 403 handling.
//
//  V5 — A cached-segmentation / scan fetch that comes back with a REAL HTTP error
//       (e.g. a 403 from an expired file token, or a 500) was swallowed by a
//       `console.warn` + progress-clear, so the 3D view silently fell back to the
//       empty "Run AI Segmentation" CTA as if no segmentation existed. `segLoadOutcome`
//       distinguishes genuinely-absent (404 / no field — show the CTA) from a real
//       error (received a response but not ok — show a retry banner).

/** Outcome of fetching a cached segmentation (or the raw scan) for the 3D viewers. */
export type SegLoadOutcome = 'ok' | 'absent' | 'error';

/**
 * Classify a segmentation/scan fetch Response.
 *  - `ok`     — 2xx, render it.
 *  - `absent` — a 404 (the file genuinely isn't there) → fall back to the Run-AI CTA.
 *  - `error`  — any other non-ok status (403 expired token, 500, …) → a real failure
 *               that must surface a retry banner, NOT masquerade as "no segmentation".
 *
 * A 404 is treated as "absent" because PB returns 404 when the file field is unset
 * (or the record/file is gone); every other non-2xx is a transport/auth failure the
 * user needs to know about so they can retry rather than silently re-run a paid job.
 */
export function segLoadOutcome(res: { ok: boolean; status: number }): SegLoadOutcome {
	if (res.ok) return 'ok';
	if (res.status === 404) return 'absent';
	return 'error';
}

/**
 * Should the segmentation flow show the paywall instead of calling / instead of
 * surfacing a raw error?
 *
 *  - Proactive guard (call with `status` omitted): paywall iff there's no active
 *    subscription — block the billable call before it fires.
 *  - Catch-side (call with the thrown `status`): paywall on a backend 403 even if
 *    the client THOUGHT it had a subscription (defense in depth — the server is the
 *    source of truth; the local sub cache can be stale/expired). Mirrors the X-ray
 *    siblings' `if (status === 403) { … paywallOpen = true }`.
 */
export function shouldPaywall(hasActiveSub: boolean, status?: number): boolean {
	if (status === 403) return true;
	if (status === undefined) return !hasActiveSub;
	return false;
}
