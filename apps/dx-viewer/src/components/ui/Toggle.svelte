<script lang="ts">
	type Props = {
		checked: boolean;
		onchange: (next: boolean) => void;
		label: string;
		disabled?: boolean;
	};
	let { checked, onchange, label, disabled = false }: Props = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	{disabled}
	class="toggle"
	class:on={checked}
	onclick={() => !disabled && onchange(!checked)}
>
	<span class="thumb" aria-hidden="true"></span>
</button>

<style>
	.toggle {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: 38px;
		height: 22px;
		padding: 2px;
		border-radius: 999px;
		background-color: var(--surface-3);
		border: 1px solid var(--border);
		cursor: pointer;
		transition: background-color 220ms cubic-bezier(0.2, 0.7, 0.2, 1), border-color 220ms;
	}
	.toggle:hover:not(:disabled) {
		border-color: var(--border-hover);
	}
	.toggle:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.thumb {
		display: block;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background-color: var(--fg);
		transform: translateX(0);
		transition: transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1), background-color 220ms;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
	}
	.toggle.on {
		background-color: var(--accent);
		border-color: var(--accent);
	}
	.toggle.on .thumb {
		transform: translateX(16px);
		background-color: var(--primary-fg);
	}
</style>
