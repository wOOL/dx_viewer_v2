<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { _ } from 'svelte-i18n';
	import { Mail, Lock, KeyRound } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import { safeNextPath } from '$lib/url';
	import { authErrorMessage, isValidEmail } from '$lib/forms';

	type Mode = 'password' | 'otp_request' | 'otp_verify';

	let mode = $state<Mode>('password');
	let email = $state('');
	let password = $state('');
	let otpId = $state('');
	let code = $state('');
	let error = $state('');
	let countdown = $state(0);
	let countdownTimer: ReturnType<typeof setInterval> | undefined;
	// A2: an expired-session bounce appends `?reason=expired`; show an info banner.
	let info = $state(
		page.url.searchParams.get('reason') === 'expired' ? $_('login.sessionExpired') : ''
	);

	// A1: map a thrown auth error to a localized message. A PocketBase
	// ClientResponseError always has a truthy `.message` (raw English), so the old
	// `err.message ?? fallback` never reached the localized fallback.
	function authError(err: unknown): string {
		const m = authErrorMessage(err);
		return 'key' in m ? $_(m.key) : m.text;
	}

	// `next` comes from the query string so we can't pin it to a single route at
	// build time. Sanitize it to a SAME-ORIGIN path (safeNextPath) so a crafted
	// link like ?next=//evil.com can't open-redirect a just-logged-in user off-site;
	// anything off-origin falls back to the resolved /studies route.
	function nextUrl(): string {
		return safeNextPath(
			page.url.searchParams.get('next'),
			resolve('/(app)/studies'),
			page.url.origin
		);
	}

	async function submit(e: Event) {
		e.preventDefault();
		error = '';
		// A5: validate the email (trimmed, permissive) before the SDK call in the
		// modes that submit one. The OTP-verify step submits a code, not an email.
		if (mode !== 'otp_verify' && !isValidEmail(email)) {
			error = $_('login.errInvalidEmail');
			return;
		}
		// A3: block a sequential OTP request while a cooldown is still ticking, so
		// rapid "Send code" / "Resend" presses can't fire repeated OTP emails. The
		// existing auth.loading guard only covers a single in-flight double-click.
		if (mode === 'otp_request' && countdown > 0) return;
		try {
			if (mode === 'password') {
				await auth.loginWithPassword(email.trim(), password);
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- nextUrl() is sanitized to a same-origin path (safeNextPath); fallback is resolved
				await goto(nextUrl(), { replaceState: true });
			} else if (mode === 'otp_request') {
				otpId = await auth.requestOTP(email.trim());
				mode = 'otp_verify';
				startCountdown();
			} else {
				await auth.loginWithOTP(otpId, code.trim());
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- nextUrl() is sanitized to a same-origin path (safeNextPath); fallback is resolved
				await goto(nextUrl(), { replaceState: true });
			}
		} catch (err) {
			error = authError(err);
		}
	}

	function startCountdown() {
		countdown = 180;
		clearInterval(countdownTimer);
		countdownTimer = setInterval(() => {
			countdown -= 1;
			if (countdown <= 0) {
				clearInterval(countdownTimer);
				countdownTimer = undefined;
			}
		}, 1000);
	}

	// A2: drop the one-shot `reason=expired` flag from the URL after first paint so
	// a refresh / back-nav doesn't re-show the banner. Keeps other params intact.
	$effect(() => {
		if (page.url.searchParams.get('reason') === 'expired') {
			const url = new URL(page.url);
			url.searchParams.delete('reason');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- same-page state replace, no route resolution needed
			replaceState(url, {});
		}
	});

	// Without this, a user who requested an OTP then navigated away (back arrow,
	// clicked the demo nav, etc.) leaves an orphan setInterval ticking against a
	// destroyed component until the 180s timeout elapsed.
	onDestroy(() => {
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = undefined;
		}
	});

	function fmt(n: number) {
		const m = Math.floor(n / 60);
		const s = n % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}
</script>

<div class="card">
	<div class="mb-8 flex flex-col items-center gap-3">
		<Logo size={52} showText={false} />
		<div class="text-center">
			<h1 class="text-2xl font-extrabold tracking-tight">BeCertain</h1>
			<p class="mt-1 text-xs tracking-[0.22em] text-primary uppercase">Dx Viewer</p>
		</div>
	</div>

	{#if info}
		<div
			class="mb-4 rounded-lg border border-primary/30 bg-primary-tint px-3 py-2 text-sm text-fg-1"
			role="status"
		>
			{info}
		</div>
	{/if}

	<form onsubmit={submit} class="space-y-4">
		{#if mode !== 'otp_verify'}
			<div class="form-group">
				<label for="email" class="label">{$_('login.email')}</label>
				<div class="input-wrap">
					<Mail size={16} class="input-icon" />
					<input
						id="email"
						type="email"
						required
						autocomplete="email"
						bind:value={email}
						placeholder={$_('login.emailPlaceholder')}
						class="input"
					/>
				</div>
			</div>
		{/if}

		{#if mode === 'password'}
			<div class="form-group">
				<label for="password" class="label">{$_('login.password')}</label>
				<div class="input-wrap">
					<Lock size={16} class="input-icon" />
					<input
						id="password"
						type="password"
						required
						autocomplete="current-password"
						bind:value={password}
						placeholder="••••••••"
						class="input"
					/>
				</div>
			</div>
		{/if}

		{#if mode === 'otp_verify'}
			<div class="form-group">
				<label for="code" class="label">
					{$_('login.code')}
					<span class="text-[10px] text-fg-3">{$_('login.codeSentTo', { values: { email } })}</span>
				</label>
				<div class="input-wrap">
					<KeyRound size={16} class="input-icon" />
					<input
						id="code"
						type="text"
						inputmode="numeric"
						maxlength="6"
						pattern={String.raw`\d{6}`}
						required
						bind:value={code}
						placeholder="000000"
						class="input text-center font-mono text-base tracking-[0.4em]"
					/>
				</div>
				{#if countdown > 0}
					<div class="mt-2 text-xs text-fg-2">
						{$_('login.codeExpires', { values: { time: fmt(countdown) } })}
					</div>
				{:else}
					<button
						type="button"
						class="mt-2 text-xs text-primary hover:underline"
						onclick={() => (mode = 'otp_request')}
					>
						{$_('login.requestNewCode')}
					</button>
				{/if}
			</div>
		{/if}

		{#if error}
			<div
				class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
				role="alert"
			>
				{error}
			</div>
		{/if}

		<button
			type="submit"
			class="btn-primary w-full"
			disabled={auth.loading || (mode === 'otp_request' && countdown > 0)}
		>
			{#if auth.loading}
				<span class="spinner"></span>
			{:else if mode === 'password'}
				{$_('login.signIn')}
			{:else if mode === 'otp_request'}
				{$_('login.sendCode')}
			{:else}
				{$_('login.verifyAndSignIn')}
			{/if}
		</button>

		{#if mode === 'otp_request' && countdown > 0}
			<p class="text-center text-xs text-fg-2" role="status">
				{$_('login.resendIn', { values: { seconds: countdown } })}
			</p>
		{/if}

		<div class="flex items-center gap-3 text-xs text-fg-3">
			<div class="h-px flex-1 bg-border"></div>
			<span>{$_('login.or')}</span>
			<div class="h-px flex-1 bg-border"></div>
		</div>

		{#if mode === 'password'}
			<button type="button" class="btn-secondary w-full" onclick={() => (mode = 'otp_request')}>
				{$_('login.signInWithCode')}
			</button>
		{:else}
			<button type="button" class="btn-secondary w-full" onclick={() => (mode = 'password')}>
				{$_('login.usePassword')}
			</button>
		{/if}
	</form>

	<div class="mt-6 flex justify-between border-t border-border pt-4 text-xs">
		<a href={resolve('/(public)/signup')} class="text-fg-2 transition hover:text-primary"
			>{$_('login.createAccount')}</a
		>
		<a href={resolve('/(public)/forgot-password')} class="text-fg-2 transition hover:text-primary"
			>{$_('login.forgotPassword')}</a
		>
	</div>
</div>

<style>
	.card {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-pop);
		padding: 2rem;
	}
	.label {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-fg-2);
		margin-bottom: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.input-wrap {
		position: relative;
	}
	.input-wrap :global(.input-icon) {
		position: absolute;
		left: 14px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-fg-3);
		pointer-events: none;
	}
	.input {
		width: 100%;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.75rem 0.75rem 0.75rem 2.5rem;
		color: var(--color-fg-0);
		font-size: 0.9rem;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.input:focus {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px var(--color-primary-tint);
	}
	.btn-primary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
		font-size: 0.9rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-control);
		transition: background 0.15s;
		cursor: pointer;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.btn-primary:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
	.btn-secondary {
		width: 100%;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		font-weight: 500;
		font-size: 0.9rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}
	.btn-secondary:hover {
		border-color: var(--color-primary);
		color: var(--color-fg-0);
	}
</style>
