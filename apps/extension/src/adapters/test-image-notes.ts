import type { SiteAdapter } from '@be-certain/core/types';

/** Test adapter — image replacement + notes */
export const testImageNotesAdapter: SiteAdapter = {
	name: 'Test PMS (Image + Notes)',
	matchPatterns: ['*://*/test-site/image-notes.html*', 'file://*/test-site/image-notes.html*'],
	imageId: 'xray-image',
	notesId: 'notes'
};
