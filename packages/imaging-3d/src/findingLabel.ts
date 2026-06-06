// Translate well-known SYNTHESIZED finding type strings (the FE generates these
// itself when the AI returns segmentation gaps, missing teeth, etc.). Real AI
// findings come back as English type strings from the model — those pass
// through unchanged for now (the model itself isn't multilingual yet).
//
// `type` doubles as the category-routing key in CbctReport (PERIO_KEYWORDS /
// SURG_KEYWORDS regex) — those regexes still match the original English
// because they're applied before this label is rendered. So we KEEP the
// English type on the finding object and only translate at display time.

const SYNTH_KEY: Record<string, string> = {
	'Missing tooth (segmentation gap)': 'cbct.synthMissingTooth'
};

export function findingTypeLabel(type: string, t: (key: string) => string): string {
	const key = SYNTH_KEY[type];
	return key ? t(key) : type;
}
