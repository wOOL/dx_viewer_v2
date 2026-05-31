import { resolveErrorMessage } from '../errors/index.js';
import { logger } from '../logger/index.js';

const log = logger.scoped('async');

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Detect cancellation errors from any of:
 *   - PocketBase's `ClientResponseError` (sets `isAbort: true`)
 *   - Native fetch / `AbortSignal` (DOMException with `name === 'AbortError'`)
 *   - Plain `Error` thrown with `name === 'AbortError'`
 *
 * Exposed so callers can also filter out aborts in their own catch paths.
 */
export function isAbortError(e: unknown): boolean {
	if (!e || typeof e !== 'object') return false;
	const err = e as { isAbort?: boolean; name?: string };
	if (err.isAbort === true) return true;
	if (err.name === 'AbortError') return true;
	return false;
}

/**
 * Reusable async operation handler using Svelte 5 runes.
 * Manages loading, success, and error states for any async operation.
 */
export class AsyncHandler<T = unknown> {
	status = $state<AsyncStatus>('idle');
	data = $state<T | null>(null);
	error = $state<string | null>(null);

	readonly isIdle = $derived(this.status === 'idle');
	readonly isLoading = $derived(this.status === 'loading');
	readonly isSuccess = $derived(this.status === 'success');
	readonly isError = $derived(this.status === 'error');

	async run(fn: () => Promise<T>, timeoutMs?: number, fallback?: string): Promise<T | null> {
		this.status = 'loading';
		this.error = null;

		const stop = logger.time('async', 'operation');
		try {
			let result: T;
			if (timeoutMs) {
				result = await Promise.race([fn(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))]);
			} else {
				result = await fn();
			}

			this.data = result;
			this.status = 'success';
			stop({ status: 'success' });
			return result;
		} catch (e: unknown) {
			// Cancelled by the caller (`controller.abort()`) — not a failure.
			// Drop back to idle without writing an error so the UI doesn't toast
			// a misleading message after a user-initiated reset.
			if (isAbortError(e)) {
				this.status = 'idle';
				stop({ status: 'aborted' });
				return null;
			}
			const fb = fallback ?? (e instanceof Error ? e.message : '');
			this.error = resolveErrorMessage(e, fb);
			this.status = 'error';
			log.error('Operation failed', { error: this.error });
			return null;
		}
	}

	reset(): void {
		this.status = 'idle';
		this.data = null;
		this.error = null;
	}
}
