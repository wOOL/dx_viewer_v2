import { describe, it, expect } from 'vitest';
import {
	validateUploadFile,
	summarizeBatch,
	maxSizeFor,
	uploadClassFor,
	formatBytes,
	MAX_SIZE_2D,
	MAX_SIZE_CBCT
} from './uploadValidation';

// Build a fake File of a given byte size + name. jsdom honours the blob parts'
// byte length as File.size, so a padded string of length N gives size N.
function fakeFile(name: string, size: number, type = ''): File {
	const blob = new Blob([size > 0 ? 'x'.repeat(size) : ''], { type });
	return new File([blob], name, { type });
}

describe('uploadClassFor', () => {
	it('maps upload-page enum and detected 2D modalities to twoD', () => {
		for (const m of ['xray', 'panoramic', 'photo', 'image']) {
			expect(uploadClassFor(m)).toBe('twoD');
		}
	});
	it('maps cbct and ios', () => {
		expect(uploadClassFor('cbct')).toBe('cbct');
		expect(uploadClassFor('ios')).toBe('ios');
	});
	it('maps anything else to unknown', () => {
		expect(uploadClassFor('other')).toBe('unknown');
		expect(uploadClassFor('')).toBe('unknown');
	});
});

describe('maxSizeFor', () => {
	it('uses the small cap for 2D and the large cap for CBCT/IOS', () => {
		expect(maxSizeFor('xray')).toBe(MAX_SIZE_2D);
		expect(maxSizeFor('photo')).toBe(MAX_SIZE_2D);
		expect(maxSizeFor('cbct')).toBe(MAX_SIZE_CBCT);
		expect(maxSizeFor('ios')).toBe(MAX_SIZE_CBCT); // same 100MB edge cap
	});
});

describe('formatBytes', () => {
	it('renders whole and fractional MB (en: dot decimal, trailing zero dropped)', () => {
		// Pin the locale so the assertion is deterministic regardless of the test
		// runner's default — formatBytes is now locale-aware (toLocaleString).
		expect(formatBytes(100 * 1024 * 1024, 'en-US')).toBe('100 MB');
		expect(formatBytes(Math.round(1.5 * 1024 * 1024), 'en-US')).toBe('1.5 MB');
	});

	it('localizes the decimal separator (the i18n-leak fix — de uses a comma)', () => {
		// A fractional file size in a German UI must read "1,5 MB", not "1.5 MB".
		expect(formatBytes(Math.round(1.5 * 1024 * 1024), 'de-DE')).toBe('1,5 MB');
		// A whole MB still drops the decimal entirely (no "100,0 MB").
		expect(formatBytes(100 * 1024 * 1024, 'de-DE')).toBe('100 MB');
	});

	it('localizes thousands grouping for large (>1 GB) sizes', () => {
		// A 1.5 GB CBCT is realistic; en groups with a comma, de with a period.
		const bytes = 1500 * 1024 * 1024;
		expect(formatBytes(bytes, 'en-US')).toBe('1,500 MB');
		expect(formatBytes(bytes, 'de-DE')).toBe('1.500 MB');
	});
});

describe('validateUploadFile', () => {
	it('rejects a 0-byte file as empty (xray)', () => {
		const r = validateUploadFile(fakeFile('tooth.png', 0, 'image/png'), 'xray');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toBe('empty');
			expect(r.messageKey).toBe('upload.errEmpty');
			expect(r.values?.name).toBe('tooth.png');
		}
	});

	it('rejects a 0-byte CBCT as empty', () => {
		const r = validateUploadFile(fakeFile('scan.nrrd', 0), 'cbct');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe('empty');
	});

	it('rejects a 0-byte IOS as empty', () => {
		const r = validateUploadFile(fakeFile('arch.stl', 0), 'ios');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe('empty');
	});

	it('rejects an oversized CBCT as tooLarge and reports the cap', () => {
		const r = validateUploadFile(fakeFile('big.nrrd', MAX_SIZE_CBCT + 1), 'cbct');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toBe('tooLarge');
			expect(r.messageKey).toBe('upload.errTooLarge');
			expect(r.values?.max).toBe('100 MB');
			expect(r.values?.size).toBeTruthy();
		}
	});

	it('rejects an oversized 2D xray as tooLarge', () => {
		const r = validateUploadFile(fakeFile('huge.png', MAX_SIZE_2D + 1, 'image/png'), 'xray');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe('tooLarge');
	});

	it('rejects a wrong-type / unsupported file as wrongType (detected type unknown)', () => {
		// A .txt: extension is unrecognised → detectModality returns null →
		// reported as "unknown".
		const r = validateUploadFile(fakeFile('notes.txt', 1024), '');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toBe('wrongType');
			expect(r.messageKey).toBe('upload.errWrongType');
			expect(r.values?.type).toBe('unknown');
		}
	});

	it('accepts a valid 2D xray', () => {
		expect(validateUploadFile(fakeFile('tooth.png', 2048, 'image/png'), 'xray').ok).toBe(true);
	});

	it('accepts a valid panoramic', () => {
		expect(validateUploadFile(fakeFile('pano.jpg', 4096, 'image/jpeg'), 'panoramic').ok).toBe(true);
	});

	it('accepts a valid CBCT under the cap', () => {
		expect(validateUploadFile(fakeFile('scan.nrrd', 5 * 1024 * 1024), 'cbct').ok).toBe(true);
	});

	it('accepts a valid IOS under the cap', () => {
		expect(validateUploadFile(fakeFile('arch.stl', 3 * 1024 * 1024), 'ios').ok).toBe(true);
	});

	it('falls back to extension detection when modality is omitted', () => {
		// .nrrd with no modality hint → detected as cbct → 100MB cap, so 50MB is fine.
		expect(validateUploadFile(fakeFile('scan.nrrd', 50 * 1024 * 1024)).ok).toBe(true);
		// A 60MB png with no hint → detected 'image' → 40MB 2D cap → tooLarge.
		const r = validateUploadFile(fakeFile('big.png', 60 * 1024 * 1024, 'image/png'));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe('tooLarge');
	});
});

describe('summarizeBatch', () => {
	it('all-ok when every file saved', () => {
		const s = summarizeBatch([
			{ name: 'a.png', ok: true },
			{ name: 'b.png', ok: true }
		]);
		expect(s.state).toBe('all-ok');
		expect(s.saved).toBe(2);
		expect(s.failed).toBe(0);
	});

	it('partial when some saved and some failed', () => {
		const s = summarizeBatch([
			{ name: 'a.png', ok: true },
			{ name: 'b.png', ok: false, reason: 'AI 500' },
			{ name: 'c.png', ok: true }
		]);
		expect(s.state).toBe('partial');
		expect(s.saved).toBe(2);
		expect(s.failed).toBe(1);
		if (s.state === 'partial') {
			expect(s.failures).toEqual([{ name: 'b.png', reason: 'AI 500' }]);
		}
	});

	it('all-failed when nothing saved', () => {
		const s = summarizeBatch([
			{ name: 'a.png', ok: false, reason: 'x' },
			{ name: 'b.png', ok: false, reason: 'y' }
		]);
		expect(s.state).toBe('all-failed');
		expect(s.saved).toBe(0);
		expect(s.failed).toBe(2);
		if (s.state === 'all-failed') expect(s.failures.length).toBe(2);
	});
});
