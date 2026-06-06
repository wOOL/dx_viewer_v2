// Local-first data layer (Dexie/IndexedDB). The single source of truth for all patient
// data: patients, studies (+ inference + binary files), and the per-study report/markup
// state. PocketBase only ever sees this data during an explicit Labs backup (see
// backup/). Every method is user-scoped (mirrors PB's `user = @request.auth.id` rules)
// and every WRITE bumps the per-user dataVersion in one transaction, so the unified
// restore/import gate can compare a backup's age against the live local data.
//
// Construction is cheap and does NOT open IndexedDB (Dexie opens lazily on first query),
// so the singleton is safe to import in SSR/prerender — callers still gate on `browser`.

import Dexie, { type Table } from 'dexie';
import { genId } from './ids';
import { announceDataChanged } from './changes';
import { stampMs } from '$lib/backup/merge';
import type {
	DbPatient,
	DbStudy,
	DbInference,
	DbFile,
	DbStudyReportState,
	DbCbctReportState,
	DbIosState,
	DbDeletion,
	DbMeta,
	FileKind,
	BackupPointer,
	UserSnapshot
} from './schema';

const DV_PREFIX = 'dataVersion:';
const BACKUP_PREFIX = 'backup:';

function nowIso(): string {
	return new Date().toISOString();
}

/** Normalise a PURE-JSON row to a plain, structured-cloneable object before it reaches
 *  IndexedDB. Components persist Svelte 5 `$state` arrays/objects straight through the
 *  write methods, and a `$state` value is a JS Proxy — IndexedDB's structured-clone
 *  algorithm throws `DataCloneError: … could not be cloned` on a Proxy, so the write
 *  would silently fail (the IOS/CBCT markups + hidden-mesh state never persisted). A JSON
 *  round-trip reads through the proxy and yields a plain object. This is the single write
 *  choke point for every JSON store; it is deliberately NOT used for the `files` store,
 *  whose Blob payload JSON cannot represent (Blobs structured-clone fine on their own). */
function toPlain<T>(row: T): T {
	return JSON.parse(JSON.stringify(row)) as T;
}

export class LocalDb {
	private db: Dexie & {
		patients: Table<DbPatient, string>;
		studies: Table<DbStudy, string>;
		inferences: Table<DbInference, string>;
		files: Table<DbFile, [string, string]>;
		studyReportState: Table<DbStudyReportState, string>;
		cbctReportState: Table<DbCbctReportState, string>;
		iosState: Table<DbIosState, string>;
		deletions: Table<DbDeletion, [string, string]>;
		meta: Table<DbMeta, string>;
	};

	constructor(name = 'dxv-local') {
		const db = new Dexie(name) as LocalDb['db'];
		db.version(1).stores({
			patients: 'id, user',
			studies: 'id, user, patient, [user+patient]',
			inferences: 'studyId, user',
			files: '[studyId+kind], studyId, user',
			studyReportState: 'id, &[user+study], study, user',
			cbctReportState: 'id, &[user+study], study, user',
			iosState: 'id, &[user+study], study, user',
			meta: 'key'
		});
		// v2: delete tombstones for the diff-then-merge restore (see schema.ts DbDeletion).
		// Additive — Dexie carries the v1 stores forward untouched; existing databases
		// upgrade in place on first open, no data migration.
		db.version(2).stores({
			deletions: '[table+id], user, deletedAt'
		});
		this.db = db;
	}

	/** Close + delete the entire database (test cleanup / hard reset). */
	async destroy(): Promise<void> {
		await this.db.delete();
	}

	// --- dataVersion / backup pointer ----------------------------------------

	async getDataVersion(user: string): Promise<number> {
		const rec = await this.db.meta.get(DV_PREFIX + user);
		return typeof rec?.value === 'number' ? rec.value : 0;
	}

	/** Bump within an existing rw transaction (must include the `meta` table). Monotonic:
	 *  never goes backwards even if the clock does. Also announces the change to other
	 *  tabs — every row write funnels through here, making it the cross-tab-signal choke
	 *  point. (Posting from inside the tx means an ABORTED tx can emit a spurious signal;
	 *  receivers only refresh, so that is harmless.) */
	private async bumpWithinTx(user: string): Promise<number> {
		const cur = await this.db.meta.get(DV_PREFIX + user);
		const prev = typeof cur?.value === 'number' ? cur.value : 0;
		const next = Math.max(Date.now(), prev + 1);
		await this.db.meta.put({ key: DV_PREFIX + user, value: next });
		announceDataChanged();
		return next;
	}

	/** Public bump (its own transaction) — used by restore/import after a bulk write to
	 *  stamp the local data with the snapshot's version. */
	async setDataVersion(user: string, value: number): Promise<void> {
		await this.db.meta.put({ key: DV_PREFIX + user, value });
		announceDataChanged();
	}

	async getBackupPointer(user: string): Promise<BackupPointer | null> {
		const rec = await this.db.meta.get(BACKUP_PREFIX + user);
		const v = rec?.value as BackupPointer | undefined;
		return v && typeof v.dataVersion === 'number' ? v : null;
	}

	async setBackupPointer(user: string, ptr: BackupPointer): Promise<void> {
		await this.db.meta.put({ key: BACKUP_PREFIX + user, value: ptr });
	}

	/** True when the user has NO patients locally — the "local empty" half of the gate. */
	async isEmpty(user: string): Promise<boolean> {
		const n = await this.db.patients.where('user').equals(user).count();
		return n === 0;
	}

	// --- patients -------------------------------------------------------------

	async getPatients(user: string): Promise<DbPatient[]> {
		const rows = await this.db.patients.where('user').equals(user).toArray();
		// Mirror PB `sort: '-created'` (newest first) so the store's denormalization +
		// the dashboard "recent" ordering match the previous server-backed behaviour.
		return rows.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
	}

	async getPatient(user: string, id: string): Promise<DbPatient | undefined> {
		const p = await this.db.patients.get(id);
		return p && p.user === user ? p : undefined;
	}

	/** Create-or-update a patient. Stamps created (on first write) + updated, bumps the
	 *  dataVersion, and returns the stored row. */
	async putPatient(row: DbPatient): Promise<DbPatient> {
		return this.db.transaction('rw', this.db.patients, this.db.meta, async () => {
			const existing = await this.db.patients.get(row.id);
			const stored: DbPatient = {
				...row,
				// `||` (not `??`): a blank created from a caller building a fresh row should
				// fall back to now, not persist as ''.
				created: existing?.created || row.created || nowIso(),
				updated: nowIso()
			};
			await this.db.patients.put(toPlain(stored));
			await this.bumpWithinTx(row.user);
			return stored;
		});
	}

	/** Delete a patient and EVERYTHING under it (studies, inference, files, report state).
	 *  Mirrors PB's cascadeDelete on the studies→patient relation. Tombstones the patient
	 *  AND every cascaded study in the same tx (a crash between delete and tombstone must
	 *  not leave a silently-resurrectable row) — the merge plan needs the study tombstones
	 *  too, or a backup could re-add a deleted patient's studies under a duplicate person. */
	async deletePatient(user: string, id: string): Promise<void> {
		await this.db.transaction(
			'rw',
			[
				this.db.patients,
				this.db.studies,
				this.db.inferences,
				this.db.files,
				this.db.studyReportState,
				this.db.cbctReportState,
				this.db.iosState,
				this.db.deletions,
				this.db.meta
			],
			async () => {
				const studyIds = (
					await this.db.studies.where('[user+patient]').equals([user, id]).toArray()
				).map((s) => s.id);
				for (const sid of studyIds) await this.cascadeDeleteStudyWithinTx(sid);
				await this.db.patients.delete(id);
				const deletedAt = nowIso();
				await this.db.deletions.bulkPut([
					{ table: 'patients', id, user, deletedAt },
					...studyIds.map((sid): DbDeletion => ({ table: 'studies', id: sid, user, deletedAt }))
				]);
				await this.bumpWithinTx(user);
			}
		);
	}

	// --- studies --------------------------------------------------------------

	async getStudies(user: string): Promise<DbStudy[]> {
		return this.db.studies.where('user').equals(user).toArray();
	}

	async getStudiesByPatient(user: string, patient: string): Promise<DbStudy[]> {
		return this.db.studies.where('[user+patient]').equals([user, patient]).toArray();
	}

	async getStudy(user: string, id: string): Promise<DbStudy | undefined> {
		const s = await this.db.studies.get(id);
		return s && s.user === user ? s : undefined;
	}

	async putStudy(row: DbStudy): Promise<DbStudy> {
		return this.db.transaction('rw', this.db.studies, this.db.meta, async () => {
			const existing = await this.db.studies.get(row.id);
			const stored: DbStudy = {
				...row,
				created: existing?.created || row.created || nowIso(),
				updated: nowIso()
			};
			await this.db.studies.put(toPlain(stored));
			await this.bumpWithinTx(row.user);
			return stored;
		});
	}

	/** Create a study + its optional inference + optional binary file in ONE transaction:
	 *  a failed file write (quota, clone error) aborts the whole create, so an upload
	 *  failure can't leave an image-less orphan study behind (the store previously issued
	 *  three separate writes — the study survived a failed putFile). */
	async createStudy(
		row: DbStudy,
		extras?: { inference?: DbInference; file?: DbFile }
	): Promise<DbStudy> {
		return this.db.transaction(
			'rw',
			[this.db.studies, this.db.patients, this.db.inferences, this.db.files, this.db.meta],
			async () => {
				// Orphan guard, parent edition: the patient can vanish between the upload
				// flow's findOrCreatePatient and this write (deleted in another tab).
				// Creating the study anyway would leave an INVISIBLE orphan (refresh
				// drops studies whose patient is missing) that only ever resurfaces as
				// backup prune noise. Throw — the upload flow surfaces a save error.
				const parent = await this.db.patients.get(row.patient);
				if (!parent || parent.user !== row.user) {
					throw new Error('createStudy: patient no longer exists');
				}
				const existing = await this.db.studies.get(row.id);
				const stored: DbStudy = {
					...row,
					created: existing?.created || row.created || nowIso(),
					updated: nowIso()
				};
				await this.db.studies.put(toPlain(stored));
				if (extras?.inference) await this.db.inferences.put(toPlain(extras.inference));
				// No toPlain for the file row — its Blob payload structured-clones fine but
				// JSON cannot represent it (same rule as putFile).
				if (extras?.file) await this.db.files.put(extras.file);
				await this.bumpWithinTx(row.user);
				return stored;
			}
		);
	}

	/** Patch a subset of study columns (e.g. fmxSlot, findingCounts) without re-supplying
	 *  the whole row; an EMPTY patch is a pure `updated`-stamp bump (used by the
	 *  inference/edit writers so the stamp works as a projection cache key). Returns the
	 *  stored row, or undefined when the study isn't owned by `user` (no-op). */
	async patchStudy(
		user: string,
		id: string,
		patch: Partial<DbStudy>
	): Promise<DbStudy | undefined> {
		return this.db.transaction('rw', this.db.studies, this.db.meta, async () => {
			const existing = await this.db.studies.get(id);
			if (!existing || existing.user !== user) return undefined;
			const stored: DbStudy = { ...existing, ...patch, id, user, updated: nowIso() };
			await this.db.studies.put(toPlain(stored));
			await this.bumpWithinTx(user);
			return stored;
		});
	}

	private async cascadeDeleteStudyWithinTx(studyId: string): Promise<void> {
		await this.db.studies.delete(studyId);
		await this.db.inferences.delete(studyId);
		await this.db.files.where('studyId').equals(studyId).delete();
		await this.db.studyReportState.where('study').equals(studyId).delete();
		await this.db.cbctReportState.where('study').equals(studyId).delete();
		await this.db.iosState.where('study').equals(studyId).delete();
	}

	async deleteStudy(user: string, id: string): Promise<void> {
		await this.db.transaction(
			'rw',
			[
				this.db.studies,
				this.db.inferences,
				this.db.files,
				this.db.studyReportState,
				this.db.cbctReportState,
				this.db.iosState,
				this.db.deletions,
				this.db.meta
			],
			async () => {
				const s = await this.db.studies.get(id);
				if (!s || s.user !== user) return;
				await this.cascadeDeleteStudyWithinTx(id);
				// Tombstone in the same tx — see deletePatient. (reassignStudy is a MOVE,
				// not a delete: no tombstone there.)
				await this.db.deletions.put({ table: 'studies', id, user, deletedAt: nowIso() });
				await this.bumpWithinTx(user);
			}
		);
	}

	/** Move a study onto a different patient (quick-scan merge). Throws when the TARGET
	 *  patient no longer exists (deleted in another tab mid-merge) — silently patching
	 *  would orphan the study; mergePatientInto's partial-move error path surfaces it. */
	async reassignStudy(user: string, studyId: string, toPatient: string): Promise<void> {
		await this.db.transaction('rw', [this.db.studies, this.db.patients, this.db.meta], async () => {
			const target = await this.db.patients.get(toPatient);
			if (!target || target.user !== user) {
				throw new Error('reassignStudy: target patient no longer exists');
			}
			const existing = await this.db.studies.get(studyId);
			if (!existing || existing.user !== user) return;
			await this.db.studies.put(toPlain({ ...existing, patient: toPatient, updated: nowIso() }));
			await this.bumpWithinTx(user);
		});
	}

	// --- inference (lazy heavy JSON) -----------------------------------------

	async getInference(studyId: string): Promise<DbInference | undefined> {
		return this.db.inferences.get(studyId);
	}

	async getInferencesForStudies(studyIds: string[]): Promise<DbInference[]> {
		if (studyIds.length === 0) return [];
		return this.db.inferences.where('studyId').anyOf(studyIds).toArray();
	}

	/** No-ops when the study row no longer exists: IndexedDB has no FK enforcement, so a
	 *  write landing after its study was deleted (another tab, a flushed debounced save)
	 *  would otherwise RESURRECT the study as an orphan row — which then breaks the next
	 *  online backup (PB validates relations on create). Same guard on the state upserts. */
	async putInference(row: DbInference): Promise<void> {
		await this.db.transaction(
			'rw',
			[this.db.inferences, this.db.studies, this.db.meta],
			async () => {
				const study = await this.db.studies.get(row.studyId);
				if (!study || study.user !== row.user) return;
				await this.db.inferences.put(toPlain(row));
				await this.bumpWithinTx(row.user);
			}
		);
	}

	// --- files (binary blobs) -------------------------------------------------

	async getFile(studyId: string, kind: FileKind): Promise<DbFile | undefined> {
		return this.db.files.get([studyId, kind]);
	}

	async putFile(row: DbFile): Promise<void> {
		await this.db.transaction('rw', [this.db.files, this.db.studies, this.db.meta], async () => {
			// Orphan guard — see putInference (a re-segmentation save landing after the
			// study was deleted in another tab would resurrect an orphan file row).
			const study = await this.db.studies.get(row.studyId);
			if (!study || study.user !== row.user) return;
			await this.db.files.put(row);
			await this.bumpWithinTx(row.user);
		});
	}

	// --- per-study report / markup state (mirrors the 3 PB state collections) -
	// Each is unique on [user+study]; upsert finds the existing row (reusing its id) so
	// a re-save never trips the unique index (the local equivalent of the PB
	// create-then-recover-on-conflict pattern).

	async getStudyReport(user: string, study: string): Promise<DbStudyReportState | undefined> {
		return this.db.studyReportState.where('[user+study]').equals([user, study]).first();
	}

	async upsertStudyReport(
		user: string,
		study: string,
		fields: Pick<DbStudyReportState, 'reportText' | 'status'>
	): Promise<DbStudyReportState | null> {
		return this.db.transaction(
			'rw',
			[this.db.studyReportState, this.db.studies, this.db.meta],
			async () => {
				// Orphan guard — see putInference.
				const s = await this.db.studies.get(study);
				if (!s || s.user !== user) return null;
				const existing = await this.db.studyReportState
					.where('[user+study]')
					.equals([user, study])
					.first();
				const row: DbStudyReportState = {
					id: existing?.id ?? genId(),
					user,
					study,
					reportText: fields.reportText ?? '',
					status: fields.status ?? '',
					created: existing?.created ?? nowIso(),
					updated: nowIso()
				};
				await this.db.studyReportState.put(toPlain(row));
				await this.bumpWithinTx(user);
				return row;
			}
		);
	}

	async getCbctReport(user: string, study: string): Promise<DbCbctReportState | undefined> {
		return this.db.cbctReportState.where('[user+study]').equals([user, study]).first();
	}

	async upsertCbctReport(
		user: string,
		study: string,
		fields: Partial<
			Pick<
				DbCbctReportState,
				'signedBy' | 'signedAt' | 'approvedTeeth' | 'comments' | 'markups' | 'hiddenMeshes'
			>
		>
	): Promise<DbCbctReportState | null> {
		return this.db.transaction(
			'rw',
			[this.db.cbctReportState, this.db.studies, this.db.meta],
			async () => {
				// Orphan guard — see putInference.
				const s = await this.db.studies.get(study);
				if (!s || s.user !== user) return null;
				const existing = await this.db.cbctReportState
					.where('[user+study]')
					.equals([user, study])
					.first();
				const row: DbCbctReportState = {
					id: existing?.id ?? genId(),
					user,
					study,
					signedBy: fields.signedBy ?? existing?.signedBy ?? '',
					signedAt: fields.signedAt !== undefined ? fields.signedAt : (existing?.signedAt ?? null),
					approvedTeeth: fields.approvedTeeth ?? existing?.approvedTeeth ?? [],
					comments: fields.comments ?? existing?.comments ?? {},
					markups: fields.markups !== undefined ? fields.markups : existing?.markups,
					hiddenMeshes: fields.hiddenMeshes ?? existing?.hiddenMeshes ?? [],
					created: existing?.created ?? nowIso(),
					updated: nowIso()
				};
				await this.db.cbctReportState.put(toPlain(row));
				await this.bumpWithinTx(user);
				return row;
			}
		);
	}

	async getIosState(user: string, study: string): Promise<DbIosState | undefined> {
		return this.db.iosState.where('[user+study]').equals([user, study]).first();
	}

	async upsertIosState(
		user: string,
		study: string,
		fields: Partial<Pick<DbIosState, 'measures' | 'hiddenMeshes'>>
	): Promise<DbIosState | null> {
		return this.db.transaction(
			'rw',
			[this.db.iosState, this.db.studies, this.db.meta],
			async () => {
				// Orphan guard — see putInference.
				const s = await this.db.studies.get(study);
				if (!s || s.user !== user) return null;
				const existing = await this.db.iosState.where('[user+study]').equals([user, study]).first();
				const row: DbIosState = {
					id: existing?.id ?? genId(),
					user,
					study,
					measures: fields.measures !== undefined ? fields.measures : existing?.measures,
					hiddenMeshes: fields.hiddenMeshes ?? existing?.hiddenMeshes ?? [],
					created: existing?.created ?? nowIso(),
					updated: nowIso()
				};
				await this.db.iosState.put(toPlain(row));
				await this.bumpWithinTx(user);
				return row;
			}
		);
	}

	// --- tombstones ------------------------------------------------------------

	/** The user's delete tombstones — input to the merge plan (see backup/merge.ts). */
	async getTombstones(user: string): Promise<DbDeletion[]> {
		return this.db.deletions.where('user').equals(user).toArray();
	}

	// --- snapshot (export / backup / restore / import) ------------------------

	/** Blob-free local projection for the merge PLANNER (backup/merge.ts) — no inference
	 *  payloads, no file blobs, so planning a diff over a large dataset stays cheap. */
	async exportUserLite(user: string): Promise<import('$lib/backup/merge').LocalSnapshotLite> {
		const [patients, studies, studyReportState, cbctReportState, iosState, dataVersion] =
			await Promise.all([
				this.db.patients.where('user').equals(user).toArray(),
				this.db.studies.where('user').equals(user).toArray(),
				this.db.studyReportState.where('user').equals(user).toArray(),
				this.db.cbctReportState.where('user').equals(user).toArray(),
				this.db.iosState.where('user').equals(user).toArray(),
				this.getDataVersion(user)
			]);
		return { patients, studies, studyReportState, cbctReportState, iosState, dataVersion };
	}

	/** Full per-user snapshot — the unit of export + online backup. Includes binary file
	 *  blobs, so the caller should stream/zip them rather than hold many in memory. */
	async exportUser(user: string): Promise<UserSnapshot> {
		const [
			patients,
			studies,
			inferences,
			studyReportState,
			cbctReportState,
			iosState,
			tombstones,
			dataVersion
		] = await Promise.all([
			this.db.patients.where('user').equals(user).toArray(),
			this.db.studies.where('user').equals(user).toArray(),
			this.db.inferences.where('user').equals(user).toArray(),
			this.db.studyReportState.where('user').equals(user).toArray(),
			this.db.cbctReportState.where('user').equals(user).toArray(),
			this.db.iosState.where('user').equals(user).toArray(),
			this.getTombstones(user),
			this.getDataVersion(user)
		]);
		const files = await this.db.files.where('user').equals(user).toArray();
		return {
			patients,
			studies,
			inferences,
			studyReportState,
			cbctReportState,
			iosState,
			files,
			tombstones,
			dataVersion
		};
	}

	/** Replace ALL of a user's local data with a snapshot (restore / import). Runs in one
	 *  transaction and stamps the local dataVersion with the snapshot's version so a
	 *  subsequent restore/import gate compares correctly. */
	async importUser(user: string, snap: UserSnapshot): Promise<void> {
		await this.db.transaction(
			'rw',
			[
				this.db.patients,
				this.db.studies,
				this.db.inferences,
				this.db.files,
				this.db.studyReportState,
				this.db.cbctReportState,
				this.db.iosState,
				this.db.deletions,
				this.db.meta
			],
			async () => {
				await this.wipeUserWithinTx(user);
				// Force every row's owner to `user` so an imported file can't smuggle in
				// another account's id, and so rows are reachable by the user-scoped queries.
				const stamp = <T extends { user: string }>(rows: T[]) => rows.map((r) => ({ ...r, user }));
				await this.db.patients.bulkPut(stamp(snap.patients));
				await this.db.studies.bulkPut(stamp(snap.studies));
				await this.db.inferences.bulkPut(stamp(snap.inferences));
				await this.db.files.bulkPut(stamp(snap.files));
				await this.db.studyReportState.bulkPut(stamp(snap.studyReportState));
				await this.db.cbctReportState.bulkPut(stamp(snap.cbctReportState));
				await this.db.iosState.bulkPut(stamp(snap.iosState));
				// Merge IN the snapshot's deletion knowledge (a zip moved to a fresh device
				// preserves what was deliberately deleted at the source) — additively, and
				// never letting an OLDER imported tombstone roll back a newer local one.
				// Local tombstones are NOT wiped by a replace: every old tombstone either
				// refers to a row the import resurrected (then it is moot — merge suppression
				// only applies to backup-ONLY rows) or to a still-dead row (still correct).
				for (const t of snap.tombstones ?? []) {
					const existing = await this.db.deletions.get([t.table, t.id]);
					if (!existing || existing.deletedAt < t.deletedAt) {
						await this.db.deletions.put({ ...t, user });
					}
				}
				await this.db.meta.put({ key: DV_PREFIX + user, value: snap.dataVersion });
			}
		);
		// 'replace': other tabs must hardReload — their cached object URLs point at the
		// PRE-import blobs (see DataChangeKind).
		announceDataChanged('replace');
	}

	/** Apply a merge plan (diff-then-merge restore — see backup/merge.ts). The
	 *  non-destructive sibling of importUser: NO wipe, only the plan's adds/updates are
	 *  bulkPut — with their ORIGINAL stamps (never the re-stamping put*() wrappers), so a
	 *  later merge/gate compares honestly. The plan is advisory, the tx is authoritative:
	 *  parents are re-validated in-tx (a cross-tab delete can land between plan and apply,
	 *  and the blob downloads happen OUTSIDE this tx), updates whose local row vanished are
	 *  skipped (honor the delete — re-putting would resurrect it), and child rows of a
	 *  skipped study are skipped with it. dataVersion lands strictly PAST both sides, so
	 *  the gate correctly refuses a destructive replace from the same old backup. */
	async mergeUser(
		user: string,
		plan: import('$lib/backup/merge').MergePlan,
		fetched: { inferences: DbInference[]; files: DbFile[] }
	): Promise<{ applied: boolean; orphansSkipped: number }> {
		const all = <T>(c: { add: T[]; update: T[] }) => [...c.add, ...c.update];
		if (
			all(plan.patients).length +
				all(plan.studies).length +
				all(plan.studyReportState).length +
				all(plan.cbctReportState).length +
				all(plan.iosState).length +
				fetched.inferences.length +
				fetched.files.length ===
			0
		) {
			// Nothing to write — no dataVersion bump, no broadcast ("already up to date").
			return { applied: false, orphansSkipped: 0 };
		}

		let orphansSkipped = 0;
		await this.db.transaction(
			'rw',
			[
				this.db.patients,
				this.db.studies,
				this.db.inferences,
				this.db.files,
				this.db.studyReportState,
				this.db.cbctReportState,
				this.db.iosState,
				this.db.meta
			],
			async () => {
				const stamp = <T extends { user: string }>(rows: T[]) => rows.map((r) => ({ ...r, user }));

				// Patients: adds unconditional; an update whose local row vanished mid-flight is
				// SKIPPED (it was just deleted — re-putting would undo the delete), and so is one
				// whose local row was RE-STAMPED at least as new (the plan's LWW verdict is stale:
				// an ordinary write — rename, etc. — landed during the plan→download window, which
				// the backup lock deliberately does not block).
				await this.db.patients.bulkPut(stamp(plan.patients.add));
				for (const p of plan.patients.update) {
					const existing = await this.db.patients.get(p.id);
					if (
						!existing ||
						existing.user !== user ||
						stampMs(existing.updated) >= stampMs(p.updated)
					) {
						orphansSkipped++;
						continue;
					}
					await this.db.patients.put({ ...p, user });
				}

				// Studies: parent must exist NOW (post patient-puts), and the same mid-flight LWW
				// re-check as patients — a study re-segmented/edited during the download window
				// keeps its WHOLE unit (the skip suppresses the fetched inference/blobs below,
				// else the older backup blob would still overwrite the fresh one). Track skips so
				// the unit children (inference/files/state) are skipped with it.
				const skippedStudies = new Set<string>();
				const writtenStudies = new Set<string>();
				for (const s of plan.studies.add) {
					const parent = await this.db.patients.get(s.patient);
					if (!parent || parent.user !== user) {
						skippedStudies.add(s.id);
						orphansSkipped++;
						continue;
					}
					await this.db.studies.put({ ...s, user });
					writtenStudies.add(s.id);
				}
				for (const s of plan.studies.update) {
					const existing = await this.db.studies.get(s.id);
					const parent = await this.db.patients.get(s.patient);
					if (
						!existing ||
						existing.user !== user ||
						!parent ||
						parent.user !== user ||
						stampMs(existing.updated) >= stampMs(s.updated)
					) {
						skippedStudies.add(s.id);
						orphansSkipped++;
						continue;
					}
					await this.db.studies.put({ ...s, user });
					writtenStudies.add(s.id);
				}

				// Unit children + state rows: their parent study must have been written by
				// this merge or already exist locally (and not have been skipped above).
				const studyOk = async (studyId: string): Promise<boolean> => {
					if (skippedStudies.has(studyId)) return false;
					if (writtenStudies.has(studyId)) return true;
					const st = await this.db.studies.get(studyId);
					return !!st && st.user === user;
				};
				for (const inf of fetched.inferences) {
					if (!(await studyOk(inf.studyId))) {
						orphansSkipped++;
						continue;
					}
					await this.db.inferences.put({ ...inf, user });
				}
				for (const f of fetched.files) {
					if (!(await studyOk(f.studyId))) {
						orphansSkipped++;
						continue;
					}
					await this.db.files.put({ ...f, user });
				}
				// State rows. A FOLLOW row (cbct/ios state riding a unit this merge actually
				// flipped) overrides LWW — consistency with the freshly-written segmentation
				// outranks stamps. Everything else re-checks LWW against the row that is in
				// the tx NOW (a markup/report save can land mid-flight, same as above). The
				// [user+study] IDENTITY re-key is UNCONDITIONAL — even a follow row must adopt
				// the id of a row created after planning (a viewer save during the download
				// window), or the &[user+study] unique index throws and aborts the whole merge.
				const flipped = new Set(plan.flippedStudies ?? []);
				const applyState = async <
					T extends { id: string; user: string; study: string; updated: string }
				>(
					table: Table<T, string>,
					changes: { add: T[]; update: T[] },
					followsUnit: boolean
				) => {
					for (const r of all(changes)) {
						if (!(await studyOk(r.study))) {
							orphansSkipped++;
							continue;
						}
						let row = r;
						const follows = followsUnit && flipped.has(r.study) && writtenStudies.has(r.study);
						const cur = await table.where('[user+study]').equals([user, r.study]).first();
						if (!follows && cur && stampMs(cur.updated) >= stampMs(r.updated)) {
							orphansSkipped++;
							continue;
						}
						if (cur && cur.id !== r.id) row = { ...r, id: cur.id };
						await table.put({ ...row, user });
					}
				};
				await applyState(this.db.studyReportState, plan.studyReportState, false);
				await applyState(this.db.cbctReportState, plan.cbctReportState, true);
				await applyState(this.db.iosState, plan.iosState, true);

				// Strictly past BOTH sides — and monotonic like bumpWithinTx.
				const cur = await this.db.meta.get(DV_PREFIX + user);
				const prev = typeof cur?.value === 'number' ? cur.value : 0;
				const next = Math.max(Date.now(), prev + 1, plan.backupDataVersion + 1);
				await this.db.meta.put({ key: DV_PREFIX + user, value: next });
			}
		);
		// 'replace', like importUser: winning updates swapped blobs/inference under EXISTING
		// study ids — other tabs' cached object URLs are stale and must hardReload.
		announceDataChanged('replace');
		return { applied: true, orphansSkipped };
	}

	private async wipeUserWithinTx(user: string): Promise<void> {
		await this.db.patients.where('user').equals(user).delete();
		await this.db.studies.where('user').equals(user).delete();
		await this.db.inferences.where('user').equals(user).delete();
		await this.db.files.where('user').equals(user).delete();
		await this.db.studyReportState.where('user').equals(user).delete();
		await this.db.cbctReportState.where('user').equals(user).delete();
		await this.db.iosState.where('user').equals(user).delete();
	}

	/** Delete all of a user's patient data (does NOT touch the backup pointer). Clears the
	 *  user's tombstones too: a deliberate full wipe is a fresh start — a later restore or
	 *  merge should bring back everything the backup has, not fight pre-wipe deletions.
	 *  (importUser's in-tx wipe deliberately does NOT clear them — a replace preserves
	 *  deletion knowledge.) */
	async wipeUser(user: string): Promise<void> {
		await this.db.transaction(
			'rw',
			[
				this.db.patients,
				this.db.studies,
				this.db.inferences,
				this.db.files,
				this.db.studyReportState,
				this.db.cbctReportState,
				this.db.iosState,
				this.db.deletions,
				this.db.meta
			],
			async () => {
				await this.wipeUserWithinTx(user);
				await this.db.deletions.where('user').equals(user).delete();
				await this.db.meta.delete(DV_PREFIX + user);
			}
		);
		announceDataChanged('replace');
	}
}

// App-wide singleton. Tests construct their own `new LocalDb('test-…')` instances.
export const localDb = new LocalDb();
