import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Logo from './Logo.svelte';

describe('Logo', () => {
	it('renders the official mark image (decorative) + brand text in the full variant', () => {
		const { container } = render(Logo, { showText: true });
		const img = container.querySelector('img.logo-mark') as HTMLImageElement | null;
		expect(img).not.toBeNull();
		// src is a Vite-resolved asset URL (content-hashed in prod), so match by name.
		expect(img?.getAttribute('src')).toMatch(/logo.*\.png/i); // the official BeCertain mark
		// Decorative — the wrapping link / adjacent text provides the accessible name.
		expect(img?.getAttribute('aria-hidden')).toBe('true');
		const text = container.textContent ?? '';
		expect(text).toContain('BeCertain');
		expect(text).toContain('Dx Viewer');
	});

	it('drops the brand text when collapsed (showText=false) but keeps the mark', () => {
		const { container } = render(Logo, { showText: false });
		expect(container.querySelector('img.logo-mark')).not.toBeNull();
		expect(container.textContent ?? '').not.toContain('BeCertain');
	});
});
