<script lang="ts">
	import * as m from '../lib/messages';
	import {
		type AvailableLanguageTag,
		availableLanguageTags,
		languageTag,
		setLanguageTag
	} from '../lib/messages';

	const languageLabels: Record<AvailableLanguageTag, string> = {
		en: 'English',
		de: 'Deutsch'
	};

	let currentLang = $state<AvailableLanguageTag>(languageTag() as AvailableLanguageTag);

	$effect(() => {
		chrome.storage.local.get('language', (result) => {
			const stored = result['language'] as string | undefined;
			if (stored && availableLanguageTags.includes(stored as AvailableLanguageTag)) {
				setLanguageTag(stored as AvailableLanguageTag);
				currentLang = stored as AvailableLanguageTag;
			}
		});
	});

	function handleLanguageChange(tag: AvailableLanguageTag) {
		setLanguageTag(tag);
		currentLang = tag;
		chrome.storage.local.set({ language: tag });
	}

	let authenticated = $state(false);
	let loading = $state(true);
	let tabError = $state<string | null>(null);
	let currentTabId = $state<number | undefined>(undefined);

	// Login state
	let email = $state('');
	let otpId = $state<string | null>(null);
	let code = $state('');
	let authLoading = $state(false);
	let authError = $state<string | null>(null);
	let sessionExpired = $state(false);

	function checkAuthStatus(retries = 3) {
		chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (response) => {
			if (chrome.runtime.lastError || response === undefined) {
				if (retries > 0) {
					setTimeout(() => checkAuthStatus(retries - 1), 250);
				} else {
					loading = false;
				}
				return;
			}
			authenticated = response.isAuthenticated ?? false;
			if (response.expired) sessionExpired = true;
			loading = false;

			// If authenticated and no error to show, close the popup
			if (authenticated && !tabError) {
				window.close();
			}
		});
	}

	// Check for tab errors on load
	$effect(() => {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const tabId = tabs[0]?.id;
			if (!tabId) return;
			currentTabId = tabId;
			chrome.runtime.sendMessage({ type: 'GET_TAB_ERROR', tabId }, (response) => {
				if (chrome.runtime.lastError) return;
				tabError = response?.error ?? null;
			});
		});
	});

	$effect(() => {
		checkAuthStatus();
	});

	function dismissError() {
		if (currentTabId) {
			chrome.runtime.sendMessage({ type: 'CLEAR_TAB_ERROR', tabId: currentTabId });
		}
		tabError = null;
		// If authenticated, close popup since there's nothing else to show
		if (authenticated) {
			window.close();
		}
	}

	function handleRequestOtp() {
		authLoading = true;
		authError = null;
		chrome.runtime.sendMessage({ type: 'REQUEST_OTP', email }, (response) => {
			authLoading = false;
			if (response?.success) {
				otpId = response.otpId;
			} else {
				authError = response?.error ?? m.auth_send_code_failed();
			}
		});
	}

	function handleVerify() {
		if (!otpId) return;
		authLoading = true;
		authError = null;
		chrome.runtime.sendMessage({ type: 'LOGIN', email, otpId, code }, (response) => {
			authLoading = false;
			if (response?.success) {
				authenticated = true;
				// Clear the popup so future clicks trigger onClicked again, then close
				chrome.action.setPopup({ popup: '' });
				window.close();
			} else {
				authError = response?.error ?? m.auth_verify_failed();
			}
		});
	}
</script>

{#key currentLang}
<div class="w-80 bg-background p-4 font-sans text-foreground" role="application">
	<div class="mb-3 flex items-center justify-between">
		<h1 class="text-lg font-bold">{m.app_name()}</h1>
		<select
			class="rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground"
			value={currentLang}
			onchange={(e) => handleLanguageChange((e.target as HTMLSelectElement).value as AvailableLanguageTag)}
		>
			{#each availableLanguageTags as tag}
				<option value={tag}>{languageLabels[tag]}</option>
			{/each}
		</select>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">{m.loading()}</p>
	{:else}
		{#if tabError}
			<div class="mb-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
				<p class="text-sm font-medium text-destructive">{tabError}</p>
				<button
					onclick={dismissError}
					class="mt-2 w-full rounded-md border border-destructive/30 px-3 py-1 text-xs text-destructive hover:bg-destructive/20"
				>
					Dismiss
				</button>
			</div>
		{/if}

		{#if !authenticated}
			{#if sessionExpired}
				<div class="mb-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
					<p class="text-sm font-medium text-destructive">{m.auth_session_expired()}</p>
				</div>
			{/if}

			{#if !otpId}
				<form onsubmit={(e) => { e.preventDefault(); handleRequestOtp(); }} class="flex flex-col gap-2">
					<label class="text-sm font-medium text-foreground">{m.auth_email_label()}</label>
					<input
						type="email"
						bind:value={email}
						placeholder={m.auth_email_placeholder()}
						required
						class="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
					/>
					<button
						type="submit"
						disabled={authLoading}
						class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
					>
						{authLoading ? m.auth_sending_otp() : m.auth_send_code()}
					</button>
				</form>
			{:else}
				<form onsubmit={(e) => { e.preventDefault(); handleVerify(); }} class="flex flex-col gap-2">
					<p class="text-sm text-muted-foreground">{m.auth_otp_sent_to({ email })}</p>
					<input
						type="text"
						bind:value={code}
						placeholder={m.auth_otp_placeholder()}
						required
						class="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground"
					/>
					<button
						type="submit"
						disabled={authLoading}
						class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
					>
						{authLoading ? m.auth_verifying() : m.auth_verify()}
					</button>
				</form>
			{/if}

			{#if authError}
				<p class="mt-2 text-sm text-destructive">{authError}</p>
			{/if}
		{/if}
	{/if}
</div>
{/key}
