import { describe, it, expect } from 'vitest';
import { safeNextPath } from './url';

const ORIGIN = 'https://dx.becertain.ai';
const FB = '/studies';

describe('safeNextPath (open-redirect guard)', () => {
	it('accepts a same-origin relative path (the legitimate case)', () => {
		expect(safeNextPath('/patients/abc', FB, ORIGIN)).toBe('/patients/abc');
		expect(safeNextPath('/viewer/p/s?tab=photos#z', FB, ORIGIN)).toBe('/viewer/p/s?tab=photos#z');
	});

	it('normalizes a same-origin ABSOLUTE url down to its path', () => {
		expect(safeNextPath('https://dx.becertain.ai/account', FB, ORIGIN)).toBe('/account');
	});

	it('falls back for empty / null / undefined', () => {
		expect(safeNextPath(null, FB, ORIGIN)).toBe(FB);
		expect(safeNextPath(undefined, FB, ORIGIN)).toBe(FB);
		expect(safeNextPath('', FB, ORIGIN)).toBe(FB);
	});

	it('rejects absolute off-origin URLs', () => {
		expect(safeNextPath('https://evil.com', FB, ORIGIN)).toBe(FB);
		expect(safeNextPath('https://evil.com/steal', FB, ORIGIN)).toBe(FB);
		// A look-alike suffix host must not pass.
		expect(safeNextPath('https://dx.becertain.ai.evil.com', FB, ORIGIN)).toBe(FB);
	});

	it('rejects protocol-relative and backslash-folded hosts', () => {
		expect(safeNextPath('//evil.com', FB, ORIGIN)).toBe(FB);
		expect(safeNextPath('/\\evil.com', FB, ORIGIN)).toBe(FB); // "/\evil.com" → "//evil.com"
		expect(safeNextPath('\\/evil.com', FB, ORIGIN)).toBe(FB);
	});

	it('rejects non-http(s) schemes', () => {
		expect(safeNextPath('javascript:alert(1)', FB, ORIGIN)).toBe(FB);
		expect(safeNextPath('data:text/html,<script>x</script>', FB, ORIGIN)).toBe(FB);
		expect(safeNextPath('mailto:a@b.com', FB, ORIGIN)).toBe(FB);
	});
});
