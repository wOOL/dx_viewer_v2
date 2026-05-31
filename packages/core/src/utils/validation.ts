import { stripBase64Prefix } from './image.js';

const DEFAULT_MAX_IMAGE_SIZE_MB = 10;

export function validateBase64Size(base64String: string, maxSizeMB: number = DEFAULT_MAX_IMAGE_SIZE_MB): string | null {
	const base64Data = stripBase64Prefix(base64String);

	const padding = (base64Data.match(/=/g) || []).length;
	const fileBytes = base64Data.length * 0.75 - padding;

	const maxBytes = maxSizeMB * 1024 * 1024;
	if (fileBytes > maxBytes) {
		const sizeMB = (fileBytes / (1024 * 1024)).toFixed(2);
		return `Image is too large (${sizeMB}MB). Limit is ${maxSizeMB}MB.`;
	}

	return null;
}
