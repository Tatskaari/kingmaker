import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { sceneById } from "../../scenes/index.ts";
import { ASSETS } from "../world/assets.ts";
import { recordingWorld, type Operation } from "../world/dsl.ts";
import { applyOps, areaOf, buildWorld, type WorldOp } from "../world/scene-world.ts";
import { effectiveScene, openRoutes, presentCast } from "./brief.ts";
import { toRuling } from "./consider.ts";
import { decideAfter, decideBefore } from "./director.ts";
import { bringOver, owedAtEnd } from "./owed.ts";
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

test("the Heron: without a token, going in to work is a way in of its own with no dice, and in as a hand, working the floor needs no roll", async () => {
  const taken = route(heron, "wharf", "taken-on");
  assert.equal(taken.check, undefined, "no dice");
  assert.equal(taken.on, "attempt");
  assert.equal(taken.to, "floor");
  assert.match(taken.when, /shoulders a sack[\s\S]*answers Hep's shout for hands[\s\S]*asks there to be taken on[\s\S]*No dice: Hep is short-handed/);
  assert.match(route(heron, "wharf", "talk-past").when, /going in to work with a sack on their shoulder or at Hep's shout for hands, are ways in of their own with no dice/);
  // The token makes them a hand too, and the hand's standing is a fact, for a ruling that stands in for either route (robust-3: in "unnoticed", then a Stealth roll to carry a sack).
  const token = route(heron, "wharf", "show-token");
  assert.deepEqual(token.establishes, taken.establishes);
  assert.match(taken.establishes![0]!, /one of Hep's hands[\s\S]*working the floor with their head down \(carrying, slitting, sewing, fetching\) needs no roll/);
  assert.match(heron.beats.find(b => b.id === "floor")!.direction, /Anyone in as one of Hep's hands \(by the token, or turning up to work\) is crew: carrying, slitting, sewing and keeping their head down on the floor need no roll/);
  // rb-3m2, scene turn 4: read sneak-in .49 and ruled; read as going in to work, it settles the turn with no roll.
  const sack = "(I go along the plank walk, careful on the slime. There's a split sack by the door waiting to be carried in; I heave it onto my shoulder and walk in at the river door right behind the next porter, like I belong there.)";
  const pre = await decideBefore(scripted({ attempt: ["taken-on", 0.6, { "sneak-in": 0.3 }], roll_call: ["route", 0.5, { new: 0.47 }] }), heron, at("heron-warehouse", "wharf"), sack, considered);
  assert.equal(pre.move?.transition.id, "taken-on");
  assert.equal(pre.move?.roll, undefined, "no Stealth roll");
  assert.equal(pre.move?.to, "floor");
  assert.equal(pre.considered, undefined);
});

test("the Heron: the fight's closing narrates whoever its script sets out, not Sallow and the Crakes whatever happened", () => {
  const MASTER_HERE = route(heron, "wharf", "master-comes").establishes![0]!;
  const fight = heron.exits.find(e => e.id === "fight")!;
  assert.match(fight.closing, /If Master Sallow has come[^.]*\), his cane slides apart[\s\S]*If he hasn't come yet, he isn't in this and doesn't come in now: Hep's gang put down their sacks/);
  assert.doesNotMatch(fight.closing, /^Close on the moment the blades come out: Sallow's cane/, "the barbarian's T41: 'Sallow enters with the Crake brothers… Roll for initiative!', and then four porters");
  const leader = (established: string[]) => (ending(heron, "fight", established).find(o => o.op === "startCombat")?.args as { enemies: Array<{ leader: string }> }).enemies[0]!.leader;
  assert.equal(leader([]), "hep", "before he comes, it's Hep's gang");
  assert.equal(leader([MASTER_HERE]), "sallow");
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

// --- The King's Morning ----------------------------------------------------------------------

const king = sceneById("kings-morning");

test("the King's Morning: a failed press costs minutes and ground, and only the King going down to the procession puts it off", () => {
  const press = route(king, "reckoning", "press-the-king");
  assert.equal(press.check?.onFailure, undefined, "a failure keeps the scene where it is");
  assert.doesNotMatch(press.check!.failure, /holding the door|looked into most thoroughly, after the Assembly/, "the failure isn't the put-off ending's condition");
  assert.match(press.check!.failure, /On whose word[\s\S]*minutes[\s\S]*Nothing is settled yet/);
  assert.match(press.when, /made to explain himself isn't this, even in the same breath as an accusation/);
  assert.match(press.when, /sergeant's sworn record that points at Sallow, Sallow giving himself away in his own hearing[^)]*no dice are needed/);
  const putOff = route(king, "reckoning", "put-off");
  assert.match(putOff.when, /gone down to the procession[\s\S]*let it rest/);
  assert.match(putOff.when, /reaching for 'after the Assembly'[^)]*isn't this/);
  assert.match(king.exits.find(e => e.id === "after-the-assembly")!.outcome, /^The King has gone down to the procession with it put off/);
});

test("the King's Morning: the player can have Sallow sent in to explain himself, with no dice, and he's there to face", async () => {
  for (const beat of ["report", "reckoning"]) {
    const send = route(king, beat, "send-for-sallow");
    assert.equal(send.check, undefined);
    assert.equal(send.to, "face-to-face");
    assert.match(send.when, /'make him explain'[\s\S]*even in the same breath as accusing him or pressing the King: hearing him out comes first/, "the report's turn asked for both");
  }
  // Not on stage until he's sent for: then he comes in.
  const sallow = king.cast.find(c => c.id === "sallow")!;
  assert.equal(sallow.enters, "face-to-face");
  const state = at("kings-morning", "reckoning", { path: [{ turn: 2, from: "report", to: "reckoning", via: "told", source: "post" }] });
  assert.ok(!presentCast(king, state).some(c => c.id === "sallow"), "in the gallery until sent for");
  // T93: "Sallow is clearly running a crime syndicate... Make him explain where this grain came from."
  const pre = await decideBefore(scripted({ attempt: ["send-for-sallow", 0.75, { "press-the-king": 0.2 }], roll_call: ["none", 0.6] }), king, state, "Make him explain where this grain came from.", considered);
  assert.equal(pre.move?.transition.id, "send-for-sallow");
  assert.equal(pre.move?.roll, undefined, "no Persuasion roll against DC 15 for asking to see him");
  state.path.push({ turn: 3, from: "reckoning", to: "face-to-face", via: "send-for-sallow", source: "pre" });
  state.beat = "face-to-face";
  assert.ok(presentCast(king, state).some(c => c.id === "sallow"));
  // In front of the King: his weak spot is a slip with no dice; picking at his account is the bookkeeper's roll.
  const face = king.beats.find(b => b.id === "face-to-face")!;
  assert.match(face.direction, /lost to goblins, was it\? Careless of somebody/);
  const slip = route(king, "face-to-face", "sallow-slips");
  assert.equal(slip.to, "reckoning");
  assert.equal(slip.establishes?.length, 1);
  const catchOut = route(king, "face-to-face", "catch-sallow-out");
  assert.equal(catchOut.check?.skill, "investigation");
  assert.deepEqual(catchOut.check?.establishes?.success, slip.establishes);
  assert.equal(catchOut.check?.onFailure, undefined, "a failure costs minutes, and the hole is still there");
});

test("the King's Morning: Kell swears to what she saw and heard when the King asks who will, and says what it is", () => {
  const kell = king.cast.find(c => c.id === "kell")!;
  assert.match(kell.attitude, /When the King asks who will swear to it, or for a sworn record, she gives hers on the spot: she opens her notebook and reads him the entries[\s\S]*the substance and not that she could/);
  assert.match(kell.knows.join(" "), /whatever anyone owned to in her hearing/);
  // The goals tester's g15, T1-T2: "I can swear to what I saw and heard in the case", twice, and nothing of what.
  assert.match(king.beats.find(b => b.id === "report")!.cast!.kell!, /when the King asks who will swear, you will, then and there: read him your entries, the substance in a few plain sentences[\s\S]*not that you could/);
  assert.match(king.beats.find(b => b.id === "reckoning")!.cast!.kell!, /If the King asks who will swear, or for a sworn record, give it then and there: read him the entries from your notebook, the substance/);
  assert.match(king.cast.find(c => c.id === "king")!.attitude, /a sergeant's sworn record/);
});

test("the King's Morning: the approach chooses how Sallow is caught out (his papers, his words, or his pride with no dice)", async () => {
  const state = at("kings-morning", "face-to-face", { path: [{ turn: 2, from: "report", to: "face-to-face", via: "send-for-sallow", source: "pre" }] });
  // The thief's T55: the lavender, the ring and "condemned or lost to goblins, which is it?", read as deception .89, rolled Investigation at +0.
  const t55 = "(I sniff the air, loud and theatrical.) Lavender. Funny. A girl at the granary yesterday told me about a gentleman who smelled like a lavender shop, with a good coat, a silver-topped cane and a wheat-ear ring, who paid her that very crown on the table to swear she saw Prout jump. Condemned stock, you say, Master Sallow? The palace says the wagons were lost to goblins.";
  const words = route(king, "face-to-face", "trap-sallow");
  assert.equal(words.check?.skill, "persuasion", "a social roll, so the player's method carries through");
  assert.deepEqual(words.check?.establishes?.success, route(king, "face-to-face", "sallow-slips").establishes);
  assert.equal(words.check?.onFailure, undefined, "a failure costs minutes, and the hole is still there");
  const pre = await decideBefore(scripted({ attempt: ["trap-sallow", 0.78, { "catch-sallow-out": 0.1 }], attempt_means: ["deception", 0.89], roll_call: ["route", 0.83] }), king, state, t55, considered);
  assert.equal(pre.move?.transition.id, "trap-sallow");
  assert.equal(pre.move?.roll?.skill, "deception", "rolled by how they went about it");
  // The papers are the bookkeeper's roll, and no longer carry the no-dice case in a parenthetical the decider matches.
  const papers = route(king, "face-to-face", "catch-sallow-out");
  assert.equal(papers.check?.skill, "investigation");
  assert.match(papers.when, /^The player picks at Sallow's papers and accounts in front of the King to catch him out by what's written/);
  assert.doesNotMatch(papers.when, /Careless of somebody/);
  // The bait is a route of its own, with no dice (the goals tester's g15 T5 was ruled Persuasion DC 13).
  const bait = route(king, "face-to-face", "bait-sallow");
  assert.equal(bait.check, undefined);
  assert.equal(bait.on, undefined, "it simply happens");
  assert.equal(bait.to, "reckoning");
  assert.deepEqual(bait.establishes, route(king, "face-to-face", "sallow-slips").establishes);
  assert.match(bait.when, /^The player gets Sallow's arrangements wrong to his face[\s\S]*'Lost to goblins, was it\? Careless of somebody'[\s\S]*No dice/);
  const g15 = "(I smile at Sallow.) Condemned grain. And before it was condemned, lost to goblins, was it? Careless of somebody, losing a dozen of the King's wagons on one road.";
  const baited = await decideBefore(scripted({ attempt: ["plain:bait-sallow", 0.7, { "trap-sallow": 0.2 }], roll_call: ["new", 0.78] }), king, state, g15, considered);
  assert.equal(baited.plainTransition?.id, "bait-sallow");
  assert.equal(baited.considered, undefined);
});

test("the King's Morning: Sallow in the room is the face-to-face beat, whoever sent for him", async () => {
  for (const beat of ["report", "reckoning"]) {
    const comes = route(king, beat, "sallow-comes-in");
    assert.equal(comes.given, true, "the King's or the Marshal's doing, judged after the reply");
    assert.equal(comes.to, "face-to-face");
    assert.match(comes.when, /whoever had him in: the King sending for him of his own accord, the Marshal, or Sallow himself/);
  }
  // The goals tester's g15, T3: "Garran, ask Master Sallow to step in", of the King's own accord, and the beat stayed in the report.
  const state = at("kings-morning", "report", { turnsInBeat: 3 });
  const reply = "The King sets down his cup. \"Garran, ask Master Sallow to step in.\" A minute later, lavender, and Master Sallow is bowing in the doorway.";
  const after = await decideAfter(scripted({ outcome: ["sallow-comes-in", 0.8] }), king, state, "(I keep quiet and let Kell answer the King.)", reply);
  assert.equal(after.move?.transition.id, "sallow-comes-in");
  assert.equal(after.move?.to, "face-to-face");
});

test("Kell: a name promised kept out of it stays out of her notebook and what she swears to, in every card she has and her lore", () => {
  // The goals tester's g14 T2 ("your name stays out of it. Not the watch, not anybody's book", then "Witness: Cob. Noted.") and g10 T24 (her sworn account named Cob, after "I won't put the boy's name in it").
  const promise = /A name someone was promised would be kept out of it[^.]*stays out of her notebook and out of anything she says or swears to[^.]*: she knows who it was, and writes and says 'a witness' instead/;
  for (const id of ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning", "caerwyn-afternoon", "wharf-night"]) {
    assert.match(sceneById(id).cast.find(c => c.id === "kell")!.attitude, promise, `${id}: Kell holds the promise`);
  }
  assert.match(king.cast.find(c => c.id === "kell")!.knows.join(" "), /but for a name someone was promised would be kept out of it: that witness is 'a witness' in her notebook, and in what she swears to/);
  const lore = readFileSync(new URL("../../lore/Cast/Sergeant Agnes Kell/private.md", import.meta.url), "utf8");
  assert.match(lore, /A name someone was promised would be kept out of it[^.]*stays out of your notebook and out of anything you say or swear to/);
});

// --- The Drowned Rat: Hobb -------------------------------------------------------------------

const rat = sceneById("drowned-rat");
const plainRat = effectiveScene(rat, []);
const TALKED = route(rat, "big-hobb", "hobb-breaks").establishes![0]!;
const NAMED = route(rat, "confession", "told-master").establishes![0]!;

test("the Rat: a confession that stops short of the name ends on what he told, wherever the scene had got to", () => {
  // The report's tracker sat in on-his-feet when Hobb owned to the loft (T55) and went to work (T65).
  const breaks = route(rat, "on-his-feet", "hobb-breaks");
  assert.equal(breaks.to, "confession");
  assert.deepEqual(breaks.establishes, [TALKED]);
  assert.equal(route(rat, "on-his-feet", "gone-talked").to, "hobb-talks");
  assert.match(route(rat, "on-his-feet", "gone").when, /without having owned to any of it/);
  assert.match(rat.exits.find(e => e.id === "hobb-talks")!.outcome, /or the heart of it: at the least, his part in the loft[\s\S]*in Kell's notebook as he said it/);
  // Whichever way they broke him, he has broken.
  for (const [beat, id] of [["big-hobb", "win-hobb"], ["big-hobb", "scare-hobb"], ["big-hobb", "trick-hobb"], ["on-his-feet", "catch-him"], ["on-his-feet", "last-word"]] as const) {
    assert.deepEqual(route(rat, beat, id).check?.establishes?.success, [TALKED], `${id} succeeding is Hobb breaking`);
  }
});

test("the Rat: Kell remembers what Hobb owned to, however the scene ends, and the notebook says what he said", () => {
  const partial = ending(plainRat, "hobb-talks", [TALKED]);
  assert.match(remembered(partial, "kell").join(" "), /owned that he held Prout's arms in the tally loft while his master \(he wouldn't say the name\) killed him/);
  assert.match(journal(partial)[0]!, /^Big Hobb owned to the loft/);
  assert.doesNotMatch(JSON.stringify(partial), /Master Sallow killed/, "nobody puts a name in his mouth");
  const named = ending(plainRat, "hobb-talks", [TALKED, NAMED]);
  assert.match(remembered(named, "kell").join(" "), /while Master Sallow killed him/);
  for (const exit of ["taken-in", "hobb-fled", "thrown-out", "gone-to-work"]) {
    assert.match(remembered(ending(plainRat, exit, [TALKED]), "kell").join(" "), /owned that he held Prout's arms/, `${exit}: Kell has it`);
    assert.ok(!remembered(ending(plainRat, exit, []), "kell").some(f => /owned that/.test(f)), `${exit}: nothing to remember if he owned to nothing`);
  }
});

test("the Rat: his mum kept safe tonight is a plan with a way in, rolled where it could go either way, and the limit doesn't forbid it", () => {
  for (const beat of ["big-hobb", "on-his-feet", "confession"]) {
    const mum = route(rat, beat, "mum-safe");
    assert.equal(mum.check?.skill, "persuasion");
    assert.equal(mum.check?.onSuccess, "confession");
    assert.equal(mum.check?.onFailure, undefined, "a no costs ground, and keeps the scene going");
    assert.match(mum.when, /Kell, for a night[\s\S]*Dilly, aboard the Dabchick[\s\S]*Nan/);
    assert.deepEqual(mum.check?.establishes?.success?.slice(1), [TALKED], "and on a success he has begun to tell it");
  }
  assert.match(route(rat, "confession", "turn-hobb").when, /Once his mum is to be kept safe tonight, or for a promise that truly answers his fear, it needs no dice/);
  const limit = rat.limits!.find(l => /before the bell/.test(l) && /Shambles/.test(l))!;
  assert.match(limit, /^The player going anywhere else themselves/);
  assert.match(limit, /Sending is another matter[\s\S]*fetch Hobb's mum/);
  assert.match(rat.cast.find(c => c.id === "kell")!.knows.join(" "), /can be talked into one night/);
  assert.match(rat.cast.find(c => c.id === "dilly")!.knows.join(" "), /cabin aft on the Dabchick/);
  const safe = route(rat, "big-hobb", "mum-safe").check!.establishes!.success!;
  assert.match(journal(ending(plainRat, "hobb-talks", [TALKED, ...safe])).join(" "), /Hobb's mum is to be fetched from the Shambles tonight/);
});

test("the Rat: Hobb's token is only brass, and he needs no token to get in", () => {
  assert.match(rat.cast.find(c => c.id === "hobb")!.secrets!.join(" "), /the gang know his face at the grille, so he has no need of it tonight/);
});

test("the Rat: once he has owned to the loft, the rest comes as he's asked: the name, the Heron and the token are asks with no dice", async () => {
  // The QA pass: asked straight for the Master's name (the barbarian's T23 and T27), where he works and the token (rb-2m2, g7 T11, g11 T5), each went to a ruling and a roll.
  const asks = { "told-master": /^The player asks Hobb straight for his master's name/, "told-heron": /^The player asks Hobb where he works/, "token-given": /^The player asks Hobb for his brass river-door token/ };
  for (const [id, words] of Object.entries(asks)) {
    const t = route(rat, "confession", id);
    assert.equal(t.check, undefined, `${id}: no dice`);
    assert.equal(t.on, undefined, `${id}: it simply happens, so the decider sees it beside the rolls`);
    assert.equal(t.given, undefined, `${id}: the player's to ask for`);
    assert.match(t.when, words);
    assert.match(t.when, /No dice/);
    assert.equal(t.establishes?.length, 1);
  }
  assert.match(route(rat, "confession", "told-master").when, /in a whisper[\s\S]*Master Sallow of the Royal Purveyor's office/);
  assert.match(route(rat, "confession", "token-given").when, /it's only brass, and the gang know his face at the grille/);
  assert.match(route(rat, "confession", "told-heron").when, /the Heron warehouse[\s\S]*the eleventh bell[\s\S]*brass heron token[\s\S]*the midnight bell/);
  assert.match(rat.beats.find(b => b.id === "confession")!.cast!.hobb!, /asked straight for the Master's name, you give it, in a whisper/);
  // The barbarian's T23, read as the ask: no ruling, though the roll call said a roll was wanted.
  const state = at("drowned-rat", "confession", { established: [TALKED] });
  const t23 = "(I put a hand on his big shoulder, not hard.) You held the rope. The Master did the killing. I heard you. Now: this Master. Name, and where he keeps himself.";
  const pre = await decideBefore(scripted({ attempt: ["plain:told-master", 0.6, { none: 0.3 }], roll_call: ["new", 0.86, { route: 0.07 }] }), rat, state, t23, considered);
  assert.equal(pre.plainTransition?.id, "told-master");
  assert.equal(pre.considered, undefined, "no Persuasion DC 15 for the name");
  // Being his man inside follows the same way, once his mum is safe: a roll only while his fear could still win.
  assert.match(route(rat, "confession", "inside-man").when, /^The player asks Hobb to be their man inside the Heron tonight[\s\S]*once his mum is to be kept safe tonight[\s\S]*No dice/);
  assert.match(route(rat, "confession", "turn-hobb").when, /while his fear of his master could still win: his mum isn't safe yet/);
  assert.deepEqual(route(rat, "confession", "turn-hobb").check?.establishes?.success, route(rat, "confession", "inside-man").establishes, "won on the roll, he's their man inside as the ending's script reads it");
});

test("the Rat: his mum made safe opens him up, however it came about, so a ruling standing in for the roll keeps the payoff", () => {
  const MUM_SAFE = route(rat, "big-hobb", "mum-safe").check!.establishes!.success![0]!;
  for (const beat of ["big-hobb", "on-his-feet", "confession"]) {
    const taken = route(rat, beat, "mum-taken-in");
    assert.equal(taken.given, true, "someone else's to give: judged after the reply, never the player's to simply take");
    assert.equal(taken.check, undefined);
    assert.equal(taken.to, "confession");
    assert.deepEqual(taken.establishes, [MUM_SAFE, TALKED]);
    assert.match(taken.when, /Kell, for a night in her own room; Dilly, aboard the Dabchick; Nan, with the widow on the landing[\s\S]*'I only held the rope\.'/);
  }
  // The goals tester's g10 T11: a ruling stood in for mum-safe (Dilly's cabin), counted as nothing, and Hobb didn't open up. Counted as this route, he does.
  const state = at("drowned-rat", "big-hobb");
  const outcome = (happens: string, counts_as: string) => ({ happens, gets: counts_as === "none" ? "none" : "all", to: "stay", counts_as, establishes: [], reveals: [], closes: [] });
  const ruling = toRuling(plainRat, state, {
    act: "Ask Dilly to take Hobb's mum aboard the Dabchick tonight", target: "dilly", lie: false, skill: "persuasion",
    stakes: "dangerous", approach: "strong", disposition: "friendly", same_again: false, difficulty: "moderate", reason: "to get the bargewoman to take his mum in tonight",
    success: outcome("Dilly offers the Dabchick's cabin aft for Hobb's mum, as long as no uniform sets foot aboard.", "mum-taken-in"),
    failure: outcome("Dilly won't have the watch near her barge.", "none"),
  }, { costUsd: 0, latencyMs: 0 });
  assert.equal(ruling.success.countsAs, "mum-taken-in");
  assert.equal(ruling.success.to, "confession", "the confession beat, where the rest comes as he's asked");
  assert.ok(ruling.success.establishes.includes(TALKED) && ruling.success.establishes.includes(MUM_SAFE));
  // And what he owned to is in Kell's notebook, whichever way the scene then ends.
  assert.match(remembered(ending(plainRat, "taken-in", ruling.success.establishes), "kell").join(" "), /owned that he held Prout's arms/);
});

test("the Rat: going to work, Hobb says why he must, so his mum is on the table before the scene can close", () => {
  // The wizard's T40-T42: the appeal at the door failed, and his mum came out only in the reply that closed the scene.
  const feet = rat.beats.find(b => b.id === "on-his-feet")!;
  assert.match(feet.cast!.hobb!, /Going to work, if anyone tries to stop you, you say why you must, once[\s\S]*he knows where your mum lives/);
  assert.match(route(rat, "on-his-feet", "last-word").check!.failure, /the Master knows where his mum lives\. Then he goes out/);
  // And in a talk afterwards (which reads her lore, not the Rat's card), Kell says what she could do instead of refusing outright.
  const lore = readFileSync(new URL("../../lore/Cast/Sergeant Agnes Kell/private.md", import.meta.url), "utf8");
  assert.match(lore, /asked for those you say no, plainly, and say what you could do instead[\s\S]*a spare chair and a door that locks[\s\S]*you can be talked into one night/);
});

// --- Cob and his boot ------------------------------------------------------------------------

const clerk = sceneById("hanged-clerk");

/** The Rat with the page owed: missed at the granary, it's in the boot on Cob's feet, with the Rat's ways in. */
function ratWithPage(beat = "the-rat"): { scene: Scene; state: SessionState } {
  const state = at("hanged-clerk", "doubt", { landed: [], hinted: [] });
  state.world = buildWorld(clerk.id, clerk.world!, presentCast(clerk, state).map(c => ({ id: c.id, name: c.name })), state.player);
  const owed = owedAtEnd(clerk, state);
  delete state.world;
  Object.assign(state, { sceneId: rat.id, beat, turnsInBeat: 1, path: [], established: [], patches: [], landed: [], hinted: [] });
  bringOver(state, rat, owed, undefined);
  return { scene: effectiveScene(rat, state.patches), state };
}

test("Cob: at the granary the boot has ways in of its own, a polite ask is a roll, and they go once the page is out", () => {
  for (const beat of ["yard", "doubt"]) {
    const bribe = route(clerk, beat, "bribe-cob");
    assert.equal(bribe.check, undefined, "a bribe isn't a try: no dice, and no boot");
    assert.equal(bribe.to, beat);
    assert.match(bribe.when, /price of a look[\s\S]*the boot stays on[\s\S]*Food with nothing asked back is a kindness, not this/);
    const kind = route(clerk, beat, "kind-to-cob");
    assert.equal(kind.check, undefined);
    assert.match(kind.when, /nothing asked back[\s\S]*it counts with him: after it, a polite ask for a look in his boot, the boots staying his, gets a yes/);
    assert.equal(kind.establishes?.length, 1);
    const coax = route(clerk, beat, "coax-cob");
    assert.equal(coax.check?.skill, "persuasion");
    assert.equal(coax.check?.dc, 12);
    assert.match(coax.when, /see or feel what's crackling in it, with the boots staying his/);
    assert.equal(coax.check?.onSuccess, "motive");
    assert.equal(coax.check?.onFailure, undefined, "a no keeps the boot reachable");
    const trust = route(clerk, beat, "trust-cob");
    assert.equal(trust.check, undefined);
    assert.equal(trust.to, "motive");
    for (const t of [coax.check!.establishes!.success!, trust.establishes!]) assert.deepEqual(t, route(clerk, beat, "page-found").establishes, "the page is out, as the endings read it");
  }
  // Found, they go: the ways in that bring it, and the bribe and the kindness that are ways towards it.
  const state = at("hanged-clerk", "doubt", { landed: ["page"] });
  const open = openRoutes(clerk.beats.find(b => b.id === "doubt")!.transitions, state).map(t => t.id);
  assert.ok(!["bribe-cob", "kind-to-cob", "coax-cob", "trust-cob"].some(id => open.includes(id)));
});

// The goals tester's g1 and g13, T2: a coin held up as the price of a look, in the words of a polite ask.
const PENNY_FOR_A_LOOK = "Not buying the boots, Cob. Just a look in the left one. (I hold up a silver penny.) This is yours if I can see what's crackling in there.";

test("Cob: a bribe and a kindness are ways towards the page, not ways it comes out: a ruling that counts as one leaves it in the boot", () => {
  for (const beat of ["yard", "doubt"]) {
    for (const id of ["bribe-cob", "kind-to-cob"]) {
      const t = route(clerk, beat, id);
      assert.equal(t.essential, undefined, `${id} brings nothing out`);
      assert.equal(t.towards, "page", `${id} is there only while the page is to be found`);
    }
    for (const id of ["coax-cob", "trust-cob"]) assert.equal(route(clerk, beat, id).essential, "page", `${id} brings the page`);
  }
  // rb-1m2, T2: a shilling for a look, ruled DC 18, a natural 1; the failure counted as bribe-cob, and the page "came out" still sewn in the boot.
  const state = at("hanged-clerk", "yard");
  const outcome = (happens: string, gets: string) => ({ happens, gets, to: "stay", counts_as: "bribe-cob", establishes: [], reveals: [], closes: [] });
  const ruling = toRuling(clerk, state, {
    act: "Offer a shilling for a look in Cob's boot", target: "cob", lie: false, skill: "persuasion",
    stakes: "guarded", approach: "weak", disposition: "hostile", same_again: false, difficulty: "moderate", reason: "to get Cob to let you look in his boot",
    success: outcome("Cob bites the shilling, boasts, and keeps the boots on.", "some"),
    failure: outcome("Cob snatches the shilling and backs off to the water butt, boot on.", "none"),
  }, { costUsd: 0, latencyMs: 0 });
  assert.deepEqual([ruling.success.reveals, ruling.failure.reveals], [[], []], "the page is still in the boot either way");
  assert.equal(ruling.failure.countsAs, "bribe-cob");
  // And at the Rat, with nothing owed, the Rat's bribe and kindness aren't there at all.
  const plain = effectiveScene(rat, []);
  assert.ok(plain.beats.every(b => !b.transitions.some(t => t.towards || ["bribe-cob", "kind-to-cob"].includes(t.id))));
});

test("Cob: a coin held up for a look is a bribe however politely it's asked; a polite ask is for before he's any reason to trust them", async () => {
  for (const beat of ["yard", "doubt"]) {
    const bribe = route(clerk, beat, "bribe-cob");
    assert.match(bribe.when, /^The player offers Cob something as the price of a look[\s\S]*'this is yours if I can see what's in there'[\s\S]*however politely it's asked and whatever they say about the boots staying his/);
    const coax = route(clerk, beat, "coax-cob");
    assert.match(coax.when, /^Before Cob has any reason to trust them \(no kindness with nothing asked back done him yet, no promise that answers what he's afraid of, no yes from him already\) and with nothing offered for it/);
    assert.match(coax.when, /Not with anything offered for the look \(a coin, food, a trade\): that's a bribe, and gets haggling/);
  }
  // Read as the bribe, it settles the turn as written: no ruling, no roll, and the boot stays on.
  const pre = await decideBefore(scripted({ attempt: ["plain:bribe-cob", 0.7, { "coax-cob": 0.2 }], roll_call: ["route", 0.8, { new: 0.1 }] }), clerk, at("hanged-clerk", "yard"), PENNY_FOR_A_LOOK, considered);
  assert.equal(pre.plainTransition?.id, "bribe-cob");
  assert.equal(pre.move, undefined);
  assert.equal(pre.considered, undefined);
});

test("Cob: after a kindness, the polite ask that failed before is trust, with no dice, and his yes isn't taken back", async () => {
  // The goals tester's g3: a polite ask failed on a natural 1 (T2), a goodberry given freely (T4), then the ask again (T6), read as the failed coax-cob.
  const kind = route(clerk, "yard", "kind-to-cob");
  const state = at("hanged-clerk", "yard", {
    turn: 6, turnsInBeat: 5, established: [...kind.establishes!],
    path: [
      { turn: 2, from: "yard", to: "yard", via: "coax-cob", source: "pre", roll: { skill: "persuasion", dc: 12, die: 1, modifier: 2, total: 3, success: false, critical: "failure" } },
      { turn: 4, from: "yard", to: "yard", via: "kind-to-cob", source: "post" },
    ],
  });
  const open = openRoutes(clerk.beats.find(b => b.id === "yard")!.transitions, state).map(t => t.id);
  assert.ok(open.includes("trust-cob") && !open.includes("kind-to-cob"), "the kindness is spent; trust is there");
  const trust = route(clerk, "yard", "trust-cob");
  assert.match(trust.when, /they did him a kindness with nothing asked back earlier[\s\S]*or he has already told them they can look\. No dice, however it's put/);
  const pre = await decideBefore(scripted({ attempt: ["plain:trust-cob", 0.6, { "coax-cob": 0.3 }], roll_call: ["route", 0.5, { none: 0.3 }], same_again: ["same", 0.8] }), clerk, state, "I'll keep my word, Cob. You said I could look, so just a look: you hold the boot, I only peep inside the top. No hands in it.", considered);
  assert.equal(pre.plainTransition?.id, "trust-cob");
  assert.equal(pre.sameAgain, undefined, "not the same push again: the kindness changed things");
  assert.equal(pre.considered, undefined);
  assert.match(clerk.cast.find(c => c.id === "cob")!.secrets!.join(" "), /A yes he's given is a yes: he doesn't take it back/);
});

test("Cob: a promise that answers his fear is a yes with no dice, and his granary fears are what it answers", async () => {
  const cob = clerk.cast.find(c => c.id === "cob")!;
  assert.match(cob.fears!, /his name gets about: in the watch's book \(the bluebottles write everything down\)/, "his name kept out answers this");
  assert.match(cob.fears!, /taken up by the watch and sent to the Mending House/, "the King's hand and not the watch answers this");
  for (const beat of ["yard", "doubt"] as const) {
    const win = route(clerk, beat, "win-cob");
    assert.doesNotMatch(win.when, /promise of safety/, "a promise isn't one of the rolled appeals");
    assert.match(win.when, /A promise that truly answers what he's afraid of[^)]*needs no dice/);
    const promise = route(clerk, beat, "promise-cob");
    assert.equal(promise.check, undefined, "no dice");
    assert.equal(promise.on, undefined, "it simply happens: the decider sees it beside the rolls");
    assert.match(promise.when, /his name kept out of it \(nothing to the watch, nothing in anybody's book\), the men from the loft kept off him, no Mending House/);
    assert.match(promise.when, /Asked for a look in his boot as well, he holds the left one out himself/);
    assert.match(route(clerk, beat, "trust-cob").when, /or they make him a promise, now or before, that truly answers what he's afraid of \(his name kept out of it/);
  }
  assert.match(route(clerk, "yard", "promise-cob").when, /a lantern and voices[\s\S]*the hoist creaking with no sacks on it/, "in the yard, what he heard");
  assert.deepEqual(route(clerk, "yard", "promise-cob").establishes, route(clerk, "yard", "not-suicide").establishes, "and the suicide story is broken");
  assert.match(route(clerk, "doubt", "promise-cob").when, /Silvertop, the posh cove with the silver-topped cane/, "once it's murder, who");
  // g9 T1: the promise alone, as the first move; read as the promise, it settles the turn with no roll.
  const g9 = "(I crouch so I'm Cob's height, a good way off.) Cob, I'm not after your boots and I'm not the watch's. So here's a promise, and I keep mine: whatever you know, or have, about Mister Prout, your name stays out of it. If it matters, it goes to the King's own hand, never the watch.";
  const pre = await decideBefore(scripted({ attempt: ["plain:promise-cob", 0.6, { "win-cob": 0.3 }], roll_call: ["route", 0.6, { new: 0.3 }] }), clerk, at("hanged-clerk", "yard"), g9, considered);
  assert.equal(pre.plainTransition?.id, "promise-cob");
  assert.equal(pre.move, undefined, "nothing rolled");
  assert.equal(pre.considered, undefined, "and no ruling");
});

test("Cob: the report's polite ask at the granary is rolled, not refused, and a bribe still isn't a try", async () => {
  // T18: "I don't want your boots. I just want to see what's making that noise. I assume you got them from the body. Could be evidence."
  const asked = await decideBefore(scripted({ attempt: ["coax-cob", 0.7], roll_call: ["route", 0.8, { new: 0.1 }] }), clerk, at("hanged-clerk", "doubt"), "I don't want your boots. I just want to see what's making that noise. Could be evidence.", considered);
  assert.equal(asked.move?.transition.id, "coax-cob");
  assert.equal(asked.move?.roll?.skill, "persuasion");
  assert.equal(asked.move?.roll?.dc, 12);
  const bribed = await decideBefore(scripted({ attempt: ["plain:bribe-cob", 0.8] }), clerk, at("hanged-clerk", "doubt"), "A shilling if you let me look in your boot.", { speaker: false });
  assert.equal(bribed.plainTransition?.id, "bribe-cob");
  assert.equal(bribed.move, undefined);
});

test("Cob: at the Rat a free meal is a kindness, not a bribe, and the polite ask is for the scullery", async () => {
  const { scene, state } = ratWithPage();
  const kind = route(scene, "the-rat", "kind-to-cob");
  assert.match(kind.when, /stands him his dinner or an extra bowl with no strings[\s\S]*out of the big cove's sight, gets a yes/);
  assert.match(route(scene, "the-rat", "bribe-cob").when, /price of a look[\s\S]*A meal stood him with nothing asked back is a kindness, not this/);
  const coax = route(scene, "the-rat", "coax-cob");
  assert.match(coax.when, /^Out of the big cove's sight \(in the scullery[\s\S]*politely and with the boots staying his/);
  assert.match(coax.when, /Out in the room, under the big cove's eye, he won't, and says so his way: not out here/);
  assert.match(route(scene, "the-rat", "trust-cob").when, /a kindness with nothing asked back/);
  // T43, then T44: two pennies of eel for a look is a bribe; a penny for the boy's meal, no strings, is a kindness.
  const t43 = await decideBefore(scripted({ attempt: ["plain:bribe-cob", 0.85] }), scene, state, "Two pennies for some extra eel if you'll let me look at what's crackling in your boot, Cob.", { speaker: false });
  assert.equal(t43.plainTransition?.id, "bribe-cob");
  const t44 = await decideBefore(scripted({ attempt: ["plain:kind-to-cob", 0.8] }), scene, state, "Sure, here's a penny for the boy's meal.", { speaker: false });
  assert.equal(t44.plainTransition?.id, "kind-to-cob");
});

test("Cob: the same boy about his boots at the granary and at the Rat, in his cards and his lore", () => {
  const cards = [clerk, rat].map(s => s.cast.find(c => c.id === "cob")!);
  for (const card of cards) {
    const all = [...(card.secrets ?? []), card.attitude].join(" ");
    assert.doesNotMatch(all, /trade them for something good/, "a look isn't for sale");
    assert.match(all, /price of a look (gets|buys) (haggling and boasts|boasts and haggling), never the (look|boot)/);
    assert.match(all, /a kindness with nothing asked back[^.;]*counts/i);
    assert.match(card.attitude, /food or coin offered as a price gets boasts and bargaining; a kindness with nothing asked back/);
  }
  assert.match(cards[0]!.secrets!.join(" "), /asked politely, the boots staying his, he might let someone look \(it could go either way\)/);
  assert.match(cards[1]!.secrets!.join(" "), /Asked politely out of the big cove's sight \(the scullery\), the boots staying his, he might \(it could go either way\)/);
});
