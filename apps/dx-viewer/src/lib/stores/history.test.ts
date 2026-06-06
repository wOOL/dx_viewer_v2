import { describe, it, expect, beforeEach } from 'vitest';
import { history } from './history.svelte';

// The "Recently viewed" store (TopBar dropdown): de-dupe by studyId, newest-first,
// cap at MAX (12). localStorage I/O is browser-guarded + try/caught, so the
// in-memory list logic runs fine in node. Reset between cases via clear().
function entry(studyId: string, patientId = 'p1') {
	return { patientId, studyId, patientName: 'A', modality: 'xray', kind: 'viewer' as const };
}

describe('history store', () => {
	beforeEach(() => history.clear());

	it('records newest-first and de-dupes by studyId (a re-visit bumps to front)', () => {
		history.record(entry('s1'));
		history.record(entry('s2'));
		history.record(entry('s1')); // re-visit s1
		expect(history.entries.map((e) => e.studyId)).toEqual(['s1', 's2']); // bumped, no dup
	});

	it('caps at 12, dropping the oldest', () => {
		for (let i = 0; i < 15; i++) history.record(entry(`s${i}`));
		expect(history.entries).toHaveLength(12);
		expect(history.entries[0]!.studyId).toBe('s14'); // newest at front
		expect(history.entries.some((e) => e.studyId === 's0')).toBe(false); // oldest dropped
	});

	it('ignores entries missing studyId or patientId', () => {
		history.record(entry('', 'p1'));
		history.record(entry('s1', ''));
		expect(history.entries).toHaveLength(0);
	});

	it('remove() drops one study; clear() empties', () => {
		history.record(entry('s1'));
		history.record(entry('s2'));
		history.remove('s1');
		expect(history.entries.map((e) => e.studyId)).toEqual(['s2']);
		history.clear();
		expect(history.entries).toHaveLength(0);
	});
});
