import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'dxv:theme';

function systemTheme(): Theme {
	if (!browser) return 'dark';
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

class ThemeStore {
	/** The applied theme written to <html data-theme>. */
	current = $state<Theme>('dark');
	/** The user's preference. 'system' = follow OS (no stored key). */
	mode = $state<ThemeMode>('system');

	constructor() {
		if (browser) {
			const saved = localStorage.getItem(STORAGE_KEY);
			this.mode = saved === 'light' || saved === 'dark' ? saved : 'system';
			this.current = this.resolve();
			this.apply();
			// Follow the OS scheme while the preference is 'system'.
			window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
				if (this.mode === 'system') {
					this.current = systemTheme();
					this.apply();
				}
			});
		}
	}

	private resolve(): Theme {
		return this.mode === 'system' ? systemTheme() : this.mode;
	}

	private apply() {
		if (browser) document.documentElement.dataset.theme = this.current;
	}

	setMode(mode: ThemeMode) {
		this.mode = mode;
		if (browser) {
			// Crash-safe (S2-#2): a private-mode / over-quota localStorage throw must not
			// break theme switching. The in-memory `mode` + applied <html data-theme> are
			// already set; only the persistence is best-effort.
			try {
				if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
				else localStorage.setItem(STORAGE_KEY, mode);
			} catch {
				/* localStorage unavailable — best effort. */
			}
		}
		this.current = this.resolve();
		this.apply();
	}

	/** Flip to the explicit opposite of whatever is currently shown. */
	toggle() {
		this.setMode(this.current === 'dark' ? 'light' : 'dark');
	}

	get isDark() {
		return this.current === 'dark';
	}
}

export const theme = new ThemeStore();
