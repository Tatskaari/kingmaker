import { test } from "node:test";
import assert from "node:assert/strict";
import type { FightBoard, FightEvent } from "../../../shared/fight/types.ts";
import { OUT } from "../../../shared/map/moves.ts";
import type { ReplyResponse, SidesRequest, SidesResponse } from "../../../shared/protocol/ai.ts";
import type { SceneDocument } from "../../../shared/scene/document.ts";
import { all, openedGame, sceneNow } from "../host/testing.ts";
import type { MemoryHost } from "../host/memory.ts";
import { eventsOf, fightOf } from "./rows.ts";

/**
 * Who comes when a fight breaks out (docs/combat-gm.md; the user: "each scene should have a set of
 * characters that appear on scene when you start a fight so if you attack Cob or whatever, the guards
 * come after a few turns or a round"), in the yard with its porters and Old Wat after two rounds: the
 * GM places them as it places everyone (the sides step, told they come later and why); on the board
 * they're in the order from the start but not on it, and at the top of the third round they come in
 * at the yard gate, a moment of their own; once it's over they're in the yard's world.
 */

const usage = { calls: 1, costUsd: 0.001, byOperation: {} };

/** The tests' own yard, with its porters and Old Wat coming after two rounds, as the story's has them. */
const COMING = {
  edit: {
    "hanged-clerk": (doc: SceneDocument): SceneDocument => ({
      ...doc,
      reinforcements: [
        { id: "porters", name: "the granary porters", statblock: "commoner", weapon: "club", look: "Granary porters in flour-white aprons.", after: 2, why: "The shouting carries round to the loading dock, and the porters come in at the gate." },
        // One of the cast who isn't in the yard yet (the corporal enters with the dead-cart), as the yard's Old Wat is: not on the board until his round (smoke4-1018 had Wat beside the player from the start).
        { id: "tull", after: 2, why: "Corporal Tull hears the shouting from the lane and comes at a run." },
      ],
    }),
  },
};

const fightRow = (host: MemoryHost, gameId: bigint) => host.transact(tx => fightOf(tx, gameId))!;
const events = (host: MemoryHost, gameId: bigint): FightEvent[] => { const id = fightRow(host, gameId).id; return host.transact(tx => eventsOf(tx, id)); };
const boardNow = (host: MemoryHost, gameId: bigint) => JSON.parse(fightRow(host, gameId).board) as FightBoard;

test("the scene's reinforcements: the GM places them with everyone (told when they come and why); off the board until their round, then in at the way in, a moment of their own; in the yard's world after", async () => {
  const { host, script, wren, scene } = await openedGame(7, "fighter", COMING);
  const gameId = scene.gameId;
  script.then("reply", { entries: [{ speaker: "gm", kind: "narration", text: "Cob squares up with a gutter stone. Roll for initiative!" }], gm: {}, firstTextMs: 3, initiative: { foes: ["cob"], allies: [], why: "the boy in the boots, cornered" }, usage } satisfies ReplyResponse);
  script.then("sides", (r: unknown) => {
    const ask = (r as SidesRequest).sides;
    return { sides: Object.fromEntries(ask.pending.map(p => [p.id, p.id === "porters" ? "against_player" as const : p.id === "tull" ? "with_player" as const : "flee" as const])), entries: [{ speaker: "gm", kind: "narration", text: "Kell steps back to watch." }], usage } satisfies SidesResponse;
  });
  assert.equal(host.as(wren).say({ text: "I grab the boy by his collar." }), undefined);
  await host.drain();
  const ask = (script.to("sides").at(-1)!.body as SidesRequest).sides;
  const porters = ask.pending.find(p => p.id === "porters");
  assert.deepEqual(porters?.coming, { after: 2, why: "The shouting carries round to the loading dock, and the porters come in at the gate." }, "told when they come, and why");
  const now = sceneNow(host, scene.id);
  assert.equal(now.scene.status, "fighting");
  assert.ok(!now.lines.at(-1)!.text.includes("porters"), `who's coming is the board's surprise: ${now.lines.at(-1)!.text}`);

  assert.equal(host.as(wren).fightItOut(), undefined);
  let board = boardNow(host, gameId);
  assert.deepEqual([board.units["porters"]?.state, board.units["porters"]?.due, board.units["porters"]?.side], ["coming", 3, "enemy"], "in the order, not on the board");
  assert.deepEqual([board.units["tull"]?.state, board.units["tull"]?.due, board.units["tull"]?.side], ["coming", 3, "ally"], "one of the cast too, on the player's side");
  assert.ok(board.order.includes("porters") && board.order.includes("tull"));
  const start = events(host, gameId).find(e => e.kind === "start")!;
  assert.doesNotMatch([start.caption, ...start.detail.lines].join("\n"), /porter|corporal|tull/i, `who's coming isn't in the fight's opening: ${start.caption} ${start.detail.lines.join(" ")}`);
  assert.ok(!events(host, gameId).some(e => e.kind === "turn" && (e.actor === "tull" || e.actor === "porters")), "no turns till they come");
  // Rounds go by (the dice playing the player's turns) until the third round's top, when they come.
  for (let i = 0; i < 400 && fightRow(host, gameId).status === "on" && boardNow(host, gameId).round < 3; i++) {
    if (fightRow(host, gameId).options) assert.equal(host.as(wren).fightTurn({ act: "dodge" }) ?? host.as(wren).fightTurn({ act: "end_turn" }), undefined);
    else { host.advance(5000); host.fightSteps(); }
    if (fightRow(host, gameId).options) host.as(wren).fightTurn({ act: "end_turn" });
  }
  board = boardNow(host, gameId);
  assert.equal(fightRow(host, gameId).status, "on", `the fight lasted to round 3 (Kell keeping clear, the player dodging): ${events(host, gameId).map(e => e.kind).join(", ")}`);
  {
    assert.equal(board.units["porters"]!.state, "fighting", `in the fight from round ${board.round}`);
    const arrived = events(host, gameId).find(e => e.kind === "arrive")!;
    assert.ok(arrived, events(host, gameId).map(e => e.kind).join(", "));
    assert.equal(arrived.round, 3);
    assert.match(arrived.caption, /^The granary porters and .+ come (in through|into) .+\.$/);
    assert.doesNotMatch(arrived.caption, /through out of/i, "the board's edge is come into, not through");
    assert.ok(arrived.detail.lines.includes("The shouting carries round to the loading dock, and the porters come in at the gate."));
    assert.ok(arrived.detail.hits.some(h => h.unit === "porters" && h.was?.state === "coming" && h.state === "fighting"), "the screen sees them come on");
    assert.equal(board.units["tull"]!.state, "fighting", "the corporal with them");
  }
  // Seen through, then out: whoever came is in the yard from now on.
  for (let i = 0; i < 600 && fightRow(host, gameId).status === "on"; i++) {
    if (fightRow(host, gameId).options) host.as(wren).fightTurn({ act: "auto" });
    else { host.advance(5000); host.fightSteps(); }
  }
  const came = boardNow(host, gameId).units["porters"]!.state !== "coming";
  assert.equal(host.as(wren).walk({ toward: OUT }), undefined);
  await host.drain();
  const world = all(host.db.entity).filter(e => e.placeId === sceneNow(host, scene.id).scene.placeId).map(e => e.key);
  assert.equal(world.some(k => k.endsWith("porters")), came, `the porters ${came ? "came, and are" : "never came, and aren't"} in the yard: ${world.join(", ")}`);
});
