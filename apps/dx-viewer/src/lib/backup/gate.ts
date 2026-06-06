// The unified restore/import gate. A backup (online OR a .zip file) may only OVERWRITE
// the live local data when doing so cannot lose newer work: either the local DB is empty,
// or it is OLDER than the backup. Both online backups and export files carry the
// dataVersion of the data they contain; local data carries its own (bumped on every
// write). Pure + exhaustively tested so the destructive-overwrite decision is auditable.

export type GateReason = 'no-backup' | 'local-newer' | 'ok';

export interface GateResult {
	ok: boolean;
	reason: GateReason;
}

export function canRestore(input: {
	localEmpty: boolean;
	localDataVersion: number;
	/** The backup's dataVersion, or null when there is no backup to restore from. */
	backupDataVersion: number | null;
}): GateResult {
	if (input.backupDataVersion == null) return { ok: false, reason: 'no-backup' };
	// An empty local DB can always be (re)populated from a backup — nothing to lose.
	if (input.localEmpty) return { ok: true, reason: 'ok' };
	// Non-empty local: overwrite only when the backup is at least as new as local. EQUAL
	// versions are allowed — every local write bumps the version, so equality means the
	// local data IS what the backup contains (e.g. re-importing a just-exported file);
	// restoring it cannot lose work. A strictly-newer local is kept (overwriting would
	// lose unbacked-up local changes).
	if (input.localDataVersion <= input.backupDataVersion) return { ok: true, reason: 'ok' };
	return { ok: false, reason: 'local-newer' };
}
