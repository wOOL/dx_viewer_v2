<script lang="ts">
	import TopBar from '$lib/components/TopBar.svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { _, locale } from 'svelte-i18n';
	import { visibleSections } from '$lib/help/manual';
	import {
		INVENTORY,
		shotFor,
		bodyKeyFor,
		MANUAL_VER,
		type Interaction
	} from '$lib/help/inventory';
	import { auth } from '$lib/stores/auth.svelte';
	import { LifeBuoy, Download, Database } from 'lucide-svelte';

	// Data-driven: each interactive element in INVENTORY is documented atomically —
	// its own screenshot showing the outcome of using it, plus a per-control body. The
	// MANUAL groups ids into task-oriented sections (for navigation + brief intros).
	// help/coverage.test.ts proves every id has a shot file + name + body in 4 locales.
	const itemById = new Map<string, Interaction>(INVENTORY.map((i) => [i.id, i]));

	// Experimental (Labs-gated) features sit at the bottom and appear only for accounts an
	// admin has granted Labs access. The PDF generator loads this page with `?pdf=1` to
	// force the baseline (no-experimental) manual regardless of the rendering account.
	const pdfMode = $derived(page.url.searchParams.has('pdf'));
	const sections = $derived(visibleSections({ labs: auth.labsEnabled, pdf: pdfMode }));

	function hideBroken(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	// Pick the manual PDF that matches the current locale (falls back to English
	// if the user is on a locale we don't ship a manual for yet).
	const pdfHref = $derived.by(() => {
		const lang = ($locale ?? 'en').split('-')[0];
		const supported = ['en', 'fr', 'es', 'de'];
		const pick = supported.includes(lang) ? lang : 'en';
		return `${base}/manual/dx-viewer-manual-${pick}.pdf?v=${MANUAL_VER}`;
	});
</script>

<TopBar title={$_('nav.help')} showSearch={false} />

<main class="flex-1 overflow-y-auto px-6 py-8">
	<div class="mx-auto max-w-4xl">
		<header class="mb-8 flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold text-fg-0">{$_('help.title')}</h1>
				<p class="mt-2 max-w-2xl text-sm text-fg-2">{$_('help.subtitle')}</p>
			</div>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static asset download (not an app route) -->
			<a class="pdf-link" href={pdfHref} download data-testid="manual-pdf-download">
				<Download size={14} />
				{$_('help.downloadPdf')}
			</a>
		</header>

		<!-- Local-first durability statement (locked requirement): patient data lives only
		     on this device. Prominent here + in the manual PDF rendered from this page. -->
		<div class="localfirst-notice" role="note" data-testid="localfirst-notice">
			<Database size={20} class="lf-icon" />
			<div>
				<p class="lf-title">{$_('help.localFirst.title')}</p>
				<p class="lf-body">{$_('help.localFirst.body')}</p>
			</div>
		</div>

		<nav class="toc" aria-label={$_('help.title')}>
			<ol>
				{#each sections as s (s.id)}
					<li><a href="#help-{s.id}">{$_(s.titleKey)}</a></li>
				{/each}
			</ol>
		</nav>

		<div class="mt-8 space-y-8">
			{#each sections as s (s.id)}
				<section id="help-{s.id}" class="section">
					<h2 class="text-lg font-semibold text-fg-0">{$_(s.titleKey)}</h2>
					<p class="mt-2 text-sm leading-relaxed text-fg-2">{$_(s.bodyKey)}</p>

					<div class="demos">
						{#each s.covers as id (id)}
							{@const item = itemById.get(id)}
							{#if item}
								<article class="demo">
									<h3 class="demo-name">{$_(item.nameKey)}</h3>
									<img
										class="demo-shot"
										src="{base}/manual/{shotFor(id)}.png?v={MANUAL_VER}"
										alt={$_(item.nameKey)}
										onerror={hideBroken}
									/>
									<p class="demo-body">{$_(bodyKeyFor(id))}</p>
								</article>
							{/if}
						{/each}
					</div>
				</section>
			{/each}
		</div>

		<footer class="support">
			<LifeBuoy size={16} class="text-primary" />
			<p>{$_('help.support')}</p>
		</footer>
	</div>
</main>

<style>
	.pdf-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.9rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		color: var(--color-fg-1);
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			color 0.12s,
			border-color 0.12s,
			background 0.12s;
	}
	.pdf-link:hover {
		color: var(--color-fg-0);
		border-color: var(--color-primary);
		background: var(--color-primary-tint);
	}
	.localfirst-notice {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
		margin-bottom: 1.5rem;
		padding: 1rem 1.25rem;
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-card);
		background: var(--color-primary-tint);
	}
	.localfirst-notice :global(.lf-icon) {
		flex-shrink: 0;
		margin-top: 0.1rem;
		color: var(--color-primary);
	}
	.lf-title {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-fg-0);
	}
	.lf-body {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
		line-height: 1.55;
		color: var(--color-fg-1);
	}
	.toc {
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		border-radius: var(--radius-card);
		padding: 1rem 1.25rem;
	}
	.toc ol {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.35rem 1.5rem;
		margin: 0;
		padding: 0;
		list-style: decimal inside;
		font-size: 0.85rem;
	}
	.toc a {
		color: var(--color-fg-1);
		transition: color 0.12s;
	}
	.toc a:hover {
		color: var(--color-primary);
		text-decoration: underline;
	}
	.section {
		scroll-margin-top: 1rem;
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 1.5rem;
	}
	.demos {
		margin-top: 1.5rem;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: 1.5rem;
	}
	.demo {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.85rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		background: var(--color-bg-2);
	}
	.demo-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-fg-0);
	}
	.demo-shot {
		display: block;
		width: 100%;
		height: 200px;
		/* `contain` (not `cover`) so the whole shot is visible regardless of aspect.
		   Many demo shots are clipped to a narrow UI element (a 232 px sidebar column,
		   a 48 px tool rail, a 1048×56 topbar strip), and `cover` would scale-crop
		   those to a black sliver. Letterboxing on the bg keeps the layout uniform
		   while still showing the actual control state. */
		object-fit: contain;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg-0);
	}
	.demo-body {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.55;
		color: var(--color-fg-1);
	}
	.support {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 2rem;
		padding: 1rem 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg-1);
		font-size: 0.85rem;
		color: var(--color-fg-2);
	}
	.support p {
		margin: 0;
	}
</style>
