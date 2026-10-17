import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sceneById } from "../../../scenes/index.ts";
import { presentCast, sceneBrief } from "../../runtime/brief.ts";
import { docsBefore, loadFixture, readCase, rewindFromCalls } from "./fixture.ts";
import { CASES_DIR } from "./paths.ts";
import { readdirSync } from "node:fs";

test("a note written on the turn or later is left out, and so is its index line", () => {
  const note = (turn: number) => `---\ntitle: "x"\ntype: "memory"\nturn: ${turn}\n---\nbody`;
  const { kept, dropped, undated } = docsBefore([
    { path: "Cast/Kell/memories/a.md", text: note(3) },
    { path: "Cast/Kell/memories/b.md", text: note(7) },
    { path: "Cast/Kell/memories/index.md", text: "# Memories\n- [A](a.md) — early\n- [B](b.md) — late" },
    { path: "Player/Xarax.md", text: "---\ntype: character\n---\nme" },
  ], 7);
  assert.deepEqual(dropped, ["Cast/Kell/memories/b.md"]);
  assert.deepEqual(undated, ["Player/Xarax.md"]);
  assert.equal(kept.find(d => d.path.endsWith("index.md"))!.text, "# Memories\n- [A](a.md) — early");
});

test("a note with no turn is set back to the turn's own GM call, or left to the source lore", () => {
  // The yard note is edited all game: by the end it tells of later turns.
  const yard = { path: "Places/Granary Yard.md", text: "---\ntype: place\n---\n# The granary yard\nThe water butt, rolled aside on turn 16." };
  const calls = [
    { operation: "gm.reply", text: "[Kell] “Not yet.” She waits.", request: { instructions: "", input: [
      { content: "## Who these people are (their lore)\n\n### The GM's own notes\n# The granary yard\nThe water butt, in its corner.\n\n# Somebody else\nx" },
    ] } },
  ];
  const rewind = rewindFromCalls(calls, "“Not yet.” She waits.", "/nowhere");
  const { kept, rewound, undated } = docsBefore([yard], 7, rewind);
  assert.deepEqual(rewound, ["Places/Granary Yard.md"]);
  assert.deepEqual(undated, []);
  assert.equal(kept[0]!.text, "---\ntype: place\n---\n# The granary yard\nThe water butt, in its corner.\n");
  // No call on the turn: a note the source lore has is left to it (out of the overlay).
  const { kept: none, toSource } = docsBefore([yard], 7, rewindFromCalls([], "anything", join(import.meta.dirname, "..", "..", "..", "lore")));
  assert.deepEqual(toSource, ["Places/Granary Yard.md"]);
  assert.equal(none.length, 0);
});

// Every checked-in case loads into a session the engine can brief, with its overlay in place.
for (const id of existsSync(CASES_DIR) ? readdirSync(CASES_DIR) : []) {
  test(`case ${id} loads`, () => {
    const dir = join(CASES_DIR, id);
    const c = readCase(dir);
    const runs = mkdtempSync(join(tmpdir(), "loop-fixture-"));
    const saved = process.env.KM_RUNS_DIR;
    process.env.KM_RUNS_DIR = runs;
    try {
      for (const harness of ["recorded", "fresh", "none"] as const) {
        const state = loadFixture(dir, { id: `${id}-${harness}`, harness });
        assert.equal(state.sceneId, c.scene);
        assert.equal(state.turn, c.turn - 1, "the fixture is the state after the turn before");
        assert.ok(!state.transcript.some(e => e.turn >= c.turn), "nothing from the turn under test");
        if (harness !== "recorded") assert.equal(state.notes, null);
        const scene = sceneById(state.sceneId);
        assert.ok(presentCast(scene, state).length > 0);
        assert.ok(sceneBrief(scene, state).includes(scene.title));
      }
      if (existsSync(join(dir, "lore"))) assert.ok(existsSync(join(runs, "sessions", `${id}-recorded`, "docs")));
      assert.ok(readFileSync(join(dir, "case.json"), "utf8").includes(c.input));
      assert.ok(!c.criterion.startsWith("TODO"), "the case has a criterion");
    } finally {
      if (saved === undefined) delete process.env.KM_RUNS_DIR; else process.env.KM_RUNS_DIR = saved;
    }
  });
}
