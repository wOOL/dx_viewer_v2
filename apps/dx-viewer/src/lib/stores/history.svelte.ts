// Recently-viewed studies, backed by localStorage. Powers the TopBar "History"
// dropdown. Each viewer page records a visit on mount; the dropdown lists them
// newest-first and navigates back to the study.

import { browser } from '$app/environment';

export type HistoryKind = 'viewer' | 'cbct' | 'ios';

export interface HistoryEntry {
	patientId: string;
	studyId: string;
	patientName: string;
	modality: string; // 'xray' | 'cbct' | 'ios' (display only)
	kind: HistoryKind; // which viewer route to return to
	at: number; // visit timestamp (ms)
}

const KEY = 'dxv:history';
const MAX = 12;

function load(): HistoryEntry[] {
	if (!browser) return [];
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(raw) ? raw : [];
	} catch {
		return [];
	}
}

let entries = $state<HistoryEntry[]>(load());

export const history = {
	get entries() {
		return entries;
	},
	// Record (or bump) a visit: de-dupe by studyId, newest first, cap at MAX.
	record(e: Omit<HistoryEntry, 'at'>) {
		if (!e.studyId || !e.patientId) return;
		entries = [{ ...e, at: Date.now() }, ...entries.filter((x) => x.studyId !== e.studyId)].slice(
			0,
			MAX
		);
		if (browser) {
			try {
				localStorage.setItem(KEY, JSON.stringify(entries));
			} catch {
				/* localStorage may be unavailable (private mode) — best effort */
			}
		}
	},
	// Drop a study's entry — call when a study is deleted so the dropdown
	// doesn't keep listing (and linking to) a study that no longer exists.
	remove(studyId: string) {
		const next = entries.filter((x) => x.studyId !== studyId);
		if (next.length === entries.length) return; // nothing to drop
		entries = next;
		if (browser) {
			try {
				localStorage.setItem(KEY, JSON.stringify(entries));
			} catch {
				/* best effort */
			}
		}
	},
	clear() {
		entries = [];
		if (browser) {
			try {
				localStorage.removeItem(KEY);
			} catch {
				/* best effort */
			}
		}
	}
};
