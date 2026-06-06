// Helper for the New-Study dropzone, which is a role="button" <div> with an
// onclick that programmatically opens its hidden <input type="file">. The
// "Browse" / "Add more" controls are <label>s wrapping that input, nested INSIDE
// the dropzone div. Clicking such a label opens the file chooser natively
// (label -> input); if the same click ALSO bubbles to the div's handler and
// calls input.click(), the chooser opens TWICE in one user gesture. Browsers
// handle a duplicate open inconsistently and intermittently drop the resulting
// `change` event, so the picked file fails to register perhaps a third of the
// time (the reported "I select a file but it acts like I picked nothing"). The
// Remove/X <button> inside the zone has the same problem in reverse: a click on
// it would also pop the file chooser.
//
// So the dropzone should only open the picker programmatically for a click on
// its BARE surface, never one that originated on a nested label/input/button/
// anchor (those open it natively, or must stay inert).

/** True when a click inside the dropzone should programmatically open the file
 *  picker: it landed on the bare zone, not on a nested label/input/button/anchor.
 *  Keyboard activation passes the focused dropzone element itself, which has none
 *  of those ancestors, so it still opens. Null/odd targets default to opening. */
export function dropzoneClickOpensPicker(target: EventTarget | null): boolean {
	const el = target as Element | null;
	if (!el || typeof el.closest !== 'function') return true;
	return el.closest('label, input, button, a') == null;
}
