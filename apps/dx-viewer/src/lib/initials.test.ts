import { describe, it, expect } from 'vitest';
import { userInitials } from './initials';

describe('userInitials', () => {
	it('takes the first letters of up to three name words', () => {
		expect(userInitials({ name: 'Jane Doe' })).toBe('JD');
		expect(userInitials({ name: 'mary jane watson' })).toBe('MJW');
		expect(userInitials({ name: 'Cher' })).toBe('C');
		// caps at three words
		expect(userInitials({ name: 'a b c d e' })).toBe('ABC');
	});

	it('falls back to the email local-part when there is no name', () => {
		expect(userInitials({ email: 'jdoe@becertain.ai' })).toBe('JD');
		expect(userInitials({ name: '', email: 'sam@x.io' })).toBe('SA');
		// strips non-alphanumerics from the local part
		expect(userInitials({ email: '_.x@y.z' })).toBe('X');
	});

	it('falls back to an em dash when nothing is available', () => {
		expect(userInitials(null)).toBe('—');
		expect(userInitials(undefined)).toBe('—');
		expect(userInitials({})).toBe('—');
		expect(userInitials({ name: '   ' })).toBe('—');
	});
});
