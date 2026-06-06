import { describe, it, expect } from 'vitest';
import { canRestore } from './gate';

describe('canRestore (unified restore/import gate)', () => {
	it('blocks when there is no backup', () => {
		expect(canRestore({ localEmpty: true, localDataVersion: 0, backupDataVersion: null })).toEqual({
			ok: false,
			reason: 'no-backup'
		});
	});

	it('allows restoring into an empty local DB regardless of versions', () => {
		expect(canRestore({ localEmpty: true, localDataVersion: 0, backupDataVersion: 5 })).toEqual({
			ok: true,
			reason: 'ok'
		});
		// Even if a stale localDataVersion lingers, empty wins.
		expect(canRestore({ localEmpty: true, localDataVersion: 999, backupDataVersion: 5 })).toEqual({
			ok: true,
			reason: 'ok'
		});
	});

	it('allows when the backup is strictly newer than non-empty local data', () => {
		expect(canRestore({ localEmpty: false, localDataVersion: 10, backupDataVersion: 20 })).toEqual({
			ok: true,
			reason: 'ok'
		});
	});

	it('allows when versions are EQUAL (local data IS the backup — e.g. re-importing a just-exported file)', () => {
		// Every local write bumps the version, so equality ⇒ no unbacked-up work to lose.
		expect(canRestore({ localEmpty: false, localDataVersion: 20, backupDataVersion: 20 })).toEqual({
			ok: true,
			reason: 'ok'
		});
	});

	it('blocks when local data is strictly newer (would lose unbacked-up work)', () => {
		expect(canRestore({ localEmpty: false, localDataVersion: 30, backupDataVersion: 20 })).toEqual({
			ok: false,
			reason: 'local-newer'
		});
		expect(canRestore({ localEmpty: false, localDataVersion: 21, backupDataVersion: 20 })).toEqual({
			ok: false,
			reason: 'local-newer'
		});
	});
});
