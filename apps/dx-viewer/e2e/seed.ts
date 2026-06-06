import { type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// LOCAL-FIRST E2E seeding. The demo account is empty server-side now (patient data lives
// in the browser's IndexedDB), so the previously server-seeded specs must inject their
// fixtures into IndexedDB. We let the APP create the Dexie DB (navigate once), then write
// rows directly into the existing stores via the raw IndexedDB API — Dexie owns the
// schema, we only insert rows, so this stays robust to schema details.
//
// The 2D inference fixture is a real frozen `/inference` response (its big base64 preview
// strings blanked — the viewer draws overlays from extra.*_result, not those), so the AI
// overlay + Diagnostic Results render exactly as in production.

const INFERENCE_2D = JSON.parse(
	readFileSync(fileURLToPath(new URL('./fixtures/inference-2d.json', import.meta.url)), 'utf8')
);

// Use the REAL X-ray the inference fixture was computed on (so the overlay aligns and the
// freeform/detection-editor draws map to meaningful image coords). Falls back to a generated
// gray image of the same dimensions when test_images is absent (fresh clone / CI) — most
// specs still pass; only the pixel-precise editor draws need the real image.
function realXrayBase64(): string | null {
	try {
		return readFileSync('/home/yang/appv3/test_images/image1.jpg').toString('base64');
	} catch {
		return null;
	}
}

// Matches countFindings(INFERENCE_2D): disease labels [10,16,10,10,19] → dz_10×3, dz_16,
// dz_19, plus toothCount from the number_result labels.
export const FINDING_COUNTS_2D = { dz_10: 3, dz_16: 1, dz_19: 1, toothCount: 3 };

export interface SeedStudy {
	patient: string;
	study: string;
	patientName?: string;
	patientDob?: string;
	quick?: boolean;
	modality?: string;
	fmxSlot?: string;
	capturedAt?: string;
	findingCounts?: Record<string, number>;
}

async function userId(page: Page): Promise<string> {
	return page.evaluate(() => {
		try {
			const raw = localStorage.getItem('pocketbase_auth');
			if (raw) {
				const a = JSON.parse(raw);
				return a?.record?.id ?? a?.model?.id ?? '';
			}
		} catch {
			/* ignore */
		}
		return '';
	});
}

/** Seed 2D x-ray studies (with the real AI inference) into the local-first IndexedDB.
 *  Call after the app has opened the DB at least once (navigate first); reload/navigate
 *  afterwards so the store reads the seed. */
export async function seedXrayStudies(page: Page, studies: SeedStudy[]): Promise<void> {
	// The app must have opened Dexie + loaded auth (the storageState localStorage is per-
	// origin) before we can seed. If the page hasn't navigated to the app yet (about:blank),
	// load /studies first; if it's already on an app page, leave it where it is.
	if (!page.url().startsWith('http')) await page.goto('/studies');
	const uid = await userId(page);
	await page.evaluate(
		async ({ uid, studies, inference, realImg }) => {
			async function openExisting(): Promise<IDBDatabase> {
				for (let i = 0; i < 100; i++) {
					const db = await new Promise<IDBDatabase>((res, rej) => {
						const r = indexedDB.open('dxv-local');
						r.onsuccess = () => res(r.result);
						r.onerror = () => rej(r.error);
					});
					if (db.objectStoreNames.contains('studies')) return db;
					db.close();
					await new Promise((r) => setTimeout(r, 100));
				}
				throw new Error('dxv-local not initialised — navigate to the app first');
			}
			function grayJpeg(w: number, h: number): Promise<Blob> {
				const c = document.createElement('canvas');
				c.width = w;
				c.height = h;
				const x = c.getContext('2d')!;
				x.fillStyle = '#2b2b2b';
				x.fillRect(0, 0, w, h);
				return new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.7));
			}
			const db = await openExisting();
			let img: Blob;
			if (realImg) {
				const bin = atob(realImg);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				img = new Blob([bytes], { type: 'image/jpeg' });
			} else {
				img = await grayJpeg(1562, 1168); // matches the inference coordinate space
			}
			const now = new Date().toISOString();
			const tx = db.transaction(
				['patients', 'studies', 'inferences', 'files', 'meta'],
				'readwrite'
			);
			const seenPatients = new Set<string>();
			for (const s of studies) {
				if (!seenPatients.has(s.patient)) {
					seenPatients.add(s.patient);
					tx.objectStore('patients').put({
						id: s.patient,
						user: uid,
						name: s.patientName ?? 'Test Patient',
						dob: s.patientDob ?? null,
						initials: 'TP',
						created: now,
						updated: now,
						quick: s.quick ?? false
					});
				}
				tx.objectStore('studies').put({
					id: s.study,
					user: uid,
					patient: s.patient,
					modality: s.modality ?? 'xray',
					fmxSlot: s.fmxSlot,
					capturedAt: s.capturedAt ?? now,
					originalFilename: 'xray.jpg',
					findingCounts: s.findingCounts,
					created: now,
					updated: now
				});
				tx.objectStore('inferences').put({
					studyId: s.study,
					user: uid,
					inference,
					userEdits: null
				});
				tx.objectStore('files').put({
					studyId: s.study,
					kind: 'image',
					user: uid,
					blob: img,
					filename: 'xray.jpg',
					mime: 'image/jpeg'
				});
			}
			tx.objectStore('meta').put({ key: 'dataVersion:' + uid, value: Date.now() });
			await new Promise<void>((res, rej) => {
				tx.oncomplete = () => res();
				tx.onerror = () => rej(tx.error);
			});
			db.close();
		},
		{ uid, studies, inference: INFERENCE_2D, realImg: realXrayBase64() }
	);
}

function fileB64(path: string): string | null {
	try {
		return readFileSync(path).toString('base64');
	} catch {
		return null;
	}
}

const TI = '/home/yang/appv3/test_images';

/** Seed a SEGMENTED 3D study (CBCT or IOS) into IndexedDB from the test_images binaries —
 *  the volume/mesh (`image`) + its segmentation (`segmentation`). The viewers read both via
 *  freshFileUrl→object URLs, exactly as for a real study. Returns false (skips) if the
 *  fixtures aren't present (fresh clone / CI without test_images). */
export async function seed3dStudy(
	page: Page,
	opts: {
		patient: string;
		study: string;
		patientName?: string;
		modality: 'cbct' | 'ios';
		imagePath: string;
		segPath: string;
		imageMime: string;
		segMime: string;
		imageName: string;
		segName: string;
	}
): Promise<boolean> {
	const imageB64 = fileB64(opts.imagePath);
	const segB64 = fileB64(opts.segPath);
	if (!imageB64 || !segB64) return false;
	if (!page.url().startsWith('http')) await page.goto('/studies');
	const uid = await userId(page);
	await page.evaluate(
		async ({ uid, opts, imageB64, segB64 }) => {
			async function openExisting(): Promise<IDBDatabase> {
				for (let i = 0; i < 100; i++) {
					const db = await new Promise<IDBDatabase>((res, rej) => {
						const r = indexedDB.open('dxv-local');
						r.onsuccess = () => res(r.result);
						r.onerror = () => rej(r.error);
					});
					if (db.objectStoreNames.contains('studies')) return db;
					db.close();
					await new Promise((r) => setTimeout(r, 100));
				}
				throw new Error('dxv-local not initialised');
			}
			function b64ToBlob(b64: string, mime: string): Blob {
				const bin = atob(b64);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				return new Blob([bytes], { type: mime });
			}
			const db = await openExisting();
			const now = new Date().toISOString();
			const tx = db.transaction(['patients', 'studies', 'files', 'meta'], 'readwrite');
			tx.objectStore('patients').put({
				id: opts.patient,
				user: uid,
				name: opts.patientName ?? '3D Patient',
				initials: '3D',
				created: now,
				updated: now,
				quick: false
			});
			tx.objectStore('studies').put({
				id: opts.study,
				user: uid,
				patient: opts.patient,
				modality: opts.modality,
				capturedAt: now,
				originalFilename: opts.imageName,
				created: now,
				updated: now
			});
			tx.objectStore('files').put({
				studyId: opts.study,
				kind: 'image',
				user: uid,
				blob: b64ToBlob(imageB64, opts.imageMime),
				filename: opts.imageName,
				mime: opts.imageMime
			});
			tx.objectStore('files').put({
				studyId: opts.study,
				kind: 'segmentation',
				user: uid,
				blob: b64ToBlob(segB64, opts.segMime),
				filename: opts.segName,
				mime: opts.segMime
			});
			tx.objectStore('meta').put({ key: 'dataVersion:' + uid, value: Date.now() });
			await new Promise<void>((res, rej) => {
				tx.oncomplete = () => res();
				tx.onerror = () => rej(tx.error);
			});
			db.close();
		},
		{ uid, opts, imageB64, segB64 }
	);
	return true;
}

/** Seed a segmented CBCT study (tooth.nrrd volume + its seg zip). */
export async function seedCbctStudy(
	page: Page,
	patient: string,
	study: string,
	patientName = 'CBCT Patient'
): Promise<boolean> {
	return seed3dStudy(page, {
		patient,
		study,
		patientName,
		modality: 'cbct',
		imagePath: `${TI}/tooth.nrrd`,
		segPath: `${TI}/cbct-seg.zip`,
		imageMime: 'application/octet-stream',
		segMime: 'application/zip',
		imageName: 'tooth.nrrd',
		segName: 'pred_seg.zip'
	});
}

/** Seed a segmented IOS study (ios_test.obj mesh + its seg glb). */
export async function seedIosStudy(
	page: Page,
	patient: string,
	study: string,
	patientName = 'IOS Patient'
): Promise<boolean> {
	return seed3dStudy(page, {
		patient,
		study,
		patientName,
		modality: 'ios',
		imagePath: `${TI}/ios_test.obj`,
		segPath: `${TI}/ios-seg.glb`,
		imageMime: 'application/octet-stream',
		segMime: 'model/gltf-binary',
		imageName: 'ios_test.obj',
		segName: 'pred_seg.glb'
	});
}

/** Seed a RAW (un-segmented) 3D study — only the `image` blob, NO segmentation, so the
 *  viewer shows the "Run AI segmentation" CTA (the billable entry point). Returns false if
 *  the fixture is absent. */
export async function seed3dRaw(
	page: Page,
	opts: {
		patient: string;
		study: string;
		patientName?: string;
		modality: 'cbct' | 'ios';
		imagePath: string;
		imageMime: string;
		imageName: string;
	}
): Promise<boolean> {
	const imageB64 = fileB64(opts.imagePath);
	if (!imageB64) return false;
	if (!page.url().startsWith('http')) await page.goto('/studies');
	const uid = await userId(page);
	await page.evaluate(
		async ({ uid, opts, imageB64 }) => {
			async function openExisting(): Promise<IDBDatabase> {
				for (let i = 0; i < 100; i++) {
					const db = await new Promise<IDBDatabase>((res, rej) => {
						const r = indexedDB.open('dxv-local');
						r.onsuccess = () => res(r.result);
						r.onerror = () => rej(r.error);
					});
					if (db.objectStoreNames.contains('studies')) return db;
					db.close();
					await new Promise((r) => setTimeout(r, 100));
				}
				throw new Error('dxv-local not initialised');
			}
			function b64ToBlob(b64: string, mime: string): Blob {
				const bin = atob(b64);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				return new Blob([bytes], { type: mime });
			}
			const db = await openExisting();
			const now = new Date().toISOString();
			const tx = db.transaction(['patients', 'studies', 'files', 'meta'], 'readwrite');
			tx.objectStore('patients').put({
				id: opts.patient,
				user: uid,
				name: opts.patientName ?? '3D Patient',
				initials: '3D',
				created: now,
				updated: now,
				quick: false
			});
			tx.objectStore('studies').put({
				id: opts.study,
				user: uid,
				patient: opts.patient,
				modality: opts.modality,
				capturedAt: now,
				originalFilename: opts.imageName,
				created: now,
				updated: now
			});
			tx.objectStore('files').put({
				studyId: opts.study,
				kind: 'image',
				user: uid,
				blob: b64ToBlob(imageB64, opts.imageMime),
				filename: opts.imageName,
				mime: opts.imageMime
			});
			tx.objectStore('meta').put({ key: 'dataVersion:' + uid, value: Date.now() });
			await new Promise<void>((res, rej) => {
				tx.oncomplete = () => res();
				tx.onerror = () => rej(tx.error);
			});
			db.close();
		},
		{ uid, opts, imageB64 }
	);
	return true;
}

/** Seed a RAW CBCT (tooth.nrrd volume, no seg). */
export async function seedCbctRaw(
	page: Page,
	patient: string,
	study: string,
	patientName = 'CBCT Raw Patient'
): Promise<boolean> {
	return seed3dRaw(page, {
		patient,
		study,
		patientName,
		modality: 'cbct',
		imagePath: `${TI}/tooth.nrrd`,
		imageMime: 'application/octet-stream',
		imageName: 'tooth.nrrd'
	});
}

/** Seed a RAW IOS (ios_test.obj mesh, no seg). */
export async function seedIosRaw(
	page: Page,
	patient: string,
	study: string,
	patientName = 'IOS Raw Patient'
): Promise<boolean> {
	return seed3dRaw(page, {
		patient,
		study,
		patientName,
		modality: 'ios',
		imagePath: `${TI}/ios_test.obj`,
		imageMime: 'application/octet-stream',
		imageName: 'ios_test.obj'
	});
}

/** Seed a PANORAMIC study (pan.png) with a synthetic `number_result` covering all 32 teeth,
 *  spread across the image, so the patient-page FMX grid derives a "patch" crop for every
 *  surrounding slot. The bboxes are absolute pixel coords of pan.png (1562×810). Returns false
 *  if pan.png is absent. */
export async function seedPanoramicStudy(
	page: Page,
	patient: string,
	study: string,
	patientName = 'Pano Patient'
): Promise<boolean> {
	const imgB64 = fileB64(`${TI}/pan.png`);
	if (!imgB64) return false;
	const W = 1562;
	// 32 teeth (labels 0..31 → universal 1..32), upper arch in the top band, lower in the
	// bottom band, spread left→right so every FMX slot's teeth are present.
	const labels: number[] = [];
	const bboxes: [number, number, number, number][] = [];
	for (let i = 0; i < 32; i++) {
		labels.push(i);
		const inArch = i % 16; // 0..15 across the arch
		const cx = Math.round(50 + (inArch / 15) * (W - 100));
		const cy = i < 16 ? 230 : 560; // upper / lower band
		bboxes.push([cx - 19, cy - 60, cx + 19, cy + 60]);
	}
	const inference = { extra: { number_result: { result: { labels, bboxes } } } };
	if (!page.url().startsWith('http')) await page.goto('/studies');
	const uid = await userId(page);
	await page.evaluate(
		async ({ uid, patient, study, patientName, imgB64, inference }) => {
			async function openExisting(): Promise<IDBDatabase> {
				for (let i = 0; i < 100; i++) {
					const db = await new Promise<IDBDatabase>((res, rej) => {
						const r = indexedDB.open('dxv-local');
						r.onsuccess = () => res(r.result);
						r.onerror = () => rej(r.error);
					});
					if (db.objectStoreNames.contains('studies')) return db;
					db.close();
					await new Promise((r) => setTimeout(r, 100));
				}
				throw new Error('dxv-local not initialised');
			}
			const bin = atob(imgB64);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			const blob = new Blob([bytes], { type: 'image/png' });
			const db = await openExisting();
			const now = new Date().toISOString();
			const tx = db.transaction(
				['patients', 'studies', 'inferences', 'files', 'meta'],
				'readwrite'
			);
			tx.objectStore('patients').put({
				id: patient,
				user: uid,
				name: patientName,
				initials: 'PP',
				created: now,
				updated: now,
				quick: false
			});
			tx.objectStore('studies').put({
				id: study,
				user: uid,
				patient,
				modality: 'panoramic',
				capturedAt: now,
				originalFilename: 'pan.png',
				created: now,
				updated: now
			});
			tx.objectStore('inferences').put({ studyId: study, user: uid, inference, userEdits: null });
			tx.objectStore('files').put({
				studyId: study,
				kind: 'image',
				user: uid,
				blob,
				filename: 'pan.png',
				mime: 'image/png'
			});
			tx.objectStore('meta').put({ key: 'dataVersion:' + uid, value: Date.now() });
			await new Promise<void>((res, rej) => {
				tx.oncomplete = () => res();
				tx.onerror = () => rej(tx.error);
			});
			db.close();
		},
		{ uid, patient, study, patientName, imgB64, inference }
	);
	return true;
}

/** Write a single row into a per-study state store (cbctReportState / iosState / studyReportState)
 *  directly in IndexedDB — the local-first replacement for the old "seed a PB record" step the
 *  persistence specs used. Call AFTER the study is seeded. The `fields` are merged with user+study. */
export async function seedStateRow(
	page: Page,
	store: 'cbctReportState' | 'iosState' | 'studyReportState',
	study: string,
	fields: Record<string, unknown>
): Promise<void> {
	if (!page.url().startsWith('http')) await page.goto('/studies');
	const uid = await userId(page);
	await page.evaluate(
		async ({ uid, store, study, fields }) => {
			const db: IDBDatabase = await new Promise((res, rej) => {
				const r = indexedDB.open('dxv-local');
				r.onsuccess = () => res(r.result);
				r.onerror = () => rej(r.error);
			});
			const now = new Date().toISOString();
			const id = ('seedstate' + study).slice(0, 15);
			const tx = db.transaction([store, 'meta'], 'readwrite');
			tx.objectStore(store).put({ id, user: uid, study, created: now, updated: now, ...fields });
			tx.objectStore('meta').put({ key: 'dataVersion:' + uid, value: Date.now() });
			await new Promise<void>((res, rej) => {
				tx.oncomplete = () => res();
				tx.onerror = () => rej(tx.error);
			});
			db.close();
		},
		{ uid, store, study, fields }
	);
}

/** Seed N distinct patients (each with one X-ray study) — for the pagination / patient-grid
 *  specs that need more than one page of cards. Ids are deterministic 15-char `[a-z0-9]`. */
export async function seedManyPatients(page: Page, n: number): Promise<void> {
	const pad = (i: number) => String(i).padStart(4, '0');
	const studies: SeedStudy[] = [];
	for (let i = 0; i < n; i++) {
		studies.push({
			patient: `seedgridpat${pad(i)}`.slice(0, 15),
			study: `seedgridstd${pad(i)}`.slice(0, 15),
			patientName: `Grid Patient ${pad(i)}`,
			findingCounts: FINDING_COUNTS_2D
		});
	}
	await seedXrayStudies(page, studies);
}

/** Read a study's userEdits from IndexedDB (the local-first replacement for the old PB
 *  `GET /collections/studies/records/<id>` the detection-editor specs used). */
/** Read all rows of a local store (patients/studies/inferences/...) from IndexedDB. */
export async function readAll<T = Record<string, unknown>>(
	page: Page,
	store: string
): Promise<T[]> {
	return page.evaluate(async (store): Promise<T[]> => {
		const db: IDBDatabase = await new Promise((res, rej) => {
			const r = indexedDB.open('dxv-local');
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		});
		if (!db.objectStoreNames.contains(store)) {
			db.close();
			return [];
		}
		const rows: T[] = await new Promise((res, rej) => {
			const req = db.transaction(store).objectStore(store).getAll();
			req.onsuccess = () => res(req.result);
			req.onerror = () => rej(req.error);
		});
		db.close();
		return rows;
	}, store);
}

/** Read a study's 2D report state (study_report_state mirror) from IndexedDB. */
export async function readStudyReport(
	page: Page,
	studyId: string
): Promise<{ reportText?: string; status?: string } | null> {
	return page.evaluate(async (studyId) => {
		const db: IDBDatabase = await new Promise((res, rej) => {
			const r = indexedDB.open('dxv-local');
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		});
		const all: { study: string; reportText?: string; status?: string }[] = await new Promise(
			(res, rej) => {
				const req = db.transaction('studyReportState').objectStore('studyReportState').getAll();
				req.onsuccess = () => res(req.result);
				req.onerror = () => rej(req.error);
			}
		);
		db.close();
		return all.find((r) => r.study === studyId) ?? null;
	}, studyId);
}

export interface UserEditsRead {
	hidden?: number[];
	added?: { box: number[]; kind?: string; points?: number[][] }[];
}
export async function readUserEdits(page: Page, studyId: string): Promise<UserEditsRead | null> {
	return page.evaluate(async (studyId): Promise<UserEditsRead | null> => {
		const db: IDBDatabase = await new Promise((res, rej) => {
			const r = indexedDB.open('dxv-local');
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		});
		const rec: { userEdits?: UserEditsRead | null } | undefined = await new Promise((res, rej) => {
			const req = db.transaction('inferences').objectStore('inferences').get(studyId);
			req.onsuccess = () => res(req.result);
			req.onerror = () => rej(req.error);
		});
		db.close();
		return rec?.userEdits ?? null;
	}, studyId);
}
