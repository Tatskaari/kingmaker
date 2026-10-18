import { test } from "node:test";
import assert from "node:assert/strict";
import { PACE, partsOf, playMs, stepDelayMs, MOST_MS } from "./pace.ts";
import type { FightEvent, FightHit, FightRoll } from "./types.ts";

/**
 * The pace table (M6, docs/combat-design.md §3): a moment's parts laid out one after another, each
 * from where the last ended, so the screen's playback and the simulation's spacing of the other
 * side's turns agree: a turn's beat before its start, a path a tile at a time, the act, what it did,
 * each fall in turn, and the caption held to its least time.
 */

const roll = (over: Partial<FightRoll> = {}): FightRoll => ({ by: "wolf", target: "player", with: "Bite", d20: [14], bonus: 4, total: 18, ac: 15, hit: true, critical: false, ...over });
const hit = (over: Partial<FightHit> = {}): FightHit => ({ unit: "player", damage: [{ amount: 7, type: "piercing" }], healed: 0, hp: 5, maxHp: 12, state: "fighting", fell: false, gained: [], lost: [], ...over });
const moment = (kind: FightEvent["kind"], detail: Partial<FightEvent["detail"]> = {}): Pick<FightEvent, "kind" | "detail"> => ({ kind, detail: { rolls: [], hits: [], lines: [], ...detail } });

test("a wolf's bite after a walk: the steps a tile at a time, the swing, then the hit; one after another", () => {
  const e = moment("attack", { path: [{ x: 1, y: 1 }, { x: 2, y: 2 }], rolls: [roll()], hits: [hit()] });
  assert.deepEqual(partsOf(e), [
    { part: "steps", t: 0, ms: 2 * PACE.tile },
    { part: "swing", t: 2 * PACE.tile, ms: PACE.swing },
    { part: "hit", t: 2 * PACE.tile + PACE.swing, ms: PACE.hit },
  ]);
  assert.equal(playMs(e), 2 * PACE.tile + PACE.swing + PACE.hit);
});

test("a turn's start has the beat between combatants before it; a bow's shot flies; a spell's area lights up", () => {
  const played = (e: Pick<FightEvent, "kind" | "detail">) => partsOf(e).map(p => p.part).filter(p => p !== "hold");
  assert.deepEqual(played(moment("turn")), ["beat", "turn"]);
  assert.equal(playMs(moment("turn")), Math.max(PACE.caption, PACE.beat + PACE.turn), "its caption up for its least time");
  assert.deepEqual(played(moment("attack", { rolls: [roll({ with: "Shortbow", hit: false })] })), ["projectile", "hit"]);
  // An opportunity attack is a swing, whatever's in hand.
  assert.deepEqual(played(moment("attack", { rolls: [roll({ with: "Shortbow", opportunity: true })] })), ["swing", "hit"]);
  assert.deepEqual(played(moment("cast", { area: [{ x: 3, y: 3 }], hits: [hit()] })), ["area", "hit"]);
  assert.deepEqual(played(moment("cast", { rolls: [roll({ with: "Fire Bolt" })], hits: [hit()] })), ["projectile", "hit"]);
});

test("a miss still has its moment to show it; each fall plays in turn; a caption with nothing under it is held to its least time", () => {
  const miss = moment("attack", { rolls: [roll({ hit: false })] });
  assert.deepEqual(partsOf(miss).map(p => p.part), PACE.swing + PACE.hit < PACE.caption ? ["swing", "hit", "hold"] : ["swing", "hit"]);
  assert.equal(playMs(miss), Math.max(PACE.caption, PACE.swing + PACE.hit), "a caption with less under it than its least time is held up to it");
  const two = moment("cast", { area: [{ x: 1, y: 1 }], hits: [hit({ unit: "a", fell: true, state: "down" }), hit({ unit: "b", fell: true, state: "down" })] });
  assert.deepEqual(partsOf(two).map(p => p.part), ["area", "hit", "fall", "fall"]);
  assert.equal(playMs(two), PACE.area + PACE.hit + 2 * PACE.fall);
  assert.deepEqual(partsOf(moment("dodge")), [{ part: "hold", t: 0, ms: PACE.caption }]);
  assert.equal(playMs(moment("start")), PACE.start);
  // A shove is a swing too, then what it did.
  assert.deepEqual(partsOf(moment("wrestle", { hits: [hit({ damage: [], gained: ["prone"] })] })).map(p => p.part).filter(p => p !== "hold"), ["swing", "hit"]);
});

test("the simulation waits for the moments just written to play, five seconds at the most", () => {
  const bite = moment("attack", { rolls: [roll()], hits: [hit()] });
  assert.equal(stepDelayMs([moment("turn"), bite]), playMs(moment("turn")) + playMs(bite));
  assert.equal(stepDelayMs(Array.from({ length: 20 }, () => bite)), MOST_MS);
});
