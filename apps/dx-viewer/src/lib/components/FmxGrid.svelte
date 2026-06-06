<script lang="ts">
	import type { StoredStudy } from '$lib/types';
	import {
		FMX_SLOTS,
		assignStudiesToSlots,
		findingDots,
		panoramicPatches,
		type FmxSlot,
		type PanoramicPatch
	} from '$lib/fmx';
	import { _ } from 'svelte-i18n';
	import { ImageOff } from 'lucide-svelte';

	interface Props {
		studies: StoredStudy[];
		onOpen?: (study: StoredStudy) => void;
	}

	let { studies, onOpen }: Props = $props();

	// Anatomic study→slot mapping is shared with the 2D viewer's FmxNavigator (so a
	// study sits in the same place in both). See $lib/fmx.
	const assignment = $derived(assignStudiesToSlots(studies));
	const slotLabel = (slot: FmxSlot) =>
		slot.labelArg ? `${$_(slot.labelKey)} ${slot.labelArg}` : $_(slot.labelKey);

	// When a panoramic is present AND it has tooth-number bboxes (the AI located
	// the teeth in the image), derive a per-slot crop so empty FMX slots aren't
	// just placeholders — they show the relevant region of the panoramic.
	// Real partial X-rays still win their slot (see render order below).
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
		// Load the panoramic's natural dims (needed to convert pixel bboxes →
		// 0..1 fractions). Reset when the pano changes.
		panoImgSize = null;
		const url = panoStudy?.imageDataUrl;
		if (!url) return;
		// Stale-load guard — mirrors FmxNavigator. Without it, an older load's
		// onload can fire AFTER a newer URL's load resolved (file-token rebake)
		// and overwrite the dimensions, drifting every FMX patch off-slot.
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
		// background-image fills the cell with the slice of the panoramic that
		// contains this slot's teeth: scale the image up by 1/rect.w (so the
		// crop becomes 100% wide) and shift it left/up by rect.x / rect.w.
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

<div class="fmx-grid">
	{#each FMX_SLOTS as slot (slot.key)}
		{@const study = assignment.get(slot.key)}
		{@const dots = findingDots(study)}
		{@const label = slotLabel(slot)}
		{@const patch = study ? undefined : patches.get(slot.key)}
		<button
			type="button"
			class="slot"
			class:filled={!!study}
			class:patch={!!patch}
			class:pano={slot.modality === 'panoramic'}
			class:tall={slot.orientation === 'tall'}
			style:grid-area={slot.gridArea}
			onclick={() => {
				if (study) onOpen?.(study);
				else if (patch) onOpen?.(patch.source);
			}}
			disabled={!study && !patch}
			aria-label={patch ? `${label} (${$_('fmx.fromPanoramic')})` : label}
		>
			{#if study?.imageDataUrl}
				<img src={study.imageDataUrl} alt={label} loading="lazy" class="slot-img" />
				<div class="slot-label">{label}</div>
				{#if dots.length > 0}
					<div class="finding-dots">
						{#each dots as d, i (i)}
							<span class="finding-dot" style:background={d}></span>
						{/each}
					</div>
				{/if}
			{:else if patch}
				<div class="patch-bg" style={patchStyle(patch)} aria-hidden="true"></div>
				<div class="slot-label">{label}</div>
				<div class="patch-badge" title={$_('fmx.fromPanoramic')}>P</div>
			{:else}
				<div class="empty">
					<ImageOff size={18} class="text-fg-3" />
					<div class="slot-label-empty">{label}</div>
				</div>
			{/if}
		</button>
	{/each}
</div>

<style>
	.fmx-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		grid-template-rows: 1.4fr 0.95fr 1.4fr;
		gap: 4px;
		width: 100%;
		height: 100%;
		padding: 6px;
	}
	.slot {
		position: relative;
		background: var(--color-canvas);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		overflow: hidden;
		padding: 0;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.slot:hover:not(:disabled) {
		border-color: var(--color-primary);
	}
	.slot:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.slot-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.slot.pano .slot-img {
		object-fit: contain;
	}
	.patch-bg {
		position: absolute;
		inset: 0;
		display: block;
	}
	.slot.patch {
		/* Slight visual hint that this is a derived crop, not a separately uploaded
		 * partial film — softer border and a P badge in the corner. */
		border-style: dashed;
	}
	.patch-badge {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 14px;
		width: 14px;
		border-radius: 3px;
		background: color-mix(in oklab, var(--color-primary) 80%, transparent);
		color: var(--color-on-primary);
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0;
		pointer-events: none;
	}
	.slot-label {
		position: absolute;
		top: 4px;
		left: 4px;
		background: rgba(0, 0, 0, 0.55);
		color: rgba(255, 255, 255, 0.9);
		font-size: 9px;
		padding: 1px 5px;
		border-radius: 3px;
		pointer-events: none;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.slot-label-empty {
		font-size: 10px;
		color: var(--color-fg-3);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		width: 100%;
		height: 100%;
		background: var(--color-bg-2);
	}
	.finding-dots {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		gap: 3px;
	}
	.finding-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
</style>
