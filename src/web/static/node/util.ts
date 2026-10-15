/** node:util for the browser build: the little that might be asked for. */

export function inspect(value: unknown): string {
  try { return typeof value === "string" ? value : JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function format(...args: unknown[]): string {
  return args.map(a => (typeof a === "string" ? a : inspect(a))).join(" ");
}

export function promisify<T extends (...args: any[]) => void>(fn: T): (...args: any[]) => Promise<unknown> {
  return (...args) => new Promise((resolve, reject) => fn(...args, (error: unknown, value: unknown) => (error ? reject(error) : resolve(value))));
}

export const types = { isPromise: (v: unknown) => v instanceof Promise };
export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;

export default { inspect, format, promisify, types, TextEncoder, TextDecoder };
