import { describe, it, expect } from 'vitest';
import { formatDecimal } from './number';

describe('formatDecimal', () => {
	it('uses the locale decimal mark with a fixed fraction count', () => {
		expect(formatDecimal(1.2, 'en-US')).toBe('1.20');
		expect(formatDecimal(1.2, 'fr-FR')).toBe('1,20');
		expect(formatDecimal(0.5, 'de-DE')).toBe('0,50');
		expect(formatDecimal(0.5, 'es-ES')).toBe('0,50');
	});

	it('respects a custom fraction-digit count', () => {
		expect(formatDecimal(2, 'en-US', 0)).toBe('2');
		expect(formatDecimal(1.5, 'en-US', 1)).toBe('1.5');
	});

	it('applies the locale grouping separator with zero fraction digits (px ruler)', () => {
		// The 2D X-ray ruler renders whole pixels but must still group thousands per
		// locale — "1,234 px" in en, "1.234 px" in de, a thin space in fr.
		expect(formatDecimal(1234, 'en-US', 0)).toBe('1,234');
		expect(formatDecimal(1234, 'de-DE', 0)).toBe('1.234');
		expect(formatDecimal(1234.7, 'en-US', 0)).toBe('1,235'); // rounds like toFixed(0)
	});

	it('pads to the fraction count even for integers', () => {
		expect(formatDecimal(1, 'en-US')).toBe('1.00');
	});

	it('returns a dash for non-finite input instead of "NaN"', () => {
		expect(formatDecimal(NaN, 'en-US')).toBe('—');
		expect(formatDecimal(Infinity, 'en-US')).toBe('—');
	});

	it('falls back to a plain fixed string when the locale is invalid', () => {
		// An invalid locale throws inside toLocaleString → non-localized fallback.
		expect(formatDecimal(1.2, 'not-a-locale')).toBe('1.20');
	});
});
