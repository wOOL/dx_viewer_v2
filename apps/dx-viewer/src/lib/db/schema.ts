// Local-first data model — the IndexedDB row shapes. Each store mirrors a PocketBase
// patient-data collection 1:1 (see new_feat/local_first_design.md): a backup is a
// mechanical store→collection copy. Every row carries `user` (the owning clinician's
// auth id) so queries are user-scoped exactly like PB's `user = @request.auth.id` rules
// — a second clinician logging into the same browser sees only their own rows.
//
// The `studies` entity is physically split across three tables for bounded memory
// (refresh must never pull multi-MB inference blobs or binary files into RAM at scale):
//   studies     — light scalar/meta columns (mirrors STUDY_LIST_FIELDS)
//   inferences  — the heavy inference JSON + userEdits (lazy, like ensureInference)
//   files        — the binary image / segmentation blobs (lazy, viewer-only)
// Logically the three reconstitute one PB `studies` row + its two file fields.

import type { InferenceResponse, UserEdits } from '$lib/types';

/** Bump when a breaking change to the export/backup wire format requires migration. */
export const SCHEMA_VERSION = 1;

export interface DbPatient {
	id: string;
	user: string;
	name: string;
	dob?: string | null;
	initials?: string;
	ringColors?: [string, string] | string[];
	quick?: boolean;
	created: string;
	updated: string;
}

export interface DbStudy {
	id: string;
	user: string;
	patient: string;
	modality: string;
	fmxSlot?: string;
	capturedAt?: string;
	originalFilename?: string;
	findingCounts?: Record<string, number>;
	severityScore?: number;
	created: string;
	updated: string;
}

export interface DbInference {
	studyId: string;
	user: string;
	inference?: InferenceResponse | null;
	userEdits?: UserEdits | null;
}

export type FileKind = 'image' | 'segmentation';

export interface DbFile {
	studyId: string;
	kind: FileKind;
	user: string;
	blob: Blob;
	filename: string;
	mime: string;
}

export interface DbStudyReportState {
	id: string;
	user: string;
	study: string;
	reportText?: string;
	status?: string;
	created: string;
	updated: string;
}

export interface DbCbctReportState {
	id: string;
	user: string;
	study: string;
	signedBy?: string;
	signedAt?: string | null;
	approvedTeeth?: number[];
	comments?: Record<string, string>;
	markups?: unknown;
	hiddenMeshes?: string[];
	created: string;
	updated: string;
}

export interface DbIosState {
	id: string;
	user: string;
	study: string;
	measures?: unknown;
	hiddenMeshes?: string[];
	created: string;
	updated: string;
}

export interface DbMeta {
	key: string;
	value: unknown;
}

/** A delete tombstone, written IN THE SAME TX as the delete it records. Without these,
 *  a diff-then-merge restore cannot tell "deleted here" from "created elsewhere" — every
 *  backup-only row would silently resurrect, including deliberately erased PHI. Only the
 *  two user-deletable units get tombstones; their children (inference/files/state)
 *  suppress via parent cascade in the merge plan. Not GC'd in v1 (rows are tiny, and a
 *  TTL would let an old export resurrect a deletion the tombstone existed to prevent). */
export interface DbDeletion {
	table: 'patients' | 'studies';
	id: string;
	user: string;
	deletedAt: string;
}

/** Per-user backup pointer (the online backup's data-version + timestamp), used by the
 *  unified restore/import gate. */
export interface BackupPointer {
	at: number;
	dataVersion: number;
}

/** A full per-user snapshot — the unit of export (.zip) and online backup/restore. The
 *  binary blobs ride in `files`; everything else is plain JSON. `tombstones` is optional
 *  (absent on snapshots from before the merge feature): exports carry them so a zip moved
 *  to a fresh device preserves deletion intent; the server upload ignores them (no PB
 *  collection in v1). */
export interface UserSnapshot {
	patients: DbPatient[];
	studies: DbStudy[];
	inferences: DbInference[];
	studyReportState: DbStudyReportState[];
	cbctReportState: DbCbctReportState[];
	iosState: DbIosState[];
	files: DbFile[];
	tombstones?: DbDeletion[];
	dataVersion: number;
}
