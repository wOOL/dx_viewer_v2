import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// #85 — the global stylesheet must respect the OS "reduce motion" setting.
// There is no JS-driven motion in the app (no Svelte transition: directives),
// so a single `prefers-reduced-motion: reduce` block that neutralises every
// CSS animation/transition is the complete fix. This guard keeps it from being
// silently dropped in a future refactor of layout.css.
describe('layout.css reduced-motion', () => {
	const css = readFileSync('src/routes/layout.css', 'utf8');

	it('declares a prefers-reduced-motion: reduce media query', () => {
		expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
	});

	it('neutralises animation + transition durations inside that block', () => {
		const block = css.slice(css.indexOf('prefers-reduced-motion'));
		// Universal selector so it also covers ::before/::after pseudo-elements.
		expect(block).toMatch(/\*,\s*\*::before,\s*\*::after/);
		expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
		expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
		// Infinite spinners must stop after one cycle, not keep looping.
		expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
	});
});
