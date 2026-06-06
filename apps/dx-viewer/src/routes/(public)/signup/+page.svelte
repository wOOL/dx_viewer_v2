<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
	import { Mail, Lock, User as UserIcon } from 'lucide-svelte';
	import {
		isAcceptablePassword,
		validateProfile,
		isValidEmail,
		authErrorMessage
	} from '$lib/forms';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let acceptTerms = $state(false);

	async function submit(e: Event) {
		e.preventDefault();
		error = '';
		// Require a real (non-whitespace) name — a blank name persists and renders
		// empty in the TopBar/Sidebar after onboarding.
		const nameCheck = validateProfile({ name });
		if (!nameCheck.valid) {
			error =
				nameCheck.reason === 'tooLong' ? $_('signup.errNameTooLong') : $_('signup.errNameRequired');
			return;
		}
		// A5: validate the email (trimmed, permissive) before the SDK call — only
		// native `type=email required` guarded it before.
		if (!isValidEmail(email)) {
			error = $_('login.errInvalidEmail');
			return;
		}
		// Trim before the length check so an all-whitespace password (8 spaces) is
		// rejected instead of slipping past a naive `.length < 8`.
		if (!isAcceptablePassword(password)) {
			error = $_('signup.errPasswordLen');
			return;
		}
		if (password !== confirm) {
			error = $_('signup.errPasswordMatch');
			return;
		}
		if (!acceptTerms) {
			error = $_('signup.errAcceptTerms');
			return;
		}
		try {
			await auth.signup(email.trim(), password, nameCheck.name);
			await auth.refreshSubscription();
			await goto(resolve('/(app)/billing?onboarding=1'), { replaceState: true });
		} catch (err) {
			// A1: prefer PB field errors (e.g. "email already in use") which have no
			// translation key; otherwise route the non-field path through the localized
			// status mapper instead of leaking the raw English `.message`.
			const m = authErrorMessage(err, { fields: true });
			error = 'key' in m ? $_(m.key) : m.text;
		}
	}
</script>

<div class="card">
	<div class="mb-8 flex flex-col items-center gap-3">
		<Logo size={52} showText={false} />
		<div class="text-center">
			<h1 class="text-2xl font-extrabold tracking-tight">{$_('signup.title')}</h1>
			<p class="mt-1 text-sm text-fg-2">{$_('signup.subtitle')}</p>
		</div>
	</div>

	<form onsubmit={submit} class="space-y-4">
		<div class="form-group">
			<label for="name" class="label">{$_('signup.fullName')}</label>
			<div class="input-wrap">
				<UserIcon size={16} class="input-icon" />
				<input
					id="name"
					required
					bind:value={name}
					placeholder={$_('signup.namePlaceholder')}
					class="input"
				/>
			</div>
		</div>

		<div class="form-group">
			<label for="email" class="label">{$_('signup.workEmail')}</label>
			<div class="input-wrap">
				<Mail size={16} class="input-icon" />
				<input
					id="email"
					type="email"
					required
					autocomplete="email"
					bind:value={email}
					class="input"
				/>
			</div>
		</div>

		<div class="form-group">
			<label for="password" class="label">{$_('login.password')}</label>
			<div class="input-wrap">
				<Lock size={16} class="input-icon" />
				<input
					id="password"
					type="password"
					required
					minlength="8"
					autocomplete="new-password"
					bind:value={password}
					class="input"
				/>
			</div>
		</div>

		<div class="form-group">
			<label for="confirm" class="label">{$_('signup.confirmPassword')}</label>
			<div class="input-wrap">
				<Lock size={16} class="input-icon" />
				<input
					id="confirm"
					type="password"
					required
					minlength="8"
					autocomplete="new-password"
					bind:value={confirm}
					class="input"
				/>
			</div>
		</div>

		<label class="flex items-start gap-2 text-xs text-fg-2">
			<input type="checkbox" bind:checked={acceptTerms} class="checkbox" />
			<span>
				{$_('signup.agreePre')}
				<a href={resolve('/(public)/terms')} class="text-primary hover:underline"
					>{$_('signup.terms')}</a
				>
				{$_('signup.and')}
				<a href={resolve('/(public)/privacy')} class="text-primary hover:underline"
					>{$_('signup.privacy')}</a
				>.
			</span>
		</label>

		{#if error}
			<div
				class="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
				role="alert"
			>
				{error}
			</div>
		{/if}

		<button type="submit" class="btn-primary w-full" disabled={auth.loading}>
			{#if auth.loading}<span class="spinner"></span>{:else}{$_('signup.submit')}{/if}
		</button>
	</form>

	<div class="mt-6 border-t border-border pt-4 text-center text-xs text-fg-2">
		{$_('signup.alreadyHave')}
		<a href={resolve('/(public)/login')} class="text-primary hover:underline"
			>{$_('login.signIn')}</a
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
	.checkbox {
		margin-top: 2px;
		accent-color: var(--color-primary);
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
