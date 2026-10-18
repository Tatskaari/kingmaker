import assert from "node:assert/strict";
import { test } from "node:test";
import { Timestamp } from "spacetimedb";
import type { FightBoard } from "../../shared/fight/types.ts";
import type { GameRow } from "../backend.ts";
import { CAERWYN, StubBackend } from "../check/stub.ts";
import { ZOO_ROW } from "../check/zoo.ts";
import { withZoo, zooAct, zooActions } from "./text.ts";
import { again, firstBuild, isVisit, pickFoes, visit, visitOf, zooFightOf, zooOf } from "./zoo.ts";

/** The zoo as the client sees it (M6): its exhibits and builds from its row, a visit kept apart, a zoo fight's line-ups, the moves, and the headless client's words for them. */

const game = (id: bigint, campaign: string, minutes: number): GameRow => ({
  gameId: id, name: "Wren Ashdown", time: "afternoon", where: "in the zoo", hook: "", begun: true, campaign,
  lastPlayedAt: Timestamp.fromDate(new Date(Date.UTC(2026, 9, 18, 9, 0) - minutes * 60_000)),
});

/** A zoo fight's board, as far as the zoo reads it. */
const board = (zoo: FightBoard["zoo"]) => ({ board: { zoo } as FightBoard });

test("the zoo as installed: its combat ring and line-ups, and who a visitor can be; none when it isn't installed", () => {
  assert.equal(zooOf({ campaigns: [CAERWYN] }), undefined);
  const zoo = zooOf({ campaigns: [CAERWYN, ZOO_ROW] })!;
  assert.equal(zoo.title, "The zoo");
  assert.deepEqual(zoo.exhibits.map(e => [e.id, e.title]), [["ring", "The combat ring"]]);
  assert.deepEqual(zoo.builds.map(b => b.title), ["The fighter", "The wizard", "The rogue"]);
  assert.match(zoo.builds[0]!.concept, /ex-sergeant of the river watch/);
  assert.equal(firstBuild(zoo), "fighter");
});

test("a visit is kept apart from the story's games: the player's latest", () => {
  const rows = { games: [game(1n, "caerwyn", 0), game(2n, "zoo", 30), game(3n, "zoo", 5), { ...game(4n, "caerwyn", 1), campaign: undefined }] };
  assert.deepEqual(rows.games.map(isVisit), [false, true, true, false], "a game whose summary doesn't say is the story's");
  assert.equal(visitOf(rows)?.gameId, 3n);
  assert.equal(visitOf({ games: [game(1n, "caerwyn", 0)] }), undefined);
});

test("a fight from the ring: its exhibit, its line-ups and the one fought; and the headless client's actions for it", () => {
  const rows = { campaigns: [CAERWYN, ZOO_ROW] };
  assert.equal(zooFightOf(board(undefined), rows), undefined, "a fight from the story or the arena's rings isn't the zoo's");
  assert.equal(zooFightOf(board({ exhibit: "ring", foes: "sallow" }), { campaigns: [CAERWYN] }), undefined, "nor with the zoo gone");
  const fight = zooFightOf(board({ exhibit: "ring", foes: "crakes" }), rows)!;
  assert.deepEqual([fight.exhibit.id, fight.foes.id, fight.lineUps.map(l => l.id)], ["ring", "crakes", ["sallow", "crakes", "dogs"]]);

  assert.deepEqual(zooActions(fight), [
    "- again: Fight it again (The Crakes alone, everyone whole)",
    "- foes_sallow: Fight Sallow and the Crakes instead (Master Sallow with his sword-cane, fighting from behind the Crake brothers: the Heron's fight, on open sand)",
    "- foes_dogs: Fight a pack of dogs instead (Three mastiffs off the wharves: fast, and they bite to bring you down)",
  ]);
  assert.equal(withZoo("MODE: fight\n\nACTIONS:\n- end_turn: End your turn", fight, false), `MODE: fight\n\nACTIONS:\n- end_turn: End your turn\n${zooActions(fight).join("\n")}`);
  assert.equal(withZoo("MODE: fight\n\nThe others act.", fight, false), `MODE: fight\n\nThe others act.\n\nACTIONS:\n${zooActions(fight).join("\n")}`, "the header, when the fight has no actions of its own");
  assert.equal(withZoo("MODE: fight", fight, true), "MODE: fight", "a spectator has none");
  assert.deepEqual([zooAct("again", fight), zooAct("foes_dogs", fight), zooAct("foes_wolves", fight), zooAct("end_turn", fight), zooAct("again", undefined)], [{ again: true }, { foes: "dogs" }, undefined, undefined, undefined]);
});

test("the moves: a visit (visit_zoo, every argument said), again and other foes (open_exhibit)", async () => {
  const backend = new StubBackend({ campaigns: [CAERWYN, ZOO_ROW] });
  assert.equal(await visit(backend, { exhibit: "ring", build: "wizard" }), undefined);
  const fight = zooFightOf(board({ exhibit: "ring", foes: "sallow" }), backend.rows)!;
  assert.equal(await again(backend, fight), undefined);
  assert.equal(await pickFoes(backend, fight, "dogs"), undefined);
  assert.deepEqual(backend.moves, [
    { name: "visitZoo", args: { exhibit: "ring", build: "wizard", name: undefined, foes: undefined, fast: undefined } },
    { name: "openExhibit", args: { exhibit: "ring", foes: undefined, fast: undefined } },
    { name: "openExhibit", args: { exhibit: "ring", foes: "dogs", fast: undefined } },
  ]);
});
