/**
 * Hand-curated TypeScript types for the BeCertain PocketBase API.
 *
 * These mirror the schemas in `spec.yaml`. Run `bun run generate` (in this
 * package) to regenerate via `openapi-typescript`. Until then, both the spec
 * and these types are kept in sync by hand — the spec is the authoritative
 * contract; this file is a typed view of it.
 */

// ─── Errors ──────────────────────────────────────────────────────────────────

export interface MessageError {
	message: string;
}

export type PaywallMessage =
	| 'No Subscription'
	| 'Inactive Subscription'
	| 'Subscription Expired (Renewal Pending)';

export interface PaywallError {
	message: PaywallMessage;
}

export interface StripeError {
	error: string;
}

export interface AiError {
	message: 'AI Error';
	details: unknown;
}

export interface PocketBaseFieldError {
	code: string;
	message: string;
}

export interface PocketBaseFieldErrors {
	code: number;
	message: string;
	data: Record<string, PocketBaseFieldError>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
	id: string;
	email: string;
	name?: string;
	avatar?: string | null;
	address?: string;
	mobile?: string;
	created?: string;
	updated?: string;
	verified?: boolean;
	emailVisibility?: boolean;
}

export interface AuthResponse {
	token: string;
	record: User;
}

export interface AuthWithPasswordRequest {
	identity: string;
	password: string;
}

export interface AuthWithOtpRequest {
	otpId: string;
	password: string;
}

export interface RequestOtpRequest {
	email: string;
	turnstileToken?: string;
}

export interface RequestOtpResponse {
	otpId: string;
}

export interface SignupRequest {
	email: string;
	password: string;
	passwordConfirm: string;
	name?: string;
	turnstileToken?: string;
}

// ─── Consent ─────────────────────────────────────────────────────────────────

/** `/api/consent/check` returns the raw boolean directly. */
export type ConsentCheckResponse = boolean;

export interface ConsentAgreeResponse {
	success: true;
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

export type SubscriptionStatus =
	| 'active'
	| 'trialing'
	| 'incomplete'
	| 'incomplete_expired'
	| 'past_due'
	| 'canceled'
	| 'unpaid'
	| 'paused';

export interface Subscription {
	id: string;
	user: string;
	stripeCustomerId?: string;
	stripeSubscriptionId?: string;
	status: SubscriptionStatus;
	currentPeriodEnd?: string;
	cancelAtPeriodEnd?: boolean;
	created?: string;
	updated?: string;
}

export interface PocketBaseListResult<T> {
	page: number;
	perPage: number;
	totalItems: number;
	totalPages: number;
	items: T[];
}

// ─── Stripe ──────────────────────────────────────────────────────────────────

export interface CreateSubscriptionRequest {
	priceId: string;
}

export interface CreateSubscriptionResponse {
	clientSecret: string | null;
}

export interface CreateCheckoutSessionRequest {
	priceId: string;
	returnUrl: string;
}

export interface CreateCheckoutSessionResponse {
	url: string;
	sessionId: string;
}

export interface CancelSubscriptionResponse {
	status: 'canceled';
}

export interface StripePlan {
	id: string;
	currency: string;
	unitAmount: number;
	interval: 'day' | 'week' | 'month' | 'year';
	intervalCount?: number;
	productName: string;
	productId: string;
}

export interface StripePlansResponse {
	plans: StripePlan[];
}

// ─── 2D AI: find_xray ────────────────────────────────────────────────────────

export interface XrayBoundingBox {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface XrayExtra {
	xrayfound: boolean;
	score: number;
	width: number;
	height: number;
}

export interface XrayResponse {
	result: XrayBoundingBox | null;
	extra: XrayExtra;
}

export interface FindXrayRequest {
	image_data: string;
	meta_data?: { conf_thres?: number };
}

// ─── 2D AI: inference ────────────────────────────────────────────────────────

export interface InferenceMetaData {
	ensure_dim?: boolean;
	disease_segment?: boolean;
	disease_meta_data?: { conf_thres: number };
	number_meta_data?: { conf_thres: number; fdi_number: boolean };
	anatomy_meta_data?: { conf_thres: number };
	rule_meta_data?: { segment_conf_thres: number; limit_dim: number };
}

export interface InferenceRequest {
	image_data: string;
	meta_data?: InferenceMetaData;
}

/** RLE-encoded segmentation mask (COCO format). */
export interface Mask {
	counts: string;
	size: [number, number];
}

export type BBox = [number, number, number, number];

export interface GenericDetectionResult {
	bboxes: number[][];
	labels: number[];
	masks?: (Mask | null)[];
	scores: number[];
}

export type DiseaseDetectionResult = GenericDetectionResult;

export interface AnatomyResult {
	result: GenericDetectionResult;
	extra: { anomaly: boolean };
}

export interface DiseaseResult {
	result: DiseaseDetectionResult;
	extra: {
		bboxes_var: number[][];
		class_probs: number[][];
	};
}

export interface NumberResult {
	result: {
		bboxes: number[][];
		labels: number[];
		scores: number[];
	};
}

export interface InferenceExtra {
	anatomy_result: AnatomyResult;
	disease_result: DiseaseResult;
	number_result: NumberResult;
}

export interface AnalysisResponse {
	detection: string;
	tooth_numbers: string;
	segmentation: string;
	report: string;
	extra: InferenceExtra;
}

// ─── 3D AI: cbct_seg_inference ───────────────────────────────────────────────

export interface CbctSegMetaData {
	/** If false, returned zip also includes input_mesh.obj. Default true. */
	seg_only?: boolean;
	/** If true, zip contains results.json (3D RGB array) instead of pred_seg.gltf. */
	return_json?: boolean;
}

// ─── 3D AI: ios_seg_inference ────────────────────────────────────────────────

export type IosSegMetaData = Record<string, unknown>;
