import assert from "node:assert/strict";
import { test } from "node:test";
import type { FightBoard, FightEvent, FightOptions } from "../../shared/fight/types.ts";
import type { MapFile } from "../../shared/map/tiles.ts";
import { fightText, eventLines } from "./text.ts";
import { fightViewOf, myTurn, type FightRows } from "./view.ts";

/**
 * The fight as the headless client prints it (M6, docs/combat-design.md §7), from rows as a client
 * holds them: the player's turn with what's left of it, the board with the tiles they can reach,
 * the moments with their dice, and ACTIONS by id; a spectator's, which says whose turn it is by name
 * and has no actions; and its end, whose one action is out.
 */

const MAP: MapFile = {
  id: "zoo-test", name: "A test ring", regions: [], exits: [{ at: { x: 2, y: 3 }, to: { map: "zoo-test", at: { x: 2, y: 3 } }, label: "the gate" }],
  grid: ["#####", "#...#", "#...#", "##+##"], legend: { "#": { terrain: "wall" }, ".": { terrain: "floor" }, "+": { terrain: "door" } },
};

const unit = (id: string, name: string, at: { x: number; y: number }, extra: Partial<FightBoard["units"][string]> = {}): FightBoard["units"][string] => ({
  id, name, called: id === "player" ? "you" : name, side: id === "player" ? "player" : "enemy", role: id === "player" ? "player" : "brawler", engineId: `e-${id}`, weapons: [],
  at, hp: 10, maxHp: 10, ac: 12, speed: 30, initiative: id === "player" ? 15 : 12, state: "fighting", conditions: [], glyph: id === "player" ? "@" : "B", color: "#fff", ...extra,
});

const BOARD: FightBoard = {
  encounterId: "enc", order: ["player", "bandit"], active: 0, round: 2, dust: [], fire: [], fuel: [], props: {}, exits: [{ at: { x: 2, y: 3 }, label: "the gate" }], pc: "player", flags: {}, place: "the Arena",
  units: { player: unit("player", "Wren Ashdown", { x: 1, y: 1 }, { hp: 7, maxHp: 10 }), bandit: unit("bandit", "a bandit", { x: 3, y: 2 }, { hp: 4, maxHp: 11, conditions: ["prone"] }) },
};

const MOMENT: FightEvent = {
  seq: 5, round: 1, turn: "bandit", kind: "attack", actor: "bandit", target: "player", caption: "A bandit swings at you: 3 damage.",
  detail: { rolls: [], hits: [], lines: ["Scimitar: a bandit's attack on you: 14 +3 = 17 vs AC 12: hit", "Damage: 1d6+1 (2+1) slashing", "You take 3 slashing damage (HP 7/10)"] },
};

const OPTIONS: FightOptions = {
  movementLeft: 30, actionUsed: false, bonusActionUsed: true, moves: [{ x: 2, y: 1 }, { x: 2, y: 2 }],
  actions: [{ id: "walk@2,2", label: "Close in on a bandit (5 ft)", kind: "move" }, { id: "end_turn", label: "End your turn", kind: "turn" }],
};

function rows(over: Partial<FightRows["fight"]> = {}, me = 1n): FightRows {
  return {
    me, game: 3n, owner: "Wren Ashdown",
    fight: { id: 9n, playerId: 1n, title: "A test ring", place: "the Arena", map: JSON.stringify(MAP), status: "on", round: 2, turn: "player", order: BOARD.order, board: JSON.stringify(BOARD), options: JSON.stringify(OPTIONS), ...over },
    events: [{ seq: MOMENT.seq, round: MOMENT.round, turn: MOMENT.turn, kind: MOMENT.kind, actor: MOMENT.actor, target: MOMENT.target, caption: MOMENT.caption, detail: JSON.stringify(MOMENT.detail) }],
  };
}

test("the player's turn: what's left of it, the order with hit points, the board with the tiles in reach marked, the moments with their dice, and ACTIONS", () => {
  const view = fightViewOf(rows())!;
  assert.equal(myTurn(view), true);
  const text = fightText(view);
  assert.match(text, /^MODE: fight\n\nA test ring \(the Arena\): your turn\. 30 ft to move, action ready, bonus action spent\.\n\n/);
  assert.match(text, /Order, round 2:\n▶ 15  @  you \(Wren Ashdown\) +7\/10 HP\n {2}12 {2}B {2}a bandit +4\/11 HP \(prone\)\n/);
  assert.match(text, /\n {3}01234\n 0 #####\n 1 #@·\.#\n 2 #\.·B#\n 3 ##\+##\n/, "the board, the reachable tiles marked");
  assert.match(text, /What happened:\nA bandit swings at you: 3 damage\.\n {4}▸ swing at you\n {4}Scimitar: a bandit's attack on you: 14 \+3 = 17 vs AC 12: hit\n/, "the caption, what the screen plays of it, its dice");
  assert.match(text, /\n\nACTIONS:\n- walk@2,2: Close in on a bandit \(5 ft\)\n- end_turn: End your turn\n- walk@x,y: Move to any tile marked · \(30 ft left\), a tile at a time$/);
});

test("a spectator's: whose turn by name, the fight's owner, and no actions", () => {
  const text = fightText(fightViewOf(rows({}, 2n))!);
  assert.match(text, /: Wren Ashdown's turn\.\n/);
  assert.match(text, /\(You're watching: it's Wren Ashdown's fight\.\)$/);
  assert.doesNotMatch(text, /ACTIONS/);
});

test("the other side's turn, and the end: out is the one action once it's over", () => {
  assert.match(fightText(fightViewOf(rows({ turn: "bandit", options: "" }))!), /: a bandit's turn: the other side acts a turn at a time \(observe again in a moment\)\.\n/);
  const over = fightText(fightViewOf(rows({ status: "over", outcome: "victory", turn: "", options: "", result: JSON.stringify({ outcome: "victory", summary: "A bandit went down. It took 2 rounds.", casualties: [], rounds: 2, flags: {}, positions: {} }) }))!);
  assert.match(over, /^MODE: fight\n\nA test ring \(the Arena\): it's over \(victory\)\. A bandit went down\. It took 2 rounds\.\n/);
  assert.match(over, /\n\nACTIONS:\n- out: Back to the map$/);
  // A turn's moment is a heading; a remark's line isn't said twice.
  assert.deepEqual(eventLines([{ ...MOMENT, kind: "turn", caption: "Round 2: your turn.", detail: { rolls: [], hits: [], lines: [] } }, { ...MOMENT, kind: "say", caption: "'Hold still.'", detail: { rolls: [], hits: [], lines: ["'Hold still.'"] } }]), ["— Round 2: your turn.", "'Hold still.'"]);
});

test("each moment as the screen plays it, a line under its caption: the walk's tiles, the bite, what it did; the moments of a whole recorded fight read so", async () => {
  const { WOLVES, wolvesAt } = await import("../check/fight.ts");
  const view = wolvesAt(WOLVES.frames.length - 1);
  const lines = eventLines(view.events, view.board);
  assert.ok(lines.includes("A grey wolf closes in on you, 30 ft."));
  assert.equal(lines[lines.indexOf("A grey wolf closes in on you, 30 ft.") + 1], "    ▸ walks 3,2 → 3,3 → 3,4 → 3,5 → 3,6 → 3,7 → 3,8");
  const bite = lines.indexOf("A lean grey wolf bites you: 8 damage.");
  assert.equal(lines[bite + 1], "    ▸ wolf bite swing at you · you hit: 8 piercing · you now prone");
  assert.equal(lines[bite + 2], "    Wolf Bite: a lean grey wolf's attack on you: 18/10 (advantage) +4 = 22 vs AC 18: hit", "then its dice");
  assert.ok(lines.some(l => /^ {4}▸ longsword swing at a big grey wolf · a big grey wolf hit: 11 slashing, critical · a big grey wolf now unconscious · a big grey wolf goes down$/.test(l)), "a critical that puts one down");
  assert.ok(lines.some(l => l === "    ▸ a grey wolf gives up"), "a wolf yielding");
  // observe's What happened has them too.
  assert.match(fightText(view), /What happened:[\s\S]*▸ /);
});
