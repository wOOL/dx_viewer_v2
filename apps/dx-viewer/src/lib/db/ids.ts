// Local record id generator. Produces a 15-char lowercase-alphanumeric id that is
// indistinguishable from a PocketBase auto-id (`[a-z0-9]{15}`). This matters for the
// online backup: PB accepts a custom `id` on create when it matches the collection's
// id pattern, so a locally-created study can round-trip to the server keeping the SAME
// id (idempotent re-backup, stable cross-references between studies and report-state).

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A 15-char `[a-z0-9]` id (matches PB's auto-id pattern). Uses crypto when available
 *  for collision resistance, falling back to Math.random only where crypto is absent. */
export function genId(): string {
	const n = 15;
	let out = '';
	const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
	if (cryptoObj?.getRandomValues) {
		const buf = new Uint8Array(n);
		cryptoObj.getRandomValues(buf);
		for (let i = 0; i < n; i++) out += ALPHABET[buf[i]! % ALPHABET.length];
		return out;
	}
	for (let i = 0; i < n; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	return out;
}

/** True when a string is a valid local/PB record id (so backup/import can reject junk). */
export function isValidId(id: unknown): id is string {
	return typeof id === 'string' && /^[a-z0-9]{15}$/.test(id);
}
