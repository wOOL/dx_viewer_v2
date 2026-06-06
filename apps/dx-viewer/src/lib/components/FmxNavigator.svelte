<script lang="ts">
	import type { StoredStudy } from '$lib/types';
	import {
		FMX_SLOTS,
		assignStudiesToSlots,
		slotKeyForStudy,
		findingDots,
		panoramicPatches,
		type FmxSlot,
		type PanoramicPatch
	} from '$lib/fmx';
	import { _ } from 'svelte-i18n';

	// A mini full-mouth-series map shown over the 2D viewer: it tells you which frame
	// of the FMX you're looking at (the current slot is highlighted), and on hover it
	// expands to thumbnails with finding-colour dots. Clicking a frame opens that
	// X-ray. The slot assignment is shared with the patient-page FmxGrid (see $lib/fmx).
	interface Props {
		studies: StoredStudy[];
		currentStudyId: string;
		onPick?: (study: StoredStudy) => void;
	}
	let { studies, currentStudyId, onPick }: Props = $props();

	let expanded = $state(false);
	const assignment = $derived(assignStudiesToSlots(studies));
	const currentSlot = $derived(slotKeyForStudy(assignment, currentStudyId));
	const slotLabel = (slot: FmxSlot) =>
		slot.labelArg ? `${$_(slot.labelKey)} ${slot.labelArg}` : $_(slot.labelKey);

	// Same derivation FmxGrid uses: when there's a panoramic with detected teeth,
	// fill any empty surrounding slots with a crop of the relevant region. Real
	// per-slot studies still win their slot (see the {#if study} branch below).
	const panoStudy = $derived(
		studies.find(
			(s) =>
				s.modality === 'panoramic' &&
				s.imageDataUrl &&
				(s.inference?.extra?.number_result?.result?.labels?.length ?? 0) > 0
		)
	);
	let panoImgSize = $state<{ width: number; height: number } | null>(null);
	$effect(() => {
		panoImgSize = null;
		const url = panoStudy?.imageDataUrl;
		if (!url) return;
		// Stale-load guard: if the URL changes mid-load (file-token re-bake), or
		// the panoStudy itself swaps, drop the in-flight load's result so it
		// can't overwrite the newer load's dimensions out of order.
		let cancelled = false;
		const img = new Image();
		img.onload = () => {
			if (cancelled) return;
			panoImgSize = { width: img.naturalWidth, height: img.naturalHeight };
		};
		img.src = url;
		return () => {
			cancelled = true;
		};
	});
	const patches = $derived<Map<string, PanoramicPatch>>(
		panoStudy && panoImgSize ? panoramicPatches(panoStudy, panoImgSize) : new Map()
	);
	function patchStyle(p: PanoramicPatch): string {
		const w = Math.max(0.0001, p.rect.w);
		const h = Math.max(0.0001, p.rect.h);
		const sizeX = (100 / w).toFixed(2);
		const sizeY = (100 / h).toFixed(2);
		const posX = w === 1 ? '0%' : ((p.rect.x / (1 - w)) * 100).toFixed(2) + '%';
		const posY = h === 1 ? '0%' : ((p.rect.y / (1 - h)) * 100).toFixed(2) + '%';
		const url = p.source.imageDataUrl!;
		return `background-image:url(${url}); background-size:${sizeX}% ${sizeY}%; background-position:${posX} ${posY}; background-repeat:no-repeat;`;
	}
</script>

<div
	class="nav"
	class:expanded
	role="group"
	aria-label={$_('fmx.navigator')}
	onmouseenter={() => (expanded = true)}
	onmouseleave={() => (expanded = false)}
	onfocusin={() => (expanded = true)}
	onfocusout={(e) => {
		// Only collapse when focus leaves the navigator entirely (relatedTarget is
		// outside the .nav root) — keep expanded while tabbing between cells.
		const root = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (!next || !root.contains(next)) expanded = false;
	}}
>
	<div class="grid">
		{#each FMX_SLOTS as slot (slot.key)}
			{@const study = assignment.get(slot.key)}
			{@const isCurrent = !!study && slot.key === currentSlot}
			{@const dots = findingDots(study)}
			{@const label = slotLabel(slot)}
			{@const patch = study ? undefined : patches.get(slot.key)}
			{#if study}
				<button
					type="button"
					class="cell filled"
					class:current={isCurrent}
					class:pano={slot.modality === 'panoramic'}
					style:grid-area={slot.gridArea}
					aria-label={isCurrent ? `${label} (${$_('fmx.current')})` : label}
					aria-current={isCurrent ? 'true' : undefined}
					onclick={() => onPick?.(study)}
				>
					{#if expanded && study.imageDataUrl}
						<img src={study.imageDataUrl} alt="" class="thumb" />
					{/if}
					{#if dots.length > 0}
						<span class="dots">
							{#each dots as d, i (i)}<span class="dot" style:background={d}></span>{/each}
						</span>
					{/if}
				</button>
			{:else if patch}
				{@const patchIsCurrent = patch.source.id === currentStudyId}
				<button
					type="button"
					class="cell patch"
					class:pano={slot.modality === 'panoramic'}
					class:no-op={patchIsCurrent}
					style:grid-area={slot.gridArea}
					aria-label={`${label} (${$_('fmx.fromPanoramic')})`}
					aria-disabled={patchIsCurrent ? 'true' : undefined}
					tabindex={patchIsCurrent ? -1 : undefined}
					onclick={() => {
						if (!patchIsCurrent) onPick?.(patch.source);
					}}
				>
					{#if expanded}
						<div class="thumb patch-bg" style={patchStyle(patch)} aria-hidden="true"></div>
					{/if}
				</button>
			{:else}
				<div
					class="cell empty"
					class:pano={slot.modality === 'panoramic'}
					style:grid-area={slot.gridArea}
					aria-hidden="true"
				></div>
			{/if}
		{/each}
	</div>
	{#if expanded}
		<div class="hint">{$_('fmx.navigatorHint')}</div>
	{/if}
</div>

<style>
	.nav {
		display: inline-flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 6px;
		border-radius: var(--radius-control);
		background: color-mix(in oklab, var(--color-bg-1) 86%, transparent);
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-pop);
		backdrop-filter: blur(4px);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		grid-template-rows: repeat(3, 1fr);
		gap: 2px;
		width: 154px;
		height: 74px;
		transition:
			width 0.16s var(--ease-out, ease),
			height 0.16s var(--ease-out, ease);
	}
	.nav.expanded .grid {
		width: 460px;
		height: 232px;
		gap: 3px;
	}
	.cell {
		position: relative;
		border-radius: 2px;
		overflow: hidden;
		padding: 0;
	}
	.cell.empty {
		background: color-mix(in oklab, var(--color-fg-3) 18%, transparent);
	}
	.cell.filled {
		background: var(--color-primary-tint);
		border: 1px solid color-mix(in oklab, var(--color-primary) 35%, transparent);
		cursor: pointer;
		transition:
			border-color 0.12s,
			transform 0.12s;
	}
	.cell.filled:hover {
		border-color: var(--color-primary);
		transform: scale(1.04);
	}
	.cell.patch {
		/* Same hover behaviour as a real filled cell, but dashed border to mark
		 * that the thumbnail is derived from the panoramic, not a separately
		 * uploaded partial. */
		background: color-mix(in oklab, var(--color-primary) 18%, transparent);
		border: 1px dashed color-mix(in oklab, var(--color-primary) 60%, transparent);
		cursor: pointer;
		transition:
			border-color 0.12s,
			transform 0.12s;
	}
	.cell.patch:hover {
		border-color: var(--color-primary);
		transform: scale(1.04);
	}
	/* On the 2D viewer of a single-panoramic patient the surrounding patches
	 * all point at the SAME study you're already viewing — clicking would be
	 * a no-op. Don't pretend it's interactive. */
	.cell.patch.no-op {
		cursor: default;
	}
	.cell.patch.no-op:hover {
		border-color: color-mix(in oklab, var(--color-primary) 60%, transparent);
		transform: none;
	}
	.patch-bg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.cell.current {
		outline: 2px solid var(--color-primary);
		outline-offset: -1px;
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-primary) 30%, transparent);
		z-index: 1;
	}
	.thumb {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.cell.pano .thumb {
		object-fit: contain;
	}
	.dots {
		position: absolute;
		top: 2px;
		right: 2px;
		display: flex;
		gap: 2px;
	}
	.dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
	}
	.nav.expanded .dot {
		width: 6px;
		height: 6px;
	}
	.hint {
		font-size: 0.7rem;
		color: var(--color-fg-2);
		text-align: center;
	}
</style>
