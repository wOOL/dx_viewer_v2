import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefs, PrefsStore, safeSetPref, currentToothNumbering } from './prefs.svelte';
import { DEFAULT_CONF_THRESHOLD } from '../prefs';

// Browser test (.svelte.test.ts → client project): `browser` is true, `localStorage`
// and `window` are real, and runes work. Covers the reactive/crash-safe/cross-tab
// preferences store: S2-#1 (single writer), S2-#2 (crash-safe writes), S2-#3 (the
// reactive tooth-numbering source the chart/overlays read).

const KEY_TOOTH = 'dxv:toothNumbering';
const KEY_CONF = 'dxv:confThres';

function storageEvent(key: string | null, newValue: string | null): StorageEvent {
	return new StorageEvent('storage', { key, newValue });
}

beforeEach(() => {
	localStorage.clear();
	// Reset the shared singleton's runes to defaults via its setters so each test
	// starts from a known state (the singleton was constructed at import time).
	prefs.setToothNumbering('universal');
	prefs.setConfThreshold(DEFAULT_CONF_THRESHOLD);
});

describe('safeSetPref (S2-#2 crash-safe writes)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('writes through to localStorage and returns true', () => {
		expect(safeSetPref('dxv:test', 'hello')).toBe(true);
		expect(localStorage.getItem('dxv:test')).toBe('hello');
	});

	it('swallows a throwing setItem (quota/SecurityError) and returns false', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('QuotaExceededError');
		});
		// Must NOT throw, and must report failure rather than crashing the caller.
		expect(() => safeSetPref('dxv:test', 'x')).not.toThrow();
		expect(safeSetPref('dxv:test', 'x')).toBe(false);
	});
});

describe('setters update the rune AND persist', () => {
	it('setToothNumbering', () => {
		prefs.setToothNumbering('fdi');
		expect(prefs.toothNumbering).toBe('fdi');
		expect(localStorage.getItem(KEY_TOOTH)).toBe('fdi');
		expect(currentToothNumbering()).toBe('fdi');
	});

	it('setConfThreshold clamps + persists the clamped value', () => {
		prefs.setConfThreshold(0.3);
		expect(prefs.confThreshold).toBe(0.3);
		expect(localStorage.getItem(KEY_CONF)).toBe('0.3');
		// Out-of-range high → clamped to the slider max (0.95).
		prefs.setConfThreshold(5);
		expect(prefs.confThreshold).toBe(0.95);
		expect(localStorage.getItem(KEY_CONF)).toBe('0.95');
		// NaN → falls back to the default (never poisons score >= threshold).
		prefs.setConfThreshold(NaN);
		expect(prefs.confThreshold).toBe(DEFAULT_CONF_THRESHOLD);
	});
});

describe('onStorage (cross-tab sync, S2-#1)', () => {
	it('updates toothNumbering when another tab writes the key', () => {
		prefs.onStorage(storageEvent(KEY_TOOTH, 'fdi'));
		expect(prefs.toothNumbering).toBe('fdi');
		prefs.onStorage(storageEvent(KEY_TOOTH, 'universal'));
		expect(prefs.toothNumbering).toBe('universal');
		// A cleared key (newValue null) → back to the Universal default.
		prefs.setToothNumbering('fdi');
		prefs.onStorage(storageEvent(KEY_TOOTH, null));
		expect(prefs.toothNumbering).toBe('universal');
	});

	it('updates confThreshold and guards a garbage value → default', () => {
		prefs.onStorage(storageEvent(KEY_CONF, '0.25'));
		expect(prefs.confThreshold).toBe(0.25);
		prefs.onStorage(storageEvent(KEY_CONF, 'not-a-number'));
		expect(prefs.confThreshold).toBe(DEFAULT_CONF_THRESHOLD);
	});

	it('ignores unrelated keys', () => {
		prefs.setToothNumbering('fdi');
		prefs.onStorage(storageEvent('dxv:theme', 'light'));
		expect(prefs.toothNumbering).toBe('fdi'); // untouched
	});

	it('resets every pref to defaults on storage.clear() (key === null)', () => {
		prefs.setToothNumbering('fdi');
		prefs.setConfThreshold(0.3);
		prefs.onStorage(storageEvent(null, null));
		expect(prefs.toothNumbering).toBe('universal');
		expect(prefs.confThreshold).toBe(DEFAULT_CONF_THRESHOLD);
	});
});

describe('hydration from localStorage (fresh instance)', () => {
	it('reflects stored toothNumbering / conf', () => {
		localStorage.setItem(KEY_TOOTH, 'fdi');
		localStorage.setItem(KEY_CONF, '0.35');
		const s = new PrefsStore();
		expect(s.toothNumbering).toBe('fdi');
		expect(s.confThreshold).toBe(0.35);
	});

	it('defaults when keys are absent', () => {
		const s = new PrefsStore();
		expect(s.toothNumbering).toBe('universal');
		expect(s.confThreshold).toBe(DEFAULT_CONF_THRESHOLD);
	});

	it('guards a garbage confThreshold on hydration', () => {
		localStorage.setItem(KEY_CONF, 'garbage');
		const s = new PrefsStore();
		expect(s.confThreshold).toBe(DEFAULT_CONF_THRESHOLD);
	});

	it('clears the dead dxv:measurementUnit + dxv:phiOn keys on construction', () => {
		localStorage.setItem('dxv:measurementUnit', 'mm');
		localStorage.setItem('dxv:phiOn', 'false');
		new PrefsStore();
		expect(localStorage.getItem('dxv:measurementUnit')).toBe(null);
		expect(localStorage.getItem('dxv:phiOn')).toBe(null);
	});
});
