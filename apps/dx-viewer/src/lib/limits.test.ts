import { describe, it, expect } from 'vitest';
import {
	capText,
	MAX_SEARCH_LENGTH,
	MAX_ANNOTATION_LENGTH,
	MAX_COMMENT_LENGTH,
	MAX_MOBILE_LENGTH,
	MAX_ADDRESS_LENGTH
} from './limits';

describe('capText', () => {
	it('trims surrounding whitespace', () => {
		expect(capText('  hi  ', 100)).toBe('hi');
	});

	it('hard-caps at the given max', () => {
		expect(capText('x'.repeat(5000), MAX_ANNOTATION_LENGTH)).toHaveLength(MAX_ANNOTATION_LENGTH);
		expect(capText('y'.repeat(5000), MAX_SEARCH_LENGTH)).toHaveLength(MAX_SEARCH_LENGTH);
		// CBCT report per-tooth comment: a paste can't bloat the cbct_report_state row.
		expect(capText('c'.repeat(50000), MAX_COMMENT_LENGTH)).toHaveLength(MAX_COMMENT_LENGTH);
		// Account contact fields (persisted on the user record).
		expect(capText('5'.repeat(5000), MAX_MOBILE_LENGTH)).toHaveLength(MAX_MOBILE_LENGTH);
		expect(capText('a'.repeat(5000), MAX_ADDRESS_LENGTH)).toHaveLength(MAX_ADDRESS_LENGTH);
	});

	it('trims before capping (leading spaces do not consume the budget)', () => {
		const v = '   ' + 'z'.repeat(MAX_ANNOTATION_LENGTH + 40);
		expect(capText(v, MAX_ANNOTATION_LENGTH)).toHaveLength(MAX_ANNOTATION_LENGTH);
		expect(capText(v, MAX_ANNOTATION_LENGTH).startsWith('z')).toBe(true);
	});

	it('handles null/undefined as empty', () => {
		expect(capText(undefined as unknown as string, 100)).toBe('');
		expect(capText(null as unknown as string, 100)).toBe('');
	});

	it('leaves a normal value unchanged', () => {
		expect(capText('distal caries', MAX_ANNOTATION_LENGTH)).toBe('distal caries');
	});
});
