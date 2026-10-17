import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { CATEGORIES } from "../../docs/reviews.ts";
import { fakeFetch, type FakeOptions } from "../../llm/fake-openrouter.ts";
import { prompt } from "../../prompts/index.ts";
import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { Entry, RememberRequest, RepairRequest, SceneContext } from "../../../shared/protocol/ai.ts";
import type { PlaceFile } from "../../../shared/scene/files.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { keysFor, worldToRows } from "../../../shared/world/rows.ts";
import { buildWorld, joinWorld } from "../../../shared/world/scene-world.ts";
import { callContext } from "../calls.ts";
import { campaigns } from "../campaigns.ts";
import type { AiContext } from "../context.ts";
import { folderStores } from "../folder-stores.ts";
import { remember } from "./remember.ts";
import { repair } from "./repair.ts";

/**
 * The thinks after a turn (full-gm-design §4.1), on the stand-in: the memory reviews write a note
 * into the game's copy of the lore and a line in memory-reviews.jsonl, and the co-GM's answer is
 * shaped as the prototype's toRepairResult shapes it.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "..", "campaigns", "caerwyn");
const GAME = "0d1e2f3a-0000-4000-8000-0000000000bb";
const game = { id: GAME, campaign: "caerwyn", version: "0.1.0" };
const player = { id: "1", name: "Wren Ashdown" };

const SCRATCH = mkdtempSync(join(tmpdir(), "km-background-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

/** The campaign in a fresh store, and a request's context on the stand-in (with the stores' review log, as the server hands it on). */
async function setUp(options: FakeOptions) {
  const store = mkdtempSync(join(SCRATCH, "store-"));
  const stores = folderStores(store);
  const installed = campaigns(stores.campaigns, stores.docs);
  await installed.put("caerwyn", "0.1.0", filesOf(CAERWYN));
  const campaign = installed.use("caerwyn", "0.1.0");
  const fake = fakeFetch(options);
  const contextFor = (key: string): AiContext => {
    const { calls, usage } = callContext({ fetch: fake.fetch, apiKey: "test" }, stores, { game: GAME, key, attempt: 1 });
    return { campaign, calls, usage, attempt: 1, stream: () => { throw new Error("nothing streams after a turn"); }, reviews: stores.reviews };
  };
  return { store, campaign, fake, contextFor };
}

/** The scene once turn `n` is over, as the simulation sends it to a job after the turn. */
function sceneOf(campaign: Awaited<ReturnType<typeof setUp>>["campaign"], n: number, gm: GmState, transcript: Entry[]): SceneContext {
  const place = JSON.parse(readFileSync(join(CAERWYN, "places", "granary-yard.json"), "utf8")) as PlaceFile;
  const people = presentCast(campaign.scene("hanged-clerk"), gm).map(c => ({ id: c.id, name: c.name }));
  const world = buildWorld("hanged-clerk", place, people, { name: "Wren Ashdown" });
  joinWorld(world, people, 0);
  const party = [{ name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "human wizard 3 (Evoker), sage background", skills: { arcana: 5, insight: 3, persuasion: 1 } }];
  return { scene: { id: "1", key: "hanged-clerk", kind: "scene", turn: n }, pc: "pc:1", gm, transcript, world: worldToRows(world, keysFor("granary-yard", "hanged-clerk", "pc:1")), party, present: [], story: { time: "morning", day: 1, flags: {} } };
}

const GIFT: Entry[] = [
  { turn: 0, speaker: "gm", kind: "narration", text: "Rain on the cobbles. A body hangs from the hoist, and a boy in too-big boots lobs stones at it." },
  { turn: 1, speaker: "player:1", kind: "player", text: "(I crouch and press a silver crown into the boy's hand) Get yourself something hot, lad. No questions." },
  { turn: 1, speaker: "gm", kind: "narration", text: "The coin vanishes into the boy's fist. Sergeant Kell watches it go, and says nothing." },
];

/** Every attention category answered no, but those named. */
const flagging = (...flagged: string[]) => Object.fromEntries(Object.keys(CATEGORIES).map(id => [id, flagged.includes(id) ? "flagged" : "not_flagged"]));

const KELLS = { characterId: "kell", title: "What the investigator did", context: "In the granary yard, the morning the clerk Prout was found hanged.", content: "The King's investigator pressed a silver crown into Cob's fist and asked him nothing for it. Soft, or buying him. I'll watch which." };

test("remember: a witnessed moment fires the memories agent, which writes Kell's note and her index's line; the turn's line goes in memory-reviews.jsonl", async () => {
  const { store, campaign, fake, contextFor } = await setUp({ choices: flagging("witnessed"), toolCalls: { save_memory: [{ name: "save_memory", args: KELLS }] } });
  const key = `${GAME}:s1:t1:remember`;
  // A line the player queued meanwhile is on the transcript already: it isn't the turn reviewed.
  const queued: Entry = { turn: 2, speaker: "player:1", kind: "player", text: "Sergeant, who found him?" };
  const req: RememberRequest = { key, game, player, turn: sceneOf(campaign, 1, initialGm({ start: "yard" }), [...GIFT, queued]), reviewed: 1 };
  const answer = await remember(req, contextFor(key));

  assert.deepEqual(answer.flags, ["witnessed"]);
  assert.deepEqual(answer.reviews.map(r => [r.kind, r.changes, r.summary, r.error]), [["memories", ["memory kell: What the investigator did"], "Done.", undefined]]);
  const memories = join(store, "games", GAME, "docs", "Cast", "Sergeant Agnes Kell", "memories");
  const index = readFileSync(join(memories, "index.md"), "utf8");
  const note = readdirSync(memories).find(f => f !== "index.md")!;
  assert.match(index, new RegExp(`^- \\[What the investigator did\\]\\(${note}\\) — In the granary yard, the morning the clerk Prout was found hanged\\.$`, "m"));
  assert.match(readFileSync(join(memories, note), "utf8"), /visibility: "private"\nreaders: \["character:kell"\]\nscene: "hanged-clerk"\nturn: 1\n---\nThe King's investigator pressed a silver crown/);

  const lines = readFileSync(join(store, "games", GAME, "memory-reviews.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => [l.turn, l.flags, l.reviews.length]), [[1, ["witnessed"], 1]]);

  // The attention filter (Jev) and the agent's two rounds, all through the request's calls, and the moment it reviewed the turn's own.
  const logged = readFileSync(join(store, "games", GAME, "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(logged.filter(e => !e.started).map(e => [e.key, e.operation]), [[key, "memory.attend"], [key, "memory.review.memories"]]);
  assert.deepEqual([answer.usage.calls, answer.usage.byOperation["memory.review.memories"]?.calls], [3, 2]);
  const review = fake.sent.find(b => b.tools)!;
  assert.match(review.input![0]!.content, /## The moment to review\nWren Ashdown \(player\): \(I crouch and press a silver crown/);
  assert.ok(!review.input![0]!.content.includes("who found him"), "the queued line isn't the moment, or before it");
  assert.ok(review.instructions!.includes(prompt("review/witnessed")), "the witnessed category's prompt");
});

test("remember: nothing flagged is one call and no review, and the turn's line still goes in memory-reviews.jsonl", async () => {
  const { store, campaign, fake, contextFor } = await setUp({ choices: flagging() });
  const key = `${GAME}:s1:t1:remember`;
  const answer = await remember({ key, game, player, turn: sceneOf(campaign, 1, initialGm({ start: "yard" }), GIFT), reviewed: 1 }, contextFor(key));

  assert.deepEqual([answer.flags, answer.reviews, answer.usage.calls, fake.asked], [[], [], 1, ["/api/alpha/decisions"]]);
  assert.equal(existsSync(join(store, "games", GAME, "docs", "Cast", "Sergeant Agnes Kell", "memories")), false);
  const lines = readFileSync(join(store, "games", GAME, "memory-reviews.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => [l.turn, l.flags, l.reviews]), [[1, [], []]]);
});

test("repair: the co-GM's notes shaped as the prototype's are: a route to nowhere rejected, a DC clamped, a move to the beat it's at dropped; its turn the one reviewed", async () => {
  const notes = {
    assessment: "The player is charming the boy; the case idles.", status: "drifting", notes: "Let Kell grow impatient with the coin-giving.",
    whispers: [{ to: "moll", note: "She wants a crown too, and says so." }], relocations: [], no_but: [],
    canon: ["Cob spent the crown on a hot pie."], move_to: "yard", move_to_because: "Nothing has moved.", add_beat: null,
    add_transitions: [
      { beat: "yard", when: "The player asks Moll what the boots are worth to her.", on: "attempt", to: "doubt", check: { skill: "persuasion", dc: 40, reason: "to coax Moll into talking", success: "She talks.", failure: "She clams up.", on_failure: null }, why: "A way to the doubt through Moll." },
      { beat: "yard", when: "The player flies to the moon.", on: "outcome", to: "the-moon", check: null, why: "Nowhere." },
    ],
  };
  const { campaign, fake, contextFor } = await setUp({ byName: { co_gm_notes: notes } });
  const key = `${GAME}:s1:t3:repair`;
  const gm: GmState = { ...initialGm({ start: "yard" }), turnsInBeat: 3 };
  const req: RepairRequest = { key, game, player, turn: sceneOf(campaign, 3, gm, [...GIFT, { turn: 2, speaker: "player:1", kind: "player", text: "What songs do you sing, girl?" }, { turn: 3, speaker: "player:1", kind: "player", text: "And the one about the miller's cat?" }]), reviewed: 3 };
  const { review, usage } = await repair(req, contextFor(key));

  assert.equal(review.turn, 3);
  assert.equal(review.status, "drifting");
  assert.equal(review.assessment, "The player is charming the boy; the case idles. [rejected: transition yard -> the-moon rejected]");
  assert.deepEqual(review.patches, [{ turn: 3, why: "A way to the doubt through Moll.", transition: { beat: "yard", transition: {
    id: "improv-3-0", when: "The player asks Moll what the boots are worth to her.", on: "attempt",
    check: { skill: "persuasion", dc: 25, reason: "to coax Moll into talking", success: "She talks.", failure: "She clams up.", onSuccess: "doubt" },
  } } }]);
  assert.equal(review.moveTo, undefined, "the tracker is already there");
  assert.deepEqual([review.notes, review.whispers, review.canon], ["Let Kell grow impatient with the coin-giving.", [{ to: "moll", note: "She wants a crown too, and says so." }], ["Cob spent the crown on a hot pie."]]);

  const call = fake.sent[0]!;
  assert.deepEqual([call.text?.format?.name, (call as { reasoning?: { effort?: string } }).reasoning?.effort, call.max_output_tokens, call.instructions], ["co_gm_notes", "medium", 8000, prompt("repair")]);
  assert.match(call.input!.at(-1)!.content, /^## Tracker: the scene is at beat "yard" \(Stones at a hanged man\); 3 exchanges here, 3 since anything moved\./);
  assert.equal(usage.byOperation.repair?.calls, 1);
});
