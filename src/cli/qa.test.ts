import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The QA console's character creation (src/cli/qa.ts), offline, as a QA agent or the tour would use
 * it: qa builds offers the three, qa new --build takes one of the same three (or one of their own)
 * with a backstory (from the line or a file), and the game has them: the sheet shows the backstory,
 * and the session keeps it.
 */

const runs = mkdtempSync(join(tmpdir(), "km-qa-"));
const qa = (...args: string[]) => execFileSync(process.execPath, ["--no-warnings", join(import.meta.dirname, "qa.ts"), ...args], {
  env: { ...process.env, KM_RUNS_DIR: runs, OPENROUTER_API_KEY: "offline", KM_LOOK_MODEL: "off", KM_GLYPHS: "ascii" }, encoding: "utf8",
});
const WHO = "Brother Odo: a large, gentle hedge-priest who settles arguments by sitting on them";

test("qa builds offers three, and qa new --build takes one of the same three, with a backstory", () => {
  const offered = qa("builds", "--session", "qa-odo", "--as", WHO);
  assert.match(offered, /offline: three from the class defaults/);
  const lines = [...offered.matchAll(/^(\d)\. (.+)$/gm)].map(m => m[2]!);
  assert.equal(lines.length, 3, offered);
  assert.match(lines[0]!, /Cleric 3/, "a hedge-priest's first is a cleric");
  const made = qa("new", "--session", "qa-odo", "--as", WHO, "--build", "2", "--backstory", "I was the temple's porter in the Nine Furrows until the bishop's goat ate the tithe-book. I owe Sister Mabb a new hymnal.");
  assert.match(made, new RegExp(`Build 2 of three: .*\\n${lines[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "the second of the same three");
  assert.match(made, /Backstory: The GM is offline, so nobody has checked it/);
  assert.match(made, /Who you are: Brother Odo, in their own words/);
  assert.match(made, /MODE: explore/);
  const sheet = qa("sheet", "--session", "qa-odo");
  assert.match(sheet, /Bonds: I owe Sister Mabb a new hymnal\./);
  assert.match(sheet, /Backstory:\n  I was the temple's porter/);
  const state = JSON.parse(readFileSync(join(runs, "sessions", "qa-odo", "state.json"), "utf8")) as { player: { backstory?: { text: string } } };
  assert.match(state.player.backstory!.text, /bishop's goat/, "saved with the game");
  assert.ok(existsSync(join(runs, "sessions", "qa-odo", "docs", "Player", "Brother Odo.md")), "the player's doc, in the session's own lore");
});

test("qa new --build own: makes one of their own from the SRD's ids, and the backstory can come from a file", () => {
  const file = join(runs, "story.txt");
  writeFileSync(file, "Mother drowned in the flood of '89.\nI never could hold my drink.");
  const made = qa("new", "--session", "qa-own", "--as", "Grimm: an orc who reads", "--build", "own:orc,wizard,evoker,soldier", "--backstory-file", file);
  assert.match(made, /Your own: orc wizard 3 \(Evoker\), soldier background/);
  const sheet = qa("sheet", "--session", "qa-own");
  assert.match(sheet, /^Grimm: orc wizard 3 \(Evoker\), soldier background/m);
  assert.match(sheet, /Flaws: I never could hold my drink\./);
  assert.throws(() => qa("new", "--session", "qa-bad", "--as", "Grimm: an orc", "--build", "4"), /--build is 1, 2 or 3/);
});
