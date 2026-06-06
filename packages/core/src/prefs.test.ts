import { describe, it, expect } from 'vitest';
import { parseConfThreshold, DEFAULT_CONF_THRESHOLD } from './prefs';

// A NaN confidence threshold breaks the AI overlay (every `score >= NaN` is false →
// nothing drawn, counts read 0). Guard a corrupted/missing dxv:confThres.
describe('parseConfThreshold', () => {
	it('returns a valid stored value unchanged', () => {
		expect(parseConfThreshold('0.3')).toBe(0.3);
		expect(parseConfThreshold('0.5')).toBe(0.5);
		expect(parseConfThreshold('0.95')).toBe(0.95);
	});
	it('falls back to the default for missing / empty / non-numeric values', () => {
		expect(parseConfThreshold(null)).toBe(DEFAULT_CONF_THRESHOLD);
		expect(parseConfThreshold(undefined)).toBe(DEFAULT_CONF_THRESHOLD);
		expect(parseConfThreshold('')).toBe(DEFAULT_CONF_THRESHOLD);
		expect(parseConfThreshold('garbage')).toBe(DEFAULT_CONF_THRESHOLD);
		expect(Number.isFinite(parseConfThreshold('NaN'))).toBe(true);
	});
	it('clamps an out-of-range (corrupted) value to the slider bounds', () => {
		expect(parseConfThreshold('5')).toBe(0.95);
		expect(parseConfThreshold('-1')).toBe(0.05);
		expect(parseConfThreshold('100')).toBe(0.95);
	});
});
