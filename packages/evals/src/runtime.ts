import { ConversationRuntime, type ConversationRuntimeOptions } from "../../conversation/src/runtime.js";
import type { RuntimeServices } from "../../conversation/src/services.js";
import type { Recording } from "../../service-tools/src/recording.js";

/** Factories receive recorded dependencies. Use the supplied services instead of capturing raw peers. */
export type ServiceFactories = { [K in keyof RuntimeServices]?: (services: RuntimeServices) => Partial<RuntimeServices[K]> };
export interface EvalRuntimeOptions<L, R> extends Omit<ConversationRuntimeOptions<L, R>, "services"> { services?: ServiceFactories }

/** Construct each dependency once per trial, recording it before any dependent factory can use it. */
export function createRecordedRuntime<L, R>(options: EvalRuntimeOptions<L, R>, recording: Recording): ConversationRuntime<L, R> {
  const { services: factories = {}, ...policy } = options;
  const runtime = new ConversationRuntime<L, R>(policy);
  const defaults = { ...runtime.services }, cache = new Map<keyof RuntimeServices, object>(), constructing = new Set<string>();
  const resolve = <K extends keyof RuntimeServices>(name: K): RuntimeServices[K] => {
    if (cache.has(name)) return cache.get(name) as RuntimeServices[K];
    if (constructing.has(name)) throw new Error(`Circular service dependency: ${[...constructing, name].join(" -> ")}`);
    constructing.add(name);
    try {
      const overrides = factories[name]?.(dependencies) ?? {};
      const base = defaults[name];
      // Bind each override to its original receiver, including instances with private fields.
      const merged = new Proxy(base, { get(target, key) {
        const source = key in overrides ? overrides : target;
        const value: unknown = Reflect.get(source, key, source);
        return typeof value === "function" ? value.bind(source) : value;
      } });
      const recorded = recording.wrap(name, merged);
      cache.set(name, recorded);
      runtime.services[name] = recorded;
      return recorded;
    } finally { constructing.delete(name); }
  };
  const dependencies = new Proxy({} as RuntimeServices, { get: (_target, name) => {
    if (!Object.hasOwn(defaults, name)) throw new Error(`Unknown service: ${String(name)}`);
    return resolve(name as keyof RuntimeServices);
  } });
  for (const name of Object.keys(defaults) as (keyof RuntimeServices)[]) resolve(name);
  return runtime;
}
