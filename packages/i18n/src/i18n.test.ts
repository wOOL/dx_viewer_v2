import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import de from './locales/de.json';

// The four message catalogs must stay in lock-step: identical key sets, no empty
// strings, and the same ICU placeholders ({email}, {count}, …) per key — otherwise
// a surface silently renders the raw key or drops an interpolated value in some
// locale. This guards every future catalog edit.
type Dict = { [k: string]: string | Dict };

function flatten(obj: Dict, prefix = ''): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (typeof v === 'string') out[key] = v;
		else Object.assign(out, flatten(v, key));
	}
	return out;
}

/** Top-level ICU placeholder names in a message, e.g. {email} or {count, plural,…} → ["email","count"]. */
function placeholders(msg: string): string[] {
	return [...msg.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

const catalogs: Record<string, Record<string, string>> = {
	en: flatten(en as Dict),
	fr: flatten(fr as Dict),
	es: flatten(es as Dict),
	de: flatten(de as Dict)
};
const enKeys = Object.keys(catalogs.en).sort();

describe('i18n catalogs', () => {
	it('every locale has exactly the English key set (no missing/extra keys)', () => {
		for (const [name, dict] of Object.entries(catalogs)) {
			expect(Object.keys(dict).sort(), `${name} differs from en`).toEqual(enKeys);
		}
	});

	it('no empty translations', () => {
		for (const [name, dict] of Object.entries(catalogs)) {
			for (const [k, v] of Object.entries(dict)) {
				expect(v.trim().length, `${name}:${k} is empty`).toBeGreaterThan(0);
			}
		}
	});

	it('ICU placeholders match English for every key', () => {
		for (const key of enKeys) {
			const ref = placeholders(catalogs.en[key]);
			for (const name of ['fr', 'es', 'de']) {
				expect(placeholders(catalogs[name][key]), `${name}:${key} placeholders`).toEqual(ref);
			}
		}
	});

	// Catalog parity (above) doesn't catch a key the SOURCE asks for that doesn't
	// exist — svelte-i18n then renders the raw key string to the user. Scan every
	// static $_('literal') reference and assert it resolves. Dynamic keys built by
	// concatenation ($_('taxonomy.' + id), $_('cbct.cat_' + cat)) end in a '.'/'_'
	// separator and are skipped — they can't be checked statically.
	it('every static $_() key referenced in source exists in the catalog', () => {
		const known = new Set(enKeys);
		function walk(dir: string, acc: string[] = []): string[] {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, e.name);
				if (e.isDirectory()) walk(p, acc);
				else if (
					(e.name.endsWith('.svelte') || e.name.endsWith('.ts')) &&
					!e.name.endsWith('.test.ts')
				)
					acc.push(p);
			}
			return acc;
		}
		const missing = new Set<string>();
		const scanRoots = [
			// the consuming app's source (static $_() references live there) + this package
			fileURLToPath(new URL('../../../apps/dx-viewer/src', import.meta.url)),
			fileURLToPath(new URL('.', import.meta.url))
		];
		for (const root of scanRoots) for (const file of walk(root)) {
			const src = readFileSync(file, 'utf8');
			for (const m of src.matchAll(/\$_\(\s*['"]([\w.]+)['"]/g)) {
				const key = m[1];
				if (key.endsWith('.') || key.endsWith('_')) continue; // dynamic prefix
				if (!known.has(key)) missing.add(`${key}  (${file})`);
			}
		}
		expect([...missing]).toEqual([]);
	});
});
