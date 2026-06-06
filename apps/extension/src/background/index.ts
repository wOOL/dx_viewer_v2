import { findXray, runInference } from '@be-certain/core/ai';
import { resolveErrorMessage } from '@be-certain/core/errors';
import { logger } from '@be-certain/core/logger';
import { diseaseById } from '@be-certain/core/constants';
import type { InferenceResponse, SiteAdapter } from '@be-certain/core/types';
import { addBase64Metadata, dataUrlToBase64, extractXRayRegion } from '@be-certain/core/image';
import { getAdapterForUrl } from '../adapters';
import * as m from '../lib/messages';
import { type AvailableLanguageTag, setLanguageTag } from '../lib/messages';
import { initExtensionAuthPersistence, restoreAuth, pb } from '../lib/pocketbase';

if (import.meta.env.VITE_DEBUG === 'true') logger.enable('debug');

const log = logger.scoped('bg');

// ---------------------------------------------------------------------------
// Language persistence
// ---------------------------------------------------------------------------

chrome.storage.local.get('language', (result) => {
	const stored = result['language'];
	if (stored) setLanguageTag(stored as AvailableLanguageTag);
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'local' && changes['language']?.newValue) {
		setLanguageTag(changes['language'].newValue as AvailableLanguageTag);
	}
});

// ---------------------------------------------------------------------------
// PocketBase client
// ---------------------------------------------------------------------------

// The shared core PB singleton reads VITE_PB_URL (falls back to prod). Wire its
// auth persistence to chrome.storage.local for the service-worker environment.
initExtensionAuthPersistence();

async function ensureAuth(): Promise<boolean> {
	if (pb.authStore.isValid) return true;
	return restoreAuth();
}

// ---------------------------------------------------------------------------
// Per-tab state: stores the latest analysis result for context menu actions
// ---------------------------------------------------------------------------

interface TabState {
	adapter: SiteAdapter;
	analysis: InferenceResponse;
	findingsCount: number;
}

const tabState = new Map<number, TabState>();

// Per-tab error messages — shown in popup when user clicks after an error
const tabErrors = new Map<number, string>();

async function setTabError(tabId: number, errorMsg: string) {
	tabErrors.set(tabId, errorMsg);
	log.error('Tab error', { tabId, error: errorMsg });
	await setIconState(tabId, 'error');
	// Set popup so next click shows the error to the user
	await chrome.action.setPopup({ tabId, popup: 'popup/index.html' });
}

// ---------------------------------------------------------------------------
// Icon state management
// ---------------------------------------------------------------------------

type IconState = 'inactive' | 'active' | 'loading' | 'success' | 'error';

function drawIcon(color: string, size: number): ImageData {
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext('2d')!;
	const center = size / 2;
	const radius = size * 0.4;

	// Circle
	ctx.beginPath();
	ctx.arc(center, center, radius, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();

	// "BC" text
	ctx.fillStyle = '#ffffff';
	ctx.font = `bold ${Math.round(size * 0.3)}px sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText('BC', center, center + 1);

	return ctx.getImageData(0, 0, size, size);
}

function getIconData(state: IconState): Record<number, ImageData> {
	const colors: Record<IconState, string> = {
		inactive: '#94a3b8',
		active: '#3b82f6',
		loading: '#eab308',
		success: '#22c55e',
		error: '#ef4444'
	};
	const color = colors[state];
	return { 16: drawIcon(color, 16), 32: drawIcon(color, 32) };
}

async function setIconState(tabId: number, state: IconState, detail?: string) {
	const imageData = getIconData(state);
	await chrome.action.setIcon({ tabId, imageData });

	const badges: Record<IconState, { text: string; bg: string }> = {
		inactive: { text: '', bg: '#94a3b8' },
		active: { text: '', bg: '#3b82f6' },
		loading: { text: '...', bg: '#eab308' },
		success: { text: detail ?? '', bg: '#22c55e' },
		error: { text: '!', bg: '#ef4444' }
	};

	const { text, bg } = badges[state];
	await chrome.action.setBadgeText({ tabId, text });
	await chrome.action.setBadgeBackgroundColor({ tabId, color: bg });

	const titles: Record<IconState, string> = {
		inactive: 'Be Certain — site not supported',
		active: 'Be Certain — click to analyze',
		loading: 'Be Certain — analyzing…',
		success: `Be Certain — ${detail ?? '0'} finding(s) detected`,
		error: 'Be Certain — analysis failed'
	};
	await chrome.action.setTitle({ tabId, title: titles[state] });
}

// ---------------------------------------------------------------------------
// Context menu setup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: 'add-notes',
		title: 'Add Notes',
		contexts: ['action'],
		enabled: false
	});
	chrome.contextMenus.create({
		id: 'upload-result',
		title: 'Upload Result',
		contexts: ['action'],
		enabled: false
	});
});

function updateContextMenus(adapter: SiteAdapter | null, hasAnalysis: boolean) {
	chrome.contextMenus.update('add-notes', {
		enabled: hasAnalysis && !!adapter?.notesId
	});
	chrome.contextMenus.update('upload-result', {
		enabled: hasAnalysis && !!adapter?.fileUploadId
	});
}

// ---------------------------------------------------------------------------
// Tab tracking — update icon and menu state on navigation
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	// Reset state on any navigation (URL change or page load complete)
	if (changeInfo.url || changeInfo.status === 'loading') {
		tabState.delete(tabId);
		tabErrors.delete(tabId);
		chrome.action.setPopup({ tabId, popup: '' });

		const url = changeInfo.url ?? tab.url;
		const adapter = url ? getAdapterForUrl(url) : null;
		setIconState(tabId, adapter ? 'active' : 'inactive');
		updateContextMenus(adapter, false);
	}
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
	const tab = await chrome.tabs.get(tabId);
	if (!tab.url) return;

	const adapter = getAdapterForUrl(tab.url);
	const state = tabState.get(tabId);

	if (state) {
		setIconState(tabId, 'success', String(state.findingsCount));
		updateContextMenus(adapter, true);
	} else {
		setIconState(tabId, adapter ? 'active' : 'inactive');
		updateContextMenus(adapter, false);
	}
});

// Clean up state when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
	tabState.delete(tabId);
});

// ---------------------------------------------------------------------------
// Content script injection helper
// ---------------------------------------------------------------------------

async function ensureContentScript(tabId: number): Promise<void> {
	try {
		// Ping the content script to see if it's loaded
		await chrome.tabs.sendMessage(tabId, { type: 'PING' });
	} catch {
		// Content script not loaded — inject it programmatically
		log.info('Content script not loaded, injecting', { tabId });
		try {
			await chrome.scripting.executeScript({
				target: { tabId },
				files: ['content/index.js']
			});
		} catch (injectError) {
			log.error('Failed to inject content script', { tabId, error: injectError });
			const tab = await chrome.tabs.get(tabId);
			if (tab.url?.startsWith('file://')) {
				throw new Error('Cannot access file:// pages. Enable "Allow access to file URLs" in the extension settings (chrome://extensions).');
			}
			throw injectError;
		}
	}
}

// ---------------------------------------------------------------------------
// Icon click — capture + analyze + replace image
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener(async (tab) => {
	if (!tab.id || !tab.url) return;
	const tabId = tab.id;

	// Check adapter first
	const adapter = getAdapterForUrl(tab.url);
	if (!adapter) {
		log.warn('Icon clicked on unsupported site', { url: tab.url });
		return;
	}

	// Check auth — if not authenticated, temporarily show popup for login
	if (!(await ensureAuth())) {
		log.info('Not authenticated, showing popup for login');
		// Set popup so next click opens the auth form, then badge signals the user
		await chrome.action.setPopup({ tabId, popup: 'popup/index.html' });
		await setIconState(tabId, 'error');
		await chrome.action.setTitle({ tabId, title: 'Be Certain — sign in required (click again)' });
		return;
	}

	log.info('Icon clicked — starting analysis', { tabId, adapter: adapter.name });
	await setIconState(tabId, 'loading');

	try {
		// Capture current tab
		const stop = logger.time('bg', 'captureVisibleTab');
		const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
		stop();

		// Find X-ray region (core's ai helpers use the shared singleton's token)
		const xrayResult = await findXray(dataUrlToBase64(dataUrl));
		if (!xrayResult.extra.xrayfound || !xrayResult.result) {
			await setTabError(tabId, m.capture_no_xray_found());
			return;
		}

		// Crop and run inference
		log.debug('X-ray detected, cropping region');
		const croppedDataUrl = await extractXRayRegion(dataUrl, xrayResult.result, xrayResult.extra);
		const analysis = await runInference({
			image_data: dataUrlToBase64(croppedDataUrl),
			// Mirrors the web app's one-click meta (QUICK_INFERENCE_META) so the
			// extension's overlay matches what the app would produce.
			meta_data: {
				ensure_dim: true,
				disease_segment: true,
				anatomy_meta_data: { conf_thres: 0.3 },
				number_meta_data: { conf_thres: 0.1, fdi_number: false },
				disease_meta_data: { conf_thres: 0.1 }
			}
		});

		// Extract findings count
		const diseases = analysis.extra.disease_result.result;
		const findingsCount = diseases.labels.length;
		log.info('Inference complete', { findingsCount });

		// Store result for context menu actions
		tabState.set(tabId, { adapter, analysis, findingsCount });

		// Ensure content script is loaded, then send image replacement
		await ensureContentScript(tabId);
		const detectionBase64 = addBase64Metadata(analysis.detection, 'image/png');
		await chrome.tabs.sendMessage(tabId, {
			type: 'REPLACE_IMAGE',
			imageId: adapter.imageId,
			detectionBase64
		});

		await setIconState(tabId, 'success', String(findingsCount));
		updateContextMenus(adapter, true);
	} catch (e: unknown) {
		await setTabError(tabId, resolveErrorMessage(e, m.capture_analysis_failed()));
	}
});

// ---------------------------------------------------------------------------
// Context menu actions
// ---------------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (!tab?.id) return;
	const tabId = tab.id;
	const state = tabState.get(tabId);
	if (!state) return;

	try {
		await ensureContentScript(tabId);
	} catch (e) {
		log.error('Failed to inject content script', { tabId, error: e });
		return;
	}

	if (info.menuItemId === 'add-notes' && state.adapter.notesId) {
		log.info('Adding notes', { tabId, notesId: state.adapter.notesId });
		await chrome.tabs.sendMessage(tabId, {
			type: 'ADD_NOTES',
			notesId: state.adapter.notesId,
			reportText: state.analysis.report
		});
	}

	if (info.menuItemId === 'upload-result' && state.adapter.fileUploadId) {
		log.info('Uploading result file', { tabId, fileUploadId: state.adapter.fileUploadId });

		// Build a JSON payload with findings and report
		const diseases = state.analysis.extra.disease_result.result;
		const findings = diseases.bboxes.map((bbox, i) => ({
			disease: diseaseById(diseases.labels[i] ?? -1).name,
			confidence: diseases.scores[i],
			bbox
		}));

		const jsonContent = JSON.stringify(
			{
				report: state.analysis.report,
				findings,
				anatomy: state.analysis.extra.anatomy_result,
				toothNumbers: state.analysis.extra.number_result
			},
			null,
			2
		);

		await chrome.tabs.sendMessage(tabId, {
			type: 'UPLOAD_FILE',
			fileUploadId: state.adapter.fileUploadId,
			jsonContent,
			fileName: `be-certain-report-${Date.now()}.json`
		});
	}
});

// ---------------------------------------------------------------------------
// Message listener — auth messages from popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	log.debug('Message received', { type: message.type });

	if (message.type === 'GET_TAB_ERROR') {
		const tabId = message.tabId as number | undefined;
		const error = tabId ? (tabErrors.get(tabId) ?? null) : null;
		sendResponse({ error });
		return false;
	}

	if (message.type === 'CLEAR_TAB_ERROR') {
		const tabId = message.tabId as number | undefined;
		if (tabId) {
			tabErrors.delete(tabId);
			// Reset popup so future clicks trigger onClicked
			chrome.action.setPopup({ tabId, popup: '' });
			// Restore icon to active if adapter matches
			chrome.tabs.get(tabId).then((tab) => {
				const adapter = tab.url ? getAdapterForUrl(tab.url) : null;
				setIconState(tabId, adapter ? 'active' : 'inactive');
			});
		}
		sendResponse({ success: true });
		return false;
	}

	if (message.type === 'GET_AUTH_STATUS') {
		handleGetAuthStatus().then(sendResponse);
		return true;
	}

	if (message.type === 'LOGIN') {
		handleLogin(message.email, message.otpId, message.code).then(sendResponse);
		return true;
	}

	if (message.type === 'REQUEST_OTP') {
		handleRequestOtp(message.email).then(sendResponse);
		return true;
	}

	if (message.type === 'SIGN_OUT') {
		log.info('Signing out');
		pb.authStore.clear();
		sendResponse({ success: true });
		return false;
	}
});

// ---------------------------------------------------------------------------
// Auth handlers
// ---------------------------------------------------------------------------

async function handleRequestOtp(email: string) {
	log.info('Requesting OTP', { email });
	try {
		const res = await pb.collection('users').requestOTP(email);
		log.debug('OTP sent', { otpId: res.otpId });
		return { success: true, otpId: res.otpId };
	} catch (e: unknown) {
		log.error('OTP request failed', e);
		return { success: false, error: resolveErrorMessage(e, m.auth_send_code_failed()) };
	}
}

async function handleLogin(email: string, otpId: string, code: string) {
	log.info('Login attempt', { email });
	try {
		await pb.collection('users').authWithOTP(otpId, code);
		log.info('Login successful');
		return { success: true };
	} catch (e: unknown) {
		log.error('Login failed', e);
		return { success: false, error: resolveErrorMessage(e, m.auth_verify_failed()) };
	}
}

async function handleGetAuthStatus() {
	log.debug('Checking auth status');
	await ensureAuth();

	if (pb.authStore.isValid) {
		try {
			await pb.collection('users').authRefresh();
			log.debug('Auth token refreshed');
		} catch {
			log.warn('Auth token expired, clearing session');
			pb.authStore.clear();
			return { isAuthenticated: false, expired: true };
		}
	}

	log.debug('Auth status', { isAuthenticated: pb.authStore.isValid });
	return { isAuthenticated: pb.authStore.isValid };
}
