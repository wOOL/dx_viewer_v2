<script lang="ts">
	import type { Snippet } from 'svelte';
	type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
	type Props = {
		variant?: Variant;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
		title?: string;
	};
	let { variant = 'primary', type = 'button', disabled = false, onclick, children, title }: Props = $props();
</script>

<button
	class="bezel btn btn-{variant}"
	{type}
	{disabled}
	{title}
	{onclick}
>
	{@render children()}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: var(--radius);
		font-weight: 500;
		font-size: var(--fs-body);
		letter-spacing: -0.01em;
		cursor: pointer;
		border: 1px solid transparent;
		transition: transform 100ms ease, background-color 150ms, color 150ms, border-color 150ms;
	}
	.btn:hover:not(:disabled) {
		transform: translateY(-1px);
	}
	.btn:active:not(:disabled) {
		transform: scale(0.985);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-primary {
		background-color: var(--primary);
		color: var(--primary-fg);
		border-color: var(--primary);
	}
	.btn-primary:hover:not(:disabled) {
		background-color: var(--primary-hover);
	}
	.btn-secondary {
		background-color: var(--surface-2);
		color: var(--fg);
		border-color: var(--border);
	}
	.btn-secondary:hover:not(:disabled) {
		background-color: var(--surface-3);
		border-color: var(--border-hover);
	}
	.btn-ghost {
		background-color: transparent;
		color: var(--muted-fg);
	}
	.btn-ghost:hover:not(:disabled) {
		background-color: var(--surface-2);
		color: var(--fg);
	}
	.btn-destructive {
		background-color: var(--destructive);
		color: var(--destructive-fg);
		border-color: var(--destructive);
	}
</style>
