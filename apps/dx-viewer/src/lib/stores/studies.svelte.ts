import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';
import { initials, ringColors } from '$lib/image';
import { foldDiacritics } from '$lib/patients';
import { capName } from '$lib/forms';
import { hasViewableImage } from '$lib/modality';
import { localDb, type LocalDb } from '$lib/db/localDb';
import { onDataChanged, makeChangeDispatcher } from '$lib/db/changes';
import { genId } from '$lib/db/ids';
import type { DbPatient, DbStudy, FileKind } from '$lib/db/schema';
import type { StoredPatient, StoredStudy } from '$lib/types';
import { auth } from './auth.svelte';
import { history } from './history.svelte';

// LOCAL-FIRST: all patient data lives in the browser's IndexedDB (see
// $lib/db/localDb + new_feat/local_first_design.md). PocketBase is NEVER touched for
// patient data — it only runs stateless AI inference and (Labs-gated) backup/restore.
// This store is the reactive in-memory projection of the local DB: refresh() loads the
// light patient/study metadata; the heavy inference blobs and binary image/segmentation
// files are pulled lazily (ensureInference / ensurePatientImages / freshFileUrl) so a
// clinic with thousands of studies never reads gigabytes into memory at once.

function dbStudyToStored(
	s: DbStudy,
	patient: Pick<DbPatient, 'name' | 'dob'>,
	extra?: {
		imageDataUrl?: string;
		segmentationUrl?: string;
		inference?: StoredStudy['inference'];
		userEdits?: StoredStudy['userEdits'];
	}
): StoredStudy {
	return {
		id: s.id,
		patientId: s.patient,
		patientName: patient.name,
		dob: patient.dob ?? undefined,
		capturedAt: s.capturedAt ?? s.created ?? new Date().toISOString(),
		created: s.created,
		updated: s.updated,
		modality: (s.modality as StoredStudy['modality']) ?? 'xray',
		imageDataUrl: extra?.imageDataUrl,
		originalFilename: s.originalFilename,
		inference: extra?.inference,
		userEdits: extra?.userEdits,
		segmentationUrl: extra?.segmentationUrl,
		findingCounts: s.findingCounts,
		severityScore: s.severityScore,
		fmxSlot: s.fmxSlot
	};
}

function patientFromRecord(p: DbPatient, studies: StoredStudy[]): StoredPatient {
	const sorted = [...studies].sort((a, b) =>
		b.capturedAt < a.capturedAt ? -1 : b.capturedAt > a.capturedAt ? 1 : 0
	);
	const last = sorted[0]?.capturedAt ?? p.created ?? new Date().toISOString();
	const toothCount = sorted.reduce((s, st) => s + (st.findingCounts?.['toothCount'] ?? 0), 0);
	const ring: [string, string] =
		Array.isArray(p.ringColors) && p.ringColors.length >= 2
			? [p.ringColors[0]!, p.ringColors[1]!]
			: ringColors(p.name + p.id);
	return {
		id: p.id,
		// Fallback so a missing/blank name (shouldn't occur but a bad import could)
		// doesn't blank the name everywhere or break exports.
		name: p.name || 'Unknown',
		dob: p.dob ?? undefined,
		initials: p.initials || initials(p.name),
		studies: sorted,
		lastCapture: last,
		totalToothCount: toothCount,
		ringColors: ring,
		quick: !!p.quick
	};
}

// Ask the browser to make the local-first IndexedDB PERSISTENT (exempt from eviction
// under storage pressure) — patient data lives only here, so eviction would lose it
// (locked decision #2). Best-effort + one-time: unsupported browsers / a denied prompt
// just leave storage "best-effort" (the durability statement in /help covers the risk).
let persistenceRequested = false;
function requestPersistentStorage() {
	if (persistenceRequested || typeof navigator === 'undefined') return;
	persistenceRequested = true;
	try {
		void navigator.storage?.persist?.();
	} catch {
		/* storage API unavailable — best effort */
	}
}

// One-time cleanup: the per-study clinical annotations that used to live in
// localStorage (dxv:cbct:* / dxv:ios:*) now live in IndexedDB. Sweep any leftover
// legacy keys so they don't linger after the local-first migration.
function purgeLegacyAnnotationKeys() {
	if (typeof localStorage === 'undefined') return;
	try {
		const legacy = /^dxv:(?:cbct|ios):(?:hiddenMeshes|markups|signed|toothNotes|measure):/;
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const key = localStorage.key(i);
			if (key && legacy.test(key)) localStorage.removeItem(key);
		}
	} catch {
		/* best effort */
	}
}

class StudiesStore {
	patients = $state<StoredPatient[]>([]);
	loading = $state(false);

	// The local DB. A field (not a hard import) so unit tests can inject a fresh
	// fake-indexeddb-backed instance via setDbForTesting().
	private db: LocalDb = localDb;

	// O(1) id→patient lookup, DERIVED from `patients` (not hand-maintained). Deriving it
	// is what keeps getPatient reactive: a plain Map is non-reactive and the `?? find`
	// short-circuits on a hit, so a $derived(getPatient(id)) read no reactive state and
	// never recomputed after a mutation — leaving consumers (e.g. the quick-assign
	// banner) stale. As a $derived it both stays in sync and is tracked by callers.
	private byPatientId = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt wholesale on every derive; reactivity comes from the $derived, not Map mutation
		const m = new Map<string, StoredPatient>();
		for (const p of this.patients) m.set(p.id, p);
		return m;
	});

	// Monotonic refresh id — overlapping refresh() calls all complete and only the LATEST
	// applies its result, so a slow stale refresh can't clobber a newer one.
	private refreshGen = 0;

	// In-flight patient creations, keyed by the normalized `nameKey|dobKey` the dedup
	// uses, so two concurrent findOrCreatePatient for the same name+DOB don't both create.
	private creatingPatients = new Map<
		string,
		Promise<{ patient: StoredPatient; created: boolean }>
	>();

	// In-flight ensureInference / ensurePatientImages, keyed by patientId, so concurrent
	// consumers (viewer + patient page mounting together) share one read.
	private inferenceLoads = new Map<string, Promise<void>>();
	private imageLoads = new Map<string, Promise<void>>();

	// Cached object URLs for local file blobs, keyed `${studyId}:${kind}`. Object URLs
	// don't expire (unlike the old PB file tokens), but they pin the blob in memory and
	// must be revoked when the study/file goes away (delete, re-segment, logout).
	private objectUrls = new Map<string, string>();

	/** Test seam: inject a fresh fake-indexeddb-backed db. */
	setDbForTesting(db: LocalDb) {
		this.db = db;
	}

	private get currentUser(): string | null {
		return auth.user?.id ?? null;
	}

	private makeObjectUrl(studyId: string, kind: FileKind, blob: Blob): string | undefined {
		const key = `${studyId}:${kind}`;
		const existing = this.objectUrls.get(key);
		if (existing) return existing;
		if (typeof URL === 'undefined' || !URL.createObjectURL) return undefined;
		const url = URL.createObjectURL(blob);
		this.objectUrls.set(key, url);
		return url;
	}

	private revokeObjectUrls(studyId: string, kind?: FileKind) {
		const prefix = `${studyId}:`;
		for (const k of [...this.objectUrls.keys()]) {
			if (kind ? k === `${studyId}:${kind}` : k.startsWith(prefix)) {
				const u = this.objectUrls.get(k);
				if (u && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(u);
				this.objectUrls.delete(k);
			}
		}
	}

	// The token-refresh loop is obsolete in local-first (object URLs never expire). Kept
	// as no-ops so callers (and the prior public API) don't need to change.
	startTokenRefreshLoop() {}
	stopTokenRefreshLoop() {}

	/** Drop all in-memory user data + revoke object URLs. Called on logout: the local
	 *  IndexedDB is NOT wiped (it's the user's own on-device data and survives a re-login),
	 *  but the in-memory projection is cleared so a different clinician logging in on the
	 *  same browser never flashes the previous list (queries are user-scoped, so they'd see
	 *  their own — empty — data anyway, but clearing avoids the flash). */
	clearCache() {
		this.revokeAllObjectUrls();
		this.patients = [];
		this.loading = false;
		this.inferenceLoads.clear();
		this.imageLoads.clear();
	}

	private revokeAllObjectUrls() {
		if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
			for (const u of this.objectUrls.values()) URL.revokeObjectURL(u);
		}
		this.objectUrls.clear();
	}

	/** Full reload after a restore/import REPLACED the underlying IndexedDB rows: the
	 *  cached object URLs still point at the PRE-replace blobs (a plain refresh() would
	 *  re-attach them to the new studies), so drop the whole in-memory projection +
	 *  revoke every URL, then rebuild from the new DB contents. */
	async hardReload() {
		this.clearCache();
		await this.refresh();
	}

	// Cross-tab coherence: another tab's IndexedDB write (add/delete/rename patient…)
	// must reach this tab's projection — without it, a second tab stays stale forever
	// and its findOrCreatePatient can duplicate a patient. Wired lazily on the first
	// refresh; debounced so a burst of writes (an import) triggers one reload.
	private changeUnsub: (() => void) | null = null;
	private ensureChangeListener() {
		if (this.changeUnsub || !browser) return;
		// 'replace' (restore/import/wipe in another tab) → hardReload; plain writes →
		// refresh. Policy (debounce + sticky replace) lives in makeChangeDispatcher,
		// extracted pure + unit-tested.
		this.changeUnsub = onDataChanged(
			makeChangeDispatcher({
				refresh: () => this.refresh(),
				hardReload: () => this.hardReload()
			})
		);
	}

	async refresh() {
		if (!browser || !auth.isLoggedIn) return;
		const user = this.currentUser;
		if (!user) return;
		requestPersistentStorage();
		purgeLegacyAnnotationKeys();
		this.ensureChangeListener();
		const gen = ++this.refreshGen;
		this.loading = true;
		try {
			const [dbPatients, dbStudies] = await Promise.all([
				this.db.getPatients(user),
				this.db.getStudies(user)
			]);
			// A newer refresh started while we awaited → drop our (stale) result.
			if (gen !== this.refreshGen) return;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive scratch local within one refresh() pass
			const byPatient = new Map<string, StoredStudy[]>();
			const patientById = new Map(dbPatients.map((p) => [p.id, p]));
			// Previous projection, for carrying loaded inference across the rebuild.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive scratch local within one refresh() pass
			const prevById = new Map<string, StoredStudy>();
			for (const pp of this.patients) for (const ps of pp.studies) prevById.set(ps.id, ps);
			for (const s of dbStudies) {
				const p = patientById.get(s.patient);
				if (!p) continue;
				const arr = byPatient.get(s.patient) ?? [];
				// Light projection: no file URLs (lazy). For an already-cached image
				// object URL (e.g. ensurePatientImages ran before a refresh), re-attach
				// it so the thumbnail doesn't blank on refresh. Same for already-loaded
				// inference/userEdits when the row is UNCHANGED (`updated` equality —
				// every inference/edit writer bumps the study row): without the carry,
				// EVERY cross-tab write blanked the AI overlay/findings for a refetch
				// frame in the receiving tab.
				const cachedImg = this.objectUrls.get(`${s.id}:image`);
				const prev = prevById.get(s.id);
				const unchanged = prev !== undefined && !!s.updated && prev.updated === s.updated;
				arr.push(
					dbStudyToStored(s, p, {
						imageDataUrl: cachedImg,
						inference: unchanged ? prev.inference : undefined,
						userEdits: unchanged ? prev.userEdits : undefined
					})
				);
				byPatient.set(s.patient, arr);
			}
			this.patients = dbPatients.map((p) => patientFromRecord(p, byPatient.get(p.id) ?? []));
		} finally {
			if (gen === this.refreshGen) this.loading = false;
		}
	}

	getPatient(id: string): StoredPatient | undefined {
		return this.byPatientId.get(id) ?? this.patients.find((p) => p.id === id);
	}

	getStudy(patientId: string, studyId: string): StoredStudy | undefined {
		return this.getPatient(patientId)?.studies.find((s) => s.id === studyId);
	}

	/** Lazily load the `inference` (+ userEdits) for a patient's studies from IndexedDB.
	 *  refresh() omits them for bounded memory; the 2D overlay / FindingsPanel / FMX dots
	 *  call this for the patient they show. Idempotent; concurrent calls share one read. */
	async ensureInference(patientId: string): Promise<void> {
		const patient = this.patients.find((p) => p.id === patientId);
		if (!patient || !patient.studies.some((s) => s.inference === undefined)) return;
		const existing = this.inferenceLoads.get(patientId);
		if (existing) return existing;
		const run = (async () => {
			try {
				const studyIds = patient.studies.map((s) => s.id);
				const rows = await this.db.getInferencesForStudies(studyIds);
				const byId = new Map(rows.map((r) => [r.studyId, r]));
				const target = this.patients.find((p) => p.id === patientId);
				if (!target) return;
				let patched = false;
				for (const study of target.studies) {
					if (study.inference === undefined) {
						const rec = byId.get(study.id);
						// A study with no inference row stays defined-as-null so we don't
						// re-query it forever (matches a genuinely image-only study).
						study.inference = (rec?.inference ?? null) as StoredStudy['inference'];
						study.userEdits = (rec?.userEdits ?? null) as StoredStudy['userEdits'];
						patched = true;
					}
				}
				if (patched) this.patients = [...this.patients];
			} catch (e) {
				console.warn('ensureInference failed', e);
			}
		})();
		this.inferenceLoads.set(patientId, run);
		try {
			await run;
		} finally {
			this.inferenceLoads.delete(patientId);
		}
	}

	/** Lazily resolve object URLs for a patient's VIEWABLE 2D images (xray/panoramic/photo)
	 *  so <img src> consumers (patient page, PhotoGallery, FMX grid/navigator, 2D viewer)
	 *  can render them. CBCT/IOS binaries are NOT loaded here — they're fetched on demand
	 *  by the 3D viewers via freshFileUrl. Idempotent; concurrent calls share one read. */
	async ensurePatientImages(patientId: string): Promise<void> {
		if (!browser) return;
		const patient = this.patients.find((p) => p.id === patientId);
		if (!patient) return;
		const needs = patient.studies.filter((s) => hasViewableImage(s.modality) && !s.imageDataUrl);
		if (needs.length === 0) return;
		const existing = this.imageLoads.get(patientId);
		if (existing) return existing;
		const run = (async () => {
			try {
				let patched = false;
				for (const s of needs) {
					const f = await this.db.getFile(s.id, 'image');
					if (!f) continue;
					const url = this.makeObjectUrl(s.id, 'image', f.blob);
					if (!url) continue;
					const target = this.patients
						.find((p) => p.id === patientId)
						?.studies.find((x) => x.id === s.id);
					if (target) {
						target.imageDataUrl = url;
						patched = true;
					}
				}
				if (patched) this.patients = [...this.patients];
			} catch (e) {
				console.warn('ensurePatientImages failed', e);
			}
		})();
		this.imageLoads.set(patientId, run);
		try {
			await run;
		} finally {
			this.imageLoads.delete(patientId);
		}
	}

	/** Persist the clinician's 2D detection edits (separate from the read-only AI
	 *  inference, so the model output is never mutated). */
	async saveUserEdits(studyId: string, edits: import('$lib/types').UserEdits): Promise<void> {
		const user = this.currentUser;
		if (!user) return;
		const existing = await this.db.getInference(studyId);
		await this.db.putInference({
			studyId,
			user,
			inference: existing?.inference ?? null,
			userEdits: edits
		});
		// Empty patch = bump the study row's `updated` stamp, so other tabs' refresh
		// carry-over sees the row as CHANGED and re-fetches the new edits.
		const patched = await this.db.patchStudy(user, studyId, {});
		for (const p of this.patients) {
			const s = p.studies.find((x) => x.id === studyId);
			if (s) {
				s.userEdits = edits;
				if (patched) s.updated = patched.updated;
				this.patients = [...this.patients];
				return;
			}
		}
	}

	/** Build a fresh object URL for a study's binary (image/segmentation), read from
	 *  IndexedDB. Used by the CBCT/IOS viewers to fetch the volume / mesh / segmentation. */
	async freshFileUrl(
		study: StoredStudy,
		kind: 'image' | 'segmentation'
	): Promise<string | undefined> {
		const f = await this.db.getFile(study.id, kind);
		if (!f) return undefined;
		return this.makeObjectUrl(study.id, kind, f.blob);
	}

	/** Revoke a study's cached object URLs so the next freshFileUrl re-reads the blob
	 *  (called after a segmentation re-save when we want consumers to pick up new bytes). */
	invalidateRecordCache(studyId: string) {
		this.revokeObjectUrls(studyId);
	}

	/** Returns the patient AND whether it was newly created (vs matched an existing one),
	 *  so a failed subsequent study save can delete a just-created patient (no orphan). */
	async findOrCreatePatient(input: {
		name: string;
		dob?: string;
		quick?: boolean;
	}): Promise<{ patient: StoredPatient; created: boolean }> {
		const user = this.currentUser;
		if (!user) throw new Error('not authenticated');
		const dobKey = (d?: string | null) => (d ?? '').trim().slice(0, 10);
		const nameKey = (n: string) => foldDiacritics(n.trim());
		const inputNameKey = nameKey(input.name);
		const existing = this.patients.find(
			(p) => nameKey(p.name) === inputNameKey && dobKey(p.dob) === dobKey(input.dob)
		);
		if (existing) return { patient: existing, created: false };

		const lockKey = `${inputNameKey}|${dobKey(input.dob)}`;
		const inFlight = this.creatingPatients.get(lockKey);
		if (inFlight) {
			const { patient } = await inFlight;
			return { patient, created: false };
		}

		const run = (async () => {
			// AUTHORITATIVE dedup against the DB before creating: the in-memory projection
			// can be stale (a second tab created this patient and the cross-tab refresh
			// hasn't landed yet) — matching only the projection created DUPLICATE patients
			// for the same person. (Two tabs creating truly simultaneously can still race;
			// the change signal converges the projections right after.)
			const dbRows = await this.db.getPatients(user);
			const dbMatch = dbRows.find(
				(p) => nameKey(p.name) === inputNameKey && dobKey(p.dob) === dobKey(input.dob)
			);
			if (dbMatch) {
				// Splice the match into the projection DETERMINISTICALLY — not via
				// refresh(): a concurrent refresh (e.g. the cross-tab listener reacting
				// to the very write that created dbMatch) gen-drops ours, getPatient
				// comes back undefined, and we'd fall through and create the duplicate
				// after all.
				const already = this.getPatient(dbMatch.id);
				if (already) return { patient: already, created: false };
				const dbStudies = await this.db.getStudiesByPatient(user, dbMatch.id);
				const sp = patientFromRecord(
					dbMatch,
					dbStudies.map((s) => dbStudyToStored(s, dbMatch))
				);
				this.patients = [sp, ...this.patients];
				return { patient: sp, created: false };
			}
			const name = capName(input.name);
			const ring = ringColors(input.name + genId());
			const id = genId();
			const stored = await this.db.putPatient({
				id,
				user,
				name,
				dob: input.dob || null,
				initials: initials(name),
				ringColors: ring,
				quick: input.quick ?? false,
				created: '',
				updated: ''
			});
			const np = patientFromRecord(stored, []);
			this.patients = [np, ...this.patients];
			return { patient: np, created: true };
		})();
		this.creatingPatients.set(lockKey, run);
		try {
			return await run;
		} finally {
			this.creatingPatients.delete(lockKey);
		}
	}

	async addStudy(opts: {
		patientId: string;
		modality: StoredStudy['modality'];
		imageBlob?: Blob;
		originalFilename?: string;
		inference?: unknown;
		findingCounts?: Record<string, number>;
		severityScore?: number;
		fmxSlot?: string;
		capturedAt?: string;
	}): Promise<StoredStudy> {
		const user = this.currentUser;
		if (!user) throw new Error('not authenticated');
		const id = genId();
		const created = new Date().toISOString();
		const dbStudy: DbStudy = {
			id,
			user,
			patient: opts.patientId,
			modality: opts.modality,
			fmxSlot: opts.fmxSlot,
			capturedAt: opts.capturedAt ?? created,
			originalFilename: opts.originalFilename,
			findingCounts: opts.findingCounts,
			severityScore: opts.severityScore,
			created,
			updated: created
		};
		// ONE transaction for study + inference + file: a failed binary write (quota,
		// clone error) aborts the whole create instead of leaving an image-less orphan
		// study under the patient.
		await this.db.createStudy(dbStudy, {
			inference: opts.inference
				? {
						studyId: id,
						user,
						inference: opts.inference as StoredStudy['inference'],
						userEdits: null
					}
				: undefined,
			file: opts.imageBlob
				? {
						studyId: id,
						kind: 'image',
						user,
						blob: opts.imageBlob,
						filename: opts.originalFilename ?? 'upload.bin',
						mime: opts.imageBlob.type || 'application/octet-stream'
					}
				: undefined
		});
		let imageDataUrl: string | undefined;
		if (opts.imageBlob && hasViewableImage(opts.modality)) {
			imageDataUrl = this.makeObjectUrl(id, 'image', opts.imageBlob);
		}

		// Build the StoredStudy + splice it into the cache (prepend to its patient, move
		// the patient to the front), using the cached patient when available.
		const cachedPatient = this.patients.find((p) => p.id === opts.patientId);
		let patientMeta: Pick<DbPatient, 'name' | 'dob'>;
		if (cachedPatient) {
			patientMeta = { name: cachedPatient.name, dob: cachedPatient.dob ?? null };
		} else {
			const dbP = await this.db.getPatient(user, opts.patientId);
			patientMeta = { name: dbP?.name ?? '', dob: dbP?.dob ?? null };
		}
		const sNew = dbStudyToStored(dbStudy, patientMeta, {
			imageDataUrl,
			inference: opts.inference as StoredStudy['inference'],
			userEdits: null
		});
		const idx = this.patients.findIndex((p) => p.id === opts.patientId);
		if (idx >= 0) {
			const p = this.patients[idx]!;
			const newP = patientFromRecord(
				{
					id: p.id,
					user,
					name: p.name,
					dob: p.dob ?? null,
					initials: p.initials,
					ringColors: p.ringColors as [string, string],
					quick: p.quick,
					created: '',
					updated: ''
				},
				[sNew, ...p.studies]
			);
			this.patients = [newP, ...this.patients.filter((x) => x.id !== opts.patientId)];
		} else {
			const newP = patientFromRecord(
				{
					id: opts.patientId,
					user,
					name: patientMeta.name,
					dob: patientMeta.dob,
					created: '',
					updated: ''
				},
				[sNew]
			);
			this.patients = [newP, ...this.patients];
		}
		return sNew;
	}

	async updateStudyInference(
		studyId: string,
		inference: unknown,
		findingCounts?: Record<string, number>
	) {
		const user = this.currentUser;
		if (!user) return;
		const existing = await this.db.getInference(studyId);
		await this.db.putInference({
			studyId,
			user,
			inference: inference as StoredStudy['inference'],
			userEdits: existing?.userEdits ?? null
		});
		// Always patch (empty patch = `updated`-stamp bump) so other tabs' refresh
		// carry-over re-fetches the new inference instead of reusing the old one.
		const patched = await this.db.patchStudy(user, studyId, findingCounts ? { findingCounts } : {});
		for (const p of this.patients) {
			const s = p.studies.find((x) => x.id === studyId);
			if (s) {
				s.inference = inference as StoredStudy['inference'];
				if (findingCounts) s.findingCounts = findingCounts;
				if (patched) s.updated = patched.updated;
				this.patients = [...this.patients];
				return;
			}
		}
	}

	async saveSegmentation(studyId: string, blob: Blob, filename: string) {
		const user = this.currentUser;
		if (!user) return undefined;
		// Replacing the segmentation invalidates any cached object URL for it.
		this.revokeObjectUrls(studyId, 'segmentation');
		await this.db.putFile({
			studyId,
			kind: 'segmentation',
			user,
			blob,
			filename,
			mime: blob.type || 'application/octet-stream'
		});
		// Empty patch = bump the study row's `updated` stamp (same idiom as the
		// inference/edit writers above). putFile alone bumps only the dataVersion, which
		// left the stamp DISHONEST for a re-segmented study — and the backup merge decides
		// study-unit ownership by `study.updated`, so a stale stamp would let a genuinely
		// older backup overwrite a fresh segmentation.
		const patched = await this.db.patchStudy(user, studyId, {});
		const url = this.makeObjectUrl(studyId, 'segmentation', blob);
		for (const p of this.patients) {
			const s = p.studies.find((x) => x.id === studyId);
			if (s) {
				s.segmentationUrl = url;
				if (patched) s.updated = patched.updated;
				this.patients = [...this.patients];
				break;
			}
		}
		return url;
	}

	async deleteStudy(studyId: string) {
		const user = this.currentUser;
		if (!user) return;
		await this.db.deleteStudy(user, studyId);
		this.revokeObjectUrls(studyId);
		history.remove(studyId);
		// Rebuild the owning patient via patientFromRecord (as addStudy does) so the
		// DERIVED fields recompute — a bare splice left lastCapture/totalToothCount
		// showing the DELETED study's date on the patient header, PatientCard chip and
		// the dashboard Recent sort until the next full refresh.
		const idx = this.patients.findIndex((p) => p.studies.some((s) => s.id === studyId));
		if (idx >= 0) {
			const p = this.patients[idx]!;
			const rebuilt = patientFromRecord(
				{
					id: p.id,
					user,
					name: p.name,
					dob: p.dob ?? null,
					initials: p.initials,
					ringColors: p.ringColors as [string, string],
					quick: p.quick,
					created: '',
					updated: ''
				},
				p.studies.filter((s) => s.id !== studyId)
			);
			this.patients = this.patients.map((x, i) => (i === idx ? rebuilt : x));
		}
	}

	async deletePatient(patientId: string) {
		const user = this.currentUser;
		if (!user) return;
		const studyIds = this.patients.find((p) => p.id === patientId)?.studies.map((s) => s.id) ?? [];
		await this.db.deletePatient(user, patientId);
		for (const id of studyIds) {
			this.revokeObjectUrls(id);
			history.remove(id);
		}
		this.patients = this.patients.filter((p) => p.id !== patientId);
	}

	async updateStudyFmxSlot(studyId: string, fmxSlot: string | null) {
		const user = this.currentUser;
		if (!user) return;
		await this.db.patchStudy(user, studyId, { fmxSlot: fmxSlot ?? '' });
		for (const p of this.patients) {
			const s = p.studies.find((x) => x.id === studyId);
			if (s) {
				s.fmxSlot = fmxSlot ?? undefined;
				this.patients = [...this.patients];
				return;
			}
		}
	}

	// --- Quick-study reassignment ---------------------------------------------

	/** Give a quick/temporary patient a real identity (name + DOB) and clear `quick`. */
	async renamePatient(patientId: string, input: { name: string; dob?: string }) {
		const user = this.currentUser;
		if (!user) return;
		const existing = await this.db.getPatient(user, patientId);
		if (!existing) return;
		const name = capName(input.name);
		await this.db.putPatient({
			...existing,
			name,
			dob: input.dob || null,
			initials: initials(name),
			quick: false
		});
		await this.refresh();
	}

	/** Clear (or set) the quick flag without other changes. */
	async setQuick(patientId: string, quick: boolean) {
		const user = this.currentUser;
		if (!user) return;
		const existing = await this.db.getPatient(user, patientId);
		if (!existing) return;
		await this.db.putPatient({ ...existing, quick });
		await this.refresh();
	}

	/** Move every study of `fromPatientId` onto `toPatientId`, then delete the now-empty
	 *  source patient — files a quick scan under an existing patient. */
	async mergePatientInto(fromPatientId: string, toPatientId: string) {
		if (fromPatientId === toPatientId) return;
		const user = this.currentUser;
		if (!user) return;
		const from = this.getPatient(fromPatientId);
		const studyIds = from?.studies.map((s) => s.id) ?? [];
		const total = studyIds.length;
		let moved = 0;
		try {
			for (const sid of studyIds) {
				await this.db.reassignStudy(user, sid, toPatientId);
				history.remove(sid); // stale recently-viewed entry points at the old patient URL
				moved++;
			}
			// All studies moved → delete the now-empty source patient. (A partial failure
			// keeps it: it still owns the studies that didn't move.)
			await this.db.deletePatient(user, fromPatientId).catch(() => {});
		} catch (e) {
			// A1 rule: never surface raw English-technical internals to the clinician —
			// the localized partial-move message carries the actionable counts; the raw
			// detail goes to the console. (reassignStudy can now THROW "target patient no
			// longer exists" — newly reachable via a cross-tab delete mid-merge — which
			// the old `msg + detail` concatenation leaked verbatim into the UI.)
			console.warn('mergePatientInto failed', e);
			throw new Error(get(_)('quickassign.mergeIncomplete', { values: { moved, total } }), {
				cause: e
			});
		} finally {
			// Best-effort resync — a thrown refresh here must NOT replace the try/catch's
			// result (JS finally semantics), so swallow it; the cache resyncs on next load.
			try {
				await this.refresh();
			} catch (refreshErr) {
				console.warn('mergePatientInto: post-merge resync failed', refreshErr);
			}
		}
	}
}

export const studies = new StudiesStore();
