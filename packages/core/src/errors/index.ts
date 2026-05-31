/**
 * Extract a user-friendly error message from any error.
 *
 * Handles PocketBase ClientResponseError (field errors, response message),
 * standard Error objects, and unknown throws. This is the single source of
 * truth for turning caught errors into displayable strings.
 */
export function resolveErrorMessage(error: unknown, fallback: string): string {
	// PocketBase ClientResponseError — has a `response` object with optional field-level errors
	if (error && typeof error === 'object' && 'response' in error) {
		const response = (error as any).response;
		if (response?.data) {
			const fields = Object.values(response.data) as any[];
			const firstField = fields[0];
			if (firstField?.message) return firstField.message;
		}
		if (response?.message) return response.message;
	}

	if (error instanceof Error) {
		// Network failures produce unhelpful browser messages — use the caller's localised fallback
		if (error.message === 'Failed to fetch' || error.message === 'Load failed') {
			return fallback;
		}
		return error.message;
	}

	if (typeof error === 'string' && error.length > 0) return error;

	return fallback;
}
