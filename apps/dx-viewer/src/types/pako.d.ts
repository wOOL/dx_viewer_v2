// Minimal shim for the runtime-only `pako` package; the project ships its own
// API surface via `import pako from 'pako'`.
declare module 'pako' {
	export function inflate(
		data: Uint8Array | ArrayBuffer | number[],
		opts?: { to?: 'string' }
	): Uint8Array;
	export function inflate(
		data: Uint8Array | ArrayBuffer | number[],
		opts: { to: 'string' }
	): string;
	export function ungzip(
		data: Uint8Array | ArrayBuffer | number[],
		opts?: { to?: 'string' }
	): Uint8Array;
	export function ungzip(data: Uint8Array | ArrayBuffer | number[], opts: { to: 'string' }): string;
	export function deflate(
		data: Uint8Array | ArrayBuffer | string | number[],
		opts?: unknown
	): Uint8Array;
	export function gzip(
		data: Uint8Array | ArrayBuffer | string | number[],
		opts?: unknown
	): Uint8Array;
	const pako: {
		inflate: typeof inflate;
		ungzip: typeof ungzip;
		deflate: typeof deflate;
		gzip: typeof gzip;
	};
	export default pako;
}
