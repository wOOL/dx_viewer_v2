import type { SiteAdapter } from '@be-certain/core/types';

/** Test adapter — image replacement + file upload */
export const testImageUploadAdapter: SiteAdapter = {
	name: 'Test PMS (Image + Upload)',
	matchPatterns: ['*://*/test-site/image-upload.html*', 'file://*/test-site/image-upload.html*'],
	imageId: 'xray-image',
	fileUploadId: 'file-upload'
};
