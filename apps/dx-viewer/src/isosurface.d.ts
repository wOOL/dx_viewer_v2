// `isosurface` (mikolalysenko/isosurface) ships no TypeScript declarations.
// Minimal ambient types for the bits we use (surfaceNets re-surfacing).
declare module 'isosurface' {
	interface IsoResult {
		positions: number[][];
		cells: number[][];
	}
	type Potential = (x: number, y: number, z: number) => number;
	const isosurface: {
		surfaceNets(dims: number[], potential: Potential, bounds?: number[][]): IsoResult;
		marchingCubes(dims: number[], potential: Potential, bounds?: number[][]): IsoResult;
		marchingTetrahedra(dims: number[], potential: Potential, bounds?: number[][]): IsoResult;
	};
	export default isosurface;
}
