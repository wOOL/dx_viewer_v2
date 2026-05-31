import * as m from '$lib/paraglide/messages';
import { preferences } from '$lib/preferences.svelte';
import { ScanSession as CoreScanSession, type ScanStep } from '@be-certain/core/use-cases';
import type PocketBase from 'pocketbase';

export type { ScanStep };

/**
 * App-local subclass that pre-binds paraglide messages + the live user
 * preferences (tooth numbering, disease threshold, segmentation toggle) so
 * the analysis call reflects whatever the user last chose in /settings.
 */
export class ScanSession extends CoreScanSession {
	constructor(pb: PocketBase) {
		super(
			pb,
			{
				captureFailed: m.capture_failed,
				errorTimeout: m.error_timeout,
				noXrayFound: m.capture_no_xray_found,
				analysisFailed: m.capture_analysis_failed
			},
			() => preferences.inferenceOverrides()
		);
	}
}
