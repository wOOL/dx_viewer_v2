import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Hardcoded — importing `SUPPORTED` from `src/lib/i18n` pulls in SvelteKit-only
// virtual modules ($app/environment) that don't resolve in plain Playwright.
const SUPPORTED = ['en', 'fr', 'es', 'de'] as const;

// Renders the in-app /help manual to PDF in each of the four locales. NOT part of
// the default suite — run on demand:
//   GEN_PDF=1 E2E_PASSWORD=DemoPass123! bunx playwright test manual-pdf
// Outputs `<repo>/manual/dx-viewer-manual-{en,fr,de,es}.pdf` (one per locale).
const GEN = !!process.env.GEN_PDF;
const describe = GEN ? test.describe : test.describe.skip;
const OUT = '../manual'; // resolved relative to fe/ (playwright cwd) → repo root

mkdirSync(OUT, { recursive: true });

describe('manual PDF', () => {
	// Larger viewport: wider columns, fewer line breaks, fewer pages.
	test.use({ viewport: { width: 1280, height: 1800 } });

	for (const loc of SUPPORTED) {
		test(`pdf — ${loc}`, async ({ page }) => {
			test.setTimeout(240_000);

			// Pin language + dark theme before the app boots (svelte-i18n reads
			// dxv:lang on init).
			await page.addInitScript((lang) => {
				localStorage.setItem('dxv:lang', lang);
				localStorage.setItem('dxv:theme', 'dark');
			}, loc);

			// `?pdf=1` forces the baseline manual — experimental (Labs-gated) sections and
			// controls are omitted from the printed PDF regardless of the demo account's
			// Labs flag (see help/+page.svelte → visibleSections).
			await page.goto('/help?pdf=1');
			// Every core demo image must be fetched + decoded before we render to PDF or
			// the printed pages would show empty image boxes. The baseline manual has ~109
			// demos; the floor guards against printing a half-rendered / wrong page.
			await page.waitForFunction(
				() => {
					const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.demo-shot'));
					if (imgs.length < 80) return false;
					return imgs.every((img) => img.complete && img.naturalWidth > 0);
				},
				undefined,
				{ timeout: 120_000 }
			);
			// The (app) layout wraps everything in `h-screen overflow-hidden` so the main
			// content is scroll-internal; if we don't undo that, page.pdf() captures only
			// the first viewport height of content. Inject overrides to expose the full
			// scrollable content + hide the sidebar (no value in a multi-page PDF).
			await page.addStyleTag({
				content: `
					html, body { height: auto !important; overflow: visible !important; }
					.flex.h-screen { height: auto !important; overflow: visible !important; }
					main { height: auto !important; max-height: none !important; overflow: visible !important; }
					aside[data-testid="sidebar"] { display: none !important; }
					header { display: none !important; }
					.toc { page-break-after: always; }
					section.section { page-break-inside: avoid; break-inside: avoid; }
					.demo { page-break-inside: avoid; break-inside: avoid; }
				`
			});
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(1200);

			// Keep the on-screen rendering for PDF (we don't have @media print rules
			// tuned for the manual; the dark page reads fine on paper too).
			await page.emulateMedia({ media: 'screen' });

			await page.pdf({
				path: `${OUT}/dx-viewer-manual-${loc}.pdf`,
				format: 'A4',
				printBackground: true,
				margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
				// Scaled down so each row of demo cards fits comfortably across A4 width.
				scale: 0.7
			});
		});
	}
});
