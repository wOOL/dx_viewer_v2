<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	type Props = {
		label: string;
		type?: 'email' | 'text' | 'tel' | 'password';
		value: string;
		placeholder?: string;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		inputmode?: 'text' | 'email' | 'numeric' | 'tel';
		required?: boolean;
		disabled?: boolean;
		hint?: string;
		error?: string | null;
	};
	let {
		label,
		type = 'text',
		value = $bindable(''),
		placeholder,
		autocomplete,
		inputmode,
		required = false,
		disabled = false,
		hint,
		error
	}: Props = $props();
</script>

<label class="field" class:has-error={!!error}>
	<span class="label">{label}</span>
	<input
		{type}
		bind:value
		{placeholder}
		{autocomplete}
		{inputmode}
		{required}
		{disabled}
		spellcheck={type === 'email' ? 'false' : undefined}
	/>
	{#if error}
		<span class="error">{error}</span>
	{:else if hint}
		<span class="hint">{hint}</span>
	{/if}
</label>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.label {
		font-size: 13px;
		font-weight: 500;
		color: var(--fg);
		letter-spacing: -0.005em;
	}
	input {
		width: 100%;
		padding: 14px 16px;
		font: inherit;
		font-size: 15px;
		letter-spacing: -0.005em;
		color: var(--fg);
		background-color: rgba(15, 28, 38, 0.55);
		border: 1px solid var(--border);
		border-radius: 8px;
		transition: border-color 160ms, box-shadow 160ms, background-color 160ms;
	}
	input::placeholder {
		color: var(--text-tertiary);
	}
	input:hover:not(:disabled) {
		border-color: var(--border-hover);
	}
	input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(240, 199, 100, 0.18);
		background-color: rgba(15, 28, 38, 0.85);
	}
	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.field.has-error input {
		border-color: var(--destructive);
	}
	.field.has-error input:focus {
		box-shadow: 0 0 0 3px rgba(232, 75, 58, 0.18);
	}
	.hint {
		font-size: var(--fs-micro);
		color: var(--muted-fg);
	}
	.error {
		font-size: var(--fs-micro);
		color: var(--destructive);
	}
</style>
