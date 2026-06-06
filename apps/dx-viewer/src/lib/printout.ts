export interface CapResult<T> {
	/** The items that should actually be rendered into the printout. */
	shown: T[];
	/** How many items were dropped because the list exceeded the cap. */
	omitted: number;
}

/**
 * Cap a list of studies for the patient printout so a huge patient cannot build
 * an unbounded HTML document (and trigger that many concurrent image loads).
 *
 * @param list full list of studies to print
 * @param max maximum number of items to include (must be a positive integer)
 * @returns the capped slice plus how many were omitted
 */
export function capForPrint<T>(list: T[], max: number): CapResult<T> {
	if (!Array.isArray(list)) return { shown: [], omitted: 0 };
	const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
	if (list.length <= limit) return { shown: list, omitted: 0 };
	return { shown: list.slice(0, limit), omitted: list.length - limit };
}
