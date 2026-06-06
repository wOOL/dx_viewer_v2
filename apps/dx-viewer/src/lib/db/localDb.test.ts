import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';
import { LocalDb } from './localDb';
import { genId } from './ids';
import { planMerge, type LocalSnapshotLite, type BackupManifestLite } from '$lib/backup/merge';
import type { DbPatient, DbStudy } from './schema';

const U = 'user000000000a1';
const U2 = 'user000000000b2';

function patient(over: Partial<DbPatient> = {}): DbPatient {
	return {
		id: genId(),
		user: U,
		name: 'Jane Doe',
		created: '',
		updated: '',
		...over
	};
}
function study(patientId: string, over: Partial<DbStudy> = {}): DbStudy {
	return {
		id: genId(),
		user: U,
		patient: patientId,
		modality: 'xray',
		created: '',
		updated: '',
		...over
	};
}

let db: LocalDb;
beforeEach(() => {
	db = new LocalDb('test-' + genId());
});
afterEach(async () => {
	await db.destroy();
});

describe('patients', () => {
	it('put/get round-trips and stamps created+updated', async () => {
		const p = await db.putPatient(patient({ name: 'Ann' }));
		expect(p.created).toBeTruthy();
		expect(p.updated).toBeTruthy();
		const got = await db.getPatient(U, p.id);
		expect(got?.name).toBe('Ann');
	});

	it('preserves created across updates but advances updated', async () => {
		const p = await db.putPatient(patient());
		const created = p.created;
		await new Promise((r) => setTimeout(r, 2));
		const p2 = await db.putPatient({ ...p, name: 'Renamed' });
		expect(p2.created).toBe(created);
		expect(p2.updated >= p.updated).toBe(true);
		expect((await db.getPatient(U, p.id))?.name).toBe('Renamed');
	});

	it('lists user patients newest-first and isolates other users', async () => {
		const a = await db.putPatient(patient({ name: 'A' }));
		await new Promise((r) => setTimeout(r, 2));
		await db.putPatient(patient({ name: 'B' }));
		await db.putPatient(patient({ user: U2, name: 'Other' }));
		const list = await db.getPatients(U);
		expect(list.map((p) => p.name)).toEqual(['B', 'A']);
		expect(await db.getPatient(U, a.id)).toBeTruthy();
		// U2's patient is invisible to U
		expect((await db.getPatients(U)).every((p) => p.user === U)).toBe(true);
		expect((await db.getPatients(U2)).map((p) => p.name)).toEqual(['Other']);
	});

	it('isEmpty reflects per-user presence', async () => {
		expect(await db.isEmpty(U)).toBe(true);
		await db.putPatient(patient());
		expect(await db.isEmpty(U)).toBe(false);
		expect(await db.isEmpty(U2)).toBe(true);
	});
});

describe('dataVersion', () => {
	it('starts at 0 and bumps monotonically on every write', async () => {
		expect(await db.getDataVersion(U)).toBe(0);
		await db.putPatient(patient());
		const v1 = await db.getDataVersion(U);
		expect(v1).toBeGreaterThan(0);
		await db.putPatient(patient());
		const v2 = await db.getDataVersion(U);
		expect(v2).toBeGreaterThan(v1);
	});

	it('is independent per user', async () => {
		await db.putPatient(patient());
		expect(await db.getDataVersion(U2)).toBe(0);
	});
});

describe('studies + inference + files', () => {
	it('stores light study + lazy inference separately', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id, { findingCounts: { toothCount: 3 } }));
		expect((await db.getStudy(U, s.id))?.findingCounts?.toothCount).toBe(3);
		expect(await db.getInference(s.id)).toBeUndefined();
		await db.putInference({ studyId: s.id, user: U, inference: { report: 'hi' } as never });
		expect((await db.getInference(s.id))?.inference).toBeTruthy();
	});

	it('round-trips a binary Blob in the files store', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
		await db.putFile({
			studyId: s.id,
			kind: 'image',
			user: U,
			blob: new Blob([bytes], { type: 'application/octet-stream' }),
			filename: 'scan.nrrd',
			mime: 'application/octet-stream'
		});
		const f = await db.getFile(s.id, 'image');
		expect(f?.filename).toBe('scan.nrrd');
		const back = new Uint8Array(await f!.blob.arrayBuffer());
		expect(Array.from(back)).toEqual([1, 2, 3, 250, 251, 252]);
	});

	it('getStudiesByPatient is scoped to user+patient', async () => {
		const p1 = await db.putPatient(patient());
		const p2 = await db.putPatient(patient());
		await db.putStudy(study(p1.id));
		await db.putStudy(study(p1.id));
		await db.putStudy(study(p2.id));
		expect((await db.getStudiesByPatient(U, p1.id)).length).toBe(2);
		expect((await db.getStudiesByPatient(U, p2.id)).length).toBe(1);
	});

	it('patchStudy updates only the given columns and refuses cross-user writes', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id, { fmxSlot: undefined }));
		await db.patchStudy(U, s.id, { fmxSlot: 'UR1' });
		expect((await db.getStudy(U, s.id))?.fmxSlot).toBe('UR1');
		expect(await db.patchStudy(U2, s.id, { fmxSlot: 'hacked' })).toBeUndefined();
		expect((await db.getStudy(U, s.id))?.fmxSlot).toBe('UR1');
	});

	it('an EMPTY patch bumps the `updated` stamp (the projection cache key for inference carry-over)', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		await new Promise((r) => setTimeout(r, 2));
		const patched = await db.patchStudy(U, s.id, {});
		expect(patched).toBeTruthy();
		expect(patched!.updated > s.updated).toBe(true);
	});

	it('reassignStudy moves a study to another patient', async () => {
		const p1 = await db.putPatient(patient());
		const p2 = await db.putPatient(patient());
		const s = await db.putStudy(study(p1.id));
		await db.reassignStudy(U, s.id, p2.id);
		expect((await db.getStudiesByPatient(U, p1.id)).length).toBe(0);
		expect((await db.getStudiesByPatient(U, p2.id)).length).toBe(1);
	});
});

describe('cascade deletes', () => {
	async function seedStudyWithChildren() {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		await db.putInference({ studyId: s.id, user: U, inference: { report: 'x' } as never });
		await db.putFile({
			studyId: s.id,
			kind: 'image',
			user: U,
			blob: new Blob(['a']),
			filename: 'a',
			mime: 'text/plain'
		});
		await db.upsertCbctReport(U, s.id, { signedBy: 'Dr A' });
		await db.upsertIosState(U, s.id, { measures: [{ a: [0, 0, 0], b: [1, 1, 1] }] });
		await db.upsertStudyReport(U, s.id, { reportText: 'note', status: 'acceptable' });
		return { p, s };
	}

	it('deleteStudy removes the study and ALL its children', async () => {
		const { s } = await seedStudyWithChildren();
		await db.deleteStudy(U, s.id);
		expect(await db.getStudy(U, s.id)).toBeUndefined();
		expect(await db.getInference(s.id)).toBeUndefined();
		expect(await db.getFile(s.id, 'image')).toBeUndefined();
		expect(await db.getCbctReport(U, s.id)).toBeUndefined();
		expect(await db.getIosState(U, s.id)).toBeUndefined();
		expect(await db.getStudyReport(U, s.id)).toBeUndefined();
	});

	it('deletePatient cascades to studies and their children', async () => {
		const { p, s } = await seedStudyWithChildren();
		await db.deletePatient(U, p.id);
		expect(await db.getPatient(U, p.id)).toBeUndefined();
		expect(await db.getStudy(U, s.id)).toBeUndefined();
		expect(await db.getInference(s.id)).toBeUndefined();
		expect(await db.getFile(s.id, 'image')).toBeUndefined();
	});
});

describe('report-state upserts (unique [user+study])', () => {
	it('re-saving reuses the same record id (never duplicates)', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id, { modality: 'cbct' }));
		const r1 = await db.upsertCbctReport(U, s.id, { signedBy: 'Dr A', approvedTeeth: [11] });
		const r2 = await db.upsertCbctReport(U, s.id, { approvedTeeth: [11, 12] });
		expect(r2!.id).toBe(r1!.id);
		expect(r2!.signedBy).toBe('Dr A'); // preserved when not overwritten
		expect(r2!.approvedTeeth).toEqual([11, 12]);
	});

	it('study-report upsert merges text + status', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		const r = await db.upsertStudyReport(U, s.id, { reportText: 'hello', status: 'unacceptable' });
		expect(r!.reportText).toBe('hello');
		expect(r!.status).toBe('unacceptable');
		expect((await db.getStudyReport(U, s.id))?.id).toBe(r!.id);
	});

	// REGRESSION: components persist Svelte 5 `$state` arrays/objects, which are JS
	// Proxies. IndexedDB's structured clone throws `DataCloneError: … could not be
	// cloned` on a Proxy (Node's native structuredClone — used by fake-indexeddb — does
	// too), so the IOS/CBCT markups + hidden-mesh writes silently failed and nothing
	// persisted. The write path must normalise a Proxy to a plain, cloneable object.
	it('persists Proxy-wrapped (Svelte $state-like) arrays/objects without DataCloneError', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id, { modality: 'ios' }));

		// A bare identity Proxy reproduces the structured-clone rejection a $state proxy hits.
		const hiddenMeshes = new Proxy(['Tooth 1', 'Tooth 2'], {});
		const measures = new Proxy([new Proxy({ a: [0, 0, 0], b: [1, 1, 1] }, {})], {});

		await expect(
			db.upsertIosState(U, s.id, {
				measures: measures as never,
				hiddenMeshes: hiddenMeshes as never
			})
		).resolves.toBeDefined();
		const ios = await db.getIosState(U, s.id);
		expect(ios?.hiddenMeshes).toEqual(['Tooth 1', 'Tooth 2']);
		expect(ios?.measures).toEqual([{ a: [0, 0, 0], b: [1, 1, 1] }]);

		// CBCT markups carry nested Proxy arrays the same way.
		const markups = new Proxy(
			{ measurements: new Proxy([{ id: 'm1', mm: 12.3 }], {}), angles: [], annotations: [] },
			{}
		);
		await expect(
			db.upsertCbctReport(U, s.id, {
				markups: markups as never,
				hiddenMeshes: hiddenMeshes as never
			})
		).resolves.toBeDefined();
		const cbct = await db.getCbctReport(U, s.id);
		const cbctMarkups = cbct?.markups as { measurements?: unknown[] } | undefined;
		expect(cbctMarkups?.measurements).toEqual([{ id: 'm1', mm: 12.3 }]);
		expect(cbct?.hiddenMeshes).toEqual(['Tooth 1', 'Tooth 2']);
	});
});

describe('snapshot export/import', () => {
	it('exports a full per-user snapshot then re-imports it (replace semantics)', async () => {
		const p = await db.putPatient(patient({ name: 'Backup Me' }));
		const s = await db.putStudy(study(p.id, { findingCounts: { toothCount: 2 } }));
		await db.putInference({ studyId: s.id, user: U, inference: { report: 'r' } as never });
		await db.putFile({
			studyId: s.id,
			kind: 'image',
			user: U,
			blob: new Blob([new Uint8Array([9, 8, 7])]),
			filename: 'x.jpg',
			mime: 'image/jpeg'
		});
		await db.upsertCbctReport(U, s.id, { signedBy: 'Dr Z' });

		const snap = await db.exportUser(U);
		expect(snap.patients.length).toBe(1);
		expect(snap.studies.length).toBe(1);
		expect(snap.inferences.length).toBe(1);
		expect(snap.files.length).toBe(1);
		expect(snap.cbctReportState.length).toBe(1);
		expect(snap.dataVersion).toBeGreaterThan(0);

		// Mutate, then restore the snapshot → original state comes back, extra row gone.
		const extra = await db.putPatient(patient({ name: 'Added After Backup' }));
		await db.importUser(U, snap);
		expect(await db.getPatient(U, extra.id)).toBeUndefined();
		expect((await db.getPatient(U, p.id))?.name).toBe('Backup Me');
		const f = await db.getFile(s.id, 'image');
		expect(Array.from(new Uint8Array(await f!.blob.arrayBuffer()))).toEqual([9, 8, 7]);
		expect(await db.getDataVersion(U)).toBe(snap.dataVersion);
	});

	it('importUser re-stamps every row owner to the target user', async () => {
		// A snapshot whose rows claim a different owner must be coerced to `user` on import.
		const foreign = { ...patient({ user: 'someoneelse00x' }), id: genId() };
		await db.importUser(U, {
			patients: [foreign],
			studies: [],
			inferences: [],
			studyReportState: [],
			cbctReportState: [],
			iosState: [],
			files: [],
			dataVersion: 123
		});
		const list = await db.getPatients(U);
		expect(list.length).toBe(1);
		expect(list[0]!.user).toBe(U);
		expect(await db.getDataVersion(U)).toBe(123);
	});
});

describe('backup pointer', () => {
	it('persists and reads back the per-user backup pointer', async () => {
		expect(await db.getBackupPointer(U)).toBeNull();
		await db.setBackupPointer(U, { at: 1000, dataVersion: 42 });
		expect(await db.getBackupPointer(U)).toEqual({ at: 1000, dataVersion: 42 });
		expect(await db.getBackupPointer(U2)).toBeNull();
	});
});

describe('mergeUser (diff-then-merge apply)', () => {
	// Plans are built with the REAL planner — these tests prove the two layers compose.
	const lite = async (): Promise<LocalSnapshotLite> => ({
		patients: await db.getPatients(U),
		studies: await db.getStudies(U),
		studyReportState: [],
		cbctReportState: [],
		iosState: [],
		dataVersion: await db.getDataVersion(U)
	});
	const backupOf = (o: Partial<BackupManifestLite>): BackupManifestLite => ({
		patients: [],
		studies: [],
		inferences: [],
		files: [],
		studyReportState: [],
		cbctReportState: [],
		iosState: [],
		dataVersion: 50,
		...o
	});

	it('applies adds with PRESERVED stamps, bumps dataVersion past both sides, broadcasts replace', async () => {
		const local = await db.putPatient(patient({ name: 'Local' }));
		const dvBefore = await db.getDataVersion(U);
		const bq = patient({ id: genId(), name: 'From Backup', updated: '2026-01-01T00:00:00.000Z' });
		const bs = study(bq.id, { id: genId(), updated: '2026-01-01T00:00:00.000Z' });
		const plan = planMerge({
			local: await lite(),
			backup: backupOf({
				patients: [bq],
				studies: [bs],
				inferences: [{ studyId: bs.id }],
				files: [{ studyId: bs.id, kind: 'image', filename: 'x.jpg', mime: 'image/jpeg' }]
			}),
			tombstones: []
		});
		const sawReplace = new Promise<boolean>((res) => {
			const ch = new BroadcastChannel('dxv-local-changes');
			(ch as unknown as { unref?: () => void }).unref?.();
			ch.onmessage = (e) => {
				if (e.data === 'replace') {
					res(true);
					ch.close();
				}
			};
		});
		const r = await db.mergeUser(U, plan, {
			inferences: [
				{ studyId: bs.id, user: U, inference: { report: 'r' } as never, userEdits: null }
			],
			files: [
				{
					studyId: bs.id,
					kind: 'image',
					user: U,
					blob: new Blob([new Uint8Array([1])]),
					filename: 'x.jpg',
					mime: 'image/jpeg'
				}
			]
		});
		expect(r.applied).toBe(true);
		expect(r.orphansSkipped).toBe(0);
		// Raw bulkPut — the backup row's `updated` survives verbatim (no re-stamp).
		expect((await db.getPatient(U, bq.id))?.updated).toBe('2026-01-01T00:00:00.000Z');
		expect((await db.getPatient(U, local.id))?.name).toBe('Local'); // untouched
		expect(await db.getStudy(U, bs.id)).toBeTruthy();
		expect(await db.getInference(bs.id)).toBeTruthy();
		expect(await db.getFile(bs.id, 'image')).toBeTruthy();
		const dvAfter = await db.getDataVersion(U);
		expect(dvAfter).toBeGreaterThan(dvBefore);
		expect(dvAfter).toBeGreaterThan(plan.backupDataVersion);
		expect(await sawReplace).toBe(true);
	});

	it('an empty plan is a no-op: not applied, dataVersion untouched', async () => {
		const p = await db.putPatient(patient({ name: 'Same', updated: '' }));
		const dv = await db.getDataVersion(U);
		const plan = planMerge({
			local: await lite(),
			backup: backupOf({ patients: [(await db.getPatient(U, p.id)) as DbPatient] }),
			tombstones: []
		});
		const r = await db.mergeUser(U, plan, { inferences: [], files: [] });
		expect(r.applied).toBe(false);
		expect(await db.getDataVersion(U)).toBe(dv);
	});

	it('honors a mid-flight delete: an update whose local row vanished is SKIPPED, not resurrected', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		// Backup has a NEWER version of the same study → plan says update.
		const plan = planMerge({
			local: await lite(),
			backup: backupOf({
				patients: [{ ...p }],
				studies: [{ ...s, updated: '2999-01-01T00:00:00.000Z', fmxSlot: 'UL' }]
			}),
			tombstones: []
		});
		expect(plan.studies.update).toHaveLength(1);
		// The study is deleted AFTER planning (cross-tab race) — apply must honor it.
		await db.deleteStudy(U, s.id);
		const r = await db.mergeUser(U, plan, { inferences: [], files: [] });
		expect(r.applied).toBe(true);
		expect(r.orphansSkipped).toBe(1);
		expect(await db.getStudy(U, s.id)).toBeUndefined(); // stays deleted
	});

	it('skips a study whose parent vanished mid-flight, AND its unit children with it', async () => {
		const p = await db.putPatient(patient());
		const localLite = await lite();
		const bs = study(p.id, { id: genId(), updated: '2026-01-01T00:00:00.000Z' });
		const plan = planMerge({
			local: localLite,
			backup: backupOf({
				studies: [bs],
				inferences: [{ studyId: bs.id }],
				files: [{ studyId: bs.id, kind: 'image', filename: 'f', mime: 'm' }]
			}),
			tombstones: []
		});
		expect(plan.studies.add).toHaveLength(1);
		await db.deletePatient(U, p.id); // parent gone after planning
		const r = await db.mergeUser(U, plan, {
			inferences: [{ studyId: bs.id, user: U, inference: null, userEdits: null }],
			files: [
				{
					studyId: bs.id,
					kind: 'image',
					user: U,
					blob: new Blob([new Uint8Array([1])]),
					filename: 'f',
					mime: 'm'
				}
			]
		});
		expect(r.orphansSkipped).toBe(3); // study + inference + file
		expect(await db.getStudy(U, bs.id)).toBeUndefined();
		expect(await db.getInference(bs.id)).toBeUndefined();
		expect(await db.getFile(bs.id, 'image')).toBeUndefined();
	});

	it('mid-flight LWW: a local row re-stamped during the download window beats the planned update (whole unit kept)', async () => {
		// The backup lock serializes other backup ops, NOT ordinary writes — a rename or
		// re-segmentation can land between planning and apply. The applier must re-honor
		// `updated` (the plan's LWW verdict is stale) and suppress the unit's fetched blob.
		const p = await db.putPatient(patient({ name: 'Fresh Local' }));
		const s = await db.putStudy(study(p.id));
		// Plan against a STALE lite claiming ancient local stamps, with a backup that is
		// newer than the lite but OLDER than the real (just-written) rows.
		const plan = planMerge({
			local: {
				patients: [{ ...p, updated: '2000-01-01T00:00:00.000Z' }],
				studies: [{ ...s, updated: '2000-01-01T00:00:00.000Z' }],
				studyReportState: [],
				cbctReportState: [],
				iosState: [],
				dataVersion: await db.getDataVersion(U)
			},
			backup: backupOf({
				patients: [{ ...p, name: 'Stale Backup', updated: '2001-01-01T00:00:00.000Z' }],
				studies: [{ ...s, fmxSlot: 'UL', updated: '2001-01-01T00:00:00.000Z' }],
				files: [{ studyId: s.id, kind: 'segmentation', filename: 'seg.glb', mime: 'model/g' }]
			}),
			tombstones: []
		});
		expect(plan.patients.update).toHaveLength(1);
		expect(plan.studies.update).toHaveLength(1);
		const r = await db.mergeUser(U, plan, {
			inferences: [],
			files: [
				{
					studyId: s.id,
					kind: 'segmentation',
					user: U,
					blob: new Blob([new Uint8Array([1])]),
					filename: 'seg.glb',
					mime: 'model/g'
				}
			]
		});
		expect(r.applied).toBe(true);
		expect(r.orphansSkipped).toBe(3); // patient + study + the unit's fetched blob
		expect((await db.getPatient(U, p.id))?.name).toBe('Fresh Local'); // local kept
		expect((await db.getStudy(U, s.id))?.fmxSlot).toBeUndefined();
		expect(await db.getFile(s.id, 'segmentation')).toBeUndefined(); // blob suppressed too
	});

	it('mid-flight LWW: a state row saved during the window beats the planned state update', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		const localRow = await db.upsertStudyReport(U, s.id, { reportText: 'fresh local', status: '' });
		const plan = planMerge({
			local: {
				patients: [{ ...p }],
				studies: [{ ...s }],
				studyReportState: [{ ...localRow!, updated: '2000-01-01T00:00:00.000Z' }], // stale basis
				cbctReportState: [],
				iosState: [],
				dataVersion: await db.getDataVersion(U)
			},
			backup: backupOf({
				patients: [{ ...p }],
				studies: [{ ...s }],
				studyReportState: [
					{
						id: genId(),
						user: U,
						study: s.id,
						reportText: 'older backup',
						status: '',
						created: '2001-01-01T00:00:00.000Z',
						updated: '2001-01-01T00:00:00.000Z'
					}
				]
			}),
			tombstones: []
		});
		expect(plan.studyReportState.update).toHaveLength(1);
		await db.mergeUser(U, plan, { inferences: [], files: [] });
		expect((await db.getStudyReport(U, s.id))?.reportText).toBe('fresh local');
	});

	it('follow-state rides an APPLIED unit flip past the LWW re-check (matches the new segmentation)', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		const localState = await db.upsertCbctReport(U, s.id, { hiddenMeshes: ['Local_Mesh'] });
		const plan = planMerge({
			local: {
				patients: [{ ...p }],
				studies: [{ ...s }],
				studyReportState: [],
				cbctReportState: [localState!],
				iosState: [],
				dataVersion: await db.getDataVersion(U)
			},
			backup: backupOf({
				patients: [{ ...p }],
				studies: [{ ...s, updated: '2999-01-01T00:00:00.000Z' }], // genuinely newer → flips
				cbctReportState: [
					{
						id: genId(),
						user: U,
						study: s.id,
						hiddenMeshes: ['Backup_Mesh'],
						created: '2000-01-01T00:00:00.000Z',
						updated: '2000-01-01T00:00:00.000Z' // OLDER than local — follow overrides LWW
					}
				]
			}),
			tombstones: []
		});
		expect(plan.flippedStudies).toEqual([s.id]);
		expect(plan.cbctReportState.update).toHaveLength(1);
		await db.mergeUser(U, plan, { inferences: [], files: [] });
		const after = await db.getCbctReport(U, s.id);
		expect(after?.hiddenMeshes).toEqual(['Backup_Mesh']); // followed its unit
		expect(after?.id).toBe(localState!.id); // still under the local id
	});

	it('follow-state ADD adopts a mid-flight-created local row id (no unique-index abort)', async () => {
		// Study S flips; the backup carries a cbct state row that planState classifies as
		// an ADD (no local row at plan time) — keeping the BACKUP id. During the download
		// window the clinician opens the viewer and a debounced save creates a LOCAL row
		// with a fresh id under the same [user+study]. The apply must reconcile identity
		// (adopt the local id) instead of throwing ConstraintError and aborting the merge.
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		const plan = planMerge({
			local: {
				patients: [{ ...p }],
				studies: [{ ...s }],
				studyReportState: [],
				cbctReportState: [], // no local state row at plan time → backup row is an ADD
				iosState: [],
				dataVersion: await db.getDataVersion(U)
			},
			backup: backupOf({
				patients: [{ ...p }],
				studies: [{ ...s, updated: '2999-01-01T00:00:00.000Z' }], // flips
				cbctReportState: [
					{
						id: genId(), // the backup's own id
						user: U,
						study: s.id,
						hiddenMeshes: ['Backup_Mesh'],
						created: '2000-01-01T00:00:00.000Z',
						updated: '2000-01-01T00:00:00.000Z'
					}
				]
			}),
			tombstones: []
		});
		expect(plan.flippedStudies).toEqual([s.id]);
		expect(plan.cbctReportState.add).toHaveLength(1);
		// Mid-flight viewer save — a fresh-id local row now owns [user+study].
		const midFlight = await db.upsertCbctReport(U, s.id, { hiddenMeshes: ['Local_Mesh'] });
		const r = await db.mergeUser(U, plan, { inferences: [], files: [] });
		expect(r.applied).toBe(true); // no ConstraintError abort
		const after = await db.getCbctReport(U, s.id);
		expect(after?.id).toBe(midFlight!.id); // identity reconciled onto the local id
		expect(after?.hiddenMeshes).toEqual(['Backup_Mesh']); // follow content still wins
	});

	it('state-row update overwrites IN PLACE under the local id (unique [user+study] survives)', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		const localRow = await db.upsertStudyReport(U, s.id, { reportText: 'old', status: '' });
		const plan = planMerge({
			local: { ...(await lite()), studyReportState: [localRow!] },
			backup: backupOf({
				patients: [{ ...p }],
				studies: [{ ...s }],
				studyReportState: [
					{
						id: genId(), // a DIFFERENT id, as a second device would have
						user: U,
						study: s.id,
						reportText: 'newer from backup',
						status: 'final',
						created: '2026-01-01T00:00:00.000Z',
						updated: '2999-01-01T00:00:00.000Z'
					}
				]
			}),
			tombstones: []
		});
		expect(plan.studyReportState.update).toHaveLength(1);
		await db.mergeUser(U, plan, { inferences: [], files: [] });
		const after = await db.getStudyReport(U, s.id);
		expect(after?.id).toBe(localRow!.id); // local id kept
		expect(after?.reportText).toBe('newer from backup');
	});
});

describe('delete tombstones (diff-then-merge support)', () => {
	it('deleteStudy writes a studies tombstone', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		await db.deleteStudy(U, s.id);
		const ts = await db.getTombstones(U);
		expect(ts).toHaveLength(1);
		expect(ts[0]).toMatchObject({ table: 'studies', id: s.id, user: U });
		expect(ts[0]!.deletedAt).toBeTruthy();
	});

	it('deletePatient tombstones the patient AND every cascaded study', async () => {
		const p = await db.putPatient(patient());
		const s1 = await db.putStudy(study(p.id));
		const s2 = await db.putStudy(study(p.id));
		await db.deletePatient(U, p.id);
		const ts = await db.getTombstones(U);
		expect(ts.map((t) => `${t.table}:${t.id}`).sort()).toEqual(
			[`patients:${p.id}`, `studies:${s1.id}`, `studies:${s2.id}`].sort()
		);
	});

	it('reassignStudy (a move, not a delete) writes NO tombstone', async () => {
		const a = await db.putPatient(patient());
		const b = await db.putPatient(patient({ name: 'Target' }));
		const s = await db.putStudy(study(a.id));
		await db.reassignStudy(U, s.id, b.id);
		expect(await db.getTombstones(U)).toEqual([]);
	});

	it('wipeUser clears the user tombstones (a deliberate wipe is a fresh start)', async () => {
		const p = await db.putPatient(patient());
		await db.deletePatient(U, p.id);
		expect(await db.getTombstones(U)).toHaveLength(1);
		await db.wipeUser(U);
		expect(await db.getTombstones(U)).toEqual([]);
	});

	it('importUser merges snapshot tombstones additively, never rolling back a newer local one', async () => {
		const sid = genId();
		// Local: a fresh deletion of `sid`.
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id, { id: sid }));
		await db.deleteStudy(U, s.id);
		const localTs = (await db.getTombstones(U))[0]!;
		const foreignId = genId();
		await db.importUser(U, {
			patients: [],
			studies: [],
			inferences: [],
			studyReportState: [],
			cbctReportState: [],
			iosState: [],
			files: [],
			tombstones: [
				// OLDER tombstone for the same study — must NOT roll back the local one.
				{
					table: 'studies',
					id: sid,
					user: 'someoneelse00x',
					deletedAt: '2000-01-01T00:00:00.000Z'
				},
				// New knowledge from the snapshot — imported, owner coerced.
				{
					table: 'patients',
					id: foreignId,
					user: 'someoneelse00x',
					deletedAt: '2024-01-01T00:00:00.000Z'
				}
			],
			dataVersion: 5
		});
		const ts = await db.getTombstones(U);
		expect(ts).toHaveLength(2);
		const bySid = ts.find((t) => t.id === sid)!;
		expect(bySid.deletedAt).toBe(localTs.deletedAt); // newer local kept
		const imported = ts.find((t) => t.id === foreignId)!;
		expect(imported.user).toBe(U);
		expect(imported.deletedAt).toBe('2024-01-01T00:00:00.000Z');
	});

	it('a v1 database upgrades in place to v2 (rows intact, deletions usable)', async () => {
		const name = 'test-upgrade-' + genId();
		// Build a database exactly as version 1 declared it (no deletions store).
		const v1 = new Dexie(name);
		v1.version(1).stores({
			patients: 'id, user',
			studies: 'id, user, patient, [user+patient]',
			inferences: 'studyId, user',
			files: '[studyId+kind], studyId, user',
			studyReportState: 'id, &[user+study], study, user',
			cbctReportState: 'id, &[user+study], study, user',
			iosState: 'id, &[user+study], study, user',
			meta: 'key'
		});
		const pid = genId();
		await v1
			.table('patients')
			.put({ id: pid, user: U, name: 'Pre-upgrade', created: '', updated: '' });
		v1.close();

		const upgraded = new LocalDb(name);
		try {
			expect((await upgraded.getPatient(U, pid))?.name).toBe('Pre-upgrade');
			expect(await upgraded.getTombstones(U)).toEqual([]); // new store queryable
			await upgraded.deletePatient(U, pid); // and writable
			expect((await upgraded.getTombstones(U)).map((t) => t.id)).toEqual([pid]);
		} finally {
			await upgraded.destroy();
		}
	});
});

describe('createStudy (atomic study + inference + file)', () => {
	it('creates all three rows in one call', async () => {
		const p = await db.putPatient(patient());
		const s = study(p.id);
		await db.createStudy(s, {
			inference: { studyId: s.id, user: U, inference: { report: 'r' } as never, userEdits: null },
			file: {
				studyId: s.id,
				kind: 'image',
				user: U,
				blob: new Blob([new Uint8Array([1, 2])]),
				filename: 'a.jpg',
				mime: 'image/jpeg'
			}
		});
		expect(await db.getStudy(U, s.id)).toBeTruthy();
		expect(await db.getInference(s.id)).toBeTruthy();
		expect(await db.getFile(s.id, 'image')).toBeTruthy();
	});

	it('a failed FILE write aborts the whole create — no image-less orphan study survives', async () => {
		const p = await db.putPatient(patient());
		const s = study(p.id);
		// A Proxy-wrapped Blob is NOT structured-cloneable → the files put throws inside
		// the transaction (the same failure shape as a quota error mid-create).
		const poisoned = new Proxy(new Blob([new Uint8Array([1])]), {});
		await expect(
			db.createStudy(s, {
				file: {
					studyId: s.id,
					kind: 'image',
					user: U,
					blob: poisoned as Blob,
					filename: 'a.jpg',
					mime: 'image/jpeg'
				}
			})
		).rejects.toThrow();
		// Transaction aborted → the study row must NOT exist.
		expect(await db.getStudy(U, s.id)).toBeUndefined();
		expect(await db.getInference(s.id)).toBeUndefined();
	});
});

describe('orphan-write guards (no FK in IndexedDB)', () => {
	// A write landing AFTER its study was deleted (another tab, a flushed debounced
	// save) must not resurrect the study as an orphan row — orphans break the next
	// online backup (PB validates relations on create).
	it('putInference for a missing study is dropped', async () => {
		const ghost = genId();
		await db.putInference({ studyId: ghost, user: U, inference: { report: 'x' } as never });
		expect(await db.getInference(ghost)).toBeUndefined();
	});

	it('putFile for a missing study is dropped (a re-segmentation save after a cross-tab delete)', async () => {
		const ghost = genId();
		await db.putFile({
			studyId: ghost,
			kind: 'segmentation',
			user: U,
			blob: new Blob(['x']),
			filename: 'seg.glb',
			mime: 'model/gltf-binary'
		});
		expect(await db.getFile(ghost, 'segmentation')).toBeUndefined();
	});

	it('state upserts for a missing study return null and write nothing', async () => {
		const ghost = genId();
		expect(await db.upsertStudyReport(U, ghost, { reportText: 'x', status: '' })).toBeNull();
		expect(await db.upsertCbctReport(U, ghost, { signedBy: 'Dr A' })).toBeNull();
		expect(await db.upsertIosState(U, ghost, { hiddenMeshes: ['m'] })).toBeNull();
		expect(await db.getStudyReport(U, ghost)).toBeUndefined();
		expect(await db.getCbctReport(U, ghost)).toBeUndefined();
		expect(await db.getIosState(U, ghost)).toBeUndefined();
	});

	it("a write against ANOTHER user's study is dropped too", async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		expect(await db.upsertIosState(U2, s.id, { hiddenMeshes: ['m'] })).toBeNull();
		expect(await db.getIosState(U2, s.id)).toBeUndefined();
	});

	it('createStudy THROWS when the patient vanished (cross-tab delete during an upload)', async () => {
		const ghostPatient = genId();
		const s = study(ghostPatient);
		await expect(db.createStudy(s)).rejects.toThrow(/patient no longer exists/);
		expect(await db.getStudy(U, s.id)).toBeUndefined(); // nothing written
	});

	it('reassignStudy THROWS when the TARGET patient vanished (cross-tab delete mid-merge)', async () => {
		const p = await db.putPatient(patient());
		const s = await db.putStudy(study(p.id));
		await expect(db.reassignStudy(U, s.id, genId())).rejects.toThrow(
			/target patient no longer exists/
		);
		// The study stays on its original patient.
		expect((await db.getStudy(U, s.id))?.patient).toBe(p.id);
	});
});
