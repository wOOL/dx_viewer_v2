// Debounced persistence with a FLUSH path — the shared save scheduler for the per-study
// report/markup persisters (ReportPanel, CbctReport, CbctWorkspace, IosWorkspace). Two
// rules every persister needs:
//
//   1. A pending save must FLUSH (not drop) on unmount / study switch — an edit made
//      <debounce-ms before navigating away must still persist. (The old per-component
//      `onDestroy(() => clearTimeout(timer))` silently lost the last edit.)
//   2. The thunk passed to schedule() must SNAPSHOT its payload (study id + field
//      values) at schedule time, so a flush firing during a study switch persists the
//      EDITED study's data — never the freshly-reset state under the new study's id
//      (the exact clobber the old cancel-on-switch existed to avoid).

export interface DebouncedSave {
	/** (Re)arm the timer with a fresh save thunk; an earlier pending thunk is replaced. */
	schedule(save: () => void | Promise<void>): void;
	/** Run the pending save NOW (study switch / unmount). No-op when nothing is pending.
	 *  Fire-and-forget: an in-flight IndexedDB write completes after teardown. */
	flush(): void;
	/** Drop the pending save without running it. */
	cancel(): void;
	readonly pending: boolean;
}

export function debouncedSave(ms = 350): DebouncedSave {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let save: (() => void | Promise<void>) | undefined;
	function fire() {
		const f = save;
		timer = undefined;
		save = undefined;
		if (f) void f();
	}
	return {
		schedule(s) {
			save = s;
			clearTimeout(timer);
			timer = setTimeout(fire, ms);
		},
		flush() {
			if (timer === undefined) return;
			clearTimeout(timer);
			fire();
		},
		cancel() {
			clearTimeout(timer);
			timer = undefined;
			save = undefined;
		},
		get pending() {
			return timer !== undefined;
		}
	};
}
