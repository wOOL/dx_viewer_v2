<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth, subscription } from '$lib/auth.svelte';
	import { onDestroy } from 'svelte';

	let { children } = $props();
	let realtimeSubscribed = false;

	$effect(() => {
		if (auth.isUnauthenticated) {
			subscription.reset();
			realtimeSubscribed = false;
			goto('/login');
		} else if (auth.isAuthenticated && subscription.stage === 'unknown') {
			subscription.load().then(() => {
				if (!realtimeSubscribed && auth.isAuthenticated) {
					realtimeSubscribed = true;
					subscription.realtimeSubscribe();
				}
			});
		}
	});

	onDestroy(() => subscription.dispose());
</script>

{#if auth.isAuthenticated}
	{@render children()}
{/if}
