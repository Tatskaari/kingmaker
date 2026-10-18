import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { configureDocs } from "./config.ts";
import { disclose, keepOpened, memoryBrief, withhold } from "./disclosure.ts";
import { characterEntry } from "./docs.ts";
import type { WorkingSet } from "./types.ts";

/**
 * The docs service on plain data, with no game behind it: a working set made by hand, a lore of
 * four docs and a folder for the game's own copy (configureDocs), and a decider that opens whatever
 * it's asked about. That the prompts are byte for byte the prototype's was checked once, at the
 * move, by a characterization run kept outside the repo; nothing in the repo checks it again. The
 * prototype's tests play the docs service through its adapters (src/lore).
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

/** Opens everything it's asked about, and keeps what it was asked. */
function opener(): Decider & { asked: Array<{ state: string; questions: Record<string, ChoiceQuestion>; operation: string }> } {
  const asked: Array<{ state: string; questions: Record<string, ChoiceQuestion>; operation: string }> = [];
  return {
    name: "opener",
    asked,
    async decide(state, questions, operation) {
      asked.push({ state: String(state), questions, operation });
      return { answers: Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id, probabilities: { [id]: 0.95 } }])), latencyMs: 1, costUsd: 0, decider: "opener" };
    },
  };
}

test("the lore and the game's own copy are where configureDocs says", () => {
  assert.equal(characterEntry("kell"), "Cast/Kell/private.md");
  assert.equal(characterEntry("nobody"), undefined);
});

test("disclosure on a working set: each scope's linked notes, only those it may read, on the view's turn", async () => {
  const decider = opener();
  const d = await disclose(VIEW, "Who found him?", decider);
  assert.deepEqual(d.opened.map(n => [n.scope, n.path, n.title, n.turn, n.p]).sort(), [
    ["character:kell", "Cast/Kell/knowledge/Cob.md", "Cob", 2, 0.95],
    ["gm", "World/Secret.md", "The secret", 2, 0.95],
  ]);
  const kell = decider.asked.find(a => a.operation === "memory.disclose.kell")!;
  assert.match(kell.state, /# Lore: Cast\/Kell\/private\.md\n# Kell\n\nA sergeant of the watch/);
  assert.match(kell.state, /The scene so far \(latest part\):\nWren \(player\): Who found him\?\n\nKell: Cob did\.\n\nThe player's latest turn: Who found him\?$/);
  assert.ok(!JSON.stringify(kell.questions).includes("World/Secret.md"), "a gm doc is never offered to a character");
  assert.ok(existsSync(join(DIR, "games", "g1", "docs", "Player", "Wren.md")), "the player's doc, in the game's own copy");
});

test("what disclosure keeps comes back as a value for the game to keep: opened, then withheld", async () => {
  const memory = keepOpened(undefined, (await disclose(VIEW, "Who found him?", opener())).opened);
  assert.deepEqual(memory.opened.map(n => Object.keys(n).sort()), [["path", "scope", "title", "turn"], ["path", "scope", "title", "turn"]]);
  const held = withhold(memory, "World/Secret.md");
  assert.deepEqual(held.opened.map(n => n.path), ["Cast/Kell/knowledge/Cob.md"]);
  assert.deepEqual(held.withheld, ["World/Secret.md"]);
  const again = await disclose({ ...VIEW, memory: held }, "And the secret?", opener());
  assert.deepEqual([again.opened, again.asked], [[], 0], "nothing open is asked again, and nothing withheld");
});

test("the GM's memory block: each person's lore, and the notes open for them", async () => {
  assert.match(memoryBrief(VIEW, "stable")!, /### Kell: their own lore\n# Kell\n\nA sergeant of the watch/);
  const memory = keepOpened(undefined, (await disclose(VIEW, "Who found him?", opener())).opened);
  const live = memoryBrief({ ...VIEW, memory }, "live")!;
  assert.match(live, /### Kell: their own memories\n#### Cob\n# Cob\n\nHe found the body at dawn\./);
  assert.match(live, /### The GM's notes\n#### The secret\n# The secret\n\nSallow did it\./);
});
