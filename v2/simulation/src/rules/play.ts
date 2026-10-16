// gearMoves copies the gear loop of the prototype's src/runtime/engine.ts:933-942 at 44c6d4a (a gear item's holder, and whether the player still carries it), as a list of changes; the rest is v1-design §3.6's.
import type { RollResult } from "../../../shared/dice.ts";
import { carryGear, comeTo, rollFor } from "../../../shared/rules/index.ts";
import type { Skill } from "../../../shared/scene/types.ts";
import type { SceneWorld } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import { playerRow, type SceneRow } from "../rows.ts";
import { addEntry } from "../transcript.ts";
import { engineCall, saveSession, sessionOf, writeSheet } from "./session.ts";

/**
 * What the rules engine does to the player's character in play (v1-design §3.6), each pinned and
 * written back in the transaction that does it: they come to at an opening, a route's check rolls
 * on their sheet, and the story parting them from their gear changes it. Each logs its time: the
 * engine holds every other transaction up while it runs.
 */

/**
 * At an opening (the prototype's openScene, engine.ts:192-196): someone dropped comes to with 1 HP.
 * One roll's draw either way, so the first check is the seed's second draw, as in the prototype; for
 * someone who isn't down, no line and the sheet as it was.
 */
export function comeToAtOpening(tx: TxCtx, scene: SceneRow): void {
  const started = tx.elapsedMs();
  const player = playerRow(tx, scene.controllerId);
  if (!tx.db.rulesState.playerId.find(player.id)) return;
  const session = sessionOf(tx, player);

  const line = engineCall(tx, player.gameId, rules => comeTo(rules, session));

  saveSession(tx, player, session);
  if (line) {
    engineCall(tx, player.gameId, rules => writeSheet(tx, player, session, rules));
    addEntry(tx, scene, { turn: 0, speaker: "dice", kind: "roll", text: line });
  }
  tx.log(`[rules] comeTo ${ms(tx, started)} ms${line ? `: ${line}` : ""}`);
}

/** A skill check through the engine on the player's cached campaign (rollFor, dnd.ts:905): the dice's count one more, the check in the engine's log. */
export function checkThroughEngine(tx: TxCtx, playerId: bigint, skill: Skill, dc: number): RollResult {
  const started = tx.elapsedMs();
  const player = playerRow(tx, playerId);
  const session = sessionOf(tx, player);

  const roll = engineCall(tx, player.gameId, rules => rollFor(rules, session, skill, dc));

  saveSession(tx, player, session);
  tx.log(`[rules] check ${skill} DC ${dc} ${ms(tx, started)} ms`);
  return roll;
}

/**
 * After the stage manager has moved things (engine.ts:933-942): each piece of the player's gear
 * whose holder no longer matches the sheet, given away, dropped or got back, in the world's order.
 * Each change is a roll's draw and a dice line ("You no longer have your dagger (AC now 12)"); then
 * what's gone and the sheet are written back. Nothing that matches costs anything.
 */
export function carryGearAfter(tx: TxCtx, scene: SceneRow, world: SceneWorld, turn: number): void {
  const player = playerRow(tx, scene.controllerId);
  const state = tx.db.rulesState.playerId.find(player.id);
  if (!state) return;
  const moves = gearMoves(world).filter(m => m.carried === state.gone.includes(m.instanceId));
  if (!moves.length) return;
  const started = tx.elapsedMs();
  const session = sessionOf(tx, player, world);

  for (const m of moves) {
    const line = engineCall(tx, player.gameId, rules => carryGear(rules, session, m.instanceId, m.carried));
    if (line) addEntry(tx, scene, { turn, speaker: "dice", kind: "roll", text: line });
  }

  saveSession(tx, player, session);
  engineCall(tx, player.gameId, rules => writeSheet(tx, player, session, rules));
  tx.log(`[rules] carryGear ${moves.length} ${ms(tx, started)} ms`);
}

// ---------------------------------------------------------------------------------------------

/** Each of the player's gear items in the world, and whether they still carry it: held by them (through any bags), not destroyed, not gone. */
function gearMoves(world: SceneWorld): Array<{ instanceId: string; carried: boolean }> {
  return Object.values(world.entities).filter(e => e.gear).map(e => {
    let holder = e.parent ? world.entities[e.parent] : undefined;
    for (let n = 0; n < 20 && holder && holder.kind !== "person" && holder.kind !== "area" && holder.kind !== "place" && holder.parent; n++) holder = world.entities[holder.parent];
    const carried = holder?.player === true && !e.states.includes("destroyed") && !e.states.includes("gone");
    return { instanceId: e.gear!, carried };
  });
}

const ms = (tx: TxCtx, started: number) => Math.round(tx.elapsedMs() - started);
