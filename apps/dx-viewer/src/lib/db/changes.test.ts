import { describe, it, expect, vi } from 'vitest';
import { onDataChanged, makeChangeDispatcher, type DataChangeKind } from './changes';

// Node ≥18 has BroadcastChannel. A channel never receives its own messages, so the test
// posts from a SECOND channel with the same name (exactly what another tab does).
describe('cross-tab data-change signal', () => {
	it("delivers 'write' and 'replace' kinds (and coerces unknown payloads to 'write')", async () => {
		const got: DataChangeKind[] = [];
		const unsub = onDataChanged((k) => got.push(k));
		const sender = new BroadcastChannel('dxv-local-changes');
		(sender as unknown as { unref?: () => void }).unref?.();
		sender.postMessage('write');
		sender.postMessage('replace');
		sender.postMessage(1 as never); // legacy/unknown payload → 'write'
		await new Promise((r) => setTimeout(r, 50));
		expect(got).toEqual(['write', 'replace', 'write']);
		unsub();
		sender.close();
	});
});

describe('makeChangeDispatcher (the receiving tab dispatch policy)', () => {
	function harness() {
		const refresh = vi.fn();
		const hardReload = vi.fn();
		const dispatch = makeChangeDispatcher({ refresh, hardReload, delayMs: 250 });
		return { refresh, hardReload, dispatch };
	}

	it('a burst of writes debounces into ONE refresh', () => {
		vi.useFakeTimers();
		try {
			const { refresh, hardReload, dispatch } = harness();
			dispatch('write');
			vi.advanceTimersByTime(100);
			dispatch('write');
			dispatch('write');
			vi.advanceTimersByTime(250);
			expect(refresh).toHaveBeenCalledTimes(1);
			expect(hardReload).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("'replace' dispatches hardReload, and a TRAILING write cannot downgrade it (sticky)", () => {
		// The regression this pins: restore/import in tab A + a follow-up write landing
		// in the same debounce window — a plain refresh would re-attach PRE-replace
		// object URLs and this tab would show stale scans.
		vi.useFakeTimers();
		try {
			const { refresh, hardReload, dispatch } = harness();
			dispatch('replace');
			vi.advanceTimersByTime(100);
			dispatch('write'); // re-arms the debounce but must NOT downgrade
			vi.advanceTimersByTime(250);
			expect(hardReload).toHaveBeenCalledTimes(1);
			expect(refresh).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a write BEFORE the replace upgrades too (order-independent within the window)', () => {
		vi.useFakeTimers();
		try {
			const { refresh, hardReload, dispatch } = harness();
			dispatch('write');
			dispatch('replace');
			vi.advanceTimersByTime(250);
			expect(hardReload).toHaveBeenCalledTimes(1);
			expect(refresh).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a REJECTING reload is contained (no unhandled rejection) and later signals still dispatch', async () => {
		vi.useFakeTimers();
		try {
			const refresh = vi.fn();
			const hardReload = vi.fn().mockRejectedValue(new Error('idb blip'));
			const dispatch = makeChangeDispatcher({ refresh, hardReload, delayMs: 250 });
			dispatch('replace');
			vi.advanceTimersByTime(250);
			await vi.runAllTimersAsync(); // settle the contained rejection
			expect(hardReload).toHaveBeenCalledTimes(1);
			dispatch('write'); // the dispatcher survives and keeps working
			vi.advanceTimersByTime(250);
			expect(refresh).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('stickiness RESETS after firing — the next plain write is a plain refresh again', () => {
		vi.useFakeTimers();
		try {
			const { refresh, hardReload, dispatch } = harness();
			dispatch('replace');
			vi.advanceTimersByTime(250);
			expect(hardReload).toHaveBeenCalledTimes(1);
			dispatch('write');
			vi.advanceTimersByTime(250);
			expect(refresh).toHaveBeenCalledTimes(1);
			expect(hardReload).toHaveBeenCalledTimes(1); // unchanged
		} finally {
			vi.useRealTimers();
		}
	});
});
