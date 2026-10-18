/**
 * The engine's ids (random each time) as #1, #2… in the order they first appear, as the recorder
 * (tools/v2/record-v1-golden.mts) masked them: what a test compares with the goldens in this folder.
 */
export function masked<T>(value: T): T {
  const ids = new Map<string, string>();
  const walk = (x: unknown): unknown => typeof x === "string" ? (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(x) ? (ids.get(x) ?? ids.set(x, `#${ids.size + 1}`).get(x)) : x)
    : Array.isArray(x) ? x.map(walk)
    : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
    : x;
  return walk(value) as T;
}
