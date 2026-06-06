<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';

	onMount(() => {
		if (auth.isLoggedIn) {
			goto(resolve('/(app)/studies'), { replaceState: true });
		} else {
			goto(resolve('/(public)/login'), { replaceState: true });
		}
	});
</script>

<div class="flex h-screen items-center justify-center">
	<span class="spinner text-3xl text-fg-2"></span>
</div>
