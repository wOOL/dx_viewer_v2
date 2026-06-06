import { browser } from '../env';
import { parseConfThreshold, DEFAULT_CONF_THRESHOLD } from '../prefs';

// Reactive, cross-tab-synced, crash-safe device preferences (a rune singleton,
// mirroring theme.svelte.ts / auth.svelte.ts). These three values used to be read
// ad-hoc from localStorage by every consumer (Settings, the viewers, toothDisplay,
// the tooth chart, …), which produced three confirmed bugs:
//
//  S2-#1  Settings wrote ALL three keys back on mount (a clobber), and there was no
//         cross-tab sync — changing a pref in one tab never reached another tab.
//  S2-#2  setItem on these core keys was unguarded → private-mode / quota throws
//         crashed the page.
//  S2-#3  toothNumbering was read NON-reactively (a plain localStorage.getItem at
//         component init), so an already-open CBCT/IOS view could show the same tooth
//         two different numbers after the preference changed.
//
// Centralising them in `$state` fixes all three: every reader becomes reactive, the
// single writer is each setter (crash-guarded), and one `storage` listener mirrors
// another tab's change into this tab's runes.

export type ToothNumbering = 'universal' | 'fdi';

const KEY_TOOTH = 'dxv:toothNumbering';
const KEY_CONF = 'dxv:confThres';

function readToothNumbering(): ToothNumbering {
	if (!browser) return 'universal';
	try {
		return localStorage.getItem(KEY_TOOTH) === 'fdi' ? 'fdi' : 'universal';
	} catch {
		return 'universal';
	}
}

/**
 * Crash-safe localStorage write for a device preference (browser-guarded; swallows
 * quota / SecurityError so private mode can't crash the page — mirrors the
 * history.svelte.ts best-effort idiom). Returns whether the write succeeded.
 */
export function safeSetPref(key: string, val: string): boolean {
	if (!browser) return false;
	try {
		localStorage.setItem(key, val);
		return true;
	} catch {
		// localStorage unavailable (private mode) / over quota — best effort.
		return false;
	}
}

// Exported so tests can construct a fresh instance (with a seeded localStorage) to
// exercise the hydration path; app code should use the `prefs` singleton below.
export class PrefsStore {
	/** Tooth-numbering system shown everywhere (data stays FDI-keyed). */
	toothNumbering = $state<ToothNumbering>('universal');
	/** AI confidence threshold (clamped + NaN-guarded via parseConfThreshold). */
	confThreshold = $state(DEFAULT_CONF_THRESHOLD);

	private storageHandler: ((e: StorageEvent) => void) | null = null;

	constructor() {
		if (browser) {
			// Hydrate from localStorage (each read is itself try/catch-guarded).
			this.toothNumbering = readToothNumbering();
			let confRaw: string | null;
			try {
				confRaw = localStorage.getItem(KEY_CONF);
			} catch {
				confRaw = null;
			}
			this.confThreshold = parseConfThreshold(confRaw);

			// One-time cleanup of dead device-pref keys: the 2D measurement feature and the
			// PHI-masking feature were both removed, so nothing reads dxv:measurementUnit /
			// dxv:phiOn anymore. (Crash-guarded — private mode / quota throws are ignored.)
			try {
				localStorage.removeItem('dxv:measurementUnit');
				localStorage.removeItem('dxv:phiOn');
			} catch {
				/* best effort */
			}

			// Cross-tab sync: a `storage` event fires in OTHER tabs when localStorage
			// changes, so another tab editing a pref (or clearing storage) updates this
			// tab's runes — keeping every open view consistent (mirrors auth.svelte.ts).
			this.storageHandler = (e: StorageEvent) => this.onStorage(e);
			window.addEventListener('storage', this.storageHandler);
		}
	}

	/**
	 * React to a cross-tab `storage` event. `e.key === null` means storage was
	 * cleared (storage.clear()) → reset every pref to its default. Otherwise update
	 * only the rune for the key that changed. Exposed (not private) so it's unit-
	 * testable without a real window event.
	 */
	onStorage(e: StorageEvent) {
		if (e.key === null) {
			// storage.clear() in another tab → fall back to defaults.
			this.toothNumbering = 'universal';
			this.confThreshold = DEFAULT_CONF_THRESHOLD;
			return;
		}
		if (e.key === KEY_TOOTH) {
			this.toothNumbering = e.newValue === 'fdi' ? 'fdi' : 'universal';
		} else if (e.key === KEY_CONF) {
			this.confThreshold = parseConfThreshold(e.newValue);
		}
	}

	setToothNumbering(v: ToothNumbering) {
		this.toothNumbering = v;
		safeSetPref(KEY_TOOTH, v);
	}

	setConfThreshold(v: number) {
		// Clamp + NaN-guard before BOTH the store and the persisted value so a stray
		// out-of-range / non-finite input can never poison the AI overlay.
		const clamped = parseConfThreshold(String(v));
		this.confThreshold = clamped;
		safeSetPref(KEY_CONF, String(clamped));
	}
}

export const prefs = new PrefsStore();

/**
 * Non-reactive snapshot of the current tooth-numbering preference, for plain-TS
 * callers that run OUTSIDE a reactive (markup / $derived) context and just need the
 * value once. Reactive consumers should read `prefs.toothNumbering` directly.
 */
export function currentToothNumbering(): ToothNumbering {
	return prefs.toothNumbering;
}
