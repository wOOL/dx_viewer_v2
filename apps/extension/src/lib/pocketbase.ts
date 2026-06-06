import { logger } from '@be-certain/core/logger';
import { pb } from '@be-certain/core/pb';

const STORAGE_KEY = 'pb_auth';
const log = logger.scoped('ext-pb');

/**
 * Wire the SHARED core PocketBase singleton (`@be-certain/core/pb`) up for the
 * extension environment: persist auth changes to chrome.storage.local instead of
 * cookies/localStorage (service workers have neither). Core's `apiFetch`/`ai`
 * helpers read `pb.authStore.token` off the same singleton, so once auth is
 * restored here every AI call is authenticated with no further plumbing.
 *
 * Call once at service-worker startup, then `await restoreAuth()`.
 */
export function initExtensionAuthPersistence(): void {
	log.info('Initialising extension auth persistence');
	pb.authStore.onChange(() => {
		if (pb.authStore.isValid) {
			log.debug('Auth persisted to storage');
			chrome.storage.local.set({
				[STORAGE_KEY]: {
					token: pb.authStore.token,
					model: pb.authStore.record
				}
			});
		} else {
			log.debug('Auth cleared from storage');
			chrome.storage.local.remove(STORAGE_KEY);
		}
	});
}

/**
 * Restore auth state from chrome.storage.local into the shared PB client.
 * Returns true if a valid session was restored.
 */
export async function restoreAuth(): Promise<boolean> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	const stored = result[STORAGE_KEY] as Record<string, unknown> | undefined;

	if (stored && typeof stored.token === 'string' && stored.token.length > 0) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		pb.authStore.save(stored.token, stored.model as any);
		log.info('Auth restored from storage', { valid: pb.authStore.isValid });
		return pb.authStore.isValid;
	}

	log.debug('No stored auth found');
	return false;
}

/** Clear stored auth */
export async function clearStoredAuth(): Promise<void> {
	await chrome.storage.local.remove(STORAGE_KEY);
}

export { pb };
