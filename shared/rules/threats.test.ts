// Copied from the prototype's src/runtime/threats.test.ts at 44c6d4a, its first four tests: on the hanged clerk's granary yard with builds.json's builds (the prototype's pregens, made by createCharacter), Sergeant Kell's club where the Heron's Sallow swung, each call synchronous on the host's Rules and pinned. Its last test plays a whole turn (the prototype's playerTurn), the simulation's decide commit here: a Shield the blow forestalled isn't cast again (S's takeAct).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { initialGm } from "../gm/state.ts";
import type { BuildsFile, PlaceFile, SceneFile } from "../scene/files.ts";
import { presentCast } from "../scene/graph.ts";
import { sceneOf } from "../scene/load.ts";
import { buildWorld, joinWorld } from "../world/scene-world.ts";
import { castSpell } from "./acts.ts";
import { createCharacter } from "./character.ts";
import { rulesFrom } from "./engine.ts";
import { withEngine } from "./pin.ts";
import { comeRound, givesIn, holdAfterReply, landThreat } from "./threats.ts";
import type { SceneSession } from "./types.ts";

/**
 * What the last reply left hanging over the player, as it lands at the start of their turn: a grab
 * is resisted once and never when they give in (goals#64: a Crake's hold forced a Strength save
 * every turn for ten turns, the turn after "I stop struggling" too); a Shield goes up before the
 * blow it answers, and a player knocked down comes round, conscious at 1 HP, as the GM was told
 * (wizard#21). Offline: the rules engine's own dice, seeded.
 */

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
const rules = rulesFrom(E, read("../../vendor/dnd-srd-engine/starter-pack.json"), read("../../vendor/srd-spells/spells.json"));
const BUILDS = read<BuildsFile>("../../campaigns/caerwyn/builds.json");
const yard = sceneOf(read<SceneFile>("../../campaigns/caerwyn/scenes/hanged-clerk/scene.json"));
const T = Date.UTC(2026, 9, 16, 9, 30);
let pin = 1;
const pinned = <X>(f: () => X): X => withEngine({ seed: pin++, nowMs: T }, f);

const at = (pregen: string, seed = 5): SceneSession => {
  const gm = initialGm(yard);
  const state: SceneSession = { id: `pregen-${pregen}-${seed}`, seed, rollCount: 0, turn: 0, player: { name: "Wren Ashdown", concept: BUILDS[pregen]!.concept, modifiers: {} }, beat: gm.beat, path: gm.path, entered: gm.entered, absent: gm.absent };
  pinned(() => createCharacter(rules, state, 3, BUILDS[pregen]!.build));
  const present = presentCast(yard, state).map(c => ({ id: c.id, name: c.name }));
  state.world = buildWorld(yard.id, read<PlaceFile>("../../campaigns/caerwyn/places/granary-yard.json"), present, state.player);
  joinWorld(state.world, present, 0);
  return state;
};
const grab = (state: SceneSession) => { state.threat = { kind: "hazard", hazard: "grab_or_shove", severity: "serious", turn: state.turn }; };

test("giving in, in the player's words: no struggle, going quietly, letting them take you (and not its opposite)", () => {
  for (const said of ["(I stop struggling and let them take me to the river door.)", "I go quietly.", "I don't resist.", "Fine. I surrender.", "I let the Crake drag me out.", "I let myself be led to the door", "Hands up, I go with them."]) assert.ok(givesIn(said), said);
  for (const said of ["I won't stop struggling!", "I refuse to go quietly", "I twist free of his grip", "I give up the ledger to Kell", "I submit the ledger to the sergeant", "I let the book fall", "I go along the wall to the door"]) assert.ok(!givesIn(said), said);
});

test("a hold is resisted once: a save when it catches them, none while it has them, none at all when they give in (goals#64)", () => {
  const state = at("rogue");
  // The grab catches them: a Strength save, and a failure leaves them held.
  let held: number | undefined;
  for (let n = 0; n < 12 && held === undefined; n++) {
    state.turn++;
    grab(state);
    const landed = pinned(() => landThreat(rules, yard, state, "I carry letters for a living, sir."));
    assert.match(landed!.lines.join("\n"), /Your Strength save: .* (saved|failed)/);
    assert.equal(state.held !== undefined, landed!.saved === false);
    held = state.held;
  }
  assert.ok(held !== undefined, "some grab caught them");
  // While the reply has them held, later grabs roll nothing: the hold stands.
  holdAfterReply(state, "hazard:grab_or_shove");
  state.turn++;
  grab(state);
  const still = pinned(() => landThreat(rules, yard, state, "Sergeant, the book is in Sallow's hand."));
  assert.deepEqual(still!.lines, []);
  assert.match(still!.directive, /no new saving throw against the hold on the player: it still has them/);
  // The reply lets them go: the next grab is a new one.
  holdAfterReply(state, "none");
  assert.equal(state.held, undefined);
  // Giving in to a new grab takes no roll: they're held, as the story has it.
  state.turn++;
  grab(state);
  const given = pinned(() => landThreat(rules, yard, state, "(I stop struggling and let them take me to the river door.)"));
  assert.deepEqual(given!.lines, []);
  assert.match(given!.directive, /doesn't resist .* no saving throw/);
  assert.equal(state.held, state.turn);
  // Other dangers are saved against as ever, held or not.
  state.threat = { kind: "hazard", hazard: "fire", severity: "glancing", turn: state.turn };
  assert.match(pinned(() => landThreat(rules, yard, state, "I let them take me"))!.lines.join("\n"), /Your Dexterity save/);
});

test("Shield goes up before the blow it answers: +5 AC against it and a slot spent, and the turn doesn't cast it again (wizard#21)", () => {
  const state = at("wizard");
  state.threat = { kind: "attack", by: "kell", turn: 0 };
  const landed = pinned(() => landThreat(rules, yard, state, "As the club comes down I snap up a hand and speak the word for Shield!"))!;
  assert.match(landed.lines[0]!, /^Cast Shield \(1st-level slot\): \+5 AC against the blow/);
  assert.match(landed.lines[1]!, /attack on you: .* vs AC 17: (hit|miss|critical hit!)/, "the wizard's AC 12, and 5 for the Shield");
  assert.equal(landed.shielded, true);
  assert.match(state.rules!.status!, /1st 3\/4/);
  assert.match(landed.directive, /Shield went up first/);
  // Without it, the blow is against their AC as it is.
  state.threat = { kind: "attack", by: "kell", turn: 0 };
  const bare = pinned(() => landThreat(rules, yard, state, "I back away from the club."))!;
  assert.match(bare.lines[0]!, /vs AC 12/);
  assert.equal(bare.shielded, undefined);
});

test("down is down, then up: knocked to 0 HP they can't act that turn, and come round at 1 HP as their next turn begins (wizard#21)", () => {
  const state = at("wizard", 11);
  let down;
  for (let n = 0; n < 30 && !down; n++) {
    state.threat = { kind: "attack", by: "kell", turn: n };
    const landed = pinned(() => landThreat(rules, yard, state, "I argue."));
    if (landed?.down) down = landed;
  }
  assert.ok(down, "Kell's blows put the wizard down");
  assert.match(state.rules!.status!, /^HP 0\//);
  assert.match(down.directive, /whatever they meant to do this turn doesn't happen.*come to, with 1 hit point/);
  // Their next turn: they come round first, and the rules have them conscious, at 1 HP.
  const up = pinned(() => comeRound(rules, state))!;
  assert.match(up.lines[0]!, /^You come to: HP 1\//);
  assert.match(up.directive, /conscious at 1 hit point/);
  assert.equal(pinned(() => comeRound(rules, state)), undefined, "only once");
  const bolt = pinned(() => castSpell(rules, state, [], "fire-bolt", []));
  assert.doesNotMatch(bolt.lines.join("\n"), /Unconscious/);
});
