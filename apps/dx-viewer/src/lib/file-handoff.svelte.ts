/**
 * One-shot handoff from the dashboard → viewer route.
 *
 * Two channels:
 *   - `file`: an uploaded File the user dropped / picked.
 *   - `capturedDataUrl`: a screen-captured PNG data URL. We do the capture on
 *     the dashboard because `getDisplayMedia` is gated by user activation;
 *     calling it from the viewer's mount effect would be blocked.
 *
 * Each consumer clears its own channel, so reloads or direct URL hits land
 * on an empty viewer rather than re-running stale state.
 */
export const fileHandoff = $state<{ file: File | null; capturedDataUrl: string | null }>({
	file: null,
	capturedDataUrl: null
});

export function setPendingFile(file: File): void {
	fileHandoff.file = file;
}

export function consumePendingFile(): File | null {
	const f = fileHandoff.file;
	fileHandoff.file = null;
	return f;
}

export function setPendingCapture(dataUrl: string): void {
	fileHandoff.capturedDataUrl = dataUrl;
}

export function consumePendingCapture(): string | null {
	const d = fileHandoff.capturedDataUrl;
	fileHandoff.capturedDataUrl = null;
	return d;
}
