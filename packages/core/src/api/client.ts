import PocketBase, { type AuthModel } from 'pocketbase';
import { logger } from '../logger/index.js';

const log = logger.scoped('pb');

export interface PBClientOptions {
	url: string;
	siteKey?: string;
}

/**
 * Extended PocketBase instance that retains the configured `siteKey` so raw
 * `fetch` callers (e.g. multipart-binary 3D inference) can replicate the
 * `X-Site-Key` header that `pb.beforeSend` would otherwise inject.
 */
export interface PBClient extends PocketBase {
	readonly siteKey?: string;
}

/** Create a configured PocketBase client instance. */
export function createPBClient(options: PBClientOptions): PBClient {
	log.info('Creating PocketBase client', { url: options.url, hasSiteKey: !!options.siteKey });
	const pb = new PocketBase(options.url) as PBClient;
	Object.defineProperty(pb, 'siteKey', { value: options.siteKey, enumerable: false });

	if (options.siteKey) {
		pb.beforeSend = function (url, reqOptions) {
			reqOptions.headers = {
				...reqOptions.headers,
				'X-Site-Key': options.siteKey!
			};
			return { url, options: reqOptions };
		};
	}
	return pb;
}

/** Build the standard auth + site-key headers for raw fetch callers. */
export function authHeaders(pb: PBClient): Record<string, string> {
	const headers: Record<string, string> = {};
	if (pb.authStore.token) headers.Authorization = `Bearer ${pb.authStore.token}`;
	if (pb.siteKey) headers['X-Site-Key'] = pb.siteKey;
	return headers;
}

/** Check if the current user has accepted the privacy policy */
export async function checkPolicyConsent(pb: PocketBase): Promise<boolean> {
	log.debug('Checking policy consent');
	const response = await pb.send('/api/consent/check', { method: 'GET' });
	const accepted = response?.accepted === true;
	log.debug('Policy consent result', { accepted });
	return accepted;
}

/** Record user's acceptance of the privacy policy */
export async function acceptPolicy(pb: PocketBase): Promise<void> {
	await pb.send('/api/consent/agree', { method: 'POST' });
}

/** Get the currently authenticated user, or null */
export function getCurrentUser(pb: PocketBase): AuthModel {
	return pb.authStore.model;
}

/** Check if the user is currently authenticated */
export function isAuthenticated(pb: PocketBase): boolean {
	return pb.authStore.isValid;
}

/** Sign out the current user */
export function signOut(pb: PocketBase): void {
	log.info('Signing out');
	pb.authStore.clear();
}
