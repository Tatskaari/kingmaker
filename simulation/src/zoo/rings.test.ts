import { test } from "node:test";
import assert from "node:assert/strict";
import { solid } from "../../../shared/fight/grid.ts";
import { mapOf } from "../../../shared/map/tiles.ts";
import { all, hostWithCampaign, identity } from "../host/testing.ts";
import { eventsOf, fightOf } from "../fight/rows.ts";
import { RINGS, ringSetup } from "../../../shared/zoo/rings.ts";

/**
 * The zoo's rings (M6, docs/combat-design.md §7): each set out on a map that builds, everyone on a
 * floor of their own inside it with its gate a way out; and each played to its end by the AI on both
 * sides (auto for the player, fast), its moments numbered in order and each one captioned, with
 * nothing in the module's log saying a step stopped. Five fights, a different build in each.
 */

test("every ring is set out on its own map: everyone on a floor of their own, its gates ways out", () => {
  for (const ring of Object.values(RINGS)) {
    const { map } = mapOf(ring.map);
    const setup = ringSetup(ring, { name: "Wren Ashdown" });
    const spots = setup.combatants.map(c => `${c.at.x},${c.at.y}`);
    assert.equal(new Set(spots).size, spots.length, `${ring.id}: nobody shares a tile`);
    for (const c of setup.combatants) assert.equal(solid(map, c.at), false, `${ring.id}: ${c.id} stands on the floor`);
    assert.ok(map.exits.length > 0, `${ring.id} has a way out`);
    for (const e of map.exits) assert.equal(solid(map, e.at), false, `${ring.id}: its gate can be stood in`);
    assert.equal(setup.place, "the Arena");
    assert.equal(setup.fresh, true, "the player starts rested");
    assert.equal(setup.keep, undefined, "and the ring leaves their sheet as it was");
  }
});

for (const [ring, build, seed] of [["practice", "fighter", 2], ["wolves", "fighter", 3], ["goblins", "wizard", 4], ["porters", "rogue", 5], ["heron", "cleric", 6]] as const) {
  test(`the ${ring} ring, played to its end by the AI on both sides (the ready-made ${build})`, () => {
    const { host } = hostWithCampaign(seed, { map: true });
    const wren = identity(1);
    assert.equal(host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a sellsword", build }), undefined);
    host.advance(1000);
    const game = all(host.db.game)[0]!;
    assert.equal(host.as(wren).startRing({ ring, fast: true }), undefined);
    const fight = () => host.transact(tx => fightOf(tx, game.id))!;
    for (let i = 0; i < 300 && fight().status === "on"; i++) {
      if (fight().options) assert.equal(host.as(wren).fightTurn({ act: "auto" }), undefined);
      host.fightSteps();
    }
    const over = fight();
    assert.equal(over.status, "over", `${ring} ends`);
    const moments = host.transact(tx => eventsOf(tx, over.id));
    assert.deepEqual(moments.map(e => e.seq), moments.map((_, i) => i + 1), "numbered in order");
    for (const e of moments) assert.ok(e.caption.trim().length > 5 && !/undefined|NaN/.test(e.caption), `a caption for ${e.kind}: "${e.caption}"`);
    assert.equal(moments[0]!.kind, "start");
    assert.equal(moments[moments.length - 1]!.kind, "over");
    assert.deepEqual(host.logs.filter(l => /\[fight_step\].*stopped|wouldn't pass/.test(l)), [], "no step stopped");
  });
}
