<script lang="ts">
	import type { CbctStore } from '@be-certain/imaging-3d/state';
	import PanoramicCanvas from '$lib/components/cbct/PanoramicCanvas.svelte';

	interface Props {
		store: CbctStore;
	}
	const { store }: Props = $props();
</script>

<!-- The dedicated Panoramic view: a thick-slab MAX-projection reformat of the volume with
     the full interactive tool set (pan/zoom/fit, ruler in mm, MIP-slab, crosshair, overlays),
     shared with the Report's panoramic via PanoramicCanvas. -->
<div class="h-full w-full bg-black">
	<PanoramicCanvas {store} />
</div>
