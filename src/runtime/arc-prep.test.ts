import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoiceQuestion, Decider } from "../llm/decide.ts";
import { sceneById } from "../../scenes/index.ts";
import { ASSETS } from "../world/assets.ts";
import { recordingWorld, type Operation } from "../world/dsl.ts";
import { applyOps, areaOf, buildWorld, type WorldOp } from "../world/scene-world.ts";
import { effectiveScene, openRoutes, presentCast } from "./brief.ts";
import { decideBefore } from "./director.ts";
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

test("the King's Morning: Kell swears to what she saw and heard when the King asks who will", () => {
  const kell = king.cast.find(c => c.id === "kell")!;
  assert.match(kell.attitude, /When the King asks who will swear to it, or for a sworn record, she gives hers on the spot/);
  assert.match(kell.knows.join(" "), /whatever anyone owned to in her hearing/);
  assert.match(king.beats.find(b => b.id === "report")!.cast!.kell!, /when the King asks who will swear, you will/);
  assert.match(king.beats.find(b => b.id === "reckoning")!.cast!.kell!, /If the King asks who will swear/);
  assert.match(king.cast.find(c => c.id === "king")!.attitude, /a sergeant's sworn record/);
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
    assert.equal(mum.check?.establishes?.success?.length, 1);
  }
  assert.match(route(rat, "confession", "turn-hobb").when, /his mum got safe tonight is that/);
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
  // Found, they go.
  const state = at("hanged-clerk", "doubt", { landed: ["page"] });
  const open = openRoutes(clerk.beats.find(b => b.id === "doubt")!.transitions, state).map(t => t.id);
  assert.ok(!["bribe-cob", "kind-to-cob", "coax-cob", "trust-cob"].some(id => open.includes(id)));
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
