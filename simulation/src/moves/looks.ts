import type { Invention, LooksResponse } from "../../../shared/protocol/ai.ts";
import { idText } from "../../../shared/protocol/keys.ts";
import type { TxCtx } from "../context.ts";
import { looksCall } from "../gm/requests.ts";
import { queueThink } from "../jobs.ts";
import type { SceneRow } from "../rows.ts";
import type { Move } from "./move.ts";
import type { LookPlan } from "./plans.ts";

/**
 * Invented looks (docs/town-design.md §3.7; the simulation's half of the prototype's
 * src/game/look/invent.ts, whose cache is look_invention): a thing the stage manager makes in a
 * settle or an aftermath that has no look gets one. One already invented for that name is written at
 * once; the rest are asked for together beside the turn (POST /v1/looks, in the background: never the
 * turn's failure, nothing waits on it), and each that comes back is kept by its name and written. A
 * look row for an invented thing: role invented, its glyph, `fg` its colour's name, the invention.
 */

/** The entity keys a place has now: what a settle's new things are told apart from. */
export function keysIn(tx: TxCtx, placeId: bigint): Set<string> {
  return new Set([...tx.db.entity.placeId.filter(placeId)].map(e => e.key));
}

/** Kinds of thing a look is invented for: what the stage manager makes (a cast member's look is looks.json's). */
const INVENTED = new Set(["object", "item", "feature", "creature", "person"]);

/**
 * After the stage manager has made things in a scene's place (turn n): each new one with no look gets
 * the one invented for its name before, or, for the rest, the looks are asked for (inventLook).
 */
export function lookForNew(tx: TxCtx, scene: SceneRow, n: number, turnId: bigint, before: Set<string>): void {
  const made = [...tx.db.entity.placeId.filter(scene.placeId)].filter(e => !before.has(e.key) && e.key.includes("/") && INVENTED.has(e.kind) && !e.gone && !tx.db.look.entityId.find(e.id));
  const asked: LookPlan["things"] = [];
  for (const e of made) {
    const key = lookKey(e.name);
    const kept = tx.db.lookInvention.key.find(key);
    if (kept) putLook(tx, e.id, kept.look);
    else asked.push({ entityId: idText(e.id), key, name: e.name, kind: e.kind });
  }
  if (!asked.length) return;
  queueThink(tx, inventLook, { step: "look", game: idText(scene.gameId), scene: idText(scene.id), turn: idText(turnId), n, things: asked });
  tx.log(`[scene ${scene.id} turn ${n}] looks asked for: ${asked.map(t => t.name).join(", ")}`);
}

export const inventLook: Move<void, LookPlan> = {
  name: "inventLook",
  background: true,

  resolve() {
    throw new Error("an invented look is asked for by a settle or an aftermath, never made as a move");
  },

  think: (tx, plan) => looksCall(tx, plan),

  /** Always: a thing keeps its look whatever has happened in the scene since. */
  applies: () => true,

  commit(tx, plan, answer) {
    const { looks } = answer as Partial<LooksResponse>;
    if (!looks || typeof looks !== "object") throw new Error("the answer has no looks");
    for (const t of plan.things) {
      const invention = looks[t.key];
      if (!invention) continue;
      if (!tx.db.lookInvention.key.find(t.key)) tx.db.lookInvention.insert({ key: t.key, name: t.name, kind: t.kind, look: columnOf(invention), at: tx.now });
      putLook(tx, BigInt(t.entityId), invention);
    }
    tx.log(`[scene ${plan.scene} turn ${plan.n}] looks invented: ${plan.things.filter(t => looks[t.key]).map(t => t.name).join(", ") || "none"}`);
    return { done: true };
  },

  /** The prototype drew a thing it couldn't invent a look for by its own guess (appearance.ts): so does the client. */
  giveUp(tx, plan, why) {
    tx.log(`[scene ${plan.scene} turn ${plan.n}] the looks gave up: ${why}`);
  },
};

/** The key a look is kept by: the thing's name, lower case (the prototype's cache key). */
export const lookKey = (name: string) => name.trim().toLowerCase();

/** An invention as the table keeps it (its options always there). */
function columnOf(i: Invention) {
  return { glyph: i.glyph, nerd: i.nerd, color: i.color, motion: i.motion, light: i.light, being: i.being, group: i.group, material: i.material };
}

/** A thing's look row, invented: in its place (it may have moved), unless it's gone from the game. */
function putLook(tx: TxCtx, entityId: bigint, invention: Invention): void {
  const e = tx.db.entity.id.find(entityId);
  if (!e) return;
  const row = { entityId, placeId: e.placeId, role: "invented", glyph: invention.glyph, fg: invention.color, invention: columnOf(invention) };
  if (tx.db.look.entityId.find(entityId)) tx.db.look.entityId.update(row);
  else tx.db.look.insert(row);
}
