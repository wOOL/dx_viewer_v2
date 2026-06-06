<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
</script>

<div class="card">
	<div class="mb-6 flex items-center gap-3">
		<Logo size={36} showText={false} />
		<div>
			<h1 class="text-xl font-bold text-fg-0">{$_('legal.termsTitle')}</h1>
			<p class="text-xs text-fg-2">{$_('legal.lastUpdated')}</p>
		</div>
	</div>

	<!-- Legal content follows the UI locale — clinicians need to read what
	     they're accepting in their own language. -->
	<div class="legal-prose prose max-h-[60vh] overflow-y-auto text-sm leading-relaxed">
		<h3>{$_('legal.terms1Title')}</h3>
		<p>{$_('legal.terms1Body')}</p>

		<h3>{$_('legal.terms2Title')}</h3>
		<p>{$_('legal.terms2Body')}</p>

		<h3>{$_('legal.terms3Title')}</h3>
		<p>{$_('legal.terms3Body')}</p>

		<h3>{$_('legal.terms4Title')}</h3>
		<p>{$_('legal.terms4Body')}</p>

		<h3>{$_('legal.terms5Title')}</h3>
		<p>{$_('legal.terms5Body')}</p>

		<h3>{$_('legal.terms6Title')}</h3>
		<p>{$_('legal.terms6Body')}</p>
	</div>

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
	/* Theme-aware prose (replaces dark-only prose-invert): map Tailwind typography
	   vars onto our tokens so the legal text reads correctly in light AND dark. */
	.legal-prose {
		--tw-prose-body: var(--color-fg-1);
		--tw-prose-headings: var(--color-fg-0);
		--tw-prose-bold: var(--color-fg-0);
		--tw-prose-links: var(--color-primary);
	}
</style>
