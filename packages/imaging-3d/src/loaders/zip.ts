import { unzipSync } from 'fflate';

export interface UnzippedFile {
	name: string;
	bytes: Uint8Array;
}

/**
 * Extract all files from a response blob (e.g. the zip returned by
 * `/api/ai/cbct_seg_inference`). Uses `fflate.unzipSync` for compactness
 * — call from a worker if zip sizes become a concern.
 */
export async function unzipBlob(blob: Blob): Promise<UnzippedFile[]> {
	const ab = await blob.arrayBuffer();
	const entries = unzipSync(new Uint8Array(ab));
	return Object.entries(entries).map(([name, bytes]) => ({ name, bytes }));
}

/** Pick the first entry whose filename ends with `suffix` (case-insensitive). */
export function findEntry(files: UnzippedFile[], suffix: string): UnzippedFile | null {
	const s = suffix.toLowerCase();
	return files.find((f) => f.name.toLowerCase().endsWith(s)) ?? null;
}
