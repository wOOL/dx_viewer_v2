<script lang="ts">
	import {
		DISEASE_LABELS,
		FDI_TOOTH_NUMBER_CLASSES,
		SEG_ID2CLS,
		UNI_TOOTH_NUMBER_CLASSES,
		type AnalysisResponse
	} from '@be-certain/core/types';
	import type { FindingState } from './FindingRow.svelte';
	import { anatomyColor, diseaseColor, TOOTH_NUMBER_COLOR } from './label-colors';
	import { patientAnatomy, patientDisease } from './patient-labels';

	type Chip = {
		id: string;
		kind: 'disease' | 'anatomy' | 'tooth';
		bx: number; // image-pixel anchor x
		by: number; // image-pixel anchor y
		label: string;
		color: string;
		confidence?: number;
	};

	type Props = {
		analysis: AnalysisResponse | null;
		layers: { disease: boolean; anatomy: boolean; toothNumbers: boolean };
		scale: number;
		tx: number;
		ty: number;
		fdiNumbering: boolean;
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
		scale,
		tx,
		ty,
		fdiNumbering,
		patientMode,
		liveThreshold,
		findingStates,
		hiddenIds,
		hoveredId,
		selectedId,
		onHover,
		onSelect
	}: Props = $props();

	const diseaseChips = $derived<Chip[]>(
		analysis && layers.disease
			? analysis.extra.disease_result.result.bboxes.flatMap((bbox, i): Chip[] => {
					const id = `disease:${i}`;
					const conf = analysis.extra.disease_result.result.scores[i] ?? 0;
					const labelId = analysis.extra.disease_result.result.labels[i] ?? 19;
					if (findingStates.get(id) === 'dismissed') return [];
					if (conf < liveThreshold) return [];
					if (hiddenIds.has(id)) return [];
					return [
						{
							id,
							kind: 'disease',
							bx: bbox[0]!,
							by: bbox[1]!,
							label: patientMode
								? patientDisease(labelId)
								: DISEASE_LABELS[labelId as keyof typeof DISEASE_LABELS] ?? 'Unknown',
							color: diseaseColor(labelId),
							confidence: conf
						}
					];
				})
			: []
	);

	const anatomyChips = $derived<Chip[]>(
		analysis && layers.anatomy
			? analysis.extra.anatomy_result.result.bboxes.flatMap((bbox, i): Chip[] => {
					const id = `anatomy:${i}`;
					if (findingStates.get(id) === 'dismissed') return [];
					if (hiddenIds.has(id)) return [];
					const labelId = analysis.extra.anatomy_result.result.labels[i] ?? 6;
					return [
						{
							id,
							kind: 'anatomy',
							bx: bbox[0]!,
							by: bbox[1]!,
							label: patientMode
								? patientAnatomy(labelId)
								: SEG_ID2CLS[labelId as keyof typeof SEG_ID2CLS] ?? '',
							color: anatomyColor(labelId),
							confidence: analysis.extra.anatomy_result.result.scores[i]
						}
					];
				})
			: []
	);

	type ToothChip = {
		id: string;
		bcx: number; // bbox centre x in image-pixel coords
		bcy: number;
		label: string;
	};
	const toothChips = $derived<ToothChip[]>(
		analysis && layers.toothNumbers
			? analysis.extra.number_result.result.bboxes.flatMap((bbox, i): ToothChip[] => {
					const id = `tooth:${i}`;
					if (hiddenIds.has(id)) return [];
					const labelId = analysis.extra.number_result.result.labels[i] ?? 0;
					const lookup = fdiNumbering ? FDI_TOOTH_NUMBER_CLASSES : UNI_TOOTH_NUMBER_CLASSES;
					return [
						{
							id,
							bcx: (bbox[0]! + bbox[2]!) / 2,
							bcy: (bbox[1]! + bbox[3]!) / 2,
							label: lookup[labelId] ?? String(labelId + 1)
						}
					];
				})
			: []
	);

	// Convert image-pixel coord to viewport-pixel coord.
	function vx(ix: number) {
		return ix * scale + tx;
	}
	function vy(iy: number) {
		return iy * scale + ty;
	}

	function handleClick(id: string, e: MouseEvent) {
		e.stopPropagation();
		onSelect?.(id);
	}
</script>

<div class="chips" aria-hidden="false">
	{#each diseaseChips as c (c.id)}
		{@const focused = hoveredId === c.id || selectedId === c.id}
		<button
			type="button"
			class="chip"
			class:focused
			class:confirmed={findingStates.get(c.id) === 'confirmed'}
			style:--c={c.color}
			style:left="{vx(c.bx)}px"
			style:top="{vy(c.by)}px"
			onclick={(e) => handleClick(c.id, e)}
			onpointerdown={(e) => e.stopPropagation()}
			onmouseenter={() => onHover?.(c.id)}
			onmouseleave={() => onHover?.(null)}
		>
			<span class="dot"></span>
			<span class="label">{c.label}</span>
			{#if c.confidence !== undefined}
				<span class="conf">{Math.round(c.confidence * 100)}%</span>
			{/if}
		</button>
	{/each}

	{#each anatomyChips as c (c.id)}
		{@const focused = hoveredId === c.id || selectedId === c.id}
		<button
			type="button"
			class="chip anatomy"
			class:focused
			class:confirmed={findingStates.get(c.id) === 'confirmed'}
			style:--c={c.color}
			style:left="{vx(c.bx)}px"
			style:top="{vy(c.by)}px"
			onclick={(e) => handleClick(c.id, e)}
			onpointerdown={(e) => e.stopPropagation()}
			onmouseenter={() => onHover?.(c.id)}
			onmouseleave={() => onHover?.(null)}
		>
			<span class="dot"></span>
			<span class="label">{c.label}</span>
		</button>
	{/each}

	{#each toothChips as c (c.id)}
		{@const focused = hoveredId === c.id || selectedId === c.id}
		<button
			type="button"
			class="tooth"
			class:focused
			style:--c={TOOTH_NUMBER_COLOR}
			style:left="{vx(c.bcx)}px"
			style:top="{vy(c.bcy)}px"
			onclick={(e) => handleClick(c.id, e)}
			onpointerdown={(e) => e.stopPropagation()}
			onmouseenter={() => onHover?.(c.id)}
			onmouseleave={() => onHover?.(null)}
		>
			{c.label}
		</button>
	{/each}
</div>

<style>
	.chips {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 2;
	}
	.chip {
		position: absolute;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 240px;
		padding: 3px 8px 3px 6px;
		transform: translate(0, calc(-100% - 4px));
		background: rgba(15, 28, 38, 0.92);
		border: 1px solid var(--c);
		border-radius: 6px;
		color: #fff;
		font-size: 11px;
		font-family: var(--font-sans);
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: -0.005em;
		white-space: nowrap;
		pointer-events: auto;
		cursor: pointer;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		text-rendering: geometricPrecision;
		-webkit-font-smoothing: antialiased;
		transition: box-shadow 150ms, transform 150ms;
		animation: chip-pop 240ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
	}
	.chip:hover,
	.chip.focused {
		box-shadow: 0 0 0 1px var(--c), 0 0 12px color-mix(in srgb, var(--c) 50%, transparent);
	}
	.chip.confirmed {
		box-shadow: inset 0 0 0 1px var(--c);
	}
	.chip .dot {
		flex: 0 0 auto;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--c);
	}
	.chip .label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip .conf {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--c);
		opacity: 0.9;
		font-feature-settings: 'tnum' 1;
		margin-left: 4px;
	}
	.tooth {
		position: absolute;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		transform: translate(-50%, -50%);
		background: rgba(15, 28, 38, 0.85);
		color: var(--c);
		border: 1.5px solid var(--c);
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: -0.02em;
		pointer-events: auto;
		cursor: pointer;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
		text-rendering: geometricPrecision;
		-webkit-font-smoothing: antialiased;
		transition: box-shadow 150ms, transform 150ms;
		animation: chip-pop 240ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
	}
	.tooth:hover,
	.tooth.focused {
		box-shadow: 0 0 0 1px var(--c), 0 0 10px color-mix(in srgb, var(--c) 50%, transparent);
	}
	@keyframes chip-pop {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
