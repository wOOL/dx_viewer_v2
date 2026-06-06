import { describe, it, expect } from 'vitest';
import { arrowNavIntent, isTextEntryTarget, sliceStepIntent, measureKeyIntent } from './keyboard';

describe('isTextEntryTarget', () => {
	it('treats inputs/textarea/select/contenteditable as text-entry (arrows edit, not navigate)', () => {
		expect(isTextEntryTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
		expect(isTextEntryTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
		expect(isTextEntryTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
		expect(
			isTextEntryTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)
		).toBe(true);
	});
	it('treats non-editable elements and null as non-text', () => {
		expect(isTextEntryTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
		expect(isTextEntryTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
		expect(isTextEntryTarget(null)).toBe(false);
	});
});

describe('arrowNavIntent', () => {
	it('maps Left→prev and Right→next', () => {
		expect(arrowNavIntent('ArrowLeft')).toBe('prev');
		expect(arrowNavIntent('ArrowRight')).toBe('next');
	});
	it('ignores non-arrow keys', () => {
		expect(arrowNavIntent('Enter')).toBeNull();
		expect(arrowNavIntent('a')).toBeNull();
		expect(arrowNavIntent('ArrowUp')).toBeNull();
	});
	it('returns null when blocked (a modal is open)', () => {
		expect(arrowNavIntent('ArrowRight', { blocked: true })).toBeNull();
		expect(arrowNavIntent('ArrowLeft', { blocked: true })).toBeNull();
	});
	it('returns null when the user is typing in a field', () => {
		const input = { tagName: 'INPUT' } as unknown as EventTarget;
		expect(arrowNavIntent('ArrowRight', { target: input })).toBeNull();
		const canvas = { tagName: 'CANVAS' } as unknown as EventTarget;
		expect(arrowNavIntent('ArrowRight', { target: canvas })).toBe('next');
	});
});

describe('sliceStepIntent', () => {
	it('maps Up→-1 (toward slice 0) and Down→+1, ignoring Left/Right and other keys', () => {
		expect(sliceStepIntent('ArrowUp')).toBe(-1);
		expect(sliceStepIntent('ArrowDown')).toBe(1);
		expect(sliceStepIntent('ArrowLeft')).toBeNull();
		expect(sliceStepIntent('ArrowRight')).toBeNull();
		expect(sliceStepIntent('w')).toBeNull();
	});
	it('returns null when blocked (modal open) or while typing', () => {
		expect(sliceStepIntent('ArrowUp', { blocked: true })).toBeNull();
		expect(
			sliceStepIntent('ArrowDown', { target: { tagName: 'INPUT' } as unknown as EventTarget })
		).toBeNull();
	});
});

describe('measureKeyIntent', () => {
	it('does nothing when measure mode is off', () => {
		expect(measureKeyIntent('Escape', { measureMode: false, hasPending: true })).toBeNull();
		expect(measureKeyIntent('Backspace', { measureMode: false, hasSegments: true })).toBeNull();
	});
	it('Escape cancels a pending point, else exits the tool', () => {
		expect(measureKeyIntent('Escape', { measureMode: true, hasPending: true })).toBe(
			'cancel-pending'
		);
		expect(measureKeyIntent('Escape', { measureMode: true, hasPending: false })).toBe('exit-mode');
		// Exit-mode regardless of how many committed segments exist.
		expect(measureKeyIntent('Escape', { measureMode: true, hasSegments: true })).toBe('exit-mode');
	});
	it('Backspace/Delete undoes the last segment, cancelling a pending point first', () => {
		expect(measureKeyIntent('Backspace', { measureMode: true, hasSegments: true })).toBe(
			'undo-last'
		);
		expect(measureKeyIntent('Delete', { measureMode: true, hasSegments: true })).toBe('undo-last');
		// A pending point takes priority over undoing a committed segment.
		expect(
			measureKeyIntent('Backspace', { measureMode: true, hasPending: true, hasSegments: true })
		).toBe('cancel-pending');
		// Nothing to undo and nothing pending → no-op.
		expect(measureKeyIntent('Delete', { measureMode: true, hasSegments: false })).toBeNull();
	});
	it('ignores unrelated keys and never fires while the user is typing', () => {
		expect(measureKeyIntent('a', { measureMode: true, hasPending: true })).toBeNull();
		const input = { tagName: 'INPUT' } as unknown as EventTarget;
		expect(
			measureKeyIntent('Escape', { measureMode: true, hasPending: true, target: input })
		).toBeNull();
		expect(
			measureKeyIntent('Backspace', { measureMode: true, hasSegments: true, target: input })
		).toBeNull();
	});
});
