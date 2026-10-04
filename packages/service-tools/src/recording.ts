import { AsyncLocalStorage } from "node:async_hooks";

export interface ServiceCall {
  id: number;
  parentId?: number;
  service: string;
  method: string;
  args: unknown;
  startedAt: string;
  durationMs?: number;
  outcome?: { status: "returned"; value: unknown } | { status: "threw"; error: unknown };
}

/** Detached, JSON-safe evidence. Secrets are removed before entering the recording. */
export function capture(value: unknown, secrets: readonly string[] = [], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join("[redacted]"), value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[callback]";
  if (value === undefined) return null;
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (value instanceof AbortSignal) return { aborted: value.aborted };
    if (value instanceof Error) return capture({ name: value.name, message: value.message }, secrets, seen);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) return capture([...value], secrets, seen);
    if (value instanceof Set) return capture([...value], secrets, seen);
    if (Array.isArray(value)) return value.map(item => capture(item, secrets, seen));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /^(authorization|api[-_]?key|access[-_]?token)$/i.test(key) ? "[redacted]" : capture(item, secrets, seen)]));
  } finally { seen.delete(value); }
}

/** One recording spans composed services, retaining parentage across async calls. */
export class Recording {
  private readonly entries: ServiceCall[] = [];
  private readonly active = new AsyncLocalStorage<number>();
  private readonly wrappers = new WeakMap<object, Map<string, object>>();
  constructor(private readonly secrets: readonly string[] = []) {}
  snapshot(value: unknown): unknown { return capture(value, this.secrets); }
  getCalls(): ServiceCall[] { return structuredClone(this.entries); }
  getServiceRecord(name: string): ServiceCall[] { return this.getCalls().filter(call => call.service === name); }

  wrap<T extends object>(name: string, service: T): T {
    const cached = this.wrappers.get(service)?.get(name);
    if (cached) return cached as T;
    const methods = new Map<PropertyKey, { original: Function; wrapped: Function }>();
    const proxy = new Proxy(service, { get: (target, key) => {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (methods.get(key)?.original === value) return methods.get(key)!.wrapped;
      const wrapped = (...args: unknown[]) => {
        const parentId = this.active.getStore();
        const call: ServiceCall = { id: this.entries.length + 1, ...(parentId === undefined ? {} : { parentId }),
          service: name, method: String(key), args: this.snapshot(args), startedAt: new Date().toISOString() };
        this.entries.push(call);
        const started = performance.now();
        const finish = (status: "returned" | "threw", result: unknown) => {
          call.durationMs = performance.now() - started;
          call.outcome = status === "returned" ? { status, value: this.snapshot(result) } : { status, error: this.snapshot(result) };
        };
        return this.active.run(call.id, () => {
          try {
            const result: unknown = Reflect.apply(value, target, args);
            if (result && typeof (result as PromiseLike<unknown>).then === "function") {
              return Promise.resolve(result).then(value => { finish("returned", value); return value; },
                error => { finish("threw", error); throw error; });
            }
            finish("returned", result); return result;
          } catch (error) { finish("threw", error); throw error; }
        });
      };
      methods.set(key, { original: value, wrapped });
      return wrapped;
    } });
    for (const object of [service, proxy]) {
      const cache = this.wrappers.get(object) ?? new Map<string, object>();
      cache.set(name, proxy); this.wrappers.set(object, cache);
    }
    return proxy;
  }
}
