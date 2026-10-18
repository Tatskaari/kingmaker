import assert from "node:assert/strict";
import { test } from "node:test";
import { PACE, playMs } from "../../shared/fight/pace.ts";
import { WOLVES, frameOf, wolvesAt } from "../check/fight.ts";
import { FightPlayer } from "./player.ts";

/**
 * The fight played back (M6's screen, docs/combat-design.md §3), on the recorded wolf run: a fight
 * already on starts where it is; the rows' new moments play one after another from when they came,
 * a walk a tile at a time, a bite landing at its beat (the hit points dropping, the one bitten lit
 * up), a wolf tipping over as it falls; a key finishes the moment playing, another skips to the
 * player's turn; reduced motion shows each moment's end at once with its caption; a fight seen from
 * its start is wound back to how it began; and the redraws fall where what's shown changes.
 */

const T0 = 10_000;
const wolf1 = frameOf("step: wolf-1");
const wolf2 = frameOf("step: wolf-2");

test("a fight already on starts where it is: everyone as the board has them, the moments so far in the log, nothing to play", () => {
  const view = wolvesAt(frameOf("you: end_turn"));
  const p = new FightPlayer(view, T0);
  assert.equal(p.caughtUp, true);
  const f = p.frame(T0);
  assert.deepEqual(f.stances["wolf-1"]!.at, view.board.units["wolf-1"]!.at);
  assert.equal(f.turn, "wolf-1");
  assert.equal(f.caption, "Round 1: a grey wolf's turn.");
  assert.deepEqual(p.log.map(l => l.seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(f.playing, undefined);
});

test("the grey wolf's turn as it comes: its walk a tile at a time from when it came, then its bite (a miss), then the next turn's beat; caught up, the board's own", () => {
  const p = new FightPlayer(wolvesAt(wolf1 - 1), T0);
  p.see(wolvesAt(wolf1), T0);
  const walk = WOLVES.events.find(e => e.seq === 8)!;
  assert.equal(p.caughtUp, false);
  // Two and a half tiles' time in: the third step taken (each beat lands at its start).
  let f = p.frame(T0 + 2.5 * PACE.tile);
  assert.deepEqual(f.stances["wolf-1"]!.at, walk.detail.path![2]);
  assert.equal(f.caption, walk.caption);
  assert.equal(f.turn, "wolf-1");
  assert.equal(f.playing?.event.seq, 8);
  assert.deepEqual(p.log.map(l => l.seq).slice(-1), [8], "in the log as it begins");
  // Its bite, after the walk: at the end of the path, the miss's caption, the player unhurt.
  const biteAt = T0 + playMs(walk);
  f = p.frame(biteAt + 10);
  assert.deepEqual(f.stances["wolf-1"]!.at, { x: 3, y: 8 });
  assert.equal(f.caption, "A grey wolf snaps at you, and misses.");
  assert.equal(f.stances["player"]!.hp, 28);
  // The next turn's beat: the bar holds on the grey wolf, then moves on to the big one.
  const turnAt = biteAt + playMs(WOLVES.events.find(e => e.seq === 9)!);
  assert.equal(p.frame(turnAt + PACE.beat / 2).turn, "wolf-1", "the beat between combatants");
  f = p.frame(turnAt + PACE.beat + 10);
  assert.equal(f.turn, "wolf-2");
  assert.ok(f.fresh > 0.9, "their tile lit as the bar moves on");
  f = p.frame(turnAt + PACE.beat + PACE.turn + 1);
  assert.equal(p.caughtUp, true);
  assert.equal(f.playing, undefined);
  assert.equal(f.turn, "wolf-2");
});

test("a bite lands at its beat: the hit points drop then, the one bitten lit up as it lands and prone after it", () => {
  const before = frameOf("step: wolf-3", 1);
  const p = new FightPlayer(wolvesAt(before - 1), T0);
  p.see(wolvesAt(before), T0);
  assert.equal(p.frame(T0 + PACE.swing - 10).stances["player"]!.hp, 28, "not before the swing's done");
  const landing = p.frame(T0 + PACE.swing + 20);
  assert.equal(landing.stances["player"]!.hp, 20);
  assert.ok(landing.flash["player"], "lit up as it lands");
  assert.deepEqual(landing.stances["player"]!.conditions.filter(c => c === "prone"), ["prone"]);
  assert.equal(p.frame(T0 + PACE.swing + PACE.hit - 10).flash["player"], undefined, "the flash over before the beat is");
});

test("a wolf going down tips over through its fall's beat, then lies there", () => {
  const at = frameOf("you: auto");
  const p = new FightPlayer(wolvesAt(at - 1), T0);
  p.see(wolvesAt(at), T0);
  const fallAt = T0 + PACE.swing + PACE.hit;
  assert.equal(p.frame(fallAt - 10).stances["wolf-2"]!.state, "fighting");
  const falling = p.frame(fallAt + PACE.fall / 2);
  assert.equal(falling.stances["wolf-2"]!.state, "down");
  assert.ok(falling.falling["wolf-2"]! > 0.4 && falling.falling["wolf-2"]! < 0.6);
  assert.equal(p.frame(fallAt + PACE.fall + 1).falling["wolf-2"], undefined);
});

test("a key finishes the moment playing (the walk's end at once, the bite next from now); another skips to the player's turn, the moments after it played as they come", () => {
  const p = new FightPlayer(wolvesAt(wolf1 - 1), T0);
  p.see(wolvesAt(wolf1), T0);
  p.frame(T0 + 100);
  p.finish(T0 + 100);
  let f = p.frame(T0 + 101);
  assert.deepEqual(f.stances["wolf-1"]!.at, { x: 3, y: 8 }, "the walk's end");
  assert.equal(f.playing?.event.seq, 9, "the bite plays from now");
  p.skip(T0 + 120);
  f = p.frame(T0 + 120);
  assert.equal(p.caughtUp, true);
  assert.equal(f.turn, "wolf-2");
  assert.deepEqual(p.log.map(l => l.seq).slice(-3), [8, 9, 10], "every caption in the log");
  assert.equal(p.skippingOn, true, "it isn't the player's turn yet: the next moments come in played");
  p.see(wolvesAt(wolf2), T0 + 2000);
  assert.equal(p.caughtUp, true, "the big wolf's turn played as it came");
  p.see(wolvesAt(wolf2 + 1), T0 + 3000);
  assert.equal(p.caughtUp, true);
  assert.equal(p.skippingOn, false, "the player's turn: skipping's over");
  p.see(wolvesAt(wolf2 + 2), T0 + 4000);
  assert.equal(p.caughtUp, false, "and the player's own moments play again");
});

test("reduced motion: each moment's end at once, with its caption, for the caption's time; no effects", () => {
  const p = new FightPlayer(wolvesAt(wolf1 - 1), T0, { reduced: () => true });
  p.see(wolvesAt(wolf1), T0);
  let f = p.frame(T0 + 1);
  assert.deepEqual(f.stances["wolf-1"]!.at, { x: 3, y: 8 }, "the walk's end, at once");
  assert.equal(f.caption, "A grey wolf closes in on you, 30 ft.");
  f = p.frame(T0 + PACE.caption + 1);
  assert.equal(f.caption, "A grey wolf snaps at you, and misses.");
  assert.equal(p.fx.busy(T0 + PACE.caption + 1), false, "nothing flying");
  p.frame(T0 + 3 * PACE.caption + 1);
  assert.equal(p.caughtUp, true);
});

test("a fight seen from its start is wound back to how it began, and played from its first moment", () => {
  const p = new FightPlayer(wolvesAt(frameOf("step: wolf-3")), T0, { fromStart: true });
  const start = p.frame(T0 + 1);
  assert.deepEqual(start.stances["wolf-3"]!.at, { x: 9, y: 5 }, "where the lean wolf set out");
  assert.equal(start.playing?.event.kind, "start");
  assert.ok((start.revealed ?? 0) >= 1, "the order coming up");
  assert.equal(p.frame(T0 + PACE.start - 1).revealed, 4);
});

test("the redraws fall where what's shown changes: a moment's start, a blow landing, a fall, an end", () => {
  const at = frameOf("you: auto");
  const p = new FightPlayer(wolvesAt(at - 1), T0);
  p.see(wolvesAt(at), T0);
  const times: number[] = [];
  for (let t: number | undefined = T0; t !== undefined; t = p.nextChange(t)) times.push(t - T0);
  const hit = PACE.swing, fall = hit + PACE.hit;
  for (const want of [hit, fall, fall + PACE.fall]) assert.ok(times.includes(want), `${want} in ${times.join(", ")}`);
  assert.equal(p.nextChange(T0 + 100_000), undefined);
});
