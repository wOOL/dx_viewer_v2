<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { Mail } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
	import { isValidEmail, authErrorMessage } from '$lib/forms';

	let email = $state('');
	let sent = $state(false);
	let error = $state('');

	async function submit(e: Event) {
		e.preventDefault();
		error = '';
		// A5: validate the email (trimmed, permissive) before the SDK call.
		if (!isValidEmail(email)) {
			error = $_('login.errInvalidEmail');
			return;
		}
		try {
			await auth.requestPasswordReset(email.trim());
			sent = true;
		} catch (err) {
			// A1: route through the localized status mapper instead of leaking the raw
			// PocketBase English `.message` (its `.message` is always truthy).
			const m = authErrorMessage(err);
			error = 'key' in m ? $_(m.key) : m.text;
		}
	}
</script>

<div class="card">
	<div class="mb-8 flex flex-col items-center gap-3">
		<Logo size={52} showText={false} />
		<div class="text-center">
			<h1 class="text-2xl font-extrabold tracking-tight">{$_('forgot.title')}</h1>
			<p class="mt-1 text-sm text-fg-2">{$_('forgot.subtitle')}</p>
		</div>
	</div>

	{#if sent}
		<div class="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-fg-1">
			{$_('forgot.sent', { values: { email } })}
		</div>
	{:else}
		<form onsubmit={submit} class="space-y-4">
			<div class="input-wrap">
				<Mail size={16} class="input-icon" />
				<input
					type="email"
					required
					bind:value={email}
					placeholder={$_('login.emailPlaceholder')}
					aria-label={$_('login.email')}
					class="input"
				/>
			</div>
			{#if error}
				<div
					class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
					role="alert"
				>
					{error}
				</div>
			{/if}
			<button type="submit" class="btn-primary w-full" disabled={auth.loading}>
				{#if auth.loading}<span class="spinner"></span>{:else}{$_('forgot.submit')}{/if}
			</button>
		</form>
	{/if}

	<div class="mt-6 border-t border-border pt-4 text-center text-xs">
		<a href={resolve('/(public)/login')} class="text-primary hover:underline"
			>{$_('forgot.backToSignIn')}</a
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
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.btn-primary:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
</style>
