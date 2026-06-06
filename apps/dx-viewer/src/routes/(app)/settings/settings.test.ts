import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The Settings "Measurement unit" control was orphaned: after #15 disabled the 2D
// measurement feature and removed its FindingsPanel consumer, this page still
// persisted `dxv:measurementUnit` that nothing read. The fix makes it a disabled +
// explained row (matching FindingsPanel).
//
// The S2 device-preferences refactor then moved ALL persistence off this page: the
// page now drives the shared `prefs` store (prefs.set*) — which is the single writer
// of dxv:toothNumbering / dxv:phiOn / dxv:confThres and the one place that clears the
// dead dxv:measurementUnit key. So Settings must contain NO raw localStorage writes at
// all (no setItem/removeItem); the persistence + cleanup is asserted in the store's
// own unit test (prefs.svelte.test.ts). Route pages can't be component-rendered in the
// vitest browser project (SvelteKit client-router hangs), so guard the fix statically
// here; the live disabled UI is covered by settings.e2e.ts.
const src = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8');

describe('Settings — drives the shared prefs store (S2 refactor)', () => {
	it('no longer writes localStorage directly (single writer = the prefs store)', () => {
		// The clobber bug (S2-#1) came from a mount-time $effect re-writing every key.
		// Settings now mutates only via the crash-safe prefs setters, so there should be
		// no localStorage access at all on the page (the dead measurementUnit key is now
		// cleaned up once in the prefs store constructor, not here). NB: assert against
		// `localStorage.` so an explanatory comment merely *mentioning* a key name doesn't
		// trip the guard.
		expect(src).not.toMatch(/localStorage\.setItem/);
		expect(src).not.toMatch(/localStorage\.removeItem/);
		expect(src).not.toMatch(/localStorage\.getItem/);
	});

	it('drops the dead measurementUnit state/handler and disables the unit buttons', () => {
		// No reactive state or click handler reassigning a measurement-unit variable.
		expect(src).not.toMatch(/measurementUnit\s*=/);
		// The mm/% row is present but disabled + explained (parity with FindingsPanel #15).
		// Strings are now i18n keys (svelte-i18n), so assert against the message keys.
		expect(src).toContain('settings.naFor2d');
		expect(src).toMatch(
			/<button[^>]*class="opt"[^>]*disabled[^>]*>\s*\{[^}]*settings\.millimeters/
		);
		expect(src).toMatch(/<button[^>]*class="opt"[^>]*disabled[^>]*>\s*\{[^}]*settings\.percentage/);
	});

	it('drives the live preferences through the prefs store setters', () => {
		// Real interaction → the crash-safe setter (which updates the rune AND persists),
		// instead of a local $state mirror + write-back $effect.
		expect(src).toMatch(/prefs\.setToothNumbering\(/);
		// Controls reflect the store reactively (so another tab's change is visible live).
		expect(src).toMatch(/prefs\.toothNumbering/);
	});

	it('gates the Labs card (experimental modality opt-ins) behind the admin labs_enabled flag', () => {
		// The whole card is wrapped in {#if auth.labsEnabled} — a normal user never sees it.
		expect(src).toMatch(/\{#if auth\.labsEnabled\}/);
		// The card heading uses settings.tools (now "Labs") + the experimental toggles inside.
		expect(src).toContain('settings.tools');
		expect(src).toContain('enable-3d-toggle');
		expect(src).toContain('enable-photo-toggle');
		expect(src).toContain('enable-panoramic-toggle');
	});

	it('no longer exposes the PHI-default control (PHI removed entirely)', () => {
		expect(src).not.toMatch(/prefs\.setPhiDefault\(/);
		expect(src).not.toMatch(/prefs\.phiDefault/);
		expect(src).not.toContain('settings.phiDefault');
	});

	it('no longer exposes the confidence-threshold control (removed per clinician feedback)', () => {
		// The slider + its setter are gone from the page; the threshold value is still
		// consumed everywhere at the fixed default (DEFAULT_CONF_THRESHOLD).
		expect(src).not.toMatch(/prefs\.setConfThreshold\(/);
		expect(src).not.toMatch(/prefs\.confThreshold/);
		expect(src).not.toContain('settings.confThreshold');
		expect(src).not.toMatch(/type=['"]range['"]/);
	});

	it('exposes the account-level "Show Photos" toggle (sibling of enable 3D)', () => {
		expect(src).toContain('enable-photo-toggle');
		expect(src).toMatch(/auth\.setPhotoEnabled\(/);
		expect(src).toMatch(/auth\.photoEnabled/);
		expect(src).toContain('settings.enablePhoto');
	});

	it('exposes the account-level "Panoramic" toggle (gates panoramic + FMX)', () => {
		expect(src).toContain('enable-panoramic-toggle');
		expect(src).toMatch(/auth\.setPanoramicEnabled\(/);
		expect(src).toMatch(/auth\.panoramicEnabled/);
		expect(src).toContain('settings.enablePanoramic');
	});
});
