<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
</script>

<div class="flex flex-col items-center justify-center py-20">
	<h1 class="mb-4 text-4xl font-bold text-destructive">{page.status}</h1>
	<p class="text-muted-foreground">{page.error?.message ?? m.error_unexpected()}</p>
	<a href="/" class="mt-6 text-primary hover:underline">{m.error_go_home()}</a>
</div>
