<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Wordmark from '$components/brand/Wordmark.svelte';
	import { auth } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages';

	type NavId = 'dashboard' | 'viewer' | 'cases' | 'account' | 'settings';
	type NavItem = {
		id: NavId;
		href: string;
		label: () => string;
		icon: 'dashboard' | 'scan' | 'cases' | 'user' | 'settings';
	};

	const PRIMARY: NavItem[] = [
		{ id: 'dashboard', href: '/', label: m.dx_nav_dashboard, icon: 'dashboard' },
		{ id: 'viewer', href: '/viewer', label: m.dx_nav_analysis, icon: 'scan' },
		{ id: 'cases', href: '/history', label: m.dx_nav_cases, icon: 'cases' }
	];
	const SECONDARY: NavItem[] = [
		{ id: 'account', href: '/account', label: m.dx_nav_account, icon: 'user' },
		{ id: 'settings', href: '/settings', label: m.dx_nav_settings, icon: 'settings' }
	];

	let { isMobile = false }: { isMobile?: boolean } = $props();
	let collapsed = $state(false);
	let mobileOpen = $state(false);

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(href + '/');
	}

	function signOut() {
		mobileOpen = false;
		auth.signOut();
		goto('/login');
	}

	const userInitials = $derived.by(() => {
		const name = auth.user?.name ?? auth.user?.email ?? '';
		const parts = name.split(/[\s@]+/).filter(Boolean);
		if (parts.length === 0) return '·';
		if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
		return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
	});
</script>

{#snippet icon(name: NavItem['icon'])}
	{#if name === 'dashboard'}
		<rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
	{:else if name === 'scan'}
		<path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3" />
	{:else if name === 'cases'}
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="15" y2="17" />
	{:else if name === 'user'}
		<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06A2 2 0 0 1 7 4.27l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
	{/if}
{/snippet}

{#snippet navLink(item: NavItem)}
	<a class="item" class:active={isActive(item.href)} class:collapsed href={item.href} onclick={() => (mobileOpen = false)} title={collapsed ? item.label() : undefined}>
		<span class="item-rail" aria-hidden="true"></span>
		<svg class="item-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
			{@render icon(item.icon)}
		</svg>
		{#if !collapsed}<span class="item-label">{item.label()}</span>{/if}
	</a>
{/snippet}

{#if isMobile}
	<!-- Top bar: hamburger + logo. Tap hamburger → drawer. -->
	<header class="topbar">
		<button class="topbar-trigger" type="button" onclick={() => (mobileOpen = true)} aria-label="Open navigation" aria-expanded={mobileOpen}>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="13" x2="20" y2="13" /><line x1="4" y1="19" x2="20" y2="19" />
			</svg>
		</button>
		<a href="/" class="topbar-logo" aria-label="BeCertain home">
			<Wordmark size="sm" variant="full" />
		</a>
		<div class="topbar-spacer"></div>
	</header>

	<!-- Drawer + backdrop -->
	{#if mobileOpen}
		<button
			class="backdrop"
			type="button"
			onclick={() => (mobileOpen = false)}
			aria-label="Close navigation"
		></button>
	{/if}
	<aside class="drawer" class:open={mobileOpen} aria-hidden={!mobileOpen} aria-label="Primary navigation">
		<header class="drawer-head">
			<Wordmark size="sm" variant="full" />
			<button type="button" class="drawer-close" onclick={() => (mobileOpen = false)} aria-label="Close navigation">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" />
				</svg>
			</button>
		</header>
		<nav class="nav primary" aria-label="Primary">
			{#each PRIMARY as item}{@render navLink(item)}{/each}
		</nav>
		<div class="nav-divider"></div>
		<nav class="nav secondary" aria-label="Account">
			{#each SECONDARY as item}{@render navLink(item)}{/each}
		</nav>
		<footer class="drawer-foot">
			<div class="user-card">
				<span class="avatar">{userInitials}</span>
				<div class="user-meta">
					<span class="user-name">{auth.user?.name ?? auth.user?.email ?? '—'}</span>
					{#if auth.user?.email && auth.user?.name}
						<span class="user-email">{auth.user.email}</span>
					{/if}
				</div>
			</div>
			<button class="signout" type="button" onclick={signOut}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
				</svg>
				{m.dx_account_sign_out()}
			</button>
		</footer>
	</aside>
{:else}
	<aside class="rail" class:collapsed aria-label="Primary navigation">
		<button
			type="button"
			class="rail-toggle"
			onclick={() => (collapsed = !collapsed)}
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			title={collapsed ? 'Expand' : 'Collapse'}
		>
			<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				{#if collapsed}<polyline points="9 6 15 12 9 18" />{:else}<polyline points="15 6 9 12 15 18" />{/if}
			</svg>
		</button>

		<a href="/" class="rail-logo" aria-label="BeCertain home">
			<Wordmark size="sm" variant={collapsed ? 'icon' : 'full'} />
		</a>

		<nav class="nav primary" aria-label="Primary">
			{#each PRIMARY as item}{@render navLink(item)}{/each}
		</nav>

		<div class="rail-foot">
			<div class="nav-divider"></div>
			<nav class="nav secondary" aria-label="Account">
				{#each SECONDARY as item}{@render navLink(item)}{/each}
			</nav>
			<div class="user-card" class:collapsed>
				<span class="avatar" title={auth.user?.email}>{userInitials}</span>
				{#if !collapsed}
					<div class="user-meta">
						<span class="user-name">{auth.user?.name ?? auth.user?.email ?? '—'}</span>
						{#if auth.user?.email && auth.user?.name}
							<span class="user-email">{auth.user.email}</span>
						{/if}
					</div>
					<button class="signout-icon" type="button" onclick={signOut} aria-label={m.dx_account_sign_out()}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
						</svg>
					</button>
				{/if}
			</div>
			{#if collapsed}
				<button class="signout-icon collapsed-signout" type="button" onclick={signOut} aria-label={m.dx_account_sign_out()} title={m.dx_account_sign_out()}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
					</svg>
				</button>
			{/if}
		</div>
	</aside>
{/if}

<style>
	/* ─── Desktop rail ──────────────────────────────────────────────────────── */
	.rail {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr auto;
		gap: 18px;
		width: 280px;
		height: 100vh;
		padding: 22px 14px 18px;
		background-color: var(--surface);
		transition: width 240ms cubic-bezier(0.2, 0.7, 0.2, 1);
		flex-shrink: 0;
		z-index: 20;
		box-sizing: border-box;
	}
	.rail.collapsed {
		width: 80px;
		padding: 22px 10px 18px;
	}
	.rail > * {
		min-width: 0;
		max-width: 100%;
	}
	.rail-toggle {
		position: absolute;
		top: 32px;
		right: -13px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background-color: var(--surface-2);
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: var(--muted-fg);
		z-index: 30;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
		transition: background-color 160ms, color 160ms, transform 100ms, border-color 160ms;
		padding: 0;
	}
	.rail-toggle:hover {
		background-color: var(--surface-3);
		color: var(--fg);
		border-color: var(--border-hover);
	}
	.rail-toggle:active {
		transform: translateY(1px);
	}
	.rail-toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.rail-logo {
		display: flex;
		align-items: center;
		padding: 6px 12px 14px;
		text-decoration: none;
		border-radius: 8px;
		transition: opacity 160ms;
	}
	.rail.collapsed .rail-logo {
		padding: 6px 0 14px;
		justify-content: center;
	}
	.rail-logo:hover {
		opacity: 0.85;
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.rail-foot {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.nav-divider {
		height: 1px;
		margin: 4px 8px;
		background-color: var(--border);
	}

	/* ─── Nav item ──────────────────────────────────────────────────────────── */
	.item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 14px;
		border-radius: 10px;
		color: var(--muted-fg);
		font-size: 14px;
		font-weight: 400;
		letter-spacing: -0.005em;
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		transition: color 200ms, background-color 200ms;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
	}
	.item.collapsed {
		justify-content: center;
		padding: 14px 0;
	}
	.item-rail {
		position: absolute;
		left: -14px;
		top: 50%;
		width: 2px;
		height: 0;
		background-color: var(--accent);
		border-radius: 0 2px 2px 0;
		transform: translateY(-50%);
		transition: height 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.item-icon {
		flex-shrink: 0;
		opacity: 0.8;
		transition: opacity 200ms, transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.item-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item:hover {
		color: var(--fg);
		background-color: var(--surface-2);
	}
	.item:active {
		transform: translateY(1px);
	}
	.item:hover .item-icon {
		opacity: 1;
	}
	.item:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.item.active {
		color: var(--fg);
		background-color: var(--accent-bg);
	}
	.item.active .item-icon {
		opacity: 1;
		color: var(--accent);
	}
	.item.active .item-rail {
		height: 18px;
	}

	/* ─── User card ─────────────────────────────────────────────────────────── */
	.user-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 6px;
		border-radius: 10px;
		min-width: 0;
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
		overflow: hidden;
	}
	.user-card.collapsed {
		justify-content: center;
		padding: 8px 0;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border-radius: 50%;
		background: linear-gradient(135deg, rgba(240, 199, 100, 0.25), rgba(240, 199, 100, 0.12));
		border: 1px solid rgba(240, 199, 100, 0.3);
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.04em;
		font-weight: 600;
	}
	.user-meta {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		line-height: 1.2;
	}
	.user-name {
		font-size: 13px;
		color: var(--fg);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.user-email {
		font-size: 11px;
		color: var(--muted-fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.signout-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		flex-shrink: 0;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--muted-fg);
		cursor: pointer;
		transition: color 160ms, background-color 160ms;
	}
	.signout-icon:hover {
		color: var(--destructive);
		background-color: rgba(232, 75, 58, 0.08);
	}
	.signout-icon:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.collapsed-signout {
		align-self: center;
		margin-top: 4px;
	}

	/* ─── Mobile topbar + drawer ────────────────────────────────────────────── */
	.topbar {
		position: sticky;
		top: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 16px;
		background-color: rgba(15, 28, 38, 0.85);
		backdrop-filter: blur(16px) saturate(150%);
		-webkit-backdrop-filter: blur(16px) saturate(150%);
		border-bottom: 1px solid var(--border);
		height: 60px;
		z-index: 40;
	}
	.topbar-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 8px;
		background-color: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--fg);
		cursor: pointer;
		transition: background-color 160ms, transform 100ms;
	}
	.topbar-trigger:hover {
		background-color: var(--surface-3);
	}
	.topbar-trigger:active {
		transform: translateY(1px);
	}
	.topbar-trigger:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.topbar-logo {
		display: flex;
		align-items: center;
		text-decoration: none;
	}
	.topbar-spacer {
		width: 38px;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		background-color: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(2px);
		border: none;
		padding: 0;
		cursor: pointer;
		z-index: 50;
		animation: fade 200ms ease both;
	}

	.drawer {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		display: grid;
		grid-template-rows: auto auto auto 1fr auto;
		width: min(86vw, 320px);
		padding: 20px;
		gap: 14px;
		background-color: var(--surface);
		border-right: 1px solid var(--border);
		z-index: 51;
		transform: translateX(-100%);
		transition: transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1);
		box-shadow: 24px 0 60px rgba(0, 0, 0, 0.4);
	}
	.drawer.open {
		transform: translateX(0);
	}
	.drawer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 4px 14px;
		border-bottom: 1px solid var(--border);
	}
	.drawer-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		background: none;
		border: 1px solid var(--border);
		color: var(--muted-fg);
		cursor: pointer;
		transition: color 160ms, background-color 160ms;
	}
	.drawer-close:hover {
		color: var(--fg);
		background-color: var(--surface-2);
	}
	.drawer-foot {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}
	.signout {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		background: none;
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--muted-fg);
		font-family: inherit;
		font-size: 13px;
		cursor: pointer;
		transition: color 160ms, background-color 160ms, border-color 160ms;
		align-self: flex-start;
	}
	.signout:hover {
		color: var(--destructive);
		border-color: rgba(232, 75, 58, 0.4);
		background-color: rgba(232, 75, 58, 0.06);
	}
	.signout:active {
		transform: translateY(1px);
	}

	@keyframes fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.rail,
		.drawer,
		.item-rail,
		.item-icon,
		.rail-toggle,
		.backdrop {
			transition: none;
			animation: none;
		}
	}
</style>
