import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { initialGm } from "../gm/state.ts";
import type { SceneDocument } from "../scene/document.ts";
import type { BuildsFile } from "../scene/files.ts";
import { presentCast } from "../scene/graph.ts";
import { sceneOf } from "../scene/load.ts";
import { blowBetween, rollInitiative, standings, standUp } from "./acts.ts";
import { close, createCharacter } from "./character.ts";
import { event, opened, rulesFrom } from "./engine.ts";
import { withEngine } from "./pin.ts";
import type { SceneSession } from "./types.ts";

/** A fight in the conversation's rules (docs/combat-gm.md): initiative, a blow between any two in the fight, and how they stand. */

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
const rules = rulesFrom(E, read("../../vendor/dnd-srd-engine/starter-pack.json"), read("../../vendor/srd-spells/spells.json"));
const BUILDS = read<BuildsFile>("../../campaigns/caerwyn/builds.json");
const scene = sceneOf(read<SceneDocument>("../../campaigns/caerwyn/scenes/hanged-clerk.kmscene"));
const T = Date.UTC(2026, 9, 16, 9, 30);
let pin = 100;
const pinned = <X>(f: () => X): X => withEngine({ seed: pin++, nowMs: T }, f);

function yard(seed = 7): SceneSession {
  const gm = initialGm(scene);
  const session: SceneSession = { id: "01JGAME0000000000000000000", seed, rollCount: 0, turn: 1, player: { name: "Wren Ashdown", concept: BUILDS.fighter!.concept, modifiers: {} }, beat: gm.beat, path: gm.path, entered: gm.entered, absent: gm.absent };
  withEngine({ seed: 1, nowMs: T }, () => createCharacter(rules, session, 3, BUILDS.fighter!.build));
  return session;
}
const who = (s: SceneSession, id: string) => presentCast(scene, s).find(c => c.id === id)!;

test("initiative: everyone in the fight rolls once, highest first, a line each", () => {
  const s = yard();
  const out = pinned(() => rollInitiative(rules, s, ["player", who(s, "cob"), who(s, "kell")]));
  assert.deepEqual(new Set(out.rolls.map(r => r.id)), new Set(["player", "cob", "kell"]));
  for (let i = 1; i < out.rolls.length; i++) assert.ok(out.rolls[i - 1]!.total >= out.rolls[i]!.total);
  for (const r of out.rolls) assert.ok(r.roll >= 1 && r.roll <= 20 && r.total === r.roll + r.modifier);
  assert.equal(out.lines.length, 3);
  assert.match(out.lines.join("\n"), /Initiative: You: \d+ [+-]\d+ = -?\d+/);
  // Cob became someone the rules keep.
  assert.ok(s.rules!.npcs.cob);
});

test("a blow between two of the cast (Kell at Cob), and one of theirs at the player, each with its dice and account", () => {
  const s = yard();
  const cobAtYou = pinned(() => blowBetween(rules, s, who(s, "cob"), "player"));
  assert.match(cobAtYou.lines[0]!, /Cob's attack on you/);
  assert.ok(cobAtYou.status);
  const kellAtCob = pinned(() => blowBetween(rules, s, who(s, "kell"), who(s, "cob")));
  assert.match(kellAtCob.lines[0]!, /attack on Cob/);
  assert.match(kellAtCob.directive, /Kell (hit|missed|landed a critical hit on) Cob/);
});

test("getting up off the ground (QA round hobo1-1018: the narration stood a prone player up five times and the rules never did): prone in the standings, then not; one on their feet already gets up from nothing", () => {
  const s = yard();
  pinned(() => {
    const ctx = opened(rules, s);
    ctx.apply([event(ctx.E, "ConditionApplied", { targetId: s.rules!.pc, conditionId: "prone", appliedConditionId: ctx.E.newEventId() })]);
    close(rules, s, ctx);
  });
  assert.deepEqual(pinned(() => standings(rules, s, ["player"]))[0]!.conditions, ["prone"]);
  assert.equal(pinned(() => standUp(rules, s, "player")), true, "they were down");
  assert.equal(pinned(() => standings(rules, s, ["player"]))[0]!.conditions, undefined, "and they're up");
  assert.equal(pinned(() => standUp(rules, s, "player")), false, "already up");
  assert.equal(pinned(() => standUp(rules, s, who(s, "cob"))), false);
});

test("standings: hit points, AC and the word for each, after the blows land", () => {
  const s = yard();
  for (let i = 0; i < 12; i++) pinned(() => blowBetween(rules, s, who(s, "kell"), who(s, "cob")));
  const [cob, you] = pinned(() => standings(rules, s, [who(s, "cob"), "player"]));
  assert.equal(cob!.id, "cob");
  assert.ok(cob!.hp < cob!.max, "a dozen of Kell's blows hurt Cob");
  assert.ok(["hurt", "badly hurt", "down"].includes(cob!.hurt));
  assert.equal(you!.id, "player");
  assert.equal(you!.hurt, "unhurt");
  assert.ok(you!.ac >= 10);
});
