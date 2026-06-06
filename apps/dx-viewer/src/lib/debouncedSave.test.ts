import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debouncedSave } from './debouncedSave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debouncedSave', () => {
	it('fires the saved thunk after the debounce window', () => {
		const saver = debouncedSave(350);
		const fn = vi.fn();
		saver.schedule(fn);
		expect(saver.pending).toBe(true);
		vi.advanceTimersByTime(349);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(saver.pending).toBe(false);
	});

	it('re-scheduling replaces the pending thunk (only the LAST fires)', () => {
		const saver = debouncedSave(350);
		const a = vi.fn();
		const b = vi.fn();
		saver.schedule(a);
		vi.advanceTimersByTime(200);
		saver.schedule(b);
		vi.advanceTimersByTime(350);
		expect(a).not.toHaveBeenCalled();
		expect(b).toHaveBeenCalledTimes(1);
	});

	it('flush() runs the pending save immediately and exactly once (no later double-fire)', () => {
		const saver = debouncedSave(350);
		const fn = vi.fn();
		saver.schedule(fn);
		saver.flush();
		expect(fn).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1000);
		expect(fn).toHaveBeenCalledTimes(1); // the armed timer was cleared
	});

	it('flush() with nothing pending is a no-op', () => {
		const saver = debouncedSave(350);
		expect(() => saver.flush()).not.toThrow();
	});

	it('cancel() drops the pending save without running it', () => {
		const saver = debouncedSave(350);
		const fn = vi.fn();
		saver.schedule(fn);
		saver.cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
		expect(saver.pending).toBe(false);
	});

	it('payload-snapshot pattern: a flush after state mutated persists the SCHEDULED snapshot', () => {
		// The usage contract: callers snapshot fields into the thunk's closure.
		const saver = debouncedSave(350);
		const writes: string[] = [];
		let liveState = 'study-A edit';
		saver.schedule(
			((payload: string) => () => {
				writes.push(payload);
			})(liveState)
		);
		liveState = ''; // study switch resets component state…
		saver.flush(); // …but the flush persists the captured payload
		expect(liveState).toBe(''); // the live state really was reset before the flush
		expect(writes).toEqual(['study-A edit']);
	});
});
