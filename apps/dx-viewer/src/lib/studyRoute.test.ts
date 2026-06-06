import { describe, it, expect } from 'vitest';
import { studyRoutePath, routeKindFor, studyBelongsOnRoute } from './studyRoute';

describe('studyRoutePath', () => {
	it('routes cbct studies to the 3D volume viewer', () => {
		expect(studyRoutePath('cbct', 'pat1', 'std1')).toBe('/cbct/pat1/std1');
	});

	it('routes ios studies to the 3D mesh viewer', () => {
		expect(studyRoutePath('ios', 'pat1', 'std1')).toBe('/ios/pat1/std1');
	});

	it('routes xray studies to the 2D image viewer', () => {
		expect(studyRoutePath('xray', 'pat1', 'std1')).toBe('/viewer/pat1/std1');
	});

	it('routes panoramic studies to the 2D image viewer', () => {
		expect(studyRoutePath('panoramic', 'pat1', 'std1')).toBe('/viewer/pat1/std1');
	});

	it('routes photo studies to the 2D image viewer', () => {
		expect(studyRoutePath('photo', 'pat1', 'std1')).toBe('/viewer/pat1/std1');
	});

	it('keeps patientId before studyId in the path', () => {
		expect(studyRoutePath('cbct', 'PATIENT', 'STUDY')).toBe('/cbct/PATIENT/STUDY');
	});

	it('falls back to the 2D viewer for unknown / missing modalities', () => {
		expect(studyRoutePath(undefined, 'pat1', 'std1')).toBe('/viewer/pat1/std1');
		expect(studyRoutePath(null, 'pat1', 'std1')).toBe('/viewer/pat1/std1');
		expect(studyRoutePath('something-else', 'pat1', 'std1')).toBe('/viewer/pat1/std1');
	});

	// The CBCT/IOS route pages redirect a wrong-modality landing via studyRoutePath,
	// so confirm the cross-route targets it resolves to.
	it('an ios study resolves to /ios (so an /cbct landing redirects away from CBCT)', () => {
		expect(studyRoutePath('ios', 'pat1', 'std1')).toBe('/ios/pat1/std1');
	});

	it('a cbct study resolves to /cbct (so an /ios landing redirects away from IOS)', () => {
		expect(studyRoutePath('cbct', 'pat1', 'std1')).toBe('/cbct/pat1/std1');
	});
});

describe('routeKindFor', () => {
	it('maps cbct to the cbct route kind', () => {
		expect(routeKindFor('cbct')).toBe('cbct');
	});

	it('maps ios to the ios route kind', () => {
		expect(routeKindFor('ios')).toBe('ios');
	});

	it('maps every 2D / unknown modality to the viewer route kind', () => {
		expect(routeKindFor('xray')).toBe('viewer');
		expect(routeKindFor('panoramic')).toBe('viewer');
		expect(routeKindFor('photo')).toBe('viewer');
		expect(routeKindFor(undefined)).toBe('viewer');
		expect(routeKindFor(null)).toBe('viewer');
		expect(routeKindFor('something-else')).toBe('viewer');
	});
});

describe('studyBelongsOnRoute', () => {
	it('a cbct study belongs only on the cbct route', () => {
		expect(studyBelongsOnRoute('cbct', 'cbct')).toBe(true);
		expect(studyBelongsOnRoute('cbct', 'ios')).toBe(false);
		expect(studyBelongsOnRoute('cbct', 'viewer')).toBe(false);
	});

	it('an ios study belongs only on the ios route', () => {
		expect(studyBelongsOnRoute('ios', 'ios')).toBe(true);
		expect(studyBelongsOnRoute('ios', 'cbct')).toBe(false);
		expect(studyBelongsOnRoute('ios', 'viewer')).toBe(false);
	});

	it('2D studies belong only on the viewer route — NOT on cbct/ios (the D1 guard)', () => {
		for (const m of ['xray', 'panoramic', 'photo'] as const) {
			expect(studyBelongsOnRoute(m, 'viewer')).toBe(true);
			expect(studyBelongsOnRoute(m, 'cbct')).toBe(false);
			expect(studyBelongsOnRoute(m, 'ios')).toBe(false);
		}
	});

	it('never marks a study as belonging on a route that would redirect it (no loop)', () => {
		// The route a study redirects to (routeKindFor) is exactly the one where it
		// belongs — so the redirect $effect can never re-fire after navigation.
		for (const m of ['cbct', 'ios', 'xray', 'panoramic', 'photo'] as const) {
			expect(studyBelongsOnRoute(m, routeKindFor(m))).toBe(true);
		}
	});
});
