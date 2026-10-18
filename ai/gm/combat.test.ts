import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import type { CombatFighter, CombatView } from "../../shared/protocol/ai.ts";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { loadScene } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { fakeFetch } from "../llm/fake-openrouter.ts";
import type { CallContext } from "../llm/openrouter.ts";
import { combatInput, combatMove, fightNote } from "./combat.ts";
import { CAERWYN, viewAt } from "./fixtures.ts";
import { fightOf, routeLine, speak, twoPartNow } from "./two-part.ts";
import { decideReactions } from "./mechanics.ts";
import { director } from "../service/endpoints/turn.ts";
import type { TurnView } from "./view.ts";

/**
 * The combat GM (docs/combat-gm.md) on the hanged clerk: the fight as it reads it, its tool loop
 * stopping on each call that passes (a wrong one answered in the loop to be put right), the fake
 * model's turns, and the mouthpiece's roll for initiative held to who's here.
 */

const COPIES = mkdtempSync(join(tmpdir(), "km-combat-"));
after(() => rmSync(COPIES, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(COPIES, game) });

const clerk: Scene = effectiveScene(loadScene(readFileSync(join(CAERWYN, "scenes", "hanged-clerk.kmscene"), "utf8")), []);
const byKey = (m: { speech: unknown[] }) => m as never;

function yard(): TurnView {
  const view = viewAt(clerk, clerk.start, { turn: 1, turnsInBeat: 0 });
  view.twoPart = { roles: {}, notes: [] };
  view.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "I hit Cob with my sword." });
  view.rules = { weapons: [{ id: "w1", name: "Longsword" }], spells: [], features: [] };
  return view;
}

const fighter = (id: string, name: string, side: "party" | "foes", initiative: number, feet: Record<string, number>, more: Partial<CombatFighter> = {}): CombatFighter => ({
  id, name, side, initiative, hurt: "unhurt", hp: 10, max: 10, ac: 12, down: false, reach: { melee: true, feet: 5, speed: 30 }, feet, ...more,
});

function fight(whose: string, more: Partial<CombatView> = {}): CombatView {
  const fighters = [
    fighter("cob", "Cob", "foes", 17, { player: 20, kell: 30 }),
    fighter("player", "you", "party", 12, { cob: 20, kell: 10 }, { hp: 24, max: 24, ac: 16 }),
    fighter("kell", "Sergeant Agnes Kell", "party", 8, { cob: 30, player: 10 }),
  ];
  const at = fighters.findIndex(f => f.id === whose);
  return { state: { started: 1, round: 1, order: fighters.map(f => ({ id: f.id, side: f.side, initiative: f.initiative })), at, why: "Cob won't be taken" }, fighters, whose, done: [], ...more };
}

/** A model that makes the calls it's given, a round at a time. */
function scripted(rounds: Array<[string, Record<string, unknown>]>): CallContext & { inputs: unknown[] } {
  let round = 0;
  const inputs: unknown[] = [];
  const f: typeof fetch = async (_url, init) => {
    inputs.push(JSON.parse(String(init?.body)).input);
    const call = rounds[round++];
    if (!call) return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "They hold their ground." }] }], usage: { cost: 0 } });
    return Response.json({ status: "completed", output: [{ type: "function_call", call_id: `c${round}`, name: call[0], arguments: JSON.stringify(call[1]) }], usage: { cost: 0 } });
  };
  return { fetch: f, apiKey: "fake", inputs };
}

test("the fight as the GM reads it: everyone in order with how they stand, their reach and how far from each other, whose turn, and on the player's their words and their sheet", () => {
  const note = fightNote(yard(), fight("player"));
  assert.match(note, /^## The fight: round 1 \(Cob won't be taken\)/);
  assert.match(note, /- Cob \[cob\], against the player, initiative 17: unhurt, HP 10\/10, AC 12; melee, reach 5 ft, moves 30 ft\. From: you 20 ft, Sergeant Agnes Kell 30 ft/);
  assert.match(note, /- You, the player character \("you" in your narration, never their name\) \[player\], initiative 12: .*◀ their turn now/);
  const unheard = fight("cob");
  unheard.fighters[0] = { ...unheard.fighters[0]!, called: "the boy with the stones" };
  assert.match(fightNote(yard(), unheard), /- the boy with the stones \(Cob: the player hasn't heard the name, so they're the boy with the stones in your narration until someone says it\) \[cob\]/);
  assert.match(fightNote(yard(), unheard), /## It's the boy with the stones's turn \[cob\]/);
  assert.match(note, /## It's the player's turn\nThey said: «I hit Cob with my sword\.»/);
  assert.match(note, /weapons: Longsword \[w1\]/);
  const theirs = fightNote(yard(), fight("cob"));
  assert.match(theirs, /## It's Cob's turn \[cob\], against the player/);
  const over = fightNote(yard(), fight("cob", { over: { outcome: "won", why: "nobody on the other side can fight on" } }));
  assert.match(over, /## The fight is over\nBy the rules: nobody on the other side can fight on\. Call end_combat \(outcome won\)/);
});

test("the input: the scene's history, what's been narrated this turn already, then the fight", () => {
  const view = yard();
  view.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "Your blade bites. Cob howls." });
  const input = combatInput(clerk, view, fight("cob"));
  assert.equal(input.at(-2)!.role, "assistant");
  assert.match(input.at(-2)!.content, /Your blade bites/);
  assert.equal(input.at(-1)!.role, "system");
  assert.match(input.at(-1)!.content, /^## The fight: round 1/);
});

test("the loop stops on the first call that passes: a wrong one (Cob casting, a blow at nobody) is answered in the loop, and the GM puts it right", async () => {
  const calls = scripted([
    ["perform_action", { action: "cast", spell: "fire-bolt", target: "player", narration: "Cob waves his hands." }],
    ["perform_action", { action: "attack", target: "the-moon", narration: "Cob swings." }],
    ["move_towards", { target: "player", narration: "Cob comes at you over the cobbles." }],
  ]);
  const out = await combatMove(clerk, yard(), fight("cob"), { calls, byKey });
  assert.deepEqual(out.move, { kind: "act", act: { action: "move", target: "player", narration: "Cob comes at you over the cobbles." } });
  assert.equal(out.entries[0]!.text, "Cob comes at you over the cobbles.");
  assert.equal(calls.inputs.length, 3, "two corrections, then the move");
  const corrections = JSON.stringify(calls.inputs.at(-1));
  assert.match(corrections, /Cob can attack with their weapon, move, flee or surrender: the rules don't have cast for them/);
  assert.match(corrections, /Cob's attack is at someone in the fight/);
});

test("on anyone's turn but the player's there's no other (smoke2-1018: Kell's turn told as other, other, end_turn, her surrender among them): put right in the loop; and an other after the turn's action ends the turn on its words", async () => {
  const calls = scripted([
    ["perform_action", { action: "other", target: "player", narration: "Cob lets the boathook dip: “I'm done.”" }],
    ["perform_action", { action: "surrender", narration: "Cob throws the boathook down: “I'm done.”" }],
  ]);
  const out = await combatMove(clerk, yard(), fight("cob"), { calls, byKey });
  assert.deepEqual(out.move, { kind: "act", act: { action: "surrender", narration: "Cob throws the boathook down: “I'm done.”" } });
  assert.match(JSON.stringify(calls.inputs.at(-1)), /What Cob says, how they hold their ground or how they look is end_turn's narration: call end_turn with it\. If they give up, perform_action surrender; if they run, flee\./);
  const done = [{ act: { action: "attack" as const, target: "cob", narration: "You swing." }, lines: ["Longsword: your attack on Cob: 4 +5 = 9 vs AC 12: miss"], result: "You missed Cob." }];
  const after = await combatMove(clerk, yard(), fight("player", { done }), { calls: scripted([["perform_action", { action: "other", narration: "Your blade rings off the post, and Cob laughs." }]]), byKey });
  assert.deepEqual(after.move, { kind: "end_turn", narration: "Your blade rings off the post, and Cob laughs." }, "told once, as the turn's end");
});

test("a smite is the spell it is, cast beside the blow (QA round hobo1-1018: a paladin's Divine Smite called as a feature the rules haven't got, twice): a feature that's one of the player's spells is cast as it, a bonus-action spell doesn't take the turn's action, and only one a turn", async () => {
  const view = yard();
  view.rules = { weapons: [{ id: "w1", name: "Longsword" }], spells: [{ id: "divine-smite", name: "Divine Smite", level: 1, bonus: true }, { id: "command", name: "Command", level: 1 }], features: [] };
  const struck = [{ act: { action: "attack" as const, target: "cob", narration: "You swing." }, lines: ["Longsword: your attack on Cob: 18 +6 = 24 vs AC 12: hit"], result: "You hit Cob." }];
  const calls = scripted([["perform_action", { action: "feature", feature: "divine-smite", target: "cob", narration: "Your oath burns in the blade." }]]);
  const out = await combatMove(clerk, view, fight("player", { done: struck }), { calls, byKey });
  assert.deepEqual(out.move, { kind: "act", act: { action: "cast", spell: "divine-smite", target: "cob", narration: "Your oath burns in the blade." } }, "cast, beside the attack");
  const smitten = [...struck, { act: { action: "cast" as const, spell: "divine-smite", target: "cob", narration: "Smite." }, lines: [], result: "Your next hit lands 2d8 radiant harder." }];
  const again = scripted([["perform_action", { action: "cast", spell: "divine-smite", narration: "Again!" }], ["perform_action", { action: "cast", spell: "command", target: "cob", narration: "Drop." }], ["end_turn", { narration: "The light fades from the blade." }]]);
  const next = await combatMove(clerk, view, fight("player", { done: smitten }), { calls: again, byKey });
  assert.deepEqual(next.move, { kind: "end_turn", narration: "The light fades from the blade." });
  const told = JSON.stringify(again.inputs.at(-1));
  assert.match(told, /has cast a bonus-action spell this turn already/);
  assert.match(told, /has used their action this turn/, "the attack was the action; Command would be a second");
  assert.match(fightNote(view, fight("player")), /Divine Smite \(a bonus action, cast before the blow it goes with\) \[divine-smite\]/);
});

test("a turn's action once: a second attack is put right; past the turn's calls only end_turn; once it's over only end_combat", async () => {
  const done = [{ act: { action: "attack" as const, target: "player", narration: "Cob swings." }, lines: ["Club: Cob's attack on you: 4 +2 = 6 vs AC 16: miss"], result: "Cob missed you (Club)." }];
  const calls = scripted([["perform_action", { action: "attack", target: "player", narration: "Again!" }], ["end_turn", { narration: "The club whistles past you." }]]);
  const out = await combatMove(clerk, yard(), fight("cob", { done }), { calls, byKey });
  assert.deepEqual(out.move, { kind: "end_turn", narration: "The club whistles past you." });
  assert.match(JSON.stringify(calls.inputs.at(-1)), /Cob has used their action this turn/);
  const words = await combatMove(clerk, yard(), fight("cob", { over: { outcome: "won", why: "Cob is down" } }), { calls: scripted([]), byKey });
  assert.deepEqual(words.move, { kind: "end_combat", outcome: "won", narration: "They hold their ground." }, "words alone, once it's over, end it");
});

test("the fake GM plays a turn: closes on its target, attacks, ends the turn; and ends the fight when the rules say it's over", async () => {
  const f = fakeFetch();
  const calls = { fetch: f.fetch, apiKey: "fake" };
  const first = await combatMove(clerk, yard(), fight("cob"), { calls, byKey });
  assert.deepEqual(first.move, { kind: "act", act: { action: "move", target: "player", narration: "Cob closes in." } });
  const moved = { act: { action: "move" as const, target: "player", narration: "Cob closes in." }, lines: [], result: "Cob moved 17 ft towards you: now beside them." };
  const second = await combatMove(clerk, yard(), fight("cob", { done: [moved] }), { calls, byKey });
  assert.deepEqual(second.move, { kind: "act", act: { action: "attack", target: "player", narration: "Cob swings." } });
  const kells = await combatMove(clerk, yard(), fight("kell"), { calls, byKey });
  assert.deepEqual(kells.move, { kind: "act", act: { action: "move", target: "cob", narration: "Sergeant Agnes Kell closes in." } });
  const over = await combatMove(clerk, yard(), fight("cob", { over: { outcome: "won", why: "Cob is down" } }), { calls, byKey });
  assert.equal(over.move.kind, "end_combat");
});

test("roll_for_initiative held to who's here: names read as ids, nobody on both sides, none without a foe", () => {
  const view = yard();
  assert.deepEqual(fightOf(clerk, view, { foes: ["Cob", "moll"], allies: ["Kell", "cob"], why: "a brawl" }), { foes: ["cob", "moll"], allies: ["kell"], why: "a brawl" });
  assert.equal(fightOf(clerk, view, { foes: ["the moon"], allies: [], why: "" }), undefined);
  assert.equal(fightOf(clerk, view, null), undefined);
});

test("everyone here with no side yet picks one before the next turn (the user's design: pick a side or flee): pick_sides, one for each of them, a wrong one put right in the loop; words alone send them running", async () => {
  const pending = [
    { id: "moll", name: "Moll", called: "the girl in the shawl", about: "A sharp-faced girl on the yard wall." },
    { id: "porters", name: "the granary porters", about: "Porters in sack aprons.", arriving: "The shouting carries round to the loading dock." },
  ];
  const view = fight("cob", { pending });
  const note = fightNote(yard(), view);
  assert.match(note, /## Before the next turn: who's on which side\nThese people are here and have no side in the fight yet\. Call pick_sides with one for each: with_player, against_player or flee/);
  assert.match(note, /\n- the girl in the shawl \(Moll: the player hasn't heard the name\) \[moll\]\. A sharp-faced girl on the yard wall\./);
  assert.match(note, /\n- the granary porters \[porters\], just arrived: The shouting carries round to the loading dock\. Porters in sack aprons\./);
  assert.doesNotMatch(note, /It's Cob's turn/, "nobody's turn until they've picked");
  const calls = scripted([
    ["pick_sides", { sides: [{ id: "moll", side: "against_player" }], narration: "Moll drops off the wall." }],
    ["pick_sides", { sides: [{ id: "moll", side: "against_player" }, { id: "porters", side: "maybe" }], narration: "Moll drops off the wall." }],
    ["pick_sides", { sides: [{ id: "moll", side: "against_player" }, { id: "porters", side: "flee" }], narration: "Moll drops off the wall; the porters think better of it." }],
  ]);
  const out = await combatMove(clerk, yard(), view, { calls, byKey });
  assert.deepEqual(out.move, { kind: "sides", sides: { moll: "against_player", porters: "flee" }, narration: "Moll drops off the wall; the porters think better of it." });
  const corrections = JSON.stringify(calls.inputs.at(-1));
  assert.match(corrections, /pick_sides needs one for each: porters has none/);
  assert.match(corrections, /Each side is one of with_player, against_player, flee \(porters\)/);
  const words = await combatMove(clerk, yard(), view, { calls: scripted([]), byKey });
  assert.deepEqual(words.move, { kind: "sides", sides: { moll: "flee", porters: "flee" }, narration: "They hold their ground." }, "picked by nobody, they run");
  const f = fakeFetch({ sides: { moll: "with_player" } });
  const faked = await combatMove(clerk, yard(), view, { calls: { fetch: f.fetch, apiKey: "fake" }, byKey });
  assert.deepEqual(faked.move.kind === "sides" && faked.move.sides, { moll: "with_player", porters: "flee" }, "the fake picks its options', else they run");
});

test("who ran from the fight, for the GM: gone from here, or keeping clear of it close by (one the story needs), never to be narrated leaving", () => {
  const view = yard();
  view.world!.entities.moll!.states = ["cowering"];
  const note = fightNote(view, fight("cob", { state: { ...fight("cob").state, fled: ["moll"] } }));
  assert.match(note, /\nOut of the fight: Moll \[moll\] is keeping clear of it, close by \(backing off, hiding, never leaving: they're here when it's over\)\./);
  view.world!.entities.moll!.states = ["gone"];
  assert.match(fightNote(view, fight("cob", { state: { ...fight("cob").state, fled: ["moll"] } })), /\nOut of the fight: Moll \[moll\] ran off and is gone from here\./);
  assert.doesNotMatch(fightNote(yard(), fight("cob")), /Out of the fight/);
});

test("roll_for_initiative's sides: a group's members and the world's people and creatures with no card are in it by id or name, and whoever runs is on neither side", () => {
  const heron = effectiveScene(loadScene(readFileSync(join(CAERWYN, "scenes", "heron-warehouse.kmscene"), "utf8")), []);
  const view = viewAt(heron, "midnight", { turn: 9, reached: ["wharf", "midnight"] });
  view.world!.entities.duchess = { id: "duchess", name: "Duchess", kind: "creature", parent: view.world!.root, tags: [], states: ["asleep"], notes: [] };
  assert.deepEqual(fightOf(heron, view, { foes: ["sallow", "the first Crake", "crake-2", "Duchess"], allies: ["Kell"], flee: ["the lantern-boy", "scrope", "sallow"], why: "blades out" }),
    { foes: ["sallow", "crake-1", "crake-2", "duchess"], allies: ["kell"], flee: ["lantern-boy", "scrope"], why: "blades out" }, "Sallow can't be both");
  assert.deepEqual(fightOf(heron, view, { foes: [], allies: [], flee: [], why: "blades out" }), { foes: [], allies: [], why: "blades out" }, "the prep's fight on offer has its own line-up: none named is still a fight");
  const before = viewAt(heron, "wharf", { turn: 2 });
  assert.equal(fightOf(heron, before, { foes: [], allies: [], why: "a scuffle" }), undefined, "with no fight of the prep's on offer, a fight needs a foe");
});

test("a route into a fight says who fights in it, for the mouthpiece and the co-GM (the Heron's blades out)", () => {
  const heron = effectiveScene(loadScene(readFileSync(join(CAERWYN, "scenes", "heron-warehouse.kmscene"), "utf8")), []);
  const cornered = heron.routes.find(r => r.id === "cornered")!;
  assert.match(routeLine(heron, cornered), /It's a fight \(roll for initiative\): Master Josiah Sallow \[sallow\], the first Crake \[crake-1\], the second Crake \[crake-2\] against the player, Sergeant Agnes Kell \[kell\] beside them\./);
  const now = twoPartNow(heron, viewAt(heron, "midnight", { turn: 9, reached: ["wharf", "midnight"] }), []);
  assert.match(now, /- \[attack\] from The Master comes \[midnight\] to Blades out \[fight\]\. When: .*It's a fight \(roll for initiative\): Master Josiah Sallow/);
});

test("the reactions to the player's violence: whoever the story needs here isn't offered leaving the place, and one decided gone anyway cowers (QA round hobo1-1018: Scrope fled the Heron with the true book at the first blow)", async () => {
  const witnesses = [{ id: "cob", name: "Cob", about: "" }, { id: "moll", name: "Moll", about: "" }, { id: "kell", name: "Kell", about: "" }];
  const act = { what: "hit Cob", victims: ["cob"], property: [] };
  // What it's asked: the ones who stay aren't offered leaving (the fake keeps to what's offered).
  const f = fakeFetch({ choices: { react_cob: "cower", react_moll: "raise_alarm", react_kell: "intervene" } });
  const offered = await decideReactions(director({ fetch: f.fetch, apiKey: "fake" }), clerk, yard(), "I hit Cob.", act, witnesses, id => id, new Set(["cob", "kell"]));
  assert.deepEqual(offered.reactions, { cob: "cower", moll: "raise_alarm", kell: "intervene" });
  const asked = f.sent.find(b => b.questions) as unknown as { questions: Record<string, { instructions: string; criteria: Record<string, string> }> };
  assert.deepEqual(["flee" in asked.questions.react_cob!.criteria, "raise_alarm" in asked.questions.react_kell!.criteria, "flee" in asked.questions.react_moll!.criteria], [false, false, true]);
  assert.match(asked.questions.react_cob!.instructions, /Cob stays in this place, whatever happens: hiding, cowering or stepping in, never leaving it\./);
  // A decider that sends them off anyway: they cower.
  const anyway = { name: "stub", decide: async () => ({ answers: { react_cob: { choice: "flee" }, react_moll: { choice: "raise_alarm" }, react_kell: { choice: "raise_alarm" } }, latencyMs: 0, costUsd: 0, decider: "stub" }) } as unknown as Parameters<typeof decideReactions>[0];
  const sent = await decideReactions(anyway, clerk, yard(), "I hit Cob.", act, witnesses, id => id, new Set(["cob", "kell"]));
  assert.deepEqual(sent.reactions, { cob: "cower", moll: "raise_alarm", kell: "cower" });
});

test("the fake mouthpiece rolls for initiative on its cue: the reply has the fight, and no check", async () => {
  const f = fakeFetch({ replies: ["Cob drops the stone and comes at you."], mouthpiece: { check: { skill: "insight", dc: 12 }, fight: { on: "hit cob", foes: ["cob"], allies: ["kell"] } } });
  const spoke = await speak(clerk, yard(), [], { operation: "two-part.reply", calls: { fetch: f.fetch, apiKey: "fake" }, byKey });
  assert.deepEqual(spoke.initiative, { foes: ["cob"], allies: ["kell"], why: "a fight breaks out" });
  assert.equal(spoke.check, undefined);
  assert.match(spoke.narration.text, /Roll for initiative!$/);
});
