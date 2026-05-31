<script lang="ts">
	import { goto } from '$app/navigation';
	import BezelButton from '$components/ui/BezelButton.svelte';
	import TextField from '$components/ui/TextField.svelte';
	import { auth } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages';

	let name = $state('');
	let email = $state('');
	let otpId = $state<string | null>(null);
	let code = $state('');
	let step = $state<'details' | 'verify'>('details');

	async function handleRegister() {
		otpId = await auth.register(email, name);
		if (otpId) step = 'verify';
	}

	async function handleVerify() {
		if (!otpId) return;
		const success = await auth.verifyOtp(otpId, code);
		if (success) goto('/');
	}

	function backToDetails() {
		step = 'details';
		otpId = null;
		code = '';
		auth.verifyHandler.reset();
	}
</script>

<div class="register">
	<header class="head">
		<h1 class="text-page-title">{step === 'verify' ? m.dx_auth_check_email_title() : m.dx_auth_register_title()}</h1>
		<p class="text-body tone-muted">
			{#if step === 'verify'}
				{m.auth_otp_sent_to({ email })}
			{:else}
				{m.dx_auth_register_sub()}
			{/if}
		</p>
	</header>

	{#if step === 'details'}
		<form
			class="form"
			onsubmit={(e) => {
				e.preventDefault();
				handleRegister();
			}}
		>
			<TextField
				label={m.auth_name_label()}
				type="text"
				placeholder={m.auth_name_placeholder()}
				autocomplete="name"
				required
				bind:value={name}
			/>
			<TextField
				label={m.auth_email_label()}
				type="email"
				placeholder={m.auth_email_placeholder()}
				autocomplete="email"
				inputmode="email"
				required
				bind:value={email}
				error={auth.registerHandler.error}
			/>
			<BezelButton type="submit" disabled={auth.registerHandler.isLoading || !email || !name}>
				{auth.registerHandler.isLoading ? m.auth_registering() : m.auth_register()}
			</BezelButton>
		</form>
	{:else}
		<form
			class="form"
			onsubmit={(e) => {
				e.preventDefault();
				handleVerify();
			}}
		>
			<TextField
				label={m.auth_otp_label()}
				type="text"
				placeholder={m.auth_otp_placeholder()}
				autocomplete="one-time-code"
				inputmode="numeric"
				required
				hint={m.dx_auth_otp_hint()}
				bind:value={code}
				error={auth.verifyHandler.error}
			/>
			<div class="actions">
				<BezelButton variant="ghost" type="button" onclick={backToDetails}>
					{m.dx_auth_back()}
				</BezelButton>
				<BezelButton type="submit" disabled={auth.verifyHandler.isLoading || !code}>
					{auth.verifyHandler.isLoading ? m.auth_verifying() : m.auth_verify()}
				</BezelButton>
			</div>
		</form>
	{/if}

	<div class="alt">
		<span>{m.auth_has_account()}</span>
		<a href="/login">{m.auth_login()}</a>
	</div>
</div>

<style>
	.register {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.head h1 {
		margin: 0;
	}
	.head p {
		margin: 0;
		max-width: 38ch;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.form :global(button[type='submit']) {
		padding: 14px 18px;
		font-size: 14px;
		letter-spacing: 0.005em;
		margin-top: 4px;
	}
	.actions {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
	}
	.alt {
		display: flex;
		justify-content: center;
		gap: 6px;
		padding-top: 24px;
		border-top: 1px solid rgba(240, 199, 100, 0.12);
		font-size: 13px;
		color: var(--muted-fg);
	}
	.alt a {
		color: var(--accent);
		text-decoration: none;
		font-weight: 500;
		transition: opacity 150ms;
	}
	.alt a:hover {
		opacity: 0.8;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
