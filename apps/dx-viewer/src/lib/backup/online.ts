// Online backup / restore — copies the local IndexedDB snapshot to/from PocketBase. The
// server stores patient data ONLY here, after an explicit Labs backup. Everything except
// the binary study files goes through the normal user-scoped collection API; the files go
// through the chunked /api/backup/file-chunk route (Cloudflare caps a request at ~100 MB,
// a CBCT can be ~300 MB). A backup is a FULL REPLACE: the user's existing server rows are
// deleted first, so the server always mirrors exactly the latest snapshot.
//
// TORN-BACKUP SAFETY: the per-user `backup_meta` pointer is DELETED before the replace
// begins and re-created only after EVERY row + file has uploaded. While a backup is in
// flight (or after a mid-backup failure) the server therefore advertises NO restorable
// backup — getServerBackupInfo() → null → the restore gate refuses — instead of the old
// pointer over partial data, which restoreFromServer would have trusted and silently
// restored as if complete (data loss in the disaster-recovery path).

import { pb, apiFetch } from '$lib/pb';
import { genId, isValidId } from '$lib/db/ids';
import { localDb, type LocalDb } from '$lib/db/localDb';
import { SCHEMA_VERSION } from '$lib/db/schema';
import { withBackupLock } from './lock';
import { canRestore } from './gate';
import { planMerge, stampMs, stripUpdates, type BackupManifestLite, type MergePlan } from './merge';
import { ensureStorageFor } from './storage';
import type {
	BackupPointer,
	DbDeletion,
	DbPatient,
	DbStudy,
	DbStudyReportState,
	DbCbctReportState,
	DbIosState,
	DbInference,
	DbFile,
	FileKind,
	UserSnapshot
} from '$lib/db/schema';
import type { RecordModel } from 'pocketbase';

const CHUNK_SIZE = 90 * 1024 * 1024; // < 100 MB Cloudflare edge cap

export interface ServerBackupInfo {
	dataVersion: number;
	snapshotAt: string;
	/** Export wire-format version of the snapshot (mirrors the zip's meta.json). Absent
	 *  (undefined) on pointers written before the backup_meta migration applied — those
	 *  get no version check, matching the old behaviour. */
	schemaVersion?: number;
}

/** The per-user backup pointer on the server (dataVersion + timestamp + schema), or null. */
export async function getServerBackupInfo(): Promise<ServerBackupInfo | null> {
	// user-scoped list rule → returns only the caller's row. The `fields` filter keeps the
	// gate/preview reads LIGHT — backup_meta also carries the (potentially large)
	// `tombstones` JSON blob, which only the restore path needs (getServerTombstones).
	const list = await pb.collection('backup_meta').getFullList<RecordModel & ServerBackupInfo>({
		fields: 'id,dataVersion,snapshotAt,schemaVersion'
	});
	const rec = list[0];
	if (!rec) return null;
	return {
		dataVersion: typeof rec.dataVersion === 'number' ? rec.dataVersion : 0,
		snapshotAt: typeof rec.snapshotAt === 'string' ? rec.snapshotAt : '',
		// 0/absent ⇒ pre-migration row (PB returns 0 for an unset number field).
		schemaVersion:
			typeof rec.schemaVersion === 'number' && rec.schemaVersion > 0 ? rec.schemaVersion : undefined
	};
}

/** Drop rows whose parent row is missing from the snapshot. IndexedDB has no FK
 *  enforcement, so a rare write window (e.g. a debounced markup save landing after its
 *  study was deleted in another tab) can leave orphan rows locally. PocketBase DOES
 *  validate relations on create, so a single orphan would otherwise fail EVERY future
 *  backup with an opaque error. Exported for tests. */
export function pruneOrphans(snap: UserSnapshot): { snap: UserSnapshot; dropped: number } {
	const patientIds = new Set(snap.patients.map((p) => p.id));
	const studies = snap.studies.filter((s) => patientIds.has(s.patient));
	const studyIds = new Set(studies.map((s) => s.id));
	const pruned: UserSnapshot = {
		...snap,
		studies,
		inferences: snap.inferences.filter((r) => studyIds.has(r.studyId)),
		files: snap.files.filter((f) => studyIds.has(f.studyId)),
		studyReportState: snap.studyReportState.filter((r) => studyIds.has(r.study)),
		cbctReportState: snap.cbctReportState.filter((r) => studyIds.has(r.study)),
		iosState: snap.iosState.filter((r) => studyIds.has(r.study))
	};
	const dropped =
		snap.studies.length -
		pruned.studies.length +
		(snap.inferences.length - pruned.inferences.length) +
		(snap.files.length - pruned.files.length) +
		(snap.studyReportState.length - pruned.studyReportState.length) +
		(snap.cbctReportState.length - pruned.cbctReportState.length) +
		(snap.iosState.length - pruned.iosState.length);
	return { snap: pruned, dropped };
}

/** Bound the tombstone blob riding the backup pointer: keep the NEWEST `cap` (oldest
 *  tombstones guard against the oldest backups — the least likely to ever be merged).
 *  Exported for tests; the real cap stays far under backup_meta's 2MB json maxSize. */
export const TOMBSTONE_UPLOAD_CAP = 10_000;
export function capTombstones(tombstones: DbDeletion[], cap = TOMBSTONE_UPLOAD_CAP): DbDeletion[] {
	if (tombstones.length <= cap) return tombstones;
	const kept = [...tombstones]
		.sort((a, b) => stampMs(b.deletedAt) - stampMs(a.deletedAt))
		.slice(0, cap);
	// No silent caps: dropping deletion knowledge weakens future resurrection-suppression.
	console.warn(
		`backup: tombstone upload capped at ${cap} (dropped ${tombstones.length - cap} oldest)`
	);
	return kept;
}

async function uploadFileChunked(file: DbFile): Promise<void> {
	if (!file.blob || file.blob.size === 0) return;
	const total = Math.max(1, Math.ceil(file.blob.size / CHUNK_SIZE));
	const uploadId = genId(); // [a-z0-9]{15} — matches the route's strict whitelist
	for (let i = 0; i < total; i++) {
		const slice = file.blob.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
		const fd = new FormData();
		fd.append('uploadId', uploadId);
		fd.append('studyId', file.studyId);
		fd.append('kind', file.kind);
		fd.append('index', String(i));
		fd.append('total', String(total));
		fd.append('filename', file.filename || 'upload.bin');
		fd.append('chunk', slice, file.filename || 'upload.bin');
		// Don't set Content-Type — the browser sets the multipart boundary.
		await apiFetch('/api/backup/file-chunk', { method: 'POST', body: fd });
	}
}

// Cross-tab serialization for backup AND restore/merge lives in lock.ts (shared with the
// zip paths) — two tabs' replace/merge plan→download→apply must never interleave.

/** Back up the current user's entire local dataset to the server (full replace). Returns
 *  the new backup pointer. */
export async function backupToServer(
	userId: string,
	onProgress?: (label: string) => void,
	db: LocalDb = localDb
): Promise<BackupPointer> {
	return withBackupLock(async () => {
		const raw = await db.exportUser(userId);
		const { snap, dropped } = pruneOrphans(raw);
		if (dropped > 0) console.warn(`backup: skipped ${dropped} orphan local row(s)`);

		// 1. Invalidate the pointer FIRST (see torn-backup note above), then reset the
		//    server: deleting the user's patients cascades to studies (and their files)
		//    and the per-study state rows, so the server starts clean.
		onProgress?.('reset');
		const staleMeta = await pb.collection('backup_meta').getFullList<RecordModel>({ fields: 'id' });
		for (const m of staleMeta) await pb.collection('backup_meta').delete(m.id);
		const existing = await pb.collection('patients').getFullList<RecordModel>({ fields: 'id' });
		for (const p of existing) await pb.collection('patients').delete(p.id);

		// 2. Patients.
		onProgress?.('patients');
		for (const p of snap.patients) {
			await pb.collection('patients').create({
				id: p.id,
				user: userId,
				name: p.name,
				dob: p.dob || null,
				initials: p.initials ?? '',
				ringColors: p.ringColors ?? null,
				quick: !!p.quick
			});
		}

		// 3. Studies (+ inference / userEdits JSON merged from the local `inferences` store).
		onProgress?.('studies');
		const infById = new Map(snap.inferences.map((r) => [r.studyId, r]));
		for (const s of snap.studies) {
			const inf = infById.get(s.id);
			await pb.collection('studies').create({
				id: s.id,
				user: userId,
				patient: s.patient,
				modality: s.modality,
				fmxSlot: s.fmxSlot ?? '',
				capturedAt: s.capturedAt || null,
				originalFilename: s.originalFilename ?? '',
				findingCounts: s.findingCounts ?? null,
				severityScore: s.severityScore ?? null,
				inference: inf?.inference ?? null,
				userEdits: inf?.userEdits ?? null
			});
		}

		// 4. Binary files (chunked) — after the studies records exist (the route attaches to them).
		onProgress?.('files');
		for (const f of snap.files) await uploadFileChunked(f);

		// 5. Per-study report / markup state.
		onProgress?.('state');
		for (const r of snap.studyReportState) {
			await pb.collection('study_report_state').create({
				id: r.id,
				user: userId,
				study: r.study,
				reportText: r.reportText ?? '',
				status: r.status ?? ''
			});
		}
		for (const r of snap.cbctReportState) {
			await pb.collection('cbct_report_state').create({
				id: r.id,
				user: userId,
				study: r.study,
				signedBy: r.signedBy ?? '',
				signedAt: r.signedAt || null,
				approvedTeeth: r.approvedTeeth ?? null,
				comments: r.comments ?? null,
				markups: r.markups ?? null,
				hiddenMeshes: r.hiddenMeshes ?? null
			});
		}
		for (const r of snap.iosState) {
			await pb.collection('ios_state').create({
				id: r.id,
				user: userId,
				study: r.study,
				measures: r.measures ?? null,
				hiddenMeshes: r.hiddenMeshes ?? null
			});
		}

		// 6. Backup pointer — written LAST: only a COMPLETE upload advertises a restorable
		//    backup (the unique index on `user` plus the delete in step 1 make create safe).
		//    schemaVersion lets a future restore refuse an incompatible snapshot; the
		//    tombstones blob carries deletion knowledge so an online device migration
		//    (restore on a fresh device) can still suppress resurrections from old exports.
		//    Until the respective backup_meta migrations apply, PB silently drops unknown
		//    keys (verified live for schemaVersion; same mechanism).
		onProgress?.('finalize');
		const snapshotAt = new Date().toISOString();
		await pb.collection('backup_meta').create({
			user: userId,
			dataVersion: snap.dataVersion,
			snapshotAt,
			schemaVersion: SCHEMA_VERSION,
			tombstones: capTombstones(snap.tombstones ?? [])
		});

		const ptr: BackupPointer = { at: Date.now(), dataVersion: snap.dataVersion };
		await db.setBackupPointer(userId, ptr);
		return ptr;
	});
}

// --- PB record → local Db row mappers ---------------------------------------

function toDbPatient(r: RecordModel, userId: string): DbPatient {
	return {
		id: r.id,
		user: userId,
		name: r.name,
		dob: r.dob || null,
		initials: r.initials,
		ringColors: r.ringColors,
		quick: !!r.quick,
		created: r.created,
		updated: r.updated
	};
}
function toDbStudy(r: RecordModel, userId: string): DbStudy {
	return {
		id: r.id,
		user: userId,
		patient: r.patient,
		modality: r.modality,
		fmxSlot: r.fmxSlot || undefined,
		capturedAt: r.capturedAt || undefined,
		originalFilename: r.originalFilename || undefined,
		findingCounts: r.findingCounts ?? undefined,
		severityScore: typeof r.severityScore === 'number' ? r.severityScore : undefined,
		created: r.created,
		updated: r.updated
	};
}

/** Restore the current user's data from the server backup into IndexedDB (REPLACES local
 *  data). The caller is responsible for the gate check + a studies.hardReload() afterwards.
 *  STRICT: any failed binary download aborts the restore BEFORE local data is touched — a
 *  silently-skipped file would "successfully" restore patients whose scans are gone. */
export async function restoreFromServer(
	userId: string,
	db: LocalDb = localDb
): Promise<{ dataVersion: number }> {
	return withBackupLock(() => restoreFromServerLocked(userId, db));
}

function toDbStudyReport(r: RecordModel, userId: string): DbStudyReportState {
	return {
		id: r.id,
		user: userId,
		study: r.study,
		reportText: r.reportText ?? '',
		status: r.status ?? '',
		created: r.created,
		updated: r.updated
	};
}
function toDbCbctReport(r: RecordModel, userId: string): DbCbctReportState {
	return {
		id: r.id,
		user: userId,
		study: r.study,
		signedBy: r.signedBy ?? '',
		signedAt: r.signedAt || null,
		approvedTeeth: r.approvedTeeth ?? [],
		comments: r.comments ?? {},
		markups: r.markups ?? undefined,
		hiddenMeshes: r.hiddenMeshes ?? [],
		created: r.created,
		updated: r.updated
	};
}
function toDbIosState(r: RecordModel, userId: string): DbIosState {
	return {
		id: r.id,
		user: userId,
		study: r.study,
		measures: r.measures ?? undefined,
		hiddenMeshes: r.hiddenMeshes ?? [],
		created: r.created,
		updated: r.updated
	};
}

/** Fetch the server backup's METADATA (pointer + every row, NO blobs) — shared by the
 *  full restore and the merge paths. Throws when there is no backup or the snapshot was
 *  written by an incompatible app version (pre-migration pointers carry no schemaVersion
 *  and keep the old unchecked behaviour). */
async function fetchServerRows(): Promise<{
	info: ServerBackupInfo;
	patients: RecordModel[];
	studies: RecordModel[];
	srs: RecordModel[];
	crs: RecordModel[];
	ios: RecordModel[];
}> {
	const info = await getServerBackupInfo();
	if (!info) throw new Error('no server backup');
	if (info.schemaVersion !== undefined && info.schemaVersion !== SCHEMA_VERSION) {
		throw new Error(`unsupported backup version (${info.schemaVersion} ≠ ${SCHEMA_VERSION})`);
	}
	const [patients, studies, srs, crs, ios] = await Promise.all([
		pb.collection('patients').getFullList<RecordModel>(),
		pb.collection('studies').getFullList<RecordModel>(),
		pb.collection('study_report_state').getFullList<RecordModel>(),
		pb.collection('cbct_report_state').getFullList<RecordModel>(),
		pb.collection('ios_state').getFullList<RecordModel>()
	]);
	return { info, patients, studies, srs, crs, ios };
}

/** The deletion knowledge riding the backup pointer (see backupToServer step 6), shape-
 *  validated row by row — it is own-user data, but a junk row would sit in the local
 *  deletions table forever (no GC) and feed the merge planner garbage. Fetched ONLY by
 *  the restore path; rows written before the tombstones migration return undefined → [].
 *  Pre-deploy FEs also leave the field absent — same []. */
async function getServerTombstones(): Promise<DbDeletion[]> {
	const list = await pb.collection('backup_meta').getFullList<RecordModel>({
		fields: 'tombstones'
	});
	const raw = list[0]?.tombstones;
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(t): t is DbDeletion =>
			!!t &&
			typeof t === 'object' &&
			((t as DbDeletion).table === 'patients' || (t as DbDeletion).table === 'studies') &&
			isValidId((t as DbDeletion).id) &&
			typeof (t as DbDeletion).deletedAt === 'string'
	);
}

// TOKEN LIFETIME: PB file tokens expire after ~180s and a multi-CBCT disaster recovery is
// a multi-minute sequential download — one token fetched up front WILL expire mid-restore
// and hard-abort a legitimate run. Refresh the token as it ages; callers retry an
// auth-failed download ONCE with a forced-fresh token (genuine failures still throw).
function fileTokenSource(): (force?: boolean) => Promise<string> {
	let token = '';
	let tokenAt = 0;
	return async (force = false) => {
		if (force || !token || Date.now() - tokenAt > 120_000) {
			token = await pb.files.getToken();
			tokenAt = Date.now();
		}
		return token;
	};
}

/** Download one protected study file — throw on any non-OK response (a silently-skipped
 *  file would "successfully" restore/merge patients whose scans are gone). */
async function downloadStudyFile(
	s: RecordModel,
	kind: FileKind,
	fileToken: (force?: boolean) => Promise<string>,
	userId: string
): Promise<DbFile> {
	const fname = s[kind] as string;
	let resp = await fetch(pb.files.getURL(s, fname, { token: await fileToken() }));
	if (resp.status === 401 || resp.status === 403) {
		// Token likely expired between the age check and serving — one retry, fresh token.
		resp = await fetch(pb.files.getURL(s, fname, { token: await fileToken(true) }));
	}
	if (!resp.ok) {
		throw new Error(`backup file download failed (HTTP ${resp.status}) for study ${s.id}`);
	}
	const blob = await resp.blob();
	return {
		studyId: s.id,
		kind,
		user: userId,
		blob,
		filename: s.originalFilename || fname,
		mime: blob.type || 'application/octet-stream'
	};
}

async function restoreFromServerLocked(
	userId: string,
	db: LocalDb
): Promise<{ dataVersion: number }> {
	const { info, patients, studies, srs, crs, ios } = await fetchServerRows();

	// TOCTOU guard: the dialog's gate verdict was computed at PREVIEW time and the dialog
	// is non-blocking — ordinary writes (this tab's debounced saves, other tabs) can land
	// before the user clicks Replace. Re-assert the gate HERE, inside the lock, against
	// fresh values: a stale verdict must never wipe newer local work.
	const gate = canRestore({
		localEmpty: await db.isEmpty(userId),
		localDataVersion: await db.getDataVersion(userId),
		backupDataVersion: info.dataVersion
	});
	if (!gate.ok) throw new Error('local-newer'); // mapped to the localized refusal by the card

	// Download the binary files. They are `protected: true`, so a file token is REQUIRED —
	// a token failure (or any non-OK download) must throw, not fall through to a
	// "successful" restore with missing binaries. Sequential to bound memory.
	const fileToken = fileTokenSource();
	await fileToken(); // pre-flight: a token failure aborts before any download/write
	const files: DbFile[] = [];
	const inferences: DbInference[] = [];
	// PB records carry no blob sizes, so the quota guard is CUMULATIVE: after each
	// sequential download, the remaining free space must still hold an IndexedDB copy of
	// everything downloaded so far — aborting here (before importUser) leaves local data
	// untouched, exactly like a failed download.
	let downloadedBytes = 0;
	for (const s of studies) {
		if (s.inference || s.userEdits) {
			inferences.push({
				studyId: s.id,
				user: userId,
				inference: s.inference ?? null,
				userEdits: s.userEdits ?? null
			});
		}
		for (const kind of ['image', 'segmentation'] as FileKind[]) {
			if (!s[kind]) continue;
			const f = await downloadStudyFile(s, kind, fileToken, userId);
			downloadedBytes += f.blob.size;
			await ensureStorageFor(downloadedBytes);
			files.push(f);
		}
	}

	const snap: UserSnapshot = {
		patients: patients.map((r) => toDbPatient(r, userId)),
		studies: studies.map((r) => toDbStudy(r, userId)),
		inferences,
		studyReportState: srs.map((r) => toDbStudyReport(r, userId)),
		cbctReportState: crs.map((r) => toDbCbctReport(r, userId)),
		iosState: ios.map((r) => toDbIosState(r, userId)),
		files,
		// Deletion knowledge rides the pointer; importUser merges it in additively (never
		// rolling back a newer local tombstone) — the zip path's exact sibling, closing the
		// "online device migration drops deletion knowledge" v1 gap.
		tombstones: await getServerTombstones(),
		dataVersion: info.dataVersion
	};

	await db.importUser(userId, snap);
	await db.setBackupPointer(userId, { at: Date.now(), dataVersion: info.dataVersion });
	return { dataVersion: info.dataVersion };
}

// --- diff-then-merge (online side) ----------------------------------------------------

/** Map the server rows into the planner's blob-free backup view. The file index is built
 *  from each study record's `image`/`segmentation` file fields (no sizes server-side). */
function backupLiteFromServer(
	rows: Awaited<ReturnType<typeof fetchServerRows>>,
	userId: string
): BackupManifestLite {
	const files: BackupManifestLite['files'] = [];
	const inferences: BackupManifestLite['inferences'] = [];
	for (const s of rows.studies) {
		if (s.inference || s.userEdits) inferences.push({ studyId: s.id });
		for (const kind of ['image', 'segmentation'] as FileKind[]) {
			const fname = s[kind] as string;
			if (!fname) continue;
			files.push({
				studyId: s.id,
				kind,
				filename: s.originalFilename || fname,
				mime: '' // unknown until downloaded — the blob's own type wins at apply
			});
		}
	}
	return {
		patients: rows.patients.map((r) => toDbPatient(r, userId)),
		studies: rows.studies.map((r) => toDbStudy(r, userId)),
		inferences,
		files,
		studyReportState: rows.srs.map((r) => toDbStudyReport(r, userId)),
		cbctReportState: rows.crs.map((r) => toDbCbctReport(r, userId)),
		iosState: rows.ios.map((r) => toDbIosState(r, userId)),
		dataVersion: rows.info.dataVersion
	};
}

/** Dry-run plan for the merge PREVIEW dialog — metadata only (none of the binaries are
 *  downloaded), no lock, no writes. The apply step re-plans inside the lock. */
export async function planMergeFromServer(
	userId: string,
	db: LocalDb = localDb
): Promise<MergePlan> {
	const rows = await fetchServerRows();
	const [local, tombstones] = await Promise.all([
		db.exportUserLite(userId),
		db.getTombstones(userId)
	]);
	return planMerge({ local, backup: backupLiteFromServer(rows, userId), tombstones });
}

export interface ServerMergeResult {
	/** The plan that was actually APPLIED (post strip, re-planned inside the lock). */
	plan: MergePlan;
	applied: boolean;
	orphansSkipped: number;
}

/** Diff-then-merge the server backup into the live local data. Non-destructive (only the
 *  plan's adds — and, with includeUpdates, its LWW updates — are written) and SELECTIVE:
 *  only the blobs the plan needs are downloaded, not the whole backup. Holds the shared
 *  backup lock for plan→download→apply. STRICT like restore: any failed planned download
 *  aborts before local data is touched. Deliberately does NOT move the backup pointer —
 *  the merged local state is strictly newer than the server snapshot, and the pointer
 *  records the last completed BACKUP. */
export async function mergeFromServer(
	userId: string,
	opts: { includeUpdates: boolean },
	db: LocalDb = localDb
): Promise<ServerMergeResult> {
	return withBackupLock(async () => {
		const rows = await fetchServerRows();
		const [local, tombstones] = await Promise.all([
			db.exportUserLite(userId),
			db.getTombstones(userId)
		]);
		let plan = planMerge({ local, backup: backupLiteFromServer(rows, userId), tombstones });
		if (!opts.includeUpdates) plan = stripUpdates(plan);

		const rawById = new Map(rows.studies.map((s) => [s.id, s]));
		const fileToken = fileTokenSource();
		const files: DbFile[] = [];
		const planned = [...plan.filesToFetch.add, ...plan.filesToFetch.update];
		if (planned.length > 0) await fileToken(); // pre-flight like restore
		// Cumulative quota guard — see restoreFromServerLocked (no sizes in PB records).
		let downloadedBytes = 0;
		for (const f of planned) {
			const s = rawById.get(f.studyId);
			if (!s || !s[f.kind]) {
				// The pointer advertised a complete backup; a planned file missing from its
				// study record means a torn server copy — abort before any write.
				throw new Error(`backup file missing on server for study ${f.studyId} (${f.kind})`);
			}
			const file = await downloadStudyFile(s, f.kind, fileToken, userId);
			downloadedBytes += file.blob.size;
			await ensureStorageFor(downloadedBytes);
			files.push(file);
		}

		const wantInference = new Set(
			[...plan.inferences.add, ...plan.inferences.update].map((r) => r.studyId)
		);
		const inferences: DbInference[] = [];
		for (const id of wantInference) {
			const s = rawById.get(id);
			if (!s) continue;
			inferences.push({
				studyId: s.id,
				user: userId,
				inference: s.inference ?? null,
				userEdits: s.userEdits ?? null
			});
		}

		const { applied, orphansSkipped } = await db.mergeUser(userId, plan, { inferences, files });
		return { plan, applied, orphansSkipped };
	});
}
