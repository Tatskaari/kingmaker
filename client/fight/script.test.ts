import assert from "node:assert/strict";
import { test } from "node:test";
import { PACE, playMs } from "../../shared/fight/pace.ts";
import type { FightEvent, FightHit } from "../../shared/fight/types.ts";
import { WOLVES } from "../check/fight.ts";
import { scriptLine, scriptOf, type Beat } from "./script.ts";

/**
 * A moment as the screen plays it (M6's screen, docs/combat-design.md §3), beat by beat, on the
 * recorded wolf run (check/fixtures/fight-wolves.json) and a spell made up for it: a walk a tile at a
 * time, a bite's flash and what it did, a miss, a turn's beat before the bar moves on, a wolf giving
 * up, a critical that puts one down, an area that catches two who fall in turn; every recorded
 * moment taking as long on screen as the simulation waits for it; and the beats as one headless line.
 */

const moment = (seq: number): FightEvent => WOLVES.events.find(e => e.seq === seq)!;
/** The beats that show something (a caption's hold up to its least time aside). */
const shown = (beats: Beat[]) => beats.filter(b => b.kind !== "hold");
const kinds = (beats: Beat[]) => shown(beats).map(b => b.kind);
const name = (id: string) => (id === "player" ? "you" : id);

test("a wolf's walk: a step a tile, each a tile's time after the last, numbered; the walk the moment's time", () => {
  const walk = moment(8);
  const s = scriptOf(walk);
  assert.deepEqual(shown(s.beats).map(b => (b.kind === "step" ? [b.t, b.n, b.to.x, b.to.y] : b.kind)), walk.detail.path!.map((t, i) => [i * PACE.tile, i + 1, t.x, t.y]));
  assert.equal(s.ms, Math.max(PACE.caption, 6 * PACE.tile), "the walk's time, or its caption's least time if that's longer");
  assert.equal(scriptLine(walk, name), "▸ walks 3,2 → 3,3 → 3,4 → 3,5 → 3,6 → 3,7 → 3,8");
});

test("a bite that lands: the flash between them, then what it did all at once (the damage, the fall to the floor as a condition)", () => {
  const bite = moment(14);
  const s = scriptOf(bite);
  assert.deepEqual(kinds(s.beats), ["swing", "hit", "tag"]);
  const [swing, hit, tag] = shown(s.beats) as [Extract<Beat, { kind: "swing" }>, Extract<Beat, { kind: "hit" }>, Extract<Beat, { kind: "tag" }>];
  assert.deepEqual([swing.t, swing.ms, swing.by, swing.target, swing.with], [0, PACE.swing, "wolf-3", "player", "Wolf Bite"]);
  assert.deepEqual(swing.to, { x: 4, y: 9 });
  assert.deepEqual([hit.t, hit.unit, hit.amount, hit.type, hit.critical], [PACE.swing, "player", 8, "piercing", false]);
  assert.deepEqual([tag.unit, tag.condition, tag.gained], ["player", "prone", true]);
  assert.equal(s.hitAt, PACE.swing);
  assert.equal(scriptLine(bite, name), "▸ wolf bite swing at you · you hit: 8 piercing · you now prone");
});

test("a miss puffs off them; a turn has its beat before the bar moves on; a wolf that gives up says so", () => {
  const miss = scriptOf(moment(4));
  assert.deepEqual(shown(miss.beats).map(b => (b.kind === "miss" ? `${b.kind}:${b.unit}:${b.word}` : b.kind)), ["swing", "miss:player:miss"]);
  const turn = scriptOf(moment(5));
  assert.deepEqual(shown(turn.beats).map(b => [b.kind, b.t, b.ms]), [["pause", 0, PACE.beat], ["turn", PACE.beat, PACE.turn]]);
  assert.equal(turn.turnAt, PACE.beat);
  assert.equal((turn.beats[1] as Extract<Beat, { kind: "turn" }>).unit, "player");
  const yielded = scriptOf(moment(18));
  assert.deepEqual(yielded.beats.map(b => (b.kind === "gone" ? `gone:${b.unit}:${b.state}` : b.kind)), ["gone:wolf-1:surrendered", "hold"]);
  assert.equal(yielded.ms, Math.max(PACE.caption, PACE.hit));
});

test("a critical that puts a wolf down: the swing, the hit (a critical), then the fall, in turn (out cold goes without saying: the fall says it)", () => {
  const s = scriptOf(moment(30));
  assert.deepEqual(kinds(s.beats), ["swing", "hit", "fall"]);
  const hit = s.beats[1] as Extract<Beat, { kind: "hit" }>, fall = s.beats[2] as Extract<Beat, { kind: "fall" }>;
  assert.deepEqual([hit.amount, hit.critical], [11, true]);
  assert.deepEqual([fall.t, fall.ms, fall.unit, fall.state], [PACE.swing + PACE.hit, PACE.fall, "wolf-2", "down"]);
  assert.match(scriptLine(moment(30), name)!, /^▸ longsword swing at wolf-2 · wolf-2 hit: 11 slashing, critical · wolf-2 goes down$/);
  assert.match(scriptLine(moment(30), id => (id === "wolf-2" ? "you" : id))!, / · you hit: 11 slashing, critical · you go down$/, "said of the player, the player's verb");
});

test("an area: its tiles lit, then everyone it caught at once (a save among them), then each fall in turn", () => {
  const caught = (unit: string, extra: Partial<FightHit> = {}): FightHit => ({ unit, damage: [{ amount: 9, type: "fire" }], healed: 0, hp: 0, maxHp: 9, state: "down", fell: true, gained: [], lost: [], ...extra });
  const fireball: FightEvent = {
    seq: 1, round: 1, turn: "player", kind: "cast", actor: "player", caption: "You cast Burning Hands, catching two wolves.",
    detail: { at: { x: 5, y: 5 }, with: "Burning Hands", spell: "burning-hands", element: "fire", area: [{ x: 5, y: 5 }, { x: 6, y: 5 }], rolls: [], lines: [], hits: [caught("wolf-1"), caught("wolf-2", { saved: true, damage: [{ amount: 4, type: "fire" }], hp: 5, state: "fighting", fell: false })] },
  };
  const s = scriptOf(fireball);
  assert.deepEqual(kinds(s.beats), ["area", "hit", "hit", "save", "fall"]);
  const area = s.beats[0] as Extract<Beat, { kind: "area" }>;
  assert.deepEqual([area.spell, area.element, area.tiles.length, area.ms], ["Burning Hands", "fire", 2, PACE.area]);
  assert.equal(s.ms, PACE.area + PACE.hit + PACE.fall);
  assert.equal(scriptLine(fireball, name), "▸ Burning Hands lights 2 tiles round 5,5 (fire) · wolf-1 hit: 9 fire · wolf-2 hit: 4 fire · wolf-2 saves · wolf-1 goes down");
});

test("every recorded moment takes as long on screen as the simulation waits for it, and its beats fit in it", () => {
  for (const e of WOLVES.events) {
    const s = scriptOf(e);
    assert.equal(s.ms, playMs(e), `${e.seq} ${e.kind}`);
    for (const b of s.beats) assert.ok(b.t >= 0 && b.t + b.ms <= s.ms, `${e.seq}'s ${b.kind} fits`);
  }
});
