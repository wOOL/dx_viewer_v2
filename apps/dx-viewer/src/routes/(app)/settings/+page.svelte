<script lang="ts">
	import TopBar from '$lib/components/TopBar.svelte';
	import LocalDataCard from '$lib/components/LocalDataCard.svelte';
	import { theme, type ThemeMode } from '$lib/stores/theme.svelte';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { serverErrorMessage, resolveErrorMessage } from '$lib/forms';
	import { setLocale, SUPPORTED, LOCALE_NAMES, type Locale } from '$lib/i18n';
	import { _, locale } from 'svelte-i18n';
	import { Sun, Moon, MonitorSmartphone } from 'lucide-svelte';

	// Settings drives the shared `prefs` store DIRECTLY (no local $state mirrors and
	// no mount-time write-back $effect): controls call the crash-safe setters on real
	// interaction only. This fixes S2-#1 (the old $effect re-wrote all three keys on
	// every mount, clobbering a value another tab had just changed) and means every
	// other consumer (viewers, toothDisplay, the chart) reacts to the change live.
	// The `dxv:measurementUnit` cleanup the old effect did now happens once in the
	// prefs store constructor. The Measurement-unit control stays disabled+explained
	// (the 2D measurement feature it drove is N/A — see FindingsPanel #15).

	const themeModes: { mode: ThemeMode; icon: typeof Sun; key: string }[] = [
		{ mode: 'light', icon: Sun, key: 'theme.light' },
		{ mode: 'dark', icon: Moon, key: 'theme.dark' },
		{ mode: 'system', icon: MonitorSmartphone, key: 'theme.system' }
	];

	// "Enable 3D (CBCT/IOS) tools" — an ACCOUNT-level preference (unlike the device
	// prefs above), so it persists to the user record and follows the clinician across
	// devices. Default OFF (the 3D AI is segmentation-only / premature) → the app is
	// 2D-only until turned on. Optimistic: flip the checkbox immediately, persist in the
	// background, and on a server failure revert + show a localized error.
	let savingThreeD = $state(false);
	let threeDError = $state('');
	async function toggleThreeD(enabled: boolean) {
		if (savingThreeD) return;
		savingThreeD = true;
		threeDError = '';
		try {
			await auth.setThreeDEnabled(enabled);
		} catch (err) {
			threeDError = resolveErrorMessage(serverErrorMessage(err), $_, {
				status: (err as { status?: number })?.status ?? 0
			});
		} finally {
			savingThreeD = false;
		}
	}

	// "Show Photos" — the account-level opt-in for the intraoral-camera "Photo" modality.
	// Same optimistic save/revert pattern as the 3D toggle. Default OFF, so the app shows
	// X-ray + panoramic only until a clinician turns it on here.
	let savingPhoto = $state(false);
	let photoError = $state('');
	async function togglePhoto(enabled: boolean) {
		if (savingPhoto) return;
		savingPhoto = true;
		photoError = '';
		try {
			await auth.setPhotoEnabled(enabled);
		} catch (err) {
			photoError = resolveErrorMessage(serverErrorMessage(err), $_, {
				status: (err as { status?: number })?.status ?? 0
			});
		} finally {
			savingPhoto = false;
		}
	}

	// "Panoramic" — account-level opt-in for the panoramic modality (and the FMX view that
	// depends on it). Default OFF. Same optimistic save/revert pattern as the toggles above.
	let savingPanoramic = $state(false);
	let panoramicError = $state('');
	async function togglePanoramic(enabled: boolean) {
		if (savingPanoramic) return;
		savingPanoramic = true;
		panoramicError = '';
		try {
			await auth.setPanoramicEnabled(enabled);
		} catch (err) {
			panoramicError = resolveErrorMessage(serverErrorMessage(err), $_, {
				status: (err as { status?: number })?.status ?? 0
			});
		} finally {
			savingPanoramic = false;
		}
	}
</script>

<TopBar title={$_('settings.title')} showSearch={false} />

<main class="flex-1 overflow-y-auto px-8 py-7">
	<div class="mx-auto max-w-2xl space-y-6">
		<!-- Appearance: theme + language (this device) -->
		<section class="card">
			<h2 class="card-title">{$_('settings.appearance')}</h2>
			<p class="card-sub">{$_('settings.appearanceDesc')}</p>

			<div class="space-y-6">
				<div>
					<div class="lbl">{$_('theme.label')}</div>
					<div class="mt-2 grid grid-cols-3 gap-2">
						{#each themeModes as t (t.mode)}
							{@const Icon = t.icon}
							<button
								class="opt opt-icon"
								class:active={theme.mode === t.mode}
								data-testid="theme-{t.mode}"
								aria-pressed={theme.mode === t.mode}
								onclick={() => theme.setMode(t.mode)}
							>
								<Icon size={16} />
								{$_(t.key)}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<div class="lbl">{$_('lang.label')}</div>
					<div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
						{#each SUPPORTED as code (code)}
							<button
								class="opt"
								class:active={$locale === code}
								data-testid="lang-{code}"
								lang={code}
								aria-pressed={$locale === code}
								onclick={() => setLocale(code as Locale)}
							>
								{LOCALE_NAMES[code]}
							</button>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<!-- Viewer + inference defaults -->
		<section class="card">
			<h2 class="card-title">{$_('settings.viewerPrefs')}</h2>
			<p class="card-sub">{$_('settings.viewerPrefsDesc')}</p>

			<div class="space-y-5">
				<div>
					<div class="lbl">{$_('settings.toothNumbering')}</div>
					<div class="mt-2 grid grid-cols-2 gap-2">
						<button
							class="opt"
							class:active={prefs.toothNumbering === 'universal'}
							aria-pressed={prefs.toothNumbering === 'universal'}
							onclick={() => prefs.setToothNumbering('universal')}
							>{$_('settings.universal')}</button
						>
						<button
							class="opt"
							class:active={prefs.toothNumbering === 'fdi'}
							aria-pressed={prefs.toothNumbering === 'fdi'}
							onclick={() => prefs.setToothNumbering('fdi')}>{$_('settings.fdi')}</button
						>
					</div>
				</div>

				<div>
					<div class="lbl flex items-center gap-2">
						{$_('settings.measurementUnit')}
						<span class="text-[10px] font-normal tracking-normal text-fg-2 normal-case"
							>{$_('settings.naFor2d')}</span
						>
					</div>
					<div class="mt-2 grid grid-cols-2 gap-2">
						<button class="opt" disabled>{$_('settings.millimeters')}</button>
						<button class="opt" disabled>{$_('settings.percentage')}</button>
					</div>
					<p class="mt-1 text-xs text-fg-2">{$_('settings.measurementHelp')}</p>
				</div>
			</div>
		</section>

		<!-- Labs: experimental modality opt-ins (Enable 3D / Show Photos / Panoramic).
		     Shown ONLY when an admin has set labs_enabled on the user record — a normal
		     user never sees this card. -->
		{#if auth.labsEnabled}
			<section class="card">
				<h2 class="card-title">{$_('settings.tools')}</h2>
				<p class="card-sub">{$_('settings.toolsDesc')}</p>

				<div>
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							class="checkbox"
							data-testid="enable-3d-toggle"
							checked={auth.threeDEnabled}
							disabled={savingThreeD}
							onchange={(e) => toggleThreeD(e.currentTarget.checked)}
						/>
						<span class="text-sm text-fg-1">{$_('settings.enable3d')}</span>
					</label>
					<p class="mt-1 text-xs text-fg-2">{$_('settings.enable3dHelp')}</p>
					{#if threeDError}
						<p class="mt-1 text-xs text-danger" role="alert">{threeDError}</p>
					{/if}
				</div>

				<div class="mt-4">
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							class="checkbox"
							data-testid="enable-photo-toggle"
							checked={auth.photoEnabled}
							disabled={savingPhoto}
							onchange={(e) => togglePhoto(e.currentTarget.checked)}
						/>
						<span class="text-sm text-fg-1">{$_('settings.enablePhoto')}</span>
					</label>
					<p class="mt-1 text-xs text-fg-2">{$_('settings.enablePhotoHelp')}</p>
					{#if photoError}
						<p class="mt-1 text-xs text-danger" role="alert">{photoError}</p>
					{/if}
				</div>

				<div class="mt-4">
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							class="checkbox"
							data-testid="enable-panoramic-toggle"
							checked={auth.panoramicEnabled}
							disabled={savingPanoramic}
							onchange={(e) => togglePanoramic(e.currentTarget.checked)}
						/>
						<span class="text-sm text-fg-1">{$_('settings.enablePanoramic')}</span>
					</label>
					<p class="mt-1 text-xs text-fg-2">{$_('settings.enablePanoramicHelp')}</p>
					{#if panoramicError}
						<p class="mt-1 text-xs text-danger" role="alert">{panoramicError}</p>
					{/if}
				</div>
			</section>

			<!-- Local-first data: backup / restore / export / import. Labs-gated only (not
		     subscription) — moves the on-device patient data to/from the server or a file. -->
			<LocalDataCard />
		{/if}
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
	.card-title {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--color-fg-0);
		margin: 0 0 0.25rem;
	}
	.card-sub {
		font-size: 0.85rem;
		color: var(--color-fg-2);
		margin: 0 0 1.4rem;
	}
	.lbl {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-fg-2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.opt {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.6rem 0.8rem;
		color: var(--color-fg-1);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color 0.12s,
			background 0.12s,
			color 0.12s;
	}
	.opt:hover:not(:disabled) {
		border-color: var(--color-border-hover);
		color: var(--color-fg-0);
	}
	.opt.active {
		background: var(--color-primary-tint);
		border-color: var(--color-primary);
		color: var(--color-primary);
		font-weight: 600;
	}
	.opt:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.checkbox {
		accent-color: var(--color-primary);
		width: 1rem;
		height: 1rem;
	}
</style>
