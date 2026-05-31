<script lang="ts" module>
	export type DetectionId = `disease:${number}` | `anatomy:${number}` | `tooth:${number}`;

	export type DetectionItem = {
		id: DetectionId;
		bbox: [number, number, number, number];
		stroke: string;
		label: string;
		confidence?: number;
		state?: 'confirmed' | 'dismissed';
	};
</script>

<script lang="ts">
	import { DISEASE_LABELS, SEG_ID2CLS, type AnalysisResponse } from '@be-certain/core/types';
	import { anatomyColor, diseaseColor } from './label-colors';
	import { patientAnatomy, patientDisease } from './patient-labels';
	import type { FindingState } from './FindingRow.svelte';
	import { maskToDataUrl } from './rle-decode';

	type Props = {
		analysis: AnalysisResponse | null;
		layers: { disease: boolean; anatomy: boolean; toothNumbers: boolean };
		showMasks: { disease: boolean; anatomy: boolean };
		patientMode: boolean;
		liveThreshold: number;
		findingStates: Map<string, FindingState>;
		hiddenIds: Set<string>;
		hoveredId: string | null;
		selectedId: string | null;
		onHover?: (id: string | null) => void;
		onSelect?: (id: string) => void;
	};
	let {
		analysis,
		layers,
		showMasks,
		patientMode,
		liveThreshold,
		findingStates,
		hiddenIds,
		hoveredId,
		selectedId,
		onHover,
		onSelect
	}: Props = $props();

	const diseaseItems = $derived<DetectionItem[]>(
		analysis
			? analysis.extra.disease_result.result.bboxes.map((bbox, i) => {
					const labelId = analysis.extra.disease_result.result.labels[i] ?? 19;
					const id = `disease:${i}` as const;
					return {
						id,
						bbox: bbox as [number, number, number, number],
						stroke: diseaseColor(labelId),
						label: patientMode
							? patientDisease(labelId)
							: DISEASE_LABELS[labelId as keyof typeof DISEASE_LABELS] ?? 'Unknown',
						confidence: analysis.extra.disease_result.result.scores[i],
						state: findingStates.get(id)
					};
				})
			: []
	);

	const anatomyItems = $derived<DetectionItem[]>(
		analysis
			? analysis.extra.anatomy_result.result.bboxes.map((bbox, i) => {
					const labelId = analysis.extra.anatomy_result.result.labels[i] ?? 6;
					const id = `anatomy:${i}` as const;
					return {
						id,
						bbox: bbox as [number, number, number, number],
						stroke: anatomyColor(labelId),
						label: patientMode
							? patientAnatomy(labelId)
							: SEG_ID2CLS[labelId as keyof typeof SEG_ID2CLS] ?? '',
						confidence: analysis.extra.anatomy_result.result.scores[i],
						state: findingStates.get(id)
					};
				})
			: []
	);

	// Detection passes if confidence ≥ threshold and not dismissed (anatomy ignores threshold).
	function passes(item: DetectionItem, kind: 'disease' | 'anatomy'): boolean {
		if (item.state === 'dismissed') return false;
		if (kind !== 'disease') return true;
		return (item.confidence ?? 0) >= liveThreshold;
	}

	// Decode masks into data-URLs once per analysis. Cached so we don't redo it
	// every render.
	type MaskImg = { id: string; src: string; bbox: [number, number, number, number] };
	const diseaseMasks = $derived<MaskImg[]>(buildMasks('disease'));
	const anatomyMasks = $derived<MaskImg[]>(buildMasks('anatomy'));

	function buildMasks(kind: 'disease' | 'anatomy'): MaskImg[] {
		if (!analysis) return [];
		const res =
			kind === 'disease'
				? analysis.extra.disease_result.result
				: analysis.extra.anatomy_result.result;
		const masks = res.masks;
		if (!masks) return [];
		const colorFn = kind === 'disease' ? diseaseColor : anatomyColor;
		const out: MaskImg[] = [];
		for (let i = 0; i < masks.length; i++) {
			const mask = masks[i];
			const bbox = res.bboxes[i];
			const labelId = res.labels[i];
			if (!mask || !bbox || labelId === undefined) continue;
			const [h, w] = mask.size;
			const src = maskToDataUrl(mask, colorFn(labelId), 0.32);
			if (!src) continue;
			// Mask is rasterised at its own (h, w). Render at full natural image dims
			// because that's the coordinate space the mask was generated in.
			out.push({
				id: `${kind}:${i}`,
				src,
				bbox: [0, 0, w, h]
			});
		}
		return out;
	}

	function handleSelect(id: string, e: Event) {
		e.stopPropagation();
		onSelect?.(id);
	}

	function handleEnter(id: string) {
		onHover?.(id);
	}

	function handleLeave() {
		onHover?.(null);
	}

	function isFocused(id: string) {
		return hoveredId === id || selectedId === id;
	}

	function strokeWidth(id: string) {
		return isFocused(id) ? 3 : 1.75;
	}
</script>

{#snippet detection(item: DetectionItem, idx: number, kind: 'disease' | 'anatomy')}
	{@const hidden = hiddenIds.has(item.id) || !passes(item, kind)}
	{@const [x1, y1, x2, y2] = item.bbox}
	{@const w = Math.max(0, x2 - x1)}
	{@const h = Math.max(0, y2 - y1)}
	{#if !hidden && w > 0 && h > 0}
		<g
			class="det"
			class:focused={isFocused(item.id)}
			class:confirmed={item.state === 'confirmed'}
			style:--i={idx}
			role="button"
			tabindex="0"
			aria-label={item.label}
			onpointerdown={(e) => e.stopPropagation()}
			onclick={(e) => handleSelect(item.id, e)}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					handleSelect(item.id, e);
				}
			}}
			onmouseenter={() => handleEnter(item.id)}
			onmouseleave={handleLeave}
		>
			<rect
				class="det-rect"
				x={x1}
				y={y1}
				width={w}
				height={h}
				fill="transparent"
				stroke={item.stroke}
				stroke-width={strokeWidth(item.id)}
				vector-effect="non-scaling-stroke"
			/>
		</g>
	{/if}
{/snippet}

<g class="mask-layer" class:off={!showMasks.disease || !layers.disease}>
	{#each diseaseMasks as mImg (mImg.id)}
		<image
			href={mImg.src}
			x={mImg.bbox[0]}
			y={mImg.bbox[1]}
			width={mImg.bbox[2] - mImg.bbox[0]}
			height={mImg.bbox[3] - mImg.bbox[1]}
			preserveAspectRatio="none"
		/>
	{/each}
</g>

<g class="mask-layer" class:off={!showMasks.anatomy || !layers.anatomy}>
	{#each anatomyMasks as mImg (mImg.id)}
		<image
			href={mImg.src}
			x={mImg.bbox[0]}
			y={mImg.bbox[1]}
			width={mImg.bbox[2] - mImg.bbox[0]}
			height={mImg.bbox[3] - mImg.bbox[1]}
			preserveAspectRatio="none"
		/>
	{/each}
</g>

<g class="layer" class:off={!layers.disease}>
	{#each diseaseItems as item, i (item.id)}
		{@render detection(item, i, 'disease')}
	{/each}
</g>

<g class="layer" class:off={!layers.anatomy}>
	{#each anatomyItems as item, i (item.id)}
		{@render detection(item, i + diseaseItems.length, 'anatomy')}
	{/each}
</g>

<!--
	Tooth bounding boxes intentionally omitted — the round number badge rendered
	by LabelChips is the wayfinding indicator. The layers.toothNumbers toggle
	still controls badge visibility via LabelChips.
-->

<style>
	.layer,
	.mask-layer {
		opacity: 1;
		transition: opacity 200ms ease-out;
	}
	.layer.off,
	.mask-layer.off {
		opacity: 0;
		pointer-events: none;
	}
	.mask-layer {
		pointer-events: none;
		mix-blend-mode: screen;
	}
	.mask-layer image {
		image-rendering: pixelated;
		image-rendering: crisp-edges;
	}
	.det {
		pointer-events: auto;
		cursor: pointer;
		opacity: 0;
		animation: pop 320ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
		animation-delay: calc(var(--i, 0) * 22ms);
		outline: none;
	}
	.det:focus-visible .det-rect {
		filter: drop-shadow(0 0 6px currentColor);
	}
	.det-rect {
		transition: stroke-width 150ms ease-out;
	}
	.det.focused .det-rect {
		filter: drop-shadow(0 0 8px currentColor);
	}
	.det.confirmed .det-rect {
		stroke-dasharray: none;
		filter: drop-shadow(0 0 4px currentColor);
	}
	@keyframes pop {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
