<script lang="ts">
	import { ChevronDown, ChevronRight } from 'lucide-svelte';
	import { _ } from 'svelte-i18n';
	import { toothDisplay } from '$lib/constants';
	import { findingTypeLabel } from '@be-certain/imaging-3d/findingLabel';
	import { meshDisplayName } from '@be-certain/imaging-3d/meshLabel';
	import type { CbctStore } from '@be-certain/imaging-3d/state';

	interface MeshInfo {
		name: string;
		color: [number, number, number];
		triangles: number;
		bbox: { x: number; y: number; z: number };
	}

	interface Props {
		store: CbctStore;
		findings?: {
			tooth: number | string;
			severity: 'low' | 'med' | 'high';
			type: string;
			confidence?: number;
		}[];
		anatomyCounts?: {
			teeth?: number;
			jaws?: number;
			canals?: number;
			structures?: number;
		};
		meshInfos?: MeshInfo[];
		meshNameLabel?: Record<string, string>;
		/** mesh name → sort rank (jaws → teeth-FDI → canals → unmapped); from layerSortRank. */
		meshSortRank?: Record<string, number>;
		hiddenMeshes?: string[];
		reduceNoise?: boolean;
		ontoggleMesh?: (name: string) => void;
		ontoggleReduceNoise?: () => void;
	}
	const {
		store,
		findings = [],
		anatomyCounts = {},
		meshInfos = [],
		meshNameLabel = {},
		meshSortRank = {},
		hiddenMeshes = [],
		reduceNoise = false,
		ontoggleMesh,
		ontoggleReduceNoise
	}: Props = $props();

	function rgbCss(c: [number, number, number]) {
		return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
	}

	let anatomyOpen = $state(true);
	let perioOpen = $state(true);
	let restOpen = $state(true);
	let endoOpen = $state(true);
	let surgOpen = $state(true);
	let layersOpen = $state(true);

	const PERIO_KEYWORDS = /bone|periodontal|gingiv|perio|attachment/i;
	const REST_KEYWORDS = /caries|filling|crown|restoration|bridge|implant|onlay|inlay|margin/i;
	const ENDO_KEYWORDS = /pulp|root\s?canal|periapical|apex|endo|resorption/i;
	// Surgical bucket mirrors CbctReport.findingCategory — without it, "Missing tooth
	// (segmentation gap)" findings (the only type synthesizedFindings emits) match no
	// section and silently vanish from this sidebar while still showing in the Report.
	const SURG_KEYWORDS = /impact|extract|missing|fracture|cyst|tumor|surgical/i;

	// Order Layers as jaws → teeth (anatomic FDI sequence) → canals → unmapped,
	// using the geometry-derived rank (layerSortRank). A previous name-prefix sort
	// silently failed — the AI ships generic VTK names ("Mesh N"), so nothing matched
	// "Jaw/Tooth/Canal" and it fell back to an ALPHABETICAL label sort (Canal before
	// Jaw before Tooth, teeth string-ordered 1,10,11,…,2,…). Stable within a rank.
	const sortedMeshInfos = $derived(
		[...meshInfos].sort((a, b) => (meshSortRank[a.name] ?? 1e9) - (meshSortRank[b.name] ?? 1e9))
	);

	const perioFindings = $derived(findings.filter((f) => PERIO_KEYWORDS.test(f.type)));
	const restFindings = $derived(findings.filter((f) => REST_KEYWORDS.test(f.type)));
	const endoFindings = $derived(findings.filter((f) => ENDO_KEYWORDS.test(f.type)));
	const surgFindings = $derived(findings.filter((f) => SURG_KEYWORDS.test(f.type)));

	function severityColor(s: 'low' | 'med' | 'high') {
		if (s === 'high') return 'bg-danger-500';
		if (s === 'med') return 'bg-warning-500';
		return 'bg-fg-3';
	}
</script>

<aside
	class="flex w-[290px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-bg-1 p-3 text-sm"
>
	<!-- Anatomy -->
	<section class="rounded-md border border-border bg-bg-2/40">
		<button
			class="flex w-full items-center justify-between px-3 py-2 text-left font-semibold text-fg-0"
			onclick={() => (anatomyOpen = !anatomyOpen)}
		>
			{$_('cbct.anatomy')}
			{#if anatomyOpen}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
		</button>
		{#if anatomyOpen}
			<div class="grid grid-cols-2 gap-1 px-3 pb-3 text-xs text-fg-2">
				{#if anatomyCounts.structures !== undefined && !anatomyCounts.teeth}
					<div class="col-span-2 flex justify-between">
						<span>{$_('cbct.structures')}</span><span class="text-fg-0"
							>{anatomyCounts.structures}</span
						>
					</div>
					<div class="col-span-2 text-[10px] text-fg-2">
						{$_('cbct.smallVolumeNote')}
					</div>
				{:else}
					<div class="flex justify-between">
						<span>{$_('cbct.teeth')}</span><span class="text-fg-0"
							>{anatomyCounts.teeth ?? '—'}</span
						>
					</div>
					<div class="flex justify-between">
						<span>{$_('cbct.jaws')}</span><span class="text-fg-0">{anatomyCounts.jaws ?? '—'}</span>
					</div>
					<div class="flex justify-between">
						<span>{$_('cbct.canals')}</span><span class="text-fg-0"
							>{anatomyCounts.canals ?? '—'}</span
						>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Layers -->
	<section class="rounded-md border border-border bg-bg-2/40">
		<button
			class="flex w-full items-center justify-between px-3 py-2 text-left font-semibold text-fg-0"
			onclick={() => (layersOpen = !layersOpen)}
		>
			{$_('cbct.layers')}
			{#if layersOpen}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
		</button>
		{#if layersOpen}
			<div class="flex flex-col gap-1 px-3 pb-3 text-xs">
				{#if meshInfos.length > 0}
					{#each sortedMeshInfos as m (m.name)}
						<label class="flex items-center justify-between text-fg-1">
							<span class="flex min-w-0 items-center gap-2">
								<span
									class="size-3 shrink-0 rounded-sm border border-bg-0/40"
									style:background={rgbCss(m.color)}
								></span>
								<span class="truncate">{meshNameLabel[m.name] ?? meshDisplayName(m.name, $_)}</span>
							</span>
							<input
								type="checkbox"
								checked={!hiddenMeshes.includes(m.name)}
								onchange={() => ontoggleMesh?.(m.name)}
								class="checkbox shrink-0"
							/>
						</label>
					{/each}
				{:else}
					<div class="text-fg-2">{$_('cbct.layersHint')}</div>
				{/if}
				<label
					class="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px] text-fg-2"
				>
					<span class="flex flex-col">
						<span>{$_('cbct.reduceNoise')}</span>
						<span class="text-[10px] text-fg-2">{$_('cbct.reduceNoiseHint')}</span>
					</span>
					<input
						type="checkbox"
						checked={reduceNoise}
						onchange={() => ontoggleReduceNoise?.()}
						class="checkbox"
					/>
				</label>
			</div>
		{/if}
	</section>

	<!-- Window/Level -->
	<section class="rounded-md border border-border bg-bg-2/40 p-3 text-xs text-fg-2">
		<div class="mb-2 font-semibold text-fg-0">{$_('cbct.windowLevel')}</div>
		<label class="mb-2 block">
			<div class="flex justify-between">
				<span>{$_('cbct.window')}</span><span class="text-fg-0">{Math.round(store.windowVal)}</span>
			</div>
			<input
				type="range"
				min="50"
				max="4000"
				step="10"
				value={store.windowVal}
				oninput={(e) => (store.windowVal = +(e.currentTarget as HTMLInputElement).value)}
				class="w-full accent-primary"
			/>
		</label>
		<label class="mb-2 block">
			<div class="flex justify-between">
				<span>{$_('cbct.level')}</span><span class="text-fg-0">{Math.round(store.levelVal)}</span>
			</div>
			<input
				type="range"
				min="-1500"
				max="3000"
				step="10"
				value={store.levelVal}
				oninput={(e) => (store.levelVal = +(e.currentTarget as HTMLInputElement).value)}
				class="w-full accent-primary"
			/>
		</label>
		<button
			class="hover:bg-bg-4 mt-1 w-full rounded-md bg-bg-3 px-2 py-1 text-fg-1"
			onclick={() => store.resetWL()}
		>
			{$_('cbct.resetWL')}
		</button>
	</section>

	<!-- Findings -->
	{#snippet section(title: string, list: typeof findings, open: boolean, toggle: () => void)}
		<section class="rounded-md border border-border bg-bg-2/40">
			<button
				class="flex w-full items-center justify-between px-3 py-2 text-left font-semibold text-fg-0"
				onclick={toggle}
			>
				<span class="flex items-center gap-2">
					{title}
					<span class="text-xs text-fg-2">({list.length})</span>
				</span>
				{#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
			</button>
			{#if open}
				<div class="flex flex-col gap-1 px-3 pb-3 text-xs">
					{#each list as f, i (i)}
						<div class="flex items-center justify-between gap-2 rounded-md bg-bg-1 px-2 py-1">
							<span class="flex items-center gap-2">
								<span class="size-2 rounded-full {severityColor(f.severity)}"></span>
								<span class="text-fg-1">{findingTypeLabel(f.type, $_)}</span>
							</span>
							<span class="text-fg-2">#{toothDisplay(Number(f.tooth))}</span>
						</div>
					{:else}
						<span class="text-fg-2">{$_('cbct.noFindings')}</span>
					{/each}
				</div>
			{/if}
		</section>
	{/snippet}

	{@render section($_('cbct.perio'), perioFindings, perioOpen, () => (perioOpen = !perioOpen))}
	{@render section($_('cbct.restorative'), restFindings, restOpen, () => (restOpen = !restOpen))}
	{@render section($_('cbct.endo'), endoFindings, endoOpen, () => (endoOpen = !endoOpen))}
	{@render section($_('cbct.surgical'), surgFindings, surgOpen, () => (surgOpen = !surgOpen))}
</aside>

<style>
	.checkbox {
		accent-color: var(--color-primary);
	}
</style>
