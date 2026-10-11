import { newQuickJSWASMModuleFromVariant, type QuickJSHandle } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import type { CompiledHook } from "./compiler.js";
import type { HookServices, TransitionResult } from "./services.js";

let modulePromise: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
/** Fresh VM per invocation. Only explicit services cross the boundary; never host objects. */
export async function runHook(hook: CompiledHook, bind: (guard: () => void) => HookServices,
  signal: AbortSignal, timeoutMs = 1000): Promise<TransitionResult> {
  signal.throwIfAborted();
  const module = await (modulePromise ??= newQuickJSWASMModuleFromVariant(variant));
  signal.throwIfAborted();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  const deadline = Date.now() + timeoutMs;
  let closed = false, inCallback = false, calls = 0;
  const guard = () => {
    signal.throwIfAborted();
    if (closed || Date.now() >= deadline) throw new Error("Hook execution expired");
  };
  const services = bind(guard);
  runtime.setInterruptHandler(() => closed || signal.aborted || Date.now() >= deadline);
  const vm = runtime.newContext();
  const pending = new Set<Promise<void>>();
  const disposables: { alive: boolean; dispose(): void }[] = [];
  const encode = (value: unknown) => value === undefined ? vm.undefined.dup() : vm.unwrapResult(vm.evalCode(`(${JSON.stringify(value)})`));
  function string(value: unknown): string {
    if (typeof value !== "string" || value.length > 4096) throw new Error("Expected a string of at most 4096 characters");
    return value;
  }
  function revision(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 0xffff_ffff) throw new Error("Invalid quest revision");
    return Number(value);
  }
  function call(name: string, args: QuickJSHandle[]): unknown {
    guard();
    if (inCallback) throw new Error("Fixture callbacks cannot call services");
    if (++calls > 64) throw new Error("Hook service call limit exceeded");
    const values = args.map(arg => vm.typeof(arg) === "function" ? undefined : vm.dump(arg));
    switch (name) {
      case "quests.list": return services.quests.list();
      case "quests.read": return services.quests.read(string(values[0]));
      case "map.listFixtures": return services.map.listFixtures();
      case "quests.setActive":
        if (typeof values[1] !== "boolean") throw new Error("Expected active boolean");
        return services.quests.setActive(string(values[0]), values[1], revision(values[2]));
      case "quests.transition": return services.quests.transition(string(values[0]), string(values[1]), revision(values[2]), values[3] === undefined ? undefined : string(values[3]));
      case "map.updateFixture": {
        if (!args[1] || vm.typeof(args[1]) !== "function") throw new Error("Expected synchronous fixture callback");
        const callback = args[1].dup(); disposables.push(callback);
        return services.map.updateFixture(string(values[0]), fixture => {
          guard();
          const draft = encode(fixture);
          inCallback = true;
          try {
            const result = vm.unwrapResult(vm.callFunction(callback, vm.undefined, draft));
            try { if (vm.typeof(result) !== "undefined") throw new Error("Fixture callback must return nothing and cannot be async"); }
            finally { result.dispose(); }
            const updated = vm.dump(draft);
            if (!updated || updated.id !== fixture.id || !Array.isArray(updated.actions)) throw new Error("Invalid fixture update");
            fixture.actions = updated.actions;
          } finally { inCallback = false; draft.dispose(); }
        });
      }
      default: throw new Error("Unknown hook service");
    }
  }
  const root = vm.newObject(); disposables.push(root);
  for (const [service, methods] of Object.entries({ quests: ["list", "read", "setActive", "transition"], map: ["listFixtures", "updateFixture"] })) {
    const object = vm.newObject(); disposables.push(object);
    for (const method of methods) {
      const asynchronous = ["setActive", "transition", "updateFixture"].includes(method);
      const fn = vm.newFunction(method, (...args) => {
        guard();
        if (inCallback) throw new Error("Fixture callbacks cannot call services");
        if (!asynchronous) return encode(call(`${service}.${method}`, args));
        const promise = vm.newPromise(); disposables.push(promise);
        // Copy argument handles before yielding back to the guest.
        const kept = args.map(arg => arg.dup());
        const work = Promise.resolve().then(() => call(`${service}.${method}`, kept)).then(value => {
          guard(); const result = encode(value);
          try { promise.resolve(result); } finally { result.dispose(); }
        }).catch(error => {
          const result = vm.newError(String(error));
          try { promise.reject(result); } finally { result.dispose(); }
        }).finally(() => { for (const arg of kept) arg.dispose(); pending.delete(work); });
        pending.add(work);
        return promise.handle;
      });
      vm.setProp(object, method, fn); fn.dispose();
    }
    vm.setProp(root, service, object);
  }
  vm.setProp(vm.global, "services", root);
  let output: QuickJSHandle | undefined;
  try {
    guard();
    output = vm.unwrapResult(vm.evalCode(`(function() { const exports = {};\n${hook.javascript}\nreturn exports.default(services); })()`, "hook.js"));
    while (true) {
      guard();
      const jobs = runtime.executePendingJobs(100);
      if (jobs.error) { const message = vm.dump(jobs.error); jobs.error.dispose(); throw new Error(JSON.stringify(message)); }
      const state = vm.getPromiseState(output);
      if (state.type === "fulfilled") {
        try {
          if (pending.size) throw new Error("Await every hook service write before returning");
          const result = vm.dump(state.value);
          if (!result || !["accepted", "rejected"].includes(result.status)
            || (result.message !== undefined && (typeof result.message !== "string" || result.message.length > 4096))
            || (result.status === "rejected" && typeof result.message !== "string")) throw new Error("Hook must return a valid TransitionResult");
          return result as TransitionResult;
        } finally { state.value.dispose(); }
      }
      if (state.type === "rejected") {
        try { throw new Error(JSON.stringify(vm.dump(state.error))); } finally { state.error.dispose(); }
      }
      if (pending.size) await Promise.race(pending);
      else if (!runtime.hasPendingJob()) throw new Error("Hook is awaiting an unresolved promise");
    }
  } finally {
    closed = true;
    await Promise.allSettled(pending);
    output?.dispose();
    for (const item of disposables.reverse()) if (item.alive) item.dispose();
    vm.dispose(); runtime.dispose();
  }
}
