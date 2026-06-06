import { describe, it, expect } from 'vitest';
import { MANUAL, visibleSections } from './manual';
import { isExperimentalId, INVENTORY } from './inventory';

// The experimental (Labs-gated) sections, by id. Kept in sync implicitly: the test
// derives them from MANUAL so adding/removing an experimental section can't drift.
const EXPERIMENTAL_SECTION_IDS = MANUAL.filter((s) => s.experimental).map((s) => s.id);

describe('help manual — experimental gating', () => {
	it('flags the 3D / photos / FMX sections as experimental and nothing else', () => {
		expect(new Set(EXPERIMENTAL_SECTION_IDS)).toEqual(
			new Set([
				'fmxNavigator',
				'photos',
				'cbctNavigate',
				'cbct3d',
				'cbctPanoramic',
				'cbctReport',
				'readIos'
			])
		);
	});

	it('experimental sections live at the BOTTOM of MANUAL', () => {
		const firstExperimentalIdx = MANUAL.findIndex((s) => s.experimental);
		const lastCoreIdx = MANUAL.map((s) => !s.experimental).lastIndexOf(true);
		expect(firstExperimentalIdx).toBeGreaterThan(-1);
		// every section after the first experimental one is also experimental
		expect(MANUAL.slice(firstExperimentalIdx).every((s) => s.experimental)).toBe(true);
		expect(lastCoreIdx).toBeLessThan(firstExperimentalIdx);
	});

	it('marks the in-core experimental controls (upload modalities, photo/FMX/3D tabs, enable3d)', () => {
		for (const id of [
			'upload.modPanoramic',
			'upload.modCbct',
			'upload.modIos',
			'upload.modPhoto',
			'viewer2d.fmxToggle',
			'viewer2d.tabPhotos',
			'viewer2d.fullFmx',
			'patient.fmxToggle',
			'patient.tab3d',
			'patient.tabPhotos',
			'fmx.grid.slot',
			'settings.enable3d'
		]) {
			expect(isExperimentalId(id), `${id} should be experimental`).toBe(true);
		}
	});

	it('keeps baseline controls non-experimental (X-ray upload, X-ray tab, theme, billing)', () => {
		for (const id of [
			'upload.modXray',
			'viewer2d.tabXrays',
			'patient.tabXrays',
			'settings.theme',
			'billing.subscribe'
		]) {
			expect(isExperimentalId(id), `${id} should NOT be experimental`).toBe(false);
		}
	});
});

describe('help manual — visibleSections()', () => {
	const ids = (secs: ReturnType<typeof visibleSections>) => secs.map((s) => s.id);
	const allCovered = (secs: ReturnType<typeof visibleSections>) => secs.flatMap((s) => s.covers);

	it('Labs viewer (in-app) sees every section + every control', () => {
		const secs = visibleSections({ labs: true, pdf: false });
		expect(ids(secs)).toEqual(MANUAL.map((s) => s.id));
		// nothing filtered out
		expect(allCovered(secs).length).toBe(MANUAL.flatMap((s) => s.covers).length);
		expect(allCovered(secs)).toContain('cbct.back');
		expect(allCovered(secs)).toContain('settings.enable3d');
	});

	it('non-Labs viewer: experimental sections dropped + experimental controls filtered from core sections', () => {
		const secs = visibleSections({ labs: false, pdf: false });
		for (const expId of EXPERIMENTAL_SECTION_IDS) {
			expect(ids(secs)).not.toContain(expId);
		}
		const covered = allCovered(secs);
		expect(covered).not.toContain('upload.modCbct');
		expect(covered).not.toContain('settings.enable3d');
		expect(covered).not.toContain('viewer2d.tabPhotos');
		// baseline controls survive
		expect(covered).toContain('upload.modXray');
		expect(covered).toContain('settings.theme');
		expect(covered).toContain('viewer2d.tabXrays');
	});

	it('PDF mode omits experimental even for a Labs account (baseline manual only)', () => {
		const pdfLabs = visibleSections({ labs: true, pdf: true });
		const pdfNoLabs = visibleSections({ labs: false, pdf: true });
		// pdf:true ignores labs → identical output
		expect(ids(pdfLabs)).toEqual(ids(pdfNoLabs));
		for (const expId of EXPERIMENTAL_SECTION_IDS) {
			expect(ids(pdfLabs)).not.toContain(expId);
		}
		const covered = allCovered(pdfLabs);
		expect(covered.some((id) => isExperimentalId(id))).toBe(false);
	});

	it('never yields an empty section (all rendered sections have ≥1 demo)', () => {
		for (const mode of [
			{ labs: true, pdf: false },
			{ labs: false, pdf: false },
			{ labs: true, pdf: true }
		]) {
			for (const s of visibleSections(mode)) {
				expect(s.covers.length, `${s.id} empty in ${JSON.stringify(mode)}`).toBeGreaterThan(0);
			}
		}
	});

	it('every visible cover id is still a real inventory id', () => {
		const inv = new Set(INVENTORY.map((i) => i.id));
		for (const id of allCovered(visibleSections({ labs: true, pdf: false }))) {
			expect(inv.has(id), `unknown id ${id}`).toBe(true);
		}
	});
});
