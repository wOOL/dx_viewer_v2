import { describe, it, expect } from 'vitest';
import { dropzoneClickOpensPicker } from './dropzone';

// Pure-logic test (node project — no DOM). dropzoneClickOpensPicker delegates to
// the target's `closest('label, input, button, a')`, so we model the click target
// with a minimal stub whose `closest` reports whether such an ancestor exists.
// Real ancestor matching is browser-native and covered by upload-filepicker.e2e.ts.
function target(hasInteractiveAncestor: boolean): EventTarget {
	return {
		closest(sel: string) {
			return hasInteractiveAncestor ? ({ matchedSelector: sel } as unknown as Element) : null;
		}
	} as unknown as EventTarget;
}

describe('dropzoneClickOpensPicker', () => {
	it('does NOT re-open the picker when the click is on/inside a label/input/button/anchor', () => {
		// Browse label, the nested file input, and the Remove/X button all have an
		// interactive ancestor → the dropzone must NOT call input.click() again.
		expect(dropzoneClickOpensPicker(target(true))).toBe(false);
	});

	it('OPENS the picker for a click on the bare dropzone surface', () => {
		// A plain caption inside the zone, or the focused dropzone div itself
		// (keyboard activation), has no such ancestor → open it.
		expect(dropzoneClickOpensPicker(target(false))).toBe(true);
	});

	it('is null / odd-target safe (opens by default)', () => {
		expect(dropzoneClickOpensPicker(null)).toBe(true);
		// A target without a usable closest() must not throw — default to opening.
		expect(dropzoneClickOpensPicker({} as EventTarget)).toBe(true);
	});
});
