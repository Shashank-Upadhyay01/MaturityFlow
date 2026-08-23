/**
 * serialize.ts — the BigInt boundary.
 *
 * Server Components may hold `bigint`. React cannot serialise `bigint` across the RSC
 * boundary, so anything crossing into a Client Component is converted to a decimal string
 * here, and re-parsed with `BigInt(...)` on the other side. One place, one rule.
 */

export type Serialized<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends Array<infer U>
      ? Array<Serialized<U>>
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T;

export function serialize<T>(value: T): Serialized<T> {
  if (typeof value === 'bigint') return value.toString() as Serialized<T>;
  if (value instanceof Date) return value.toISOString() as Serialized<T>;
  if (Array.isArray(value)) return value.map(serialize) as Serialized<T>;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v);
    return out as Serialized<T>;
  }
  return value as Serialized<T>;
}

/** Client-side counterpart. */
export function toPaise(value: string | number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}
