<script lang="ts">
	import { ChevronDown, ChevronRight, EyeOff } from 'lucide-svelte';
	import {
		DIAGNOSTIC_GROUPS,
		PEARL_FINDING_TAXONOMY,
		diseaseById,
		toothLabel,
		toothDisplay,
		type DiagnosticGroup
	} from '$lib/constants';
	import { diseaseShortLabel } from '$lib/diseaseLabel';
	import type { InferenceResponse } from '$lib/types';
	import { groupDiseasesByTooth, type Tooth, type DiseaseRef } from '$lib/toothMap';
	import { _ } from 'svelte-i18n';
	import { onDestroy } from 'svelte';

	interface LayerToggles {
		bboxes: boolean;
		toothNumbers: boolean;
		anatomy: boolean;
		diseaseSeg: boolean;
		measurements: boolean;
		visibleClasses: Set<number>;
	}

	interface Props {
		inference: InferenceResponse | null;
		layers: LayerToggles;
		confThreshold?: number;
		onLayersChange: (l: LayerToggles) => void;
		/** Highlight a set of disease-detection indices on the canvas (the rest dim), or
		 *  clear with null. Driven by hovering a finding row or selecting a tooth. */
		onHighlight?: (indices: number[] | null) => void;
		/** Hide/remove a single finding (the per-row control in the by-disease view). */
		onEditFinding?: (effIndex: number) => void;
	}

	// eslint-disable-next-line svelte/no-unused-props -- only layers.visibleClasses is read here; the other layer fields pass through untouched via {...layers} in onLayersChange (the rule is spread-blind)
	let {
		inference,
		layers,
		confThreshold = 0,
		onLayersChange,
		onHighlight,
		onEditFinding
	}: Props = $props();

	const taxonomyIds = new Set(PEARL_FINDING_TAXONOMY.flatMap((r) => r.ids));

	// List findings either BY DISEASE (grouped) or BY TOOTH (regrouped under each tooth).
	let viewMode = $state<'disease' | 'tooth'>('disease');

	interface FindingItem {
		index: number; // index into the effective disease_result (what the canvas highlights)
		label: number;
		score: number;
		source: 'ai' | 'user';
	}

	const findingItems = $derived.by<FindingItem[]>(() => {
		const dz = inference?.extra?.disease_result?.result;
		if (!dz?.labels) return [];
		const items: FindingItem[] = [];
		for (let i = 0; i < dz.labels.length; i++) {
			const label = dz.labels[i]!;
			const score = dz.scores?.[i] ?? 0;
			if (score < confThreshold || !taxonomyIds.has(label)) continue;
			items.push({ index: i, label, score, source: dz.sources?.[i] === 'user' ? 'user' : 'ai' });
		}
		return items;
	});

	// Each diagnostic group (Dental Caries + Bone Loss grouped; every other disease its own
	// row) with the findings that fall under it.
	const groups = $derived(
		DIAGNOSTIC_GROUPS.map((g) => {
			const ids = new Set(g.classIds);
			return { ...g, items: findingItems.filter((it) => ids.has(it.label)) };
		})
	);
	// Only show a group that actually has ≥1 finding — a disease the AI didn't detect on
	// this study shouldn't appear as a "0" row (clinician request).
	const nonEmptyGroups = $derived(groups.filter((g) => g.items.length > 0));
	const totalCount = $derived(findingItems.length);

	function groupName(g: DiagnosticGroup): string {
		return g.labelKey ? $_(g.labelKey) : diseaseShortLabel(g.labelClassId ?? -1, $_);
	}

	const allClassIds = DIAGNOSTIC_GROUPS.flatMap((g) => g.classIds);
	const anyVisible = $derived(allClassIds.some((id) => layers.visibleClasses.has(id)));

	function groupVisible(classIds: number[]): boolean {
		return classIds.length > 0 && classIds.every((id) => layers.visibleClasses.has(id));
	}
	function toggleGroup(classIds: number[]) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- create-and-replace local; emitted via onLayersChange, never mutated reactively
		const next = new Set(layers.visibleClasses);
		const allOn = classIds.every((id) => next.has(id));
		for (const id of classIds) {
			if (allOn) next.delete(id);
			else next.add(id);
		}
		onLayersChange({ ...layers, visibleClasses: next });
	}
	function toggleAll() {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- create-and-replace local; emitted via onLayersChange, never mutated reactively
		const next = new Set(layers.visibleClasses);
		if (anyVisible) for (const id of allClassIds) next.delete(id);
		else for (const id of allClassIds) next.add(id);
		onLayersChange({ ...layers, visibleClasses: next });
	}

	let expanded = $state<Set<string>>(new Set());
	function toggleExpand(key: string) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- create-and-replace local: rebuilt then REASSIGNED to the $state (reassignment drives reactivity)
		const next = new Set(expanded);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expanded = next;
	}

	function hoverFinding(index: number) {
		onHighlight?.([index]);
	}
	function clearHover() {
		onHighlight?.(null);
	}

	function certaintyText(it: FindingItem): string {
		if (it.source === 'user') return $_('findings.addedByYou');
		return $_('findings.certaintyPct', { values: { pct: Math.round(it.score * 100) } });
	}

	// --- By-tooth view ---------------------------------------------------------
	// Regroup each detection under the tooth it sits on (geometric association — the AI
	// ships disease + tooth boxes separately). Same threshold + taxonomy filter as above.
	const teeth = $derived.by<Tooth[]>(() => {
		const tn = inference?.extra?.number_result?.result;
		if (!tn?.bboxes || !tn.labels) return [];
		return tn.bboxes.map((box, index) => ({ index, label: tn.labels[index]!, box }));
	});
	const diseaseRefs = $derived.by<DiseaseRef[]>(() => {
		const dz = inference?.extra?.disease_result?.result;
		if (!dz?.bboxes || !dz.labels) return [];
		const refs: DiseaseRef[] = [];
		for (let i = 0; i < dz.bboxes.length; i++) {
			const label = dz.labels[i]!;
			const score = dz.scores?.[i] ?? 0;
			if (score < confThreshold || !taxonomyIds.has(label)) continue;
			refs.push({ index: i, label, box: dz.bboxes[i]!, score });
		}
		return refs;
	});
	const toothView = $derived(groupDiseasesByTooth(diseaseRefs, teeth));

	let activeTooth = $state<number | null>(null);
	function selectTooth(toothIndex: number, diseaseIndices: number[]) {
		if (activeTooth === toothIndex) {
			activeTooth = null;
			onHighlight?.(null);
		} else {
			activeTooth = toothIndex;
			onHighlight?.(diseaseIndices);
		}
	}
	function setViewMode(m: 'disease' | 'tooth') {
		if (m === viewMode) return;
		viewMode = m;
		activeTooth = null;
		onHighlight?.(null);
	}
	// The number to SHOW for a tooth heading, honouring the Universal/FDI preference.
	function toothHeading(t: Tooth): string {
		return toothDisplay(Number(toothLabel(t.label, true)));
	}

	onDestroy(() => onHighlight?.(null));
</script>

<div class="flex h-full w-full flex-col bg-bg-1">
	<!-- Diagnostic Results header + master Hide All / Show All -->
	<div class="flex items-center justify-between border-b border-border px-3 py-2.5">
		<div>
			<div class="text-[13px] font-semibold text-fg-0">{$_('findings.diagnosticResults')}</div>
			<div class="text-[10px] text-fg-2">
				{$_('findings.detected', { values: { count: totalCount } })}
			</div>
		</div>
		<button
			type="button"
			class="hideall"
			data-testid="findings-hide-all"
			aria-pressed={!anyVisible}
			onclick={toggleAll}
			disabled={totalCount === 0}
		>
			{anyVisible ? $_('findings.hideAll') : $_('findings.showAll')}
		</button>
	</div>

	<!-- View mode: by disease (the grouped taxonomy) or by tooth. -->
	<div class="viewmode" role="tablist" aria-label={$_('findings.viewBy')}>
		<button
			type="button"
			role="tab"
			class="viewmode-btn"
			class:active={viewMode === 'disease'}
			aria-selected={viewMode === 'disease'}
			onclick={() => setViewMode('disease')}>{$_('findings.byDisease')}</button
		>
		<button
			type="button"
			role="tab"
			class="viewmode-btn"
			class:active={viewMode === 'tooth'}
			aria-selected={viewMode === 'tooth'}
			onclick={() => setViewMode('tooth')}>{$_('findings.byTooth')}</button
		>
	</div>

	<div class="flex-1 overflow-y-auto py-1">
		{#if totalCount === 0}
			<div class="px-3 py-6 text-center text-[11px] text-fg-2">{$_('findings.noFindings')}</div>
		{:else if viewMode === 'disease'}
			{#each nonEmptyGroups as g (g.key)}
				{@const isOpen = expanded.has(g.key)}
				{@const visible = groupVisible(g.classIds)}
				<div class="grp">
					<div class="grp-header">
						<button
							type="button"
							class="grp-toggle"
							aria-expanded={isOpen}
							onclick={() => toggleExpand(g.key)}
						>
							{#if isOpen}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}
							<span class="grp-dot" style:background={g.color}></span>
							<span class="grp-name">{groupName(g)}</span>
							<span class="grp-count">{g.items.length}</span>
						</button>
						<button
							type="button"
							class="showhide"
							class:on={visible}
							aria-pressed={visible}
							onclick={() => toggleGroup(g.classIds)}
						>
							{visible ? $_('findings.hide') : $_('findings.show')}
						</button>
					</div>
					{#if isOpen}
						<div class="grp-items">
							{#each g.items as it (it.index)}
								<div class="fi">
									<button
										type="button"
										class="fi-main"
										onmouseenter={() => hoverFinding(it.index)}
										onmouseleave={clearHover}
										onfocus={() => hoverFinding(it.index)}
										onblur={clearHover}
										onclick={() => hoverFinding(it.index)}
									>
										<span class="fi-dot" style:background={diseaseById(it.label).color}></span>
										<span class="fi-text">
											<span class="fi-name">{diseaseShortLabel(it.label, $_)}</span>
											<span class="fi-cert">{certaintyText(it)}</span>
										</span>
									</button>
									{#if onEditFinding}
										<button
											type="button"
											class="fi-edit"
											title={$_('findings.hideFinding')}
											aria-label={$_('findings.hideFinding')}
											onclick={() => onEditFinding(it.index)}
										>
											<EyeOff size={12} />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{:else}
			<!-- By-tooth: each tooth with ≥1 finding; clicking highlights its boxes. -->
			<div class="py-1">
				{#each toothView.groups as g (g.tooth.index)}
					<button
						type="button"
						class="tooth-row"
						class:active={activeTooth === g.tooth.index}
						aria-pressed={activeTooth === g.tooth.index}
						onclick={() =>
							selectTooth(
								g.tooth.index,
								g.diseases.map((d) => d.index)
							)}
					>
						<span class="tooth-num"
							>{$_('findings.toothN', { values: { n: toothHeading(g.tooth) } })}</span
						>
						<span class="tooth-diseases">
							{#each g.diseases as d (d.index)}
								<span class="tooth-chip" style:border-color={diseaseById(d.label).color}>
									<span class="dot" style:background={diseaseById(d.label).color}></span>
									{diseaseShortLabel(d.label, $_)}
								</span>
							{/each}
						</span>
					</button>
				{/each}
				{#if toothView.unassigned.length > 0}
					<div class="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-fg-2 uppercase">
						{$_('findings.unassigned')}
					</div>
					{#each toothView.unassigned as d (d.index)}
						<div class="tooth-row" style="cursor: default;">
							<span class="tooth-diseases">
								<span class="tooth-chip" style:border-color={diseaseById(d.label).color}>
									<span class="dot" style:background={diseaseById(d.label).color}></span>
									{diseaseShortLabel(d.label, $_)}
								</span>
							</span>
						</div>
					{/each}
				{/if}
			</div>
		{/if}

		{#if inference?.extra?.anatomy_result?.extra?.anomaly}
			<div class="mx-3 mt-3 rounded-md bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
				⚠ {$_('findings.anomaly')}
			</div>
		{/if}
	</div>
</div>

<style>
	.hideall {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-fg-1);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0.2rem 0.7rem;
		cursor: pointer;
	}
	.hideall:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-fg-0);
	}
	.hideall:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.viewmode {
		display: flex;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}
	.viewmode-btn {
		flex: 1;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		color: var(--color-fg-2);
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.3rem 0.4rem;
		cursor: pointer;
		transition:
			background 0.12s,
			color 0.12s,
			border-color 0.12s;
	}
	.viewmode-btn:hover {
		color: var(--color-fg-0);
	}
	.viewmode-btn.active {
		background: var(--color-primary-tint);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	.grp {
		border-bottom: 1px solid var(--color-border);
	}
	.grp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
	}
	.grp-toggle {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		color: var(--color-fg-0);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0;
		text-align: left;
	}
	.grp-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.grp-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.grp-count {
		font-variant-numeric: tabular-nums;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--color-fg-2);
		background: var(--color-bg-2);
		border-radius: 999px;
		min-width: 1.25rem;
		text-align: center;
		padding: 0 0.35rem;
	}
	.showhide {
		flex-shrink: 0;
		font-size: 0.66rem;
		font-weight: 600;
		color: var(--color-fg-2);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.15rem 0.55rem;
		cursor: pointer;
	}
	.showhide.on {
		color: var(--color-primary);
		border-color: var(--color-primary);
		background: var(--color-primary-tint);
	}
	.showhide:hover {
		color: var(--color-fg-0);
	}
	.grp-items {
		padding: 0 0 0.4rem;
	}
	.fi {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		padding: 0 0.6rem 0 1.1rem;
		border-left: 2px solid transparent;
	}
	.fi:hover,
	.fi:focus-within {
		background: var(--color-bg-2);
		border-left-color: var(--color-primary);
	}
	.fi-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		text-align: left;
		padding: 0.35rem 0.15rem;
		cursor: pointer;
	}
	.fi-main:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
		border-radius: 0.25rem;
	}
	.fi-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.fi-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		line-height: 1.25;
	}
	.fi-name {
		font-size: 0.74rem;
		color: var(--color-fg-1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fi-cert {
		font-size: 0.64rem;
		color: var(--color-fg-2);
	}
	.fi-edit {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 0.3rem;
		color: var(--color-fg-3);
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.fi-edit:hover {
		color: var(--color-danger);
		background: var(--color-bg-3);
	}
	/* By-tooth rows */
	.tooth-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.75rem;
		background: transparent;
		border: none;
		border-left: 2px solid transparent;
		text-align: left;
		cursor: pointer;
		transition: background 0.12s;
	}
	.tooth-row:hover {
		background: var(--color-bg-2);
	}
	.tooth-row.active {
		background: var(--color-primary-tint);
		border-left-color: var(--color-primary);
	}
	.tooth-num {
		flex-shrink: 0;
		min-width: 3.2rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--color-fg-0);
		padding-top: 0.1rem;
	}
	.tooth-diseases {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.tooth-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.68rem;
		color: var(--color-fg-1);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
	}
	.tooth-chip .dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
</style>
