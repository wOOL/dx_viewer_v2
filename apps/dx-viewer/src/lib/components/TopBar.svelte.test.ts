import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import TopBar from './TopBar.svelte';
import { history } from '$lib/stores/history.svelte';

describe('TopBar history popover (#95)', () => {
	it('opens the History menu, then closes it on Escape', async () => {
		const { container } = render(TopBar, { title: 'Studies' });
		const toggle = container.querySelector('.hist .icon-btn') as HTMLButtonElement;
		expect(toggle).not.toBeNull();

		toggle.click();
		await tick();
		expect(container.querySelector('[role="menu"]')).not.toBeNull();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await tick();
		expect(container.querySelector('[role="menu"]')).toBeNull();
	});

	it('ignores Escape when the menu is already closed (no error, stays closed)', async () => {
		const { container } = render(TopBar, { title: 'Studies' });
		expect(container.querySelector('[role="menu"]')).toBeNull();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await tick();
		expect(container.querySelector('[role="menu"]')).toBeNull();
	});
});

describe('TopBar recents menu (PHI removed → always shows the real name)', () => {
	beforeEach(() => history.clear());
	afterEach(() => history.clear());

	it('shows recent-study patient names', async () => {
		history.record({
			patientId: 'pat9999',
			studyId: 's1',
			patientName: 'Ryan Adamson',
			modality: 'xray',
			kind: 'viewer'
		});
		const { container } = render(TopBar, { title: 'Studies' });
		(container.querySelector('.hist .icon-btn') as HTMLButtonElement).click();
		await tick();
		const text = container.querySelector('[role="menu"]')?.textContent ?? '';
		expect(text).toContain('Ryan Adamson');
	});
});
