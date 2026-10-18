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
import { fightOf, speak } from "./two-part.ts";
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
  assert.match(note, /- You, the player character \[player\], initiative 12: .*◀ their turn now/);
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
  assert.match(corrections, /Cob can attack with their weapon, move, flee, surrender or do something else \(other\)/);
  assert.match(corrections, /Cob's attack is at someone in the fight/);
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

test("the fake mouthpiece rolls for initiative on its cue: the reply has the fight, and no check", async () => {
  const f = fakeFetch({ replies: ["Cob drops the stone and comes at you."], mouthpiece: { check: { skill: "insight", dc: 12 }, fight: { on: "hit cob", foes: ["cob"], allies: ["kell"] } } });
  const spoke = await speak(clerk, yard(), [], { operation: "two-part.reply", calls: { fetch: f.fetch, apiKey: "fake" }, byKey });
  assert.deepEqual(spoke.initiative, { foes: ["cob"], allies: ["kell"], why: "a fight breaks out" });
  assert.equal(spoke.check, undefined);
  assert.match(spoke.narration.text, /Roll for initiative!$/);
});
