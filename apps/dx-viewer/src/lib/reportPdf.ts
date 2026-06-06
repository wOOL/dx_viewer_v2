// One-click styled PDF of the 2D radiographic report, matching the BeCertain reference
// layout: a navy header band with a saffron accent, a Patient / DOB / Dentist / Analysis-
// date block, an "X-Ray Images" row (Original / Tooth Numbering / Segmentation thumbnails),
// an "Analysis with Diagnostics" annotated image + colour legend, the "Radiographic Report"
// text (the AI report or the clinician's edit, with the Acceptable/Unacceptable verdict
// reflected), and a BeCertain logo + disclaimer footer.
//
// Built with jsPDF primitives (not html2canvas) so the report text stays crisp + selectable
// and the layout is deterministic; images are embedded as PNG. Everything text-facing is
// passed in already-localised (see `strings`) so this module carries no i18n itself.

import { jsPDF } from 'jspdf';

export type ReportPdfStatus = '' | 'acceptable' | 'unacceptable';

export interface ReportPdfImages {
	/** Data URL of the original (un-annotated) X-ray. */
	original?: string | null;
	/** Data URL of the AI tooth-numbering visualisation. */
	toothNumbers?: string | null;
	/** Data URL of the AI segmentation visualisation. */
	segmentation?: string | null;
	/** Data URL of the annotated "analysis with diagnostics" image (live overlay composite). */
	annotated?: string | null;
}

export interface ReportPdfStrings {
	patientLabel: string;
	dobLabel: string;
	dentistLabel: string;
	analysisLabel: string;
	notSpecified: string;
	xrayImagesHeading: string;
	originalCaption: string;
	toothNumberingCaption: string;
	segmentationCaption: string;
	analysisHeading: string;
	reportHeading: string;
	disclaimer: string;
	/** PHI-safe filename base (no extension). */
	fileBase: string;
}

export interface ReportPdfData {
	patientName: string;
	dob: string;
	dentist: string;
	analysisDate: string;
	images: ReportPdfImages;
	legend: { label: string; color: string }[];
	/** Report markdown — the clinician's edit if present, else the AI report. */
	reportMarkdown: string;
	status: ReportPdfStatus;
	/** Data URL / same-origin URL of the BeCertain logo (optional). */
	logo?: string | null;
	strings: ReportPdfStrings;
}

const NAVY: [number, number, number] = [19, 49, 79];
const SAFFRON: [number, number, number] = [230, 179, 74];
const INK: [number, number, number] = [31, 41, 55];
const SUB: [number, number, number] = [96, 105, 120];
const LINE: [number, number, number] = [222, 226, 232];

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	const full =
		h.length === 3
			? h
					.split('')
					.map((c) => c + c)
					.join('')
			: h;
	const n = parseInt(full, 16);
	if (!Number.isFinite(n)) return [136, 136, 136];
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface LoadedImg {
	dataUrl: string;
	w: number;
	h: number;
}

function loadImage(url?: string | null): Promise<LoadedImg | null> {
	return new Promise((resolve) => {
		if (!url) return resolve(null);
		const im = new Image();
		im.crossOrigin = 'anonymous';
		im.onload = () => {
			const w = im.naturalWidth || 1;
			const h = im.naturalHeight || 1;
			// Normalise to a PNG data URL so jsPDF.addImage embeds it regardless of source
			// type (a cross-origin load that succeeded is now same-origin-safe to read).
			try {
				const c = document.createElement('canvas');
				c.width = w;
				c.height = h;
				const ctx = c.getContext('2d');
				if (!ctx) return resolve(null);
				ctx.drawImage(im, 0, 0);
				resolve({ dataUrl: c.toDataURL('image/png'), w, h });
			} catch {
				resolve(null);
			}
		};
		im.onerror = () => resolve(null);
		im.src = url;
	});
}

function fit(iw: number, ih: number, bw: number, bh: number): { w: number; h: number } {
	const s = Math.min(bw / iw, bh / ih);
	return { w: iw * s, h: ih * s };
}

// --- report markdown → styled lines -----------------------------------------
interface ReportLine {
	kind: 'h' | 'bullet' | 'check' | 'text' | 'blank';
	text: string;
	checked?: boolean;
}

function stripInline(s: string): string {
	return s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').trim();
}

export function parseReportMarkdown(md: string, status: ReportPdfStatus): ReportLine[] {
	const out: ReportLine[] = [];
	for (const raw of (md ?? '').split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (!line.trim()) {
			out.push({ kind: 'blank', text: '' });
			continue;
		}
		let m: RegExpExecArray | null;
		if ((m = /^#{1,6}\s+(.*)$/.exec(line))) {
			out.push({ kind: 'h', text: stripInline(m[1] ?? '') });
		} else if ((m = /^[-*]\s*\[([ xX])\]\s*(.*)$/.exec(line))) {
			const label = stripInline(m[2] ?? '');
			let checked = (m[1] ?? '').toLowerCase() === 'x';
			// Reflect the clinician's verdict on the Acceptable / Unacceptable checkboxes.
			if (/unacceptable/i.test(label)) checked = status === 'unacceptable';
			else if (/acceptable/i.test(label)) checked = status === 'acceptable';
			out.push({ kind: 'check', text: label, checked });
		} else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
			out.push({ kind: 'bullet', text: stripInline(m[1] ?? '') });
		} else {
			out.push({ kind: 'text', text: stripInline(line) });
		}
	}
	return out;
}

export async function buildReportPdf(data: ReportPdfData): Promise<void> {
	const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
	const W = 210;
	const H = 297;
	const M = 16;
	const s = data.strings;

	const [orig, tnum, seg, annot, logo] = await Promise.all([
		loadImage(data.images.original),
		loadImage(data.images.toothNumbers),
		loadImage(data.images.segmentation),
		loadImage(data.images.annotated),
		loadImage(data.logo)
	]);

	function topBand() {
		doc.setFillColor(...NAVY);
		doc.rect(0, 0, W, 11, 'F');
		// saffron accent wedge, top-right
		doc.setFillColor(...SAFFRON);
		doc.triangle(W - 48, 0, W, 0, W, 11, 'F');
		doc.setFillColor(...NAVY);
		doc.triangle(W - 48, 0, W - 36, 0, W - 48, 11, 'F');
	}
	function bottomBand() {
		doc.setFillColor(...NAVY);
		doc.rect(0, H - 9, W, 9, 'F');
		doc.setFillColor(...SAFFRON);
		doc.triangle(W - 44, H - 9, W, H - 9, W, H, 'F');
		doc.setFillColor(...NAVY);
		doc.triangle(W - 44, H - 9, W - 33, H - 9, W - 44, H, 'F');
	}

	function field(x: number, y: number, label: string, value: string) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(10);
		doc.setTextColor(...NAVY);
		doc.text(label, x, y);
		doc.setFont('helvetica', 'normal');
		doc.setTextColor(...SUB);
		doc.text(value || s.notSpecified, x, y + 5.5);
	}

	function heading(text: string, y: number) {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(13);
		doc.setTextColor(...NAVY);
		doc.text(text, M, y);
	}

	// ── Page 1: header + patient block + images ────────────────────────────────
	topBand();
	let y = 26;
	field(M, y, s.patientLabel, data.patientName);
	field(W / 2, y, s.dobLabel, data.dob);
	y += 16;
	field(M, y, s.dentistLabel, data.dentist);
	field(W / 2, y, s.analysisLabel, data.analysisDate);
	y += 12;
	doc.setDrawColor(...LINE);
	doc.line(M, y, W - M, y);
	y += 9;

	// X-Ray Images row
	heading(s.xrayImagesHeading, y);
	y += 5;
	const gap = 6;
	const cw = (W - 2 * M - 2 * gap) / 3;
	const ch = cw * 0.82;
	const thumbs: [LoadedImg | null, string][] = [
		[orig, s.originalCaption],
		[tnum, s.toothNumberingCaption],
		[seg, s.segmentationCaption]
	];
	thumbs.forEach(([img, caption], i) => {
		const x = M + i * (cw + gap);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(8);
		doc.setTextColor(...INK);
		doc.text(caption, x + cw / 2, y, { align: 'center' });
		const boxY = y + 2;
		doc.setDrawColor(...LINE);
		doc.setFillColor(245, 246, 248);
		doc.rect(x, boxY, cw, ch, 'FD');
		if (img) {
			const f = fit(img.w, img.h, cw - 2, ch - 2);
			doc.addImage(img.dataUrl, 'PNG', x + (cw - f.w) / 2, boxY + (ch - f.h) / 2, f.w, f.h);
		}
	});
	y += 2 + ch + 9;

	// Analysis with diagnostics (big annotated image)
	heading(s.analysisHeading, y);
	y += 4;
	const bigW = W - 2 * M;
	const bigH = Math.min(H - 9 - 18 - y, bigW * 0.66); // leave room for legend + bottom band
	doc.setDrawColor(...LINE);
	doc.setFillColor(245, 246, 248);
	doc.rect(M, y, bigW, bigH, 'FD');
	if (annot) {
		const f = fit(annot.w, annot.h, bigW - 2, bigH - 2);
		doc.addImage(annot.dataUrl, 'PNG', M + (bigW - f.w) / 2, y + (bigH - f.h) / 2, f.w, f.h);
	}
	y += bigH + 7;

	// Legend (colour swatch + label, wrapping)
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8.5);
	let lx = M;
	for (const item of data.legend) {
		const tw = doc.getTextWidth(item.label);
		const chip = 3.4;
		if (lx + chip + 1.5 + tw > W - M) {
			lx = M;
			y += 6;
		}
		const [r, g, b] = hexToRgb(item.color);
		doc.setFillColor(r, g, b);
		doc.rect(lx, y - 3, chip, chip, 'F');
		doc.setTextColor(...INK);
		doc.text(item.label, lx + chip + 1.5, y);
		lx += chip + 1.5 + tw + 7;
	}

	// ── Page 2: the radiographic report text ───────────────────────────────────
	doc.addPage();
	topBand();
	let ry = 24;
	heading(s.reportHeading, ry);
	ry += 8;
	const maxW = W - 2 * M;
	const bottomLimit = H - 16;

	function ensureSpace(need: number) {
		if (ry + need > bottomLimit) {
			doc.addPage();
			topBand();
			ry = 22;
		}
	}

	for (const line of parseReportMarkdown(data.reportMarkdown, data.status)) {
		if (line.kind === 'blank') {
			ry += 2.5;
			continue;
		}
		if (line.kind === 'h') {
			ensureSpace(9);
			ry += 2;
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(11);
			doc.setTextColor(...NAVY);
			for (const seg2 of doc.splitTextToSize(line.text, maxW)) {
				ensureSpace(6);
				doc.text(seg2, M, ry);
				ry += 5.4;
			}
			continue;
		}
		// bullet / check / text
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(9.5);
		doc.setTextColor(...INK);
		let prefix = '';
		if (line.kind === 'bullet') prefix = '•  ';
		else if (line.kind === 'check') prefix = line.checked ? '[x]  ' : '[ ]  ';
		const indent = line.kind === 'text' ? 0 : 4;
		const wrapped = doc.splitTextToSize(prefix + line.text, maxW - indent);
		for (let i = 0; i < wrapped.length; i++) {
			ensureSpace(5.5);
			doc.text(wrapped[i], M + indent, ry);
			ry += 5;
		}
	}

	// Footer (last page): logo + disclaimer above the bottom band.
	const footY = H - 22;
	doc.setDrawColor(...LINE);
	doc.line(M, footY - 4, W - M, footY - 4);
	if (logo) {
		const lf = fit(logo.w, logo.h, 36, 11);
		doc.addImage(logo.dataUrl, 'PNG', M, footY - 2, lf.w, lf.h);
	} else {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(12);
		doc.setTextColor(...NAVY);
		doc.text('BeCertain', M, footY + 4);
	}
	doc.setFont('helvetica', 'italic');
	doc.setFontSize(7.5);
	doc.setTextColor(...SUB);
	const disc = doc.splitTextToSize(s.disclaimer, W - 2 * M - 46);
	doc.text(disc, W - M, footY, { align: 'right' });
	bottomBand();

	doc.save(`${s.fileBase}.pdf`);
}
