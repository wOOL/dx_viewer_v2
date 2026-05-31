<script lang="ts">
	import { goto } from '$app/navigation';
	import BezelButton from '$components/ui/BezelButton.svelte';
	import StatusBadge from '$components/ui/StatusBadge.svelte';
	import TextField from '$components/ui/TextField.svelte';
	import { auth, subscription } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages';
	import { onMount } from 'svelte';

	// ─── Profile editing ─────────────────────────────────────────────────────
	let editingName = $state(false);
	let nameDraft = $state(auth.user?.name ?? '');
	let nameSaved = $state(false);

	function startEditName() {
		nameDraft = auth.user?.name ?? '';
		editingName = true;
		nameSaved = false;
		auth.profileHandler.reset();
	}

	async function saveName() {
		if (!nameDraft || nameDraft === auth.user?.name) {
			editingName = false;
			return;
		}
		const ok = await auth.updateProfile({ name: nameDraft });
		if (ok) {
			editingName = false;
			nameSaved = true;
			setTimeout(() => (nameSaved = false), 2500);
		}
	}

	// ─── Password reset ──────────────────────────────────────────────────────
	let resetSent = $state(false);

	async function sendPasswordReset() {
		const email = auth.user?.email;
		if (!email) return;
		const ok = await auth.requestPasswordReset(email);
		if (ok) {
			resetSent = true;
			setTimeout(() => (resetSent = false), 6000);
		}
	}

	// ─── Subscription cancellation ───────────────────────────────────────────
	let confirmingCancel = $state(false);
	async function confirmCancel() {
		const ok = await subscription.cancel();
		if (ok) confirmingCancel = false;
	}

	// ─── Sign out ────────────────────────────────────────────────────────────
	function handleSignOut() {
		auth.signOut();
		goto('/login');
	}

	// ─── Formatters ──────────────────────────────────────────────────────────
	const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
	function fmtDate(s?: string | null): string {
		if (!s) return '—';
		try {
			return dateFmt.format(new Date(s));
		} catch {
			return s;
		}
	}

	const statusTone = $derived.by(() => {
		const s = subscription.status;
		if (s === 'active' || s === 'trialing') return 'positive' as const;
		if (s === 'past_due' || s === 'unpaid') return 'critical' as const;
		if (s === 'canceled' || s === 'incomplete' || s === 'incomplete_expired') return 'warning' as const;
		return 'neutral' as const;
	});

	const statusLabel = $derived.by(() => {
		const s = subscription.status;
		if (!s) return m.dx_account_subscription_none();
		const labels: Record<string, string> = {
			active: 'Active',
			trialing: 'Trialing',
			past_due: 'Past due',
			unpaid: 'Unpaid',
			canceled: 'Canceled',
			incomplete: 'Incomplete',
			incomplete_expired: 'Expired',
			paused: 'Paused'
		};
		return labels[s] ?? s;
	});

	// ─── Scroll-spy TOC ──────────────────────────────────────────────────────
	const sections = [
		{ id: 'profile', label: m.dx_account_profile_title },
		{ id: 'subscription', label: m.dx_account_subscription_title },
		{ id: 'security', label: m.dx_account_security_title },
		{ id: 'legal', label: m.dx_account_legal_title }
	];
	let activeSection = $state('profile');

	onMount(() => {
		const headings = sections
			.map((s) => document.getElementById(s.id))
			.filter((el): el is HTMLElement => !!el);
		const io = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
				if (visible[0]) activeSection = visible[0].target.id;
			},
			{ rootMargin: '-25% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
		);
		headings.forEach((h) => io.observe(h));
		return () => io.disconnect();
	});

	function scrollTo(id: string) {
		const el = document.getElementById(id);
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<div class="page">
	<header class="page-head">
		<h1 class="text-display">{m.dx_account_title()}</h1>
		<p class="text-body tone-muted">{m.dx_account_tagline()}</p>
	</header>

	<div class="layout">
		<!-- Sticky table of contents — collapses on small viewports -->
		<aside class="toc" aria-label="Account sections">
			<nav>
				{#each sections as section}
					<button
						type="button"
						class="toc-link"
						class:active={activeSection === section.id}
						aria-current={activeSection === section.id ? 'true' : undefined}
						onclick={() => scrollTo(section.id)}
					>
						{section.label()}
					</button>
				{/each}
			</nav>
			<div class="toc-foot">
				<span class="signed-in-label">{m.dx_account_signed_in_as()}</span>
				<span class="signed-in-email" title={auth.user?.email}>{auth.user?.email ?? '—'}</span>
				<button class="signout-link" type="button" onclick={handleSignOut}>
					{m.dx_account_sign_out()}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
						<polyline points="16 17 21 12 16 7" />
						<line x1="21" y1="12" x2="9" y2="12" />
					</svg>
				</button>
			</div>
		</aside>

		<main class="sections">
			<!-- ─── Profile ────────────────────────────────────────────── -->
			<section id="profile" class="section">
				<div class="section-head">
					<h2 class="text-section-title">{m.dx_account_profile_title()}</h2>
					<p class="text-meta">{m.dx_account_profile_description()}</p>
				</div>
				<dl class="rows">
					<div class="row">
						<dt>{m.auth_name_label()}</dt>
						<dd>
							{#if editingName}
								<div class="inline-edit">
									<TextField
										label=""
										bind:value={nameDraft}
										placeholder={m.auth_name_placeholder()}
										autocomplete="name"
										error={auth.profileHandler.error}
									/>
									<div class="inline-actions">
										<BezelButton variant="ghost" type="button" onclick={() => (editingName = false)}>
											{m.dx_account_cancel()}
										</BezelButton>
										<BezelButton type="button" onclick={saveName} disabled={auth.profileHandler.isLoading}>
											{auth.profileHandler.isLoading ? m.dx_account_saving() : m.dx_account_save()}
										</BezelButton>
									</div>
								</div>
							{:else}
								<span class="value">{auth.user?.name ?? '—'}</span>
								<button type="button" class="row-action" onclick={startEditName}>{m.dx_account_edit()}</button>
							{/if}
						</dd>
					</div>
					<div class="row">
						<dt>{m.auth_email_label()}</dt>
						<dd>
							<span class="value">{auth.user?.email ?? '—'}</span>
							{#if auth.user?.verified}
								<span class="lock-hint" title={m.dx_account_email_locked()}>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M20 6 9 17l-5-5" />
									</svg>
									{m.dx_account_email_locked()}
								</span>
							{/if}
						</dd>
					</div>
					<div class="row">
						<dt>{m.dx_account_member_since()}</dt>
						<dd><span class="value mono">{fmtDate(auth.user?.created)}</span></dd>
					</div>
				</dl>
				{#if nameSaved}
					<div class="toast positive" role="status" aria-live="polite">{m.dx_account_profile_saved()}</div>
				{/if}
			</section>

			<!-- ─── Subscription ───────────────────────────────────────── -->
			<section id="subscription" class="section">
				<div class="section-head">
					<h2 class="text-section-title">{m.dx_account_subscription_title()}</h2>
					<p class="text-meta">{m.dx_account_subscription_description()}</p>
				</div>

				{#if subscription.stage === 'unknown'}
					<div class="skeleton" aria-busy="true" aria-label={m.dx_account_subscription_loading()}>
						<div class="skel skel-row"></div>
						<div class="skel skel-row"></div>
						<div class="skel skel-row short"></div>
					</div>
				{:else if subscription.stage === 'error'}
					<div class="toast critical" role="alert">
						{subscription.loadHandler.error}
						<button class="link" type="button" onclick={() => subscription.load()}>{m.dx_account_retry()}</button>
					</div>
				{:else if subscription.row}
					<dl class="rows">
						<div class="row">
							<dt>{m.dx_account_subscription_status()}</dt>
							<dd><StatusBadge tone={statusTone} label={statusLabel} /></dd>
						</div>
						{#if subscription.row.currentPeriodEnd}
							<div class="row">
								<dt>{subscription.cancelAtPeriodEnd ? m.dx_account_subscription_ends() : m.dx_account_subscription_renews()}</dt>
								<dd><span class="value mono">{fmtDate(subscription.row.currentPeriodEnd)}</span></dd>
							</div>
						{/if}
					</dl>
					{#if subscription.cancelAtPeriodEnd}
						<div class="toast warning" role="status">{m.paywall_cancel_at_period_end()}</div>
					{/if}
				{:else}
					<div class="empty">
						<p>{m.dx_account_subscription_none_long()}</p>
					</div>
				{/if}

				<div class="section-actions">
					{#if subscription.row && !subscription.cancelAtPeriodEnd && subscription.statusKind === 'active'}
						{#if confirmingCancel}
							<p class="confirm-text">{m.dx_account_cancel_confirm()}</p>
							<BezelButton variant="ghost" type="button" onclick={() => (confirmingCancel = false)}>
								{m.dx_account_keep_subscription()}
							</BezelButton>
							<BezelButton
								variant="destructive"
								type="button"
								onclick={confirmCancel}
								disabled={subscription.cancelHandler.isLoading}
							>
								{subscription.cancelHandler.isLoading ? m.dx_account_canceling() : m.dx_account_confirm_cancel()}
							</BezelButton>
						{:else}
							<BezelButton variant="ghost" type="button" onclick={() => goto('/billing')}>
								{m.dx_account_change_plan()}
							</BezelButton>
							<BezelButton variant="secondary" type="button" onclick={() => (confirmingCancel = true)}>
								{m.dx_account_cancel_subscription()}
							</BezelButton>
						{/if}
					{:else}
						<!-- Any non-active state (canceled, expired, past_due, unpaid, incomplete,
						     paused) or a scheduled cancel: offer a route back to /billing so the user
						     can re-subscribe. Previously this branch required `cancelAtPeriodEnd`, so a
						     fully-canceled row (cancelAtPeriodEnd=false, statusKind='inactive') matched
						     neither branch and rendered no button — a re-subscribe dead-end. -->
						<BezelButton type="button" onclick={() => goto('/billing')}>{m.dx_account_view_plans()}</BezelButton>
					{/if}
				</div>
			</section>

			<!-- ─── Security ───────────────────────────────────────────── -->
			<section id="security" class="section">
				<div class="section-head">
					<h2 class="text-section-title">{m.dx_account_security_title()}</h2>
					<p class="text-meta">{m.dx_account_security_description()}</p>
				</div>
				<dl class="rows">
					<div class="row">
						<dt>{m.dx_account_password_label()}</dt>
						<dd>
							<span class="value">{m.dx_account_password_reset_via_email()}</span>
						</dd>
					</div>
					<div class="row">
						<dt>{m.dx_account_mfa_label()}</dt>
						<dd>
							<span class="value subdued">{m.dx_account_mfa_unavailable()}</span>
						</dd>
					</div>
				</dl>
				{#if resetSent}
					<div class="toast positive" role="status" aria-live="polite">
						{m.dx_account_reset_sent({ email: auth.user?.email ?? '' })}
					</div>
				{/if}
				<div class="section-actions">
					<BezelButton
						variant="secondary"
						type="button"
						onclick={sendPasswordReset}
						disabled={auth.passwordResetHandler.isLoading || resetSent}
					>
						{auth.passwordResetHandler.isLoading
							? m.dx_account_sending()
							: resetSent
								? m.dx_account_reset_sent_short()
								: m.dx_account_send_reset()}
					</BezelButton>
				</div>
			</section>

			<!-- ─── Legal ──────────────────────────────────────────────── -->
			<section id="legal" class="section last">
				<div class="section-head">
					<h2 class="text-section-title">{m.dx_account_legal_title()}</h2>
					<p class="text-meta">{m.dx_account_legal_description()}</p>
				</div>
				<div class="rows">
					<a href="/privacy" class="row link-row">
						<span class="row-label">{m.dx_auth_footer_privacy()}</span>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<polyline points="9 18 15 12 9 6" />
						</svg>
					</a>
					<a href="/terms" class="row link-row">
						<span class="row-label">{m.dx_auth_footer_terms()}</span>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<polyline points="9 18 15 12 9 6" />
						</svg>
					</a>
				</div>
			</section>
		</main>
	</div>

	<!-- Mobile-only signout (TOC is hidden) -->
	<footer class="mobile-signout">
		<div>
			<span class="signed-in-label">{m.dx_account_signed_in_as()}</span>
			<span class="signed-in-email">{auth.user?.email ?? '—'}</span>
		</div>
		<BezelButton variant="ghost" type="button" onclick={handleSignOut}>
			{m.dx_account_sign_out()}
		</BezelButton>
	</footer>
</div>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 8px 0 96px;
		animation: pageRise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	/* ─── Page head ─────────────────────────────────────────────────────────── */
	.page-head {
		padding: 16px 0 36px;
	}
	.page-head h1 {
		margin: 0 0 8px;
	}
	.page-head p {
		margin: 0;
		max-width: 60ch;
	}

	/* ─── Layout ────────────────────────────────────────────────────────────── */
	.layout {
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 64px;
		align-items: start;
	}

	/* ─── TOC (sticky sidebar) ──────────────────────────────────────────────── */
	.toc {
		position: sticky;
		top: 8px;
		display: flex;
		flex-direction: column;
		gap: 32px;
		min-height: 0;
	}
	.toc nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.toc-link {
		position: relative;
		display: block;
		background: none;
		border: none;
		padding: 10px 16px;
		border-radius: 6px;
		color: var(--muted-fg);
		font-size: 14px;
		text-align: left;
		cursor: pointer;
		transition: color 160ms, background-color 160ms;
		font-family: inherit;
	}
	.toc-link::before {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		width: 2px;
		height: 0;
		background-color: var(--accent);
		border-radius: 0 2px 2px 0;
		transform: translateY(-50%);
		transition: height 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.toc-link:hover {
		color: var(--fg);
		background-color: rgba(255, 255, 255, 0.02);
	}
	.toc-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.toc-link.active {
		color: var(--fg);
		font-weight: 500;
	}
	.toc-link.active::before {
		height: 16px;
	}
	.toc-foot {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 16px 10px;
		border-top: 1px solid var(--border);
	}
	.signed-in-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.signed-in-email {
		font-size: 14px;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.signout-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		padding: 0;
		background: none;
		border: none;
		color: var(--muted-fg);
		font-family: inherit;
		font-size: 14px;
		cursor: pointer;
		align-self: flex-start;
		transition: color 160ms, transform 100ms;
	}
	.signout-link:hover {
		color: var(--accent);
	}
	.signout-link:active {
		transform: translateY(1px);
	}
	.signout-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 2px;
	}

	/* ─── Sections ──────────────────────────────────────────────────────────── */
	.sections {
		display: flex;
		flex-direction: column;
	}
	.section {
		padding: 44px 0 48px;
		border-top: 1px solid var(--border);
		scroll-margin-top: 32px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.section:first-child {
		border-top: none;
		padding-top: 4px;
	}
	.section.last {
		padding-bottom: 24px;
	}
	.section-head h2 {
		margin: 0 0 6px;
	}
	.section-head p {
		margin: 0;
		max-width: 60ch;
	}

	/* ─── Rows ──────────────────────────────────────────────────────────────── */
	.rows {
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: 180px 1fr;
		gap: 24px;
		padding: 16px 0;
		border-top: 1px solid rgba(240, 199, 100, 0.06);
		align-items: center;
	}
	.row:first-child {
		border-top: none;
	}
	dt, .row-label {
		margin: 0;
		font-size: 14px;
		color: var(--muted-fg);
	}
	dd {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		justify-content: space-between;
	}
	.value {
		font-size: 15px;
		color: var(--fg);
	}
	.value.mono {
		font-family: var(--font-mono);
		font-feature-settings: 'tnum' on, 'lnum' on;
		font-size: 14px;
		letter-spacing: 0.02em;
	}
	.value.subdued {
		color: var(--muted-fg);
	}
	.row-action {
		background: none;
		border: none;
		color: var(--accent);
		font-family: inherit;
		font-size: 14px;
		padding: 4px 0;
		cursor: pointer;
		transition: opacity 150ms, transform 100ms;
	}
	.row-action:hover {
		opacity: 0.8;
	}
	.row-action:active {
		transform: translateY(1px);
	}
	.row-action:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 2px;
	}
	.lock-hint {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--text-tertiary);
	}
	.lock-hint svg {
		opacity: 0.7;
	}
	/* ─── Inline edit ───────────────────────────────────────────────────────── */
	.inline-edit {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		max-width: 360px;
	}
	.inline-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	/* ─── Link rows (Legal) ─────────────────────────────────────────────────── */
	.link-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		grid-template-columns: none;
		text-decoration: none;
		color: var(--fg);
		font-size: 15px;
		transition: color 160ms;
	}
	.link-row svg {
		color: var(--muted-fg);
		transition: transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1), color 160ms;
	}
	.link-row:hover {
		color: var(--accent);
	}
	.link-row:hover svg {
		color: var(--accent);
		transform: translateX(3px);
	}
	.link-row:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 4px;
	}

	/* ─── Section action bar ────────────────────────────────────────────────── */
	.section-actions {
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	.confirm-text {
		margin: 0 auto 0 0;
		font-size: 13px;
		color: var(--accent);
	}

	/* ─── Toasts / inline alerts ────────────────────────────────────────────── */
	.toast {
		font-size: 14px;
		padding: 12px 16px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		gap: 12px;
		justify-content: space-between;
	}
	.toast.positive {
		background-color: rgba(93, 212, 201, 0.08);
		border: 1px solid rgba(93, 212, 201, 0.2);
		color: #b6e8e2;
	}
	.toast.warning {
		background-color: var(--accent-bg);
		border: 1px solid rgba(240, 199, 100, 0.2);
		color: var(--accent);
	}
	.toast.critical {
		background-color: rgba(232, 75, 58, 0.08);
		border: 1px solid rgba(232, 75, 58, 0.2);
		color: #f8a59a;
	}
	.link {
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	/* ─── Loading skeleton ──────────────────────────────────────────────────── */
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.skel {
		height: 18px;
		margin: 16px 0;
		border-radius: 4px;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.07) 50%, rgba(255, 255, 255, 0.03) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.6s linear infinite;
	}
	.skel-row {
		width: 100%;
	}
	.skel-row.short {
		width: 40%;
	}

	/* ─── Empty state ───────────────────────────────────────────────────────── */
	.empty {
		padding: 16px 0;
	}
	.empty p {
		margin: 0;
		font-size: 14px;
		color: var(--muted-fg);
		line-height: 1.55;
		max-width: 50ch;
	}

	/* ─── Mobile signout footer ─────────────────────────────────────────────── */
	.mobile-signout {
		display: none;
	}

	/* ─── Animations ────────────────────────────────────────────────────────── */
	@keyframes pageRise {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes shimmer {
		0% { background-position: 100% 0; }
		100% { background-position: -100% 0; }
	}

	/* ─── Responsive ────────────────────────────────────────────────────────── */
	@media (max-width: 920px) {
		.layout {
			grid-template-columns: 1fr;
			gap: 32px;
		}
		.toc {
			position: static;
			display: none;
		}
		.mobile-signout {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 16px;
			margin-top: 32px;
			padding: 24px 0 0;
			border-top: 1px solid var(--border);
		}
		.row {
			grid-template-columns: 1fr;
			gap: 6px;
		}
		dd {
			justify-content: flex-start;
		}
	}

	@media (max-width: 560px) {
		.page-head h1 {
			font-size: 26px;
		}
	}
</style>
