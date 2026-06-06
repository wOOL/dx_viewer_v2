<script lang="ts">
	import { Calendar, Clock, ScanLine } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { _, locale } from 'svelte-i18n';
	import type { StoredPatient } from '$lib/types';

	interface Props {
		patient: StoredPatient;
	}

	let { patient }: Props = $props();

	const ringStart = $derived(patient.ringColors[0]);
	const ringEnd = $derived(patient.ringColors[1]);

	// `utc` for DOB: it's stored as a UTC-midnight calendar date, so it must be
	// formatted in UTC — otherwise viewers west of UTC see the previous day.
	function formatDate(iso: string, utc = false) {
		const d = new Date(iso);
		// `new Date('bad').toLocaleDateString()` returns "Invalid Date" without throwing,
		// so the try/catch alone doesn't cover a malformed date — guard with isNaN.
		if (!iso || isNaN(d.getTime())) return '—';
		try {
			return d.toLocaleDateString($locale ?? undefined, {
				year: 'numeric',
				month: 'short',
				day: '2-digit',
				...(utc ? { timeZone: 'UTC' } : {})
			});
		} catch {
			return iso;
		}
	}

	// PHI masking was removed — the card always shows the real name / DOB / initials.
	const displayName = $derived(patient.name);
	const displayDob = $derived(patient.dob);
	const displayInitials = $derived(patient.initials);
</script>

<a
	href={resolve('/(app)/patients/[patientId]', { patientId: patient.id })}
	class="card"
	style:--rc1={ringStart}
	style:--rc2={ringEnd}
>
	<span class="spine" aria-hidden="true"></span>

	<div class="head">
		<span class="avatar">{displayInitials}</span>
		<div class="who">
			<h3 class="name">{displayName}</h3>
			<div class="dob">
				<Calendar size={11} />
				<span>{displayDob ? formatDate(displayDob, true) : '—'}</span>
			</div>
		</div>
	</div>

	<div class="foot">
		<span class="count">
			<ScanLine size={12} />
			{$_('studies.studyCount', { values: { count: patient.studies.length } })}
		</span>
		<span class="chip">
			<Clock size={11} />
			{formatDate(patient.lastCapture)}
		</span>
	</div>
</a>

<style>
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1rem 1rem 0.85rem 1.2rem;
		border-radius: var(--radius-card);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-card);
		transition:
			transform 0.15s var(--ease-out),
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.card:hover {
		transform: translateY(-2px);
		border-color: var(--color-border-hover);
		box-shadow: var(--shadow-pop);
	}
	/* Per-patient colour identity — a floating accent spine, not Pearl's ring. */
	.spine {
		position: absolute;
		left: 0;
		top: 14px;
		bottom: 14px;
		width: 3px;
		border-radius: 0 3px 3px 0;
		background: linear-gradient(var(--rc1), var(--rc2));
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-width: 0;
	}
	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-fg-0);
		background: color-mix(in oklab, var(--rc1) 20%, var(--color-bg-2));
		border: 1px solid color-mix(in oklab, var(--rc1) 45%, transparent);
	}
	.who {
		min-width: 0;
	}
	.name {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-fg-0);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dob {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.15rem;
		font-size: 0.72rem;
		color: var(--color-fg-2);
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding-top: 0.7rem;
		border-top: 1px solid var(--color-border);
	}
	.count {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.74rem;
		color: var(--color-fg-2);
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: var(--color-bg-2);
		font-size: 0.7rem;
		color: var(--color-fg-1);
	}
</style>
