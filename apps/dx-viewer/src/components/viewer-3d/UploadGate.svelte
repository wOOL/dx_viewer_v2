<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	type Props = {
		onUpload: (file: File) => void;
	};
	let { onUpload }: Props = $props();
	let dragOver = $state(false);
	let input: HTMLInputElement;

	const ACCEPTED = '.nii,.nii.gz,.nrrd,.obj,.stl,.ply,.gltf,.glb,.png,.jpg,.jpeg,.dcm';
</script>

<div
	class="dropzone"
	class:over={dragOver}
	role="button"
	tabindex="0"
	aria-describedby="upload-formats"
	ondragover={(e) => {
		e.preventDefault();
		dragOver = true;
	}}
	ondragleave={() => (dragOver = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragOver = false;
		const f = e.dataTransfer?.files?.[0];
		if (f) onUpload(f);
	}}
	onclick={() => input?.click()}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input?.click())}
>
	<div class="drop-icon" aria-hidden="true">
		<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="17 8 12 3 7 8" />
			<line x1="12" y1="3" x2="12" y2="15" />
		</svg>
	</div>
	<h3 class="text-section-title gate-title">{m.dx_viewer_3d_upload_title()}</h3>
	<p class="text-body tone-muted drop-sub">{m.dx_viewer_3d_upload_subtitle()}</p>
	<ul id="upload-formats" class="formats" aria-label={m.dx_dashboard_drop_formats_label()}>
		<li class="format-row">
			<span class="format-label">{m.dx_dashboard_drop_group_2d()}</span>
			<span class="format-values">.png · .jpg · .dcm</span>
		</li>
		<li class="format-row">
			<span class="format-label">{m.dx_dashboard_drop_group_volume()}</span>
			<span class="format-values">.nii.gz · .nrrd</span>
		</li>
		<li class="format-row">
			<span class="format-label">{m.dx_dashboard_drop_group_mesh()}</span>
			<span class="format-values">.obj · .stl · .ply · .glb</span>
		</li>
	</ul>
	<input
		bind:this={input}
		type="file"
		class="visually-hidden"
		accept={ACCEPTED}
		tabindex="-1"
		onchange={(e) => {
			const f = (e.target as HTMLInputElement).files?.[0];
			if (f) onUpload(f);
			(e.target as HTMLInputElement).value = '';
		}}
	/>
</div>

<style>
	/* Mirrors the dashboard's .dropzone aesthetic — dashed border + tinted
	 * accent icon tile + radial+linear gradient surface + format chip rail.
	 * Tuned a notch tighter (max-width, slightly stronger drop shadow) since
	 * this gate sits as an overlay above the canvas rather than as a full
	 * page section. */
	.dropzone {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		width: min(560px, calc(100vw - 80px));
		min-height: 320px;
		padding: 44px 32px 36px;
		border: 1.5px dashed var(--border);
		border-radius: 18px;
		background:
			radial-gradient(ellipse at top, rgba(240, 199, 100, 0.05), transparent 60%),
			linear-gradient(180deg, rgba(33, 53, 72, 0.7), rgba(15, 22, 32, 0.88));
		text-align: center;
		cursor: pointer;
		color: var(--muted-fg);
		transition:
			border-color 220ms,
			background-color 220ms,
			transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.04) inset,
			0 28px 60px -28px rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}
	.dropzone:hover {
		border-color: rgba(240, 199, 100, 0.4);
		color: var(--fg);
	}
	.dropzone.over {
		border-color: var(--accent);
		border-style: solid;
		background:
			radial-gradient(ellipse at top, rgba(240, 199, 100, 0.14), transparent 60%),
			linear-gradient(180deg, rgba(240, 199, 100, 0.06), rgba(15, 22, 32, 0.9));
		color: var(--accent);
		transform: scale(1.005);
	}
	.dropzone:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
	}

	.drop-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		border-radius: 16px;
		background: linear-gradient(135deg, rgba(240, 199, 100, 0.2), rgba(240, 199, 100, 0.04));
		border: 1px solid rgba(240, 199, 100, 0.22);
		color: var(--accent);
		margin-bottom: 4px;
		transition: transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.dropzone.over .drop-icon {
		transform: translateY(-4px) scale(1.04);
	}

	.gate-title {
		margin: 0;
		color: var(--fg);
	}
	.drop-sub {
		margin: 0;
		max-width: 44ch;
	}

	/* Vertical divide-y stack: label left, values right, 1px rule between rows.
	 * Matches the metadata-table treatment used in the 2D viewer sidebar and
	 * keeps the format list reading as a structured spec sheet rather than a
	 * marketing flourish. */
	.formats {
		width: min(360px, 100%);
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--border);
	}
	.format-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		padding: 9px 4px;
		border-bottom: 1px solid var(--border);
	}
	.format-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.format-values {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted-fg);
		letter-spacing: 0.04em;
		text-align: right;
	}

	@media (max-width: 560px) {
		.dropzone {
			padding: 32px 20px 24px;
			min-height: 280px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dropzone,
		.drop-icon {
			transition: none;
		}
	}
</style>
