// Self-contained popup/background i18n (replaces the old paraglide pipeline,
// which was generated from the deleted packages/i18n inlang project). Two
// locales, 20 keys — a full i18n framework is overkill for the popup.
// Catalog values are carried over verbatim from the old generated messages.

export type AvailableLanguageTag = 'en' | 'de';
export const availableLanguageTags: readonly AvailableLanguageTag[] = ['en', 'de'] as const;

const catalogs: Record<AvailableLanguageTag, Record<string, string>> = {
	en: {
		app_name: "Be Certain",
		auth_email_label: "Email Address",
		auth_email_placeholder: "you@example.com",
		auth_otp_placeholder: "Enter code",
		auth_otp_sent_to: "A verification code has been sent to {email}.",
		auth_send_code: "Send Verification Code",
		auth_send_code_failed: "Failed to send verification code",
		auth_sending_otp: "Sending...",
		auth_session_expired: "Your session has expired. Please sign in again.",
		auth_verify: "Verify",
		auth_verify_failed: "Verification failed",
		auth_verifying: "Verifying...",
		capture_analysis_failed: "Analysis failed. Please try again.",
		capture_no_xray_found: "No X-ray detected in the captured image",
		loading: "Loading...",
		auth_otp_label: "Verification Code",
		dx_auth_otp_hint: "The code expires in 3 minutes.",
		auth_no_account: "Don't have an account?",
		auth_register_link: "Register",
		dx_auth_change_email: "Change email",
	},
	de: {
		app_name: "Be Certain",
		auth_email_label: "E-Mail-Adresse",
		auth_email_placeholder: "sie@beispiel.de",
		auth_otp_placeholder: "Code eingeben",
		auth_otp_sent_to: "Ein Bestätigungscode wurde an {email} gesendet.",
		auth_send_code: "Bestätigungscode senden",
		auth_send_code_failed: "Bestätigungscode konnte nicht gesendet werden",
		auth_sending_otp: "Wird gesendet...",
		auth_session_expired: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
		auth_verify: "Bestätigen",
		auth_verify_failed: "Überprüfung fehlgeschlagen",
		auth_verifying: "Wird überprüft...",
		capture_analysis_failed: "Analyse fehlgeschlagen. Bitte versuchen Sie es erneut.",
		capture_no_xray_found: "Kein Röntgenbild im aufgenommenen Bild erkannt",
		loading: "Laden...",
		auth_otp_label: "Bestätigungscode",
		dx_auth_otp_hint: "Der Code läuft in 3 Minuten ab.",
		auth_no_account: "Noch kein Konto?",
		auth_register_link: "Registrieren",
		dx_auth_change_email: "E-Mail ändern",
	}
};

let current: AvailableLanguageTag = 'en';

export function languageTag(): AvailableLanguageTag {
	return current;
}

export function setLanguageTag(tag: AvailableLanguageTag): void {
	if (availableLanguageTags.includes(tag)) current = tag;
}

function t(key: string, params?: Record<string, string>): string {
	let msg = catalogs[current][key] ?? catalogs.en[key] ?? key;
	if (params) for (const [k, v] of Object.entries(params)) msg = msg.replaceAll(`{${k}}`, v);
	return msg;
}

// Paraglide-compatible message functions (m.key()), so call sites stay unchanged.
export const app_name = () => t("app_name");
export const auth_email_label = () => t("auth_email_label");
export const auth_email_placeholder = () => t("auth_email_placeholder");
export const auth_otp_placeholder = () => t("auth_otp_placeholder");
export const auth_otp_sent_to = (params: { email: string }) => t("auth_otp_sent_to", params);
export const auth_send_code = () => t("auth_send_code");
export const auth_send_code_failed = () => t("auth_send_code_failed");
export const auth_sending_otp = () => t("auth_sending_otp");
export const auth_session_expired = () => t("auth_session_expired");
export const auth_verify = () => t("auth_verify");
export const auth_verify_failed = () => t("auth_verify_failed");
export const auth_verifying = () => t("auth_verifying");
export const capture_analysis_failed = () => t("capture_analysis_failed");
export const capture_no_xray_found = () => t("capture_no_xray_found");
export const loading = () => t("loading");
export const auth_otp_label = () => t("auth_otp_label");
export const dx_auth_otp_hint = () => t("dx_auth_otp_hint");
export const auth_no_account = () => t("auth_no_account");
export const auth_register_link = () => t("auth_register_link");
export const dx_auth_change_email = () => t("dx_auth_change_email");
