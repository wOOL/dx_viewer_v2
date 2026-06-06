import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PremiumPlaceholder from './PremiumPlaceholder.svelte';

// The upsell CTA buttons used #1890ff with white text (3.24:1 — fails WCAG AA 4.5:1),
// and the a11y E2E never scanned the practice/insights/insurance pages that render
// this (#97). The Aurora redesign replaces every hardcoded CTA blue with the
// theme-aware semantic `bg-primary`/`text-on-primary` tokens (AA-tuned in both
// themes); axe scans the live pages in a11y.e2e.ts.
describe('PremiumPlaceholder (#97 a11y CTA contrast)', () => {
	it('CTA buttons use the semantic primary token, not hardcoded AA-failing blues', () => {
		const { container } = render(PremiumPlaceholder, {
			headline: 'Headline',
			footerHeadline: 'Footer headline'
		});
		const html = container.innerHTML;
		// No hardcoded blues remain (the old failing #1890ff/#40a9ff nor the interim #1668dc).
		expect(html).not.toContain('1890ff');
		expect(html).not.toContain('40a9ff');
		expect(html).not.toContain('1668dc');
		// The compliant, theme-aware token is used instead.
		expect(html).toContain('bg-primary');
		// The footer subtext no longer uses fg-3 (3.2:1 → fg-2, AA-clean).
		expect(html).not.toContain('text-fg-3');
		// The decorative mockup wrapper is `inert` → out of the a11y tree (its fake-data
		// low-contrast accents aren't real failures; screen readers skip fabricated data).
		expect(container.querySelector('[inert]')).not.toBeNull();
	});

	it('renders CTA links pointing at the in-app Help page (not the dead external link)', () => {
		const { container } = render(PremiumPlaceholder, {
			headline: 'H',
			footerHeadline: 'F'
		});
		const links = Array.from(container.querySelectorAll('a')) as HTMLAnchorElement[];
		expect(links.length).toBeGreaterThanOrEqual(2);
		// "Learn more" CTAs go to /help; none point at the old help.becertain.ai.
		expect(links.some((a) => a.getAttribute('href')?.includes('/help'))).toBe(true);
		expect(links.every((a) => !a.getAttribute('href')?.includes('help.becertain.ai'))).toBe(true);
	});
});
