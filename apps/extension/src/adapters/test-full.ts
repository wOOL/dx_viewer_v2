import type { SiteAdapter } from '@be-certain/core/types';

/** Test adapter — full features (image + notes + file upload) */
export const testFullAdapter: SiteAdapter = {
	name: 'Test PMS (Full)',
	matchPatterns: ['*://*/test-site/index.html*', 'file://*/test-site/index.html*'],
	imageId: 'xray-image',
	notesId: 'notes',
	fileUploadId: 'file-upload'
};
