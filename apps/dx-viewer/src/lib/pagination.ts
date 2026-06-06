// Render-side pagination. The store holds the full list in memory (cheap — study
// metadata only; heavy inference lives in IndexedDB, loaded lazily), but rendering ALL of it
// at once is what bogs down / crashes a tab once an account has hundreds–thousands
// of records (most acutely the image-tile grids). `paginate` slices the current
// page out of an already-filtered list; the page index is clamped so a shrinking
// list (e.g. after a search) can never strand the view on an out-of-range page.

export interface Paged<T> {
	items: T[]; // the slice to render for the current page
	page: number; // clamped current page (0-based)
	pageCount: number; // total pages, always >= 1 (so "Page 1 of 1" reads sanely)
	total: number; // total items across all pages
	pageSize: number;
}

export function paginate<T>(items: T[], page: number, pageSize: number): Paged<T> {
	const size = Math.max(1, Math.floor(pageSize) || 1);
	const total = items.length;
	const pageCount = Math.max(1, Math.ceil(total / size));
	const req = Number.isFinite(page) ? Math.floor(page) : 0;
	const clamped = Math.min(Math.max(0, req), pageCount - 1);
	const start = clamped * size;
	return {
		items: items.slice(start, start + size),
		page: clamped,
		pageCount,
		total,
		pageSize: size
	};
}
