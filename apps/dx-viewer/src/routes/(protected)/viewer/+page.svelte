<script lang="ts">
	import { page } from '$app/state';
	import Viewer2D from '$components/viewer-2d/Viewer2D.svelte';
	import Viewer3D from '$components/viewer-3d/Viewer3D.svelte';
	import { PaywallGuard } from '@be-certain/ui';
	import { subscription } from '$lib/auth.svelte';

	const mode = $derived(page.url.searchParams.get('mode') ?? '3d');
</script>

<PaywallGuard service={subscription}>
	{#if mode === '2d'}
		<Viewer2D />
	{:else}
		<Viewer3D />
	{/if}
</PaywallGuard>
