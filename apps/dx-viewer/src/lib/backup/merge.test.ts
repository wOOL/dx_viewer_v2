import { describe, it, expect } from 'vitest';
import {
	planMerge,
	stampMs,
	stripUpdates,
	isPlanEmpty,
	type LocalSnapshotLite,
	type BackupManifestLite,
	type Tombstone,
	type BackupFileRef
} from './merge';
import type {
	DbPatient,
	DbStudy,
	DbStudyReportState,
	DbCbctReportState,
	DbIosState
} from '$lib/db/schema';

const U = 'u1';
// Three strictly ordered instants.
const T1 = '2026-06-01T10:00:00.000Z';
const T2 = '2026-06-02T10:00:00.000Z';
const T3 = '2026-06-03T10:00:00.000Z';

const pat = (id: string, o: Partial<DbPatient> = {}): DbPatient => ({
	id,
	user: U,
	name: `Pat ${id}`,
	dob: null,
	created: T1,
	updated: T1,
	...o
});
const stu = (id: string, patient: string, o: Partial<DbStudy> = {}): DbStudy => ({
	id,
	user: U,
	patient,
	modality: 'xray',
	created: T1,
	updated: T1,
	...o
});
const rep = (
	id: string,
	study: string,
	o: Partial<DbStudyReportState> = {}
): DbStudyReportState => ({
	id,
	user: U,
	study,
	reportText: 'r',
	status: '',
	created: T1,
	updated: T1,
	...o
});
const cbct = (
	id: string,
	study: string,
	o: Partial<DbCbctReportState> = {}
): DbCbctReportState => ({
	id,
	user: U,
	study,
	hiddenMeshes: [],
	created: T1,
	updated: T1,
	...o
});
const ios = (id: string, study: string, o: Partial<DbIosState> = {}): DbIosState => ({
	id,
	user: U,
	study,
	hiddenMeshes: [],
	created: T1,
	updated: T1,
	...o
});
const fileRef = (studyId: string, kind: 'image' | 'segmentation' = 'image'): BackupFileRef => ({
	studyId,
	kind,
	filename: `${studyId}.${kind}`,
	mime: 'application/octet-stream'
});

const emptyLocal = (o: Partial<LocalSnapshotLite> = {}): LocalSnapshotLite => ({
	patients: [],
	studies: [],
	studyReportState: [],
	cbctReportState: [],
	iosState: [],
	dataVersion: 0,
	...o
});
const emptyBackup = (o: Partial<BackupManifestLite> = {}): BackupManifestLite => ({
	patients: [],
	studies: [],
	inferences: [],
	files: [],
	studyReportState: [],
	cbctReportState: [],
	iosState: [],
	dataVersion: 0,
	...o
});
const ts = (table: Tombstone['table'], id: string, deletedAt: string): Tombstone => ({
	table,
	id,
	user: U,
	deletedAt
});

describe('stampMs (mixed-format stamp comparator)', () => {
	it('parses ISO-T stamps', () => {
		expect(stampMs(T2)).toBeGreaterThan(stampMs(T1));
	});

	it('parses PocketBase space-separated stamps as the SAME instant as ISO-T', () => {
		// Rows that arrived via an online restore preserve PB's 'YYYY-MM-DD HH:MM:SS.mmmZ'.
		// A lexicographic compare would make the PB form lose on equal dates (' ' < 'T').
		expect(stampMs('2026-06-02 10:00:00.000Z')).toBe(stampMs(T2));
		expect(stampMs('2026-06-02 11:00:00.000Z')).toBeGreaterThan(stampMs(T2));
	});

	it('treats missing/garbage stamps as 0 (oldest)', () => {
		expect(stampMs(undefined)).toBe(0);
		expect(stampMs(null)).toBe(0);
		expect(stampMs('')).toBe(0);
		expect(stampMs('not a date')).toBe(0);
	});
});

describe('planMerge — patients (per-row LWW)', () => {
	it('adds a backup-only patient', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('pl')] }),
			backup: emptyBackup({ patients: [pat('pb')] }),
			tombstones: []
		});
		expect(plan.patients.add.map((p) => p.id)).toEqual(['pb']);
		expect(plan.patients.update).toEqual([]);
		expect(plan.counts.patientsAdded).toBe(1);
	});

	it('suppresses a backup-only patient whose tombstone is at least as recent', () => {
		const plan = planMerge({
			local: emptyLocal(),
			backup: emptyBackup({ patients: [pat('pb', { updated: T1 })] }),
			tombstones: [ts('patients', 'pb', T2)]
		});
		expect(plan.patients.add).toEqual([]);
		expect(plan.suppressed).toEqual([{ table: 'patients', id: 'pb' }]);
		expect(plan.counts.suppressed).toBe(1);
	});

	it('resurrects when the backup row was touched AFTER the local delete (older tombstone loses)', () => {
		const plan = planMerge({
			local: emptyLocal(),
			backup: emptyBackup({ patients: [pat('pb', { updated: T3 })] }),
			tombstones: [ts('patients', 'pb', T2)]
		});
		expect(plan.patients.add.map((p) => p.id)).toEqual(['pb']);
		expect(plan.suppressed).toEqual([]);
	});

	it('LWW: backup-newer patient becomes an update; local-newer and equal stay unchanged', () => {
		const plan = planMerge({
			local: emptyLocal({
				patients: [
					pat('a', { updated: T1 }), // backup newer → update
					pat('b', { updated: T3 }), // local newer → keep
					pat('c', { updated: T2 }) // equal → keep (idempotent)
				]
			}),
			backup: emptyBackup({
				patients: [
					pat('a', { updated: T2, name: 'Renamed' }),
					pat('b', { updated: T1 }),
					pat('c', { updated: T2 })
				]
			}),
			tombstones: []
		});
		expect(plan.patients.update.map((p) => p.id)).toEqual(['a']);
		expect(plan.patients.add).toEqual([]);
		expect(plan.counts.patientsUpdated).toBe(1);
		expect(plan.counts.unchanged).toBe(2);
	});

	it('flags a possible duplicate (same name+dob after diacritic folding, different ids) — adds only', () => {
		const plan = planMerge({
			local: emptyLocal({
				patients: [pat('pl', { name: 'André Müller', dob: '1980-01-02' })]
			}),
			backup: emptyBackup({
				patients: [
					pat('pb', { name: 'andre muller', dob: '1980-01-02' }),
					// Same id both sides → NOT a duplicate (it is the same record).
					pat('pl', { name: 'André Müller', dob: '1980-01-02' })
				]
			}),
			tombstones: []
		});
		expect(plan.possibleDuplicates).toEqual([
			{ localId: 'pl', backupId: 'pb', name: 'André Müller', dob: '1980-01-02' }
		]);
		expect(plan.counts.possibleDuplicates).toBe(1);
	});
});

describe('planMerge — studies (study-unit atomic)', () => {
	it('adds a backup-only study under an existing local patient, with its unit (inference + files)', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')] }),
			backup: emptyBackup({
				studies: [stu('s', 'p')],
				inferences: [{ studyId: 's' }],
				files: [fileRef('s', 'image'), fileRef('s', 'segmentation')]
			}),
			tombstones: []
		});
		expect(plan.studies.add.map((s) => s.id)).toEqual(['s']);
		expect(plan.inferences.add).toEqual([{ studyId: 's' }]);
		expect(plan.filesToFetch.add.map((f) => f.kind).sort()).toEqual(['image', 'segmentation']);
		expect(plan.counts.filesToFetch).toBe(2);
	});

	it('adds a backup-only study under a patient the SAME plan adds', () => {
		const plan = planMerge({
			local: emptyLocal(),
			backup: emptyBackup({ patients: [pat('p')], studies: [stu('s', 'p')] }),
			tombstones: []
		});
		expect(plan.patients.add.map((p) => p.id)).toEqual(['p']);
		expect(plan.studies.add.map((s) => s.id)).toEqual(['s']);
	});

	it('cascade: a tombstone-suppressed patient suppresses its backup studies (delete-wins, even newer ones)', () => {
		const plan = planMerge({
			local: emptyLocal(),
			backup: emptyBackup({
				patients: [pat('p', { updated: T1 })],
				studies: [stu('s', 'p', { updated: T3 })], // newer than the tombstone — still suppressed
				files: [fileRef('s')]
			}),
			tombstones: [ts('patients', 'p', T2)]
		});
		expect(plan.patients.add).toEqual([]);
		expect(plan.studies.add).toEqual([]);
		expect(plan.filesToFetch.add).toEqual([]);
		// Only the direct veto is listed; cascaded children are silently dropped.
		expect(plan.suppressed).toEqual([{ table: 'patients', id: 'p' }]);
	});

	it('suppresses a backup-only study with its OWN at-least-as-recent tombstone', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')] }),
			backup: emptyBackup({ studies: [stu('s', 'p', { updated: T1 })], files: [fileRef('s')] }),
			tombstones: [ts('studies', 's', T2)]
		});
		expect(plan.studies.add).toEqual([]);
		expect(plan.filesToFetch.add).toEqual([]);
		expect(plan.suppressed).toEqual([{ table: 'studies', id: 's' }]);
	});

	it('drops a backup study whose patient survives on NEITHER side (backup-internal orphan)', () => {
		const plan = planMerge({
			local: emptyLocal(),
			backup: emptyBackup({ studies: [stu('s', 'missing')] }),
			tombstones: []
		});
		expect(plan.studies.add).toEqual([]);
		expect(plan.orphansDropped).toBe(1);
	});

	it('unit flip: backup-newer study replaces the whole unit (row + inference + files)', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')], studies: [stu('s', 'p', { updated: T1 })] }),
			backup: emptyBackup({
				studies: [stu('s', 'p', { updated: T2, fmxSlot: 'UL' })],
				inferences: [{ studyId: 's' }],
				files: [fileRef('s', 'image'), fileRef('s', 'segmentation')]
			}),
			tombstones: []
		});
		expect(plan.studies.update.map((s) => s.fmxSlot)).toEqual(['UL']);
		expect(plan.inferences.update).toEqual([{ studyId: 's' }]);
		expect(plan.filesToFetch.update).toHaveLength(2);
	});

	it('local-newer (or equal) study keeps the WHOLE unit local — no inference/file fetches', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')], studies: [stu('s', 'p', { updated: T3 })] }),
			backup: emptyBackup({
				studies: [stu('s', 'p', { updated: T2 })],
				inferences: [{ studyId: 's' }],
				files: [fileRef('s', 'segmentation')]
			}),
			tombstones: []
		});
		expect(plan.studies.update).toEqual([]);
		expect(plan.inferences.update).toEqual([]);
		expect(plan.filesToFetch.update).toEqual([]);
		expect(plan.counts.unchanged).toBe(1);
	});

	it('only fetches the file kinds the BACKUP has (a local-only kind survives — never-delete)', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')], studies: [stu('s', 'p', { updated: T1 })] }),
			backup: emptyBackup({
				studies: [stu('s', 'p', { updated: T2 })],
				files: [fileRef('s', 'image')] // backup has no segmentation
			}),
			tombstones: []
		});
		expect(plan.filesToFetch.update.map((f) => f.kind)).toEqual(['image']);
	});

	it('keeps the local study when the backup reassigned it onto a NON-surviving patient', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')], studies: [stu('s', 'p', { updated: T1 })] }),
			backup: emptyBackup({
				patients: [pat('q', { updated: T1 })],
				studies: [stu('s', 'q', { updated: T3 })] // newer, but q is tombstoned here
			}),
			tombstones: [ts('patients', 'q', T2)]
		});
		expect(plan.studies.update).toEqual([]);
		expect(plan.orphansDropped).toBe(1);
	});
});

describe('planMerge — per-study state rows ([user+study] identity)', () => {
	it('adds a backup-only state row for a surviving study', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')], studies: [stu('s', 'p')] }),
			backup: emptyBackup({ studyReportState: [rep('r1', 's')] }),
			tombstones: []
		});
		expect(plan.studyReportState.add.map((r) => r.id)).toEqual(['r1']);
		expect(plan.counts.stateAdded).toBe(1);
	});

	it('LWW update is RE-KEYED onto the local row id (devices genId() different ids)', () => {
		const plan = planMerge({
			local: emptyLocal({
				patients: [pat('p')],
				studies: [stu('s', 'p')],
				studyReportState: [rep('local-id', 's', { updated: T1 })]
			}),
			backup: emptyBackup({
				studyReportState: [rep('backup-id', 's', { updated: T2, reportText: 'newer' })]
			}),
			tombstones: []
		});
		expect(plan.studyReportState.update).toHaveLength(1);
		expect(plan.studyReportState.update[0].id).toBe('local-id');
		expect(plan.studyReportState.update[0].reportText).toBe('newer');
	});

	it('local-newer state row stays (LWW, unit not flipped)', () => {
		const plan = planMerge({
			local: emptyLocal({
				patients: [pat('p')],
				studies: [stu('s', 'p')],
				cbctReportState: [cbct('c1', 's', { updated: T3 })]
			}),
			backup: emptyBackup({ cbctReportState: [cbct('c2', 's', { updated: T2 })] }),
			tombstones: []
		});
		expect(plan.cbctReportState.update).toEqual([]);
		expect(plan.counts.unchanged).toBe(1);
	});

	it('cbct/ios state FOLLOWS a flipped unit even when the local state row is newer', () => {
		// The markups/hiddenMeshes reference mesh names from the segmentation blob — when
		// the unit flips to the backup side, pairing it with local state would Frankenstein.
		const plan = planMerge({
			local: emptyLocal({
				patients: [pat('p')],
				studies: [stu('s', 'p', { updated: T1 })],
				cbctReportState: [cbct('cl', 's', { updated: T3, hiddenMeshes: ['Local_Mesh'] })],
				iosState: [ios('il', 's', { updated: T3 })]
			}),
			backup: emptyBackup({
				studies: [stu('s', 'p', { updated: T2 })],
				cbctReportState: [cbct('cb', 's', { updated: T1, hiddenMeshes: ['Backup_Mesh'] })],
				iosState: [ios('ib', 's', { updated: T1 })]
			}),
			tombstones: []
		});
		expect(plan.studies.update).toHaveLength(1); // unit flipped
		expect(plan.cbctReportState.update).toHaveLength(1);
		expect(plan.cbctReportState.update[0].id).toBe('cl'); // local id kept
		expect(plan.cbctReportState.update[0].hiddenMeshes).toEqual(['Backup_Mesh']);
		expect(plan.iosState.update).toHaveLength(1);
	});

	it('the 2D report does NOT follow a flip (seg-independent → pure LWW)', () => {
		const plan = planMerge({
			local: emptyLocal({
				patients: [pat('p')],
				studies: [stu('s', 'p', { updated: T1 })],
				studyReportState: [rep('rl', 's', { updated: T3, reportText: 'local newer' })]
			}),
			backup: emptyBackup({
				studies: [stu('s', 'p', { updated: T2 })],
				studyReportState: [rep('rb', 's', { updated: T1 })]
			}),
			tombstones: []
		});
		expect(plan.studies.update).toHaveLength(1); // unit flipped…
		expect(plan.studyReportState.update).toEqual([]); // …but the newer local report stays
	});

	it('never resurrects state under a suppressed study; drops backup-orphan state rows', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')] }),
			backup: emptyBackup({
				studies: [stu('s', 'p', { updated: T1 })],
				studyReportState: [rep('r1', 's'), rep('r2', 'nosuchstudy')]
			}),
			tombstones: [ts('studies', 's', T2)]
		});
		expect(plan.studyReportState.add).toEqual([]); // r1 cascade-suppressed
		expect(plan.orphansDropped).toBe(1); // r2 has no parent on either side
	});
});

describe('planMerge — degrade, idempotency, stripUpdates', () => {
	it('empty tombstones degrades to pure additive (deleted rows resurrect)', () => {
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')] }),
			backup: emptyBackup({ studies: [stu('s', 'p')] }),
			tombstones: [] // the study was deleted locally, but without tombstones we cannot know
		});
		expect(plan.studies.add.map((s) => s.id)).toEqual(['s']);
	});

	it('merging an identical snapshot is an empty plan (re-merge is a no-op)', () => {
		const local = emptyLocal({
			patients: [pat('p', { updated: T2 })],
			studies: [stu('s', 'p', { updated: T2 })],
			studyReportState: [rep('r', 's', { updated: T2 })]
		});
		const backup = emptyBackup({
			patients: [pat('p', { updated: T2 })],
			studies: [stu('s', 'p', { updated: T2 })],
			inferences: [{ studyId: 's' }],
			files: [fileRef('s')],
			studyReportState: [rep('r', 's', { updated: T2 })]
		});
		const plan = planMerge({ local, backup, tombstones: [] });
		expect(isPlanEmpty(plan)).toBe(true);
		expect(plan.counts.unchanged).toBe(3);
	});

	it('stripUpdates drops every update (and its unit fetches) but keeps all adds', () => {
		const plan = planMerge({
			local: emptyLocal({
				patients: [pat('p'), pat('q', { updated: T1 })],
				studies: [stu('s', 'p', { updated: T1 })]
			}),
			backup: emptyBackup({
				patients: [pat('q', { updated: T2 }), pat('new')],
				studies: [stu('s', 'p', { updated: T2 }), stu('s2', 'p')],
				inferences: [{ studyId: 's' }, { studyId: 's2' }],
				files: [fileRef('s'), fileRef('s2')]
			}),
			tombstones: []
		});
		expect(plan.counts.patientsUpdated).toBe(1);
		expect(plan.counts.studiesUpdated).toBe(1);
		const adds = stripUpdates(plan);
		expect(adds.patients.update).toEqual([]);
		expect(adds.studies.update).toEqual([]);
		expect(adds.inferences.update).toEqual([]);
		expect(adds.filesToFetch.update).toEqual([]);
		expect(adds.patients.add.map((p) => p.id)).toEqual(['new']);
		expect(adds.studies.add.map((s) => s.id)).toEqual(['s2']);
		expect(adds.counts.patientsUpdated).toBe(0);
		expect(adds.counts.studiesUpdated).toBe(0);
		expect(adds.counts.filesToFetch).toBe(1); // only s2's file remains
		expect(isPlanEmpty(adds)).toBe(false);
	});

	it('stripUpdates drops a cbct/ios state ADD riding a STRIPPED unit flip (no Frankenstein)', () => {
		// Local has the study but NO local cbct/ios state row → the backup's state row is an
		// ADD. Its hiddenMeshes reference the BACKUP segmentation's mesh names; with the unit
		// flip stripped, the LOCAL segmentation stays — applying the add anyway would pair
		// state with the wrong seg. The seg-independent 2D report add must survive the strip.
		const plan = planMerge({
			local: emptyLocal({ patients: [pat('p')], studies: [stu('s', 'p', { updated: T1 })] }),
			backup: emptyBackup({
				studies: [stu('s', 'p', { updated: T2 })],
				files: [fileRef('s', 'segmentation')],
				cbctReportState: [cbct('cb', 's', { updated: T1, hiddenMeshes: ['Backup_Mesh'] })],
				iosState: [ios('ib', 's', { updated: T1 })],
				studyReportState: [rep('rb', 's', { updated: T1 })]
			}),
			tombstones: []
		});
		expect(plan.flippedStudies).toEqual(['s']);
		expect(plan.cbctReportState.add).toHaveLength(1); // full plan: flip applies → consistent
		const adds = stripUpdates(plan);
		expect(adds.studies.update).toEqual([]);
		expect(adds.cbctReportState.add).toEqual([]); // dropped with its stripped unit
		expect(adds.iosState.add).toEqual([]);
		expect(adds.studyReportState.add).toHaveLength(1); // 2D report is seg-independent
		expect(adds.flippedStudies).toEqual([]);
		expect(adds.counts.stateAdded).toBe(1);
	});

	it('isPlanEmpty is false when anything is planned', () => {
		const plan = planMerge({
			local: emptyLocal(),
			backup: emptyBackup({ patients: [pat('p')] }),
			tombstones: []
		});
		expect(isPlanEmpty(plan)).toBe(false);
	});
});
