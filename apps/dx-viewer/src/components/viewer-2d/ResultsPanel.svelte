<script lang="ts" module>
	export type Tab = 'findings' | 'report';
	export type SortMode = 'default' | 'severity' | 'confidence';
	export type GroupMode = 'type' | 'tooth';
</script>

<script lang="ts">
	import {
		DISEASE_LABELS,
		FDI_TOOTH_NUMBER_CLASSES,
		SEG_ID2CLS,
		UNI_TOOTH_NUMBER_CLASSES,
		type AnalysisResponse
	} from '@be-certain/core/types';
	import { tick } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import AnomalyBanner from './AnomalyBanner.svelte';
	import FindingRow, { type FindingState, type TopKEntry } from './FindingRow.svelte';
	import { anatomyColor, diseaseColor, TOOTH_NUMBER_COLOR } from './label-colors';
	import MarkdownReport from './MarkdownReport.svelte';
	import { patientAnatomy, patientDisease } from './patient-labels';
	import { severityFor, severityRank, type Severity } from './severity';
	import { assignToTeeth } from './tooth-assignment';

	type Props = {
		analysis: AnalysisResponse | null;
		fdiNumbering: boolean;
		selectedId: string | null;
		hoveredId: string | null;
		hiddenIds: Set<string>;
		findingStates: Map<string, FindingState>;
		liveThreshold: number;
		sortBy: SortMode;
		groupBy: GroupMode;
		patientMode: boolean;
		tab?: Tab;
		onSelect: (id: string) => void;
		onHover: (id: string | null) => void;
		onToggle: (id: string) => void;
		onSetState: (id: string, state: FindingState | undefined) => void;
		onSortChange: (s: SortMode) => void;
		onGroupChange: (g: GroupMode) => void;
		onPatientModeChange: (b: boolean) => void;
		onTabChange?: (tab: Tab) => void;
	};
	let {
		analysis,
		fdiNumbering,
		selectedId,
		hoveredId,
		hiddenIds,
		findingStates,
		liveThreshold,
		sortBy,
		groupBy,
		patientMode,
		tab = $bindable('findings'),
		onSelect,
		onHover,
		onToggle,
		onSetState,
		onSortChange,
		onGroupChange,
		onPatientModeChange,
		onTabChange
	}: Props = $props();

	type Row = {
		id: string;
		label: string;
		color: string;
		confidence: number;
		severity?: Severity | null;
		topK?: TopKEntry[] | null;
		labelId: number;
		toothIdx: number;
		bboxIdx: number;
		kind: 'disease' | 'anatomy';
	};

	function topKFor(probs: number[] | undefined, k = 3): TopKEntry[] | null {
		if (!probs) return null;
		return probs
			.map((prob, labelId) => ({
				labelId,
				prob,
				label: DISEASE_LABELS[labelId as keyof typeof DISEASE_LABELS] ?? 'Unknown'
			}))
			.sort((a, b) => b.prob - a.prob)
			.slice(0, k);
	}

	const diseaseBoxes = $derived(analysis?.extra.disease_result.result.bboxes ?? []);
	const anatomyBoxes = $derived(analysis?.extra.anatomy_result.result.bboxes ?? []);
	const toothBoxes = $derived(analysis?.extra.number_result.result.bboxes ?? []);

	const diseaseToTooth = $derived(assignToTeeth(diseaseBoxes, toothBoxes));
	const anatomyToTooth = $derived(assignToTeeth(anatomyBoxes, toothBoxes));

	const allDiseaseRows = $derived<Row[]>(
		analysis
			? analysis.extra.disease_result.result.bboxes.map((_, i) => {
					const labelId = analysis.extra.disease_result.result.labels[i] ?? 19;
					const confidence = analysis.extra.disease_result.result.scores[i] ?? 0;
					const probs = analysis.extra.disease_result.extra?.class_probs?.[i];
					return {
						id: `disease:${i}`,
						label: patientMode
							? patientDisease(labelId)
							: DISEASE_LABELS[labelId as keyof typeof DISEASE_LABELS] ?? 'Unknown',
						color: diseaseColor(labelId),
						confidence,
						severity: severityFor(labelId),
						topK: topKFor(probs),
						labelId,
						toothIdx: diseaseToTooth[i] ?? -1,
						bboxIdx: i,
						kind: 'disease'
					};
				})
			: []
	);

	const allAnatomyRows = $derived<Row[]>(
		analysis
			? analysis.extra.anatomy_result.result.bboxes.map((_, i) => {
					const labelId = analysis.extra.anatomy_result.result.labels[i] ?? 6;
					return {
						id: `anatomy:${i}`,
						label: patientMode
							? patientAnatomy(labelId)
							: SEG_ID2CLS[labelId as keyof typeof SEG_ID2CLS] ?? 'Unknown',
						color: anatomyColor(labelId),
						confidence: analysis.extra.anatomy_result.result.scores[i] ?? 0,
						severity: null,
						topK: null,
						labelId,
						toothIdx: anatomyToTooth[i] ?? -1,
						bboxIdx: i,
						kind: 'anatomy'
					};
				})
			: []
	);

	const allToothRows = $derived(
		analysis
			? analysis.extra.number_result.result.bboxes.map((_, i) => {
					const labelId = analysis.extra.number_result.result.labels[i] ?? 0;
					const lookup = fdiNumbering ? FDI_TOOTH_NUMBER_CLASSES : UNI_TOOTH_NUMBER_CLASSES;
					return {
						id: `tooth:${i}`,
						label: `${m.dx_viewer_2d_tooth_prefix()} ${lookup[labelId] ?? labelId + 1}`,
						color: TOOTH_NUMBER_COLOR,
						confidence: analysis.extra.number_result.result.scores[i] ?? 0,
						labelId,
						bboxIdx: i
					};
				})
			: []
	);

	function passesThreshold(r: { confidence: number; kind?: string }) {
		if (r.kind === 'anatomy') return true;
		return r.confidence >= liveThreshold;
	}

	function sortRows(rows: Row[]): Row[] {
		const sorted = [...rows];
		if (sortBy === 'severity') {
			sorted.sort(
				(a, b) =>
					severityRank(b.labelId) - severityRank(a.labelId) || b.confidence - a.confidence
			);
		} else if (sortBy === 'confidence') {
			sorted.sort((a, b) => b.confidence - a.confidence);
		}
		return sorted;
	}

	const visibleDiseaseRows = $derived(sortRows(allDiseaseRows.filter(passesThreshold)));
	const visibleAnatomyRows = $derived(sortRows(allAnatomyRows.filter(passesThreshold)));

	type ToothGroup = {
		key: string;
		title: string;
		toothIdx: number;
		quadrant: string;
		rows: Row[];
	};
	const toothGroups = $derived<ToothGroup[]>(buildToothGroups());

	function buildToothGroups(): ToothGroup[] {
		if (!analysis) return [];
		const map = new Map<number, Row[]>();
		const include = [...visibleDiseaseRows, ...visibleAnatomyRows];
		for (const row of include) {
			const k = row.toothIdx;
			const list = map.get(k);
			if (list) list.push(row);
			else map.set(k, [row]);
		}
		const groups: ToothGroup[] = [];
		const lookup = fdiNumbering ? FDI_TOOTH_NUMBER_CLASSES : UNI_TOOTH_NUMBER_CLASSES;
		const orderedToothIndices = analysis.extra.number_result.result.labels
			.map((labelId, idx) => ({ labelId, idx }))
			.sort((a, b) => a.labelId - b.labelId)
			.map((x) => x.idx);
		for (const tIdx of orderedToothIndices) {
			const rows = map.get(tIdx);
			if (!rows || rows.length === 0) continue;
			const labelId = analysis.extra.number_result.result.labels[tIdx];
			if (labelId === undefined) continue;
			groups.push({
				key: `tooth-${tIdx}`,
				title: `${m.dx_viewer_2d_tooth_prefix()} ${lookup[labelId] ?? labelId + 1}`,
				toothIdx: tIdx,
				quadrant:
					labelId < 8 ? 'UR' : labelId < 16 ? 'UL' : labelId < 24 ? 'LL' : 'LR',
				rows
			});
		}
		const unassigned = map.get(-1);
		if (unassigned && unassigned.length > 0) {
			groups.push({
				key: 'unassigned',
				title: m.dx_viewer_2d_unassigned(),
				toothIdx: -1,
				quadrant: '',
				rows: unassigned
			});
		}
		return groups;
	}

	const hasAnomaly = $derived(analysis?.extra.anatomy_result.extra.anomaly === true);

	let listEl: HTMLDivElement | undefined = $state();
	let expandedTeeth = $state<Set<string>>(new Set());

	$effect(() => {
		if (!selectedId || !listEl || tab !== 'findings') return;
		const id = selectedId;
		if (groupBy === 'tooth') {
			for (const g of toothGroups) {
				if (!g.rows.some((r) => r.id === id)) continue;
				if (!expandedTeeth.has(g.key)) {
					const next = new Set(expandedTeeth);
					next.add(g.key);
					expandedTeeth = next;
				}
				break;
			}
		}
		(async () => {
			await tick();
			const node = listEl?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
			node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		})();
	});

	function setTab(next: Tab) {
		tab = next;
		onTabChange?.(next);
	}

	function rowStateHandler(rowId: string, target: FindingState) {
		return () => {
			const current = findingStates.get(rowId);
			onSetState(rowId, current === target ? undefined : target);
		};
	}

	async function exportPdf() {
		setTab('report');
		await tick();
		window.print();
	}

	function toggleTooth(key: string) {
		const next = new Set(expandedTeeth);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expandedTeeth = next;
	}

	function selectTooth(toothIdx: number) {
		onSelect(`tooth:${toothIdx}`);
	}

	const findingsCount = $derived(visibleDiseaseRows.length + visibleAnatomyRows.length);
</script>

<div class="panel">
	<div class="tabs" role="tablist" aria-label={m.dx_viewer_2d_tabs_aria()}>
		<button
			type="button"
			role="tab"
			class="tab"
			class:active={tab === 'findings'}
			aria-selected={tab === 'findings'}
			onclick={() => setTab('findings')}
		>
			<span>{m.dx_viewer_2d_tab_findings()}</span>
			{#if analysis}
				<span class="tab-count">{findingsCount}</span>
			{/if}
		</button>
		<button
			type="button"
			role="tab"
			class="tab"
			class:active={tab === 'report'}
			aria-selected={tab === 'report'}
			onclick={() => setTab('report')}
		>
			<span>{m.dx_viewer_2d_tab_report()}</span>
		</button>
	</div>

	{#if tab === 'findings'}
		<div class="content" bind:this={listEl}>
			{#if !analysis}
				<p class="empty">{m.dx_viewer_2d_findings_empty()}</p>
			{:else}
				{#if hasAnomaly}
					<section class="side-sec">
						<AnomalyBanner />
					</section>
				{/if}

				<section class="side-sec">
					<h4 class="side-eyebrow">{m.dx_viewer_2d_controls_aria()}</h4>
					<div class="meta-list">
						<div class="meta-row">
							<span class="meta-k">{m.dx_viewer_2d_sort_label()}</span>
							<select
								class="meta-select"
								value={sortBy}
								onchange={(e) => onSortChange((e.currentTarget as HTMLSelectElement).value as SortMode)}
								aria-label={m.dx_viewer_2d_sort_label()}
							>
								<option value="default">{m.dx_viewer_2d_sort_default()}</option>
								<option value="severity">{m.dx_viewer_2d_sort_severity()}</option>
								<option value="confidence">{m.dx_viewer_2d_sort_confidence()}</option>
							</select>
						</div>
						<div class="meta-row">
							<span class="meta-k">{m.dx_viewer_2d_group_label()}</span>
							<div class="seg">
								<button
									type="button"
									class="seg-btn"
									class:on={groupBy === 'type'}
									onclick={() => onGroupChange('type')}
								>
									{m.dx_viewer_2d_group_type()}
								</button>
								<button
									type="button"
									class="seg-btn"
									class:on={groupBy === 'tooth'}
									onclick={() => onGroupChange('tooth')}
								>
									{m.dx_viewer_2d_group_tooth()}
								</button>
							</div>
						</div>
						<button
							type="button"
							class="meta-row toggle-row"
							onclick={() => onPatientModeChange(!patientMode)}
							aria-pressed={patientMode}
						>
							<span class="meta-k">{m.dx_viewer_2d_patient_mode()}</span>
							<span class="micro-switch" class:on={patientMode} aria-hidden="true">
								<span class="micro-thumb"></span>
							</span>
						</button>
					</div>
				</section>

				{#if groupBy === 'type'}
					{@render typeSection(m.dx_viewer_2d_layer_disease(), visibleDiseaseRows, true)}
					{@render typeSection(m.dx_viewer_2d_layer_anatomy(), visibleAnatomyRows, true)}
					{@render typeSection(m.dx_viewer_2d_layer_tooth(), allToothRows, false)}
				{:else}
					{@render toothGroupedView()}
				{/if}
			{/if}
		</div>
	{:else}
		<div class="content report-content">
			<section class="side-sec">
				<div class="report-head">
					<h4 class="side-eyebrow">{m.dx_viewer_2d_tab_report()}</h4>
					<button
						type="button"
						class="export-btn"
						disabled={!analysis?.report}
						onclick={exportPdf}
					>
						{m.dx_viewer_2d_export_pdf()}
					</button>
				</div>
				<MarkdownReport report={analysis?.report ?? null} />
			</section>
		</div>
	{/if}
</div>

{#snippet typeSection(title: string, rows: { id: string; label: string; color: string; confidence: number; severity?: Severity | null; topK?: TopKEntry[] | null }[], withActions: boolean)}
	<section class="side-sec">
		<h4 class="side-eyebrow eyebrow-with-count">
			<span>{title}</span>
			<span class="eyebrow-count">{rows.length}</span>
		</h4>
		{#if rows.length === 0}
			<p class="row-empty">{m.dx_viewer_2d_section_empty()}</p>
		{:else}
			<ul class="rows">
				{#each rows as r (r.id)}
					<FindingRow
						id={r.id}
						label={r.label}
						color={r.color}
						confidence={r.confidence}
						severity={r.severity}
						topK={r.topK}
						verdict={findingStates.get(r.id)}
						focused={selectedId === r.id || hoveredId === r.id}
						hidden={hiddenIds.has(r.id)}
						onSelect={() => onSelect(r.id)}
						onHover={(entering) => onHover(entering ? r.id : null)}
						onToggleHide={() => onToggle(r.id)}
						onConfirm={withActions ? rowStateHandler(r.id, 'confirmed') : undefined}
						onDismiss={withActions ? rowStateHandler(r.id, 'dismissed') : undefined}
					/>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#snippet toothGroupedView()}
	{#if toothGroups.length === 0}
		<p class="row-empty">{m.dx_viewer_2d_section_empty()}</p>
	{:else}
		<section class="side-sec">
			<h4 class="side-eyebrow eyebrow-with-count">
				<span>{m.dx_viewer_2d_tab_findings()}</span>
				<span class="eyebrow-count">{findingsCount}</span>
			</h4>
			<div class="tooth-groups">
				{#each toothGroups as g (g.key)}
					{@const open = expandedTeeth.has(g.key)}
					<div class="tooth-group">
						<div class="group-header" class:open>
							<button
								type="button"
								class="group-toggle"
								aria-expanded={open}
								onclick={() => toggleTooth(g.key)}
							>
								<span class="eye" aria-hidden="true">{open ? '●' : '○'}</span>
								<span class="swatch" style:background={TOOTH_NUMBER_COLOR}></span>
								<span class="g-name">{g.title}</span>
								{#if g.quadrant}
									<span class="quad">{g.quadrant}</span>
								{/if}
								<span class="g-count">{g.rows.length}</span>
							</button>
							{#if g.toothIdx >= 0}
								<button
									type="button"
									class="locate"
									title={m.dx_viewer_2d_locate()}
									aria-label={m.dx_viewer_2d_locate()}
									onclick={() => selectTooth(g.toothIdx)}
								>
									<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6">
										<circle cx="8" cy="8" r="3" />
										<path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
									</svg>
								</button>
							{/if}
						</div>
						{#if open}
							<ul class="rows nested">
								{#each g.rows as r (r.id)}
									<FindingRow
										id={r.id}
										label={r.label}
										color={r.color}
										confidence={r.confidence}
										severity={r.severity}
										topK={r.topK}
										verdict={findingStates.get(r.id)}
										focused={selectedId === r.id || hoveredId === r.id}
										hidden={hiddenIds.has(r.id)}
										onSelect={() => onSelect(r.id)}
										onHover={(entering) => onHover(entering ? r.id : null)}
										onToggleHide={() => onToggle(r.id)}
										onConfirm={rowStateHandler(r.id, 'confirmed')}
										onDismiss={rowStateHandler(r.id, 'dismissed')}
									/>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
{/snippet}

<style>
	/* Mirrors viewer-3d/Viewer3D's .panel — deeper than the canvas bg so the
	 * sidebar reads as its own surface, with the same left-border separator. */
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background-color: #0b1620;
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	/* Tabs: minimal text-only row with a 1px accent underline on the active tab,
	 * matching the eyebrow typography. Avoids the heavy "filled chip" treatment. */
	.tabs {
		display: flex;
		gap: 4px;
		padding: 14px 18px 0;
		border-bottom: 1px solid var(--border);
	}
	.tab {
		position: relative;
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
		padding: 10px 4px 12px;
		background: transparent;
		border: 0;
		color: var(--muted-fg);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		cursor: pointer;
		transition: color 150ms;
	}
	.tab:hover {
		color: var(--fg);
	}
	.tab.active {
		color: var(--fg);
	}
	.tab.active::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 1px;
		background: var(--accent);
	}
	.tab-count {
		font-family: var(--font-mono);
		font-size: 9px;
		padding: 2px 5px;
		border-radius: 999px;
		background-color: var(--surface-2);
		color: var(--muted-fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
		letter-spacing: 0;
	}
	.tab.active .tab-count {
		color: var(--fg);
	}

	/* Body scroll container. Same padding rhythm as Viewer3D's .panel-content. */
	.content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.report-content {
		padding: 18px;
	}

	.empty {
		color: var(--muted-fg);
		font-size: 12px;
		text-align: center;
		padding: 32px 12px;
		margin: 0;
		line-height: 1.5;
	}

	.side-sec {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.side-eyebrow {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
	}
	.eyebrow-with-count {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.eyebrow-count {
		color: var(--fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}

	/* Controls — meta-table style, matching Viewer3D's source/acquisition list. */
	.meta-list {
		display: flex;
		flex-direction: column;
	}
	.meta-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 9px 0;
		border-bottom: 1px solid var(--border);
		font-size: 12px;
		line-height: 1.4;
	}
	.meta-row:last-child {
		border-bottom: none;
	}
	.meta-k {
		color: var(--muted-fg);
		flex-shrink: 0;
	}
	.meta-select {
		background-color: transparent;
		border: 1px solid var(--border);
		color: var(--fg);
		font-family: var(--font-sans);
		font-size: 11px;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: border-color 150ms, background-color 150ms;
		appearance: none;
		background-image: linear-gradient(45deg, transparent 50%, var(--muted-fg) 50%),
			linear-gradient(135deg, var(--muted-fg) 50%, transparent 50%);
		background-position: calc(100% - 11px) 50%, calc(100% - 7px) 50%;
		background-size: 4px 4px;
		background-repeat: no-repeat;
		padding-right: 22px;
	}
	.meta-select:hover {
		border-color: var(--border-hover);
		background-color: var(--surface-2);
	}
	.meta-select:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: 1px;
	}

	.seg {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.seg-btn {
		padding: 4px 10px;
		background: transparent;
		border: 0;
		color: var(--muted-fg);
		font-family: var(--font-mono);
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition: background-color 150ms, color 150ms;
	}
	.seg-btn + .seg-btn {
		border-left: 1px solid var(--border);
	}
	.seg-btn:hover {
		color: var(--fg);
	}
	.seg-btn.on {
		background-color: var(--surface-2);
		color: var(--fg);
	}

	.toggle-row {
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border);
		text-align: left;
		cursor: pointer;
		font-family: var(--font-sans);
		color: inherit;
		font-size: 12px;
		width: 100%;
	}
	.toggle-row:last-child {
		border-bottom: none;
	}
	.toggle-row:hover .meta-k {
		color: var(--fg);
	}
	.micro-switch {
		position: relative;
		flex-shrink: 0;
		display: inline-block;
		width: 28px;
		height: 16px;
		padding: 2px;
		border-radius: 999px;
		background-color: var(--surface-2);
		border: 1px solid var(--border);
		transition: background-color 200ms, border-color 200ms;
	}
	.micro-switch.on {
		background-color: var(--accent);
		border-color: var(--accent);
	}
	.micro-thumb {
		display: block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background-color: var(--fg);
		transform: translateX(0);
		transition: transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1), background-color 200ms;
	}
	.micro-switch.on .micro-thumb {
		transform: translateX(12px);
		background-color: var(--primary-fg);
	}

	/* Findings list — divide-y rows, no card chrome. Matches StructureList's
	 * indented list style but kept flush since 2D findings have heavier metadata. */
	.rows {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.rows.nested {
		border-top: none;
		border-bottom: none;
	}
	.row-empty {
		font-size: 11px;
		color: var(--muted-fg);
		padding: 4px 0 4px 22px;
		margin: 0;
		font-style: italic;
	}

	/* Tooth groups — borrows StructureList's filled group-header bar. */
	.tooth-groups {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tooth-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.group-header {
		display: flex;
		align-items: stretch;
		background-color: var(--surface-2);
		border-radius: var(--radius);
		overflow: hidden;
		transition: background-color 150ms;
	}
	.group-header:hover {
		background-color: var(--surface-3);
	}
	.group-toggle {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		background: transparent;
		border: 0;
		cursor: pointer;
		color: var(--fg);
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 500;
		text-align: left;
		min-width: 0;
	}
	.eye {
		flex-shrink: 0;
		font-size: 9px;
		width: 10px;
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
	.g-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.quad {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		color: var(--muted-fg);
		text-transform: uppercase;
	}
	.g-count {
		font-family: var(--font-mono);
		font-size: 10px;
		font-feature-settings: 'tnum' on, 'lnum' on;
		color: var(--muted-fg);
		padding: 1px 6px;
		border-radius: 999px;
		background-color: rgba(232, 236, 240, 0.08);
	}
	.locate {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 0;
		color: var(--muted-fg);
		padding: 4px 4px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: color 150ms, background-color 150ms;
	}
	.locate:hover {
		color: var(--accent);
		background-color: rgba(240, 199, 100, 0.08);
	}

	/* Report tab — same eyebrow + content rhythm. Export action sits inline
	 * with the section header instead of a heavy actions bar. */
	.report-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.export-btn {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--fg);
		font-family: var(--font-mono);
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 5px 10px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background-color 150ms, border-color 150ms, color 150ms;
	}
	.export-btn:hover:not(:disabled) {
		background-color: var(--surface-2);
		border-color: var(--border-hover);
		color: var(--accent);
	}
	.export-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
