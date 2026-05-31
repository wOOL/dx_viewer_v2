/**
 * Demo-mode store. Backs the dashboard's recent-activity card, the /history
 * route, and the developer-only data manager at /settings/demo-data with a
 * localStorage-persisted set of fake patients + analysis activities so the
 * product can be shown end-to-end before the PocketBase contract exists.
 *
 * NOTE(team): when the real `cases` / `patients` collections land in
 * PocketBase, swap consumers to those queries and delete this file plus the
 * Developer section in /settings and the /settings/demo-data route.
 */

import { browser } from '$app/environment';

const STORAGE_KEY = 'dx-demo-data-v1';

export type ScanType = 'Bitewing' | 'Panoramic' | 'Periapical' | 'CBCT' | 'IOS';
export type ActivityStatus = 'complete' | 'reviewing' | 'flagged';

export type Patient = {
	id: string;
	name: string;
	/** YYYY-MM-DD */
	dob: string;
	/** ISO datetime */
	lastVisitAt: string;
};

export type Activity = {
	id: string;
	patientId: string;
	type: ScanType;
	findings: number;
	status: ActivityStatus;
	/** ISO datetime */
	timestamp: string;
	fileName: string;
};

interface Shape {
	dashboardActivityLimit: number;
	patients: Patient[];
	activities: Activity[];
}

const DEFAULTS: Shape = {
	dashboardActivityLimit: 5,
	patients: [],
	activities: []
};

// ── Plausible-name pools ──────────────────────────────────────────────────
// Multicultural mix so the demo doesn't read as "Anglo by default". Used for
// pairwise random sampling — first × last so 28×26 ≈ 728 unique combinations.

const FIRST_NAMES = [
	'Aanya', 'Sven', 'Maya', 'Idris', 'Beatriz', 'Kenji', 'Noor', 'Aleksander',
	'Priya', 'Tomasz', 'Imani', 'Yusuke', 'Sigrid', 'Karim', 'Larsa', 'Nilufar',
	'Rohan', 'Eleni', 'Tariq', 'Anais', 'Mateus', 'Saoirse', 'Bjorn', 'Diya',
	'Hiroto', 'Astrid', 'Ezekiel', 'Lina'
] as const;

const LAST_NAMES = [
	'Bhattacharya', 'Lindqvist', 'Okonkwo', 'Karimov', 'Vasconcelos', 'Nakamura',
	'El-Sayed', 'Krzeminski', 'Chakraborty', 'Andersson', 'Ayodele', 'Tanaka',
	'Pettersson', 'Hadid', 'Tabari', 'Yusupov', 'Mehta', 'Papadakis', 'Mansour',
	'Lefebvre', 'Almeida', 'O’Sullivan', 'Holmberg', 'Reddy', 'Suzuki',
	'Bergstrom'
] as const;

const SCAN_TYPES: readonly ScanType[] = ['Bitewing', 'Panoramic', 'Periapical', 'CBCT', 'IOS'];

const FILE_EXT: Record<ScanType, string> = {
	Bitewing: 'png',
	Panoramic: 'png',
	Periapical: 'png',
	CBCT: 'nii.gz',
	IOS: 'glb'
};

// ── Random helpers ────────────────────────────────────────────────────────

function pick<T>(arr: ReadonlyArray<T>): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function uid(prefix: string): string {
	const t = Date.now().toString(36).slice(-4);
	const r = Math.random().toString(36).slice(2, 7);
	return `${prefix}-${t}${r}`;
}

function randomDobIso(): string {
	// Ages 4-85, weighted toward 25-60 by averaging two uniform draws.
	const age = Math.round((randInt(4, 85) + randInt(25, 60)) / 2);
	const d = new Date();
	d.setFullYear(d.getFullYear() - age);
	d.setMonth(randInt(0, 11));
	d.setDate(randInt(1, 28));
	return d.toISOString().slice(0, 10);
}

function randomRecentDate(maxDaysAgo: number): string {
	const offsetMs = Math.floor(Math.random() * Math.random() * maxDaysAgo * 86400000);
	return new Date(Date.now() - offsetMs).toISOString();
}

function plausibleName(): string {
	return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function poissonFindings(): number {
	// Mostly 0-5 findings, occasional outliers.
	const r = Math.random();
	if (r < 0.18) return 0;
	if (r < 0.55) return randInt(1, 3);
	if (r < 0.85) return randInt(3, 7);
	if (r < 0.97) return randInt(7, 12);
	return randInt(12, 22);
}

function pickStatus(findings: number): ActivityStatus {
	if (findings === 0) return 'complete';
	const r = Math.random();
	if (findings >= 10 && r < 0.6) return 'flagged';
	if (r < 0.2) return 'reviewing';
	return 'complete';
}

function pickType(): ScanType {
	// Weighted toward the everyday 2D modalities.
	const r = Math.random();
	if (r < 0.4) return 'Bitewing';
	if (r < 0.65) return 'Periapical';
	if (r < 0.82) return 'Panoramic';
	if (r < 0.95) return 'CBCT';
	return 'IOS';
}

function generateFileName(type: ScanType, ts: string): string {
	const d = new Date(ts);
	const yyyymmdd = d.toISOString().slice(0, 10).replaceAll('-', '');
	const hhmm = `${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}`;
	const stem = type === 'CBCT' ? 'cbct' : type === 'IOS' ? 'scan' : 'xray';
	return `${stem}_${yyyymmdd}_${hhmm}.${FILE_EXT[type]}`;
}

// ── Persistence ───────────────────────────────────────────────────────────

function isValidShape(value: unknown): value is Shape {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.dashboardActivityLimit === 'number' &&
		Array.isArray(v.patients) &&
		Array.isArray(v.activities)
	);
}

function loadFromStorage(): Shape {
	if (!browser) return structuredClone(DEFAULTS);
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return structuredClone(DEFAULTS);
		const parsed = JSON.parse(raw);
		if (!isValidShape(parsed)) return structuredClone(DEFAULTS);
		return parsed;
	} catch {
		return structuredClone(DEFAULTS);
	}
}

// ── Reactive store ────────────────────────────────────────────────────────

class DemoStore {
	dashboardActivityLimit = $state(DEFAULTS.dashboardActivityLimit);
	patients = $state<Patient[]>([]);
	activities = $state<Activity[]>([]);

	private hydrated = false;

	hydrate(): void {
		if (this.hydrated || !browser) {
			this.hydrated = true;
			return;
		}
		const stored = loadFromStorage();
		this.dashboardActivityLimit = stored.dashboardActivityLimit;
		this.patients = stored.patients;
		this.activities = stored.activities;
		this.hydrated = true;
	}

	// ── Derived views ──────────────────────────────────────────────────────

	patientById(id: string): Patient | undefined {
		return this.patients.find((p) => p.id === id);
	}

	patientName(id: string): string {
		return this.patientById(id)?.name ?? '—';
	}

	recentActivities(): Activity[] {
		const sorted = [...this.activities].sort(
			(a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
		);
		return sorted.slice(0, this.dashboardActivityLimit);
	}

	// ── Settings ───────────────────────────────────────────────────────────

	setDashboardActivityLimit(n: number): void {
		this.dashboardActivityLimit = Math.max(0, Math.min(20, Math.floor(n)));
		this.persist();
	}

	// ── Bulk ops ───────────────────────────────────────────────────────────

	regenerate(opts: { patientCount?: number; activityCount?: number } = {}): void {
		const patientCount = opts.patientCount ?? randInt(8, 14);
		const activityCount = opts.activityCount ?? randInt(18, 32);
		const newPatients: Patient[] = Array.from({ length: patientCount }, () =>
			this.makePatient()
		);
		const newActivities: Activity[] = Array.from({ length: activityCount }, () =>
			this.makeActivity(newPatients[randInt(0, newPatients.length - 1)]!.id)
		);
		this.patients = newPatients;
		this.activities = newActivities;
		this.persist();
	}

	clear(): void {
		this.patients = [];
		this.activities = [];
		this.persist();
	}

	// ── Patient CRUD ──────────────────────────────────────────────────────

	addRandomPatient(): Patient {
		const p = this.makePatient();
		this.patients = [...this.patients, p];
		this.persist();
		return p;
	}

	updatePatient(id: string, fields: Partial<Omit<Patient, 'id'>>): void {
		this.patients = this.patients.map((p) => (p.id === id ? { ...p, ...fields } : p));
		this.persist();
	}

	deletePatient(id: string): void {
		this.patients = this.patients.filter((p) => p.id !== id);
		// Cascade: drop any activities pointing at the removed patient.
		this.activities = this.activities.filter((a) => a.patientId !== id);
		this.persist();
	}

	// ── Activity CRUD ─────────────────────────────────────────────────────

	addRandomActivity(): Activity | null {
		if (this.patients.length === 0) return null;
		const patient = this.patients[randInt(0, this.patients.length - 1)]!;
		const a = this.makeActivity(patient.id);
		this.activities = [a, ...this.activities];
		this.persist();
		return a;
	}

	updateActivity(id: string, fields: Partial<Omit<Activity, 'id'>>): void {
		this.activities = this.activities.map((a) => (a.id === id ? { ...a, ...fields } : a));
		this.persist();
	}

	deleteActivity(id: string): void {
		this.activities = this.activities.filter((a) => a.id !== id);
		this.persist();
	}

	// ── Factories ─────────────────────────────────────────────────────────

	private makePatient(): Patient {
		return {
			id: uid('p'),
			name: plausibleName(),
			dob: randomDobIso(),
			lastVisitAt: randomRecentDate(180)
		};
	}

	private makeActivity(patientId: string): Activity {
		const type = pickType();
		const ts = randomRecentDate(30);
		const findings = poissonFindings();
		return {
			id: uid('a'),
			patientId,
			type,
			findings,
			status: pickStatus(findings),
			timestamp: ts,
			fileName: generateFileName(type, ts)
		};
	}

	private persist(): void {
		if (!browser) return;
		try {
			const payload: Shape = {
				dashboardActivityLimit: this.dashboardActivityLimit,
				patients: this.patients,
				activities: this.activities
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
		} catch {
			// Quota or disabled storage — silently ignore. This is demo data only.
		}
	}
}

export const demoStore = new DemoStore();
