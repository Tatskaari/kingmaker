import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { dnd, statusLine } from "../../rules/dnd.ts";
import type { SessionState } from "../../runtime/session.ts";
import type { GameState } from "../play.ts";
import type { CombatantSetup, CombatSetup, TileMap } from "../types.ts";
import { resumeCombat, startCombat, type CombatController } from "./controller.ts";
import { tacticalFights } from "./fights.ts";
import { areaTiles, clearShot, findPath, line, same, steps } from "./grid.ts";
import { heronMap, HERON_LAYOUT } from "./heron-grid.ts";
import { heronEncounter } from "./heron.ts";
import { pregenSession } from "./pregen.ts";
import { gridText } from "./render.ts";

/** node --no-warnings --test src/game/combat/combat.test.ts */

async function heronSession(pregen = "fighter", seed = 1, level = 3): Promise<SessionState> {
  const session = await pregenSession({ pregen, seed, level });
  session.beat = "midnight";
  session.established.push("Master Sallow has come to the Heron.");
  return session;
}

/** A Heron fight with people where the test wants them. */
function placed(session: SessionState, at: Record<string, { x: number; y: number }>, drop: string[] = []): CombatSetup {
  const setup = heronEncounter(heronMap(), session, { sallow: true, seed: 7 });
  return { ...setup, combatants: setup.combatants.filter(c => !drop.includes(c.id)).map(c => (at[c.id] ? { ...c, at: at[c.id]! } : c)) };
}

/** Let everyone else go until it's the player's turn. */
function toPlayer(combat: CombatController): void {
  combat.advance();
  assert.ok(combat.playerTurn() || combat.over(), "it should come round to the player");
}

function playOut(combat: CombatController, rounds = 30): void {
  for (let i = 0; i < 400 && !combat.over() && combat.state().round <= rounds; i++) {
    if (combat.playerTurn()) combat.autoTurn();
    else combat.advance();
  }
}

describe("the grid", () => {
  const map = heronMap();
  it("finds paths around the sack stacks, without cutting corners", () => {
    const path = findPath(map, { x: 4, y: 1 }, { x: 4, y: 10 })!;
    assert.ok(path.length >= 9);
    for (const t of path) assert.notEqual(map.tiles[t.y]![t.x]!.blocks, true);
    // From the floor by the stacks, a diagonal squeeze between two stacked tiles isn't allowed.
    const tight: TileMap = { ...map, tiles: map.tiles.map((row, y) => row.map((tile, x) => ((x === 2 && y === 2) || (x === 3 && y === 3) ? { terrain: "wall", blocks: true } : tile))) };
    const around = findPath(tight, { x: 2, y: 3 }, { x: 3, y: 2 })!;
    assert.ok(around.length > 1, "no squeezing diagonally between two walls");
  });
  it("won't walk through an enemy, will pass a friend without stopping", () => {
    const enemy = { x: 10, y: 6 };
    const blocked = findPath(map, { x: 9, y: 6 }, { x: 11, y: 6 }, { blocked: t => same(t, enemy) })!;
    assert.ok(!blocked.some(t => same(t, enemy)));
    const through = findPath(map, { x: 9, y: 6 }, { x: 11, y: 6 }, { noStop: t => same(t, enemy) })!;
    assert.equal(through.length, 2);
  });
  it("lays spell areas on tiles", () => {
    const sphere = areaTiles(map, "sphere", 20, { x: 22, y: 6 }, { x: 12, y: 6 }, false);
    assert.ok(sphere.some(t => same(t, { x: 12, y: 6 })) && sphere.some(t => same(t, { x: 16, y: 6 })) && !sphere.some(t => same(t, { x: 17, y: 6 })));
    const cone = areaTiles(map, "cone", 15, { x: 22, y: 6 }, { x: 19, y: 6 }, true);
    assert.ok(cone.every(t => t.x < 22) && cone.some(t => same(t, { x: 19, y: 6 })) && !cone.some(t => same(t, { x: 22, y: 6 })));
    const cube = areaTiles(map, "cube", 15, { x: 22, y: 6 }, { x: 21, y: 6 }, true);
    assert.equal(cube.length, 9);
    assert.ok(cube.every(t => t.x <= 21));
    const bolt = areaTiles(map, "line", 100, { x: 22, y: 6 }, { x: 10, y: 6 }, true);
    assert.ok(bolt.every(t => t.y === 6 && t.x < 22));
  });
  it("can't see or shoot through the stacks", () => {
    assert.equal(clearShot(map, { x: 8, y: 0 + 3 }, { x: 8, y: 8 }), true);
    assert.equal(clearShot(map, { x: 8, y: 3 }, { x: 8, y: 11 }), false);
    assert.deepEqual(line({ x: 0, y: 0 }, { x: 3, y: 0 }).map(t => t.x), [0, 1, 2, 3]);
  });
});

describe("the Heron", () => {
  it("sets Sallow, the Crakes, the lantern-boy and Kell against the player, in the dust", async () => {
    const session = await heronSession();
    const setup = heronEncounter(heronMap(), session);
    const by = (id: string) => setup.combatants.find(c => c.id === id)!;
    assert.equal(by("sallow").statblock, "sword-cane-duellist");
    assert.equal(by("sallow").role, "villain");
    assert.equal(by("crake-1").statblock, "river-bruiser");
    assert.equal(by("crake-2").name, "the silent Crake");
    assert.equal(by("lantern-boy").role, "coward");
    assert.equal(by("kell").side, "ally");
    assert.equal(by("player").side, "player");
    assert.ok((setup.dust ?? []).length > 50);
    assert.ok((setup.fuel ?? []).length > 40);
    assert.ok(setup.props?.some(p => p.id === "brazier"));
    // The player starts just clear of the dust; Sallow stands in it.
    const dust = new Set((setup.dust ?? []).map(t => `${t.x},${t.y}`));
    assert.ok(!dust.has(`${by("player").at.x},${by("player").at.y}`));
    assert.ok(dust.has(`${by("sallow").at.x},${by("sallow").at.y}`));
  });
  it("before midnight it's Hep and her gang", async () => {
    const session = await pregenSession({ seed: 2 });
    const setup = heronEncounter(heronMap(), session, { sallow: false });
    assert.ok(setup.combatants.some(c => c.id === "hep"));
    assert.ok(!setup.combatants.some(c => c.id === "sallow"));
    assert.ok(setup.combatants.filter(c => c.id.startsWith("porter")).length >= 2);
  });
  it("works on somebody else's map of the Heron", async () => {
    const session = await heronSession();
    const map: TileMap = { ...heronMap(), id: "map-module-heron" };
    const setup = heronEncounter(map, session);
    const spots = setup.combatants.map((c: CombatantSetup) => `${c.at.x},${c.at.y}`);
    assert.equal(new Set(spots).size, spots.length, "nobody shares a tile");
    for (const c of setup.combatants) assert.notEqual(map.tiles[c.at.y]![c.at.x]!.blocks, true);
    assert.ok((setup.dust ?? []).length > 0);
  });
});

describe("a fight", () => {
  it("rolls initiative with the engine and takes turns in that order", async () => {
    const session = await heronSession("fighter", 3);
    const combat = await startCombat(heronEncounter(heronMap(), session), session);
    const G = combat.state();
    assert.equal(G.order.length, 6);
    assert.equal(G.log[0]!.text, "Roll for initiative!");
    assert.match(G.log[1]!.text, /^Initiative: /);
    const inits = G.order.map(id => G.units[id]!.initiative);
    assert.deepEqual(inits, [...inits].sort((a, b) => b - a));
    toPlayer(combat);
    assert.equal(combat.state().order[combat.state().active], "player");
    assert.match(gridText(combat.state()), /@/);
  });

  it("moves the player up to their speed, and no further", async () => {
    const session = await heronSession("fighter", 4);
    const combat = await startCombat(placed(session, { sallow: { x: 2, y: 2 }, "crake-1": { x: 2, y: 9 }, "crake-2": { x: 3, y: 9 } }, ["lantern-boy"]), session);
    toPlayer(combat);
    const me = combat.state().units["player"]!;
    const far = combat.act({ kind: "move", to: { x: me.at.x + 12, y: me.at.y } });
    assert.equal(far.ok, false);
    const wall = combat.act({ kind: "move", to: { x: me.at.x, y: 0 } });
    assert.equal(wall.ok, false);
    const before = combat.options().movementLeft;
    const near = combat.act({ kind: "move", to: { x: me.at.x + 2, y: me.at.y } });
    assert.equal(near.ok, true, near.error ?? "");
    assert.equal(combat.options().movementLeft, before - 10);
  });

  it("gives an opportunity attack to an enemy you walk away from", async () => {
    const session = await heronSession("fighter", 5);
    const setup = placed(session, { player: { x: 24, y: 6 }, "crake-1": { x: 25, y: 6 }, sallow: { x: 2, y: 2 }, "crake-2": { x: 2, y: 9 } }, ["lantern-boy", "kell"]);
    const combat = await startCombat(setup, session);
    // Wherever the turn order puts the Crake, get to the player's turn with him still alongside.
    toPlayer(combat);
    const G = combat.state();
    const crake = G.units["crake-1"]!;
    assert.ok(steps(crake.at, G.units["player"]!.at) <= 1, "the Crake is still alongside");
    const away = { x: G.units["player"]!.at.x - 2, y: G.units["player"]!.at.y };
    const moved = combat.act({ kind: "move", to: away });
    assert.equal(moved.ok, true, moved.error ?? "");
    assert.ok(moved.lines.some(l => /swing as you go past/.test(l.text)) || moved.lines.some(l => /opportunity attack/.test(l.text)), "the Crake should get his swing");
  });

  it("kicking the brazier into the dust blows it up, for everyone in it", async () => {
    const session = await heronSession("fighter", 6);
    // The player by the brazier; Sallow and the Crakes deep in the dust, too far to reach the player first.
    const combat = await startCombat(placed(session, { player: { x: 23, y: 8 }, kell: { x: 26, y: 6 }, sallow: { x: 7, y: 6 }, "crake-1": { x: 8, y: 5 }, "crake-2": { x: 8, y: 7 } }, ["lantern-boy"]), session);
    toPlayer(combat);
    const before = Object.fromEntries(Object.values(combat.state().units).map(u => [u.id, u.hp]));
    const kicked = combat.act({ kind: "use", prop: "brazier" });
    assert.equal(kicked.ok, true, kicked.error ?? "");
    const G = combat.state();
    assert.equal(G.flags["dust_exploded"], true);
    assert.equal(G.dust.length, 0);
    assert.ok(G.fire.length > 0, "the sacks catch");
    assert.ok(kicked.lines.some(l => /Grain dust explosion/.test(l.text)));
    const inDust = Object.values(G.units).filter(u => u.side === "enemy" && HERON_LAYOUT.dust(G.map).some(t => same(t, u.at)));
    assert.ok(inDust.length > 0);
    for (const u of inDust) assert.ok(u.hp < before[u.id]!, `${u.name} should be burned`);
    assert.equal(G.units["player"]!.hp, before["player"], "the player was clear of the dust");
  });

  it("a Fire Bolt through the dust sets it off", async () => {
    const session = await heronSession("wizard", 7);
    const combat = await startCombat(placed(session, { player: { x: 24, y: 6 }, kell: { x: 26, y: 5 }, sallow: { x: 9, y: 6 }, "crake-1": { x: 10, y: 5 }, "crake-2": { x: 10, y: 7 } }, ["lantern-boy"]), session);
    toPlayer(combat);
    const target = Object.values(combat.state().units).find(u => u.side === "enemy" && u.state === "fighting")!;
    const cast = combat.act({ kind: "cast", spell: "fire-bolt", target: target.id });
    assert.equal(cast.ok, true, cast.error ?? "");
    assert.equal(combat.state().flags["dust_exploded"], true);
    assert.ok(cast.lines.some(l => /You cast Fire Bolt/.test(l.text)));
  });

  it("plays whole fights to an ending the story can use, and writes the player back into the session", async () => {
    const { E, pack } = await dnd();
    const engine = E.createEngine({ contentPacks: [pack], rng: E.seededRNG(1) });
    for (const [pregen, seed] of [["fighter", 1], ["fighter", 2], ["wizard", 3], ["rogue", 4], ["cleric", 5]] as const) {
      const session = await heronSession(pregen, seed);
      const combat = await startCombat(heronEncounter(heronMap(), session), session);
      playOut(combat);
      assert.ok(combat.over(), `${pregen} #${seed} should finish`);
      const result = combat.result();
      assert.ok(["victory", "defeat", "fled", "surrender"].includes(result.outcome));
      assert.ok(result.summary.length > 40);
      assert.ok(result.casualties.some(c => c.id === "sallow"));
      assert.equal(result.rounds, combat.state().round);
      // The session's campaign is still one the engine (and the scene runtime) can load.
      const campaign = E.loadCampaign(session.rules!.campaign, engine);
      assert.equal(campaign.state["activeEncounterId"], undefined, "the encounter is closed");
      const pc = campaign.state.characters[session.rules!.pc]!;
      assert.equal(Math.max(0, pc.hp.current), combat.state().units["player"]!.hp);
      assert.ok(pc.hp.current >= 0, "no negative hit points in the story");
      assert.match(await statusLine(session), /^HP \d+\/\d+/);
      assert.ok(session.rules!.npcs["kell"] && session.rules!.npcs["sallow"]);
      // A second call doesn't write twice.
      assert.deepEqual(combat.result(), result);
    }
  });

  it("saves and carries on", async () => {
    const session = await heronSession("wizard", 8);
    const combat = await startCombat(heronEncounter(heronMap(), session), session);
    toPlayer(combat);
    combat.autoTurn();
    const saved = JSON.parse(JSON.stringify(combat.save()));
    const resumed = resumeCombat(saved, session, await dnd());
    assert.equal(resumed.state().round, combat.state().round);
    assert.equal(resumed.state().log.length, combat.state().log.length, "nothing happens twice on loading");
    playOut(resumed);
    assert.ok(resumed.over());
    assert.ok(resumed.result().summary);
  });

  it("is the same fight from the same seed", async () => {
    const run = async () => {
      const session = await heronSession("rogue", 9);
      const combat = await startCombat(heronEncounter(heronMap(), session), session);
      playOut(combat, 6);
      return combat.state().log.map(l => l.text).join("\n");
    };
    assert.equal(await run(), await run());
  });
});

describe("any other scene's fight", () => {
  it("plays in a plain room with the scene's leader and their people (the crossroads goblins)", async () => {
    const { forceEnding } = await import("../../runtime/engine.ts");
    const session = await pregenSession({ pregen: "fighter", seed: 12, sceneId: "crossroads-ambush" });
    process.env.KM_RUNS_DIR ??= join("runs", "test-combat"); // forceEnding saves the session (runs/ is gitignored)
    forceEnding(session, "fight");
    const game: GameState = { version: 1, id: "t", mode: "combat", story: { time: "afternoon", played: [], flags: {} }, explore: {}, recent: [] };
    const fight = await tacticalFights().start(game, session);
    assert.match(fight.observe(), /goblin/i);
    for (let i = 0; i < 60 && !fight.result(); i++) await fight.act("auto");
    assert.ok(fight.result(), "the goblin fight should end");
  });
});

describe("the play loop's Fight", () => {
  it("observes, lists actions by id, acts, and ends with a result", async () => {
    const session = await heronSession("fighter", 10);
    const game: GameState = { version: 1, id: "t", mode: "combat", story: { time: "night", played: [], flags: {} }, explore: {}, recent: [] };
    const factory = tacticalFights();
    let fight = await factory.start(game, session);
    assert.match(fight.observe(), /Roll for initiative!/);
    const ids = fight.actions().map(a => a.id);
    assert.ok(ids.includes("end_turn") && ids.includes("auto"));
    assert.ok(ids.some(id => id.startsWith("close_")));
    assert.match(await fight.act("nonsense"), /no action/);
    await fight.act("end_turn");
    fight = factory.load(JSON.parse(JSON.stringify(fight.save())), session);
    for (let i = 0; i < 60 && !fight.result(); i++) await fight.act("auto");
    const result = fight.result();
    assert.ok(result, "the fight should end");
    assert.ok(result.summary);
  });
});
