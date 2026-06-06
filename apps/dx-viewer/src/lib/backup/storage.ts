// Storage-quota pre-flight for restore/merge applies. Refusing up front beats failing
// halfway: the apply tx is atomic either way (a QuotaExceededError rolls back), but by
// then the browser has already spent minutes downloading — and a quota abort mid-tx reads
// as a generic failure instead of actionable guidance. Best-effort: the estimate API may
// be absent (older browsers, node tests) — then we proceed and rely on the atomic tx.

/** Throw when the free quota cannot hold another `bytes` (with 5% headroom). Used two
 *  ways: the zip path pre-flights the SUM of planned entry sizes before assembling; the
 *  online paths call it cumulatively after each sequential download — the blobs already
 *  downloaded occupy blob storage, and the apply tx will write a second, IndexedDB copy
 *  of roughly the same bytes, so "free space must still fit everything downloaded so
 *  far" is exactly the invariant that keeps the apply from blowing the quota. */
export async function ensureStorageFor(bytes: number): Promise<void> {
	if (bytes <= 0 || typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
	let free: number | undefined;
	try {
		const { usage, quota } = await navigator.storage.estimate();
		if (typeof quota === 'number' && typeof usage === 'number') free = quota - usage;
	} catch {
		return; // estimate unavailable — proceed, the atomic tx still protects the data
	}
	if (free !== undefined && bytes > free * 0.95) {
		throw new Error('not enough storage'); // mapped to a localized message by the card
	}
}
