import { PAYWALL_MESSAGES } from '@be-certain/pb-openapi/constants';

const PAYWALL_PREFIXES = [
	PAYWALL_MESSAGES.NO_SUBSCRIPTION,
	PAYWALL_MESSAGES.INACTIVE_SUBSCRIPTION,
	PAYWALL_MESSAGES.EXPIRED_SUBSCRIPTION
];

/**
 * Returns true if `error` came from a paywalled AI endpoint rejecting the
 * caller for lack of an active subscription (PB_Backend.md §3 / §6).
 *
 * Accepts:
 *   - an Error/ClientResponseError-shaped object (has `.status` and/or `.response.message`)
 *   - the already-resolved message string from `AsyncHandler.error`
 *
 * Matches one of:
 *   "No Subscription"
 *   "Inactive Subscription"
 *   "Subscription Expired (Renewal Pending)"
 */
export function isApiPaywallError(error: unknown): boolean {
	const message = pickMessage(error);
	if (!message) return false;
	return PAYWALL_PREFIXES.some((p) => message.startsWith(p));
}

function pickMessage(error: unknown): string | null {
	if (typeof error === 'string') return error;
	if (!error || typeof error !== 'object') return null;
	const e = error as { response?: { message?: string }; message?: string };
	if (e.response && typeof e.response.message === 'string') return e.response.message;
	if (typeof e.message === 'string') return e.message;
	return null;
}
