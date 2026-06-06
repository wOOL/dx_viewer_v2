<script lang="ts">
	import TopBar from '$lib/components/TopBar.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { pb } from '$lib/pb';
	import { _ } from 'svelte-i18n';
	import { User as UserIcon, Mail, Phone, MapPin, Save } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import { validateProfile, accountSaveErrorMessage, MAX_NAME_LENGTH } from '$lib/forms';
	import { capText, MAX_MOBILE_LENGTH, MAX_ADDRESS_LENGTH } from '$lib/limits';

	let name = $state(auth.user?.name ?? '');
	let mobile = $state(auth.user?.mobile ?? '');
	let address = $state(auth.user?.address ?? '');
	let savingProfile = $state(false);
	let savedMsg = $state('');
	let error = $state('');
	// Track the "Saved" toast timer so a second save resets it (not cleared early by
	// the first) and SPA-nav within the window doesn't leave it firing post-unmount.
	let savedTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(savedTimer));

	async function saveProfile() {
		if (!auth.user) return;
		// Validate + normalize before persisting: a blank/whitespace-only name would
		// save an empty string that renders as a blank label in the TopBar/Sidebar.
		const check = validateProfile({ name });
		if (!check.valid) {
			savedMsg = '';
			error =
				check.reason === 'tooLong' ? $_('account.errNameTooLong') : $_('account.errNameRequired');
			return;
		}
		// Persist the trimmed name (and trimmed contact fields) so stray whitespace
		// doesn't round-trip into the store/cookie.
		const cleanName = check.name;
		name = cleanName;
		// Cap the contact fields at the persist choke point (not only <input maxlength>) so a
		// paste / programmatic value can't bloat the user row.
		const cleanMobile = capText(mobile, MAX_MOBILE_LENGTH);
		const cleanAddress = capText(address, MAX_ADDRESS_LENGTH);
		savingProfile = true;
		error = '';
		savedMsg = '';
		try {
			const rec = await pb
				.collection('users')
				.update(auth.user.id, { name: cleanName, mobile: cleanMobile, address: cleanAddress });
			// Update pb.authStore so a re-entry to /account (or any other page that
			// reads auth.user.name) reflects the just-saved values — without this,
			// the cookie/store kept the OLD name and the form silently reverted on
			// the next navigation. Triggers the onChange → syncFromPB chain.
			//
			// `authStore.save` writes the cookie/localStorage *synchronously* and can
			// throw in private mode / on a quota or SecurityError — but that happens
			// AFTER the server record already persisted. Treat that as a recoverable
			// local-persistence hiccup: still report success (the next navigation
			// re-reads auth from the server) rather than masquerading it as a save
			// failure with a raw storage string.
			try {
				pb.authStore.save(pb.authStore.token, rec);
			} catch (persistErr) {
				console.warn(
					'account: profile saved on the server but local persistence failed',
					persistErr
				);
			}
			savedMsg = $_('account.saved');
			clearTimeout(savedTimer);
			savedTimer = setTimeout(() => (savedMsg = ''), 3000);
		} catch (err) {
			// The real update-failure path (500 / timeout / server validation):
			// surface a localized message, never a raw SDK/storage string.
			const chosen = accountSaveErrorMessage(err);
			error = 'key' in chosen ? $_(chosen.key) : chosen.text;
		} finally {
			savingProfile = false;
		}
	}
</script>

<TopBar title={$_('nav.account')} showSearch={false} />

<main class="flex-1 overflow-y-auto px-8 py-7">
	<div class="mx-auto max-w-2xl">
		<div class="card">
			<h2 class="mb-1 text-lg font-bold text-fg-0">{$_('account.profile')}</h2>
			<p class="mb-6 text-sm text-fg-2">{$_('account.profileDesc')}</p>

			<div class="space-y-4">
				<div class="form-row">
					<div class="lbl flex items-center gap-2"><Mail size={14} />{$_('login.email')}</div>
					<input
						class="input"
						aria-label={$_('login.email')}
						value={auth.user?.email ?? ''}
						readonly
					/>
				</div>
				<div class="form-row">
					<div class="lbl flex items-center gap-2">
						<UserIcon size={14} />{$_('signup.fullName')}
					</div>
					<input
						class="input"
						aria-label={$_('signup.fullName')}
						bind:value={name}
						maxlength={MAX_NAME_LENGTH}
					/>
				</div>
				<div class="form-row">
					<div class="lbl flex items-center gap-2"><Phone size={14} />{$_('account.mobile')}</div>
					<input
						class="input"
						aria-label={$_('account.mobile')}
						bind:value={mobile}
						maxlength={MAX_MOBILE_LENGTH}
						placeholder={$_('account.mobilePlaceholder')}
					/>
				</div>
				<div class="form-row">
					<div class="lbl flex items-center gap-2"><MapPin size={14} />{$_('account.address')}</div>
					<textarea
						class="input"
						aria-label={$_('account.address')}
						rows="3"
						maxlength={MAX_ADDRESS_LENGTH}
						bind:value={address}
					></textarea>
				</div>
			</div>

			{#if error}<div class="mt-3 text-sm text-danger" role="alert">{error}</div>{/if}
			{#if savedMsg}<div class="mt-3 text-sm text-success" role="status">{savedMsg}</div>{/if}

			<div class="mt-6 flex justify-end">
				<button class="btn-primary" onclick={saveProfile} disabled={savingProfile}>
					<Save size={14} />
					{savingProfile ? $_('account.saving') : $_('account.save')}
				</button>
			</div>
		</div>
	</div>
</main>

<style>
	.card {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 1.5rem;
	}
	.form-row {
		display: grid;
		grid-template-columns: 140px 1fr;
		align-items: start;
		gap: 1rem;
	}
	.lbl {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-fg-2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding-top: 0.65rem;
	}
	.input {
		width: 100%;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.55rem 0.75rem;
		color: var(--color-fg-0);
		font-size: 0.875rem;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.input:focus {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px var(--color-primary-tint);
	}
	.input[readonly] {
		color: var(--color-fg-2);
	}
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
		font-size: 0.875rem;
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
