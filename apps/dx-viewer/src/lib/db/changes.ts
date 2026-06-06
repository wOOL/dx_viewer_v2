// Cross-tab data-change signal. LOCAL-FIRST removed the old "every tab re-fetches from
// PocketBase" coherence: each tab now holds an in-memory projection of IndexedDB, so a
// write in tab A (add/delete/rename patient…) left tab B stale FOREVER — stale enough
// for tab B's findOrCreatePatient to create a duplicate patient. Every localDb write
// announces itself here; the studies store refreshes (debounced) on the signal. A
// BroadcastChannel never receives its own messages, so the writing tab (whose store
// already patched itself) is not re-triggered.

const CHANNEL_NAME = 'dxv-local-changes';

let ch: BroadcastChannel | null | undefined;
function channel(): BroadcastChannel | null {
	if (ch !== undefined) return ch;
	ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
	// Node's BroadcastChannel (vitest env) holds the event loop open; unref it so test
	// processes can exit. Browser channels have no unref — optional chaining no-ops.
	(ch as unknown as { unref?: () => void } | null)?.unref?.();
	return ch;
}

/** 'write' = incremental row writes (other tabs refresh their projection);
 *  'replace' = a restore/import/wipe REPLACED the underlying rows wholesale — other
 *  tabs must hardReload (drop + revoke their cached object URLs), because a plain
 *  refresh re-attaches each surviving study id's OLD object URL and the tab keeps
 *  showing the PRE-replace image bytes. */
export type DataChangeKind = 'write' | 'replace';

/** Fire-and-forget: tell other tabs the local DB changed. Never throws. */
export function announceDataChanged(kind: DataChangeKind = 'write'): void {
	try {
		channel()?.postMessage(kind);
	} catch {
		/* channel closed / unavailable — best effort */
	}
}

/** Subscribe to other tabs' data changes. Returns an unsubscribe. */
export function onDataChanged(fn: (kind: DataChangeKind) => void): () => void {
	const c = channel();
	if (!c) return () => {};
	const handler = (e: MessageEvent) => fn(e.data === 'replace' ? 'replace' : 'write');
	c.addEventListener('message', handler);
	return () => c.removeEventListener('message', handler);
}

/** The receiving tab's dispatch policy, extracted pure for testing: debounced (a burst
 *  of writes → ONE reload), and 'replace' is STICKY across the debounce window — a
 *  trailing 'write' must not downgrade a pending hardReload back to a plain refresh
 *  (a refresh would re-attach this tab's PRE-replace object URLs → stale scans, the
 *  exact coherence bug the 'replace' kind exists to prevent). */
export function makeChangeDispatcher(opts: {
	refresh: () => void | Promise<void>;
	hardReload: () => void | Promise<void>;
	delayMs?: number;
}): (kind: DataChangeKind) => void {
	const delay = opts.delayMs ?? 250;
	let t: ReturnType<typeof setTimeout> | undefined;
	let replacePending = false;
	return (kind) => {
		if (kind === 'replace') replacePending = true;
		clearTimeout(t);
		t = setTimeout(() => {
			const hard = replacePending;
			replacePending = false; // sticky only within one debounce window
			// Best-effort: a failed reload here (transient IndexedDB error) must not
			// surface as an unhandled rejection — the next signal (or navigation)
			// retries naturally.
			void Promise.resolve(hard ? opts.hardReload() : opts.refresh()).catch((e) =>
				console.warn('cross-tab reload failed', e)
			);
		}, delay);
	};
}
