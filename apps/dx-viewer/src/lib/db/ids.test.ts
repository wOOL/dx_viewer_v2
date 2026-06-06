import { describe, it, expect } from 'vitest';
import { genId, isValidId } from './ids';

describe('genId', () => {
	it('produces a 15-char [a-z0-9] id matching the PB auto-id pattern', () => {
		for (let i = 0; i < 200; i++) {
			const id = genId();
			expect(id).toMatch(/^[a-z0-9]{15}$/);
		}
	});

	it('is effectively unique across many calls', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 5000; i++) seen.add(genId());
		expect(seen.size).toBe(5000);
	});
});

describe('isValidId', () => {
	it('accepts a genId() output and rejects junk', () => {
		expect(isValidId(genId())).toBe(true);
		expect(isValidId('TOO-SHORT')).toBe(false);
		expect(isValidId('UPPERCASE000000')).toBe(false); // pattern is lowercase only
		expect(isValidId('abcdefghij012345')).toBe(false); // 16 chars
		expect(isValidId('')).toBe(false);
		expect(isValidId(42)).toBe(false);
		expect(isValidId(null)).toBe(false);
	});
});
