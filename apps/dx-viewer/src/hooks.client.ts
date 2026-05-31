import * as m from '$lib/paraglide/messages';
import { logger } from '@be-certain/core/logger';
import type { HandleClientError } from '@sveltejs/kit';

const log = logger.scoped('hooks');

export const handleError: HandleClientError = ({ error, message }) => {
	log.error('Client error', { error, message });
	return {
		message: message ?? m.error_unexpected()
	};
};
