import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalDb } from '$lib/db/localDb';
import { genId } from '$lib/db/ids';
import {
	exportToZip,
	importFromZip,
	isDamagedArchiveError,
	mergeFromZip,
	planMergeFromZip,
	planSalvageFromZip,
	readZipMeta
} from './zip';
import { canRestore } from './gate';

const U = 'user0000000zip1';
let db: LocalDb;

beforeEach(() => {
	db = new LocalDb('test-' + genId());
});
afterEach(async () => {
	await db.destroy();
});

async function seed() {
	const p = await db.putPatient({
		id: genId(),
		user: U,
		name: 'Zip Patient',
		dob: '1980-02-02',
		created: '',
		updated: ''
	});
	const s = await db.putStudy({
		id: genId(),
		user: U,
		patient: p.id,
		modality: 'cbct',
		originalFilename: 'scan.nrrd',
		findingCounts: { toothCount: 4 },
		created: '',
		updated: ''
	});
	await db.putInference({ studyId: s.id, user: U, inference: { report: 'x' } as never });
	await db.putFile({
		studyId: s.id,
		kind: 'image',
		user: U,
		blob: new Blob([new Uint8Array([5, 6, 7, 8, 250])], { type: 'application/octet-stream' }),
		filename: 'scan.nrrd',
		mime: 'application/octet-stream'
	});
	await db.upsertCbctReport(U, s.id, { signedBy: 'Dr Zip', approvedTeeth: [11, 12] });
	return { p, s };
}

describe('zip export / import round-trip', () => {
	it('exports a snapshot and re-imports it byte-for-byte into a fresh db', async () => {
		const { p, s } = await seed();
		const blob = await exportToZip(U, db);
		expect(blob.size).toBeGreaterThan(0);

		const meta = await readZipMeta(blob);
		expect(meta.schemaVersion).toBe(1);
		expect(meta.dataVersion).toBeGreaterThan(0);

		// Import into a clean db.
		const db2 = new LocalDb('test-' + genId());
		try {
			await importFromZip(U, blob, db2);
			expect((await db2.getPatient(U, p.id))?.name).toBe('Zip Patient');
			const study = await db2.getStudy(U, s.id);
			expect(study?.findingCounts).toEqual({ toothCount: 4 });
			expect((await db2.getInference(s.id))?.inference).toBeTruthy();
			const f = await db2.getFile(s.id, 'image');
			expect(Array.from(new Uint8Array(await f!.blob.arrayBuffer()))).toEqual([5, 6, 7, 8, 250]);
			expect((await db2.getCbctReport(U, s.id))?.signedBy).toBe('Dr Zip');
			expect(await db2.getDataVersion(U)).toBe(meta.dataVersion);
			// A file import does NOT move the backup pointer — that records the last
			// ONLINE backup, and none happened here.
			expect(await db2.getBackupPointer(U)).toBeNull();
		} finally {
			await db2.destroy();
		}
	});

	it('rejects a zip with no meta.json', async () => {
		const JSZip = (await import('jszip')).default;
		const bad = await new JSZip().generateAsync({ type: 'blob' });
		await expect(readZipMeta(bad)).rejects.toThrow();
	});

	it('FAST-FAILS a renamed non-zip file (PK signature check, no full multi-GB scan)', async () => {
		const garbage = new Blob(['this is definitely not a zip archive, just text']);
		await expect(readZipMeta(garbage)).rejects.toThrow(/not a zip archive/);
		await expect(importFromZip(U, garbage, db)).rejects.toThrow(/not a zip archive/);
		await expect(readZipMeta(new Blob([]))).rejects.toThrow(/not a zip archive/);
	});

	it('refuses an export past the 4 GiB zip cliff (fflate streaming Zip has no zip64 — it would CORRUPT silently)', async () => {
		// Stub db: the guard reads only blob.size, before any byte is touched.
		const fakeDb = {
			exportUser: async () => ({
				patients: [],
				studies: [],
				inferences: [],
				studyReportState: [],
				cbctReportState: [],
				iosState: [],
				files: [
					{
						studyId: genId(),
						kind: 'image',
						user: U,
						blob: { size: 5 * 1024 ** 3 },
						filename: 'big',
						mime: 'x'
					}
				],
				dataVersion: 1
			})
		} as unknown as import('$lib/db/localDb').LocalDb;
		await expect(exportToZip(U, fakeDb)).rejects.toThrow(/export too large/);
	});

	// A crafted/corrupted manifest must be rejected BEFORE any row reaches IndexedDB —
	// junk rows would otherwise sit locally and fail the next online backup mid-replace.
	async function zipWithManifest(manifest: unknown): Promise<Blob> {
		const JSZip = (await import('jszip')).default;
		const zip = new JSZip();
		zip.file('meta.json', JSON.stringify({ schemaVersion: 1, dataVersion: 1, createdAt: 'x' }));
		zip.file('manifest.json', JSON.stringify(manifest));
		return zip.generateAsync({ type: 'blob' });
	}

	it('rejects a manifest whose section is not a list', async () => {
		const bad = await zipWithManifest({ patients: 'lol' });
		await expect(importFromZip(U, bad, db)).rejects.toThrow(/invalid backup file/);
		expect(await db.getPatients(U)).toEqual([]); // nothing imported
	});

	it('rejects rows with junk ids (not [a-z0-9]{15})', async () => {
		const bad = await zipWithManifest({
			patients: [{ id: '../../etc/passwd', user: U, name: 'X', created: '', updated: '' }]
		});
		await expect(importFromZip(U, bad, db)).rejects.toThrow(/bad id/);
	});

	it('rejects a study row whose patient id is junk and a file row with a bad kind', async () => {
		const pid = genId();
		const sid = genId();
		const badStudy = await zipWithManifest({
			patients: [{ id: pid, user: U, name: 'X', created: '', updated: '' }],
			studies: [{ id: sid, user: U, patient: 'nope', modality: 'xray', created: '', updated: '' }]
		});
		await expect(importFromZip(U, badStudy, db)).rejects.toThrow(/bad patient id/);

		const badKind = await zipWithManifest({
			files: [{ studyId: sid, kind: 'exe', filename: 'a', mime: 'b' }]
		});
		await expect(importFromZip(U, badKind, db)).rejects.toThrow(/bad kind/);
	});

	it('still accepts a manifest with omitted sections (defaults to empty)', async () => {
		const ok = await zipWithManifest({});
		await expect(importFromZip(U, ok, db)).resolves.toEqual({ dataVersion: 1 });
	});

	it('rejects a TRUNCATED archive (manifest file entry whose zip entry is missing) — strict like online restore', async () => {
		const pid = genId();
		const sid = genId();
		// Manifest references a binary, but the files/ entry is absent from the zip.
		const truncated = await zipWithManifest({
			patients: [{ id: pid, user: U, name: 'T', created: '', updated: '' }],
			studies: [{ id: sid, user: U, patient: pid, modality: 'xray', created: '', updated: '' }],
			files: [{ studyId: sid, kind: 'image', filename: 'x.jpg', mime: 'image/jpeg' }]
		});
		await expect(importFromZip(U, truncated, db)).rejects.toThrow(/missing file entry/);
		expect(await db.getPatient(U, pid)).toBeUndefined(); // local data untouched
	});

	it('round-trips a ZERO-byte file entry (degenerate blob must not corrupt the stream)', async () => {
		const p = await db.putPatient({ id: genId(), user: U, name: 'Z', created: '', updated: '' });
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
			blob: new Blob([]),
			filename: 'empty.bin',
			mime: 'application/octet-stream'
		});
		const blob = await exportToZip(U, db);
		const db2 = new LocalDb('test-' + genId());
		try {
			await importFromZip(U, blob, db2);
			const f = await db2.getFile(s.id, 'image');
			expect(f).toBeTruthy();
			expect(f!.blob.size).toBe(0);
			expect(f!.filename).toBe('empty.bin');
		} finally {
			await db2.destroy();
		}
	});

	it('imports a LEGACY (JSZip/DEFLATE) export — old backup files must stay restorable', async () => {
		// The exporter moved from JSZip to streaming fflate; users still hold zips written
		// by the old code (DEFLATE entries, ArrayBuffer-added files). Recreate one.
		const JSZip = (await import('jszip')).default;
		const pid = genId();
		const sid = genId();
		const legacy = new JSZip();
		legacy.file('meta.json', JSON.stringify({ schemaVersion: 1, dataVersion: 7, createdAt: 'x' }));
		legacy.file(
			'manifest.json',
			JSON.stringify({
				patients: [{ id: pid, user: U, name: 'Legacy P', created: '', updated: '' }],
				studies: [{ id: sid, user: U, patient: pid, modality: 'xray', created: '', updated: '' }],
				inferences: [],
				studyReportState: [],
				cbctReportState: [],
				iosState: [],
				files: [{ studyId: sid, kind: 'image', filename: 'x.jpg', mime: 'image/jpeg' }]
			})
		);
		legacy.folder('files')?.file(`${sid}.image`, new Uint8Array([7, 8, 9, 250]).buffer);
		const blob = await legacy.generateAsync({ type: 'blob', compression: 'DEFLATE' });

		await importFromZip(U, blob, db);
		expect((await db.getPatient(U, pid))?.name).toBe('Legacy P');
		const f = await db.getFile(sid, 'image');
		expect(Array.from(new Uint8Array(await f!.blob.arrayBuffer()))).toEqual([7, 8, 9, 250]);
		expect(await db.getDataVersion(U)).toBe(7);
	});

	it('the gate blocks importing an OLDER backup over newer local data', async () => {
		await seed();
		const blob = await exportToZip(U, db); // captures current dataVersion
		const meta = await readZipMeta(blob);
		// Mutate locally → local dataVersion advances past the export's.
		await db.putPatient({ id: genId(), user: U, name: 'Newer', created: '', updated: '' });
		const localDataVersion = await db.getDataVersion(U);
		expect(
			canRestore({ localEmpty: false, localDataVersion, backupDataVersion: meta.dataVersion })
		).toEqual({ ok: false, reason: 'local-newer' });
	});

	it('TOCTOU guard: importFromZip re-asserts the gate INSIDE the lock (stale dialog verdict cannot wipe newer work)', async () => {
		const { p } = await seed();
		const blob = await exportToZip(U, db);
		// Writes land AFTER the export (≅ after the dialog's preview-time gate verdict):
		// local is now strictly newer — the locked apply itself must refuse.
		const newer = await db.putPatient({
			id: genId(),
			user: U,
			name: 'Newer',
			created: '',
			updated: ''
		});
		await expect(importFromZip(U, blob, db)).rejects.toThrow(/local-newer/);
		expect((await db.getPatient(U, newer.id))?.name).toBe('Newer'); // kept
		expect((await db.getPatient(U, p.id))?.name).toBe('Zip Patient'); // untouched
	});
});

describe('zip diff-then-merge', () => {
	const tick = () => new Promise((r) => setTimeout(r, 5)); // order ISO ms stamps

	it('merges a device-A zip into device-B data: union, nothing local lost, idempotent re-merge', async () => {
		const { p, s } = await seed(); // device A
		const zipA = await exportToZip(U, db);
		const meta = await readZipMeta(zipA);

		const dbB = new LocalDb('test-' + genId());
		try {
			const mine = await dbB.putPatient({
				id: genId(),
				user: U,
				name: 'B Only',
				created: '',
				updated: ''
			});
			const res = await mergeFromZip(U, zipA, { includeUpdates: true }, dbB);
			expect(res.applied).toBe(true);
			expect(res.plan.counts.patientsAdded).toBe(1);
			expect(res.plan.counts.studiesAdded).toBe(1);
			expect(res.plan.counts.stateAdded).toBe(1); // the cbct report
			// Union: A's tree arrived (blob bytes intact), B's own row untouched.
			expect((await dbB.getPatient(U, p.id))?.name).toBe('Zip Patient');
			expect((await dbB.getPatient(U, mine.id))?.name).toBe('B Only');
			const f = await dbB.getFile(s.id, 'image');
			expect(Array.from(new Uint8Array(await f!.blob.arrayBuffer()))).toEqual([5, 6, 7, 8, 250]);
			expect((await dbB.getCbctReport(U, s.id))?.signedBy).toBe('Dr Zip');
			// Merged state is strictly NEWER than both sides; the pointer didn't move.
			expect(await dbB.getDataVersion(U)).toBeGreaterThan(meta.dataVersion);
			expect(await dbB.getBackupPointer(U)).toBeNull();

			// Re-merging the SAME zip is a no-op (row-level idempotence).
			const again = await mergeFromZip(U, zipA, { includeUpdates: true }, dbB);
			expect(again.applied).toBe(false);
			expect(again.plan.counts.unchanged).toBeGreaterThan(0);
		} finally {
			await dbB.destroy();
		}
	});

	it('planMergeFromZip (the preview) is read-only', async () => {
		const { p } = await seed();
		const zip = await exportToZip(U, db);
		const dbB = new LocalDb('test-' + genId());
		try {
			const dv = await dbB.getDataVersion(U);
			const plan = await planMergeFromZip(U, zip, dbB);
			expect(plan.counts.patientsAdded).toBe(1);
			expect(plan.counts.studiesAdded).toBe(1);
			expect(await dbB.getDataVersion(U)).toBe(dv); // nothing written
			expect(await dbB.getPatient(U, p.id)).toBeUndefined();
		} finally {
			await dbB.destroy();
		}
	});

	it('LWW: a local-newer row survives a merge; a backup-newer row updates only with includeUpdates', async () => {
		const { p } = await seed();
		const replica = await exportToZip(U, db);
		const dbB = new LocalDb('test-' + genId());
		try {
			await importFromZip(U, replica, dbB); // B starts as a replica of A
			// A renames the patient AFTER the replica was taken → A's copy is newer.
			await tick();
			const renamed = { ...(await db.getPatient(U, p.id))!, name: 'Renamed On A' };
			await db.putPatient(renamed);
			const newer = await exportToZip(U, db);

			// Adds-only merge: the update is stripped, B keeps its name.
			const stripped = await mergeFromZip(U, newer, { includeUpdates: false }, dbB);
			expect(stripped.plan.counts.patientsUpdated).toBe(0);
			expect((await dbB.getPatient(U, p.id))?.name).toBe('Zip Patient');

			// Full merge: the backup-newer row wins, stamp preserved verbatim.
			const full = await mergeFromZip(U, newer, { includeUpdates: true }, dbB);
			expect(full.plan.counts.patientsUpdated).toBe(1);
			const after = await dbB.getPatient(U, p.id);
			expect(after?.name).toBe('Renamed On A');
			expect(after?.updated).toBe((await db.getPatient(U, p.id))!.updated);

			// And the inverse: B now renames LOCALLY (newer than the zip) → merge keeps B's.
			await tick();
			await dbB.putPatient({ ...after!, name: 'B Wins' });
			const keep = await mergeFromZip(U, newer, { includeUpdates: true }, dbB);
			expect(keep.plan.counts.patientsUpdated).toBe(0);
			expect((await dbB.getPatient(U, p.id))?.name).toBe('B Wins');
		} finally {
			await dbB.destroy();
		}
	});

	it('a locally-deleted study does NOT resurrect (tombstone veto), and is reported as suppressed', async () => {
		const { p, s } = await seed();
		const zip = await exportToZip(U, db);
		const dbB = new LocalDb('test-' + genId());
		try {
			await importFromZip(U, zip, dbB);
			await tick(); // the delete must be strictly newer than the zip's row stamp
			await dbB.deleteStudy(U, s.id);
			const res = await mergeFromZip(U, zip, { includeUpdates: true }, dbB);
			expect(await dbB.getStudy(U, s.id)).toBeUndefined(); // stays deleted
			expect(await dbB.getFile(s.id, 'image')).toBeUndefined();
			expect(res.plan.suppressed).toContainEqual({ table: 'studies', id: s.id });
			expect((await dbB.getPatient(U, p.id))?.name).toBe('Zip Patient'); // patient unaffected
		} finally {
			await dbB.destroy();
		}
	});

	it('aborts BEFORE any write when a PLANNED blob is missing from the archive (truncated zip)', async () => {
		const JSZip = (await import('jszip')).default;
		const pid = genId();
		const sid = genId();
		const zip = new JSZip();
		zip.file('meta.json', JSON.stringify({ schemaVersion: 1, dataVersion: 1, createdAt: 'x' }));
		zip.file(
			'manifest.json',
			JSON.stringify({
				patients: [{ id: pid, user: U, name: 'T', created: '', updated: '' }],
				studies: [{ id: sid, user: U, patient: pid, modality: 'xray', created: '', updated: '' }],
				files: [{ studyId: sid, kind: 'image', filename: 'x.jpg', mime: 'image/jpeg' }]
			})
		);
		const truncated = await zip.generateAsync({ type: 'blob' });
		await expect(mergeFromZip(U, truncated, { includeUpdates: true }, db)).rejects.toThrow(
			/missing file entry/
		);
		expect(await db.getPatients(U)).toEqual([]); // nothing merged
	});

	it('exports carry tombstones; a replace-import preserves that deletion knowledge', async () => {
		const { s } = await seed();
		await db.deleteStudy(U, s.id); // writes a tombstone on device A
		const zip = await exportToZip(U, db);
		const dbB = new LocalDb('test-' + genId());
		try {
			await importFromZip(U, zip, dbB);
			const ts = await dbB.getTombstones(U);
			expect(ts.map((t) => `${t.table}:${t.id}`)).toEqual([`studies:${s.id}`]);
		} finally {
			await dbB.destroy();
		}
	});

	it('rejects a manifest tombstone row with a bad table before touching local data', async () => {
		const JSZip = (await import('jszip')).default;
		const zip = new JSZip();
		zip.file('meta.json', JSON.stringify({ schemaVersion: 1, dataVersion: 1, createdAt: 'x' }));
		zip.file(
			'manifest.json',
			JSON.stringify({ tombstones: [{ id: genId(), table: 'users', deletedAt: 'x' }] })
		);
		const bad = await zip.generateAsync({ type: 'blob' });
		await expect(importFromZip(U, bad, db)).rejects.toThrow(/bad table/);
		await expect(mergeFromZip(U, bad, { includeUpdates: true }, db)).rejects.toThrow(/bad table/);
	});
});

describe('damaged-archive salvage (merge-only recovery)', () => {
	/** Cut the archive INSIDE the last file entry's data: the entry header has arrived
	 *  (fflate registers the name) but the data never completes, and the central
	 *  directory is gone — the classic truncated-download damage shape. */
	async function truncateInsideLastEntry(zip: Blob): Promise<Blob> {
		const buf = new Uint8Array(await zip.arrayBuffer());
		let last = -1;
		for (let i = buf.length - 4; i >= 0; i--) {
			if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
				last = i;
				break;
			}
		}
		expect(last).toBeGreaterThan(0);
		return new Blob([buf.slice(0, last + 60)]);
	}

	/** Two patients, one study + image each. Entry order in the archive is studyId-
	 *  ascending, so the 'zzz…' study's blob is LAST — the one the truncation kills. */
	async function seedTwo() {
		const mk = async (pid: string, sid: string, name: string) => {
			await db.putPatient({ id: pid, user: U, name, created: '', updated: '' });
			await db.putStudy({
				id: sid,
				user: U,
				patient: pid,
				modality: 'xray',
				created: '',
				updated: ''
			});
			await db.putFile({
				studyId: sid,
				kind: 'image',
				user: U,
				blob: new Blob([new Uint8Array(2048).map((_, i) => i % 251)]),
				filename: `${name}.jpg`,
				mime: 'image/jpeg'
			});
		};
		await mk('aaapat000000001', 'aaastd000000001', 'Intact Patient');
		await mk('zzzpat000000001', 'zzzstd000000001', 'Lost Patient');
	}

	it('classifies damage errors (salvage triggers) vs non-salvage errors', async () => {
		expect(
			isDamagedArchiveError(
				new Error('invalid backup file: missing file entry for study x (image)')
			)
		).toBe(true);
		expect(isDamagedArchiveError(new Error('invalid backup file: unexpected EOF'))).toBe(true);
		expect(isDamagedArchiveError(new Error('invalid backup file: not a zip archive'))).toBe(false);
		expect(isDamagedArchiveError(new Error('unsupported backup version (2 ≠ 1)'))).toBe(false);
	});

	it('the strict paths refuse the truncated archive; salvage plans only the surviving study', async () => {
		await seedTwo();
		const truncated = await truncateInsideLastEntry(await exportToZip(U, db));

		const db2 = new LocalDb('test-' + genId());
		try {
			// Strict merge AND strict replace both abort before any write.
			await expect(mergeFromZip(U, truncated, { includeUpdates: true }, db2)).rejects.toThrow(
				/invalid backup file/
			);
			await expect(importFromZip(U, truncated, db2)).rejects.toThrow(/invalid backup file/);
			expect(await db2.getPatients(U)).toEqual([]);

			// Salvage preview: the zzz study is lost (named for the dialog), aaa survives.
			const { plan, salvage } = await planSalvageFromZip(U, truncated, db2);
			expect(salvage.totalStudies).toBe(2);
			expect(salvage.lost).toEqual([{ name: 'Lost Patient', modality: 'xray' }]);
			expect(plan.studies.add.map((s) => s.id)).toEqual(['aaastd000000001']);
			// The lost study's patient would arrive EMPTY — dropped with its only study.
			expect(plan.patients.add.map((p) => p.id)).toEqual(['aaapat000000001']);

			// Salvage apply: the intact subtree merges, blob bytes intact; nothing else.
			const res = await mergeFromZip(U, truncated, { includeUpdates: true, salvage: true }, db2);
			expect(res.applied).toBe(true);
			expect((await db2.getPatient(U, 'aaapat000000001'))?.name).toBe('Intact Patient');
			const f = await db2.getFile('aaastd000000001', 'image');
			expect(f?.blob.size).toBe(2048);
			expect(await db2.getPatient(U, 'zzzpat000000001')).toBeUndefined();
			expect(await db2.getStudy(U, 'zzzstd000000001')).toBeUndefined();
		} finally {
			await db2.destroy();
		}
	});

	it('keeps a damaged study LOCALLY intact (salvage merge never deletes; it just does not re-add)', async () => {
		await seedTwo();
		const truncated = await truncateInsideLastEntry(await exportToZip(U, db));
		// Merging the damaged archive back into the ORIGINAL db: everything is already
		// present and newer-or-equal → nothing applied, nothing lost.
		const res = await mergeFromZip(U, truncated, { includeUpdates: true, salvage: true }, db);
		expect(res.applied).toBe(false);
		expect((await db.getPatient(U, 'zzzpat000000001'))?.name).toBe('Lost Patient');
		expect(await db.getFile('zzzstd000000001', 'image')).toBeTruthy();
	});

	it('salvage rethrows when even the manifest is unrecoverable (nothing to salvage)', async () => {
		const JSZip = (await import('jszip')).default;
		const zip = new JSZip();
		zip.file('meta.json', JSON.stringify({ schemaVersion: 1, dataVersion: 1, createdAt: 'x' }));
		// No manifest.json at all.
		const noManifest = await zip.generateAsync({ type: 'blob' });
		await expect(planSalvageFromZip(U, noManifest, db)).rejects.toThrow(/manifest\.json missing/);
	});
});
