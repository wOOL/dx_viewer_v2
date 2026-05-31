import { browser } from '$app/environment';
import { logger } from '@be-certain/core/logger';
import type { InferenceMetaData } from '@be-certain/core/types';
import {
	availableLanguageTags,
	languageTag as currentLanguageTag,
	isAvailableLanguageTag,
	setLanguageTag
} from '$lib/paraglide/runtime';

const STORAGE_KEY = 'dx-preferences-v1';

export type LocaleTag = (typeof availableLanguageTags)[number];

export const SUPPORTED_LOCALES: ReadonlyArray<{ tag: LocaleTag; nativeName: string; englishName: string }> = [
	{ tag: 'en' as LocaleTag, nativeName: 'English', englishName: 'English' },
	{ tag: 'de' as LocaleTag, nativeName: 'Deutsch', englishName: 'German' }
];

interface PreferencesShape {
	locale: LocaleTag;
	fdiNumbering: boolean;
	diseaseThreshold: number;
	diseaseSegmentation: boolean;
	debugLogging: boolean;
	/** 3D viewer: enable FXAA post-process antialiasing on the main render window. */
	fxaaEnabled: boolean;
}

const DEFAULTS: PreferencesShape = {
	locale: 'en' as LocaleTag,
	fdiNumbering: false,
	diseaseThreshold: 0.1,
	diseaseSegmentation: true,
	debugLogging: false,
	fxaaEnabled: true
};

function loadFromStorage(): PreferencesShape {
	if (!browser) return DEFAULTS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULTS;
		const parsed = JSON.parse(raw) as Partial<PreferencesShape>;
		return {
			locale: isAvailableLanguageTag(parsed.locale) ? (parsed.locale as LocaleTag) : DEFAULTS.locale,
			fdiNumbering: typeof parsed.fdiNumbering === 'boolean' ? parsed.fdiNumbering : DEFAULTS.fdiNumbering,
			diseaseThreshold: clampThreshold(parsed.diseaseThreshold ?? DEFAULTS.diseaseThreshold),
			diseaseSegmentation: typeof parsed.diseaseSegmentation === 'boolean' ? parsed.diseaseSegmentation : DEFAULTS.diseaseSegmentation,
			debugLogging: typeof parsed.debugLogging === 'boolean' ? parsed.debugLogging : DEFAULTS.debugLogging,
			fxaaEnabled: typeof parsed.fxaaEnabled === 'boolean' ? parsed.fxaaEnabled : DEFAULTS.fxaaEnabled
		};
	} catch {
		return DEFAULTS;
	}
}

function clampThreshold(n: number): number {
	if (!Number.isFinite(n)) return DEFAULTS.diseaseThreshold;
	return Math.max(0, Math.min(0.9, n));
}

/**
 * User-level preferences. Persisted to localStorage; live preferences are
 * applied to the `paraglide` runtime + the shared logger as soon as they
 * change so the rest of the app sees them without further plumbing.
 */
class PreferencesStore {
	locale = $state<LocaleTag>(DEFAULTS.locale);
	fdiNumbering = $state(DEFAULTS.fdiNumbering);
	diseaseThreshold = $state(DEFAULTS.diseaseThreshold);
	diseaseSegmentation = $state(DEFAULTS.diseaseSegmentation);
	debugLogging = $state(DEFAULTS.debugLogging);
	fxaaEnabled = $state(DEFAULTS.fxaaEnabled);

	private hydrated = false;

	hydrate(): void {
		if (this.hydrated || !browser) {
			this.hydrated = true;
			return;
		}
		const stored = loadFromStorage();
		this.locale = stored.locale;
		this.fdiNumbering = stored.fdiNumbering;
		this.diseaseThreshold = stored.diseaseThreshold;
		this.diseaseSegmentation = stored.diseaseSegmentation;
		this.debugLogging = stored.debugLogging;
		this.fxaaEnabled = stored.fxaaEnabled;
		this.applyLocale();
		this.applyDebug();
		this.hydrated = true;
	}

	setFxaaEnabled(v: boolean): void {
		this.fxaaEnabled = v;
		this.persist();
	}

	setLocale(v: LocaleTag): void {
		if (!isAvailableLanguageTag(v)) return;
		this.locale = v;
		this.persist();
		this.applyLocale();
	}

	setFdiNumbering(v: boolean): void {
		this.fdiNumbering = v;
		this.persist();
	}

	setDiseaseThreshold(v: number): void {
		this.diseaseThreshold = clampThreshold(v);
		this.persist();
	}

	setDiseaseSegmentation(v: boolean): void {
		this.diseaseSegmentation = v;
		this.persist();
	}

	setDebugLogging(v: boolean): void {
		this.debugLogging = v;
		this.persist();
		this.applyDebug();
	}

	reset(): void {
		this.locale = DEFAULTS.locale;
		this.fdiNumbering = DEFAULTS.fdiNumbering;
		this.diseaseThreshold = DEFAULTS.diseaseThreshold;
		this.diseaseSegmentation = DEFAULTS.diseaseSegmentation;
		this.debugLogging = DEFAULTS.debugLogging;
		this.fxaaEnabled = DEFAULTS.fxaaEnabled;
		this.persist();
		this.applyLocale();
		this.applyDebug();
	}

	/**
	 * Build the `meta_data` overrides to send to `/api/ai/inference`.
	 * Only the user-tunable knobs are returned; everything else uses the
	 * spec's documented defaults.
	 */
	inferenceOverrides(): Partial<InferenceMetaData> {
		return {
			disease_segment: this.diseaseSegmentation,
			disease_meta_data: { conf_thres: this.diseaseThreshold },
			number_meta_data: { conf_thres: 0.1, fdi_number: this.fdiNumbering }
		};
	}

	private persist(): void {
		if (!browser) return;
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					locale: this.locale,
					fdiNumbering: this.fdiNumbering,
					diseaseThreshold: this.diseaseThreshold,
					diseaseSegmentation: this.diseaseSegmentation,
					debugLogging: this.debugLogging,
					fxaaEnabled: this.fxaaEnabled
				} satisfies PreferencesShape)
			);
		} catch {
			// Quota or disabled storage — ignore.
		}
	}

	private applyLocale(): void {
		if (browser && currentLanguageTag() !== this.locale) {
			setLanguageTag(this.locale);
		}
	}

	private applyDebug(): void {
		if (this.debugLogging) logger.enable('debug');
		else logger.disable();
	}
}

export const preferences = new PreferencesStore();
