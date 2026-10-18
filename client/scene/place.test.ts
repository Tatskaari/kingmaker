import assert from "node:assert/strict";
import { test } from "node:test";
import { rowsToWorld, type PlaceRows } from "../../shared/world/rows.ts";
import { damageThing, type SceneWorld } from "../../shared/world/scene-world.ts";
import { WIZARD_SPELLS, yardKeys, yardPlaceRows, yardTables, yardWorld } from "../check/place.ts";
import { DEED_WAITS, SceneModel } from "./model.ts";
import { PlaceModel } from "./place.ts";
import type { PlaceTables } from "./place-rows.ts";
import { sceneViewOf, type SceneRows } from "./rows.ts";
import type { SceneView } from "./view.ts";

/**
 * The scene's place from rows (the world bridge's §3.5): the place's tables make the world the
 * simulation rebuilds, the lead's character as "player"; the PlaceModel primes its director on the
 * first world it sees, and then plays what the rows bring: the rules' lines (a missile from the lead
 * to the rope, its damage floated) and the changed world (the rope broken, Prout fallen), a reply's
 * line over its speaker's head, someone walking. And the scene's model words the place's menu as the
 * lead knows things, offers deeds only while they can go, and keeps glances as quiet notes.
 */

type Entry = SceneRows["transcript"][number];

/** The yard's rows with its place (check/place.ts): Pell Marrow (player 1) has the lead; Kell, Cob and Moll on stage by the names Pell knows. */
const rowsWith = (tables: PlaceTables, more: Entry[] = [], sheet?: SceneRows["sheets"][number]) => yardPlaceRows(tables, more, sheet);

const roll = (turn: number, text: string): Entry => ({ seq: 0, turn, speaker: "dice", kind: "roll", text, markup: undefined });

/** A turn the rules played on the world as the simulation would: the world rebuilt from its rows, changed, and written back over them. */
function played(rows: PlaceRows, change: (world: SceneWorld) => void): { tables: PlaceTables; rows: PlaceRows } {
  const world = rowsToWorld(rows, yardKeys());
  change(world);
  return yardTables(world, rows);
}

/** A PlaceModel on a clock the test moves, and what its effects were asked to play once primed. */
function watched(first: SceneView) {
  let now = 1000;
  const place = new PlaceModel(() => now);
  place.update(first);
  const fx = place.look!.fx;
  const effects: Array<{ kind: string; from?: unknown; to?: unknown; at?: unknown }> = [];
  const floats: string[] = [];
  const barks: string[] = [];
  const effect = fx.effect.bind(fx), float = fx.float.bind(fx), bark = fx.bark.bind(fx);
  fx.effect = (kind, opts = {}, when) => { effects.push({ kind, ...(opts.from ? { from: opts.from } : {}), ...(opts.to ? { to: opts.to } : {}), ...(opts.at ? { at: opts.at } : {}) }); return effect(kind, opts, when); };
  fx.float = (at, text, opts = {}, when) => { floats.push(`${text}${opts.damage ? ` ${opts.damage}` : ""}`); float(at, text, opts, when); };
  fx.bark = (id, text, opts = {}, when) => { barks.push(`${id}: ${text}`); bark(id, text, opts, when); };
  return { place, effects, floats, barks, at: (t: number) => { now = t; } };
}

test("the place's rows make the world the simulation rebuilds: the lead's character as the player, the cast by the names the lead knows, their spells", () => {
  const { tables } = yardTables(yardWorld());
  const view = sceneViewOf(rowsWith(tables));
  const world = view.place!.world;

  assert.equal(world.scene, "hanged-clerk");
  assert.deepEqual(Object.keys(world.entities), Object.keys(yardWorld().entities), "every entity, in order, by the ids the prototype's world has");
  assert.equal(world.entities.player?.name, "Pell Marrow");
  assert.equal(world.entities.prout?.parent, "hoist-rope");
  assert.deepEqual(world.entities.prout?.states, ["hanging"]);
  assert.equal(world.entities.gate?.description, undefined, "no GM's descriptions: gm_note is the module's");
  assert.deepEqual(view.place!.unnamed, { cob: "the boy in the too-big boots", moll: "the girl in the shawl" });
  assert.equal(view.place!.time, "morning");
  assert.deepEqual(view.place!.spells.map(s => s.id), WIZARD_SPELLS.map(s => s.id));
  assert.equal(view.place!.spells.find(s => s.id === "burning-hands")?.area, true, "with the sheet's spellFacts, what the rules say of each");

  // A sheet without the rules' facts (spellFacts "", as on a sheet from before the column): the spells by name alone.
  const bare = sceneViewOf(rowsWith(tables, [], { playerId: 1n, statusLine: "HP 20/20", spells: [{ id: "fire-bolt", name: "Fire Bolt", level: 0 }] }));
  assert.deepEqual(bare.place!.spells, [{ id: "fire-bolt", name: "Fire Bolt", level: 0 }]);
  // No place rows (they haven't come): no place, and the side panel lists who's here instead.
  assert.equal(sceneViewOf({ ...rowsWith(tables), place: undefined }).place, undefined);
});

test("primed on the first world it sees: what's there, and what was said before, isn't news", () => {
  const { tables } = yardTables(yardWorld());
  const { place, effects, floats, barks } = watched(sceneViewOf(rowsWith(tables)));
  place.update(sceneViewOf(rowsWith(tables)));
  assert.deepEqual([effects, floats, barks], [[], [], []]);
  assert.equal(place.look!.fx.busy(1000), false);
});

test("the rules' lines and the world they changed: Magic Missile's three darts from the lead to the rope, its damage floated, the rope broken and Prout fallen", () => {
  const first = yardTables(yardWorld());
  const { place, effects, floats, at } = watched(sceneViewOf(rowsWith(first.tables)));
  const world0 = sceneViewOf(rowsWith(first.tables)).place!.world;

  // The decide commit: the dice rows and the world written together, as the simulation's rules write them.
  let broke: string[] = [];
  const after = played(first.rows, world => { broke = damageThing(world, world.entities["hoist-rope"]!, 9, "force", 1); });
  assert.deepEqual(broke, ["The hoist rope takes 9 force damage and is destroyed"]);
  const lines = ["Cast Magic Missile (1st-level slot) on the hoist rope", "3 darts at the hoist rope: 9 force", ...broke, "Pell Marrow: HP 20/20, spell slots 1st 3/4, 2nd 2/2"];
  at(5000);
  place.update(sceneViewOf(rowsWith(after.tables, lines.map(l => roll(1, l)))));

  const bolts = effects.filter(e => e.kind === "bolt");
  assert.equal(bolts.length, 3, "Magic Missile is three darts");
  assert.ok(bolts.every(b => JSON.stringify(b.from) === JSON.stringify(world0.entities.player!.at) && !!b.to), "each from the lead, to the rope");
  assert.deepEqual(floats, ["9 force"], "the damage floated once, by the line's type (observe doesn't float it again)");
  assert.ok(effects.some(e => e.kind === "debris"), `the rope breaks (${effects.map(e => e.kind).join(", ")})`);
  assert.ok(effects.some(e => e.kind === "poof"), "Prout falls");
  // The body slides from where it hung to where it fell.
  const fell = place.world!.entities.prout!;
  assert.deepEqual(fell.states, ["fallen"]);
  const mid = place.positionAt("prout", 5000 + 200);
  assert.ok(mid && (mid.x !== fell.at!.x || mid.y !== fell.at!.y), "mid-slide, not yet where it fell");
});

test("a reply's short spoken line goes over its speaker's head; someone who walked is drawn on the way", () => {
  const first = yardTables(yardWorld());
  const { place, barks, at } = watched(sceneViewOf(rowsWith(first.tables)));
  const text = "Kell looks up. “The porters found him.” She shrugs.";
  const start = text.indexOf("“"), end = text.indexOf("”") + 1;
  const reply: Entry = { seq: 0, turn: 1, speaker: "gm", kind: "narration", text, markup: JSON.stringify({ speech: [{ start, end, speaker: "kell" }] }) };
  at(2000);
  place.update(sceneViewOf(rowsWith(first.tables, [reply])));
  assert.deepEqual(barks, ["kell: The porters found him."]);

  // The settle: the stage manager moved Cob up the yard.
  const moved = played(first.rows, world => { world.entities.cob!.at = { x: 6, y: 14 }; });
  const from = place.world!.entities.cob!.at!;
  at(3000);
  place.update(sceneViewOf(rowsWith(moved.tables, [reply])));
  const mid = place.positionAt("cob", 3000 + 300)!;
  assert.ok(mid.x > Math.min(from.x, 6) && mid.x < Math.max(from.x, 6) || mid.y > Math.min(from.y, 14) && mid.y < Math.max(from.y, 14), `Cob mid-walk (${JSON.stringify(mid)})`);
  assert.equal(place.positionAt("cob", 3000 + 60_000), undefined, "and then where the world has him");
});

test("the menu, as the scene's model words it: the lead's names and spells; deeds only while they can go; glances kept as quiet notes", () => {
  const { tables } = yardTables(yardWorld());
  const said: string[] = [];
  const view = sceneViewOf(rowsWith(tables));
  const scene = new SceneModel(view, { say: text => said.push(text), retry: () => {}, setSuggestions: async () => undefined, out: () => {}, quit: () => {} });

  // Cob, by what Pell calls him: talk first, a glance, a deed, a spell that fits, a blow last.
  scene.openSceneMenu({ id: "cob" }, 10, 5);
  const menu = scene.sceneMenu!;
  assert.equal(menu.title, "The boy in the too-big boots");
  assert.deepEqual(menu.actions.map(a => a.id), ["talk", "look", "examine", "give", "go", "cast", "attack"]);
  assert.equal(menu.actions[0]!.start, "Boy, ");
  assert.deepEqual(menu.actions.find(a => a.id === "cast")!.choices!.map(c => c.label), ["Fire Bolt (cantrip)", "Ray of Frost (cantrip)", "Burning Hands (level 1)", "Magic Missile (level 1)", "Sleep (level 1)", "Thunderwave (level 1)", "Scorching Ray (level 2)"]);
  // The rope Prout hangs from: cut it; a spell at it.
  scene.openSceneMenu({ id: "hoist-rope" }, 10, 5);
  assert.ok(scene.sceneMenu!.actions.some(a => a.id === "cut" && a.line === "(I cut the hoist rope)"));
  scene.closeSceneMenu();
  assert.equal(scene.sceneMenu, undefined);

  // A deed goes as the lead's line; while the GM has the floor it's refused in the prototype's words, and offered no more.
  scene.deed("(I cut the hoist rope)");
  assert.deepEqual(said, ["(I cut the hoist rope)"]);
  scene.update({ ...view, phase: "deciding", mayType: false });
  assert.equal(scene.sceneContext().busy, true);
  scene.deed("(I pick up Prout's satchel)");
  assert.equal(scene.status, DEED_WAITS);
  assert.equal(said.length, 1);
  scene.openSceneMenu({ id: "satchel" }, 10, 5);
  assert.deepEqual(scene.sceneMenu!.actions.map(a => a.id), ["look"], "while the GM has the floor, only looking");
  // A spectator only looks (the lead's deeds are the lead's), and talks to no one.
  scene.update({ ...view, watching: "Pell Marrow", mayType: false });
  assert.equal(scene.sceneContext().over, true);
  scene.openSceneMenu({ id: "kell" }, 10, 5);
  assert.deepEqual(scene.sceneMenu!.actions.map(a => a.id), ["look"]);

  // A glance: a quiet note after what's been said, the same one twice running noted once; the GM never hears it.
  scene.update(view);
  const before = scene.lines().length;
  scene.lookNote("Wendell Prout's body, hanging: hanging from the hoist rope. About 20 feet away.");
  scene.lookNote("Wendell Prout's body, hanging: hanging from the hoist rope. About 20 feet away.");
  const lines = scene.lines();
  assert.equal(lines.length, before + 1);
  assert.equal(lines.at(-1)!.kind, "look");
  // A reply that comes after it goes after it; the marks the lines are known by stay where they were.
  const reply: Entry = { seq: 0, turn: 2, speaker: "gm", kind: "narration", text: "Kell nods.", markup: undefined };
  scene.update(sceneViewOf(rowsWith(tables, [reply])));
  assert.deepEqual(scene.lines().slice(-2).map(l => l.kind), ["look", "narration"]);
  assert.equal(said.length, 1);
});
