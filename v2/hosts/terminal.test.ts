import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { glyphSet, setGlyphSet } from "../client/look/glyphs.ts";
import { invented, LookCache, lookCache, setLookCache, type CachedInvention } from "../client/look/invent.ts";
import { pacing, setPace } from "../client/pace.ts";
import { configureTerminal, lookFile } from "./terminal.ts";

/**
 * A terminal host sets the client as the client used to set itself (browser-design §4.1): the glyph
 * set from KM_GLYPHS, the pace from KM_APP_STEP_MS and KM_APP_TALK_MS, the invented looks from
 * KM_LOOK_CACHE's file. Without a host (a page), the client draws with ascii, at its own pace, its
 * looks in memory.
 */

const SWAN: CachedInvention = { glyph: "v", color: "white", motion: "still", light: false, being: true, group: false, name: "a disgruntled swan", model: "custom", at: "2026-10-17T09:00:00.000Z" };

test("a terminal host sets the glyph set, the pace and the looks' file from the environment; without one, ascii, the client's pace and looks in memory", t => {
  const dir = mkdtempSync(join(tmpdir(), "km-terminal-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); setGlyphSet(undefined); setPace({ stepMs: 45, talkMs: 700 }); setLookCache(undefined); });

  assert.equal(glyphSet(), "ascii");
  assert.deepEqual(pacing(), { stepMs: 45, talkMs: 700 });
  assert.equal(invented("swan"), undefined);

  const file = join(dir, "looks.json");
  writeFileSync(file, JSON.stringify({ version: 1, looks: { swan: SWAN } }));
  configureTerminal({ KM_GLYPHS: "plain", KM_APP_STEP_MS: "5", KM_APP_TALK_MS: "0", KM_LOOK_CACHE: file });

  assert.equal(glyphSet(), "plain");
  assert.deepEqual(pacing(), { stepMs: 5, talkMs: 0 });
  assert.deepEqual(invented("swan"), SWAN);
});

test("the looks' file is read once, on first use (none there, or a broken one, is no looks), and kept whole", t => {
  const dir = mkdtempSync(join(tmpdir(), "km-looks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const file = join(dir, "runs", "look-cache.json");
  const cache = new LookCache(lookFile(file));
  assert.equal(cache.size, 0);
  cache.set("swan", SWAN);
  cache.save();
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { version: 1, looks: { swan: SWAN } });
  assert.deepEqual(new LookCache(lookFile(file)).get("swan"), SWAN);

  writeFileSync(file, "{ half a cache");
  assert.equal(new LookCache(lookFile(file)).size, 0);

  // A cache with no store keeps its looks in memory: saving them writes nothing.
  setLookCache(undefined);
  lookCache().set("swan", SWAN);
  lookCache().save();
  assert.deepEqual(invented("swan"), SWAN);
  setLookCache(undefined);
});
