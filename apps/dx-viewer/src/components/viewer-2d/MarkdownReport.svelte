<script lang="ts">
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';
	import * as m from '$lib/paraglide/messages';

	type Props = { report: string | null };
	let { report }: Props = $props();

	const html = $derived.by(() => {
		if (!report) return '';
		try {
			const raw = marked.parse(report, { gfm: true, async: false }) as string;
			return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
		} catch {
			return null; // signals fallback
		}
	});
</script>

{#if !report}
	<p class="empty">{m.dx_viewer_2d_report_empty()}</p>
{:else if html === null}
	<pre class="raw">{report}</pre>
{:else}
	<div class="report">
		{@html html}
	</div>
{/if}

<style>
	.empty {
		color: var(--muted-fg);
		font-size: var(--text-meta);
		margin: 0;
	}
	.raw {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		color: var(--fg);
		white-space: pre-wrap;
		word-break: break-word;
		background: var(--surface-2);
		border-radius: var(--radius);
		padding: 12px;
		margin: 0;
	}
	.report {
		color: var(--fg);
		font-size: var(--text-body);
		line-height: var(--leading-normal);
	}
	.report :global(h1),
	.report :global(h2),
	.report :global(h3),
	.report :global(h4) {
		font-weight: 600;
		letter-spacing: var(--tracking-tight);
		color: var(--fg);
		margin: 1.4em 0 0.5em;
		line-height: var(--leading-tight);
	}
	.report :global(h1) {
		font-size: var(--text-section-title);
	}
	.report :global(h2) {
		font-size: var(--text-card-title);
	}
	.report :global(h3) {
		font-size: var(--text-meta);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		color: var(--muted-fg);
		font-family: var(--font-mono);
	}
	.report :global(h4) {
		font-size: var(--text-meta);
		color: var(--muted-fg);
	}
	.report :global(p) {
		margin: 0.5em 0;
	}
	.report :global(ul),
	.report :global(ol) {
		padding-left: 1.2em;
		margin: 0.5em 0;
	}
	.report :global(li) {
		margin: 0.2em 0;
	}
	.report :global(li input[type='checkbox']) {
		accent-color: var(--accent);
		margin-right: 0.5em;
	}
	.report :global(strong) {
		color: var(--fg);
		font-weight: 600;
	}
	.report :global(code) {
		background: var(--surface-2);
		padding: 0.1em 0.35em;
		border-radius: var(--radius-sm);
		font-size: 0.92em;
	}
	.report :global(hr) {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 1em 0;
	}
	.report :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.report :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0.6em 0;
		font-size: var(--text-meta);
	}
	.report :global(th),
	.report :global(td) {
		border-bottom: 1px solid var(--border);
		padding: 6px 10px;
		text-align: left;
	}
</style>
