import assert from "node:assert/strict";
import { test } from "node:test";
import { PACE } from "../../shared/fight/pace.ts";
import type { FightAct, FightOptions } from "../../shared/fight/types.ts";
import { SCREEN_KEYS } from "../../shared/map/explore.ts";
import { actionId, type MapMove } from "../../shared/map/moves.ts";
import { screenOf } from "../app/model.ts";
import { frameOf, wolvesAt } from "../check/fight.ts";
import { FightModel, menuEntries, menuGroups } from "./model.ts";

/**
 * The fight's screen as a model (M6's screen, docs/combat-design.md §2), on the recorded wolf run:
 * the player's options as the menu's lines, by what each spends (one a name, its targets aimed); the
 * player acts only once the other side's moves before their turn have played; aiming and doing it
 * as its move; walking where they can and why not where they can't; skipping to their turn sends
 * hurry; a spectator acts on nothing; and the app shows the fight while one is on.
 */

function staged(frame: number, me = 1n) {
  let now = 10_000;
  const moves: MapMove[] = [];
  const turns: FightAct[] = [];
  const model = new FightModel(wolvesAt(frame, me), {
    move: m => { moves.push(m); return Promise.resolve(undefined); },
    turn: a => { turns.push(a); return Promise.resolve(undefined); },
    out: () => Promise.resolve(undefined), quit: () => {},
  }, { now: () => now, timers: false });
  return { model, moves, turns, at: (ms: number) => { now = 10_000 + ms; } };
}

test("the menu: one line a name, its targets aimed (three wolves in reach, one Attack), by what each spends with what's left; a spent action a dimmed line", () => {
  const o = wolvesAt(frameOf("step: wolf-3", 1)).options!;
  const entries = menuEntries(o);
  const attack = entries.find(e => e.name === "Attack")!;
  assert.equal(attack.aims, true);
  assert.deepEqual(attack.options.map(a => a.id), ["attack@3,8", "attack@4,8", "attack@5,8"]);
  assert.equal(attack.summary, "3 in reach: Tab between them as you aim");
  assert.deepEqual(entries.find(e => e.name === "Dodge"), { name: "Dodge", summary: "attacks on you have disadvantage until your next turn", aims: false, options: [o.actions.find(a => a.id === "dodge")!] });
  const { groups, ordered } = menuGroups(entries, o);
  assert.deepEqual(groups.map(g => [g.title, g.note ?? ""]), [["Action", "ready"], ["Movement", `${o.movementLeft} ft left`], ["Your turn", ""]]);
  assert.deepEqual(ordered.map(e => e.name), groups.flatMap(g => g.lines.map(l => l.name)), "the lines in the menu's order");
  // Aimed at a wolf's tile: only what can be done to it.
  assert.deepEqual(menuEntries(o, { x: 4, y: 8 }).map(e => [e.name, e.options.map(x => x.id).join()]), [["Attack", "attack@4,8"], ["Shove", "shove@4,8"], ["Grab", "grapple@4,8"]]);
  // The action spent: no line spends it, and one says so.
  const spent = wolvesAt(frameOf("you: attack@3,8")).options!;
  const later = menuEntries(spent);
  assert.ok(!later.some(e => e.options[0]?.cost === "action"));
  assert.deepEqual(later.find(e => e.why), { name: "Your action", summary: "", why: "spent this turn", aims: false, options: [] });
  assert.equal(menuGroups(later, spent).groups[0]!.note, "spent");
});

test("the player acts once the other side's moves before their turn have played: the bite and their turn's start, then the menu", () => {
  const s = staged(frameOf("step: wolf-3", 1) - 1);
  s.model.update(wolvesAt(frameOf("step: wolf-3", 1)));
  assert.equal(s.model.canAct(), false, "the bite still to play");
  s.model.openMenu();
  assert.equal(s.model.menu, undefined);
  assert.match(s.model.status ?? "", /^Not yet: it isn't your turn/);
  s.at(PACE.swing + PACE.hit + PACE.beat + 20);
  assert.equal(s.model.canAct(), true, "their turn on the bar");
  s.model.openMenu();
  assert.ok(s.model.menu);
});

test("aiming: the nearest target first, Tab on round them, fire does it as its move; the menu's other lines done at once", async () => {
  const s = staged(frameOf("step: wolf-3", 1));
  s.model.openMenu();
  s.model.chooseFromMenu(s.model.menu!.entries.findIndex(e => e.name === "Attack"));
  assert.equal(s.model.aimed()?.id, "attack@3,8", "the nearest wolf (the player at 4,9)");
  s.model.aimNext();
  assert.equal(s.model.aimed()?.id, "attack@4,8");
  assert.equal(s.model.aimAt({ x: 5, y: 8 }), true);
  assert.equal(s.model.aimAt({ x: 9, y: 9 }), false, "not a target");
  s.model.fire();
  await Promise.resolve();
  assert.deepEqual(s.moves.map(m => actionId(m)), ["attack@5,8"]);
  assert.equal(s.model.aim, undefined);
  s.model.openMenu();
  s.model.chooseFromMenu(s.model.menu!.entries.findIndex(e => e.name === "Dodge"));
  await Promise.resolve();
  assert.deepEqual(s.turns, ["dodge"]);
});

test("walking: to a blue tile it's walk@, elsewhere why not; the arrows step with the screen; e ends the turn", async () => {
  const s = staged(frameOf("step: wolf-3", 1));
  const o = s.model.options as FightOptions;
  s.model.walkTo(o.moves[0]!);
  await Promise.resolve();
  assert.deepEqual(s.moves.map(m => actionId(m)), [`walk@${o.moves[0]!.x},${o.moves[0]!.y}`]);
  s.model.walkTo({ x: 12, y: 1 });
  assert.equal(s.model.status, `You can't get there this turn: ${o.movementLeft} ft of movement left (the blue tiles).`);
  // An arrow: the tile that way on screen (right is south-east on the map), when it's one they can reach.
  const me = s.model.view.board.units["player"]!.at;
  const key = Object.entries(SCREEN_KEYS).find(([, [dx, dy]]) => o.moves.some(m => m.x === me.x + dx && m.y === me.y + dy))!;
  s.model.step(key[0]);
  await Promise.resolve();
  assert.equal(actionId(s.moves[1]!), `walk@${me.x + key[1][0]},${me.y + key[1][1]}`);
  s.model.endTurn();
  await Promise.resolve();
  assert.deepEqual(s.turns, ["end_turn"]);
});

test("skipping to the player's turn plays what's left at once and sends hurry; on their own turn there's nothing to hurry; a spectator sends nothing", () => {
  const s = staged(frameOf("step: wolf-1") - 1);
  s.model.update(wolvesAt(frameOf("step: wolf-1")));
  s.model.skip();
  assert.deepEqual(s.turns, ["hurry"]);
  assert.equal(s.model.player.caughtUp, true);
  const mine = staged(frameOf("step: wolf-3", 1));
  mine.model.skip();
  assert.deepEqual(mine.turns, [], "their own turn: nothing to hurry");
  const watcher = staged(frameOf("step: wolf-1"), 2n);
  watcher.model.skip();
  watcher.model.openMenu();
  assert.deepEqual([watcher.turns, watcher.model.menu], [[], undefined]);
  assert.equal(watcher.model.notYet(), "It's Wren Ashdown's fight: you're watching.");
});

test("the app shows the fight while one is on (and its end until out), ahead of the map and a scene that's over", () => {
  const seat = { gameId: 1n };
  assert.equal(screenOf({ seat, sheet: true, scene: false, explore: true, fight: true }, "game"), "fight");
  assert.equal(screenOf({ seat, sheet: true, scene: false, explore: true }, "game"), "explore");
  assert.equal(screenOf({ seat: { gameId: 1n, sceneId: 4n }, sheet: true, scene: true, fight: true }, "game"), "fight");
  assert.equal(screenOf({ sheet: true, scene: false, fight: true }, "game"), "title", "no seat, no game");
});
