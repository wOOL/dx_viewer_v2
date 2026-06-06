<script lang="ts">
	import Logo from './Logo.svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
	import {
		HelpCircle,
		LogOut,
		User,
		Settings,
		CreditCard,
		Sun,
		Moon,
		ChevronDown,
		Users
	} from 'lucide-svelte';

	// The clinical nav list was removed (only "Dx Viewer" was wired; Practice/
	// Insights/Insurance were upsell placeholders). The logo links home (/studies),
	// so the sidebar is now a utility rail: brand, Help, theme, and the user menu.
	function isActive(href: string) {
		return page.url.pathname.startsWith(href);
	}

	// The rail is ALWAYS collapsed (a slim icon strip) — it has only a few controls, so the
	// expand/collapse toggle was removed (clinician request). `collapsed` stays a constant so
	// the existing collapsed styling + icon-only rendering below continue to apply.
	const collapsed = true;

	let menuOpen = $state(false);

	function userInitials() {
		const name = auth.user?.name || auth.user?.email || '?';
		return (name[0] || '?').toUpperCase();
	}

	async function handleLogout() {
		// Await so logout's dynamic-import-driven cache wipe (studies.clearCache)
		// finishes before we navigate. Without the await, the goto fired before
		// the studies store cleared its in-memory patient list — a brief race
		// where a still-mounted (app) page could flash the prior clinician's
		// names mid-navigation (PHI).
		menuOpen = false;
		await auth.logout();
		goto(resolve('/(public)/login'), { replaceState: true });
	}
</script>

<aside class="sidebar" class:collapsed data-testid="sidebar">
	<div class="brand">
		<a href={resolve('/(app)/studies')} aria-label={$_('nav.home')} class="brand-link">
			<Logo size={30} showText={!collapsed} />
		</a>
	</div>

	<nav class="nav">
		<a
			href={resolve('/(app)/patients')}
			class="row"
			class:active={isActive(resolve('/(app)/patients'))}
			aria-current={isActive(resolve('/(app)/patients')) ? 'page' : undefined}
			aria-label={$_('nav.patients')}
			title={collapsed ? $_('nav.patients') : undefined}
		>
			<span class="row-icon"><Users size={19} /></span>
			{#if !collapsed}<span class="row-label">{$_('nav.patients')}</span>{/if}
		</a>
	</nav>

	<div class="footer">
		<a
			href={resolve('/(app)/help')}
			class="row"
			class:active={isActive(resolve('/(app)/help'))}
			aria-current={isActive(resolve('/(app)/help')) ? 'page' : undefined}
			aria-label={$_('nav.help')}
			title={collapsed ? $_('nav.help') : undefined}
		>
			<span class="row-icon"><HelpCircle size={19} /></span>
			{#if !collapsed}<span class="row-label">{$_('nav.help')}</span>{/if}
		</a>

		<button
			type="button"
			class="row w-full"
			onclick={() => theme.toggle()}
			data-testid="theme-toggle"
			title={collapsed ? $_('theme.toggle') : undefined}
			aria-label={theme.isDark ? $_('theme.switchToLight') : $_('theme.switchToDark')}
		>
			<span class="row-icon">
				{#if theme.isDark}<Sun size={19} />{:else}<Moon size={19} />{/if}
			</span>
			{#if !collapsed}<span class="row-label"
					>{theme.isDark ? $_('theme.light') : $_('theme.dark')}</span
				>{/if}
		</button>

		<div class="user-wrap">
			<button
				type="button"
				class="user-btn"
				class:active={menuOpen}
				onclick={() => (menuOpen = !menuOpen)}
				aria-label={$_('nav.userMenu')}
				aria-expanded={menuOpen}
			>
				<span class="avatar">{userInitials()}</span>
				{#if !collapsed}
					<span class="user-meta">
						<span class="user-name">{auth.user?.name || auth.user?.email}</span>
						<span class="user-email">{auth.user?.email}</span>
					</span>
					<ChevronDown size={15} class="chev" />
				{/if}
			</button>

			{#if menuOpen}
				<button
					type="button"
					class="menu-scrim"
					aria-label={$_('common.close')}
					onclick={() => (menuOpen = false)}
				></button>
				<div class="menu" role="menu">
					<a
						href={resolve('/(app)/account')}
						class="menu-item"
						role="menuitem"
						onclick={() => (menuOpen = false)}
					>
						<User size={16} />
						{$_('nav.account')}
					</a>
					<a
						href={resolve('/(app)/billing')}
						class="menu-item"
						role="menuitem"
						onclick={() => (menuOpen = false)}
					>
						<CreditCard size={16} />
						{$_('nav.billing')}
					</a>
					<a
						href={resolve('/(app)/settings')}
						class="menu-item"
						role="menuitem"
						onclick={() => (menuOpen = false)}
					>
						<Settings size={16} />
						{$_('nav.settings')}
					</a>
					<button type="button" class="menu-item" role="menuitem" onclick={handleLogout}>
						<LogOut size={16} />
						{$_('nav.logout')}
					</button>
				</div>
			{/if}
		</div>
	</div>
</aside>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		flex: none;
		width: 232px;
		height: 100vh;
		padding: 0.75rem;
		gap: 0.25rem;
		background: var(--color-bg-0);
		border-right: 1px solid var(--color-border);
		transition: width 0.18s var(--ease-out);
	}
	.sidebar.collapsed {
		width: 68px;
	}

	.brand {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
		padding: 0.4rem 0.35rem 0.75rem;
		min-height: 52px;
	}
	.collapsed .brand {
		flex-direction: column;
		gap: 0.5rem;
	}
	.brand-link {
		min-width: 0;
		border-radius: var(--radius-control);
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		height: 42px;
		padding: 0 0.65rem;
		border-radius: var(--radius-control);
		color: var(--color-fg-1);
		font-size: 0.9rem;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition:
			color 0.12s,
			background 0.12s;
	}
	.collapsed .row {
		justify-content: center;
		padding: 0;
	}
	.row:hover {
		background: var(--color-bg-2);
		color: var(--color-fg-0);
	}
	.row.active {
		background: var(--color-primary-tint);
		color: var(--color-primary);
		font-weight: 600;
	}
	.row.active::before {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		width: 3px;
		height: 20px;
		border-radius: 0 3px 3px 0;
		background: var(--color-primary);
	}
	.collapsed .row.active::before {
		display: none;
	}
	.row-icon {
		display: flex;
		flex: none;
	}
	.row-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.footer {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-top: 0.5rem;
	}

	.user-wrap {
		position: relative;
		margin-top: 0.35rem;
	}
	.user-btn {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.45rem;
		border-radius: var(--radius-control);
		border: 1px solid transparent;
		cursor: pointer;
		transition: background 0.12s;
	}
	.collapsed .user-btn {
		justify-content: center;
		padding: 0.4rem;
	}
	.user-btn:hover,
	.user-btn.active {
		background: var(--color-bg-2);
	}
	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 34px;
		width: 34px;
		flex: none;
		border-radius: 50%;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-size: 0.8rem;
		font-weight: 700;
	}
	.user-meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		text-align: left;
		line-height: 1.2;
	}
	.user-name {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-fg-0);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.user-email {
		font-size: 0.7rem;
		color: var(--color-fg-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.user-btn :global(.chev) {
		color: var(--color-fg-2);
		flex: none;
	}

	.menu-scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		cursor: default;
	}
	.menu {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		right: 0;
		z-index: 50;
		min-width: 200px;
		padding: 0.35rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		box-shadow: var(--shadow-pop);
	}
	.collapsed .menu {
		left: 0;
		right: auto;
		width: 200px;
	}
	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.55rem 0.6rem;
		border-radius: calc(var(--radius-control) - 2px);
		color: var(--color-fg-1);
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
	}
	.menu-item:hover {
		background: var(--color-bg-2);
		color: var(--color-fg-0);
	}
</style>
