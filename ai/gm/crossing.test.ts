// Copied from the prototype's src/runtime/crossing.test.ts at 44c6d4a (its closing reply's last chance went with the old pipeline's reply): the boundary is gm/boundary.ts's chainScene, from the hanged clerk as it ended (its "Scene ends" entry, as the simulation's request has it), over the candidates the simulation sends; and who's here as the Rat opens is gm/presence.ts's settlePresence, which v2 asks in the boundary (the place built without Cob is the simulation's). Sessions are TurnViews of the test story (fixtures.ts), the lore the campaign's.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { readNotes } from "../docs/notes.ts";
import { JevDecider, LUNA_DECISIONS_MODEL } from "../llm/decide.ts";
import { fakeFetch, type FakeFetch, type FakeOptions } from "../llm/fake-openrouter.ts";
import type { CallContext } from "../llm/openrouter.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { chainScene, type BoundaryCall } from "./boundary.ts";
import { openingDirective } from "./directives.ts";
import { CAERWYN, sceneById, stateIn } from "./fixtures.ts";
import { settlePresence } from "./presence.ts";
import type { TurnView } from "./view.ts";

/**
 * Crossing from one scene to the next holds together, with OpenRouter stood in for: who is in the
 * next scene agrees with the boundary's word on what's true now; the lead stays in the fiction; and
 * what the boundary says someone did in the time between is in the GM's notes on them.
 */

const overlays = mkdtempSync(join(tmpdir(), "km-crossing-"));
after(() => rmSync(overlays, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(overlays, game) });

/** A request's calls on the stand-in (nothing logged or costed outside it). */
function standIn(options: FakeOptions): { fake: FakeFetch; how: BoundaryCall } {
  const fake = fakeFetch(options);
  const calls: CallContext = { fetch: fake.fetch, apiKey: "test", log: () => {}, cost: () => {} };
  const scene = (id: string): Scene => { const s = sceneById(id); if (!s) throw new Error(`no scene ${id}`); return s; };
  return { fake, how: { calls, sceneById: scene, decider: new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions", calls) } };
}

/** The scenes the hanged clerk's endings go on to, as the simulation sends them (shared/scene/graph.ts candidatesOf: the afternoon skipped). */
const ONWARD = ["drowned-rat", "heron-warehouse", "kings-morning"];

test("the lead stays in the story, and what it says someone of the scene that ended did in the time between is in the GM's notes on them (Kell denied the sighting the lead gave her); the ending's attitude and memory are in them too", async () => {
  const lead = "As the hours pass, Kell tells you she saw a gentleman with a wheat-ear ring beside the Purveyor's wagons, and followed a big porter with a bandaged hand to the Drowned Rat.";
  const { fake, how } = standIn({ byName: { boundary: {
    scenes: [{ id: "drowned-rat", holds: true, why: "The big man hasn't been questioned." }],
    adjustments: ["Kell has signed Prout in as murdered, over the Captain's order.", "Nan has the Rat open as ever."],
    opening: "Hours after the granary, open at the Rat's door at dusk. End on the landlady, with a look at the rules board, asking the sergeant whether she's on duty.",
    lead,
  } }, replies: ["Prout went into the book as murder."] });
  const clerk = sceneById("hanged-clerk");
  const state = stateIn("hanged-clerk", {
    id: "crossing-between", player: { name: "Caelith Ondraviel", concept: "an elf wizard", modifiers: {} },
    turn: 31, beat: "yard", turnsInBeat: 3,
    transcript: [
      { turn: 31, scene: "hanged-clerk", speaker: "kell", kind: "dialogue", text: "I couldn't tell you who." },
      { turn: 31, scene: "hanged-clerk", speaker: "system", kind: "system", text: "Scene ends: The case is made" },
    ],
  });
  const crossed = await chainScene(clerk, state, clerk.exits.find(e => e.id === "case-made")!, ONWARD.map(sceneById), how);
  const verdict = fake.sent.find(b => b.text?.format?.name === "boundary")!;
  assert.match(verdict.instructions!, /What someone tells them doesn't go against what that person said in play: what they found out since is told as new/);
  assert.match(verdict.instructions!, /It's always the story, never a note about it \(what the story does or doesn't say, or that there's no lead\)/);
  assert.match(verdict.input![0]!.content, /Whatever begins with an "if" happens only when play has made the if true/);
  const kell = readNotes("crossing-between", "kell");
  assert.deepEqual(kell.did, [
    "The Hanged Clerk, as it ended: The King's investigator proved Prout was murdered and named Sallow of the Purveyor's office.",
    `Between The Hanged Clerk and The Drowned Rat, as Caelith heard it: ${lead}`,
    "Between The Hanged Clerk and The Drowned Rat: Kell has signed Prout in as murdered, over the Captain's order.",
  ], "how it ended for her, and the time between, and nothing about Nan's Rat");
  assert.deepEqual(kell.standing, ["Friendly: The King's investigator made Prout's case properly."], "the ending's attitude is her standing");
  assert.deepEqual(readNotes("crossing-between", "cob").did, ["Was there when The Hanged Clerk ended: The case is made."], "Cob was there, with no memory of the ending's own");
  assert.deepEqual(readNotes("crossing-between", "nan-quill").did, [], "Nan, whom an adjustment is about, wasn't in the scene that ended: what it says of her is the Rat's prep already");
  assert.equal(crossed.next.lead, lead);
});

/** The Rat about to open, after the granary, with the boundary's adjustments. */
function ratOpening(id: string, adjustments: string[]): TurnView {
  return stateIn("drowned-rat", {
    id, player: { name: "Grukka Kettlebreaker", concept: "a half-orc barbarian, ex-dock bruiser", modifiers: {} },
    turn: 17, beat: "the-rat", turnsInBeat: 0, adjustments,
    history: [{ sceneId: "hanged-clerk", exitId: "closed-suicide", summary: "Previous scene, \"The Hanged Clerk\", ended: Filed as a suicide.\nGrukka has the page. Kell examined Prout and found he was killed." }],
  });
}

test("who's in the next scene goes by the boundary's word on what's true now, not the hand-off alone (Cob was at the Rat, though it said he wouldn't be)", async () => {
  const { fake, how } = standIn({ choices: { cob: "not_here" } });
  const state = ratOpening("crossing-presence", ["Cob was frightened off. He and Moll have gone to ground in the granary quarter; Cob will not be at the Rat tonight."]);
  const absent = await settlePresence(sceneById("drowned-rat"), state, how.decider);
  const presence = fake.sent.find(b => b.questions?.["cob"])! as unknown as { state: { true_now?: string[] }; questions: Record<string, { instructions: string }> };
  assert.ok(presence, "Cob, whom only the adjustments name, is asked about");
  assert.deepEqual(presence.state.true_now, ["Cob was frightened off. He and Moll have gone to ground in the granary quarter; Cob will not be at the Rat tonight."]);
  assert.match(presence.questions["cob"]!.instructions, /true_now is what's true by the time it starts, and it has the last word on who is where/);
  assert.ok(absent.includes("cob"));
  // The opening is shown whole: none of it has happened yet.
  assert.match(openingDirective(sceneById("drowned-rat"), state), /^Open the scene: show the whole of the opening below, from its first glance to the moment it ends on\. None of it has happened yet; the player sees all of it now, for the first time\./);
});

test("the opening on entry is all shown, and the boundary writes it as directions, not the scene's lines (Kell answered a question the player never heard)", async () => {
  const state = { ...ratOpening("crossing-opening", []), opening: "At the Rat's door at dusk, the din drops as you step in. The landlady looks at the rules board, then at Kell. “Sergeant, are you on duty?”" };
  const directive = openingDirective(sceneById("drowned-rat"), state);
  assert.match(directive, /None of it has happened yet; the player sees all of it now, for the first time\./);
  assert.match(directive, /without repeating that scene's closing lines\. The opening, as it stands after what actually happened: At the Rat's door at dusk/);
  assert.match(directive, /end on what it ends on: something the player can respond to\.$/);
  assert.doesNotMatch(directive, /Pick up after the last scene's closing lines rather than repeating them/);
  assert.match(openingDirective(sceneById("hanged-clerk"), { ...state, history: [] }), /^Open the scene\. Open on the yard: Prout turning slowly/, "the story's first scene, as it's written");
  const { fake, how } = standIn({ replies: ["Kell signs Prout in as murdered."] });
  const clerk = sceneById("hanged-clerk");
  const granary = stateIn("hanged-clerk", { ...ratOpening("crossing-opening-boundary", []), sceneId: "hanged-clerk", beat: "yard", history: [], transcript: [{ turn: 17, scene: "hanged-clerk", speaker: "system", kind: "system", text: "Scene ends: The case is made" }] });
  await chainScene(clerk, granary, clerk.exits.find(e => e.id === "case-made")!, ONWARD.map(sceneById), how);
  const verdict = fake.sent.find(b => b.text?.format?.name === "boundary")!;
  assert.match(verdict.instructions!, /Write it as the author did: directions for its GM \(what to show, in what order, what to end on: "End on the landlady asking the sergeant whether she's on duty"\), never the scene's prose or its spoken lines; the GM writes those\./);
});
