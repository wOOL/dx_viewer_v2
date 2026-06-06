import { describe, it, expect, afterEach } from 'vitest';
import { focusTrap } from './focusTrap';

// Runs in the browser project (real Chromium) — jsdom/node has no real focus
// model, so this lives in a *.svelte.test.ts file. The action is plain TS but
// only meaningful against a live DOM.

const trash: HTMLElement[] = [];
function mount(html: string): HTMLElement {
	const wrap = document.createElement('div');
	wrap.innerHTML = html;
	const el = wrap.firstElementChild as HTMLElement;
	document.body.appendChild(el);
	trash.push(el);
	return el;
}
function tab(node: HTMLElement, shiftKey = false) {
	node.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
	);
}

afterEach(() => {
	for (const el of trash.splice(0)) el.remove();
});

describe('focusTrap action', () => {
	it('moves focus to the first focusable child on mount, restores the trigger on destroy', () => {
		const trigger = document.createElement('button');
		document.body.appendChild(trigger);
		trash.push(trigger);
		trigger.focus();
		expect(document.activeElement).toBe(trigger);

		const dialog = mount(
			'<div role="dialog"><button id="a">A</button><button id="b">B</button></div>'
		);
		const handle = focusTrap(dialog);
		expect((document.activeElement as HTMLElement).id).toBe('a');

		handle.destroy();
		expect(document.activeElement).toBe(trigger);
	});

	it('wraps Tab from the last element back to the first', () => {
		const dialog = mount(
			'<div role="dialog"><button id="a">A</button><button id="b">B</button></div>'
		);
		const handle = focusTrap(dialog);
		const b = dialog.querySelector('#b') as HTMLElement;
		b.focus();
		tab(dialog);
		expect((document.activeElement as HTMLElement).id).toBe('a');
		handle.destroy();
	});

	it('wraps Shift+Tab from the first element to the last', () => {
		const dialog = mount(
			'<div role="dialog"><button id="a">A</button><button id="b">B</button></div>'
		);
		const handle = focusTrap(dialog);
		const a = dialog.querySelector('#a') as HTMLElement;
		a.focus();
		tab(dialog, true);
		expect((document.activeElement as HTMLElement).id).toBe('b');
		handle.destroy();
	});

	it('pulls focus back inside when it has escaped the dialog', () => {
		const outside = document.createElement('button');
		document.body.appendChild(outside);
		trash.push(outside);
		const dialog = mount(
			'<div role="dialog"><button id="a">A</button><button id="b">B</button></div>'
		);
		const handle = focusTrap(dialog);
		outside.focus(); // simulate focus leaking out
		tab(dialog);
		expect((document.activeElement as HTMLElement).id).toBe('a');
		handle.destroy();
	});

	it('skips disabled / hidden controls when choosing the first focusable', () => {
		const dialog = mount(
			'<div role="dialog"><button disabled>nope</button><button id="real">Real</button></div>'
		);
		const handle = focusTrap(dialog);
		expect((document.activeElement as HTMLElement).id).toBe('real');
		handle.destroy();
	});

	it('focuses the container itself when there is nothing focusable inside', () => {
		const dialog = mount('<div role="dialog"><p>read-only text</p></div>');
		const handle = focusTrap(dialog);
		expect(document.activeElement).toBe(dialog);
		expect(dialog.getAttribute('tabindex')).toBe('-1');
		handle.destroy();
	});
});
