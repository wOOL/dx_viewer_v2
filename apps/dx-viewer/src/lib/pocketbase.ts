import { createPBClient } from '@be-certain/core/api';

export const pb = createPBClient({
	url: import.meta.env.VITE_POCKETBASE_URL,
	siteKey: import.meta.env.VITE_SITE_KEY
});
