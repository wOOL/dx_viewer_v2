import { logger } from '@be-certain/core/logger';
import type { SiteAdapter } from '@be-certain/core/types';
import { testFullAdapter } from './test-full.js';
import { testImageNotesAdapter } from './test-image-notes.js';
import { testImageOnlyAdapter } from './test-image-only.js';
import { testImageUploadAdapter } from './test-image-upload.js';

const log = logger.scoped('adapter');

/**
 * Registry of all site adapters.
 * Add new adapters here as they are implemented.
 */
const adapters: SiteAdapter[] = [];

// Test/debug adapters — only registered in dev mode
if (import.meta.env.VITE_DEBUG === 'true') {
	adapters.push(testFullAdapter, testImageOnlyAdapter, testImageNotesAdapter, testImageUploadAdapter);
}

/**
 * Find the matching site adapter for a given URL.
 * Returns the first adapter whose matchPatterns include a match.
 */
export function getAdapterForUrl(url: string): SiteAdapter | null {
	for (const adapter of adapters) {
		for (const pattern of adapter.matchPatterns) {
			if (urlMatchesPattern(url, pattern)) {
				log.debug('Adapter matched', { name: adapter.name, pattern });
				return adapter;
			}
		}
	}
	log.debug('No adapter matched', { url });
	return null;
}

/**
 * Simple URL pattern matching.
 * Supports wildcard patterns like "*://example.com/*"
 */
function urlMatchesPattern(url: string, pattern: string): boolean {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	const regex = new RegExp(`^${escaped}$`, 'i');
	return regex.test(url);
}
