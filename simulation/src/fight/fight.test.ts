import { test } from "node:test";
import assert from "node:assert/strict";
import { stepDelayMs } from "../../../shared/fight/pace.ts";
import type { FightBoard, FightEvent, FightOptions, FightResult, FightSetup } from "../../../shared/fight/types.ts";
import type { CombatantSetup, Tile2 } from "../../../shared/map/types.ts";
import { all, hostWithCampaign, identity } from "../host/testing.ts";
import type { MemoryHost } from "../host/memory.ts";
import { playerRow } from "../rows.ts";
import { RINGS } from "../../../shared/zoo/rings.ts";
import { decide, freshMemo } from "./ai.ts";
import { boardOfRow, eventsOf, fightOf, peek, type FightRow } from "./rows.ts";
import { startFight } from "./start.ts";

/**
 * A fight on the map (M6, docs/combat-design.md), on the memory host with the campaign starting on
 * its map and a ready-made character: the turn order from the engine's initiative; a move a tile at
 * a time and an attack resolved by the engine, each its moment; an opportunity attack splitting a
 * move (and none after a disengage); the AI's choice in simple setups; the other side's turns played
 * one at a time by fight_step, each with its moments; a spell at a target and an area; a fight's end
 * and the way back to the map; the zoo's ring, and a refused act writing nothing.
 */

/** A new game on the map with a ready-made build: Wren in the lane. */
function onMap(build = "fighter", seed = 7) {
  const { host } = hostWithCampaign(seed, { map: true });
  const wren = identity(1);
  assert.equal(host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a sellsword", build }), undefined);
  host.advance(1000);
  const game = all(host.db.game)[0]!;
  return { host, wren, game, playerId: game.hostId };
}

/** A fight in the practice ring's room, with these people where the test wants them (the player at `start`). */
function room(fighters: Array<Partial<CombatantSetup> & Pick<CombatantSetup, "id" | "at">>, start: Tile2, extra: Partial<FightSetup> = {}): FightSetup {
  return {
    title: "A test", place: "the Arena", map: { file: RINGS.practice!.map },
    combatants: [
      { id: "player", name: "Wren Ashdown", side: "player", role: "player", at: start },
      ...fighters.map(f => ({ name: "a bandit", side: "enemy" as const, role: "brawler", statblock: "bandit", ...f })),
    ],
    ...extra,
  };
}

function fightNow(host: MemoryHost, gameId: bigint): FightRow {
  return host.transact(tx => fightOf(tx, gameId))!;
}
const events = (host: MemoryHost, fight: FightRow): FightEvent[] => host.transact(tx => eventsOf(tx, fight.id));
const board = (host: MemoryHost, gameId: bigint): FightBoard => boardOfRow(fightNow(host, gameId));
const options = (host: MemoryHost, gameId: bigint): FightOptions | undefined => { const o = fightNow(host, gameId).options; return o ? (JSON.parse(o) as FightOptions) : undefined; };
const clock = (host: MemoryHost) => all(host.db.fightClock);

/** Starts a fight from a setup, as start_ring does. */
function started(host: MemoryHost, playerId: bigint, setup: FightSetup): FightRow {
  return host.transact(tx => startFight(tx, playerRow(tx, playerId), setup));
}

/** The other side's turns played, a step at a time on the clock, until the player's turn (or the end). */
function toPlayer(host: MemoryHost, gameId: bigint): void {
  for (let i = 0; i < 60; i++) {
    const fight = fightNow(host, gameId);
    if (fight.status !== "on" || fight.options) return;
    host.advance(5000);
    host.fightSteps();
  }
  assert.fail("the turn never came round to the player");
}

test("the turn order is the engine's initiative, the start and the first turn its first moments, held round after round", () => {
  const { host, playerId, game } = onMap();
  const fight = started(host, playerId, room([{ id: "bandit-1", at: { x: 8, y: 2 } }, { id: "bandit-2", at: { x: 8, y: 4 }, name: "another bandit" }], { x: 2, y: 3 }));
  const b = boardOfRow(fight);
  // The order is by initiative, highest first, as the engine rolled it.
  const inits = b.order.map(id => b.units[id]!.initiative);
  assert.deepEqual(inits, [...inits].sort((x, y) => y - x));
  assert.deepEqual([...b.order].sort(), ["bandit-1", "bandit-2", "player"]);
  const [start, turn] = events(host, fight);
  assert.equal(start!.kind, "start");
  assert.deepEqual(start!.detail.initiative!.map(r => r.unit), b.order, "the rolls in the order they'll go");
  for (const r of start!.detail.initiative!) assert.equal(r.total, r.d20 + r.modifier);
  assert.match(start!.caption, /^Roll for initiative! /);
  assert.match(start!.detail.lines.join("\n"), /^Roll for initiative!\nInitiative: /);
  assert.equal(turn!.kind, "turn");
  assert.equal(turn!.actor, b.order[0], "the first turn is the highest roll's");
  assert.equal(fight.turn, b.order[0]);
  assert.deepEqual(fight.order, b.order);
  // Round after round in the same order: two rounds of turns, each the order's.
  toPlayer(host, game.id);
  assert.equal(host.as(identity(1)).fightTurn({ act: "end_turn" }), undefined);
  toPlayer(host, game.id);
  assert.equal(host.as(identity(1)).fightTurn({ act: "end_turn" }), undefined);
  toPlayer(host, game.id);
  const turns = events(host, fightNow(host, game.id)).filter(e => e.kind === "turn");
  const live = (id: string) => board(host, game.id).units[id]!.state === "fighting" || id === "player";
  const expected = [...b.order, ...b.order, ...b.order].filter(live);
  assert.deepEqual(turns.map(t => t.actor).slice(0, 7), expected.slice(0, 7));
  assert.deepEqual([...new Set(turns.map(t => t.round))].slice(0, 3), [1, 2, 3]);
});

test("a move goes a tile at a time through the engine, its path in its moment and the feet spent; past the player's speed it's refused in the rules' words, and nothing written", () => {
  const { host, playerId, game, wren } = onMap();
  // The bandit across the room, and asleep on its feet for this: nobody near.
  started(host, playerId, room([{ id: "bandit", at: { x: 10, y: 5 } }], { x: 1, y: 1 }));
  toPlayer(host, game.id);
  const before = options(host, game.id)!;
  const fight = fightNow(host, game.id);
  const dice = host.db.dice.gameId.find(game.id)!;
  // Too far: 40 ft along the wall, and the fighter has less.
  assert.ok(before.movementLeft < 40);
  const far = host.as(wren).walk({ to: { x: 9, y: 1 } });
  assert.equal(far?.code, "not_now");
  assert.equal(far!.text, `(That's 40 ft, and you have ${before.movementLeft} ft of movement left.)`);
  assert.deepEqual(fightNow(host, game.id), fight, "nothing written");
  assert.deepEqual(host.db.dice.gameId.find(game.id), dice, "and no die rolled for good");
  // Two tiles east: a move of 10 ft, its path the two tiles.
  assert.equal(host.as(wren).walk({ to: { x: 3, y: 1 } }), undefined);
  const move = events(host, fightNow(host, game.id)).filter(e => e.kind === "move" && e.actor === "player").pop()!;
  assert.deepEqual(move.detail.path, [{ x: 2, y: 1 }, { x: 3, y: 1 }]);
  assert.deepEqual(move.detail.from, { x: 1, y: 1 });
  assert.equal(move.caption, "You move 10 ft.");
  assert.deepEqual(board(host, game.id).units["player"]!.at, { x: 3, y: 1 });
  assert.equal(options(host, game.id)!.movementLeft, before.movementLeft - 10);
});

test("an attack is resolved by the engine: the roll against the armour class, the damage off the target's hit points, all in its moment", () => {
  const { host, playerId, game, wren } = onMap();
  started(host, playerId, room([{ id: "bandit", at: { x: 3, y: 3 } }], { x: 2, y: 3 }));
  toPlayer(host, game.id);
  const hpBefore = board(host, game.id).units["bandit"]!.hp;
  assert.ok(options(host, game.id)!.actions.some(a => a.id === "attack@3,3" && /^Attack a bandit \(Longsword \+5; 5 ft\)$/.test(a.label)), "the blow is on offer, with its weapon and bonus");
  assert.equal(host.as(wren).attack({ how: "attack", at: { x: 3, y: 3 } }), undefined);
  const blow = events(host, fightNow(host, game.id)).filter(e => e.kind === "attack" && e.actor === "player").pop()!;
  const roll = blow.detail.rolls[0]!;
  assert.equal(roll.by, "player");
  assert.equal(roll.target, "bandit");
  assert.equal(roll.with, "Longsword");
  assert.equal(roll.total, roll.d20[roll.d20.length - 1]! + roll.bonus, "the total is the die and the bonus");
  assert.equal(roll.hit, roll.critical || (roll.d20[0] !== 1 && roll.total >= roll.ac));
  const after = board(host, game.id).units["bandit"]!;
  const hit = blow.detail.hits.find(h => h.unit === "bandit");
  if (roll.hit) {
    const dealt = hit!.damage.reduce((n, d) => n + d.amount, 0);
    assert.ok(dealt > 0);
    assert.equal(after.hp, Math.max(0, hpBefore - dealt), "the damage came off");
    assert.equal(hit!.hp, after.hp);
    assert.match(blow.caption, new RegExp(`^You swing at a bandit: (a critical hit, )?${dealt} damage[.!]`));
  } else {
    assert.equal(after.hp, hpBefore);
    assert.equal(blow.caption, "You swing at a bandit, and miss.");
  }
  assert.match(blow.detail.lines[0]!, /^Longsword: your attack on a bandit: \d+ \+5 = \d+ vs AC 12: (hit|miss|critical hit!)$/);
});

test("walking out of someone's reach gives them an opportunity attack, which splits the move in three; after a disengage there's none", () => {
  const { host, playerId, game, wren } = onMap();
  started(host, playerId, room([{ id: "bandit", at: { x: 4, y: 3 } }], { x: 3, y: 3 }));
  toPlayer(host, game.id);
  assert.ok(board(host, game.id).units["bandit"]!.state === "fighting");
  const seen = fightNow(host, game.id).seq;
  // West, away from the bandit: leaving his reach after the first step.
  assert.equal(host.as(wren).walk({ to: { x: 1, y: 3 } }), undefined);
  const after = events(host, fightNow(host, game.id)).filter(e => e.seq > seen);
  const kinds = after.map(e => `${e.kind}:${e.actor}`);
  const swing = after.find(e => e.kind === "attack" && e.actor === "bandit")!;
  assert.ok(swing, `the bandit swings (${kinds.join(", ")})`);
  assert.equal(swing.detail.rolls[0]!.opportunity, true);
  assert.match(swing.caption, /^A bandit takes a swing as you go past/);
  assert.match(swing.detail.lines.join("\n"), /\(opportunity attack\)/);
  // The move up to the swing, the swing, then the rest of the move (if the player's still standing).
  const first = after.findIndex(e => e.kind === "move");
  assert.equal(after[first]!.actor, "player");
  assert.equal(after[first + 1], swing);
  if (board(host, game.id).units["player"]!.state === "fighting") assert.equal(after[first + 2]!.kind, "move");
  const walked = after.filter(e => e.kind === "move").flatMap(e => e.detail.path ?? []);
  assert.deepEqual(walked[walked.length - 1], { x: 1, y: 3 });

  // Another fight, the same set-up: disengage first, and walk away with no swing.
  const again = onMap();
  started(again.host, again.playerId, room([{ id: "bandit", at: { x: 4, y: 3 } }], { x: 3, y: 3 }));
  toPlayer(again.host, again.game.id);
  const from = fightNow(again.host, again.game.id).seq;
  assert.equal(again.host.as(again.wren).fightTurn({ act: "disengage" }), undefined);
  assert.equal(again.host.as(again.wren).walk({ to: { x: 1, y: 3 } }), undefined);
  const quiet = events(again.host, fightNow(again.host, again.game.id)).filter(e => e.seq > from);
  assert.deepEqual(quiet.map(e => e.kind).slice(0, 2), ["disengage", "move"]);
  assert.ok(!quiet.some(e => e.kind === "attack" && e.actor === "bandit" && e.detail.rolls.some(r => r.opportunity)), "no swing as they go");
  assert.match(quiet[0]!.caption, /^You disengage: no swings as you move away\.$/);
});

test("the AI's choice: a bruiser beside you swings, one across the room closes in, an archer with a clear shot shoots, and a coward says his piece and runs", () => {
  const { host, playerId, game } = onMap();
  started(host, playerId, room([
    { id: "near", name: "a near bandit", at: { x: 3, y: 3 }, role: "bruiser" },
    { id: "far", name: "a far bandit", at: { x: 9, y: 1 }, role: "bruiser" },
    { id: "archer", name: "a goblin archer", statblock: "goblin-warrior", weapon: "shortbow", role: "archer", at: { x: 9, y: 5 } },
    { id: "boy", name: "the lantern-boy", statblock: "lantern-boy", role: "coward", at: { x: 6, y: 5 } },
  ], { x: 2, y: 3 }));
  const fight = fightNow(host, game.id);
  // Each one's next step as the AI would take it on their own turn (the board as it is, their turn given them).
  const next = (id: string) => host.transact(tx => peek(tx, fight, s => {
    s.G.active = s.G.order.indexOf(id);
    return decide(s, s.unit(id)!, freshMemo());
  }));
  assert.deepEqual(next("near"), { kind: "attack", target: "player", weapon: boardOfRow(fight).units["near"]!.weapons[0] });
  const far = next("far");
  assert.ok(far.kind === "move" || far.kind === "dash", `closes in: ${far.kind}`);
  if (far.kind === "move") assert.ok(Math.max(Math.abs(far.to.x - 2), Math.abs(far.to.y - 3)) < Math.max(Math.abs(9 - 2), Math.abs(1 - 3)), "nearer the player");
  const shot = next("archer");
  assert.equal(shot.kind, "attack");
  assert.equal((shot as { target: string }).target, "player");
  assert.deepEqual(next("boy"), { kind: "remark", line: "flee:coward" });
});

test("the other side's turns are played one at a time by fight_step, each paced for the screen and writing its moments: its turn, its move with the path, its attack with the roll", () => {
  const { host, playerId, game, wren } = onMap();
  started(host, playerId, room([{ id: "bandit-1", at: { x: 9, y: 2 } }, { id: "bandit-2", name: "another bandit", at: { x: 9, y: 4 } }], { x: 2, y: 3 }));
  toPlayer(host, game.id);
  // The player's turn ends: the first of the others is scheduled, a moment on (the player's own moments have their time on screen).
  const seen = fightNow(host, game.id).seq;
  assert.equal(host.as(wren).fightTurn({ act: "end_turn" }), undefined);
  const after = fightNow(host, game.id);
  const next = after.turn;
  assert.notEqual(next, "player");
  assert.equal(after.options, "", "no options while it isn't theirs");
  const [due] = clock(host);
  assert.ok(due, "a step is on the clock");
  assert.equal(due!.fightId, after.id);
  assert.equal(clock(host).length, 1, "one at a time");
  const turnStart = events(host, after).filter(e => e.seq > seen);
  const wait = Number(due!.scheduledAt.tag === "Time" ? due!.scheduledAt.value.microsSinceUnixEpoch - host.now().microsSinceUnixEpoch : 0n) / 1000;
  assert.equal(wait, stepDelayMs(turnStart), "paced by what was just written");
  assert.equal(host.fightSteps(), 0, "not before its time");
  host.advance(wait);
  assert.equal(host.fightSteps(), 1);
  // One turn played: the bandit's moments (a move with its path, maybe a blow), then the next one's turn begun.
  const played = events(host, fightNow(host, game.id)).filter(e => e.seq > seen + turnStart.length);
  const mine = played.filter(e => e.actor === next && e.kind !== "turn");
  assert.ok(mine.length, "the bandit did something");
  const move = mine.find(e => e.kind === "move");
  if (move) {
    const path = move.detail.path!;
    assert.ok(path.length > 0);
    for (let i = 1; i < path.length; i++) assert.ok(Math.max(Math.abs(path[i]!.x - path[i - 1]!.x), Math.abs(path[i]!.y - path[i - 1]!.y)) === 1, "a tile at a time");
    assert.match(move.caption, /^(A|Another) bandit (closes|steps|moves)/);
  }
  const attack = mine.find(e => e.kind === "attack");
  if (attack) {
    assert.equal(attack.detail.rolls[0]!.by, next);
    assert.equal(attack.detail.rolls[0]!.target, "player");
  }
  const turns = played.filter(e => e.kind === "turn");
  assert.equal(turns.length, 1, "the next turn begun, and no more played");
  const nowTurn = fightNow(host, game.id).turn;
  assert.equal(turns[0]!.actor, nowTurn);
  if (nowTurn !== "player") assert.equal(clock(host).length, 1, "and the step after it scheduled");
});

test("a wizard's spells from the sheet: Fire Bolt at a target rolls to hit, Burning Hands lays a cone that catches whoever's in it", () => {
  const { host, playerId, game, wren } = onMap("wizard");
  started(host, playerId, room([{ id: "bandit", at: { x: 3, y: 3 } }, { id: "far", name: "a far bandit", at: { x: 8, y: 3 } }], { x: 2, y: 3 }));
  toPlayer(host, game.id);
  const offered = options(host, game.id)!.actions.map(a => a.id);
  assert.ok(offered.includes("cast_fire-bolt@8,3"), "Fire Bolt at the far bandit");
  assert.ok(offered.includes("cast_burning-hands@3,3"), "Burning Hands at the near one's spot");
  const seen = fightNow(host, game.id).seq;
  assert.equal(host.as(wren).cast({ spell: "burning-hands", at: { x: 3, y: 3 } }), undefined);
  const cone = events(host, fightNow(host, game.id)).filter(e => e.seq > seen && e.kind === "cast")[0]!;
  assert.equal(cone.detail.spell, "burning-hands");
  assert.equal(cone.detail.element, "fire");
  assert.ok(cone.detail.area!.some(t => t.x === 3 && t.y === 3), "the cone covers the bandit's tile");
  assert.ok(!cone.detail.area!.some(t => t.x === 2 && t.y === 3), "and not the caster's");
  const caught = cone.detail.hits.find(h => h.unit === "bandit")!;
  assert.ok(caught, "the bandit is caught");
  assert.equal(typeof caught.saved, "boolean", "with a Dexterity save");
  assert.match(cone.caption, /^You cast Burning Hands, catching a bandit \(\d+(, saved)?\)/);
  assert.match(cone.detail.lines[0]!, /^You cast Burning Hands \(1st-level slot\): a 15-foot cone, catching a bandit/);
  // The action's spent: no more spells with an action this turn, and Fire Bolt is refused in the rules' words.
  const refused = host.as(wren).cast({ spell: "fire-bolt", at: { x: 8, y: 3 } });
  assert.equal(refused?.code, "not_now");
  assert.match(refused!.text, /already used your action/);
});

test("a fight's end: the last of them down is a victory, its moment and how it went written; the map's moves wait for out, which goes back to the map with the fight's end its words", () => {
  const { host, playerId, game, wren } = onMap();
  started(host, playerId, room([{ id: "bandit", at: { x: 3, y: 3 } }], { x: 2, y: 3 }));
  // The bandit as good as beaten (1 hit point, set on the fight's own campaign as damage would), and it's the player's turn.
  toPlayer(host, game.id);
  host.transact(tx => {
    const fight = fightOf(tx, game.id)!;
    const rules = tx.db.fightRules.fightId.find(fight.id)!;
    const b = boardOfRow(fight);
    const campaign = JSON.parse(rules.campaign) as { events: Array<Record<string, unknown>> };
    const last = campaign.events[campaign.events.length - 1]!;
    campaign.events.push({ ...last, id: "01K0000000000000000000ZZZZ", type: "DamageApplied", targetId: b.units["bandit"]!.engineId, components: [{ amount: b.units["bandit"]!.hp - 1, type: "bludgeoning" }], source: "test" });
    tx.db.fightRules.fightId.update({ ...rules, campaign: JSON.stringify(campaign) });
  });
  for (let i = 0; i < 6 && fightNow(host, game.id).status === "on"; i++) {
    if (options(host, game.id)?.actions.some(a => a.id === "attack@3,3")) host.as(wren).attack({ how: "attack", at: { x: 3, y: 3 } });
    if (fightNow(host, game.id).status === "on" && options(host, game.id)) host.as(wren).fightTurn({ act: "end_turn" });
    toPlayer(host, game.id);
  }
  const fight = fightNow(host, game.id);
  assert.equal(fight.status, "over");
  assert.ok(fight.outcome === "victory" || fight.outcome === "surrender", String(fight.outcome));
  assert.equal(fight.turn, "");
  assert.equal(fight.options, "");
  assert.equal(clock(host).length, 0, "nothing more on the clock");
  const over = events(host, fight).pop()!;
  assert.equal(over.kind, "over");
  assert.equal(over.detail.outcome, fight.outcome);
  assert.match(over.caption, /^It's over: (you won|they gave up)\.$/);
  const result = JSON.parse(fight.result!) as FightResult;
  assert.equal(result.outcome, fight.outcome);
  assert.match(result.summary, /A bandit (went down|gave up)\. The player ended the fight on \d+ of \d+ hit points\. It took \d+ rounds?\./);
  // The map's moves wait for out; out goes back to the map, the fight done and its end the map's words.
  assert.match(host.as(wren).interact({ verb: "look" })?.text ?? "", /The fight's over: out goes back to the map/);
  assert.equal(host.as(wren).walk({ toward: "out" }), undefined);
  assert.equal(fightNow(host, game.id).status, "done");
  assert.match(host.db.explore.playerId.find(playerId)!.said, /^A test: A bandit (went down|gave up)\./);
  assert.equal(host.as(wren).walk({ toward: "east" }), undefined, "and the map is the map again");
});

test("the zoo's rings: start_ring sets one out (the player rested, the ring's people where it has them), refused out of turn and from a spectator, and yielding ends it", () => {
  const { host, game, wren } = onMap();
  const tom = identity(2);
  assert.equal(host.as(tom).joinGame({ game: game.id }), undefined);
  assert.match(host.as(wren).startRing({ ring: "dragons" })?.text ?? "", /^\(There's no ring called dragons in the Arena: there's practice, wolves, goblins, porters and heron\.\)$/);
  assert.equal(host.as(tom).startRing({ ring: "wolves" })?.code, "not_controller");
  assert.equal(host.as(wren).startRing({ ring: "wolves" }), undefined);
  const fight = fightNow(host, game.id);
  assert.equal(fight.title, "The wolf run");
  assert.equal(fight.place, "the Arena");
  assert.equal(fight.mapKey, undefined);
  assert.equal(JSON.parse(fight.map!).id, "zoo-wolves");
  const b = boardOfRow(fight);
  assert.deepEqual(Object.keys(b.units).sort(), ["player", "wolf-1", "wolf-2", "wolf-3"]);
  assert.deepEqual(b.units["wolf-1"]!.at, RINGS.wolves!.fighters[0]!.at);
  assert.equal(b.units["player"]!.hp, b.units["player"]!.maxHp, "rested");
  assert.equal(host.as(wren).startRing({ ring: "practice" })?.text, "(There's a fight on: see it through first.)");
  // Out of turn, the player's acts wait; a spectator's are refused.
  if (fight.options === "") assert.equal(host.as(wren).fightTurn({ act: "dodge" })?.code, "not_your_turn");
  toPlayer(host, game.id);
  assert.equal(host.as(tom).fightTurn({ act: "dodge" })?.code, "not_controller");
  assert.equal(host.as(wren).fightTurn({ act: "nonsense" })?.code, "unavailable");
  assert.match(host.as(wren).hide()?.text ?? "", /Hiding isn't part of a fight yet/);
  assert.match(host.as(wren).travel({ way: "anywhere" })?.text ?? "", /There's a fight on/);
  assert.equal(host.as(wren).fightTurn({ act: "yield" }), undefined);
  const over = fightNow(host, game.id);
  assert.equal(over.status, "over");
  assert.equal(over.outcome, "yielded");
  assert.equal(events(host, over).pop()!.caption, "It's over: you yielded.");
  // The ring leaves the sheet as it was: it's practice.
  assert.equal(host.db.sheet.playerId.find(game.hostId)!.hp, host.db.sheet.playerId.find(game.hostId)!.maxHp);
});

test("auto lets the dice decide: a whole fight in the practice ring played to its end by the AI on both sides, every moment captioned, the fast ring's steps at once", () => {
  const { host, game, wren } = onMap();
  assert.equal(host.as(wren).startRing({ ring: "practice", fast: true }), undefined);
  for (let i = 0; i < 80 && fightNow(host, game.id).status === "on"; i++) {
    if (fightNow(host, game.id).options) assert.equal(host.as(wren).fightTurn({ act: "auto" }), undefined);
    // Fast: the steps are due at once, with no time on the clock.
    for (const row of clock(host)) assert.ok(row.scheduledAt.tag === "Time" && row.scheduledAt.value.microsSinceUnixEpoch <= host.now().microsSinceUnixEpoch, "due now");
    host.fightSteps();
  }
  const fight = fightNow(host, game.id);
  assert.equal(fight.status, "over", "the AI fights it out");
  const all = events(host, fight);
  assert.deepEqual(all.map(e => e.seq), all.map((_, i) => i + 1), "the moments in order, numbered from 1");
  for (const e of all) assert.ok(e.caption.length > 5, `${e.kind} has a caption`);
  assert.ok(all.some(e => e.kind === "attack"), "blows were struck");
});

/** The player's character hurt before a fight (a DamageApplied on their own campaign, as a blow in a scene would leave it), down to `hp`. */
function hurtTo(host: MemoryHost, playerId: bigint, hp: number): void {
  host.transact(tx => {
    const state = tx.db.rulesState.playerId.find(playerId)!;
    const campaign = JSON.parse(state.campaign) as { events: Array<Record<string, unknown>>; state?: unknown };
    const max = tx.db.sheet.playerId.find(playerId)!.maxHp;
    const last = campaign.events[campaign.events.length - 1]!;
    campaign.events.push({ ...last, id: "01K0000000000000000000ZZZY", type: "DamageApplied", targetId: state.pc, components: [{ amount: max - hp, type: "bludgeoning" }], source: "test" });
    tx.db.rulesState.playerId.update({ ...state, campaign: JSON.stringify(campaign) });
  });
}

test("at 0 hit points the player rolls a death save as each of their turns begins, in that turn's moment, while an ally holds on; nobody dies in it", () => {
  const { host, playerId, game } = onMap("wizard", 11);
  hurtTo(host, playerId, 1);
  started(host, playerId, room([
    { id: "bandit-1", at: { x: 3, y: 3 } }, { id: "bandit-2", name: "another bandit", at: { x: 3, y: 4 } },
    { id: "kell", castId: "kell", name: "Sergeant Agnes Kell", side: "ally", role: "ally", statblock: "knight", weapon: "longsword", at: { x: 9, y: 1 } },
  ], { x: 2, y: 3 }));
  assert.equal(board(host, game.id).units["player"]!.hp, 1, "the fight takes them as they are (no fresh)");
  let saved: FightEvent | undefined;
  for (let i = 0; i < 80 && !saved && fightNow(host, game.id).status === "on"; i++) {
    // The player does nothing worth a swing: they end their turn, and the bandits take their chances.
    if (fightNow(host, game.id).options) assert.equal(host.as(identity(1)).fightTurn({ act: "end_turn" }), undefined);
    host.advance(5000);
    host.fightSteps();
    saved = events(host, fightNow(host, game.id)).find(e => e.kind === "turn" && e.actor === "player" && e.detail.lines.some(l => /^Your death save: \d+: (success|failure|natural 20!)/.test(l)));
  }
  assert.ok(saved, "a death save, at the start of the player's turn");
  assert.match(saved!.caption, /^Round \d+: your turn(, on the floor)?\.$/);
  for (const e of events(host, fightNow(host, game.id))) for (const h of e.detail.hits) assert.notEqual(h.state === "dead" && h.unit === "player", true, "the player never dies");
});

test("a fight that keeps the player writes their hit points back to the sheet at its end; a zoo ring's leaves the sheet as it was", () => {
  const kept = onMap("fighter", 12);
  hurtTo(kept.host, kept.playerId, 10);
  started(kept.host, kept.playerId, room([{ id: "bandit", at: { x: 10, y: 5 } }], { x: 1, y: 1 }, { keep: true }));
  toPlayer(kept.host, kept.game.id);
  const hp = board(kept.host, kept.game.id).units["player"]!.hp;
  assert.ok(hp <= 10);
  assert.equal(kept.host.db.sheet.playerId.find(kept.playerId)!.hp, 28, "the sheet as it was before the fight");
  assert.equal(kept.host.as(kept.wren).fightTurn({ act: "yield" }), undefined);
  assert.equal(kept.host.db.sheet.playerId.find(kept.playerId)!.hp, hp, "written back as the fight left them");
  assert.match(kept.host.db.sheet.playerId.find(kept.playerId)!.statusLine, new RegExp(`^HP ${hp}/28`));

  const practice = onMap("fighter", 12);
  hurtTo(practice.host, practice.playerId, 10);
  const before = practice.host.db.rulesState.playerId.find(practice.playerId)!.campaign;
  assert.equal(practice.host.as(practice.wren).startRing({ ring: "practice" }), undefined);
  assert.equal(board(practice.host, practice.game.id).units["player"]!.hp, 28, "the ring rests them first (fresh)");
  toPlayer(practice.host, practice.game.id);
  assert.equal(practice.host.as(practice.wren).fightTurn({ act: "yield" }), undefined);
  assert.equal(practice.host.db.rulesState.playerId.find(practice.playerId)!.campaign, before, "their character untouched");
});

test("each option says what the screen shows of it: its name, what it costs, where it's aimed and at whom, how far it reaches; and the tiles a walk to would draw a swing", () => {
  const { host, playerId, game, wren } = onMap();
  started(host, playerId, room([{ id: "bandit", at: { x: 3, y: 3 } }, { id: "far", name: "a far bandit", at: { x: 9, y: 3 } }], { x: 2, y: 3 }));
  toPlayer(host, game.id);
  const o = options(host, game.id)!;
  const by = (id: string) => o.actions.find(a => a.id === id)!;
  assert.deepEqual({ ...by("attack@3,3"), label: undefined }, { id: "attack@3,3", label: undefined, kind: "attack", name: "Attack", cost: "action", at: { x: 3, y: 3 }, target: "bandit", range: 5 });
  assert.deepEqual([by("shove@3,3").name, by("shove@3,3").cost, by("shove@3,3").range], ["Shove", "action", 5]);
  assert.deepEqual([by("grapple@3,3").name, by("grapple@3,3").target], ["Grab", "bandit"]);
  const close = o.actions.find(a => a.kind === "move" && a.name === "Close in on a far bandit")!;
  assert.equal(close.cost, "move");
  assert.ok(close.feet! > 0 && close.at && close.id === `walk@${close.at.x},${close.at.y}`);
  assert.deepEqual([by("dash").cost, by("dodge").name, by("end_turn").cost, by("auto").name], ["action", "Dodge", "free", "Let the dice decide"]);
  assert.equal(o.speed, board(host, game.id).units["player"]!.speed, "their speed, not dashed");
  // Away from the bandit beside them is a swing; a step that keeps beside him isn't.
  assert.ok(o.swings?.some(t => t.x === 1 && t.y === 3), "west, out of his reach: a swing");
  assert.ok(!o.swings?.some(t => t.x === 2 && t.y === 2), "a step that keeps beside him: none");
  for (const t of o.swings ?? []) assert.ok(o.moves.some(m => m.x === t.x && m.y === t.y), "each one a tile they can reach");
  // Disengaged, none; and the action's spent, so no blows on offer.
  assert.equal(host.as(wren).fightTurn({ act: "disengage" }), undefined);
  const after = options(host, game.id)!;
  assert.equal(after.swings, undefined);
  assert.equal(after.actionUsed, true);
  assert.ok(!after.actions.some(a => a.cost === "action"));
});

test("a spell's option says its range, a bonus action's cost and an area's tiles", () => {
  const { host, playerId, game } = onMap("wizard");
  started(host, playerId, room([{ id: "bandit", at: { x: 3, y: 3 } }, { id: "far", name: "a far bandit", at: { x: 8, y: 3 } }], { x: 2, y: 3 }));
  toPlayer(host, game.id);
  const o = options(host, game.id)!;
  const bolt = o.actions.find(a => a.id === "cast_fire-bolt@8,3")!;
  assert.deepEqual([bolt.name, bolt.cost, bolt.range, bolt.target], ["Fire Bolt", "action", 120, "far"]);
  const cone = o.actions.find(a => a.id === "cast_burning-hands@3,3")!;
  assert.deepEqual([cone.name, cone.range], ["Burning Hands", 15]);
  assert.ok(cone.area!.some(t => t.x === 3 && t.y === 3) && !cone.area!.some(t => t.x === 2 && t.y === 3), "the cone's tiles, aimed at the bandit");
});

test("a hit says how its target stood as the moment began, so a screen that sees it late can wind it back", () => {
  const { host, playerId, game, wren } = onMap();
  started(host, playerId, room([{ id: "bandit", at: { x: 3, y: 3 } }], { x: 2, y: 3 }));
  toPlayer(host, game.id);
  const before = board(host, game.id).units["bandit"]!;
  for (let i = 0; i < 4; i++) {
    const seen = fightNow(host, game.id).seq;
    if (!options(host, game.id)?.actions.some(a => a.id === "attack@3,3")) break;
    assert.equal(host.as(wren).attack({ how: "attack", at: { x: 3, y: 3 } }), undefined);
    const hit = events(host, fightNow(host, game.id)).filter(e => e.seq > seen).flatMap(e => e.detail.hits).find(h => h.unit === "bandit");
    if (!hit) continue;
    assert.deepEqual(hit.was, { hp: before.hp, state: "fighting", at: { x: 3, y: 3 } });
    assert.equal(hit.hp, Math.max(0, before.hp - hit.damage.reduce((n, d) => n + d.amount, 0)));
    return;
  }
  assert.fail("no blow landed in four tries");
});

test("hurry, the screen's skip to your turn: the other side's turns before the player's played at once, each its moments; on the player's turn it does nothing, and a spectator can't", () => {
  const { host, playerId, game, wren } = onMap();
  const tom = identity(2);
  assert.equal(host.as(tom).joinGame({ game: game.id }), undefined);
  started(host, playerId, room([{ id: "bandit-1", at: { x: 9, y: 1 } }, { id: "bandit-2", name: "another bandit", at: { x: 9, y: 5 } }], { x: 2, y: 3 }));
  toPlayer(host, game.id);
  const mine = fightNow(host, game.id);
  assert.equal(host.as(wren).fightTurn({ act: "hurry" }), undefined, "on the player's own turn: nothing to do");
  assert.equal(fightNow(host, game.id).seq, mine.seq, "and nothing written");
  assert.equal(host.as(wren).fightTurn({ act: "end_turn" }), undefined);
  const theirs = fightNow(host, game.id);
  assert.equal(theirs.options, "");
  assert.equal(host.as(tom).fightTurn({ act: "hurry" })?.code, "not_controller");
  assert.equal(host.as(wren).fightTurn({ act: "hurry" }), undefined);
  const back = fightNow(host, game.id);
  assert.ok(back.options || back.status !== "on", "the turn's come round to the player (or the fight's over), with no step on the clock played");
  const played = events(host, back).filter(e => e.seq > theirs.seq);
  // Each bandit's turn played (its moves and blows: the first one's turn began as the player's ended), and the player's begun.
  for (const id of ["bandit-1", "bandit-2"]) assert.ok(played.some(e => e.actor === id && e.kind !== "turn") || board(host, game.id).units[id]!.state !== "fighting", `${id}'s turn was played`);
  if (back.options) assert.equal(played[played.length - 1]!.kind === "turn" && played[played.length - 1]!.actor, "player");
  assert.equal(host.fightSteps(), 0, "the step on the clock finds nothing to do");
});
