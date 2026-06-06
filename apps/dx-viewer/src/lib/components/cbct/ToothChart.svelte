<script lang="ts">
	import { FDI_TOOTH, UNIVERSAL_TOOTH } from '$lib/constants';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { _ } from 'svelte-i18n';
	interface Props {
		highlightTooth?: number[];
		findingsByTooth?: Record<number, { severity: 'low' | 'med' | 'high'; count: number }>;
		onpick?: (tooth: number) => void;
		dense?: boolean;
	}
	const { highlightTooth = [], findingsByTooth = {}, onpick, dense = false }: Props = $props();

	// FDI rows — Diagnocat orders upper row right→left, lower row left→right (mirror)
	const upper = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
	const lower = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

	// Keys/order stay FDI (findings + onpick are FDI-keyed), but the DISPLAYED label
	// follows the user's numbering preference (default Universal) so the chart matches
	// the 2D overlay (#17/#37/#77) — otherwise a Universal-preference clinician saw
	// Universal in the overlay but FDI in this chart for the same patient.
	// REACTIVE (S2-#3): reads the shared `prefs` rune so the labels re-render in place
	// when the preference changes (Settings or another tab) WITHOUT remounting.
	const useFdi = $derived(prefs.toothNumbering === 'fdi');
	const fdiToUni: Record<number, string> = Object.fromEntries(
		FDI_TOOTH.map((f, i) => [Number(f), UNIVERSAL_TOOTH[i]])
	);
	const displayNum = (n: number) => (useFdi ? String(n) : (fdiToUni[n] ?? String(n)));

	function severityClass(n: number) {
		const f = findingsByTooth[n];
		if (!f) return 'bg-bg-2/50 text-fg-2 border-border';
		if (f.severity === 'high') return 'bg-danger-500/20 border-danger-500 text-danger-300';
		if (f.severity === 'med') return 'bg-warning-500/20 border-warning-500 text-warning-300';
		return 'bg-primary/20 border-primary text-primary';
	}

	const cellSize = $derived(dense ? 'h-4 w-4 text-[8px]' : 'h-7 w-7 text-[11px]');
</script>

<div class="flex flex-col items-center gap-0.5 select-none">
	<div class="flex">
		{#each upper as n, i (n)}
			<button
				class="{cellSize} {severityClass(n)} {highlightTooth.includes(n)
					? 'z-10 ring-2 ring-primary'
					: ''} -ml-px flex items-center justify-center rounded-sm border transition-transform hover:scale-110"
				class:first-of-mirror={i === 8}
				aria-label="{$_('cbct.tooth')} {displayNum(n)}"
				aria-pressed={highlightTooth.includes(n)}
				onclick={() => onpick?.(n)}
				title="{$_('cbct.tooth')} {displayNum(n)}">{displayNum(n)}</button
			>
		{/each}
	</div>
	<div class="flex">
		{#each lower as n, i (n)}
			<button
				class="{cellSize} {severityClass(n)} {highlightTooth.includes(n)
					? 'z-10 ring-2 ring-primary'
					: ''} -ml-px flex items-center justify-center rounded-sm border transition-transform hover:scale-110"
				class:first-of-mirror={i === 8}
				aria-label="{$_('cbct.tooth')} {displayNum(n)}"
				aria-pressed={highlightTooth.includes(n)}
				onclick={() => onpick?.(n)}
				title="{$_('cbct.tooth')} {displayNum(n)}">{displayNum(n)}</button
			>
		{/each}
	</div>
</div>

<style>
	.first-of-mirror {
		margin-left: 4px;
	}
</style>
