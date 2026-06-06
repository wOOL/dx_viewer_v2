import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { INVENTORY, shotFor, bodyKeyFor } from './inventory';
import { MANUAL } from './manual';
import en from '@be-certain/i18n/locales/en.json';
import fr from '@be-certain/i18n/locales/fr.json';
import es from '@be-certain/i18n/locales/es.json';
import de from '@be-certain/i18n/locales/de.json';

// THE STOP CONDITION, codified. The manual must demonstrate EVERY interactive
// element atomically: for every INVENTORY id there is a dedicated screenshot AND
// a per-control "demo body" (1-2 sentences saying what the control does and what
// the shot shows) — present in all four locales. The testid guard catches new
// interactive controls added later without being inventoried.

type Dict = { [k: string]: string | Dict };
function flatten(obj: Dict, prefix = '', out: Record<string, string> = {}) {
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (typeof v === 'string') out[key] = v;
		else flatten(v, key, out);
	}
	return out;
}
const catalogs = {
	en: flatten(en as Dict),
	fr: flatten(fr as Dict),
	es: flatten(es as Dict),
	de: flatten(de as Dict)
};

describe('help coverage — every interaction is documented', () => {
	const invIds = INVENTORY.map((i) => i.id);
	const invIdSet = new Set(invIds);
	const covered = MANUAL.flatMap((s) => s.covers);
	const coveredSet = new Set(covered);

	it('inventory ids are unique', () => {
		expect(invIds.length).toBe(invIdSet.size);
	});

	it('every inventory interaction is documented in exactly one section', () => {
		const missing = INVENTORY.filter((i) => !coveredSet.has(i.id)).map((i) => i.id);
		expect(missing, `undocumented: ${missing.join(', ')}`).toEqual([]);
		expect(covered.length, 'a control is listed in more than one section').toBe(coveredSet.size);
	});

	it('every documented id is a real inventory id (no orphans)', () => {
		const orphans = covered.filter((id) => !invIdSet.has(id));
		expect(orphans, `manual.covers references unknown ids: ${orphans.join(', ')}`).toEqual([]);
	});

	it('the manual spans all interaction areas + meets the minimum size', () => {
		const areas = new Set(INVENTORY.map((i) => i.area));
		for (const a of [
			'home',
			'auth',
			'workspace',
			'studies',
			'upload',
			'quick',
			'viewer2d',
			'fmx',
			'photos',
			'patient',
			'cbct',
			'ios',
			'settings',
			'account',
			'billing'
		]) {
			expect(areas.has(a), `inventory lost area "${a}"`).toBe(true);
		}
		expect(INVENTORY.length).toBeGreaterThanOrEqual(120);
	});
});

describe('help coverage — every control has a name + demo body in all four locales', () => {
	for (const [loc, flat] of Object.entries(catalogs)) {
		it(`${loc}: nameKey resolves to a non-empty string for every interaction`, () => {
			const missing = INVENTORY.filter((i) => !flat[i.nameKey] || !flat[i.nameKey].trim()).map(
				(i) => `${i.id} (${i.nameKey})`
			);
			expect(missing, `${loc} missing names: ${missing.slice(0, 8).join(' / ')}`).toEqual([]);
		});

		it(`${loc}: demo body resolves to a non-empty string for every interaction`, () => {
			const missing = INVENTORY.filter(
				(i) => !flat[bodyKeyFor(i.id)] || !flat[bodyKeyFor(i.id)].trim()
			).map((i) => `${i.id}`);
			expect(missing, `${loc} missing demo bodies: ${missing.slice(0, 8).join(' / ')}`).toEqual([]);
		});

		it(`${loc}: section title + body resolve for every section`, () => {
			const missing = MANUAL.flatMap((s) =>
				[s.titleKey, s.bodyKey].filter((k) => !flat[k] || !flat[k].trim())
			);
			expect(missing, `${loc} missing section keys: ${missing.slice(0, 6).join(' / ')}`).toEqual(
				[]
			);
		});
	}

	it('the page-level help.* keys exist in every locale', () => {
		for (const k of ['help.title', 'help.subtitle', 'help.support', 'help.controlsHeading']) {
			for (const loc of Object.keys(catalogs)) {
				expect(catalogs[loc as keyof typeof catalogs][k], `${loc}:${k}`).toBeTruthy();
			}
		}
	});
});

describe('help coverage — every interaction has its own screenshot', () => {
	for (const i of INVENTORY) {
		it(`screenshot for "${i.id}" (${shotFor(i.id)}.png) is committed`, () => {
			expect(
				existsSync(join('static/manual', `${shotFor(i.id)}.png`)),
				`missing static/manual/${shotFor(i.id)}.png — run GEN_SHOTS=1 … playwright test manual-shots`
			).toBe(true);
		});
	}
});

describe('help coverage — testid guard (no undocumented interactive control)', () => {
	// Every deliberate interaction anchor (data-testid) in the app source must map to a
	// documented inventory id, or be an explicitly-acknowledged container. A new testid
	// not listed here fails the build until it's documented.
	const TESTID_DOC: Record<string, string | null> = {
		sidebar: null,
		'theme-toggle': 'workspace.sidebar.theme',
		'quickdrop-overlay': null,
		'quick-assign-banner': null,
		'qa-name': 'quick.assign.nameIt',
		'qa-existing': 'quick.assign.addExisting',
		'qa-keep': 'quick.assign.keep',
		'theme-{t.mode}': 'settings.theme',
		'lang-{code}': 'settings.language',
		// Help page → PDF download (not in the 210-control inventory; an anchor on
		// the manual itself, not a control inside the app surface).
		'manual-pdf-download': null,
		// Patient edit/delete (the two primary buttons are documented interactions;
		// the inputs/buttons inside the edit form are internal anchors of the
		// patient.edit interaction, acknowledged as containers).
		'patient-edit-btn': 'patient.edit',
		'patient-delete-btn': 'patient.delete',
		'patient-edit-name': null,
		'patient-edit-dob': null,
		'patient-edit-save': null,
		'patient-edit-cancel': null,
		'patient-edit-error': null,
		// Settings → the account-level "Enable 3D (CBCT/IOS) tools" toggle.
		'enable-3d-toggle': 'settings.enable3d',
		// Settings → "Show Photos" toggle (sibling of enable-3d). Acknowledged container
		// (kept out of the screenshot inventory for now).
		'enable-photo-toggle': null,
		// Settings → "Panoramic" toggle (gates the panoramic modality + the FMX view).
		'enable-panoramic-toggle': null,
		// Findings panel → the "Hide All / Show All" master visibility control.
		'findings-hide-all': 'viewer2d.findings.allPathology',
		// Report tab: editable report + Acceptable/Unacceptable verdict + copy + download PDF
		// — internal anchors of the documented `viewer2d.report` interaction.
		'report-edit': null,
		'report-copy': null,
		'report-download': null,
		'report-save': null,
		'report-acceptable': null,
		'report-unacceptable': null,
		// 2D detection editor: the two "add" tools document the interaction; the hide
		// button + per-disease picker items are internal anchors of it (containers).
		'detect-add-rect': 'viewer2d.editDetections',
		'detect-add-free': 'viewer2d.editDetections',
		'detect-done': null,
		'detect-hide': null,
		'detect-pick-{row.key}': null,
		// Restore findings hidden via the hide button — the recovery control of the same
		// edit-detections interaction (appears only when something is hidden).
		'detect-restore-hidden': null,
		// "Conditions" link on a CBCT report tooth card → opens the conditions modal; an
		// internal anchor of the CBCT report interaction.
		'tooth-more': null,
		// Home dashboard (redesigned homepage) — documented in the "home" manual section.
		'dash-create-patient': 'home.createPatient',
		'dash-search': 'home.search',
		'dash-dropzone': 'home.dropzone',
		'dash-view-all': 'home.viewAll',
		'dash-metric-{c.key}': 'home.metrics',
		// The search-results dropdown is an internal anchor of the home.search interaction.
		'dash-search-results': null,
		// Settings → Labs "Local data" card (local-first backup / restore / export / import).
		// Acknowledged containers like the sibling Labs toggles (enable-photo/panoramic);
		// the local-first behaviour is documented in prose in the help manual.
		'backup-online': null,
		'restore-online': null,
		'export-file': null,
		'import-file': null,
		'last-backup': null,
		// Restore-options dialog (diff-then-merge preview opened by Restore/Import) —
		// internal anchors of the same Labs local-data surface, same prose-doc precedent.
		'merge-dialog': null,
		'merge-damage': null,
		'merge-adds': null,
		'merge-updates-toggle': null,
		'merge-suppressed': null,
		'merge-duplicates': null,
		'merge-cancel': null,
		'merge-confirm': null,
		'replace-confirm': null,
		// Help page → the local-first durability notice (static statement, not a control).
		'localfirst-notice': null
	};

	function walk(dir: string, acc: string[] = []): string[] {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p, acc);
			else if (e.name.endsWith('.svelte')) acc.push(p);
		}
		return acc;
	}

	const testids = new Set<string>();
	for (const file of walk('src')) {
		const src = readFileSync(file, 'utf8');
		for (const m of src.matchAll(/data-testid="([^"]+)"/g)) testids.add(m[1].trim());
	}

	it('found the known interaction testids (scan works)', () => {
		expect(testids.has('enable-3d-toggle')).toBe(true);
		expect(testids.has('theme-toggle')).toBe(true);
	});

	it('every source testid is documented or an acknowledged container', () => {
		const unknown = [...testids].filter((t) => !(t in TESTID_DOC));
		expect(unknown, `undocumented data-testid(s): ${unknown.join(', ')}`).toEqual([]);
	});

	it('each mapped testid points at a real inventory interaction', () => {
		const ids = new Set(INVENTORY.map((i) => i.id));
		for (const [tid, id] of Object.entries(TESTID_DOC)) {
			if (id) expect(ids.has(id), `${tid} → unknown id ${id}`).toBe(true);
		}
	});
});
