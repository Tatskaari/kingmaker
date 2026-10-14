import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.KM_LOOK_MODEL = "off";
const { LookCache, flushInventions, inventionCalls, setInventor, setLookCache, lookCache } = await import("./invent.ts");
const { describeLook, lookOf, resetLooks } = await import("./appearance.ts");

/** A stand-in for Luna: records what it was asked, answers from a table. */
function fakeModel() {
  const asked: string[][] = [];
  const inventor = async (items: Array<{ key: string; name: string; kind?: string }>) => {
    asked.push(items.map(i => i.key));
    const out: Record<string, { glyph: string; nerd?: string; color: "brass" | "cream" | "violet"; motion: "still" | "pulse"; light: boolean; being: boolean; group: boolean; material?: string }> = {};
    for (const i of items) {
      if (i.key === "sackbut") out[i.key] = { glyph: "♪", nerd: "trumpet", color: "brass", motion: "still", light: false, being: false, group: false, material: "brass" };
      if (i.key === "marzipan") out[i.key] = { glyph: "%", color: "cream", motion: "still", light: false, being: false, group: false };
      if (i.key === "homunculus") out[i.key] = { glyph: "h", color: "violet", motion: "pulse", light: true, being: true, group: false };
    }
    return out;
  };
  return { asked, inventor };
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "look-cache-"));
  const path = join(dir, "look-cache.json");
  setLookCache(new LookCache(path));
  resetLooks();
  return { dir, path, done: () => { setInventor(undefined); setLookCache(undefined); resetLooks(); rmSync(dir, { recursive: true, force: true }); } };
}

test("rules first: names the rules know never reach the model", async () => {
  const box = sandbox();
  const model = fakeModel();
  setInventor(model.inventor);
  try {
    for (const name of ["a flock of pigeons", "a burning branch", "a singed pigeon", "ale", "a tea tray", "the old elm", "a pool of blood"]) describeLook({ name, kind: "item" });
    await flushInventions();
    assert.deepEqual(model.asked, []);
  } finally { box.done(); }
});

test("an unknown name gets a guess now, one batched model call, and the answer from then on", async () => {
  const box = sandbox();
  const model = fakeModel();
  setInventor(model.inventor);
  try {
    const sackbut = { name: "a sackbut", kind: "item" };
    const first = describeLook(sackbut);
    assert.equal(first.source, "guess");
    describeLook({ name: "a quantity of marzipan", kind: "item" });
    describeLook({ name: "a glowing homunculus", kind: "creature" });
    // Rendering asks again and again: no extra requests.
    for (let i = 0; i < 50; i++) lookOf(sackbut, { t: i * 33 });
    const calls = inventionCalls();
    const landed = await flushInventions();
    assert.equal(landed, 3);
    assert.equal(inventionCalls() - calls, 1, "one call for the batch");
    assert.equal(model.asked.length, 1);
    assert.deepEqual([...model.asked[0]!].sort(), ["homunculus", "marzipan", "sackbut"]); // "glowing" is a state (lit), not part of the key
    const after = describeLook(sackbut);
    assert.equal(after.source, "cache");
    assert.equal(after.ascii, "♪");
    assert.notEqual(after.nerd, "♪", "and its Nerd Font icon");
    // A glowing homunculus glows: light from the model's answer, pulsing.
    assert.ok(lookOf({ name: "a glowing homunculus", kind: "creature" }, { t: 0 }).light);
    // States still apply on top of an invented look.
    assert.ok(lookOf({ name: "a sackbut", kind: "item", states: ["burning"] }, { t: 0 }).glow);
  } finally { box.done(); }
});

test("the cache is on disk: a new process (a new cache object) costs nothing", async () => {
  const box = sandbox();
  const model = fakeModel();
  setInventor(model.inventor);
  try {
    describeLook({ name: "a sackbut", kind: "item" });
    await flushInventions();
    assert.ok(existsSync(box.path));
    const file = JSON.parse(readFileSync(box.path, "utf8"));
    assert.equal(file.version, 1);
    assert.equal(file.looks.sackbut.glyph, "♪");
    assert.equal(file.looks.sackbut.name, "a sackbut");
    // Next session: a fresh cache object on the same file, a model that must not be called.
    setLookCache(new LookCache(box.path));
    resetLooks();
    const strict = fakeModel();
    setInventor(strict.inventor);
    assert.equal(describeLook({ name: "a sackbut", kind: "item" }).source, "cache");
    assert.equal(describeLook({ name: "the sackbut", kind: "item" }).source, "cache", "the same kind of thing, however it's named");
    await flushInventions();
    assert.deepEqual(strict.asked, []);
    assert.equal(lookCache().size, 1);
  } finally { box.done(); }
});

test("when the model fails or is off, the guess stands and nothing breaks", async () => {
  const box = sandbox();
  try {
    setInventor(async () => { throw new Error("offline"); });
    const thing = { name: "a whirligig", kind: "item" };
    assert.equal(describeLook(thing).source, "guess");
    assert.equal(await flushInventions(), 0);
    assert.equal(describeLook(thing).source, "guess");
    assert.ok(lookOf(thing, { t: 0 }).glyph.length > 0);
    setInventor(undefined);
    assert.equal(describeLook({ name: "a gimcrack", kind: "item" }).source, "guess");
    assert.equal(await flushInventions(), 0);
  } finally { box.done(); }
});
