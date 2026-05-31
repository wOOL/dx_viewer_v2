import type { SiteAdapter } from '@be-certain/core/types';

/** Test adapter — image replacement only */
export const testImageOnlyAdapter: SiteAdapter = {
	name: 'Test PMS (Image Only)',
	matchPatterns: ['*://*/test-site/image-only.html*', 'file://*/test-site/image-only.html*'],
	imageId: 'xray-image'
};
