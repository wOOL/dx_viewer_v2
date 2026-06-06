import { type Page, expect } from '@playwright/test';

// Stable, demo-account-owned study targets (read-only — safe to hit repeatedly).
// Confirmed present in prod with the seg/inference flags noted.
export const STUDIES = {
	// 2D x-rays with cached AI inference (disease + anatomy RLE masks → #92).
	xray2d: { patient: 'as2mje0ij4xz6so', study: '19p6nmv8orx6pwk' },
	xray2dB: { patient: '1zq60qq6gmcfh87', study: 'zkuljakfxgqpc73' },
	panoramic: { patient: 'as2mje0ij4xz6so', study: 'l8han20dj2v5zrm' },
	// CBCT: one segmented (3D mesh + report findings), one raw (Run-AI CTA → #14).
	cbctSeg: { patient: 'mfgxs9u3r6ejjms', study: '5kduik758ngj76r' },
	cbctRaw: { patient: 'ktbzlz7mv01uxll', study: 'kmnkfs8dvn4x5nb' },
	// IOS: one segmented (per-tooth colours), one raw.
	iosSeg: { patient: '9q4fe1yijcj692r', study: 'j5t5cexc91d2ky6' },
	iosRaw: { patient: 'a1hac2jh57ypxfe', study: '757mju42bcutq5x' },
	// Patient with a fully-populated FMX (16+ x-rays + panoramic).
	fmxPatient: 'as2mje0ij4xz6so'
} as const;

export const url = {
	viewer2d: (s: { patient: string; study: string }) => `/viewer/${s.patient}/${s.study}`,
	cbct: (s: { patient: string; study: string }) => `/cbct/${s.patient}/${s.study}`,
	ios: (s: { patient: string; study: string }) => `/ios/${s.patient}/${s.study}`
};

// Every progress string the CBCT/IOS loaders can show (the overlay renders
// `{progress || 'Loading CBCT…'}`, so the text varies through the load).
const LOADING_TEXT =
	/Loading CBCT|Parsing volume|Downloading source|Loading cached|Large volumes|Processing|Loading mesh|Decoding/i;

/** A 3D view (CBCT/IOS) is ready once its WebGL canvas is present and the
 *  loading/parsing overlays are gone. The CBCT raw-volume parse is the slow one. */
export async function waitFor3dReady(page: Page, opts: { timeout?: number } = {}) {
	const timeout = opts.timeout ?? 90_000;
	await expect(page.locator('canvas').first()).toBeVisible({ timeout });
	await expect
		.poll(async () => (await page.getByText(LOADING_TEXT).count()) === 0, {
			timeout,
			message: 'loading overlay never cleared'
		})
		.toBe(true);
}

/** Stronger CBCT-MPR readiness: the raw grayscale volume is parsed (store.volume
 *  set) — proven by the slice counter showing "<n>/<maxSlices>" with a 2+-digit
 *  denominator. Needed before measuring/slicing, which require voxel data. */
export async function waitForCbctVolume(page: Page, opts: { timeout?: number } = {}) {
	const timeout = opts.timeout ?? 90_000;
	await waitFor3dReady(page, { timeout });
	await expect(page.getByText(/\/\s*\d{2,}\b/).first()).toBeVisible({ timeout });
}

/** Count non-transparent pixels in a canvas (overlay layer) — for asserting that
 *  an overlay actually drew something, and that a toggle changed it. */
export async function nonTransparentPixels(page: Page, selector: string): Promise<number> {
	return page.evaluate((sel) => {
		const c = document.querySelector(sel) as HTMLCanvasElement | null;
		if (!c) return -1;
		const ctx = c.getContext('2d');
		if (!ctx) return -1;
		const { data } = ctx.getImageData(0, 0, c.width, c.height);
		let n = 0;
		for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
		return n;
	}, selector);
}
