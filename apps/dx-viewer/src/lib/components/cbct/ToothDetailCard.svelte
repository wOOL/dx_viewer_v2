<script lang="ts">
	import { ChevronDown, MessageSquare, FileText, Check } from 'lucide-svelte';
	import { toothDisplay } from '$lib/constants';
	import { _ } from 'svelte-i18n';
	import { MAX_COMMENT_LENGTH } from '$lib/limits';

	interface Finding {
		name: string;
		severity?: 'low' | 'med' | 'high';
		confidence?: number;
		category?: string;
	}

	interface Props {
		tooth: number;
		roots?: number;
		canals?: number;
		findings?: Finding[];
		thumbs?: string[]; // dataURLs for slice thumbnails
		approved?: boolean;
		comment?: string;
		onclose?: () => void;
		onmore?: () => void;
		onapprove?: () => void;
		oncomment?: (text: string) => void;
	}
	const {
		tooth,
		roots,
		canals,
		findings = [],
		thumbs = [],
		approved = false,
		comment = '',
		onclose,
		onmore,
		onapprove,
		oncomment
	}: Props = $props();

	let commenting = $state(false);
	let draft = $state('');

	function openComment() {
		draft = comment;
		commenting = true;
	}
	function saveComment() {
		oncomment?.(draft.trim());
		commenting = false;
	}

	function chipClass(s?: 'low' | 'med' | 'high') {
		if (s === 'high') return 'bg-danger-500 text-bg-0';
		if (s === 'med') return 'bg-warning-500 text-bg-0';
		return 'bg-primary/60 text-bg-0';
	}
</script>

<section class="rounded-lg border border-border bg-bg-1 p-3">
	<header class="mb-2 flex items-center justify-between">
		<button
			class="flex items-center gap-2 text-left text-sm font-semibold text-fg-0"
			onclick={onclose}
		>
			<span>{$_('cbct.tooth')} {toothDisplay(tooth)}</span>
			<span class="text-xs font-normal text-fg-2">
				{#if roots}· {$_('cbct.rootCount', { values: { n: roots } })}{/if}
				{#if canals}· {$_('cbct.canalCount', { values: { n: canals } })}{/if}
				{#if !roots && !canals}· {$_('cbct.findingCount', { values: { n: findings.length } })}{/if}
			</span>
		</button>
		<ChevronDown size={14} class="text-fg-2" />
	</header>

	{#if findings.length}
		<div class="mb-3 flex flex-wrap gap-1">
			{#each findings as f, i (i)}
				<span class="rounded-sm px-1.5 py-0.5 text-[10px] {chipClass(f.severity)}">
					{f.name}{f.confidence ? ` ${Math.round(f.confidence * 100)}%` : ''}
				</span>
			{/each}
		</div>
	{:else}
		<div class="mb-3 text-xs text-fg-2">{$_('cbct.noFindingsRecorded')}</div>
	{/if}

	<div class="mb-3 flex gap-1">
		{#each [0, 1, 2, 3] as i (i)}
			{#if thumbs[i]}
				<img
					src={thumbs[i]}
					alt={$_('cbct.sliceN', { values: { n: i + 1 } })}
					class="aspect-square w-1/4 rounded-sm object-cover"
				/>
			{:else}
				<div class="aspect-square w-1/4 rounded-sm bg-bg-2"></div>
			{/if}
		{/each}
	</div>

	{#if comment && !commenting}
		<div class="mb-2 rounded bg-bg-2 px-2 py-1 text-[11px] text-fg-1">
			<span class="text-fg-2">{$_('cbct.note')}</span>
			{comment}
		</div>
	{/if}

	{#if commenting}
		<div class="mb-2">
			<textarea
				bind:value={draft}
				rows="2"
				maxlength={MAX_COMMENT_LENGTH}
				placeholder={$_('cbct.notePlaceholder', { values: { n: toothDisplay(tooth) } })}
				class="w-full resize-none rounded border border-border bg-bg-2 px-2 py-1 text-[11px] text-fg-0 outline-none focus:border-primary"
			></textarea>
			<div class="mt-1 flex justify-end gap-2 text-[11px]">
				<button class="text-fg-2 hover:text-fg-0" onclick={() => (commenting = false)}
					>{$_('common.cancel')}</button
				>
				<button class="font-medium text-primary hover:text-primary" onclick={saveComment}
					>{$_('common.save')}</button
				>
			</div>
		</div>
	{/if}

	<div class="flex items-center justify-between text-[11px] text-fg-2">
		<div class="flex gap-2">
			<button
				class="flex items-center gap-1 hover:text-fg-0"
				data-testid="tooth-more"
				onclick={onmore}
			>
				<FileText size={12} />
				{$_('cbct.condition')}
			</button>
			<button
				class="flex items-center gap-1 hover:text-fg-0"
				class:text-primary={!!comment}
				onclick={openComment}
			>
				<MessageSquare size={12} />
				{$_('cbct.comment')}
			</button>
		</div>
		{#if approved}
			<button
				class="flex items-center gap-1 rounded-md border border-success/40 bg-success/15 px-2 py-1 text-success"
				onclick={onapprove}
				title={$_('cbct.approvedUndo')}
			>
				<Check size={12} />
				{$_('cbct.approved')}
			</button>
		{:else}
			<button
				class="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-bg-0 hover:bg-primary"
				onclick={onapprove}
			>
				<Check size={12} />
				{$_('cbct.approve')}
			</button>
		{/if}
	</div>
</section>
