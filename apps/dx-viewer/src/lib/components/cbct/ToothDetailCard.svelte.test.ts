import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import ToothDetailCard from './ToothDetailCard.svelte';
import { MAX_COMMENT_LENGTH } from '$lib/limits';

describe('ToothDetailCard (component)', () => {
	// #94 — slice thumbnails must carry a localized, numbered alt (screen readers
	// otherwise heard the raw English literal "slice 1" in a non-English UI).
	it('gives each slice thumbnail a localized numbered alt', () => {
		const { container } = render(ToothDetailCard, {
			tooth: 11,
			thumbs: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']
		});
		const alts = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('alt'));
		expect(alts).toContain('Slice 1');
		expect(alts).toContain('Slice 2');
		// Not the old hardcoded lowercase literal.
		expect(alts).not.toContain('slice 1');
	});

	// The per-tooth comment persists to cbct_report_state — it must be length-capped so a
	// paste can't bloat the PB row / break the printout (sibling of the #0832a76 input caps).
	it('caps the comment textarea at MAX_COMMENT_LENGTH', async () => {
		const { container } = render(ToothDetailCard, { tooth: 11 });
		// Open the comment editor via the footer "Comment" action.
		const commentBtn = Array.from(container.querySelectorAll('button')).find((b) =>
			/comment/i.test(b.textContent ?? '')
		);
		expect(commentBtn, 'comment button not found').toBeTruthy();
		commentBtn!.click();
		await tick();
		const ta = container.querySelector('textarea');
		expect(ta, 'comment textarea did not open').toBeTruthy();
		expect(ta!.getAttribute('maxlength')).toBe(String(MAX_COMMENT_LENGTH));
	});
});
