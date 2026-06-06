// Re-export shim: the implementation moved to @be-certain/core (Phase B
// extraction). Keeping this module means every `$lib/pb` import in the app —
// and the `vi.mock('$lib/pb')`-style test seams — keep working unchanged.
export * from '@be-certain/core/pb';
