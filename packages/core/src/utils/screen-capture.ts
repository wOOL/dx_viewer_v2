import { isNative } from './native-utils.js';

/**
 * Capture the user's screen / window / tab as a base64 PNG data URL.
 *
 * Two paths:
 *   - **Native** (electron desktop) — proxied through `electronAPI.captureScreen`
 *     so the renderer doesn't need permission prompts.
 *   - **Browser** — `navigator.mediaDevices.getDisplayMedia` shows the OS
 *     picker, grabs one frame, then stops the track. Must be called from
 *     within a user-gesture handler — browsers gate the picker on user
 *     activation, so this won't work from a passive `$effect` or timeout.
 */
export async function captureScreenAsDataUrl(): Promise<string> {
	if (isNative()) {
		return await (window as any).electronAPI.captureScreen();
	}

	const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
	try {
		const track = stream.getVideoTracks()[0];
		if (!track) throw new Error('No video track in display media stream');
		const imageCapture = new (window as any).ImageCapture(track);
		const bitmap = await imageCapture.grabFrame();
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Failed to acquire 2D canvas context');
		ctx.drawImage(bitmap, 0, 0);
		return canvas.toDataURL('image/png');
	} finally {
		for (const t of stream.getTracks()) t.stop();
	}
}
