// Content script — must be self-contained (no external imports) because
// Chrome loads content scripts as classic scripts, not ES modules.

const DEBUG = import.meta.env.VITE_DEBUG === 'true';
const PREFIX = '[content]';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (DEBUG) console.debug(PREFIX, 'Message received', { type: message.type });

	if (message.type === 'PING') {
		sendResponse({ pong: true });
		return;
	}

	if (message.type === 'REPLACE_IMAGE') {
		const { imageId, detectionBase64 } = message;
		const img = document.getElementById(imageId) as HTMLImageElement | null;
		if (img) {
			img.src = detectionBase64;
			if (DEBUG) console.info(PREFIX, 'Image replaced', { imageId });
			sendResponse({ success: true });
		} else {
			console.warn(PREFIX, 'Image element not found', { imageId });
			sendResponse({ success: false, error: `Element #${imageId} not found` });
		}
		return;
	}

	if (message.type === 'ADD_NOTES') {
		const { notesId, reportText } = message;
		const el = document.getElementById(notesId) as HTMLTextAreaElement | HTMLInputElement | null;
		if (el) {
			el.value = reportText;
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
			if (DEBUG) console.info(PREFIX, 'Notes injected', { notesId });
			sendResponse({ success: true });
		} else {
			console.warn(PREFIX, 'Notes element not found', { notesId });
			sendResponse({ success: false, error: `Element #${notesId} not found` });
		}
		return;
	}

	if (message.type === 'UPLOAD_FILE') {
		const { fileUploadId, jsonContent, fileName } = message;
		const input = document.getElementById(fileUploadId) as HTMLInputElement | null;
		if (input) {
			const file = new File([jsonContent], fileName, { type: 'application/json' });
			const dt = new DataTransfer();
			dt.items.add(file);
			input.files = dt.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
			if (DEBUG) console.info(PREFIX, 'File uploaded', { fileUploadId, fileName });
			sendResponse({ success: true });
		} else {
			console.warn(PREFIX, 'File upload element not found', { fileUploadId });
			sendResponse({ success: false, error: `Element #${fileUploadId} not found` });
		}
		return;
	}
});
