// The diff-then-merge plan layer — the non-destructive sibling of the replace gate
// (gate.ts). Where `canRestore` decides whether a FULL REPLACE may run, `planMerge`
// computes WHAT a merge would do: which backup rows are added, which both-sides rows the
// backup wins (LWW), which deleted-here rows a tombstone suppresses, and exactly which
// binary blobs the apply step must obtain. Pure (no Dexie, no blobs, no clock) so the
// destructive-decision surface stays exhaustively unit-testable, like the gate.
//
// Invariants the plan encodes (agreed design, see the session plan):
//  - Merge NEVER deletes local data. Backup-only rows are added (unless tombstoned);
//    local-only rows are always kept; "backup wins" only ever OVERWRITES content the
//    preview disclosed as an update.
//  - STUDY-UNIT atomicity: {study row + inference + image/seg blobs} move as one unit,
//    decided by `study.updated` — never a backup inference on a local study or vice
//    versa (inference/file rows carry no own stamps BY DESIGN; they follow the study).
//    Exception, additive at the file-kind level: a kind the backup LACKS is kept locally
//    (never-delete beats unit purity; in practice a study's file set only grows).
//  - cbct/ios state FOLLOWS a flipped unit (markups/hiddenMeshes reference mesh names
//    derived from the segmentation blob — independent LWW would pair one side's markups
//    with the other side's meshes). The 2D report text is seg-independent → always LWW.
//  - Tombstone veto: a local deletion suppresses a backup add when the delete is at
//    least as recent as the backup row (`deletedAt >= row.updated`); an OLDER tombstone
//    loses — the row was genuinely touched remotely after our delete, so it returns.
//    Suppression CASCADES (patient → its backup studies → their state/inference/files).
//  - Same human, two ids (created independently on two devices) is NOT auto-merged:
//    name+dob matches are surfaced as possibleDuplicates for the preview only.

import { foldDiacritics } from '$lib/patients';
import type {
	DbDeletion,
	DbPatient,
	DbStudy,
	DbStudyReportState,
	DbCbctReportState,
	DbIosState,
	FileKind
} from '$lib/db/schema';

/** Tables whose rows users delete as units — the only ones that get tombstones. */
export type TombstoneTable = DbDeletion['table'];

/** The Dexie `deletions` row, under its merge-side name. */
export type Tombstone = DbDeletion;

/** Blob-free projection of the LIVE local data. Inference/file rows are not needed:
 *  they follow their study's decision, and local-only kinds always survive. */
export interface LocalSnapshotLite {
	patients: DbPatient[];
	studies: DbStudy[];
	studyReportState: DbStudyReportState[];
	cbctReportState: DbCbctReportState[];
	iosState: DbIosState[];
	dataVersion: number;
}

/** One backup binary, by reference (zip entry name / PB file field) — no bytes. */
export interface BackupFileRef {
	studyId: string;
	kind: FileKind;
	filename: string;
	mime: string;
	/** Present on exports written after the merge feature shipped (additive manifest
	 *  field) — lets the apply step pre-flight storage. Absent on older zips + online. */
	size?: number;
}

/** Blob-free view of the backup. `inferences` is PRESENCE only — the payloads are
 *  assembled by the zip/online caller at apply time, for plan-selected studies only. */
export interface BackupManifestLite {
	patients: DbPatient[];
	studies: DbStudy[];
	inferences: { studyId: string }[];
	files: BackupFileRef[];
	studyReportState: DbStudyReportState[];
	cbctReportState: DbCbctReportState[];
	iosState: DbIosState[];
	dataVersion: number;
}

/** `add` = id (or [user+study] identity) only in the backup; `update` = both sides,
 *  backup won. The preview's "also update" toggle drops every `update` at apply time
 *  (see stripUpdates) — adds alone are always safe. */
export interface TableChanges<T> {
	add: T[];
	update: T[];
}

export interface MergePlan {
	patients: TableChanges<DbPatient>;
	studies: TableChanges<DbStudy>;
	/** Parent-study ids whose backup inference must be fetched + written. */
	inferences: TableChanges<{ studyId: string }>;
	studyReportState: TableChanges<DbStudyReportState>;
	cbctReportState: TableChanges<DbCbctReportState>;
	iosState: TableChanges<DbIosState>;
	/** Blobs the apply step must obtain (and only these — the selective-download win). */
	filesToFetch: TableChanges<BackupFileRef>;
	/** Tombstone-vetoed units — "N deleted items were not re-added" in the preview. */
	suppressed: { table: TombstoneTable; id: string }[];
	/** Same name+dob, different ids — surfaced for the preview, never auto-merged. */
	possibleDuplicates: { localId: string; backupId: string; name: string; dob: string | null }[];
	/** Backup rows dropped because their parent didn't survive the plan. */
	orphansDropped: number;
	/** The backup's dataVersion — the apply step bumps local PAST both sides. */
	backupDataVersion: number;
	/** Both-sides studies the backup won (units replaced). The apply step uses this to let
	 *  follow-state ride its unit past the LWW re-check, and stripUpdates uses it to drop
	 *  cbct/ios state ADDS whose unit flip is being stripped (their markups/hiddenMeshes
	 *  reference the BACKUP segmentation's mesh names — without the flip they would pair
	 *  with the LOCAL segmentation: a Frankenstein). */
	flippedStudies: string[];
	counts: MergeCounts;
}

export interface MergeCounts {
	patientsAdded: number;
	patientsUpdated: number;
	studiesAdded: number;
	studiesUpdated: number;
	stateAdded: number;
	stateUpdated: number;
	filesToFetch: number;
	suppressed: number;
	possibleDuplicates: number;
	/** Backup rows identical to / older than local — informational ("already up to date"). */
	unchanged: number;
}

/** Parse a row stamp to epoch ms. Local rows carry `toISOString()` ('…T…Z') but rows
 *  that arrived via an ONLINE restore preserve PocketBase's '`YYYY-MM-DD HH:MM:SS.mmmZ`'
 *  (space separator) — and a LEXICOGRAPHIC compare of mixed formats is wrong on equal
 *  dates (' ' < 'T' makes the PB form lose regardless of time). Normalize + parse;
 *  missing/garbage stamps → 0 (oldest, so the other side wins deterministically). */
export function stampMs(stamp: string | undefined | null): number {
	if (!stamp) return 0;
	const t = Date.parse(stamp.includes('T') ? stamp : stamp.replace(' ', 'T'));
	return Number.isFinite(t) ? t : 0;
}

function changes<T>(): TableChanges<T> {
	return { add: [], update: [] };
}

const dobKey = (d?: string | null) => (d ?? '').trim().slice(0, 10);
const nameKey = (n: string) => foldDiacritics(n.trim());

export function planMerge(input: {
	local: LocalSnapshotLite;
	backup: BackupManifestLite;
	/** [] degrades to a pure additive merge (every backup-only row returns). */
	tombstones: Tombstone[];
}): MergePlan {
	const { local, backup, tombstones } = input;

	const plan: MergePlan = {
		patients: changes(),
		studies: changes(),
		inferences: changes(),
		studyReportState: changes(),
		cbctReportState: changes(),
		iosState: changes(),
		filesToFetch: changes(),
		suppressed: [],
		possibleDuplicates: [],
		orphansDropped: 0,
		backupDataVersion: backup.dataVersion,
		flippedStudies: [],
		counts: {
			patientsAdded: 0,
			patientsUpdated: 0,
			studiesAdded: 0,
			studiesUpdated: 0,
			stateAdded: 0,
			stateUpdated: 0,
			filesToFetch: 0,
			suppressed: 0,
			possibleDuplicates: 0,
			unchanged: 0
		}
	};

	const tsPatients = new Map<string, string>();
	const tsStudies = new Map<string, string>();
	for (const t of tombstones) {
		(t.table === 'patients' ? tsPatients : tsStudies).set(t.id, t.deletedAt);
	}
	const vetoed = (ts: Map<string, string>, id: string, rowUpdated: string | undefined) => {
		const deletedAt = ts.get(id);
		return deletedAt !== undefined && stampMs(deletedAt) >= stampMs(rowUpdated);
	};

	// --- patients: per-row LWW by `updated` (identity fields only; children are
	// decided independently below) -------------------------------------------------
	const localPatients = new Map(local.patients.map((p) => [p.id, p]));
	const addedPatients = new Set<string>();
	const suppressedPatients = new Set<string>();
	for (const bp of backup.patients) {
		const lp = localPatients.get(bp.id);
		if (!lp) {
			if (vetoed(tsPatients, bp.id, bp.updated)) {
				suppressedPatients.add(bp.id);
				plan.suppressed.push({ table: 'patients', id: bp.id });
				continue;
			}
			plan.patients.add.push(bp);
			addedPatients.add(bp.id);
		} else if (stampMs(bp.updated) > stampMs(lp.updated)) {
			plan.patients.update.push(bp);
		} else {
			plan.counts.unchanged++;
		}
	}
	// Possible duplicates: a backup ADD that looks like an existing local person.
	for (const bp of plan.patients.add) {
		const bn = nameKey(bp.name);
		const bd = dobKey(bp.dob);
		for (const lp of local.patients) {
			if (nameKey(lp.name) === bn && dobKey(lp.dob) === bd) {
				plan.possibleDuplicates.push({
					localId: lp.id,
					backupId: bp.id,
					name: lp.name,
					dob: lp.dob ?? null
				});
				break;
			}
		}
	}

	// --- studies: STUDY-UNIT atomic by `study.updated` ----------------------------
	const localStudies = new Map(local.studies.map((s) => [s.id, s]));
	const backupInfStudyIds = new Set(backup.inferences.map((r) => r.studyId));
	const backupFilesByStudy = new Map<string, BackupFileRef[]>();
	for (const f of backup.files) {
		const arr = backupFilesByStudy.get(f.studyId) ?? [];
		arr.push(f);
		backupFilesByStudy.set(f.studyId, arr);
	}
	const addedStudies = new Set<string>();
	const flippedStudies = new Set<string>(); // both sides, backup won — unit replaced
	const suppressedStudies = new Set<string>();
	const parentSurvives = (patientId: string) =>
		localPatients.has(patientId) || addedPatients.has(patientId);
	const enqueueUnit = (s: DbStudy, kind: 'add' | 'update') => {
		if (backupInfStudyIds.has(s.id)) plan.inferences[kind].push({ studyId: s.id });
		for (const f of backupFilesByStudy.get(s.id) ?? []) plan.filesToFetch[kind].push(f);
	};
	for (const bs of backup.studies) {
		const ls = localStudies.get(bs.id);
		if (!ls) {
			// Cascade: a suppressed parent suppresses its BACKUP-ONLY subtree (delete-wins —
			// even backup studies newer than the patient tombstone; documented). A study
			// that exists locally is NOT part of the deleted subtree — it falls through to
			// the both-sides branch below, whose parent check keeps the local version.
			if (suppressedPatients.has(bs.patient)) {
				suppressedStudies.add(bs.id);
				continue;
			}
			if (vetoed(tsStudies, bs.id, bs.updated)) {
				suppressedStudies.add(bs.id);
				plan.suppressed.push({ table: 'studies', id: bs.id });
				continue;
			}
			if (!parentSurvives(bs.patient)) {
				// Backup-internal orphan (its patient is in neither side's surviving set).
				suppressedStudies.add(bs.id);
				plan.orphansDropped++;
				continue;
			}
			plan.studies.add.push(bs);
			addedStudies.add(bs.id);
			enqueueUnit(bs, 'add');
		} else if (stampMs(bs.updated) > stampMs(ls.updated)) {
			if (!parentSurvives(bs.patient)) {
				// Backup reassigned the study onto a patient that doesn't survive here
				// (e.g. tombstoned). Applying would orphan it — keep the local version.
				plan.orphansDropped++;
				plan.counts.unchanged++;
				continue;
			}
			plan.studies.update.push(bs);
			flippedStudies.add(bs.id);
			enqueueUnit(bs, 'update');
		} else {
			plan.counts.unchanged++;
		}
	}

	// --- per-study state rows: identity is [user+study] (each device genId()s its own
	// row id), LWW by own `updated`; cbct/ios FOLLOW a flipped unit ------------------
	const studySurvives = (studyId: string) =>
		!suppressedStudies.has(studyId) && (localStudies.has(studyId) || addedStudies.has(studyId));
	function planState<T extends { id: string; study: string; updated: string }>(
		localRows: T[],
		backupRows: T[],
		out: TableChanges<T>,
		followsUnit: boolean
	) {
		const byStudy = new Map(localRows.map((r) => [r.study, r]));
		for (const br of backupRows) {
			if (suppressedStudies.has(br.study)) continue; // cascade — never resurrect under a veto
			if (!studySurvives(br.study)) {
				plan.orphansDropped++;
				continue;
			}
			const lr = byStudy.get(br.study);
			if (!lr) {
				out.add.push(br);
			} else if (
				(followsUnit && flippedStudies.has(br.study)) ||
				stampMs(br.updated) > stampMs(lr.updated)
			) {
				// Re-key onto the LOCAL row id so the apply overwrites in place and never
				// trips the &[user+study] unique index.
				out.update.push({ ...br, id: lr.id });
			} else {
				plan.counts.unchanged++;
			}
		}
	}
	planState(local.studyReportState, backup.studyReportState, plan.studyReportState, false);
	planState(local.cbctReportState, backup.cbctReportState, plan.cbctReportState, true);
	planState(local.iosState, backup.iosState, plan.iosState, true);
	plan.flippedStudies = [...flippedStudies];

	// --- counts --------------------------------------------------------------------
	const c = plan.counts;
	c.patientsAdded = plan.patients.add.length;
	c.patientsUpdated = plan.patients.update.length;
	c.studiesAdded = plan.studies.add.length;
	c.studiesUpdated = plan.studies.update.length;
	c.stateAdded =
		plan.studyReportState.add.length + plan.cbctReportState.add.length + plan.iosState.add.length;
	c.stateUpdated =
		plan.studyReportState.update.length +
		plan.cbctReportState.update.length +
		plan.iosState.update.length;
	c.filesToFetch = plan.filesToFetch.add.length + plan.filesToFetch.update.length;
	c.suppressed = plan.suppressed.length;
	c.possibleDuplicates = plan.possibleDuplicates.length;
	return plan;
}

/** The preview's "also update N items" toggle, OFF: an adds-only plan. Updates (and the
 *  inference/file fetches that belong to flipped units) are dropped wholesale; adds are
 *  untouched — EXCEPT cbct/ios state ADDS riding a flipped unit: their content references
 *  the BACKUP segmentation's mesh names, and with the flip stripped the local segmentation
 *  stays — applying them anyway would hide/mark the wrong meshes (Frankenstein). The 2D
 *  report is seg-independent, so its adds always survive. Pure — returns a new plan,
 *  recounted. */
export function stripUpdates(plan: MergePlan): MergePlan {
	const flipped = new Set(plan.flippedStudies);
	const dropFollowAdds = <T extends { study: string }>(rows: T[]) =>
		rows.filter((r) => !flipped.has(r.study));
	const cbctAdd = dropFollowAdds(plan.cbctReportState.add);
	const iosAdd = dropFollowAdds(plan.iosState.add);
	const stripped: MergePlan = {
		...plan,
		patients: { add: plan.patients.add, update: [] },
		studies: { add: plan.studies.add, update: [] },
		inferences: { add: plan.inferences.add, update: [] },
		studyReportState: { add: plan.studyReportState.add, update: [] },
		cbctReportState: { add: cbctAdd, update: [] },
		iosState: { add: iosAdd, update: [] },
		filesToFetch: { add: plan.filesToFetch.add, update: [] },
		flippedStudies: [], // no units flip in an adds-only plan
		counts: {
			...plan.counts,
			patientsUpdated: 0,
			studiesUpdated: 0,
			stateAdded: plan.studyReportState.add.length + cbctAdd.length + iosAdd.length,
			stateUpdated: 0,
			filesToFetch: plan.filesToFetch.add.length
		}
	};
	return stripped;
}

/** Nothing to write — the apply step is skipped entirely (no dataVersion bump, no
 *  broadcast), and the UI reports "already up to date". */
export function isPlanEmpty(plan: MergePlan): boolean {
	return (
		plan.patients.add.length + plan.patients.update.length === 0 &&
		plan.studies.add.length + plan.studies.update.length === 0 &&
		plan.inferences.add.length + plan.inferences.update.length === 0 &&
		plan.studyReportState.add.length + plan.studyReportState.update.length === 0 &&
		plan.cbctReportState.add.length + plan.cbctReportState.update.length === 0 &&
		plan.iosState.add.length + plan.iosState.update.length === 0 &&
		plan.filesToFetch.add.length + plan.filesToFetch.update.length === 0
	);
}
