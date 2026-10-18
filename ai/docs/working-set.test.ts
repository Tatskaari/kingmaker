import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { configureDocs } from "./config.ts";
import { memoryBrief } from "./disclosure.ts";
import { characterEntry } from "./docs.ts";
import { note } from "./notes.ts";
import type { WorkingSet } from "./types.ts";

/**
 * The docs service on plain data, with no game behind it: a working set made by hand, a lore of
 * four docs and a folder for the game's own copy (configureDocs). That the prompts are byte for byte
 * the prototype's was checked once, at the move, by a characterization run kept outside the repo;
 * nothing in the repo checks it again. The prototype's tests play the docs service through its
 * adapters (src/lore). (Disclosure's own tests, with a decider that opened whatever it was asked
 * about, went with disclosure.)
 */

const DIR = mkdtempSync(join(tmpdir(), "km-working-set-"));
const LORE = join(DIR, "lore");
const doc = (path: string, meta: Record<string, unknown>, body: string) => {
  mkdirSync(dirname(join(LORE, path)), { recursive: true });
  writeFileSync(join(LORE, path), `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n${body}\n`);
};
doc("Cast/Kell/private.md", { summary: "Sergeant Kell.", visibility: "private", readers: ["character:kell"], character: "kell" }, "# Kell\n\nA sergeant of the watch.\n- [Cob](knowledge/Cob.md) — the boy who found him\n- [The secret](../../World/Secret.md)");
doc("Cast/Kell/knowledge/Cob.md", { summary: "What Kell knows of Cob.", visibility: "private", readers: ["character:kell"] }, "# Cob\n\nHe found the body at dawn.");
doc("World/Secret.md", { summary: "Who hanged the clerk.", visibility: "gm" }, "# The secret\n\nSallow did it.");
doc("Places/Yard.md", { summary: "The granary yard.", visibility: "public" }, "# The yard\n\nThe hoist and the rope.\n- [The secret](../World/Secret.md)");
configureDocs({ loreRoot: LORE, overlay: game => join(DIR, "games", game, "docs") });

const VIEW: WorkingSet = {
  game: "g1",
  turn: 2,
  scene: { id: "yard", title: "The Yard", premise: "Who hanged the clerk?", setting: "A granary yard at dawn.", lore: ["Places/Yard.md"] },
  player: { name: "Wren", concept: "an auditor", who: "Wren: an auditor" },
  present: [{ id: "kell", name: "Kell", look: "Tall, grey at the temples.", wants: "The truth.", knows: ["Prout kept a ledger."], attitude: "Wary; polite." }],
  transcript: [{ turn: 1, text: "Wren (player): Who found him?" }, { turn: 1, text: "Kell: Cob did." }],
};

test("the lore and the game's own copy are where configureDocs says", () => {
  assert.equal(characterEntry("kell"), "Cast/Kell/private.md");
  assert.equal(characterEntry("nobody"), undefined);
});

test("the GM's memory block: each person's lore, then the GM's notes on them from play; the player's doc made in the game's own copy", () => {
  assert.match(memoryBrief(VIEW, "stable")!, /### Kell: their own lore\n# Kell\n\nA sergeant of the watch/);
  assert.ok(existsSync(join(DIR, "games", "g1", "docs", "Player", "Wren.md")), "the player's doc, in the game's own copy");
  assert.doesNotMatch(memoryBrief(VIEW, "live") ?? "", /notes on them from play/, "no notes yet, none shown");
  note("g1", { id: "kell", name: "Kell" }, "standing", "Wary: the investigator is new and asks a lot.");
  note("g1", { id: "kell", name: "Kell" }, "seen", "Watched the investigator crouch to talk to Cob, kindly.");
  const live = memoryBrief(VIEW, "live")!;
  assert.match(live, /### Kell: their own memories\nThe GM's notes on Kell from play \(what's happened with them\):\nStanding with the player: Wary: the investigator is new and asks a lot\.\nSeen the player do:\n- Watched the investigator crouch to talk to Cob, kindly\.$/m);
  assert.doesNotMatch(live, /Sallow did it/, "nothing opened: the notes disclosure opened went with it");
  assert.doesNotMatch(memoryBrief(VIEW, "stable")!, /notes from play/, "the notes change from turn to turn: never in the stable part");
});
