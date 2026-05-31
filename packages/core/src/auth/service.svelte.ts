import PocketBase from 'pocketbase';
import { acceptPolicy as acceptPolicyApi, checkPolicyConsent } from '../api/client.js';
import { AsyncHandler } from '../async/handler.svelte.js';
import { logger } from '../logger/index.js';

const log = logger.scoped('auth');

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';

export class AuthService {
	pb!: PocketBase;

	status: AuthStatus = $state('unknown');
	policyAccepted = $state(false);
	policyError = $state<string | null>(null);

	isAuthenticated = $derived(this.status === 'authenticated');
	isUnauthenticated = $derived(this.status === 'unauthenticated');
	isReady = $derived(this.status !== 'unknown');
	user = $derived(this.pb.authStore.record);

	otpHandler = new AsyncHandler<{ otpId: string }>();
	verifyHandler = new AsyncHandler();
	registerHandler = new AsyncHandler<{ otpId: string }>();
	policyHandler = new AsyncHandler<boolean>();
	passwordResetHandler = new AsyncHandler<boolean>();
	profileHandler = new AsyncHandler<unknown>();

	constructor(pb: PocketBase) {
		this.pb = pb;
		this.status = pb.authStore.isValid ? 'authenticated' : 'unauthenticated';
		log.info('AuthService initialised', { status: this.status });

		pb.authStore.onChange(() => {
			this.status = pb.authStore.isValid ? 'authenticated' : 'unauthenticated';
			log.info('Auth status changed', { status: this.status });
		});
	}

	async requestOtp(email: string): Promise<string | null> {
		log.info('Requesting OTP', { email });
		const result = await this.otpHandler.run(async () => {
			const res = await this.pb.collection('users').requestOTP(email);
			return { otpId: res.otpId };
		});
		log.debug('OTP request result', { success: !!result });
		return result?.otpId ?? null;
	}

	async verifyOtp(otpId: string, code: string): Promise<boolean> {
		log.info('Verifying OTP');
		const result = await this.verifyHandler.run(async () => {
			await this.pb.collection('users').authWithOTP(otpId, code);
			return true;
		});
		log.debug('OTP verification result', { success: result === true });
		return result === true;
	}

	async register(email: string, name: string): Promise<string | null> {
		this.registerHandler.reset();
		const result = await this.registerHandler.run(async () => {
			const password = crypto.randomUUID();
			await this.pb.collection('users').create({
				email,
				name,
				password,
				passwordConfirm: password
			});
			const res = await this.pb.collection('users').requestOTP(email);
			return { otpId: res.otpId };
		});
		return result?.otpId ?? null;
	}

	async checkPolicy(): Promise<boolean> {
		const result = await this.policyHandler.run(() => checkPolicyConsent(this.pb));
		this.policyAccepted = result === true;
		return this.policyAccepted;
	}

	async acceptPolicy(fallback?: string): Promise<boolean> {
		this.policyError = null;
		const result = await this.policyHandler.run(
			async () => {
				await acceptPolicyApi(this.pb);
				return true;
			},
			undefined,
			fallback ?? 'Failed to accept policy'
		);
		if (result === true) {
			this.policyAccepted = true;
			return true;
		}
		this.policyError = this.policyHandler.error ?? fallback ?? 'Failed to accept policy';
		return false;
	}

	/**
	 * `/api/collections/users/request-password-reset` — sends an email with a
	 * password-reset link. Resolves true even on PB's "address may not exist"
	 * response so we never leak account existence to the UI.
	 */
	async requestPasswordReset(email: string): Promise<boolean> {
		log.info('Requesting password reset', { email });
		const result = await this.passwordResetHandler.run(async () => {
			await this.pb.collection('users').requestPasswordReset(email);
			return true;
		});
		return result === true;
	}

	/** Update the current user's profile (name / address / mobile). */
	async updateProfile(patch: { name?: string; address?: string; mobile?: string }): Promise<boolean> {
		const id = this.pb.authStore.record?.id;
		if (!id) return false;
		const result = await this.profileHandler.run(async () => {
			return await this.pb.collection('users').update(id, patch);
		});
		return result !== null;
	}

	signOut(): void {
		log.info('Signing out');
		this.pb.authStore.clear();
	}
}
