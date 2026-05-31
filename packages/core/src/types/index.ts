/**
 * Re-exports from `@be-certain/pb-openapi`.
 *
 * Backend contract types live in the OpenAPI spec at
 * `packages/pb-openapi/spec.yaml`. This file gives core's consumers stable
 * import paths (`@be-certain/core/types`) without coupling them to the
 * codegen package directly.
 */

export type {
	// Errors
	MessageError,
	PaywallMessage,
	PaywallError,
	StripeError,
	AiError,
	PocketBaseFieldError,
	PocketBaseFieldErrors,

	// Auth
	User,
	AuthResponse,
	AuthWithPasswordRequest,
	AuthWithOtpRequest,
	RequestOtpRequest,
	RequestOtpResponse,
	SignupRequest,

	// Consent
	ConsentCheckResponse,
	ConsentAgreeResponse,

	// Subscriptions
	SubscriptionStatus,
	Subscription,
	PocketBaseListResult,

	// Stripe
	CreateSubscriptionRequest,
	CreateSubscriptionResponse,
	CreateCheckoutSessionRequest,
	CreateCheckoutSessionResponse,
	CancelSubscriptionResponse,
	StripePlan,
	StripePlansResponse,

	// 2D AI
	XrayBoundingBox,
	XrayExtra,
	XrayResponse,
	FindXrayRequest,
	InferenceMetaData,
	InferenceRequest,
	Mask,
	BBox,
	GenericDetectionResult,
	DiseaseDetectionResult,
	AnatomyResult,
	DiseaseResult,
	NumberResult,
	InferenceExtra,
	AnalysisResponse,

	// 3D AI
	CbctSegMetaData,
	IosSegMetaData
} from '@be-certain/pb-openapi/types';

export {
	DISEASE_LABELS,
	UNI_TOOTH_NUMBER_CLASSES,
	FDI_TOOTH_NUMBER_CLASSES,
	MOLAR_CLASS_IDX,
	MOLAR_LABEL_IDS,
	SEG_CLS2ID,
	SEG_ID2CLS,
	XRAY_CLASSES,
	ROI_CLASSES,
	ANOMALY_TEXT,
	NO_SEGMENT_TEXT,
	PAYWALL_MESSAGES
} from '@be-certain/pb-openapi/constants';
export type { DiseaseLabel, DiseaseName, AnatomyClass, AnatomyClassId } from '@be-certain/pb-openapi/constants';

// ─── App-level types not in the OpenAPI spec ─────────────────────────────────

/** A single disease finding ready for UI rendering. */
export interface XrayFinding {
	disease: string;
	confidence: number;
	bbox: [number, number, number, number];
}

/** Site adapter for the browser extension — describes how to inject the overlay UI into a third-party dental platform. */
export interface SiteAdapter {
	/** Human-readable name of the adapted site */
	name: string;
	/** URL pattern(s) to match this adapter against */
	matchPatterns: string[];
	/** Element ID for the <img> tag to replace with AI detection overlay */
	imageId: string;
	/** Element ID for a notes textarea/input to fill with the report */
	notesId?: string;
	/** Element ID for a file upload <input type="file"> to attach result JSON */
	fileUploadId?: string;
}
