<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
</script>

<div class="card">
	<div class="mb-6 flex items-center gap-3">
		<Logo size={36} showText={false} />
		<div>
			<h1 class="text-xl font-bold text-fg-0">{$_('legal.privacyTitle')}</h1>
			<p class="text-xs text-fg-2">{$_('legal.lastUpdated')}</p>
		</div>
	</div>

	<!-- Legal content follows the UI locale — clinicians need privacy
	     guarantees in their own language (GDPR, CCPA, UK DPA reading). -->
	<div class="legal-prose prose max-h-[60vh] overflow-y-auto text-sm leading-relaxed">
		<h3>{$_('legal.privacy1Title')}</h3>
		<p>{$_('legal.privacy1Body')}</p>

		<h3>{$_('legal.privacy2Title')}</h3>
		<p>{$_('legal.privacy2Body')}</p>

		<h3>{$_('legal.privacy3Title')}</h3>
		<p>{$_('legal.privacy3Body')}</p>

		<h3>{$_('legal.privacy4Title')}</h3>
		<p>{$_('legal.privacy4Body')}</p>

		<h3>{$_('legal.privacy5Title')}</h3>
		<p>{$_('legal.privacy5Body')}</p>

		<h3>{$_('legal.privacy6Title')}</h3>
		<p>
			{$_('legal.privacy6BodyPre')}<a
				href="mailto:privacy@becertain.ai"
				class="text-primary hover:underline">privacy@becertain.ai</a
			>{$_('legal.privacy6BodyPost')}
		</p>

		<h3>{$_('legal.privacy7Title')}</h3>
		<p>{$_('legal.privacy7Body')}</p>

		<h3>{$_('legal.privacy8Title')}</h3>
		<p>{$_('legal.privacy8Body')}</p>

		<h3>{$_('legal.privacy9Title')}</h3>
		<p>{$_('legal.privacy9Body')}</p>

		<h3>{$_('legal.privacy10Title')}</h3>
		<p>{$_('legal.privacy10Body')}</p>

		<h3>{$_('legal.privacy11Title')}</h3>
		<p>
			{$_('legal.privacy11BodyPre')}<a
				href="mailto:privacy@becertain.ai"
				class="text-primary hover:underline">privacy@becertain.ai</a
			>{$_('legal.privacy11BodyPost')}
		</p>
	</div>

	<div
		class="mt-6 flex items-center justify-between border-t border-border pt-4 text-center text-xs"
	>
		<a href={resolve('/(public)/terms')} class="text-primary hover:underline"
			>{$_('legal.termsTitle')}</a
		>
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
	.legal-prose {
		--tw-prose-body: var(--color-fg-1);
		--tw-prose-headings: var(--color-fg-0);
		--tw-prose-bold: var(--color-fg-0);
		--tw-prose-links: var(--color-primary);
	}
</style>
