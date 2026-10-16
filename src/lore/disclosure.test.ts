import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-disclosure-"));
process.env.OPENROUTER_API_KEY = "offline";
const { createSession } = await import("../runtime/engine.ts");
const { effectiveScene } = await import("../runtime/brief.ts");
const { memoryBrief } = await import("./disclosure.ts");
const { sceneById } = await import("../../scenes/index.ts");
const { PREGENS } = await import("../game/combat/pregen.ts");

// The user's report of 2026-10-16: one GM voices everyone, and each person's notes call them "you",
// so what only Cob heard in the loft ("Silvertop wanted the page") came out of Kell.
test("each person's block in the GM's memory says whose it is, and nobody else knows it", async () => {
  const session = await createSession({ sceneId: "hanged-clerk", approach: "v2", player: "Tamsin Vell: a disgraced palace auditor", level: 3, build: PREGENS.rogue!.build, seed: 3 });
  const scene = effectiveScene(sceneById("hanged-clerk"), []);
  const lore = memoryBrief(scene, session, "stable") ?? "";
  for (const name of ["Cob", "Moll", "Sergeant Agnes Kell"]) {
    assert.match(lore, new RegExp(`### ${name}: their own lore\\nEverything in this block is ${name}'s alone \\("you" and "I" in it are ${name}\\): nobody else here knows any of it unless they were there too, or ${name} says it in their hearing\\.`));
  }
  assert.doesNotMatch(lore, /### The GM's own notes[^\n]*\nEverything in this block/, "the GM's own notes are the GM's, not anyone's in the story");
});
