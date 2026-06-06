// Pure helpers for the home dashboard (the redesigned /studies homepage). Kept out of
// the component so the metric + recency logic is unit-testable without rendering.
import type { StoredPatient } from './types';

export interface DashboardMetrics {
	/** Real (non-quick) patients. */
	totalPatients: number;
	/** Every study/analysis on record (including throwaway quick-analyze ones — they
	 *  were still analyses the clinician ran). */
	totalAnalyses: number;
	/** Studies uploaded/analyzed in the last 7 days (by PB `created`, falling back to
	 *  `capturedAt`). */
	analysesThisWeek: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function computeMetrics(patients: StoredPatient[], now: number): DashboardMetrics {
	let totalPatients = 0;
	let totalAnalyses = 0;
	let analysesThisWeek = 0;
	for (const p of patients) {
		if (!p.quick) totalPatients++;
		for (const s of p.studies) {
			totalAnalyses++;
			const t = Date.parse(s.created ?? s.capturedAt ?? '');
			if (Number.isFinite(t) && t <= now && now - t <= WEEK_MS) analysesThisWeek++;
		}
	}
	return { totalPatients, totalAnalyses, analysesThisWeek };
}

export interface RecentPatient {
	id: string;
	name: string;
	initials: string;
	/** ISO date of the patient's most recent study (their latest analysis). */
	date: string;
}

/** The N most-recently-analyzed real patients (by `lastCapture`), for the homepage
 *  "Recent Analyses" strip. Quick/throwaway and study-less patients are excluded. */
export function recentPatients(patients: StoredPatient[], limit = 3): RecentPatient[] {
	return patients
		.filter((p) => !p.quick && p.studies.length > 0)
		.slice()
		.sort((a, b) => (b.lastCapture ?? '').localeCompare(a.lastCapture ?? ''))
		.slice(0, Math.max(0, limit))
		.map((p) => ({ id: p.id, name: p.name, initials: p.initials, date: p.lastCapture }));
}
