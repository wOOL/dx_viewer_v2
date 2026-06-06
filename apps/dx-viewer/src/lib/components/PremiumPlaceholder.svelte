<script lang="ts">
	import { Sparkles } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
	interface Props {
		title?: string;
		headline: string;
		blurb?: string;
		footerHeadline: string;
		mockup?: import('svelte').Snippet;
		icon?: typeof Sparkles;
	}
	// eslint surfaced that title/blurb/icon were DECLARED + passed by every caller
	// (localized upsell strings in 4 locales) but never destructured — the eyebrow,
	// icon and blurb paragraph silently vanished in a refactor. Render them again.
	let { title, headline, blurb, footerHeadline, mockup, icon }: Props = $props();
	const Icon = $derived(icon ?? Sparkles);

	// CTAs were dead no-ops. Point "Learn more" at the in-app Help page and
	// "Book a Demo" at a prefilled email.
	const LEARN_MORE_URL = resolve('/(app)/help');
	const DEMO_MAILTO =
		'mailto:hello@becertain.ai?subject=Dx%20Viewer%20demo%20request&body=I%27d%20like%20to%20book%20a%20demo%20of%20Dx%20Viewer.';
</script>

<main class="flex-1 overflow-y-auto bg-bg-0">
	<div class="relative flex min-h-full flex-col items-center px-8 pt-12 pb-32">
		{#if title}
			<div class="mb-3 flex items-center gap-2 text-sm font-semibold text-fg-2 uppercase">
				<Icon size={16} aria-hidden="true" />
				<span>{title}</span>
			</div>
		{/if}
		<h1 class="max-w-2xl text-center text-[28px] leading-[1.25] font-bold text-fg-0">
			{headline}
		</h1>
		{#if blurb}
			<p class="mt-4 max-w-xl text-center text-sm leading-relaxed text-fg-2">{blurb}</p>
		{/if}

		<a
			href={LEARN_MORE_URL}
			target="_blank"
			rel="noopener noreferrer"
			class="mt-6 rounded-full bg-primary px-7 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary-hover"
			>{$_('upsell.learnMore')}</a
		>

		<!-- The mockup is a purely decorative fake-data preview of the premium feature.
		     `inert` removes it from the tab order AND the accessibility tree, so screen
		     readers don't announce fabricated patient names/numbers and its low-contrast
		     chart accents aren't real a11y failures (axe skips inert subtrees). It is
		     styled as a light "screenshot" preview in both themes by design. -->
		<div class="mt-10 w-full max-w-4xl" inert>
			{#if mockup}
				{@render mockup()}
			{:else}
				<div class="rounded-2xl bg-bg-1 p-10 text-center shadow-[var(--shadow-card)]">
					<div class="text-sm text-fg-2">{$_('upsell.comingSoon')}</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Sticky bottom CTA banner -->
	<div
		class="sticky bottom-0 z-10 flex items-center justify-between border-t border-border bg-bg-2 px-8 py-3 text-fg-0"
	>
		<div>
			<div class="text-[15px] font-semibold">{footerHeadline}</div>
			<div class="mt-0.5 text-[11px] text-fg-2">{$_('upsell.joinText')}</div>
		</div>
		<div class="flex gap-2">
			<a
				href={LEARN_MORE_URL}
				target="_blank"
				rel="noopener noreferrer"
				class="rounded-full border border-border px-4 py-1.5 text-[13px] font-medium transition hover:bg-bg-3"
				>{$_('upsell.learnMore')}</a
			>
			<a
				href={DEMO_MAILTO}
				class="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-on-primary transition hover:bg-primary-hover"
				>📅 {$_('upsell.bookDemo')}</a
			>
		</div>
	</div>
</main>
