// Keyboard-navigation intent helpers, kept pure so they're unit-testable
// independent of the Svelte components that wire them to a <svelte:window onkeydown>.

/** True when the event target is a control where arrow keys mean "edit this", not
 *  "navigate" — a text field, textarea, contenteditable, or a slider/select. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
	const el = target as (HTMLElement & { tagName?: string }) | null;
	if (!el || !el.tagName) return false;
	const tag = el.tagName.toUpperCase();
	if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (tag === 'INPUT') return true; // includes range/number/text — arrows adjust the control
	if (el.isContentEditable) return true;
	return false;
}

/** Map an arrow keypress to a prev/next study navigation intent, or null when it
 *  should be ignored: a modal is open (`blocked`), the user is typing/adjusting a
 *  control, or the key isn't a left/right arrow. Left = previous, Right = next —
 *  the standard radiograph-viewer convention (#44 parity gap). */
export function arrowNavIntent(
	key: string,
	opts: { blocked?: boolean; target?: EventTarget | null } = {}
): 'prev' | 'next' | null {
	if (opts.blocked) return null;
	if (isTextEntryTarget(opts.target ?? null)) return null;
	if (key === 'ArrowLeft') return 'prev';
	if (key === 'ArrowRight') return 'next';
	return null;
}

/** Map an Up/Down arrow to a slice step (−1 toward slice 0, matching wheel-up), or
 *  null when ignored (a modal is open, the user is typing, or another key). Used for
 *  CBCT MPR slice scrubbing on the hovered pane (#44). Only Up/Down so Left/Right
 *  stay free (the CBCT view has no prev/next-study axis). */
export function sliceStepIntent(
	key: string,
	opts: { blocked?: boolean; target?: EventTarget | null } = {}
): -1 | 1 | null {
	if (opts.blocked) return null;
	if (isTextEntryTarget(opts.target ?? null)) return null;
	if (key === 'ArrowUp') return -1;
	if (key === 'ArrowDown') return 1;
	return null;
}

/** Keyboard action for the 3D surface-measure tool (IOS), or null when ignored
 *  (measure mode off, the user is typing, or an unrelated key). The two-click tool
 *  previously had no keyboard escape: a dropped first point could only be resolved
 *  by completing an unwanted segment or clearing every measurement. This gives it a
 *  proper back-out story — Escape cancels the in-progress point, or leaves the tool
 *  when there's nothing pending; Backspace/Delete undoes the most recent committed
 *  segment (or cancels a pending point first). */
export function measureKeyIntent(
	key: string,
	opts: {
		measureMode?: boolean;
		hasPending?: boolean;
		hasSegments?: boolean;
		target?: EventTarget | null;
	} = {}
): 'cancel-pending' | 'exit-mode' | 'undo-last' | null {
	if (!opts.measureMode) return null;
	if (isTextEntryTarget(opts.target ?? null)) return null;
	if (key === 'Escape') return opts.hasPending ? 'cancel-pending' : 'exit-mode';
	if (key === 'Backspace' || key === 'Delete') {
		if (opts.hasPending) return 'cancel-pending';
		return opts.hasSegments ? 'undo-last' : null;
	}
	return null;
}
