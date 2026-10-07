import assert from "node:assert/strict";
import test from "node:test";
import { Autosave } from "../apps/web/src/autosave.js";
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("dirty actions coalesce into periodic saves and clean periods do no work", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let saved = 0;
  const autosave = new Autosave({ save: async () => { saved++; }, error: assert.fail });
  autosave.markDirty(); autosave.markDirty();
  assert.equal(saved, 0);
  t.mock.timers.tick(4999); await turn(); assert.equal(saved, 0);
  t.mock.timers.tick(1); await turn(); assert.equal(saved, 1);
  t.mock.timers.tick(20_000); await turn(); assert.equal(saved, 1);
});

test("slow storage does not block new mutations or overlap saves", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: () => void, saved = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const autosave = new Autosave({ save: async () => { if (++saved === 1) await gate; }, error: assert.fail });
  autosave.markDirty(); t.mock.timers.tick(5000); await turn();
  autosave.markDirty(); t.mock.timers.tick(20_000); await turn();
  assert.equal(saved, 1);
  release(); await turn();
  t.mock.timers.tick(5000); await turn(); assert.equal(saved, 2);
  await autosave.flush(); assert.equal(saved, 2);
});

test("failed saves retain dirty state and retry; explicit flush waits for it", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0, failures = 0;
  const autosave = new Autosave({ save: async () => { if (++attempts === 1) throw new Error("offline"); }, error: () => { failures++; } });
  autosave.markDirty(); t.mock.timers.tick(5000); await turn();
  assert.equal(failures, 1);
  await autosave.flush(); assert.equal(attempts, 2);
  t.mock.timers.tick(5000); await turn(); assert.equal(attempts, 2);
});
