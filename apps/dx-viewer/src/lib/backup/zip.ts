// File export / import / merge — a single .zip holding a full per-user snapshot:
//   meta.json      { schemaVersion, dataVersion, createdAt }
//   manifest.json  { patients, studies, inferences, studyReportState, cbctReportState,
//                    iosState, tombstones, files: [{studyId, kind, filename, mime, size}] }
//   files/<studyId>.<kind>   the binary image / segmentation blobs
// `tombstones` and per-file `size` are ADDITIVE (SCHEMA_VERSION stays 1): older importers
// iterate a fixed section list and ignore unknown keys; older zips simply lack them.
// Import validates schemaVersion + manifest structure before touching local data; the
// dataVersion drives the same restore/import gate as an online restore. The MERGE path
// (planMergeFromZip preview + mergeFromZip apply) feeds the same validated manifest into
// the pure planner (merge.ts) instead of wiping.
//
// STREAMING (fflate), not JSZip: the old implementation pulled EVERY binary into RAM at
// once (arrayBuffer per file + the whole zip in memory on both export and import) — a
// clinic with a handful of 300 MB CBCTs OOM-crashed the tab during the very operation
// meant to protect its data. Both directions now stream in ~4 MB chunks and consolidate
// output into Blob parts every ~32 MB, so the browser's blob store (which can spill to
// disk) holds the bulk while the JS heap stays bounded. Zips written by the previous
// JSZip exporter (DEFLATE) remain importable; fflate's output is a standard zip.

import { Zip, ZipDeflate, Unzip, UnzipInflate, UnzipPassThrough, strToU8 } from 'fflate';
import { localDb, type LocalDb } from '$lib/db/localDb';
import { isValidId } from '$lib/db/ids';
import {
	SCHEMA_VERSION,
	type DbDeletion,
	type DbFile,
	type DbInference,
	type DbPatient,
	type DbStudy,
	type UserSnapshot
} from '$lib/db/schema';
import { planMerge, stripUpdates, type BackupManifestLite, type MergePlan } from './merge';
import { canRestore } from './gate';
import { withBackupLock } from './lock';
import { ensureStorageFor } from './storage';

export interface ZipMeta {
	schemaVersion: number;
	dataVersion: number;
	createdAt: string;
}

interface FileIndexEntry {
	studyId: string;
	kind: 'image' | 'segmentation';
	filename: string;
	mime: string;
	/** Additive (absent on pre-merge-feature zips) — lets the merge pre-flight storage. */
	size?: number;
}

const READ_CHUNK = 4 * 1024 * 1024; // per-slice read granularity
const CONSOLIDATE_BYTES = 32 * 1024 * 1024; // heap → Blob-part handoff threshold

/** Yield a macrotask so multi-GB (de)compression on the main thread keeps the UI alive. */
function breathe(): Promise<void> {
	return new Promise((r) => setTimeout(r));
}

/** fflate's STREAMING Zip writer emits 32-bit sizes/offsets (no zip64): past 4 GiB the
 *  central directory silently truncates into a CORRUPT, un-importable archive — worse
 *  than refusing. Cap the export safely below the cliff; the online backup (chunked,
 *  no zip container) is the path for larger datasets. */
export const MAX_EXPORT_BYTES = Math.floor(3.8 * 1024 * 1024 * 1024);

/** Build a downloadable .zip snapshot of the current user's local data. Holds the shared
 *  backup lock across the read + blob streaming: the export reads rows then streams each
 *  blob lazily across yields, so a concurrent (locked) restore/merge in another tab could
 *  otherwise mutate the data mid-stream and produce a TORN archive (manifest listing a
 *  blob that was deleted under it). */
export async function exportToZip(userId: string, db: LocalDb = localDb): Promise<Blob> {
	return withBackupLock(() => exportToZipLocked(userId, db));
}

async function exportToZipLocked(userId: string, db: LocalDb): Promise<Blob> {
	const snap = await db.exportUser(userId);
	const totalBytes = snap.files.reduce((s, f) => s + (f.blob?.size ?? 0), 0);
	if (totalBytes > MAX_EXPORT_BYTES) {
		throw new Error('export too large'); // mapped to a localized message by the card
	}

	const parts: BlobPart[] = [];
	// fflate types its chunks Uint8Array<ArrayBufferLike>; they are plain
	// ArrayBuffer-backed, so narrow once for BlobPart compatibility.
	let pending: Uint8Array<ArrayBuffer>[] = [];
	let pendingBytes = 0;
	const flushPending = () => {
		if (!pending.length) return;
		parts.push(new Blob(pending));
		pending = [];
		pendingBytes = 0;
	};
	let zipErr: Error | null = null;
	const zip = new Zip((err, dat) => {
		if (err) {
			zipErr = err;
			return;
		}
		pending.push(dat as Uint8Array<ArrayBuffer>);
		pendingBytes += dat.length;
		if (pendingBytes >= CONSOLIDATE_BYTES) flushPending();
	});

	const addJson = (name: string, value: unknown) => {
		const f = new ZipDeflate(name);
		zip.add(f);
		f.push(strToU8(JSON.stringify(value)), true);
	};

	const meta: ZipMeta = {
		schemaVersion: SCHEMA_VERSION,
		dataVersion: snap.dataVersion,
		createdAt: new Date().toISOString()
	};
	addJson('meta.json', meta);
	const fileIndex: FileIndexEntry[] = snap.files.map((f) => ({
		studyId: f.studyId,
		kind: f.kind,
		filename: f.filename,
		mime: f.mime,
		size: f.blob?.size ?? 0
	}));
	addJson('manifest.json', {
		patients: snap.patients,
		studies: snap.studies,
		inferences: snap.inferences,
		studyReportState: snap.studyReportState,
		cbctReportState: snap.cbctReportState,
		iosState: snap.iosState,
		tombstones: snap.tombstones ?? [],
		files: fileIndex
	});

	for (const f of snap.files) {
		const zf = new ZipDeflate(`files/${f.studyId}.${f.kind}`);
		zip.add(zf);
		if (f.blob.size === 0) {
			zf.push(new Uint8Array(0), true);
			continue;
		}
		// Stream the blob through the deflater in slices — IndexedDB blobs are
		// disk-backed handles, so only the active slice occupies the heap.
		for (let off = 0; off < f.blob.size; off += READ_CHUNK) {
			const end = Math.min(off + READ_CHUNK, f.blob.size);
			const bytes = new Uint8Array(await f.blob.slice(off, end).arrayBuffer());
			zf.push(bytes, end >= f.blob.size);
			if (zipErr) throw zipErr;
			await breathe();
		}
	}
	zip.end();
	if (zipErr) throw zipErr;
	flushPending();
	return new Blob(parts, { type: 'application/zip' });
}

interface ZipReadResult {
	entries: Map<string, Blob>;
	/** TOLERANT mode only: the stream errored, or an entry started but never completed
	 *  (truncated tail) — some listed binaries may be missing from `entries`. */
	damaged: boolean;
}

/** Stream-unzip a Blob into per-entry Blobs (heap stays bounded — entry bytes are
 *  consolidated into Blob parts as they inflate). `stopAfter` short-circuits the scan
 *  once a given entry has fully arrived (readZipMeta only needs meta.json). TOLERANT
 *  mode (the damaged-archive salvage path) collects everything that inflates cleanly
 *  instead of throwing on the first corruption — incomplete entries are simply absent
 *  from the map and reported via `damaged`. */
async function readZipEntriesCore(
	zipBlob: Blob,
	opts: { stopAfter?: string; tolerant?: boolean } = {}
): Promise<ZipReadResult> {
	// Fast-fail non-zip input: every zip starts with a PK signature. Without this, a
	// renamed multi-GB garbage file streams ALL the way through (fflate's Unzip just
	// finds no entries) before failing as "meta.json missing" minutes later. Fatal even
	// for the tolerant path — a non-zip has nothing to salvage.
	const head = new Uint8Array(await zipBlob.slice(0, 2).arrayBuffer());
	if (head.length < 2 || head[0] !== 0x50 || head[1] !== 0x4b) {
		throw new Error('invalid backup file: not a zip archive');
	}
	const entries = new Map<string, Blob>();
	const started = new Set<string>();
	let damaged = false;
	let err: Error | null = null;
	let stop = false;
	const unzip = new Unzip((file) => {
		const name = file.name;
		started.add(name);
		let chunkParts: Uint8Array<ArrayBuffer>[] = [];
		let chunkBytes = 0;
		const blobParts: BlobPart[] = [];
		file.ondata = (e, data, final) => {
			if (e) {
				if (opts.tolerant) {
					damaged = true; // this entry is abandoned; keep scanning the rest
					return;
				}
				err = e;
				return;
			}
			chunkParts.push(data as Uint8Array<ArrayBuffer>);
			chunkBytes += data.length;
			if (chunkBytes >= CONSOLIDATE_BYTES) {
				blobParts.push(new Blob(chunkParts));
				chunkParts = [];
				chunkBytes = 0;
			}
			if (final) {
				if (chunkParts.length) blobParts.push(new Blob(chunkParts));
				entries.set(name, new Blob(blobParts));
				if (opts.stopAfter === name) stop = true;
			}
		};
		file.start();
	});
	unzip.register(UnzipPassThrough); // STORE entries
	unzip.register(UnzipInflate); // DEFLATE entries (incl. legacy JSZip exports)

	for (let off = 0; off < zipBlob.size && !stop; off += READ_CHUNK) {
		const end = Math.min(off + READ_CHUNK, zipBlob.size);
		const bytes = new Uint8Array(await zipBlob.slice(off, end).arrayBuffer());
		try {
			unzip.push(bytes, end >= zipBlob.size);
		} catch (e) {
			if (opts.tolerant) {
				// Stream unusable from here on — keep what fully inflated before the break.
				damaged = true;
				break;
			}
			throw new Error(`invalid backup file: ${e instanceof Error ? e.message : 'corrupt zip'}`, {
				cause: e
			});
		}
		// Wrap like the push-throw above so EVERY corruption error carries the
		// 'invalid backup file' prefix — isDamagedArchiveError keys off it to offer
		// the salvage path; a raw fflate message would dodge the classifier.
		if (err) {
			const e: Error = err;
			throw new Error(`invalid backup file: ${e.message || 'corrupt zip'}`, { cause: e });
		}
		await breathe();
	}
	// Truncated tail: an entry whose header arrived but whose data never finished. Only
	// meaningful for a FULL scan — a stopAfter scan deliberately abandons later entries.
	if (!opts.stopAfter) {
		for (const name of started) if (!entries.has(name)) damaged = true;
	}
	return { entries, damaged };
}

/** Strict read — the historical behaviour every non-salvage caller relies on. */
async function readZipEntries(zipBlob: Blob, stopAfter?: string): Promise<Map<string, Blob>> {
	const { entries } = await readZipEntriesCore(zipBlob, { stopAfter });
	return entries;
}

async function parseMetaBlob(metaBlob: Blob | undefined): Promise<ZipMeta> {
	if (!metaBlob) throw new Error('invalid backup file: meta.json missing');
	const meta = JSON.parse(await metaBlob.text()) as ZipMeta;
	if (typeof meta.schemaVersion !== 'number' || typeof meta.dataVersion !== 'number') {
		throw new Error('invalid backup file: bad meta');
	}
	return meta;
}

/** Read just the meta block from an export zip (for the gate, before importing). */
export async function readZipMeta(zipBlob: Blob): Promise<ZipMeta> {
	const entries = await readZipEntries(zipBlob, 'meta.json');
	return parseMetaBlob(entries.get('meta.json'));
}

function invalid(detail: string): never {
	throw new Error(`invalid backup file: ${detail}`);
}

const MANIFEST_SECTIONS = [
	'patients',
	'studies',
	'inferences',
	'studyReportState',
	'cbctReportState',
	'iosState',
	'tombstones',
	'files'
] as const;

/** Structural validation of an UNTRUSTED manifest before any row reaches IndexedDB. A
 *  hand-crafted/corrupted file would otherwise import wholesale: a non-array section or a
 *  junk id would sit in the local DB and later fail the online backup mid-replace (PB
 *  rejects ids that don't match `[a-z0-9]{15}`). Legit exports always pass — every id is
 *  genId()/PB-issued. */
function validateManifest(manifest: Record<string, unknown>): void {
	for (const key of MANIFEST_SECTIONS) {
		const rows = manifest[key] ?? [];
		if (!Array.isArray(rows)) invalid(`${key} is not a list`);
		for (const row of rows) {
			if (typeof row !== 'object' || row === null) invalid(`${key} row is not an object`);
			const r = row as Record<string, unknown>;
			if (key === 'inferences' || key === 'files') {
				if (!isValidId(r.studyId)) invalid(`${key} row has a bad studyId`);
			} else if (!isValidId(r.id)) {
				invalid(`${key} row has a bad id`);
			}
			if (key === 'studies' && !isValidId(r.patient)) invalid('study row has a bad patient id');
			if (
				(key === 'studyReportState' || key === 'cbctReportState' || key === 'iosState') &&
				!isValidId(r.study)
			) {
				invalid(`${key} row has a bad study id`);
			}
			if (key === 'files' && r.kind !== 'image' && r.kind !== 'segmentation') {
				invalid('file row has a bad kind');
			}
			if (key === 'tombstones') {
				if (r.table !== 'patients' && r.table !== 'studies')
					invalid('tombstone row has a bad table');
				if (typeof r.deletedAt !== 'string') invalid('tombstone row has a bad deletedAt');
			}
		}
	}
}

/** Shared schemaVersion + manifest validation for import AND merge — both must refuse an
 *  incompatible or corrupt archive BEFORE any row reaches IndexedDB. */
async function parseZipManifest(
	entries: Map<string, Blob>
): Promise<{ meta: ZipMeta; manifest: Record<string, unknown> }> {
	const meta = await parseMetaBlob(entries.get('meta.json'));
	if (meta.schemaVersion !== SCHEMA_VERSION) {
		throw new Error(`unsupported backup version (${meta.schemaVersion} ≠ ${SCHEMA_VERSION})`);
	}
	const manifestBlob = entries.get('manifest.json');
	if (!manifestBlob) throw new Error('invalid backup file: manifest.json missing');
	const manifest = JSON.parse(await manifestBlob.text());
	if (typeof manifest !== 'object' || manifest === null) invalid('manifest is not an object');
	validateManifest(manifest);
	return { meta, manifest };
}

/** Import an export zip into IndexedDB (REPLACES local data). Validates schemaVersion +
 *  manifest structure. The caller is responsible for the gate check + a
 *  studies.hardReload() afterwards. Holds the shared backup lock like its
 *  restoreFromServer sibling — an UNLOCKED destructive replace could interleave with a
 *  locked merge in another tab (the merge's plan would be stale by apply time). NOTE:
 *  deliberately does NOT touch the backup pointer — that records the last ONLINE backup;
 *  a file import is not one. */
export async function importFromZip(
	userId: string,
	zipBlob: Blob,
	db: LocalDb = localDb
): Promise<{ dataVersion: number }> {
	return withBackupLock(() => importFromZipLocked(userId, zipBlob, db));
}

async function importFromZipLocked(
	userId: string,
	zipBlob: Blob,
	db: LocalDb
): Promise<{ dataVersion: number }> {
	const entries = await readZipEntries(zipBlob);
	const { meta, manifest } = await parseZipManifest(entries);

	// TOCTOU guard — see restoreFromServerLocked: the dialog's gate verdict is stale by
	// apply time; re-assert against fresh local values inside the lock so a long-open
	// dialog can never wipe work written meanwhile (this tab or another).
	const gate = canRestore({
		localEmpty: await db.isEmpty(userId),
		localDataVersion: await db.getDataVersion(userId),
		backupDataVersion: meta.dataVersion
	});
	if (!gate.ok) throw new Error('local-newer'); // mapped to the localized refusal by the card

	const files: DbFile[] = [];
	for (const fi of (manifest.files ?? []) as FileIndexEntry[]) {
		const entry = entries.get(`files/${fi.studyId}.${fi.kind}`);
		// STRICT like the online-restore sibling: a manifest entry without its zip entry
		// means a truncated/corrupt archive — silently skipping would "successfully"
		// import patients whose scans are gone. Abort BEFORE importUser touches local data.
		if (!entry) invalid(`missing file entry for study ${fi.studyId} (${fi.kind})`);
		files.push({
			studyId: fi.studyId,
			kind: fi.kind,
			user: userId,
			// Wrap (cheap, by reference) to attach the manifest's mime type.
			blob: new Blob([entry], { type: fi.mime || 'application/octet-stream' }),
			filename: fi.filename || 'upload.bin',
			mime: fi.mime || 'application/octet-stream'
		});
	}

	const snap: UserSnapshot = {
		patients: (manifest.patients ?? []) as DbPatient[],
		studies: (manifest.studies ?? []) as DbStudy[],
		inferences: (manifest.inferences ?? []) as DbInference[],
		studyReportState: (manifest.studyReportState ?? []) as UserSnapshot['studyReportState'],
		cbctReportState: (manifest.cbctReportState ?? []) as UserSnapshot['cbctReportState'],
		iosState: (manifest.iosState ?? []) as UserSnapshot['iosState'],
		files,
		// Deletion knowledge rides the snapshot (importUser merges it in additively) — a
		// replace onto a fresh device preserves what was deliberately deleted at the source.
		tombstones: (manifest.tombstones ?? []) as DbDeletion[],
		dataVersion: meta.dataVersion
	};
	await db.importUser(userId, snap);
	return { dataVersion: meta.dataVersion };
}

// --- diff-then-merge (zip side) ------------------------------------------------------

/** Map a validated manifest + meta into the planner's blob-free backup view. */
function backupLiteFromManifest(
	manifest: Record<string, unknown>,
	meta: ZipMeta
): BackupManifestLite {
	return {
		patients: (manifest.patients ?? []) as DbPatient[],
		studies: (manifest.studies ?? []) as DbStudy[],
		inferences: ((manifest.inferences ?? []) as DbInference[]).map((r) => ({
			studyId: r.studyId
		})),
		files: ((manifest.files ?? []) as FileIndexEntry[]).map((f) => ({
			studyId: f.studyId,
			kind: f.kind,
			filename: f.filename,
			mime: f.mime,
			size: f.size
		})),
		studyReportState: (manifest.studyReportState ?? []) as BackupManifestLite['studyReportState'],
		cbctReportState: (manifest.cbctReportState ?? []) as BackupManifestLite['cbctReportState'],
		iosState: (manifest.iosState ?? []) as BackupManifestLite['iosState'],
		dataVersion: meta.dataVersion
	};
}

/** Dry-run plan for the merge PREVIEW dialog — light read (the manifest sits at the head
 *  of the archive, so the scan stops long before the blobs), no lock, no writes. The
 *  apply step re-plans inside the lock; this plan is advisory display only. */
export async function planMergeFromZip(
	userId: string,
	zipBlob: Blob,
	db: LocalDb = localDb
): Promise<MergePlan> {
	const entries = await readZipEntries(zipBlob, 'manifest.json');
	const { meta, manifest } = await parseZipManifest(entries);
	const [local, tombstones] = await Promise.all([
		db.exportUserLite(userId),
		db.getTombstones(userId)
	]);
	return planMerge({ local, backup: backupLiteFromManifest(manifest, meta), tombstones });
}

export interface ZipMergeResult {
	/** The plan that was actually APPLIED (post strip, re-planned inside the lock). */
	plan: MergePlan;
	applied: boolean;
	orphansSkipped: number;
}

/** Diff-then-merge a backup zip into the live local data. Non-destructive: only the
 *  plan's adds (and, with includeUpdates, its LWW updates) are written; nothing local is
 *  deleted. Holds the shared backup lock for plan→assemble→apply (the preview's plan was
 *  advisory; the authoritative plan is computed HERE against fresh local state). STRICT
 *  like importFromZip: a planned blob missing from the archive (truncated zip) aborts
 *  before any write — unless `salvage` (the damaged-archive recovery path, offered only
 *  after the strict path failed): then the read is tolerant and the studies whose
 *  binaries did not survive are excluded from the plan up front. */
export async function mergeFromZip(
	userId: string,
	zipBlob: Blob,
	opts: { includeUpdates: boolean; salvage?: boolean },
	db: LocalDb = localDb
): Promise<ZipMergeResult> {
	return withBackupLock(async () => {
		const entries = opts.salvage
			? (await readZipEntriesCore(zipBlob, { tolerant: true })).entries
			: await readZipEntries(zipBlob);
		const { meta, manifest } = await parseZipManifest(entries);
		const [local, tombstones] = await Promise.all([
			db.exportUserLite(userId),
			db.getTombstones(userId)
		]);
		let backup = backupLiteFromManifest(manifest, meta);
		if (opts.salvage) backup = dropDamagedStudies(backup, damagedStudySet(manifest, entries));
		let plan = planMerge({ local, backup, tombstones });
		if (!opts.includeUpdates) plan = stripUpdates(plan);

		const files: DbFile[] = [];
		let neededBytes = 0;
		for (const f of [...plan.filesToFetch.add, ...plan.filesToFetch.update]) {
			const entry = entries.get(`files/${f.studyId}.${f.kind}`);
			// Strict in BOTH modes — in salvage the damaged studies were already excluded
			// from the plan, so a missing planned entry still means something is wrong.
			if (!entry) invalid(`missing file entry for study ${f.studyId} (${f.kind})`);
			neededBytes += entry.size;
			files.push({
				studyId: f.studyId,
				kind: f.kind,
				user: userId,
				blob: new Blob([entry], { type: f.mime || 'application/octet-stream' }),
				filename: f.filename || 'upload.bin',
				mime: f.mime || 'application/octet-stream'
			});
		}
		await ensureStorageFor(neededBytes);

		const wantInference = new Set(
			[...plan.inferences.add, ...plan.inferences.update].map((r) => r.studyId)
		);
		const inferences = ((manifest.inferences ?? []) as DbInference[]).filter((r) =>
			wantInference.has(r.studyId)
		);

		const { applied, orphansSkipped } = await db.mergeUser(userId, plan, { inferences, files });
		return { plan, applied, orphansSkipped };
	});
}

// --- damaged-archive salvage (merge-only, offered when the strict path failed) ---------

/** Studies whose listed binaries did not fully survive the archive. */
function damagedStudySet(manifest: Record<string, unknown>, entries: Map<string, Blob>) {
	const dead = new Set<string>();
	for (const fi of (manifest.files ?? []) as FileIndexEntry[]) {
		if (!entries.has(`files/${fi.studyId}.${fi.kind}`)) dead.add(fi.studyId);
	}
	return dead;
}

/** Remove the damaged studies (and their dependents) from the backup view, plus any
 *  patient ALL of whose manifest studies died — re-adding such a patient would surface
 *  an inexplicable empty record (a patient with no studies at all is kept: legit data). */
function dropDamagedStudies(lite: BackupManifestLite, dead: Set<string>): BackupManifestLite {
	if (dead.size === 0) return lite;
	const hadStudies = new Set(lite.studies.map((s) => s.patient));
	const liveStudies = lite.studies.filter((s) => !dead.has(s.id));
	const hasLive = new Set(liveStudies.map((s) => s.patient));
	return {
		...lite,
		patients: lite.patients.filter((p) => !hadStudies.has(p.id) || hasLive.has(p.id)),
		studies: liveStudies,
		inferences: lite.inferences.filter((r) => !dead.has(r.studyId)),
		files: lite.files.filter((f) => !dead.has(f.studyId)),
		studyReportState: lite.studyReportState.filter((r) => !dead.has(r.study)),
		cbctReportState: lite.cbctReportState.filter((r) => !dead.has(r.study)),
		iosState: lite.iosState.filter((r) => !dead.has(r.study))
	};
}

export interface SalvageInfo {
	/** The casualty list for the dialog — patient name + modality per lost study. */
	lost: { name: string; modality: string }[];
	totalStudies: number;
}

/** True for errors that mean "the archive itself is broken" — the trigger for offering
 *  the salvage path. A non-zip (renamed garbage) and a wrong schemaVersion are NOT
 *  salvage candidates. */
export function isDamagedArchiveError(e: unknown): boolean {
	const msg = e instanceof Error ? e.message : '';
	return msg.startsWith('invalid backup file') && !msg.includes('not a zip archive');
}

/** Dry-run salvage plan for a DAMAGED archive (the strict preview/apply threw): tolerant
 *  full read, then a merge plan over only the studies whose binaries fully survived.
 *  Throws the usual errors when even meta.json/manifest.json are unrecoverable — then
 *  there is genuinely nothing to salvage. Merge-only by design: Replace must never wipe
 *  good local data on the strength of a damaged archive. */
export async function planSalvageFromZip(
	userId: string,
	zipBlob: Blob,
	db: LocalDb = localDb
): Promise<{ plan: MergePlan; salvage: SalvageInfo }> {
	const { entries } = await readZipEntriesCore(zipBlob, { tolerant: true });
	const { meta, manifest } = await parseZipManifest(entries);
	const lite = backupLiteFromManifest(manifest, meta);
	const dead = damagedStudySet(manifest, entries);
	const patientsById = new Map(lite.patients.map((p) => [p.id, p]));
	const lost = lite.studies
		.filter((s) => dead.has(s.id))
		.map((s) => ({
			name: patientsById.get(s.patient)?.name ?? s.patient,
			modality: s.modality
		}));
	const [local, tombstones] = await Promise.all([
		db.exportUserLite(userId),
		db.getTombstones(userId)
	]);
	const plan = planMerge({ local, backup: dropDamagedStudies(lite, dead), tombstones });
	return { plan, salvage: { lost, totalStudies: lite.studies.length } };
}
