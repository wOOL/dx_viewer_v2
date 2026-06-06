import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CbctToolRail from './CbctToolRail.svelte';
import { createCbctState } from '@be-certain/imaging-3d/state';

// The slice tools (crosshair / pan / W-L / ruler / angle / annotate / slab + the
// crosshair-toggle and reset-W/L) act on the MPR panes, so the rail must only show
// them in the MPR layout — otherwise they appear, inert, in the 3D and Panoramic
// views (the latter has its OWN ruler, which looked like a confusing duplicate).
describe('CbctToolRail (component)', () => {
	function rail(layoutMode: 'mpr' | 'volume' | 'panoramic' | 'report') {
		const store = createCbctState();
		store.layoutMode = layoutMode;
		return render(CbctToolRail, { store }).container;
	}

	it('shows the full slice-tool set in the MPR layout', () => {
		// 3 layout + 7 slice tools + (toggle-crosshair, reset W/L, reset-all) = 13
		expect(rail('mpr').querySelectorAll('button').length).toBe(13);
	});

	it('hides the MPR-only slice tools in the 3D volume layout (they would be inert)', () => {
		// only the 3 layout buttons + reset-all remain
		expect(rail('volume').querySelectorAll('button').length).toBe(4);
	});

	it('hides them in the Panoramic layout too (it carries its own tool column)', () => {
		expect(rail('panoramic').querySelectorAll('button').length).toBe(4);
	});
});
