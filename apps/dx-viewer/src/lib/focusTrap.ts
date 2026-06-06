// #86 — Accessible modal focus management, as a Svelte `use:` action.
//
// Apply to a `role="dialog"` element that is conditionally rendered inside an
// `{#if open}` block, so the action's mount/destroy lifecycle tracks the dialog
// opening/closing. On mount it moves focus into the dialog; while open it traps
// Tab / Shift+Tab so keyboard focus can't wander to the (visually obscured)
// page behind the modal; on destroy it restores focus to whatever was focused
// before the dialog opened (usually the trigger button). This satisfies the
// modal-dialog focus contract (WCAG 2.4.3 Focus Order + the no-escape
// expectation for aria-modal dialogs) that every modal here was missing.

const FOCUSABLE = [
	'a[href]',
	'area[href]',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'button:not([disabled])',
	'iframe',
	'[tabindex]:not([tabindex="-1"])',
	'[contenteditable="true"]'
].join(',');

// Visible + not inert. getClientRects() forces synchronous layout, so it is
// accurate even on the same tick the dialog mounts (paint hasn't happened yet,
// but layout has) — which is why the initial focus needn't be deferred.
function visibleFocusable(node: HTMLElement): HTMLElement[] {
	return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(el) => el.getClientRects().length > 0 && el.closest('[inert]') === null
	);
}

export function focusTrap(node: HTMLElement) {
	const previouslyFocused = document.activeElement as HTMLElement | null;

	function focusFirst() {
		const items = visibleFocusable(node);
		if (items.length > 0) {
			items[0].focus();
		} else {
			// No focusable content — make the container itself focusable so focus
			// still lands inside the dialog (and Tab has nothing to escape to).
			if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
			node.focus();
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const items = visibleFocusable(node);
		if (items.length === 0) {
			// Nothing tabbable — keep focus pinned to the container.
			e.preventDefault();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		const outside = !(active instanceof Node) || !node.contains(active);
		if (e.shiftKey) {
			if (active === first || outside) {
				e.preventDefault();
				last.focus();
			}
		} else {
			if (active === last || outside) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	node.addEventListener('keydown', onKeydown);
	focusFirst();

	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			// Restore focus to the trigger if it's still in the document.
			if (previouslyFocused && document.contains(previouslyFocused)) {
				previouslyFocused.focus();
			}
		}
	};
}
