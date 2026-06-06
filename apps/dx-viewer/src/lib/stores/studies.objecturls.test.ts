import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalDb } from '$lib/db/localDb';
import { genId } from '$lib/db/ids';

// The object-URL lifecycle (the C2/C18 fix family): URLs are cached per (study, kind),
// busted by invalidateRecordCache / saveSegmentation / deleteStudy, and dropped wholesale
// by hardReload after a restore/import REPLACED the underlying blobs. Node ≥16 supports
// URL.createObjectURL(Blob), so the real code paths run un-mocked.
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./auth.svelte', () => ({ auth: { user: { id: 'u1' }, isLoggedIn: true } }));
vi.mock('./history.svelte', () => ({ history: { remove: vi.fn() } }));

import { studies } from './studies.svelte';

const U = 'u1';
let db: LocalDb;

async function seed() {
	const p = await db.putPatient({ id: genId(), user: U, name: 'P', created: '', updated: '' });
	const s = await db.putStudy({
		id: genId(),
		user: U,
		patient: p.id,
		modality: 'cbct',
		created: '',
		updated: ''
	});
	await db.putFile({
		studyId: s.id,
		kind: 'image',
		user: U,
		blob: new Blob([new Uint8Array([1, 2, 3])]),
		filename: 'vol.nrrd',
		mime: 'application/octet-stream'
	});
	await studies.refresh();
	return { p, s };
}

beforeEach(() => {
	db = new LocalDb('test-' + genId());
	studies.setDbForTesting(db);
	studies.patients = [];
});
afterEach(async () => {
	studies.clearCache(); // revoke + drop cached URLs between tests
	await db.destroy();
});

describe('object-URL lifecycle', () => {
	it('freshFileUrl caches per (study, kind): two reads → ONE object URL', async () => {
		const { s } = await seed();
		const study = studies.getStudy(s.patient, s.id)!;
		const a = await studies.freshFileUrl(study, 'image');
		const b = await studies.freshFileUrl(study, 'image');
		expect(a).toBeTruthy();
		expect(b).toBe(a); // cached — the blob is not re-pinned per read
	});

	it('invalidateRecordCache busts the cache: the next read mints a NEW URL', async () => {
		const { s } = await seed();
		const study = studies.getStudy(s.patient, s.id)!;
		const a = await studies.freshFileUrl(study, 'image');
		studies.invalidateRecordCache(s.id);
		const b = await studies.freshFileUrl(study, 'image');
		expect(b).toBeTruthy();
		expect(b).not.toBe(a);
	});

	it('saveSegmentation stores the blob, returns its URL, and a re-save mints a NEW URL', async () => {
		const { s } = await seed();
		const url1 = await studies.saveSegmentation(s.id, new Blob([new Uint8Array([9])]), 'seg.glb');
		expect(url1).toBeTruthy();
		expect((await db.getFile(s.id, 'segmentation'))?.filename).toBe('seg.glb');
		// Replacing the segmentation must not serve the OLD bytes via a stale URL.
		const url2 = await studies.saveSegmentation(
			s.id,
			new Blob([new Uint8Array([8, 8])]),
			'seg2.glb'
		);
		expect(url2).not.toBe(url1);
		expect((await db.getFile(s.id, 'segmentation'))?.filename).toBe('seg2.glb');
	});

	it('saveSegmentation bumps the study row `updated` stamp (merge stamp-honesty)', async () => {
		// The backup merge decides study-unit ownership by `study.updated`; putFile alone
		// bumps only the dataVersion, so without the follow-up empty patchStudy a
		// re-segmented study would sort as OLD and lose to a genuinely older backup.
		const { s } = await seed();
		const before = (await db.getStudy(U, s.id))!.updated;
		await new Promise((r) => setTimeout(r, 5)); // ensure a later ISO ms stamp
		await studies.saveSegmentation(s.id, new Blob([new Uint8Array([7])]), 'seg.glb');
		const after = (await db.getStudy(U, s.id))!.updated;
		expect(after > before).toBe(true);
		// The in-memory projection is synced too (other-tab carry-over parity).
		expect(studies.getStudy(s.patient, s.id)?.updated).toBe(after);
	});

	it('hardReload drops ALL cached URLs (restore/import replaced the blobs) and rebuilds', async () => {
		const { s } = await seed();
		const study = studies.getStudy(s.patient, s.id)!;
		const a = await studies.freshFileUrl(study, 'image');
		await studies.hardReload();
		expect(studies.getPatient(s.patient)).toBeTruthy(); // projection rebuilt
		const after = studies.getStudy(s.patient, s.id)!;
		const b = await studies.freshFileUrl(after, 'image');
		expect(b).not.toBe(a); // pre-reload URL is gone, a fresh one is minted
	});

	it('ensurePatientImages resolves URLs ONLY for viewable 2D modalities', async () => {
		const p = await db.putPatient({ id: genId(), user: U, name: 'Q', created: '', updated: '' });
		const xray = await db.putStudy({
			id: genId(),
			user: U,
			patient: p.id,
			modality: 'xray',
			created: '',
			updated: ''
		});
		const cbct = await db.putStudy({
			id: genId(),
			user: U,
			patient: p.id,
			modality: 'cbct',
			created: '',
			updated: ''
		});
		for (const sid of [xray.id, cbct.id]) {
			await db.putFile({
				studyId: sid,
				kind: 'image',
				user: U,
				blob: new Blob([new Uint8Array([1])]),
				filename: 'f',
				mime: 'application/octet-stream'
			});
		}
		await studies.refresh();
		await studies.ensurePatientImages(p.id);
		expect(studies.getStudy(p.id, xray.id)?.imageDataUrl).toBeTruthy();
		// CBCT binaries are viewer-only (fetched lazily via freshFileUrl), never <img> srcs.
		expect(studies.getStudy(p.id, cbct.id)?.imageDataUrl).toBeUndefined();
	});

	it('deleteStudy revokes the study URLs — a later read for a NEW study with the same db is unaffected', async () => {
		const { s } = await seed();
		const study = studies.getStudy(s.patient, s.id)!;
		const a = await studies.freshFileUrl(study, 'image');
		expect(a).toBeTruthy();
		await studies.deleteStudy(s.id);
		// The file row is gone with the study (cascade) — no URL can be minted.
		expect(await studies.freshFileUrl(study, 'image')).toBeUndefined();
	});
});
