import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { initialGm } from "../gm/state.ts";
import type { SceneDocument } from "../scene/document.ts";
import type { BuildsFile, PlaceFile } from "../scene/files.ts";
import { loadPlace } from "../scene/scenario.ts";
import { presentCast } from "../scene/graph.ts";
import { sceneOf } from "../scene/load.ts";
import { buildWorld, joinWorld, tick } from "../world/scene-world.ts";
import { ignite } from "../world/systems.ts";
import { castSpell, levelUp, passTime, rest, spellFactsOf } from "./acts.ts";
import { createCharacter, sheetRows } from "./character.ts";
import { rulesFrom } from "./engine.ts";
import { withEngine } from "./pin.ts";
import { leap, moveToAct, react, violence } from "./scene-acts.ts";
import { landThreat } from "./threats.ts";
import type { Rules, SceneSession } from "./types.ts";

/**
 * The world bridge's rules on the hanged clerk's granary yard (world-bridge-design §4 R), with
 * builds.json's wizard, each act pinned as the simulation pins it: a spell at a thing breaks it and
 * what hung from it falls, fire catches and spreads, someone struck becomes an NPC the rules keep,
 * the reactions take effect and a blow left hanging lands, time, rests, levels and jumps; and every
 * act a pure function of what the rows hold, on an isolate that kept the campaign or a fresh one.
 */

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
const rules = rulesFrom(E, read("../../vendor/dnd-srd-engine/starter-pack.json"), read("../../vendor/srd-spells/spells.json"));
const BUILDS = read<BuildsFile>("../../campaigns/caerwyn/builds.json");
const scene = sceneOf(read<SceneDocument>("../../campaigns/caerwyn/scenes/hanged-clerk.kmscene"));
/** The yard's place file, read afresh: a world built from it shares its arrays (a thing's states), and the acts change them in place. */
const place = (): PlaceFile => loadPlace(readFileSync(new URL("../../campaigns/caerwyn/places/granary-yard.kmplace", import.meta.url), "utf8"));
const T = Date.UTC(2026, 9, 16, 9, 30);

let pin = 100;
/** One call to the rules, pinned as a commit pins it. */
const pinned = <X>(f: () => X): X => withEngine({ seed: pin++, nowMs: T }, f);

/** The yard as the scene opens, the ready-made build in it (the simulation's session: the rows' character, the place's world, the scene's bookkeeping). */
function yard(build = "wizard", seed = 7, isolate: Rules = rules): SceneSession {
  const gm = initialGm(scene);
  const session: SceneSession = { id: "01JGAME0000000000000000000", seed, rollCount: 0, turn: 1, player: { name: "Wren Ashdown", concept: BUILDS[build]!.concept, modifiers: {} }, beat: gm.beat, path: gm.path, entered: gm.entered, absent: gm.absent };
  withEngine({ seed: 1, nowMs: T }, () => createCharacter(isolate, session, 3, BUILDS[build]!.build));
  const present = presentCast(scene, session).map(c => ({ id: c.id, name: c.name }));
  session.world = buildWorld(scene.id, place(), present, session.player);
  joinWorld(session.world, present, 0);
  return session;
}
const cast = (s: SceneSession) => presentCast(scene, s);
const statesOf = (s: SceneSession) => Object.fromEntries(Object.values(s.world!.entities).map(e => [e.id, [...e.states]]));

test("Magic Missile at the hoist rope: three darts, the rope destroyed, Prout's body falls, a 1st-level slot spent", () => {
  const s = yard();
  const before = statesOf(s);
  const out = pinned(() => castSpell(rules, s, cast(s), "magic-missile", ["hoist-rope"]));
  assert.equal(out.lines[0], "Cast Magic Missile (1st-level slot) on the hoist rope");
  assert.match(out.lines[1]!, /^3 darts at the hoist rope: \d+ force$/);
  assert.match(out.lines[2]!, /^The hoist rope takes \d+ force damage and is destroyed$/);
  assert.equal(out.lines.at(-1), "Wren Ashdown: HP 20/20, spell slots 1st 3/4, 2nd 2/2");
  assert.match(out.directive, /^Rules: the player cast Magic Missile \(1st-level slot\) on the hoist rope\. The hoist rope takes \d+ force damage and is destroyed\. Narrate exactly this/);
  const world = s.world!;
  assert.ok(world.entities["hoist-rope"]!.states.includes("destroyed"));
  assert.deepEqual(world.entities.prout!.states, ["fallen"]);
  assert.equal(world.entities.prout!.parent, "yard", "on the cobbles, not on the rope");
  assert.ok(world.log.some(l => l.text === "Wendell Prout's body falls"));
  assert.equal(s.rules!.status, "HP 20/20, spell slots 1st 3/4, 2nd 2/2");
  // Breaking it where people are is something they react to.
  assert.deepEqual(violence(rules, scene, s, { kind: "cast", spell: "magic-missile", targets: ["hoist-rope"] }, before), { what: "cast Magic Missile setting the hoist rope burning or breaking it", victims: [], property: ["hoist-rope"] });
});

test("Burning Hands at the yard gate: a cone from the player catches the gate and the satchel by it, which take the fire and catch alight; then the fire burns on", () => {
  const s = yard();
  const out = pinned(() => castSpell(rules, s, cast(s), "burning-hands", ["gate"]));
  assert.equal(out.lines[0], "Cast Burning Hands (1st-level slot): a 15-foot cone towards the yard gate, catching the yard gate, Prout's satchel");
  assert.match(out.lines[1]!, /^Damage to things in it: 3d6 \(\d\+\d\+\d\) fire \(things don't dodge\)$/);
  assert.ok(out.lines.some(l => /^The yard gate takes \d+ fire damage/.test(l)));
  assert.ok(out.lines.includes("The yard gate catches fire"));
  assert.ok(s.world!.entities.gate!.states.includes("burning"));
  assert.match(s.rules!.status!, /1st 3\/4/);
  // The turn after, the world's tick (the rules first, at the turn's start): the gate burns on.
  const burned = tick(s.world!, 2, s.seed + 31337 * 2);
  assert.ok(burned.some(l => /^The yard gate takes \d+ fire damage/.test(l)), burned.join("\n"));
  assert.ok(burned.includes("Smoke rises from the yard gate"), burned.join("\n"));
});

test("the fire spreads on the world's tick: the burning gate sets Prout's satchel, five feet off, alight", () => {
  const s = yard();
  ignite(s.world!, s.world!.entities.gate!, 1);
  const burned = tick(s.world!, 2, s.seed + 31337 * 2);
  assert.ok(burned.includes("The fire spreads to Prout's satchel"), burned.join("\n"));
  assert.ok(s.world!.entities.satchel!.states.includes("burning"));
});

test("Fire Bolt at Kell makes her an NPC the rules keep (npcs), the same one the next time; Kell's state in the world follows her hit points", () => {
  const s = yard();
  const first = pinned(() => castSpell(rules, s, cast(s), "fire-bolt", ["kell"]));
  assert.equal(first.lines[0], "Cast Fire Bolt (cantrip) on Sergeant Agnes Kell");
  assert.match(first.lines[1]!, /^Fire Bolt: your attack on Sergeant Agnes Kell: \d+ \+5 = \d+ vs AC 16: (hit|miss|critical hit!)$/);
  const kell = s.rules!.npcs.kell!;
  assert.ok(kell?.id && kell.weapon, "Kell is in the rules: a guard, with her club");
  const engine = JSON.parse(s.rules!.campaign) as { events: Array<{ type: string; snapshot?: { id: string; statblockId?: string } }> };
  assert.equal(engine.events.find(e => e.type === "CharacterCreated" && e.snapshot?.id === kell.id)?.snapshot?.statblockId, "guard");
  // Again, until one lands: the same NPC each time, hurt as the dice say.
  for (let i = 0; i < 12 && !s.world!.entities.kell!.states.some(x => /hurt|down/.test(x)); i++) pinned(() => castSpell(rules, s, cast(s), "fire-bolt", ["kell"]));
  assert.deepEqual(s.rules!.npcs.kell, kell);
  assert.ok(s.world!.entities.kell!.states.some(x => /hurt|down/.test(x)), "a bolt landed, and the world shows it");
});

test("violence and the reactions: Cob flees (gone, absent), Moll cowers, and Kell would fight, but starts none in a scene; the prototype's way, parked for combat, starts the brawl, and her blow lands as the next turn starts", () => {
  const s = yard();
  const before = statesOf(s);
  pinned(() => castSpell(rules, s, cast(s), "fire-bolt", ["kell"]));
  const act = violence(rules, scene, s, { kind: "cast", spell: "fire-bolt", targets: ["kell"] }, before)!;
  assert.deepEqual(act, { what: "cast Fire Bolt at Sergeant Agnes Kell", victims: ["kell"], property: [] });
  react(scene, s, act, { kell: "fight", cob: "flee", moll: "cower" });
  assert.deepEqual(s.absent, ["cob"]);
  assert.ok(s.world!.entities.cob!.states.includes("gone"));
  assert.equal(s.world!.entities.cob!.notes.at(-1)?.text, "fled when the player cast Fire Bolt at Sergeant Agnes Kell");
  assert.ok(s.world!.entities.moll!.states.includes("cowering"));
  assert.deepEqual([s.brawl, s.threat], [undefined, undefined], "no fight starts in a scene: that's its routes' and the co-GM's");
  assert.deepEqual(cast(s).map(c => c.id), ["kell", "moll"], "Cob is off the stage");
  // Parked for combat: the prototype's way, a fight if anyone wants one.
  react(scene, s, act, { kell: "fight" }, { fights: true });
  assert.deepEqual(s.brawl, { turn: 1, cause: "cast Fire Bolt at Sergeant Agnes Kell", against: ["kell"], allies: [], fled: [] });
  assert.deepEqual(s.threat, { kind: "attack", by: "kell", turn: 1 });
  // The next turn: Kell's blow lands first, and the threat is taken off.
  s.turn = 2;
  const landed = pinned(() => landThreat(rules, scene, s, "I put my hands up."))!;
  assert.match(landed.lines[0]!, /^Club: Sergeant Agnes Kell's attack on you: \d+ \+3 = \d+ vs AC 12: (hit|miss|critical hit!)$/);
  assert.match(landed.directive, /^Rules, before the player's turn: Sergeant Agnes Kell's attack resolved\./);
  assert.equal(s.threat, undefined);
  // A blow or a grab at a person is violence too; cutting a rope isn't.
  assert.equal(violence(rules, scene, s, { kind: "attack", target: "moll" }, statesOf(s))?.what, "attacked Moll");
  assert.equal(violence(rules, scene, s, { kind: "attack", target: "hoist-rope" }, statesOf(s)), undefined);
});

test("time, rests, levels and jumps: Sleep runs out a minute on, a short rest heals, a level is gained, a jump too far falls short", () => {
  const s = yard();
  pinned(() => castSpell(rules, s, cast(s), "sleep", ["cob"]));
  assert.equal(s.rules!.timed, true);
  assert.deepEqual(pinned(() => passTime(rules, s, 1)), ["Sleep has run out"]);
  assert.equal(s.rules!.timed, false);
  assert.deepEqual(pinned(() => passTime(rules, s, 1)), [], "nothing timed: no lines, and the dice don't roll");

  s.threat = { kind: "attack", by: "kell", turn: 1 };
  for (let i = 0; i < 20 && /^HP 20\//.test(s.rules!.status!); i++) { s.threat = { kind: "attack", by: "kell", turn: 1 }; pinned(() => landThreat(rules, scene, s, "I stand there.")); }
  assert.doesNotMatch(s.rules!.status!, /^HP 20\//, "Kell's club landed");
  const rested = pinned(() => rest(rules, s, "short"));
  assert.match(rested.lines[0]!, /^Short rest \(an hour\): HP \d+\/20, spell slots 1st 3\/4, 2nd 2\/2$/);
  assert.ok(rested.lines.slice(1).every(l => /^Hit Die: d6 \(\d\) \+2 = \d+ HP$/.test(l)) && rested.lines.length > 1, rested.lines.join("\n"));

  const level = pinned(() => levelUp(rules, s));
  assert.match(level[0]!, /^Level up! Wren Ashdown is now human wizard 4 \(Evoker\), sage background\. HP max 20 → 26\./);
  assert.match(sheetRows(rules, s).statusLine, /^HP \d+\/26, spell slots 1st 3\/4, 2nd 3\/3$/);

  const far = pinned(() => leap(rules, s, { kind: "jump", how: "long", runUp: false, feet: 12, drop: 0 }));
  assert.deepEqual(far.lines, ["Jump: a long jump of 12 ft (standing: 4 ft is easy): too far"]);
  assert.match(far.directive, /^Rules: the player jumped across: it was beyond them \(12 ft against a reach of 4 ft\), and they fall short\./);
  // To the gate: the world measures the jump (its distance, less the stride you land beside it).
  const near = pinned(() => leap(rules, s, { kind: "jump", how: "long", runUp: true, to: { near: "gate" }, feet: 20, drop: 0 }));
  assert.deepEqual(near.lines, ["Jump: a long jump of 5 ft (with a run-up: 8 ft is easy): made"]);
  assert.ok(Math.hypot(s.world!.entities.player!.at!.x - 12, s.world!.entities.player!.at!.y - 8) <= 6, "landed by the gate");
});

test("the rules' own no, and nothing spent: a spell not ready, a spell aimed at nothing anyone can make out, no slot left", () => {
  const s = yard();
  const fireball = pinned(() => castSpell(rules, s, cast(s), "fireball", ["elm"]));
  assert.deepEqual(fireball.lines, ["(Fireball isn't a spell Wren Ashdown has ready: /sheet shows what they have.)"]);
  assert.match(fireball.directive, /doesn't have ready \(Fireball\)\. It doesn't come/);
  const unclear = pinned(() => castSpell(rules, s, cast(s), "magic-missile", [], { unclear: true }));
  assert.deepEqual(unclear.lines, ["(Magic Missile: at what? Say what it's aimed at.)"]);
  assert.match(s.rules!.status!, /1st 4\/4/);
  for (let i = 0; i < 4; i++) pinned(() => castSpell(rules, s, cast(s), "magic-missile", ["elm"]));
  // A 1st-level spell goes on to a 2nd-level slot, then there are none.
  pinned(() => castSpell(rules, s, cast(s), "magic-missile", ["elm"]));
  pinned(() => castSpell(rules, s, cast(s), "magic-missile", ["elm"]));
  assert.deepEqual(pinned(() => castSpell(rules, s, cast(s), "magic-missile", ["elm"])).lines, ["(No spell slots left for Magic Missile: a long rest restores them.)"]);
});

test("moved first in the same turn: the player goes where they act from before the rules roll", () => {
  const s = yard();
  moveToAct(s, { near: "water-butt" }, "water-butt");
  const at = s.world!.entities.player!.at!;
  assert.ok(Math.hypot(at.x - 4, at.y - 36) <= 6, JSON.stringify(at));
});

test("sheetRows writes what the rules say of each spell ready (range, effects, area): what the scene's menu reads", () => {
  const s = yard();
  const facts = JSON.parse(sheetRows(rules, s).spellFacts) as ReturnType<typeof spellFactsOf>;
  assert.deepEqual(facts.map(f => f.id), s.rules!.spells!.map(sp => sp.id));
  assert.deepEqual(facts.find(f => f.id === "burning-hands"), { id: "burning-hands", name: "Burning Hands", level: 1, range: "Self (15-foot cone)", effects: ["save"], area: true });
  assert.deepEqual(facts.find(f => f.id === "light"), { id: "light", name: "Light", level: 0, range: "Touch", effects: [] });
  assert.deepEqual(spellFactsOf(rules, [{ id: "no-such-spell", name: "Nothing", level: 1 }]), [{ id: "no-such-spell", name: "Nothing", level: 1 }]);
});

test("an act is a pure function of the rows: on an isolate that kept the campaign, and on a fresh one each commit, the same lines, campaign and world", () => {
  /** The yard's acts, each in its own commit: on one isolate throughout (warm), or each on a new one (cold). */
  const play = (isolate: () => Rules) => {
    const s = yard("wizard", 5, rules);
    const out: string[] = [];
    let n = 0;
    const step = (f: (r: Rules) => unknown) => { n++; out.push(JSON.stringify(withEngine({ seed: 900 + n, nowMs: T }, () => f(isolate()))), s.rules!.campaign, JSON.stringify(s.world), JSON.stringify(s.rules!.npcs)); };
    step(r => castSpell(r, s, cast(s), "magic-missile", ["hoist-rope"]));
    step(r => castSpell(r, s, cast(s), "burning-hands", ["gate"]));
    step(r => castSpell(r, s, cast(s), "fire-bolt", ["kell"]));
    step(r => castSpell(r, s, cast(s), "fire-bolt", ["kell"]));
    step(() => tick(s.world!, 3, s.seed + 31337 * 3));
    step(r => { s.threat = { kind: "attack", by: "kell", turn: 3 }; return landThreat(r, scene, s, "I hold up my hands."); });
    step(r => castSpell(r, s, cast(s), "sleep", ["moll"]));
    step(r => passTime(r, s, 1));
    step(r => rest(r, s, "short"));
    step(r => levelUp(r, s));
    step(r => sheetRows(r, s));
    return out;
  };
  assert.deepEqual(play(() => rules), play(() => rulesFrom(E, rules.pack, rules.srd)));
});
