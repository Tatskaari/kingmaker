import type { Markup } from "../../shared/markup.ts";
import type { Entry } from "../../shared/protocol/ai.ts";
import { knownCast } from "../../shared/scene/names.ts";
import type { Scene } from "../../shared/scene/types.ts";
import type { TxCtx } from "./context.ts";
import type { RowOf, SceneRow } from "./rows.ts";

/**
 * A scene's transcript: what was said and shown, in order (seq, per scene, from 1), markup kept
 * beside the words as JSON. And the names the controller has heard in it, which my_names reads.
 */

export type TranscriptRow = RowOf<"transcript">;

/** A line written to the scene's transcript, numbered on from the last. */
export function addEntry(tx: TxCtx, scene: SceneRow, entry: Entry): TranscriptRow {
  return tx.db.transcript.insert({
    id: 0n, gameId: scene.gameId, sceneId: scene.id, turn: entry.turn, seq: lastSeq(tx, scene.id) + 1,
    speaker: entry.speaker, kind: entry.kind, text: entry.text, markup: entry.markup ? JSON.stringify(entry.markup) : undefined, at: tx.now,
  });
}

/** The scene's transcript as the AI service reads it, in order. */
export function entriesOf(tx: TxCtx, sceneId: bigint): Entry[] {
  return rowsOf(tx, sceneId).map(r => ({
    turn: r.turn, speaker: r.speaker, kind: r.kind as Entry["kind"], text: r.text,
    ...(r.markup ? { markup: JSON.parse(r.markup) as Markup } : {}),
  }));
}

/** A turn's player line (the text a queued turn starts with). */
export function playerLine(tx: TxCtx, sceneId: bigint, turn: number): string {
  const line = rowsOf(tx, sceneId).find(r => r.turn === turn && r.kind === "player");
  if (!line) throw new Error(`scene ${sceneId} has no player line for turn ${turn}`);
  return line.text;
}

/**
 * After the transcript changes: whose names the controller has now heard (in the hook, or any line
 * but the dice's: shared/scene/names.ts), each new one a heard row. People without a `called` count
 * as known from the start.
 */
export function noteHeard(tx: TxCtx, scene: SceneRow, graph: Scene): void {
  const heard = new Set([...tx.db.heard.playerId.filter(scene.controllerId)].map(h => h.entityKey));
  const known = knownCast(graph, { transcript: rowsOf(tx, scene.id) });

  for (const key of known) {
    if (!heard.has(key)) tx.db.heard.insert({ id: 0n, gameId: scene.gameId, playerId: scene.controllerId, entityKey: key });
  }
}

function rowsOf(tx: TxCtx, sceneId: bigint): TranscriptRow[] {
  return [...tx.db.transcript.sceneId.filter(sceneId)].sort((a, b) => a.seq - b.seq);
}

function lastSeq(tx: TxCtx, sceneId: bigint): number {
  let last = 0;
  for (const r of tx.db.transcript.sceneId.filter(sceneId)) last = Math.max(last, r.seq);
  return last;
}
