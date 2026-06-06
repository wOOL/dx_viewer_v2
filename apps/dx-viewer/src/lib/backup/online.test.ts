// Online backup/restore correctness — the torn-backup pointer protocol, orphan pruning,
// and the strict (no-silent-skip) restore download path. The PB client is stubbed with an
// ordered op log; the local side is a real fake-indexeddb LocalDb.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalDb } from '$lib/db/localDb';
import { genId } from '$lib/db/ids';
import type { UserSnapshot } from '$lib/db/schema';

const h = vi.hoisted(() => {
	const ops: string[] = [];
	const state = {
		failOnCreate: '' as string,
		serverRows: {} as Record<string, Record<string, unknown>[]>,
		tokenError: false,
		lastMetaCreate: null as Record<string, unknown> | null
	};
	const pb = {
		collection(name: string) {
			return {
				async getFullList(opts?: { fields?: string }) {
					// Record the fields filter so tests can pin "light" reads (the pointer
					// row also carries the tombstones blob — gate checks must exclude it).
					ops.push(`${name}.list${opts?.fields ? `:${opts.fields}` : ''}`);
					return state.serverRows[name] ?? [];
				},
				async delete(id: string) {
					ops.push(`${name}.delete:${id}`);
					return true;
				},
				async create(payload: Record<string, unknown>) {
					if (state.failOnCreate === name) throw new Error(`create failed for ${name}`);
					if (name === 'backup_meta') state.lastMetaCreate = payload;
					ops.push(`${name}.create:${payload['id'] ?? payload['user']}`);
					return payload;
				}
			};
		},
		files: {
			async getToken() {
				if (state.tokenError) throw new Error('token unavailable');
				return 'tok';
			},
			getURL(rec: Record<string, unknown>, fname: string) {
				return `https://pb.test/${rec['id']}/${fname}`;
			}
		}
	};
	const apiFetch = async (path: string) => {
		ops.push(`apiFetch:${path}`);
		return new Response('{}');
	};
	return { ops, state, pb, apiFetch };
});

vi.mock('$lib/pb', () => ({ pb: h.pb, apiFetch: h.apiFetch }));

import {
	backupToServer,
	restoreFromServer,
	mergeFromServer,
	planMergeFromServer,
	pruneOrphans,
	capTombstones
} from './online';
import type { DbDeletion } from '$lib/db/schema';

const U = 'user00000online';
let db: LocalDb;

beforeEach(() => {
	db = new LocalDb('test-' + genId());
	h.ops.length = 0;
	h.state.failOnCreate = '';
	h.state.serverRows = {};
	h.state.tokenError = false;
});
afterEach(async () => {
	await db.destroy();
	vi.unstubAllGlobals();
});

async function seedLocal() {
	const p = await db.putPatient({
		id: genId(),
		user: U,
		name: 'Backup Patient',
		created: '',
		updated: ''
	});
	const s = await db.putStudy({
		id: genId(),
		user: U,
		patient: p.id,
		modality: 'xray',
		created: '',
		updated: ''
	});
	await db.putFile({
		studyId: s.id,
		kind: 'image',
		user: U,
		blob: new Blob([new Uint8Array([1, 2, 3])]),
		filename: 'x.png',
		mime: 'image/png'
	});
	return { p, s };
}

describe('backupToServer — torn-backup pointer protocol', () => {
	it('deletes the backup_meta pointer BEFORE touching data and re-creates it LAST', async () => {
		await seedLocal();
		h.state.serverRows['backup_meta'] = [{ id: 'oldmeta' }];
		h.state.serverRows['patients'] = [{ id: 'oldpatient' }];

		await backupToServer(U, undefined, db);

		const idx = (op: string) => h.ops.findIndex((o) => o.startsWith(op));
		expect(idx('backup_meta.delete')).toBeGreaterThanOrEqual(0);
		// Pointer invalidated before the destructive patient reset…
		expect(idx('backup_meta.delete')).toBeLessThan(idx('patients.delete'));
		// …and re-created as the very LAST server op (only a complete upload advertises
		// a restorable backup).
		expect(h.ops[h.ops.length - 1]).toMatch(/^backup_meta\.create:/);
		// The pointer carries the export wire-format version (refused on restore when
		// it mismatches; PB drops the key until the backup_meta migration applies).
		expect(h.state.lastMetaCreate?.schemaVersion).toBe(1);
	});

	it('a mid-backup failure leaves NO server pointer (restore gate will refuse, not restore partial data)', async () => {
		await seedLocal();
		h.state.serverRows['backup_meta'] = [{ id: 'oldmeta' }];
		h.state.failOnCreate = 'studies';

		await expect(backupToServer(U, undefined, db)).rejects.toThrow(/create failed/);
		expect(h.ops).toContain('backup_meta.delete:oldmeta');
		expect(h.ops.some((o) => o.startsWith('backup_meta.create'))).toBe(false);
		// And the local pointer was not advanced either.
		expect(await db.getBackupPointer(U)).toBeNull();
	});

	it('skips orphan local rows instead of failing the whole backup on a PB relation error', async () => {
		// The guarded write paths can no longer CREATE orphans — but an imported snapshot
		// is not referentially validated, so seed them through importUser (the remaining
		// ingress) before adding the real data.
		await db.importUser(U, {
			patients: [],
			studies: [],
			inferences: [{ studyId: genId(), user: U, inference: null, userEdits: null }],
			files: [],
			studyReportState: [],
			cbctReportState: [],
			iosState: [
				{ id: genId(), user: U, study: genId(), hiddenMeshes: ['x'], created: '', updated: '' }
			],
			dataVersion: 1
		});
		const { s } = await seedLocal();
		// Real (non-orphan) sibling for contrast.
		await db.putInference({ studyId: s.id, user: U, inference: null, userEdits: null });

		await backupToServer(U, undefined, db);
		const stateCreates = h.ops.filter((o) => o.startsWith('ios_state.create'));
		expect(stateCreates).toEqual([]); // the orphan ios row was pruned
		expect(h.ops.filter((o) => o.startsWith('studies.create'))).toHaveLength(1);
		expect(h.ops[h.ops.length - 1]).toMatch(/^backup_meta\.create:/); // backup completed
	});
});

describe('server-side tombstones (backup_meta JSON blob)', () => {
	it('backupToServer uploads the local tombstones with the pointer', async () => {
		const { s } = await seedLocal();
		await db.deleteStudy(U, s.id); // writes a local tombstone
		await backupToServer(U, undefined, db);
		const uploaded = h.state.lastMetaCreate?.tombstones as DbDeletion[];
		expect(uploaded).toHaveLength(1);
		expect(uploaded[0]).toMatchObject({ table: 'studies', id: s.id });
	});

	it('capTombstones keeps the NEWEST entries and warns about the dropped oldest', () => {
		const ts = (id: string, deletedAt: string): DbDeletion => ({
			table: 'studies',
			id,
			user: U,
			deletedAt
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const capped = capTombstones(
				[
					ts('old0000000000a1', '2020-01-01T00:00:00.000Z'),
					ts('new0000000000a1', '2026-01-01T00:00:00.000Z'),
					ts('mid0000000000a1', '2024-01-01T00:00:00.000Z'),
					ts('new0000000000b2', '2025-01-01T00:00:00.000Z')
				],
				3
			);
			expect(capped.map((t) => t.id)).toEqual([
				'new0000000000a1',
				'new0000000000b2',
				'mid0000000000a1'
			]);
			expect(warn).toHaveBeenCalledOnce(); // no silent caps
		} finally {
			warn.mockRestore();
		}
	});

	it('the gate/preview pointer read stays LIGHT (fields filter excludes the blob)', async () => {
		const { p, s } = await seedLocal();
		seedServerForMerge(p.id, s.id);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([7]), { status: 200 }))
		);
		await planMergeFromServer(U, db);
		expect(h.ops).toContain('backup_meta.list:id,dataVersion,snapshotAt,schemaVersion');
	});

	it('restore imports VALID server tombstones into the local deletions table; junk is dropped', async () => {
		await seedLocal();
		const { sid } = seedServer();
		const deadId = genId();
		h.state.serverRows['backup_meta'] = [
			{
				id: 'm1',
				dataVersion: FUTURE_DV,
				snapshotAt: 'now',
				tombstones: [
					{
						table: 'studies',
						id: deadId,
						user: 'someoneelse00x',
						deletedAt: '2026-01-01T00:00:00.000Z'
					},
					{ table: 'users', id: genId(), deletedAt: 'x' }, // junk table
					{ table: 'patients', id: '../../etc', deletedAt: 'x' }, // junk id
					'garbage'
				]
			}
		];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 }))
		);
		await restoreFromServer(U, db);
		const ts = await db.getTombstones(U);
		expect(ts).toHaveLength(1);
		expect(ts[0]).toMatchObject({ table: 'studies', id: deadId, user: U }); // owner coerced
		void sid;
	});

	it('a MERGE does not import server tombstones (zip-merge parity: merge never deletes)', async () => {
		const { p, s } = await seedLocal();
		seedServerForMerge(p.id, s.id);
		h.state.serverRows['backup_meta'] = [
			{
				id: 'm1',
				dataVersion: FUTURE_DV,
				snapshotAt: 'now',
				tombstones: [
					{ table: 'studies', id: genId(), user: U, deletedAt: '2026-01-01T00:00:00.000Z' }
				]
			}
		];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([7]), { status: 200 }))
		);
		await mergeFromServer(U, { includeUpdates: true }, db);
		expect(await db.getTombstones(U)).toEqual([]);
	});
});

describe('pruneOrphans', () => {
	it('drops rows whose parent is missing and counts them', () => {
		const pid = genId();
		const sid = genId();
		const snap: UserSnapshot = {
			patients: [{ id: pid, user: U, name: 'P', created: '', updated: '' }],
			studies: [
				{ id: sid, user: U, patient: pid, modality: 'xray', created: '', updated: '' },
				{ id: genId(), user: U, patient: genId(), modality: 'xray', created: '', updated: '' }
			],
			inferences: [
				{ studyId: sid, user: U },
				{ studyId: genId(), user: U }
			],
			files: [],
			studyReportState: [],
			cbctReportState: [{ id: genId(), user: U, study: genId(), created: '', updated: '' }],
			iosState: [],
			dataVersion: 1
		};
		const { snap: pruned, dropped } = pruneOrphans(snap);
		expect(pruned.studies).toHaveLength(1);
		expect(pruned.inferences).toHaveLength(1);
		expect(pruned.cbctReportState).toHaveLength(0);
		expect(dropped).toBe(3);
	});
});

/** Server rows for the restore tests: one patient/study with an image + the 3 state rows
 *  (PB null-ish shapes — exercises the mapping defaults). Shared across describes. */
// Far-future server dataVersion: the in-lock TOCTOU gate (restoreFromServerLocked)
// must PASS for these tests — each exercises a different abort/success concern.
const FUTURE_DV = 9_000_000_000_000_000;

function seedServer() {
	const pid = genId();
	const sid = genId();
	h.state.serverRows['backup_meta'] = [{ id: 'm1', dataVersion: FUTURE_DV, snapshotAt: 'now' }];
	h.state.serverRows['patients'] = [{ id: pid, name: 'Restored P', created: 'c', updated: 'u' }];
	h.state.serverRows['studies'] = [
		{
			id: sid,
			patient: pid,
			modality: 'xray',
			image: 'scan.png',
			segmentation: '',
			inference: { ok: true },
			created: 'c',
			updated: 'u'
		}
	];
	// Per-study state rows with PB's null-ish field shapes — exercises the restore
	// mapping defaults (?? fallbacks) that turn them into well-formed local rows.
	h.state.serverRows['study_report_state'] = [
		{ id: genId(), study: sid, reportText: null, status: null, created: 'c', updated: 'u' }
	];
	h.state.serverRows['cbct_report_state'] = [
		{
			id: genId(),
			study: sid,
			signedBy: 'Dr R',
			signedAt: '',
			approvedTeeth: null,
			comments: null,
			markups: null,
			hiddenMeshes: null,
			created: 'c',
			updated: 'u'
		}
	];
	h.state.serverRows['ios_state'] = [
		{
			id: genId(),
			study: sid,
			measures: null,
			hiddenMeshes: ['Tooth 11'],
			created: 'c',
			updated: 'u'
		}
	];
	return { pid, sid };
}

describe('restoreFromServer — strict downloads (no silent binary loss)', () => {
	it('REFUSES a backup written by an incompatible app version (schemaVersion mismatch)', async () => {
		const { p } = await seedLocal();
		seedServer();
		h.state.serverRows['backup_meta'] = [
			{ id: 'm1', dataVersion: FUTURE_DV, snapshotAt: 'now', schemaVersion: 99 }
		];
		await expect(restoreFromServer(U, db)).rejects.toThrow(/unsupported backup version/);
		expect((await db.getPatient(U, p.id))?.name).toBe('Backup Patient'); // untouched
	});

	it('tolerates a PRE-MIGRATION pointer with no schemaVersion (0/absent → no version check)', async () => {
		await seedLocal();
		const { pid } = seedServer();
		// PB returns 0 for an unset number field on old rows.
		h.state.serverRows['backup_meta'] = [
			{ id: 'm1', dataVersion: FUTURE_DV, snapshotAt: 'now', schemaVersion: 0 }
		];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 }))
		);
		await expect(restoreFromServer(U, db)).resolves.toEqual({ dataVersion: FUTURE_DV });
		expect((await db.getPatient(U, pid))?.name).toBe('Restored P');
	});

	it('aborts (before touching local data) when the file token cannot be obtained', async () => {
		const { p } = await seedLocal(); // pre-existing local data must survive
		seedServer();
		h.state.tokenError = true;

		await expect(restoreFromServer(U, db)).rejects.toThrow(/token unavailable/);
		expect((await db.getPatient(U, p.id))?.name).toBe('Backup Patient'); // untouched
	});

	it('RETRIES an auth-failed download once with a FRESH token (mid-restore token expiry must not abort)', async () => {
		await seedLocal();
		const { pid } = seedServer();
		const origGetToken = h.pb.files.getToken;
		let tokens = 0;
		h.pb.files.getToken = async () => {
			tokens++;
			return `tok${tokens}`;
		};
		try {
			// First fetch: 403 (token expired at the edge) → retry with fresh token: 200.
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(new Response('expired', { status: 403 }))
				.mockResolvedValue(new Response(new Uint8Array([9]), { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

			await expect(restoreFromServer(U, db)).resolves.toEqual({ dataVersion: FUTURE_DV });
			expect(tokens).toBe(2); // initial + forced-fresh on the retry
			expect((await db.getPatient(U, pid))?.name).toBe('Restored P');
		} finally {
			h.pb.files.getToken = origGetToken;
		}
	});

	it('still throws when the RETRY also fails (genuine failure, not expiry)', async () => {
		const { p } = await seedLocal();
		seedServer();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('forbidden', { status: 403 }))
		);
		await expect(restoreFromServer(U, db)).rejects.toThrow(/download failed \(HTTP 403\)/);
		expect((await db.getPatient(U, p.id))?.name).toBe('Backup Patient'); // untouched
	});

	it('aborts when any binary download fails (no "successful" restore with missing scans)', async () => {
		const { p } = await seedLocal();
		seedServer();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 404 }))
		);

		await expect(restoreFromServer(U, db)).rejects.toThrow(/download failed \(HTTP 404\)/);
		expect((await db.getPatient(U, p.id))?.name).toBe('Backup Patient'); // untouched
	});

	it('replaces local data and stamps the backup dataVersion on success', async () => {
		await seedLocal();
		const { pid, sid } = seedServer();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200 }))
		);

		const res = await restoreFromServer(U, db);
		expect(res.dataVersion).toBe(FUTURE_DV);
		expect((await db.getPatient(U, pid))?.name).toBe('Restored P');
		expect((await db.getFile(sid, 'image'))?.filename).toBe('scan.png');
		expect(await db.getDataVersion(U)).toBe(FUTURE_DV);
		expect((await db.getBackupPointer(U))?.dataVersion).toBe(FUTURE_DV);
		// The pre-existing local patient was replaced (full wipe + import).
		expect(await db.getPatients(U)).toHaveLength(1);
		// State rows restored with the mapping DEFAULTS applied to PB's null-ish shapes.
		const srs = await db.getStudyReport(U, sid);
		expect(srs).toMatchObject({ reportText: '', status: '' });
		const crs = await db.getCbctReport(U, sid);
		expect(crs).toMatchObject({
			signedBy: 'Dr R',
			signedAt: null,
			approvedTeeth: [],
			comments: {},
			hiddenMeshes: []
		});
		const ios = await db.getIosState(U, sid);
		expect(ios?.hiddenMeshes).toEqual(['Tooth 11']);
		expect(ios?.measures).toBeUndefined();
	});
});

/** Server rows for the merge tests: one patient/study the local side ALSO has (older
 *  there) + one extra patient/study only the server has. Shared across describes. */
function seedServerForMerge(localPid: string, localSid: string) {
	const pid2 = genId();
	const sid2 = genId();
	h.state.serverRows['backup_meta'] = [{ id: 'm1', dataVersion: 42, snapshotAt: 'now' }];
	h.state.serverRows['patients'] = [
		// Same id as local, garbage-old stamp → local wins, unchanged.
		{ id: localPid, name: 'Stale Server Copy', created: 'c', updated: 'u' },
		{ id: pid2, name: 'Server Only', created: 'c', updated: 'u' }
	];
	h.state.serverRows['studies'] = [
		{
			id: localSid,
			patient: localPid,
			modality: 'xray',
			image: 'old.png',
			segmentation: '',
			created: 'c',
			updated: 'u'
		},
		{
			id: sid2,
			patient: pid2,
			modality: 'xray',
			image: 'extra.png',
			segmentation: '',
			inference: { ok: true },
			created: 'c',
			updated: 'u'
		}
	];
	h.state.serverRows['study_report_state'] = [];
	h.state.serverRows['cbct_report_state'] = [];
	h.state.serverRows['ios_state'] = [];
	return { pid2, sid2 };
}

describe('mergeFromServer — diff-then-merge with SELECTIVE downloads', () => {
	it('downloads ONLY the planned blobs, adds the missing tree, and does NOT move the pointer', async () => {
		const { p, s } = await seedLocal();
		const { pid2, sid2 } = seedServerForMerge(p.id, s.id);
		const fetchMock = vi.fn(
			async (_url: RequestInfo | URL) => new Response(new Uint8Array([7]), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);

		const res = await mergeFromServer(U, { includeUpdates: true }, db);
		expect(res.applied).toBe(true);
		expect(res.plan.counts.patientsAdded).toBe(1);
		expect(res.plan.counts.studiesAdded).toBe(1);
		// THE selective-download win: one fetch, for the server-only study — the unchanged
		// local study's blob is never re-downloaded (restore would have pulled both).
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]![0])).toContain(sid2);
		// Union applied; local rows untouched.
		expect((await db.getPatient(U, pid2))?.name).toBe('Server Only');
		expect((await db.getPatient(U, p.id))?.name).toBe('Backup Patient');
		expect((await db.getInference(sid2))?.inference).toEqual({ ok: true });
		// Merged state is strictly newer than the backup; the pointer did NOT move
		// (it records the last completed BACKUP — a merge is not one).
		expect(await db.getDataVersion(U)).toBeGreaterThan(42);
		expect(await db.getBackupPointer(U)).toBeNull();
	});

	it('planMergeFromServer (the preview) downloads nothing and writes nothing', async () => {
		const { p, s } = await seedLocal();
		seedServerForMerge(p.id, s.id);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const dv = await db.getDataVersion(U);

		const plan = await planMergeFromServer(U, db);
		expect(plan.counts.patientsAdded).toBe(1);
		expect(plan.counts.studiesAdded).toBe(1);
		expect(plan.counts.filesToFetch).toBe(1);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await db.getDataVersion(U)).toBe(dv);
	});

	it('a failed planned download aborts BEFORE local data is touched', async () => {
		const { p, s } = await seedLocal();
		const { pid2 } = seedServerForMerge(p.id, s.id);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 404 }))
		);
		await expect(mergeFromServer(U, { includeUpdates: true }, db)).rejects.toThrow(
			/download failed \(HTTP 404\)/
		);
		expect(await db.getPatient(U, pid2)).toBeUndefined(); // nothing merged
	});

	it('aborts BEFORE local data is touched when downloads would blow the storage quota', async () => {
		// PB records carry no sizes — the guard is cumulative across the sequential
		// downloads. Stub a navigator whose estimate has almost no free space.
		const { p, s } = await seedLocal();
		const { pid2 } = seedServerForMerge(p.id, s.id);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array(1024), { status: 200 }))
		);
		vi.stubGlobal('navigator', {
			storage: { estimate: async () => ({ usage: 999, quota: 1000 }) }
		});
		await expect(mergeFromServer(U, { includeUpdates: true }, db)).rejects.toThrow(
			/not enough storage/
		);
		expect(await db.getPatient(U, pid2)).toBeUndefined(); // nothing merged

		// The full-restore download loop has the same cumulative guard. (Lift the backup's
		// dataVersion past local so the in-lock TOCTOU gate passes and the QUOTA guard is
		// what aborts.)
		h.state.serverRows['backup_meta'] = [{ id: 'm1', dataVersion: FUTURE_DV, snapshotAt: 'now' }];
		await expect(restoreFromServer(U, db)).rejects.toThrow(/not enough storage/);
		expect((await db.getPatient(U, p.id))?.name).toBe('Backup Patient'); // untouched
	});

	it('TOCTOU guard: a Replace whose gate verdict went stale is REFUSED inside the lock', async () => {
		// Local data exists and is NEWER than the backup (writes landed after the dialog's
		// preview-time verdict — this tab's debounced saves or another tab) — the locked
		// apply must re-assert the gate and refuse, not wipe the newer work.
		const { p, s } = await seedLocal();
		seedServerForMerge(p.id, s.id); // backup_meta dataVersion 42 << local Date.now()
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([7]), { status: 200 }))
		);
		await expect(restoreFromServer(U, db)).rejects.toThrow(/local-newer/);
		expect((await db.getPatient(U, p.id))?.name).toBe('Backup Patient'); // untouched
		expect(await db.getStudy(U, s.id)).toBeTruthy();
	});

	it('a server-newer study updates the unit only with includeUpdates (stamp preserved)', async () => {
		const { p, s } = await seedLocal();
		h.state.serverRows['backup_meta'] = [{ id: 'm1', dataVersion: 42, snapshotAt: 'now' }];
		h.state.serverRows['patients'] = [{ id: p.id, name: 'Same P', created: 'c', updated: 'u' }];
		h.state.serverRows['studies'] = [
			{
				id: s.id,
				patient: p.id,
				modality: 'xray',
				image: 'scan.png',
				segmentation: '',
				fmxSlot: 'UL',
				created: 'c',
				updated: '2999-01-01T00:00:00.000Z' // strictly newer than the local stamp
			}
		];
		h.state.serverRows['study_report_state'] = [];
		h.state.serverRows['cbct_report_state'] = [];
		h.state.serverRows['ios_state'] = [];
		const fetchMock = vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		// Adds-only: the update is stripped → empty plan, nothing downloaded or written.
		const stripped = await mergeFromServer(U, { includeUpdates: false }, db);
		expect(stripped.applied).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
		expect((await db.getStudy(U, s.id))?.fmxSlot).toBeUndefined();

		// Full merge: the unit flips — row updated (stamp preserved) + blob re-downloaded.
		const full = await mergeFromServer(U, { includeUpdates: true }, db);
		expect(full.applied).toBe(true);
		expect(full.plan.counts.studiesUpdated).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const after = await db.getStudy(U, s.id);
		expect(after?.fmxSlot).toBe('UL');
		expect(after?.updated).toBe('2999-01-01T00:00:00.000Z');
		expect((await db.getFile(s.id, 'image'))?.filename).toBe('scan.png');
	});
});
