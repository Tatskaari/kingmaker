import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { sceneById } from "../../scenes/index.ts";
import { ASSETS } from "../world/assets.ts";
import { recordingWorld, type Operation } from "../world/dsl.ts";
import { applyOps, areaOf, buildWorld, type WorldOp } from "../world/scene-world.ts";
import { effectiveScene, presentCast } from "./brief.ts";
import { decideBefore } from "./director.ts";
import type { Scene, Transition } from "./scene.ts";
import type { SessionState } from "./session.ts";

/**
 * The Caerwyn arc's prep, as a player's report found it (Brother Ambrose, a rogue with Persuasion +0,
 * Insight +6 and Investigation +7, played to The End and found his good plans shot down). Each test
 * holds a fix in the scenes to what the report's analysts traced the plan's failure to, without
 * model calls: the routes the decider is offered, what a no-dice route does with a scripted decider,
 * where the world puts people, and what the exit scripts write.
 */

/** A decider that answers from a script (choice, its probability, the others'), and keeps what it was asked. */
function scripted(picks: Record<string, [string, number, Record<string, number>?]>): Decider & { asked: Array<Record<string, ChoiceQuestion>> } {
  const asked: Array<Record<string, ChoiceQuestion>> = [];
  const quiet = ["none", "not_yet", "in_character", "covered", "not_now", "no", "not_theirs", "other"];
  return {
    name: "scripted", asked,
    async decide(_state, questions) {
      asked.push(questions);
      const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
        const keys = Object.keys(q.criteria);
        const [choice, p, others] = picks[id] && keys.includes(picks[id][0]) ? picks[id] : [keys.find(k => quiet.includes(k)) ?? keys.at(-1)!, 1];
        return [id, { choice, probabilities: { ...others, [choice]: p } }];
      }));
      return { answers, latencyMs: 0, costUsd: 0, decider: "scripted" };
    },
  };
}

/** A session at a beat of a scene, with the player's sheet the report's (Persuasion +0). */
function at(sceneId: string, beat: string, extra: Partial<SessionState> = {}): SessionState {
  return {
    id: "arc-prep-test", sceneId, approach: "v2", seed: 11, rollCount: 0,
    player: { name: "Brother Ambrose Hake", concept: "a disgraced temple bookkeeper", modifiers: { persuasion: 0, insight: 6, investigation: 7 } },
    turn: 5, beat, turnsInBeat: 1, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [], ...extra,
  };
}

const considered = { speaker: false, considered: true, offGraph: true };
const route = (scene: Scene, beat: string, id: string): Transition => {
  const t = [...scene.beats.find(b => b.id === beat)!.transitions, ...(scene.anytime ?? [])].find(x => x.id === id);
  assert.ok(t, `${beat} has ${id}`);
  return t;
};

/** An exit's script, run against a recording world as finishScene runs it. */
function ending(scene: Scene, exitId: string, established: string[]): Operation[] {
  const { world, operations } = recordingWorld({ assets: ASSETS, characters: scene.cast.map(c => c.id), anchors: scene.anchors ?? [] });
  scene.exits.find(e => e.id === exitId)!.script!(world, { sceneId: scene.id, exitId, established });
  return operations;
}
const remembered = (ops: Operation[], who: string) => ops.filter(o => o.op === "character.remember" && o.args.id === who).map(o => String(o.args.fact));
const journal = (ops: Operation[]) => ops.filter(o => o.op === "journal").map(o => String(o.args.entry));

// --- The Heron -------------------------------------------------------------------------------

const heron = sceneById("heron-warehouse");

test("the Heron: the hoist and its rope are on the floor, so following Hobb to it keeps the player inside", () => {
  const state = at("heron-warehouse", "floor");
  const world = buildWorld(heron.id, heron.world!, presentCast(heron, state).map(c => ({ id: c.id, name: c.name })), state.player);
  assert.equal(areaOf(world, "hoist")?.id, "floor", "worked from the floor, just inside the river door");
  assert.equal(world.entities["hoist-rope"]?.parent, "hoist");
  assert.ok(!Object.values(world.entities).some(e => /hoist/.test(e.name) && areaOf(world, e.id)?.id === "plank-walk"), "nothing of the hoist is out on the plank walk");
  // As the stage manager staged it in the report (T77 "place hobb to hoist", T79 "move player to hobb").
  const op = (o: Partial<WorldOp> & Pick<WorldOp, "op" | "what" | "to">): WorldOp => ({ how: "", name: "", kind: "", text: "", add: [], remove: [], ...o });
  applyOps(world, [op({ op: "place", what: "hobb", to: "hoist", how: "beside" })], 77);
  applyOps(world, [op({ op: "move", what: "player", to: "hobb" })], 79);
  assert.equal(areaOf(world, "hobb")?.id, "floor");
  assert.equal(areaOf(world, "player")?.id, "floor", "with Hobb, among the gang, not out on the piles");
});

test("the Heron: showing Hobb's token at the grille is a way in of its own, with no dice, whatever story goes with it", async () => {
  const token = route(heron, "wharf", "show-token");
  assert.equal(token.check, undefined, "no dice");
  assert.equal(token.on, "attempt");
  assert.equal(token.to, "floor");
  assert.match(token.when, /whatever story|with or without a story/);
  const talk = route(heron, "wharf", "talk-past");
  assert.match(talk.when, /^With no heron token to show/, "the bluff is for talking past without the token");
  // T76: "Was sent here. Told there's some merchandise I might be interested in. Was given this (presents the coin thing Hobb gave me)".
  const decider = scripted({ attempt: ["show-token", 0.7, { "talk-past": 0.25 }], roll_call: ["new", 0.8], attempt_means: ["deception", 0.7] });
  const pre = await decideBefore(decider, heron, at("heron-warehouse", "wharf"), "Was sent here. Told there's some merchandise I might be interested in. Was given this (presents the coin thing Hobb gave me)", considered);
  assert.equal(pre.move?.transition.id, "show-token");
  assert.equal(pre.move?.roll, undefined, "nothing rolled for the token");
  assert.equal(pre.move?.to, "floor");
  assert.equal(pre.considered, undefined, "the prep settles it: no ruling, no roll");
});

test("the Heron: the Master comes for a player waiting for him, not for one working the floor while they wait for a word with Hobb", () => {
  const comes = route(heron, "floor", "master-comes");
  assert.doesNotMatch(comes.when, /lying low and waiting/);
  assert.match(comes.when, /waiting for the Master himself/);
  assert.match(comes.when, /wait for a word with Hobb, a look at the book or a chance at it isn't waiting for the Master/);
  // The same in the next beat: the barge waits on a moment the player has named.
  assert.match(route(heron, "midnight", "cast-off").when, /waiting for a moment they've named[^.]*isn't dithering/);
  assert.match(heron.beats.find(b => b.id === "midnight")!.pressure!, /initials tonight's page/, "the signing comes, for a player waiting to catch him at it");
});
