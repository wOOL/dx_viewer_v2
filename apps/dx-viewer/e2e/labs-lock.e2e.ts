import { test, expect } from '@playwright/test';

// labs_enabled is ADMIN-ONLY (migration 1781200000): the Labs gate fronts internal-only
// features, so a normal user must not be able to flip it on themselves — not at signup
// (open createRule) and not via self-update. This drives the REAL PocketBase API with a
// throwaway non-admin user (unique email per run; self-deleted at the end — deleteRule
// allows id = @request.auth.id — so no residue; a run dying mid-test leaves at most one
// inert flagless user). The demo account is never touched.

const PB = 'https://pbapi.becertain.ai';

test('labs_enabled cannot be flipped by a normal user (signup smuggle + self-PATCH both refused)', async ({
	request
}) => {
	test.skip(!process.env.E2E_PASSWORD, 'suite convention — runs against the live backend');
	const email = `labslock-${Date.now()}@e2e.becertain.ai`;
	const password = 'LabsLockProbe12345!';

	// 1) Smuggling the flag into an open signup is refused outright.
	const smuggle = await request.post(`${PB}/api/collections/users/records`, {
		data: { email, password, passwordConfirm: password, name: 'probe', labs_enabled: true }
	});
	expect(smuggle.status()).toBe(400);

	// 2) A legit signup (no mention of the field) still works and defaults the flag OFF.
	const signup = await request.post(`${PB}/api/collections/users/records`, {
		data: { email, password, passwordConfirm: password, name: 'probe' }
	});
	expect(signup.ok()).toBe(true);
	expect((await signup.json()).labs_enabled).toBe(false);

	const auth = await request.post(`${PB}/api/collections/users/auth-with-password`, {
		data: { identity: email, password }
	});
	expect(auth.ok()).toBe(true);
	const { token, record } = await auth.json();
	const headers = { Authorization: token };

	try {
		// 3) Self-escalation via PATCH is refused (PB masks a rule-refused update as 404).
		const escalate = await request.patch(`${PB}/api/collections/users/records/${record.id}`, {
			headers,
			data: { labs_enabled: true }
		});
		expect(escalate.ok()).toBe(false);

		// …and the flag really did not move.
		const refresh = await request.post(`${PB}/api/collections/users/auth-refresh`, { headers });
		expect((await refresh.json()).record.labs_enabled).toBe(false);

		// 4) Ordinary self-updates (the Settings toggles path) are NOT collateral damage.
		const legit = await request.patch(`${PB}/api/collections/users/records/${record.id}`, {
			headers,
			data: { enable3d: true }
		});
		expect(legit.ok()).toBe(true);
	} finally {
		// 5) Cleanup: the probe user deletes itself.
		const del = await request.delete(`${PB}/api/collections/users/records/${record.id}`, {
			headers
		});
		expect(del.status()).toBe(204);
	}
});
