import { defineConfig, devices } from '@playwright/test';

// E2E strategy: real browser against a LOCAL preview build of the current code,
// which talks to the PROD PocketBase + AI backend (the FE hardcodes
// pbapi.becertain.ai). So these tests catch regressions in uncommitted code
// before deploy, while exercising the real backend/AI/data.
//
// Override the target with E2E_BASE_URL (e.g. the live site) to skip the local
// build+preview server and point at an already-running deployment.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4173';
const useLocalServer = !process.env.E2E_BASE_URL;

// LOCAL-FIRST: the 3D / CBCT / IOS specs are reseeded from test_images into IndexedDB
// (e2e/seed.ts seedCbctStudy/seedIosStudy/seed*Raw + seedStateRow). The demo's ORIGINAL
// segmentations were recovered byte-identical from the pre-wipe snapshot (test_images/
// cbct-seg.zip = the 31-mesh CBCT seg, ios-seg.glb = the IOS seg), so the EXACT geometry —
// FDI layer labels, Upper/Lower arch groups, jaws/teeth/canals ordering, measure/selection
// hit-points — is reproduced faithfully. The per-study markup/sign-off/measure state now
// lives in IndexedDB (cbctReportState / iosState), so the persistence specs read it there.
//
// Only ONE remains deferred (genuinely not cheaply reproducible under local-first):
const LOCAL_FIRST_DEFERRED = [
	// Needs the full-resolution ~88 MB CBCT volume; base64-seeding that through the page
	// context (page.evaluate) is impractical/OOM-prone. It's a big-volume PERFORMANCE guard,
	// not a correctness one — the parse/re-surface pipeline is unit-tested (voxelRemesh) and
	// manually verified against the live volume (BIG_CBCT_FINDINGS.md).
	'**/big-cbct.e2e.ts'
];

export default defineConfig({
	testDir: 'e2e',
	// One worker, no parallelism: we share ONE prod backend + ONE demo account +
	// a single (slow, rate-limited) AI service. Serializing keeps tests honest and
	// avoids hammering prod.
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	// 3D CBCT volume parse + segmentation render can take 15-25s; give tests room.
	timeout: 120_000,
	expect: { timeout: 20_000 },
	reporter: process.env.CI ? [['github'], ['list']] : [['list']],
	use: {
		baseURL,
		actionTimeout: 25_000,
		navigationTimeout: 45_000,
		// Pin the OS colour-scheme to dark so the suite is deterministic and matches
		// the audited baseline. Tests that need light set localStorage dxv:theme via
		// addInitScript (the app's no-FOUC script reads that before prefers-color-scheme).
		colorScheme: 'dark',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off'
	},
	...(useLocalServer
		? {
				webServer: {
					command: 'bun run build && bun run preview',
					url: baseURL,
					reuseExistingServer: true,
					timeout: 240_000
				}
			}
		: {}),
	projects: [
		// Logs in the demo account once and saves the session; every other project
		// reuses it via storageState (no per-test login).
		{ name: 'setup', testMatch: /auth\.setup\.ts/ },
		{
			name: 'chromium',
			testMatch: '**/*.e2e.ts',
			testIgnore: LOCAL_FIRST_DEFERRED,
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'e2e/.auth/state.json'
			}
		}
	]
});
