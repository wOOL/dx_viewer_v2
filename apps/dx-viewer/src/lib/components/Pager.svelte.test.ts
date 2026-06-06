import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Pager from './Pager.svelte';

const noop = () => {};

describe('Pager', () => {
	it('renders nothing for a single page (no clutter when there is nothing to page)', () => {
		const { container } = render(Pager, { page: 0, pageCount: 1, onpage: noop });
		expect(container.querySelector('nav')).toBeNull();
	});

	it('shows the page indicator + result count for multiple pages', () => {
		const { container } = render(Pager, { page: 1, pageCount: 3, total: 50, onpage: noop });
		const text = container.textContent ?? '';
		expect(text).toContain('Page 2 of 3');
		expect(text).toContain('50 results');
	});

	it('uses the singular result form via ICU plural', () => {
		const { container } = render(Pager, { page: 0, pageCount: 2, total: 1, onpage: noop });
		expect(container.textContent ?? '').toContain('1 result');
		expect(container.textContent ?? '').not.toContain('1 results');
	});

	it('disables Previous on the first page and Next on the last', () => {
		const first = render(Pager, { page: 0, pageCount: 3, onpage: noop });
		const fb = first.container.querySelectorAll('button');
		expect((fb[0] as HTMLButtonElement).disabled).toBe(true); // prev
		expect((fb[1] as HTMLButtonElement).disabled).toBe(false); // next

		const last = render(Pager, { page: 2, pageCount: 3, onpage: noop });
		const lb = last.container.querySelectorAll('button');
		expect((lb[0] as HTMLButtonElement).disabled).toBe(false); // prev
		expect((lb[1] as HTMLButtonElement).disabled).toBe(true); // next
	});

	it('calls onpage with the next / previous index on click', () => {
		const onpage = vi.fn();
		const { container } = render(Pager, { page: 1, pageCount: 3, onpage });
		const btns = container.querySelectorAll('button');
		(btns[1] as HTMLButtonElement).click(); // next → page 2
		(btns[0] as HTMLButtonElement).click(); // prev → page 0
		expect(onpage).toHaveBeenNthCalledWith(1, 2);
		expect(onpage).toHaveBeenNthCalledWith(2, 0);
	});
});
