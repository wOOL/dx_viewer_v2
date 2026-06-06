import { describe, it, expect } from 'vitest';
import {
	validateProfile,
	isAcceptablePassword,
	isValidEmail,
	planListState,
	accountSaveErrorMessage,
	authErrorMessage,
	serverErrorMessage,
	resolveErrorMessage,
	operationErrorKey,
	capName,
	MAX_NAME_LENGTH,
	MIN_PASSWORD_LENGTH
} from './forms';

describe('validateProfile', () => {
	it('accepts a normal name and returns it trimmed', () => {
		const r = validateProfile({ name: '  Dr. Jane Smith  ' });
		expect(r.valid).toBe(true);
		expect(r.valid && r.name).toBe('Dr. Jane Smith');
	});

	it('rejects an empty name', () => {
		const r = validateProfile({ name: '' });
		expect(r.valid).toBe(false);
		expect(r.valid === false && r.reason).toBe('empty');
	});

	it('rejects a whitespace-only name', () => {
		const r = validateProfile({ name: '   \t  ' });
		expect(r.valid).toBe(false);
		expect(r.valid === false && r.reason).toBe('empty');
	});

	it('rejects a name longer than the max length (after trim)', () => {
		const r = validateProfile({ name: 'a'.repeat(MAX_NAME_LENGTH + 1) });
		expect(r.valid).toBe(false);
		expect(r.valid === false && r.reason).toBe('tooLong');
	});

	it('accepts a name exactly at the max length', () => {
		const r = validateProfile({ name: 'a'.repeat(MAX_NAME_LENGTH) });
		expect(r.valid).toBe(true);
	});

	it('measures length after trimming (surrounding spaces do not count)', () => {
		const r = validateProfile({ name: '  ' + 'a'.repeat(MAX_NAME_LENGTH) + '  ' });
		expect(r.valid).toBe(true);
		expect(r.valid && r.name.length).toBe(MAX_NAME_LENGTH);
	});
});

describe('isAcceptablePassword', () => {
	it('accepts an 8+ char password', () => {
		expect(isAcceptablePassword('hunter22')).toBe(true);
	});

	it('rejects a password shorter than the minimum', () => {
		expect(isAcceptablePassword('short')).toBe(false);
	});

	it('rejects a whitespace-only password of "valid" raw length', () => {
		expect(isAcceptablePassword(' '.repeat(MIN_PASSWORD_LENGTH))).toBe(false);
	});

	it('rejects a password whose trimmed length drops below the minimum', () => {
		// 6 real chars padded to 10 raw chars → trimmed length 6 < 8
		expect(isAcceptablePassword('  abc123  ')).toBe(false);
	});

	it('accepts a password with internal spaces (passphrase) of sufficient length', () => {
		expect(isAcceptablePassword('a b c d e')).toBe(true);
	});
});

describe('isValidEmail', () => {
	it('accepts a normal address', () => {
		expect(isValidEmail('a@b.co')).toBe(true);
		expect(isValidEmail('you@clinic.com')).toBe(true);
		expect(isValidEmail('first.last+tag@sub.example.co.uk')).toBe(true);
	});

	it('trims surrounding whitespace before validating', () => {
		expect(isValidEmail('  a@b.co  ')).toBe(true);
	});

	it('rejects empty or whitespace-only input', () => {
		expect(isValidEmail('')).toBe(false);
		expect(isValidEmail('   ')).toBe(false);
	});

	it('rejects malformed addresses', () => {
		expect(isValidEmail('a@b')).toBe(false);
		expect(isValidEmail('a@')).toBe(false);
		expect(isValidEmail('@b.co')).toBe(false);
		expect(isValidEmail('a b@c.co')).toBe(false);
		expect(isValidEmail('plainstring')).toBe(false);
	});

	it('handles null/undefined gracefully', () => {
		expect(isValidEmail(null as unknown as string)).toBe(false);
		expect(isValidEmail(undefined as unknown as string)).toBe(false);
	});
});

describe('planListState', () => {
	it('reports loading first, even with an error or plans present', () => {
		expect(planListState({ loading: true, plans: [], error: '' })).toBe('loading');
		expect(planListState({ loading: true, plans: [{}], error: 'boom' })).toBe('loading');
	});

	it('reports error when a fetch failed (error takes precedence over empty)', () => {
		expect(planListState({ loading: false, plans: [], error: 'network down' })).toBe('error');
	});

	it('reports empty when the fetch succeeded but returned no plans', () => {
		expect(planListState({ loading: false, plans: [], error: '' })).toBe('empty');
	});

	it('reports ready when plans are present', () => {
		expect(planListState({ loading: false, plans: [{}, {}], error: '' })).toBe('ready');
	});
});

describe('accountSaveErrorMessage', () => {
	it('summarizes PocketBase per-field validation errors as "field: message"', () => {
		const err = {
			message: 'Failed to update record.',
			data: { data: { name: { code: 'validation_required', message: 'Cannot be blank.' } } }
		};
		expect(accountSaveErrorMessage(err)).toEqual({ text: 'name: Cannot be blank.' });
	});

	it('joins multiple field errors with "; "', () => {
		const err = {
			data: {
				data: {
					name: { message: 'Cannot be blank.' },
					mobile: { message: 'Invalid value.' }
				}
			}
		};
		const r = accountSaveErrorMessage(err);
		expect('text' in r).toBe(true);
		expect('text' in r && r.text).toBe('name: Cannot be blank.; mobile: Invalid value.');
	});

	it('falls back to the top-level message when there are no field errors', () => {
		expect(accountSaveErrorMessage({ message: 'Something went wrong.' })).toEqual({
			text: 'Something went wrong.'
		});
	});

	it('prefers field errors over the top-level message', () => {
		const err = {
			message: 'Failed to update record.',
			data: { data: { name: { message: 'Cannot be blank.' } } }
		};
		expect(accountSaveErrorMessage(err)).toEqual({ text: 'name: Cannot be blank.' });
	});

	it('returns the generic localized key when no usable message exists', () => {
		expect(accountSaveErrorMessage({})).toEqual({ key: 'account.saveFailed' });
		expect(accountSaveErrorMessage(new Error(''))).toEqual({ key: 'account.saveFailed' });
		expect(accountSaveErrorMessage(undefined)).toEqual({ key: 'account.saveFailed' });
		expect(accountSaveErrorMessage(null)).toEqual({ key: 'account.saveFailed' });
	});

	it('treats a whitespace-only message as no message (generic key)', () => {
		expect(accountSaveErrorMessage({ message: '   ' })).toEqual({ key: 'account.saveFailed' });
	});

	it('ignores an empty field-error map and uses the next signal', () => {
		expect(accountSaveErrorMessage({ data: { data: {} }, message: 'Boom' })).toEqual({
			text: 'Boom'
		});
		expect(accountSaveErrorMessage({ data: { data: {} } })).toEqual({ key: 'account.saveFailed' });
	});

	it('skips a field whose message is empty but keeps non-empty siblings', () => {
		const err = {
			data: { data: { name: { message: '   ' }, address: { message: 'Too long.' } } }
		};
		expect(accountSaveErrorMessage(err)).toEqual({ text: 'address: Too long.' });
	});

	it('uses a real Error message when present', () => {
		expect(accountSaveErrorMessage(new Error('Network request failed'))).toEqual({
			text: 'Network request failed'
		});
	});
});

describe('authErrorMessage', () => {
	it('maps 400/401/403 to the invalid-credentials key', () => {
		expect(authErrorMessage({ status: 400 })).toEqual({ key: 'login.errInvalidCredentials' });
		expect(authErrorMessage({ status: 401 })).toEqual({ key: 'login.errInvalidCredentials' });
		expect(authErrorMessage({ status: 403 })).toEqual({ key: 'login.errInvalidCredentials' });
	});

	it('maps 404 (unknown account / not found) to the invalid-credentials key', () => {
		expect(authErrorMessage({ status: 404 })).toEqual({ key: 'login.errInvalidCredentials' });
	});

	it('maps status 0 (network failure) to the network key', () => {
		expect(authErrorMessage({ status: 0 })).toEqual({ key: 'api.networkError' });
	});

	it('maps 5xx and unexpected statuses to the generic server key', () => {
		expect(authErrorMessage({ status: 500 })).toEqual({ key: 'api.serverError' });
		expect(authErrorMessage({ status: 429 })).toEqual({ key: 'api.serverError' });
	});

	it('does NOT leak the raw PocketBase English message', () => {
		const err = { status: 401, message: 'Failed to authenticate.' };
		expect(authErrorMessage(err)).toEqual({ key: 'login.errInvalidCredentials' });
	});

	it('ignores field errors unless fields:true is passed', () => {
		const err = { status: 400, data: { data: { email: { message: 'Email already in use' } } } };
		expect(authErrorMessage(err)).toEqual({ key: 'login.errInvalidCredentials' });
	});

	it('prefers an email field message when fields:true', () => {
		const err = { status: 400, data: { data: { email: { message: 'Email already in use' } } } };
		expect(authErrorMessage(err, { fields: true })).toEqual({ text: 'Email already in use' });
	});

	it('prefers a password field message when fields:true and no email error', () => {
		const err = { status: 400, data: { data: { password: { message: 'Too short' } } } };
		expect(authErrorMessage(err, { fields: true })).toEqual({ text: 'Too short' });
	});

	it('prefers email over password when both present and fields:true', () => {
		const err = {
			status: 400,
			data: { data: { email: { message: 'Bad email' }, password: { message: 'Bad pw' } } }
		};
		expect(authErrorMessage(err, { fields: true })).toEqual({ text: 'Bad email' });
	});

	it('falls back to a status-mapped key when fields:true but no field messages', () => {
		const err = { status: 400, data: { data: {} } };
		expect(authErrorMessage(err, { fields: true })).toEqual({ key: 'login.errInvalidCredentials' });
	});

	it('returns the generic key for an error with no status', () => {
		expect(authErrorMessage(new Error('boom'))).toEqual({ key: 'api.serverError' });
	});

	it('handles null/undefined gracefully', () => {
		expect(authErrorMessage(null)).toEqual({ key: 'api.serverError' });
		expect(authErrorMessage(undefined)).toEqual({ key: 'api.serverError' });
	});
});

describe('capName (store-level patient-name cap)', () => {
	it('trims surrounding whitespace', () => {
		expect(capName('  Jane Roe  ')).toBe('Jane Roe');
	});

	it('hard-caps at MAX_NAME_LENGTH so an oversized paste cannot be persisted', () => {
		const huge = 'A'.repeat(10_000);
		expect(capName(huge)).toHaveLength(MAX_NAME_LENGTH);
	});

	it('trims BEFORE capping (leading spaces do not eat the budget)', () => {
		const name = '   ' + 'B'.repeat(MAX_NAME_LENGTH + 50);
		expect(capName(name)).toHaveLength(MAX_NAME_LENGTH);
		expect(capName(name).startsWith('B')).toBe(true);
	});

	it('handles null/undefined as empty', () => {
		expect(capName(undefined as unknown as string)).toBe('');
		expect(capName(null as unknown as string)).toBe('');
	});

	it('leaves a normal-length name unchanged', () => {
		expect(capName('María José Ñoño')).toBe('María José Ñoño');
	});
});

describe('serverErrorMessage (billing/consent — was raw .message)', () => {
	it('maps network failure (status 0) to api.networkError', () => {
		expect(serverErrorMessage({ status: 0, message: 'fetch failed' })).toEqual({
			key: 'api.networkError'
		});
	});

	it('maps 4xx to api.requestFailed', () => {
		expect(serverErrorMessage({ status: 400 })).toEqual({ key: 'api.requestFailed' });
		expect(serverErrorMessage({ status: 404 })).toEqual({ key: 'api.requestFailed' });
	});

	it('maps 5xx and unknown to api.serverError', () => {
		expect(serverErrorMessage({ status: 500 })).toEqual({ key: 'api.serverError' });
		expect(serverErrorMessage(new Error('boom'))).toEqual({ key: 'api.serverError' });
		expect(serverErrorMessage(null)).toEqual({ key: 'api.serverError' });
	});

	it('never returns a raw PB English .message (the bug it fixes)', () => {
		// A ClientResponseError shape: truthy English .message + a status. The mapper
		// must IGNORE .message and key off status, so non-English users see localized.
		const pbErr = { status: 0, message: 'Failed to authenticate.' };
		const m = serverErrorMessage(pbErr);
		expect(m).toEqual({ key: 'api.networkError' });
		expect('text' in m).toBe(false);
	});
});

describe('operationErrorKey (AI run / quick-analyze / upload / quick-assign failures)', () => {
	it('returns the contextual fallback key for a server/unknown failure', () => {
		expect(operationErrorKey({ status: 500 }, 'cbct.runFailed')).toBe('cbct.runFailed');
		expect(operationErrorKey({ status: 502 }, 'ios.runFailed')).toBe('ios.runFailed');
		expect(operationErrorKey(new Error('boom'), 'quickdrop.errGeneric')).toBe(
			'quickdrop.errGeneric'
		);
		expect(operationErrorKey(null, 'upload.errInference')).toBe('upload.errInference');
	});

	it('prefers the actionable api.networkError on a network failure (status 0)', () => {
		expect(operationErrorKey({ status: 0 }, 'cbct.runFailed')).toBe('api.networkError');
	});

	it('maps an IndexedDB quota failure to api.storageFull (not a misleading "analysis failed")', () => {
		// LOCAL-FIRST: a 300 MB CBCT on a full disk throws QuotaExceededError from the
		// local putFile — the clinician must see "storage full", not "inference failed".
		const dom = new DOMException('quota', 'QuotaExceededError');
		expect(operationErrorKey(dom, 'upload.errInference')).toBe('api.storageFull');
		// Non-DOMException shapes that still carry the name (some browsers/wrappers).
		expect(operationErrorKey({ name: 'QuotaExceededError' }, 'cbct.runFailed')).toBe(
			'api.storageFull'
		);
		// A plain error stays on the contextual fallback.
		expect(operationErrorKey(new Error('boom'), 'upload.errInference')).toBe('upload.errInference');
	});

	it('never surfaces the raw English .message (the A1 leak it fixes)', () => {
		// A PB ClientResponseError / AI-proxy 5xx: truthy English .message/body. The helper
		// must IGNORE them and return the localized fallback, not the English string.
		const pbErr = { status: 500, message: 'Internal: boom', body: { message: 'AI Error' } };
		const key = operationErrorKey(pbErr, 'cbct.runFailed');
		expect(key).toBe('cbct.runFailed');
		expect(key).not.toContain('AI Error');
		expect(key).not.toContain('Internal');
	});
});

describe('resolveErrorMessage', () => {
	const t = (k: string, o?: { values?: Record<string, string | number> }) =>
		o?.values ? `${k}:${JSON.stringify(o.values)}` : k;

	it('looks up a {key} via the translator', () => {
		expect(resolveErrorMessage({ key: 'api.networkError' }, t)).toBe('api.networkError');
	});

	it('passes interpolation values (e.g. {status}) to the translator', () => {
		expect(resolveErrorMessage({ key: 'api.serverError' }, t, { status: 503 })).toBe(
			'api.serverError:{"status":503}'
		);
	});

	it('returns a {text} result verbatim (already a sentence)', () => {
		expect(resolveErrorMessage({ text: 'email already in use' }, t)).toBe('email already in use');
	});
});
