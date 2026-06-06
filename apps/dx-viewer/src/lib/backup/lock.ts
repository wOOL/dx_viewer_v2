// Cross-tab serialization for every operation that REPLACES or MERGES the local data or
// the server copy. One shared Web Lock: a merge racing a backup (or a second tab's merge
// racing this one) would otherwise interleave plan→download→apply with the other side's
// delete+create and produce a non-deterministic result — each tab's plan was computed
// against a snapshot the other tab is mutating. Browsers without navigator.locks (and the
// node test env) just run the op — the per-tab `busy` flag still guards the common case.
//
// NOT re-entrant: never call a with*Lock'd function from inside another one (the inner
// request would queue behind the outer hold forever).

const LOCK_NAME = 'dxv-online-backup'; // historical name — now guards ALL backup/restore/merge ops

export async function withBackupLock<T>(op: () => Promise<T>): Promise<T> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (!locks?.request) return op();
	return locks.request(LOCK_NAME, op) as Promise<T>;
}
