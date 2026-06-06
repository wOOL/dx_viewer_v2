<script lang="ts">
	import type { StoredStudy } from '$lib/types';
	import { _, locale } from 'svelte-i18n';
	import { Camera, X, ChevronLeft, ChevronRight, Trash2, Plus } from 'lucide-svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { SvelteSet } from 'svelte/reactivity';
	import Pager from '$lib/components/Pager.svelte';
	import { paginate } from '$lib/pagination';
	import { formatDisplayDate } from '$lib/date';

	// Displays a patient's camera photos (modality 'photo' — not X-rays, no AI). Used
	// on the patient page and in the 2D viewer's Photos tab. A click opens a lightbox
	// with prev/next + delete; the empty state offers an "Add photo" shortcut.
	interface Props {
		photos: StoredStudy[];
		onDelete?: (id: string) => void | Promise<void>;
		onAdd?: () => void;
	}
	let { photos, onDelete, onAdd }: Props = $props();

	// Paginate the grid — a patient with hundreds of photos would otherwise mount that
	// many <img> at once. The lightbox's prev/next still span the FULL `photos` array
	// (not just the page), so grid tiles pass their GLOBAL index to open(). Reset to
	// page 1 when the photo count changes (add / delete / patient switch); paginate
	// also clamps.
	const PHOTO_PAGE_SIZE = 24;
	let page = $state(0);
	let lastCount = $state(-1);
	$effect(() => {
		if (photos.length !== lastCount) {
			lastCount = photos.length;
			page = 0;
		}
	});
	const paged = $derived(paginate(photos, page, PHOTO_PAGE_SIZE));

	// Key the lightbox to the photo's stable id, NOT its array index: `photos` can be
	// reassigned out from under an open lightbox (parent date-filter/tab change, a
	// two-tab delete, or the studies-store re-baking file URLs every 100s). An index
	// would then point at a different photo (PHI mismatch) or out of bounds (blank).
	let lightboxId = $state<string | null>(null);
	const activeIdx = $derived(
		lightboxId == null ? -1 : photos.findIndex((p) => p.id === lightboxId)
	);
	const active = $derived(activeIdx >= 0 ? photos[activeIdx] : undefined);

	// Close the lightbox if the open photo is no longer in the list (e.g. it was the
	// one deleted, or the filtered list no longer contains it).
	$effect(() => {
		if (lightboxId != null && activeIdx < 0) lightboxId = null;
	});

	// Studies whose protected-file token expired/404'd — `freshFileToken()` failure
	// returns a token-less URL, so the <img> errors. Show a placeholder, not a broken
	// glyph. Keyed by study id so it survives reorders of `photos`.
	const broken = new SvelteSet<string>();

	// Ids whose delete is in flight, so a rapid double-click can't fire onDelete twice
	// (the 2nd call hits an already-deleted id → a spurious failure alert).
	const deleting = new SvelteSet<string>();
	async function remove(id: string) {
		if (!onDelete || deleting.has(id)) return;
		deleting.add(id);
		try {
			await onDelete(id);
		} finally {
			deleting.delete(id);
		}
	}

	function fmt(iso: string): string {
		// Use the active UI locale, not navigator.language — a clinician on FR in an EN
		// browser otherwise sees "May 28, 2026" under French chrome. Shared helper guards a
		// malformed/missing capturedAt → "—" instead of leaking "Invalid Date".
		return formatDisplayDate(iso, $locale ?? undefined);
	}

	function open(i: number) {
		lightboxId = photos[i]?.id ?? null;
	}
	function close() {
		lightboxId = null;
	}
	function step(delta: number) {
		if (activeIdx < 0 || photos.length === 0) return;
		const i = (activeIdx + delta + photos.length) % photos.length;
		lightboxId = photos[i].id;
	}
	function removeActive() {
		if (active) {
			void remove(active.id);
			close();
		}
	}

	function onKey(e: KeyboardEvent) {
		if (lightboxId == null) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowLeft') step(-1);
		else if (e.key === 'ArrowRight') step(1);
	}
</script>

<svelte:window onkeydown={onKey} />

{#if photos.length === 0}
	<div class="empty">
		<div class="empty-icon"><Camera size={26} class="text-fg-3" /></div>
		<div class="text-center">
			<div class="text-sm font-semibold text-fg-1">{$_('photos.empty')}</div>
			<p class="mt-1 max-w-xs text-xs text-fg-3">{$_('photos.emptyDesc')}</p>
		</div>
		{#if onAdd}
			<button type="button" class="add-btn" onclick={onAdd}>
				<Plus size={14} />
				{$_('photos.add')}
			</button>
		{/if}
	</div>
{:else}
	<div class="grid grid-cols-2 gap-3 p-6 pb-0 sm:grid-cols-3 lg:grid-cols-5">
		{#each paged.items as p, i (p.id)}
			{@const captured = $_('photos.captured', { values: { date: fmt(p.capturedAt) } })}
			{@const gi = paged.page * paged.pageSize + i}
			<div class="tile group relative aspect-[4/3] overflow-hidden rounded-lg">
				<button class="absolute inset-0 z-0" onclick={() => open(gi)} aria-label={captured}
				></button>
				{#if p.imageDataUrl && !broken.has(p.id)}
					<img
						src={p.imageDataUrl}
						alt={$_('photos.captured', { values: { date: fmt(p.capturedAt) } })}
						loading="lazy"
						class="pointer-events-none h-full w-full object-cover"
						onerror={() => broken.add(p.id)}
					/>
				{:else}
					<div class="ph pointer-events-none" aria-hidden="true">
						<Camera size={22} class="text-fg-3" />
					</div>
				{/if}
				<div
					class="pointer-events-none absolute right-1 bottom-1 left-1 text-[10px] text-white drop-shadow"
				>
					{fmt(p.capturedAt)}
				</div>
				{#if onDelete}
					<button
						class="del absolute top-1 right-1 z-10 rounded bg-bg-1/70 p-1 text-fg-2 opacity-0 transition group-hover:opacity-100 hover:text-danger disabled:opacity-40"
						disabled={deleting.has(p.id)}
						onclick={(e) => {
							e.stopPropagation();
							void remove(p.id);
						}}
						aria-label={$_('photos.delete')}
					>
						<Trash2 size={12} />
					</button>
				{/if}
			</div>
		{/each}
	</div>
	<div class="px-6 pb-6">
		<Pager
			page={paged.page}
			pageCount={paged.pageCount}
			total={paged.total}
			onpage={(p) => (page = p)}
		/>
	</div>
{/if}

{#if active}
	{@const activeId = active.id}
	<div use:focusTrap class="lb" role="dialog" aria-modal="true" aria-label={$_('photos.view')}>
		<button type="button" class="lb-scrim" aria-label={$_('photos.close')} onclick={close}></button>
		<div class="lb-stage">
			{#if active.imageDataUrl && !broken.has(activeId)}
				<img
					src={active.imageDataUrl}
					alt={fmt(active.capturedAt)}
					class="lb-img"
					onerror={() => broken.add(activeId)}
				/>
			{:else}
				<div class="lb-ph" aria-hidden="true"><Camera size={48} class="text-fg-3" /></div>
			{/if}
			<div class="lb-cap">
				{$_('photos.captured', { values: { date: fmt(active.capturedAt) } })}
			</div>
		</div>

		{#if photos.length > 1}
			<button
				type="button"
				class="lb-nav left"
				aria-label={$_('photos.prev')}
				onclick={() => step(-1)}
			>
				<ChevronLeft size={22} />
			</button>
			<button
				type="button"
				class="lb-nav right"
				aria-label={$_('photos.next')}
				onclick={() => step(1)}
			>
				<ChevronRight size={22} />
			</button>
		{/if}

		<div class="lb-actions">
			{#if onDelete}
				<button
					type="button"
					class="lb-btn danger"
					disabled={deleting.has(activeId)}
					onclick={removeActive}
				>
					<Trash2 size={15} />
					{$_('photos.delete')}
				</button>
			{/if}
			<button type="button" class="lb-btn" aria-label={$_('photos.close')} onclick={close}>
				<X size={15} />
			</button>
		</div>
	</div>
{/if}

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		min-height: 60vh;
		padding: 2rem;
	}
	.empty-icon {
		border-radius: 999px;
		background: var(--color-bg-2);
		padding: 1rem;
	}
	.add-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-control);
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}
	.add-btn:hover {
		background: var(--color-primary-hover);
	}
	.tile {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		cursor: pointer;
	}
	.tile:hover {
		border-color: var(--color-primary);
	}
	.ph {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 100%;
		background: var(--color-bg-2);
	}
	.lb-ph {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 16rem;
		width: 16rem;
		border-radius: var(--radius-card);
		background: var(--color-bg-2);
	}
	.lb {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2.5rem;
	}
	.lb-scrim {
		position: absolute;
		inset: 0;
		background: color-mix(in oklab, var(--color-bg-0) 88%, transparent);
		backdrop-filter: blur(4px);
		cursor: default;
	}
	.lb-stage {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		max-width: 100%;
		max-height: 100%;
	}
	.lb-img {
		max-width: min(90vw, 1100px);
		max-height: 80vh;
		object-fit: contain;
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-pop);
	}
	.lb-cap {
		font-size: 0.8rem;
		color: var(--color-fg-2);
	}
	.lb-nav {
		position: absolute;
		top: 50%;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 40px;
		width: 40px;
		transform: translateY(-50%);
		border-radius: 999px;
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		cursor: pointer;
		transition: color 0.12s;
	}
	.lb-nav:hover {
		color: var(--color-fg-0);
		border-color: var(--color-border-hover);
	}
	.lb-nav.left {
		left: 1rem;
	}
	.lb-nav.right {
		right: 1rem;
	}
	.lb-actions {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 2;
		display: flex;
		gap: 0.5rem;
	}
	.lb-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.7rem;
		border-radius: var(--radius-control);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			color 0.12s,
			border-color 0.12s;
	}
	.lb-btn:hover {
		color: var(--color-fg-0);
		border-color: var(--color-border-hover);
	}
	.lb-btn.danger:hover {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}
</style>
