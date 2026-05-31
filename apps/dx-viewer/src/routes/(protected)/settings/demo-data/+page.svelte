<script lang="ts">
	import BezelButton from '$components/ui/BezelButton.svelte';
	import {
		demoStore,
		type ActivityStatus,
		type ScanType
	} from '$lib/demo-store.svelte';
	import * as m from '$lib/paraglide/messages';

	demoStore.hydrate();

	const SCAN_TYPES: ScanType[] = ['Bitewing', 'Panoramic', 'Periapical', 'CBCT', 'IOS'];
	const STATUSES: ActivityStatus[] = ['complete', 'reviewing', 'flagged'];

	function dateInputValue(iso: string): string {
		// `YYYY-MM-DDTHH:MM` for <input type="datetime-local">.
		return iso.slice(0, 16);
	}
	function isoFromDateInput(local: string): string {
		// Naive: treat the value as UTC. For demo data this is acceptable.
		return new Date(local).toISOString();
	}

	let toast = $state<string | null>(null);
	function flash(msg: string) {
		toast = msg;
		setTimeout(() => {
			if (toast === msg) toast = null;
		}, 2000);
	}

	function regenerate() {
		demoStore.regenerate();
		flash(m.dx_settings_demo_regenerated());
	}
	function clearAll() {
		demoStore.clear();
		flash(m.dx_settings_demo_cleared());
	}
	function addPatient() {
		demoStore.addRandomPatient();
	}
	function addActivity() {
		const a = demoStore.addRandomActivity();
		if (!a) flash(m.dx_settings_demo_data_no_patients());
	}
</script>

<div class="page">
	<header class="page-head">
		<a href="/settings" class="crumb-link">
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<polyline points="15 18 9 12 15 6" />
			</svg>
			<span>{m.dx_settings_title()}</span>
		</a>
		<div class="head-row">
			<div>
				<span class="dev-pill">{m.dx_settings_developer_pill()}</span>
				<h1 class="text-display">{m.dx_settings_demo_data_title()}</h1>
				<p class="text-body tone-muted">{m.dx_settings_demo_data_subtitle()}</p>
			</div>
			<div class="head-actions">
				<BezelButton onclick={regenerate}>{m.dx_settings_demo_regenerate()}</BezelButton>
				<BezelButton variant="secondary" onclick={clearAll}>{m.dx_settings_demo_clear()}</BezelButton>
			</div>
		</div>
	</header>

	<section class="section">
		<header class="section-head">
			<div>
				<h2 class="text-section-title">{m.dx_settings_demo_data_patients()}</h2>
				<p class="text-meta tone-muted">{m.dx_settings_demo_data_patients_hint()}</p>
			</div>
			<BezelButton variant="ghost" onclick={addPatient}>
				+ {m.dx_settings_demo_data_add_patient()}
			</BezelButton>
		</header>

		{#if demoStore.patients.length === 0}
			<p class="empty">{m.dx_settings_demo_data_no_patients()}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th class="col-id">{m.dx_settings_demo_data_col_id()}</th>
							<th>{m.dx_settings_demo_data_col_name()}</th>
							<th>{m.dx_settings_demo_data_col_dob()}</th>
							<th>{m.dx_settings_demo_data_col_last_visit()}</th>
							<th class="col-actions" aria-label="actions"></th>
						</tr>
					</thead>
					<tbody>
						{#each demoStore.patients as p (p.id)}
							<tr>
								<td class="mono mute">{p.id}</td>
								<td>
									<input
										type="text"
										class="cell-input"
										value={p.name}
										onchange={(e) =>
											demoStore.updatePatient(p.id, { name: (e.target as HTMLInputElement).value })}
									/>
								</td>
								<td>
									<input
										type="date"
										class="cell-input mono"
										value={p.dob}
										onchange={(e) =>
											demoStore.updatePatient(p.id, { dob: (e.target as HTMLInputElement).value })}
									/>
								</td>
								<td>
									<input
										type="datetime-local"
										class="cell-input mono"
										value={dateInputValue(p.lastVisitAt)}
										onchange={(e) =>
											demoStore.updatePatient(p.id, {
												lastVisitAt: isoFromDateInput((e.target as HTMLInputElement).value)
											})}
									/>
								</td>
								<td class="col-actions">
									<button
										type="button"
										class="del"
										aria-label={m.dx_settings_demo_data_delete()}
										title={m.dx_settings_demo_data_delete()}
										onclick={() => demoStore.deletePatient(p.id)}
									>
										<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6">
											<path d="M3 4h10" />
											<path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
											<path d="M4 4v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4" />
										</svg>
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="section">
		<header class="section-head">
			<div>
				<h2 class="text-section-title">{m.dx_settings_demo_data_activities()}</h2>
				<p class="text-meta tone-muted">{m.dx_settings_demo_data_activities_hint()}</p>
			</div>
			<BezelButton
				variant="ghost"
				onclick={addActivity}
				disabled={demoStore.patients.length === 0}
			>
				+ {m.dx_settings_demo_data_add_activity()}
			</BezelButton>
		</header>

		{#if demoStore.activities.length === 0}
			<p class="empty">{m.dx_settings_demo_data_no_activities()}</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>{m.dx_settings_demo_data_col_patient()}</th>
							<th>{m.dx_settings_demo_data_col_type()}</th>
							<th>{m.dx_settings_demo_data_col_findings()}</th>
							<th>{m.dx_settings_demo_data_col_status()}</th>
							<th>{m.dx_settings_demo_data_col_when()}</th>
							<th class="col-actions" aria-label="actions"></th>
						</tr>
					</thead>
					<tbody>
						{#each demoStore.activities as a (a.id)}
							<tr>
								<td>
									<select
										class="cell-input"
										value={a.patientId}
										onchange={(e) =>
											demoStore.updateActivity(a.id, {
												patientId: (e.target as HTMLSelectElement).value
											})}
									>
										{#each demoStore.patients as p (p.id)}
											<option value={p.id}>{p.name}</option>
										{/each}
									</select>
								</td>
								<td>
									<select
										class="cell-input"
										value={a.type}
										onchange={(e) =>
											demoStore.updateActivity(a.id, {
												type: (e.target as HTMLSelectElement).value as ScanType
											})}
									>
										{#each SCAN_TYPES as t}
											<option value={t}>{t}</option>
										{/each}
									</select>
								</td>
								<td>
									<input
										type="number"
										min="0"
										max="40"
										class="cell-input mono num"
										value={a.findings}
										onchange={(e) =>
											demoStore.updateActivity(a.id, {
												findings: parseInt((e.target as HTMLInputElement).value, 10) || 0
											})}
									/>
								</td>
								<td>
									<select
										class="cell-input status-{a.status}"
										value={a.status}
										onchange={(e) =>
											demoStore.updateActivity(a.id, {
												status: (e.target as HTMLSelectElement).value as ActivityStatus
											})}
									>
										{#each STATUSES as s}
											<option value={s}>{s}</option>
										{/each}
									</select>
								</td>
								<td>
									<input
										type="datetime-local"
										class="cell-input mono"
										value={dateInputValue(a.timestamp)}
										onchange={(e) =>
											demoStore.updateActivity(a.id, {
												timestamp: isoFromDateInput((e.target as HTMLInputElement).value)
											})}
									/>
								</td>
								<td class="col-actions">
									<button
										type="button"
										class="del"
										aria-label={m.dx_settings_demo_data_delete()}
										title={m.dx_settings_demo_data_delete()}
										onclick={() => demoStore.deleteActivity(a.id)}
									>
										<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6">
											<path d="M3 4h10" />
											<path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
											<path d="M4 4v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4" />
										</svg>
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	{#if toast}
		<div class="toast positive" role="status" aria-live="polite">{toast}</div>
	{/if}
</div>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
		padding: 8px 0 96px;
		display: flex;
		flex-direction: column;
		gap: 32px;
		animation: pageRise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}
	.page-head {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.crumb-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--muted-fg);
		text-decoration: none;
		font-size: 13px;
		transition: color 150ms;
		align-self: flex-start;
	}
	.crumb-link:hover {
		color: var(--fg);
	}
	.head-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 24px;
		flex-wrap: wrap;
	}
	.head-row h1 {
		margin: 4px 0 6px;
	}
	.head-row p {
		margin: 0;
		max-width: 60ch;
	}
	.head-actions {
		display: flex;
		gap: 8px;
		flex-shrink: 0;
	}
	.dev-pill {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 3px 8px;
		border-radius: 4px;
		background-color: rgba(232, 179, 75, 0.1);
		color: rgba(232, 179, 75, 0.92);
		border: 1px solid rgba(232, 179, 75, 0.25);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.section-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 16px;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--border);
	}
	.section-head h2 {
		margin: 0 0 2px;
	}
	.section-head p {
		margin: 0;
	}

	.empty {
		color: var(--muted-fg);
		font-size: 13px;
		padding: 24px 0;
		text-align: center;
		font-style: italic;
		margin: 0;
	}

	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background-color: var(--card);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		text-align: left;
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		font-weight: 400;
		padding: 10px 14px;
		background-color: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	td {
		padding: 6px 8px;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}
	tbody tr:last-child td {
		border-bottom: none;
	}
	tbody tr:hover {
		background-color: rgba(232, 236, 240, 0.02);
	}
	.col-id {
		width: 120px;
	}
	.col-actions {
		width: 44px;
		text-align: right;
	}
	.mono {
		font-family: var(--font-mono);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.mute {
		color: var(--muted-fg);
		font-size: 11px;
		padding: 6px 14px;
	}

	.cell-input {
		width: 100%;
		min-width: 80px;
		padding: 6px 10px;
		background-color: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--fg);
		font-family: var(--font-sans);
		font-size: 13px;
		transition: background-color 150ms, border-color 150ms;
	}
	.cell-input:hover {
		background-color: var(--surface-2);
	}
	.cell-input:focus {
		outline: none;
		background-color: var(--surface-2);
		border-color: var(--accent);
	}
	.cell-input.mono {
		font-family: var(--font-mono);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.cell-input.num {
		max-width: 80px;
		text-align: right;
	}
	select.cell-input {
		appearance: none;
		-webkit-appearance: none;
		padding-right: 22px;
		background-image: linear-gradient(45deg, transparent 50%, var(--muted-fg) 50%),
			linear-gradient(135deg, var(--muted-fg) 50%, transparent 50%);
		background-position: calc(100% - 10px) 50%, calc(100% - 6px) 50%;
		background-size: 4px 4px;
		background-repeat: no-repeat;
		cursor: pointer;
	}
	.status-complete {
		color: rgba(93, 212, 166, 0.95);
	}
	.status-reviewing {
		color: rgba(240, 199, 100, 0.95);
	}
	.status-flagged {
		color: rgba(232, 75, 58, 0.95);
	}

	.del {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: 0;
		border-radius: 6px;
		color: var(--muted-fg);
		cursor: pointer;
		transition: background-color 150ms, color 150ms;
	}
	.del:hover {
		background-color: rgba(232, 75, 58, 0.1);
		color: var(--destructive);
	}

	.toast {
		position: fixed;
		bottom: 32px;
		left: 50%;
		transform: translateX(-50%);
		padding: 12px 20px;
		border-radius: 999px;
		font-size: 13px;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
		animation: toastIn 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
		z-index: 60;
	}
	.toast.positive {
		background-color: rgba(93, 212, 201, 0.12);
		border: 1px solid rgba(93, 212, 201, 0.25);
		color: #b6e8e2;
	}

	@keyframes pageRise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes toastIn {
		from {
			opacity: 0;
			transform: translate(-50%, 8px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}
</style>
