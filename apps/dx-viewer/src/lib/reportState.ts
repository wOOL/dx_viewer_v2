// Per-(user, study) 2D report state persistence — the clinician's EDITED report text
// plus an Acceptable / Unacceptable diagnostic-quality verdict. LOCAL-FIRST: the source
// of truth is the browser's IndexedDB (`studyReportState` store, mirroring the PB
// `study_report_state` collection 1:1 for backup). The db layer's upsert handles the
// unique (user, study) constraint, so this module is a thin, testable wrapper around it.

import { localDb, type LocalDb } from '$lib/db/localDb';

export type ReportStatus = '' | 'acceptable' | 'unacceptable';

export interface LoadedReportState {
	recordId: string;
	text: string;
	status: ReportStatus;
}

/** Coerce a persisted status value into the known enum ('' when absent/garbage). */
export function normalizeReportStatus(v: unknown): ReportStatus {
	return v === 'acceptable' || v === 'unacceptable' ? v : '';
}

/** The report shown / copied / exported: the clinician's edit if non-empty, else the AI
 *  report. Pure so consumers + tests agree on the precedence. */
export function effectiveReportText(edited: string | null | undefined, aiReport: string): string {
	return edited && edited.trim() ? edited : aiReport;
}

export async function loadReportState(
	studyId: string,
	userId: string,
	db: LocalDb = localDb
): Promise<LoadedReportState | null> {
	const rec = await db.getStudyReport(userId, studyId);
	if (!rec) return null;
	return {
		recordId: rec.id,
		text: typeof rec.reportText === 'string' ? rec.reportText : '',
		status: normalizeReportStatus(rec.status)
	};
}

export async function saveReportState(
	args: {
		studyId: string;
		userId: string;
		text: string;
		status: ReportStatus;
	},
	db: LocalDb = localDb
): Promise<string> {
	const row = await db.upsertStudyReport(args.userId, args.studyId, {
		reportText: args.text,
		status: args.status
	});
	// null = the study no longer exists (deleted in another tab while a debounced save
	// was pending) — the write was correctly dropped instead of resurrecting an orphan.
	return row?.id ?? '';
}
