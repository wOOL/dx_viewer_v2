<script lang="ts" module>
	export type FindingState = 'confirmed' | 'dismissed';
	export type TopKEntry = { labelId: number; label: string; prob: number };
</script>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { diseaseColor } from './label-colors';
	import type { Severity } from './severity';

	type Props = {
		id: string;
		label: string;
		color: string;
		confidence?: number;
		severity?: Severity | null;
		verdict?: FindingState;
		topK?: TopKEntry[] | null;
		focused?: boolean;
		hidden?: boolean;
		onSelect: () => void;
		onHover: (entering: boolean) => void;
		onToggleHide: () => void;
		onConfirm?: () => void;
		onDismiss?: () => void;
	};
	let {
		id,
		label,
		color,
		confidence,
		severity = null,
		verdict,
		topK = null,
		focused = false,
		hidden = false,
		onSelect,
		onHover,
		onToggleHide,
		onConfirm,
		onDismiss
	}: Props = $props();

	let expanded = $state(false);
	const hasTopK = $derived(topK !== null && topK.length > 1);

	// "G3" / "S2" — terse code matching the 3D viewer's mono micro-labels.
	const severityCode = $derived.by(() => {
		if (!severity) return null;
		return severity.kind === 'caries' ? `G${severity.level}` : `S${severity.level}`;
	});
</script>

<li
	class="row"
	class:focused
	class:dim={hidden}
	class:confirmed={verdict === 'confirmed'}
	class:dismissed={verdict === 'dismissed'}
	data-row-id={id}
>
	<button
		type="button"
		class="main"
		onclick={onSelect}
		onmouseenter={() => onHover(true)}
		onmouseleave={() => onHover(false)}
	>
		<span class="eye" aria-hidden="true">{hidden ? '○' : '●'}</span>
		<span class="swatch" style:background={color}></span>
		<span class="label">{label}</span>
		{#if severityCode}
			<span class="sev" style:--c={color} title={`Severity ${severity?.level}/${severity?.max}`}>
				{severityCode}
			</span>
		{/if}
		{#if confidence !== undefined}
			<span class="conf">{Math.round(confidence * 100)}%</span>
		{/if}
	</button>

	<div class="actions">
		{#if onConfirm}
			<button
				type="button"
				class="act confirm"
				class:on={verdict === 'confirmed'}
				aria-label={m.dx_viewer_2d_confirm()}
				aria-pressed={verdict === 'confirmed'}
				title={m.dx_viewer_2d_confirm()}
				onclick={onConfirm}
			>
				<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8">
					<path d="M3 8.5l3.5 3.5L13 4.5" />
				</svg>
			</button>
		{/if}
		{#if onDismiss}
			<button
				type="button"
				class="act dismiss"
				class:on={verdict === 'dismissed'}
				aria-label={m.dx_viewer_2d_dismiss()}
				aria-pressed={verdict === 'dismissed'}
				title={m.dx_viewer_2d_dismiss()}
				onclick={onDismiss}
			>
				<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8">
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		{/if}
		<button
			type="button"
			class="act"
			aria-label={hidden ? m.dx_viewer_2d_show() : m.dx_viewer_2d_hide()}
			title={hidden ? m.dx_viewer_2d_show() : m.dx_viewer_2d_hide()}
			onclick={onToggleHide}
		>
			<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6">
				{#if hidden}
					<path d="M3 3l10 10" />
					<path d="M1.5 8C3 5 5.2 3.5 8 3.5s5 1.5 6.5 4.5C13 11 10.8 12.5 8 12.5S3 11 1.5 8z" />
				{:else}
					<path d="M1.5 8C3 5 5.2 3.5 8 3.5s5 1.5 6.5 4.5C13 11 10.8 12.5 8 12.5S3 11 1.5 8z" />
					<circle cx="8" cy="8" r="2" fill="currentColor" />
				{/if}
			</svg>
		</button>
		{#if hasTopK}
			<button
				type="button"
				class="act expand"
				class:on={expanded}
				aria-label={m.dx_viewer_2d_alt_diagnoses()}
				aria-expanded={expanded}
				onclick={() => (expanded = !expanded)}
			>
				<svg viewBox="0 0 12 12" width="11" height="11" style:transform={expanded ? 'rotate(180deg)' : 'rotate(0deg)'}>
					<path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
		{/if}
	</div>
</li>

{#if expanded && topK}
	<li class="topk-li">
		<div class="topk">
			<div class="topk-head">{m.dx_viewer_2d_alt_diagnoses()}</div>
			{#each topK as e (e.labelId)}
				<div class="topk-row">
					<span class="topk-dot" style:background={diseaseColor(e.labelId)}></span>
					<span class="topk-label">{e.label}</span>
					<div class="topk-bar">
						<span class="topk-fill" style:width="{Math.max(2, Math.round(e.prob * 100))}%" style:background={diseaseColor(e.labelId)}></span>
					</div>
					<span class="topk-pct">{Math.round(e.prob * 100)}%</span>
				</div>
			{/each}
		</div>
	</li>
{/if}

<style>
	.row {
		display: flex;
		align-items: stretch;
		gap: 0;
		border-bottom: 1px solid var(--border);
		transition: background-color 150ms, opacity 150ms;
		position: relative;
	}
	.row:last-child {
		border-bottom: none;
	}
	.row:hover,
	.row.focused {
		background-color: rgba(232, 236, 240, 0.025);
	}
	.row.focused::after {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--accent);
	}
	.row.confirmed::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 2px;
		background: #5dd4a6;
	}
	.row.dismissed {
		opacity: 0.42;
	}
	.row.dismissed .label {
		text-decoration: line-through;
		text-decoration-color: var(--muted-fg);
	}
	.row.dim {
		opacity: 0.45;
	}

	.main {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		background: transparent;
		border: 0;
		color: inherit;
		text-align: left;
		cursor: pointer;
		min-width: 0;
		font-family: var(--font-sans);
		font-size: 13px;
		color: var(--fg);
	}

	.eye {
		flex-shrink: 0;
		width: 10px;
		font-size: 9px;
		text-align: center;
		color: var(--muted-fg);
		line-height: 1;
	}
	.swatch {
		flex-shrink: 0;
		width: 10px;
		height: 10px;
		border-radius: 3px;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sev {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 500;
		letter-spacing: 0.04em;
		color: var(--c);
		padding: 2px 5px;
		border-radius: 3px;
		background-color: color-mix(in srgb, var(--c) 12%, transparent);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.conf {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted-fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
		min-width: 30px;
		text-align: right;
	}

	.actions {
		display: flex;
		align-items: stretch;
	}
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		background: transparent;
		border: 0;
		color: var(--muted-fg);
		cursor: pointer;
		transition: background-color 150ms, color 150ms;
	}
	.act:hover {
		background-color: var(--surface-2);
		color: var(--fg);
	}
	.act.confirm.on {
		color: #5dd4a6;
		background-color: rgba(93, 212, 166, 0.1);
	}
	.act.dismiss.on {
		color: var(--destructive);
		background-color: rgba(232, 75, 58, 0.1);
	}
	.act.expand.on {
		color: var(--accent);
		background-color: var(--surface-2);
	}
	.act svg {
		transition: transform 200ms ease-out;
	}

	.topk-li {
		display: block;
		list-style: none;
		padding: 0;
		margin: 0;
		border-bottom: 1px solid var(--border);
	}
	.topk-li:last-child {
		border-bottom: none;
	}
	.topk {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 8px 12px 10px 32px;
		background-color: rgba(232, 236, 240, 0.02);
	}
	.topk-head {
		font-family: var(--font-mono);
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		margin-bottom: 2px;
	}
	.topk-row {
		display: grid;
		grid-template-columns: 8px 1fr 60px 30px;
		align-items: center;
		gap: 8px;
		font-size: 11px;
	}
	.topk-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.topk-label {
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.topk-bar {
		height: 4px;
		background-color: var(--surface-2);
		border-radius: 2px;
		overflow: hidden;
	}
	.topk-fill {
		display: block;
		height: 100%;
		border-radius: 2px;
		transition: width 220ms ease-out;
	}
	.topk-pct {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted-fg);
		text-align: right;
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
</style>
