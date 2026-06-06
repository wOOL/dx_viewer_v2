// Library-safe `browser` (this package is consumed outside SvelteKit too).
const browser = typeof window !== 'undefined';
import { addMessages, init, locale as $locale } from 'svelte-i18n';
import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import de from './locales/de.json';

export const SUPPORTED = ['en', 'fr', 'es', 'de'] as const;
export type Locale = (typeof SUPPORTED)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
	en: 'English',
	fr: 'Français',
	es: 'Español',
	de: 'Deutsch'
};

const STORAGE_KEY = 'dxv:lang';

// Catalogs are bundled (small) so there's never a missing-key flash on switch.
addMessages('en', en);
addMessages('fr', fr);
addMessages('es', es);
addMessages('de', de);

function isSupported(v: string | null | undefined): v is Locale {
	return !!v && (SUPPORTED as readonly string[]).includes(v);
}

/** Saved choice → browser language (base, e.g. fr-CA→fr) → English. */
export function initialLocale(): Locale {
	if (!browser) return 'en';
	const saved = localStorage.getItem(STORAGE_KEY);
	if (isSupported(saved)) return saved;
	const navBase = (navigator.language || 'en').slice(0, 2).toLowerCase();
	return isSupported(navBase) ? navBase : 'en';
}

init({ fallbackLocale: 'en', initialLocale: initialLocale() });

/** Switch UI language, persist it, and reflect it on <html lang>. */
export function setLocale(loc: Locale) {
	$locale.set(loc);
	if (browser) {
		// Crash-safe (S2-#2): persisting the choice is best-effort (private mode / quota
		// can throw), but <html lang> MUST still update so the page reflects the switch
		// even when the write fails.
		try {
			localStorage.setItem(STORAGE_KEY, loc);
		} catch {
			/* localStorage unavailable — best effort. */
		}
		document.documentElement.lang = loc;
	}
}
