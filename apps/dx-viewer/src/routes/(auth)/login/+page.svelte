<script lang="ts">
	import { goto } from '$app/navigation';
	import BezelButton from '$components/ui/BezelButton.svelte';
	import TextField from '$components/ui/TextField.svelte';
	import { auth } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages';

	let email = $state('');
	let otpId = $state<string | null>(null);
	let code = $state('');

	async function handleRequestOtp() {
		otpId = await auth.requestOtp(email);
	}

	async function handleVerify() {
		if (!otpId) return;
		const success = await auth.verifyOtp(otpId, code);
		if (success) goto('/');
	}

	function backToEmail() {
		otpId = null;
		code = '';
		auth.otpHandler.reset();
		auth.verifyHandler.reset();
	}
</script>

<div class="login">
	<header class="head">
		<h1 class="text-page-title">{otpId ? m.dx_auth_check_email_title() : m.dx_auth_signin_title()}</h1>
		<p class="text-body tone-muted">
			{#if otpId}
				{m.auth_otp_sent_to({ email })}
			{:else}
				{m.dx_auth_signin_sub()}
			{/if}
		</p>
	</header>

	{#if !otpId}
		<form
			class="form"
			onsubmit={(e) => {
				e.preventDefault();
				handleRequestOtp();
			}}
		>
			<TextField
				label={m.auth_email_label()}
				type="email"
				placeholder={m.auth_email_placeholder()}
				autocomplete="email"
				inputmode="email"
				required
				bind:value={email}
				error={auth.otpHandler.error}
			/>
			<BezelButton type="submit" disabled={auth.otpHandler.isLoading || !email}>
				{auth.otpHandler.isLoading ? m.auth_sending_otp() : m.auth_send_code()}
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
				<BezelButton variant="ghost" type="button" onclick={backToEmail}>
					{m.dx_auth_change_email()}
				</BezelButton>
				<BezelButton type="submit" disabled={auth.verifyHandler.isLoading || !code}>
					{auth.verifyHandler.isLoading ? m.auth_verifying() : m.auth_verify()}
				</BezelButton>
			</div>
		</form>
	{/if}

	<div class="alt">
		<span>{m.auth_no_account()}</span>
		<a href="/register">{m.auth_register_link()}</a>
	</div>
</div>

<style>
	.login {
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
