import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { CATEGORIES, partsText } from "../../docs/reviews.ts";
import { fakeFetch, type FakeOptions } from "../../llm/fake-openrouter.ts";
import { prompt } from "../../prompts/index.ts";
import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { Entry, RememberRequest, SceneContext } from "../../../shared/protocol/ai.ts";
import type { PlaceFile } from "../../../shared/scene/files.ts";
import { loadPlace, placePath } from "../../../shared/scene/scenario.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { keysFor, worldToRows } from "../../../shared/world/rows.ts";
import { buildWorld, joinWorld } from "../../../shared/world/scene-world.ts";
import { callContext } from "../calls.ts";
import { campaigns } from "../campaigns.ts";
import { withTestClerk } from "../../gm/fixtures.ts";
import type { AiContext } from "../context.ts";
import { folderStores } from "../folder-stores.ts";
import { remember } from "./remember.ts";

/**
 * The thinks after a turn (full-gm-design §4.1), on the stand-in: the memory reviews bring the GM's
 * notes on the people here up to date in the game's copy of the lore and write a line in
 * memory-reviews.jsonl. (The old co-GM's review, its answer shaped as the prototype's
 * toRepairResult shaped it, went with the old pipeline.)
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
  await installed.put("caerwyn", "0.1.0", withTestClerk(filesOf(CAERWYN)));
  const campaign = installed.use("caerwyn", "0.1.0");
  const fake = fakeFetch(options);
  /** A request's context on the stand-in, or on another (a later review answering otherwise), on the same store. */
  const contextFor = (key: string, on = fake): AiContext => {
    const { calls, usage } = callContext({ fetch: on.fetch, apiKey: "test" }, stores, { game: GAME, key, attempt: 1 });
    return { campaign, calls, usage, attempt: 1, stream: () => { throw new Error("nothing streams after a turn"); }, reviews: stores.reviews };
  };
  return { store, campaign, fake, contextFor };
}

/** The scene once turn `n` is over, as the simulation sends it to a job after the turn. */
function sceneOf(campaign: Awaited<ReturnType<typeof setUp>>["campaign"], n: number, gm: GmState, transcript: Entry[]): SceneContext {
  const place: PlaceFile = loadPlace(readFileSync(join(CAERWYN, placePath("granary-yard")), "utf8"));
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

/** The notes review's answer: these updates, and a summary. */
const notesAnswer = (...updates: Array<{ characterId: string; section: string; line: string; replaces?: string }>) => ({ gm_notes: { updates: updates.map(u => ({ replaces: "", ...u })), summary: "Kell's notes are up to date." } });
const NOTES = (store: string) => join(store, "games", GAME, "docs", "Cast", "Sergeant Agnes Kell", "notes.md");
const CROWN = "Watched the investigator press a silver crown into Cob's fist and ask nothing for it.";

test("remember: a flagged moment brings the GM's notes on the people here up to date: Kell's notes get a line, in the game's copy; the turn's line goes in memory-reviews.jsonl", async () => {
  const { store, campaign, fake, contextFor } = await setUp({ choices: flagging("seen"), byName: notesAnswer({ characterId: "kell", section: "seen", line: CROWN }) });
  const key = `${GAME}:s1:t1:remember`;
  // A line the player queued meanwhile is on the transcript already: it isn't the turn reviewed.
  const queued: Entry = { turn: 2, speaker: "player:1", kind: "player", text: "Sergeant, who found him?" };
  const req: RememberRequest = { key, game, player, turn: sceneOf(campaign, 1, initialGm({ start: "yard" }), [...GIFT, queued]), reviewed: 1 };
  const answer = await remember(req, contextFor(key));

  assert.deepEqual(answer.flags, ["seen"]);
  assert.deepEqual(answer.reviews.map(r => [r.kind, r.changes, r.summary, r.error]), [["notes", [`note kell seen: added "${CROWN}"`], "Kell's notes are up to date.", undefined]]);
  const notes = readFileSync(NOTES(store), "utf8");
  assert.match(notes, /^---\nsummary: "The GM's notes on Sergeant Agnes Kell in this game, kept current: [^"]*"\ntype: "notes"\nvisibility: "gm"\nscene: "hanged-clerk"\nturn: 1\n---\n# Sergeant Agnes Kell: notes from play\n\n## Seen the player do\n- Watched the investigator press a silver crown/);
  assert.equal(existsSync(join(store, "games", GAME, "docs", "Cast", "Sergeant Agnes Kell", "memories")), false, "no memories beside them");

  const lines = readFileSync(join(store, "games", GAME, "memory-reviews.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => [l.turn, l.flags, l.reviews.length]), [[1, ["seen"], 1]]);

  // The attention filter (Jev) and the notes review's one call, both through the request's calls, and the moment it reviewed the turn's own.
  const logged = readFileSync(join(store, "games", GAME, "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(logged.filter(e => !e.started).map(e => [e.key, e.operation]), [[key, "memory.attend"], [key, "memory.review.notes"]]);
  assert.deepEqual([answer.usage.calls, answer.usage.byOperation["memory.review.notes"]?.calls], [2, 1]);
  const review = fake.sent.find(b => b.text?.format?.name === "gm_notes")!;
  assert.equal(review.instructions, prompt("memory-review", { parts: partsText() }));
  assert.match(review.instructions!, /- seen \(Seen the player do; 5 lines at most\): what they've seen the player character do/);
  const input = review.input![0]!.content;
  assert.match(input, /## The people here \(ids\), and your notes on each so far\n- kell: Sergeant Agnes Kell\n {4}\(no notes yet\)\n- cob: Cob\n/);
  assert.match(input, /## The moment to review\nWren Ashdown \(player\): \(I crouch and press a silver crown/);
  assert.ok(!input.includes("who found him"), "the queued line isn't the moment, or before it");
  const schema = review.text!.format!.schema as { properties: { updates: { items: { properties: { characterId: { enum: string[] }; section: { enum: string[] } } } } } };
  assert.deepEqual(schema.properties.updates.items.properties.characterId.enum, ["kell", "cob", "moll"], "only the people here");
  assert.deepEqual(schema.properties.updates.items.properties.section.enum, ["standing", "seen", "learned", "promises", "did"]);
});

test("remember: a later moment rewrites a line of the notes rather than adding another, and the review reads the notes as they stand", async () => {
  const { store, campaign, contextFor } = await setUp({ choices: flagging("seen"), byName: notesAnswer({ characterId: "kell", section: "seen", line: CROWN }) });
  await remember({ key: `${GAME}:s1:t1:remember`, game, player, turn: sceneOf(campaign, 1, initialGm({ start: "yard" }), GIFT), reviewed: 1 }, contextFor(`${GAME}:s1:t1:remember`));

  const PRICE = "Watched the investigator give Cob a silver crown, then call it payment for what he saw last night.";
  const later = fakeFetch({ choices: flagging("seen", "standing"), byName: notesAnswer(
    { characterId: "kell", section: "seen", line: PRICE, replaces: CROWN },
    { characterId: "kell", section: "standing", line: "Wary: the investigator's kindness to the boy came with a price after all." },
  ) });
  const turn2: Entry[] = [
    { turn: 2, speaker: "player:1", kind: "player", text: "That crown wasn't free, Cob. Who came to the yard last night?" },
    { turn: 2, speaker: "gm", kind: "narration", text: "Cob's fist tightens on the coin. Kell's pencil stops, and she looks at you for a long moment." },
  ];
  const key = `${GAME}:s1:t2:remember`;
  const answer = await remember({ key, game, player, turn: sceneOf(campaign, 2, initialGm({ start: "yard" }), [...GIFT, ...turn2]), reviewed: 2 }, contextFor(key, later));

  assert.deepEqual(answer.reviews.map(r => r.changes), [[`note kell seen: rewrote "${CROWN}" → "${PRICE}"`, `note kell standing: set "Wary: the investigator's kindness to the boy came with a price after all."`]]);
  const notes = readFileSync(NOTES(store), "utf8");
  assert.match(notes, /## Standing with the player\n- Wary: the investigator's kindness to the boy came with a price after all\.\n\n## Seen the player do\n- Watched the investigator give Cob a silver crown, then call it payment for what he saw last night\.\n?$/);
  assert.ok(!notes.includes("ask nothing for it"), "rewritten, not a second line beside the first");
  assert.match(later.sent.find(b => b.text?.format?.name === "gm_notes")!.input![0]!.content, /- kell: Sergeant Agnes Kell\n {4}seen \(Seen the player do\):\n {4}- Watched the investigator press a silver crown into Cob's fist and ask nothing for it\./, "the review read Kell's notes as they stood");
});

test("remember: nothing flagged is one call and no review, and the turn's line still goes in memory-reviews.jsonl", async () => {
  const { store, campaign, fake, contextFor } = await setUp({ choices: flagging() });
  const key = `${GAME}:s1:t1:remember`;
  const answer = await remember({ key, game, player, turn: sceneOf(campaign, 1, initialGm({ start: "yard" }), GIFT), reviewed: 1 }, contextFor(key));

  assert.deepEqual([answer.flags, answer.reviews, answer.usage.calls, fake.asked], [[], [], 1, ["/api/alpha/decisions"]]);
  assert.equal(existsSync(NOTES(store)), false, "no notes for anyone");
  const lines = readFileSync(join(store, "games", GAME, "memory-reviews.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => [l.turn, l.flags, l.reviews]), [[1, [], []]]);
});
