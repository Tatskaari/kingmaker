import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlace, placePath } from "../../shared/scene/scenario.ts";
import { applyOps, buildWorld, type SceneWorld, type WorldOp } from "../../shared/world/scene-world.ts";
import { inSight } from "./sight.ts";

/**
 * What the player can see of the place (sight.ts), on the campaign's own places as their scenes'
 * worlds open: QA round qa3-1018's testers read the hidden things and the shut rooms off the QA map.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");

/** A place of the campaign's as its scene opens, everyone its file places there present. */
function worldOf(scene: string, place: string): SceneWorld {
  const spec = loadPlace(readFileSync(join(CAERWYN, placePath(place)), "utf8"), placePath(place));
  const people = Object.keys(spec.people).filter(id => id !== "player").map(id => ({ id, name: id }));
  return buildWorld(scene, spec, people, { name: "Nell Fitch" });
}

/** What the headless map would list: whatever stands somewhere, in the player's sight. */
const listed = (world: SceneWorld, said = "") => Object.values(world.entities).filter(e => e.at && e.kind !== "area" && e.kind !== "place" && inSight(world, said)(e)).map(e => e.id);

const op = (o: Partial<WorldOp> & Pick<WorldOp, "op" | "what">): WorldOp => ({ to: "", how: "", name: "", kind: "", text: "", add: [], remove: [], ...o });

test("in the yard: the yard and the lane over its wall, not the shut loft, and the loose board only once the narration has found it", () => {
  const yard = worldOf("hanged-clerk", "granary-yard");
  const seen = listed(yard);
  for (const id of ["player", "kell", "cob", "moll", "gate", "satchel", "water-butt", "loft-door", "hoist-beam", "elm"]) assert.ok(seen.includes(id), `${id} in sight`);
  for (const id of ["cleat", "tally-desk", "smashed-lantern", "cobs-nest", "grain-stacks"]) assert.ok(!seen.includes(id), `${id}, behind the granary's wall, isn't`);
  assert.ok(!seen.includes("loose-board"), "a way in nobody has found is no thing on the map");
  assert.ok(listed(yard, "Behind it, one board sits a little proud of the others.").includes("loose-board"), "once the narration has it, it is");

  const boots = yard.entities.boots!, page = yard.entities["ledger-page"]!;
  assert.deepEqual([inSight(yard, "")(boots), inSight(yard, "")(page)], [false, false], "what Cob carries is his, and the page is hidden in it");
});

test("in the loft: its things, and the yard only through the loft door once it's open", () => {
  const loft = worldOf("hanged-clerk", "granary-yard");
  applyOps(loft, [op({ op: "move", what: "player", to: "loft" })], 1);
  loft.entities.player!.at = { x: 42, y: 18 };
  assert.ok(["cleat", "tally-desk", "smashed-lantern", "cobs-nest"].every(id => listed(loft).includes(id)));
  assert.ok(!listed(loft).includes("satchel"), "the yard is behind the wall");
  applyOps(loft, [op({ op: "state", what: "loft-door", remove: ["closed", "barred"], add: ["open"] })], 2);
  assert.ok(listed(loft).includes("satchel"), "seen through the open loft door");
  assert.ok(!listed(loft).includes("water-butt"), "not what the doorway doesn't look on");
});

test("at the Heron: from the wharf, the wharf, the plank walk and the barge, not the floor inside; from the floor, the counting-box through its glass", () => {
  const heron = worldOf("heron-warehouse", "heron");
  const outside = listed(heron);
  for (const id of ["saul", "duchess", "land-door", "signboard", "hatches", "bargees"]) assert.ok(outside.includes(id), `${id} in sight`);
  for (const id of ["gang", "wheat-ear-sacks", "heron-sacks", "empty-sacks", "hep", "hobb", "scrope", "counting-desk"]) assert.ok(!outside.includes(id), `${id}, inside the Heron, isn't`);

  applyOps(heron, [op({ op: "move", what: "player", to: "floor" })], 1);
  heron.entities.player!.at = { x: 50, y: 40 };
  const inside = listed(heron);
  for (const id of ["gang", "wheat-ear-sacks", "heron-sacks", "hep", "hobb", "counting-desk", "scrope", "counting-lamp"]) assert.ok(inside.includes(id), `${id} in sight from the floor`);
  assert.ok(!inside.includes("saul"), "the wharf is behind the land door, shut");
});
