/**
 * `server-only` throws by design when imported outside a React Server Component graph.
 * Integration tests deliberately exercise the server modules in plain Node, so vitest
 * aliases the package to this no-op. Nothing else in the app resolves to it.
 */
export {};
