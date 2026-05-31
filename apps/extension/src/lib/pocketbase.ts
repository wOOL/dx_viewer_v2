import { logger } from '@be-certain/core/logger';
import PocketBase, { type AuthRecord } from 'pocketbase';

const STORAGE_KEY = 'pb_auth';
const log = logger.scoped('ext-pb');

/**
 * Creates a PocketBase client for the extension that persists
 * its auth state to chrome.storage.local.
 *
 * Call `await restoreAuth(pb)` after creating to hydrate from storage.
 */
export function createExtensionPBClient(url: string, siteKey?: string): PocketBase {
	log.info('Creating extension PB client', { url, hasSiteKey: !!siteKey });
	const pb = new PocketBase(url);

	if (siteKey) {
		pb.beforeSend = function (_url, reqOptions) {
			reqOptions.headers = {
				...reqOptions.headers,
				'X-Site-Key': siteKey
			};
			return { url: _url, options: reqOptions };
		};
	}

	// Persist auth changes to chrome.storage.local
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

	return pb;
}

/**
 * Restore auth state from chrome.storage.local into the PB client.
 * Returns true if a valid session was restored.
 */
export async function restoreAuth(pb: PocketBase): Promise<boolean> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	const stored = result[STORAGE_KEY] as Record<string, unknown> | undefined;

	if (stored && typeof stored.token === 'string' && stored.token.length > 0) {
		pb.authStore.save(stored.token, stored.model as AuthRecord);
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
