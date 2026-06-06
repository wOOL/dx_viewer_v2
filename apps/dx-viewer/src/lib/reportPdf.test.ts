import { describe, it, expect } from 'vitest';
import { parseReportMarkdown } from './reportPdf';

describe('parseReportMarkdown', () => {
	it('classifies headings, bullets and plain text', () => {
		const lines = parseReportMarkdown(
			['### Caries', '- Outer Enamel Caries (30)', 'Some note'].join('\n'),
			''
		);
		expect(lines.map((l) => l.kind)).toEqual(['h', 'bullet', 'text']);
		expect(lines[0]).toMatchObject({ kind: 'h', text: 'Caries' });
		expect(lines[1]).toMatchObject({ kind: 'bullet', text: 'Outer Enamel Caries (30)' });
	});

	it('reflects the Acceptable/Unacceptable verdict on the checkbox lines', () => {
		const md = ['- [ ] Acceptable', '- [ ] Unacceptable'].join('\n');
		const accepted = parseReportMarkdown(md, 'acceptable');
		expect(accepted[0]).toMatchObject({ kind: 'check', text: 'Acceptable', checked: true });
		expect(accepted[1]).toMatchObject({ kind: 'check', text: 'Unacceptable', checked: false });

		const rejected = parseReportMarkdown(md, 'unacceptable');
		expect(rejected[0]).toMatchObject({ checked: false });
		expect(rejected[1]).toMatchObject({ checked: true });

		const none = parseReportMarkdown(md, '');
		expect(none[0]).toMatchObject({ checked: false });
		expect(none[1]).toMatchObject({ checked: false });
	});

	it('strips inline markdown emphasis', () => {
		const [line] = parseReportMarkdown('- **Bold** and *italic* note', '');
		expect(line.text).toBe('Bold and italic note');
	});

	it('preserves blank lines as spacing', () => {
		const lines = parseReportMarkdown('a\n\nb', '');
		expect(lines.map((l) => l.kind)).toEqual(['text', 'blank', 'text']);
	});
});
