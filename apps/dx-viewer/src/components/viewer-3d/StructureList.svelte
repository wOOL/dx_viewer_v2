<script lang="ts">
	type Structure = {
		id: number;
		name: string;
		groupKey: string;
		group: string;
		color: string;
		vertexCount?: number;
		volumeMm3?: number;
	};

	type Props = {
		structures: Structure[];
		visibility: Record<number, boolean>;
		opacity: Record<number, number>;
		onToggle: (id: number) => void;
		onToggleGroup: (groupKey: string, items: Structure[]) => void;
		onOpacity: (id: number, opacity: number) => void;
	};

	let { structures, visibility, opacity, onToggle, onToggleGroup, onOpacity }: Props = $props();

	let expanded = $state<number | null>(null);

	// ToothFairy3 group ordering — bone first, then teeth (permanent before
	// deciduous), then restorations, nerves, sinuses, pulp, fallback.
	const GROUP_ORDER = ['bone', 'tooth_p', 'tooth_d', 'work', 'nerve', 'sinus', 'pulp', 'other'];

	type GroupBucket = { name: string; color: string; items: Structure[] };

	let groups = $derived.by(() => {
		const byKey = new Map<string, GroupBucket>();
		for (const s of structures) {
			let bucket = byKey.get(s.groupKey);
			if (!bucket) {
				bucket = { name: s.group, color: s.color, items: [] };
				byKey.set(s.groupKey, bucket);
			}
			bucket.items.push(s);
		}
		for (const g of byKey.values()) {
			g.items.sort((a, b) => (b.vertexCount ?? b.volumeMm3 ?? 0) - (a.vertexCount ?? a.volumeMm3 ?? 0));
		}
		return GROUP_ORDER.filter((k) => byKey.has(k))
			.concat([...byKey.keys()].filter((k) => !GROUP_ORDER.includes(k)))
			.map((k) => [k, byKey.get(k)!] as const);
	});

	function isVisible(id: number): boolean {
		return visibility[id] !== false;
	}

	function formatVolume(s: Structure): string | null {
		if (s.volumeMm3 == null) return null;
		return s.volumeMm3 >= 1000 ? `${(s.volumeMm3 / 1000).toFixed(1)} cm³` : `${Math.round(s.volumeMm3)} mm³`;
	}
</script>

<div class="list">
	{#each groups as [key, group] (key)}
		{@const groupAnyVisible = group.items.some((s) => isVisible(s.id))}
		<div class="group">
			<button
				type="button"
				class="group-header"
				class:dim={!groupAnyVisible}
				onclick={() => onToggleGroup(key, group.items)}
				title={groupAnyVisible ? `Hide all in ${group.name}` : `Show all in ${group.name}`}
			>
				<span class="eye" aria-hidden="true">{groupAnyVisible ? '●' : '○'}</span>
				<span class="swatch" style:background-color={group.color}></span>
				<span class="name">{group.name}</span>
				<span class="count">{group.items.length}</span>
			</button>
			<ul>
				{#each group.items as s (s.id)}
					{@const visible = isVisible(s.id)}
					{@const op = opacity[s.id] ?? 1}
					<li>
						<div class="item-row">
							<button
								type="button"
								class="item"
								class:dim={!visible}
								onclick={() => onToggle(s.id)}
								title={visible ? `Hide ${s.name}` : `Show ${s.name}`}
							>
								<span class="eye" aria-hidden="true">{visible ? '●' : '○'}</span>
								<span class="swatch sm" style:background-color={s.color}></span>
								<span class="item-name">{s.name}</span>
								{#if formatVolume(s)}
									<span class="vol">{formatVolume(s)}</span>
								{/if}
							</button>
							<button
								type="button"
								class="op-toggle"
								class:open={expanded === s.id}
								onclick={() => (expanded = expanded === s.id ? null : s.id)}
								aria-label="Adjust {s.name} opacity"
								title="Opacity {Math.round(op * 100)}%"
							>
								<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
									<circle cx="8" cy="8" r="5" />
									<path d="M8 3v10" />
								</svg>
							</button>
						</div>
						{#if expanded === s.id}
							<div class="op-row">
								<span class="op-dot" style:background-color={s.color} aria-hidden="true"></span>
								<span class="op-name" title={s.name}>{s.name}</span>
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={op}
									oninput={(e) => onOpacity(s.id, parseFloat(e.currentTarget.value))}
									style:accent-color={s.color}
									aria-label="{s.name} opacity"
								/>
								<span class="op-value">{Math.round(op * 100)}%</span>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</div>

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	/* Group header rendered as a filled bar to read as a "container" for the
	 * items below — matches the demo's group-bar treatment. */
	.group-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		background-color: var(--surface-2);
		border: none;
		border-radius: var(--radius);
		cursor: pointer;
		color: var(--fg);
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		transition: background-color 150ms, opacity 150ms;
	}
	.group-header:hover {
		background-color: var(--surface-3, var(--surface-2));
	}
	.group-header:hover {
		background-color: var(--surface-2);
	}
	.group-header.dim {
		opacity: 0.55;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px 8px 24px;
		background: none;
		border: none;
		border-radius: var(--radius);
		text-align: left;
		cursor: pointer;
		color: var(--fg);
		font-size: 13px;
		transition: background-color 150ms, opacity 150ms;
	}
	.item:hover {
		background-color: var(--surface-2);
	}
	.item.dim {
		opacity: 0.45;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.eye {
		flex-shrink: 0;
		font-size: 9px;
		width: 10px;
		text-align: center;
		color: var(--muted-fg);
	}
	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.swatch.sm {
		width: 10px;
		height: 10px;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--fg);
	}
	.count {
		font-feature-settings: 'tnum' on, 'lnum' on;
		color: var(--muted-fg);
		font-size: 10px;
		padding: 1px 5px;
		border-radius: 999px;
		background-color: var(--surface-2);
	}
	.item-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.vol {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted-fg);
		flex-shrink: 0;
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.item-row {
		display: flex;
		align-items: stretch;
		gap: 2px;
	}
	.item-row > .item {
		flex: 1;
	}
	.op-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius);
		color: var(--muted-fg);
		cursor: pointer;
		transition: background-color 150ms, color 150ms;
	}
	.op-toggle:hover {
		background-color: var(--surface-2);
		color: var(--fg);
	}
	.op-toggle.open {
		background-color: var(--surface-2);
		color: var(--accent);
	}
	.op-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px 8px 24px;
		background-color: var(--surface-2);
		border-radius: var(--radius);
		margin-top: 2px;
	}
	.op-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
	}
	.op-name {
		font-size: 11px;
		color: var(--muted-fg);
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.op-row input[type='range'] {
		flex: 1;
		height: 4px;
		cursor: pointer;
		min-width: 60px;
	}
	.op-value {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
		min-width: 36px;
		text-align: right;
	}
</style>
