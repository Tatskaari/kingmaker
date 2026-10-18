// New (M6, docs/combat-design.md §7): start_ring, the zoo's way into a fight: one of the arena's rings (zoo/rings.ts) set out and started through startFight, the one way in.
import type { Identity } from "spacetimedb";
import { andList, refusal } from "../../../shared/protocol/refusals.ts";
import { actorOf, Refused, type TxCtx } from "../context.ts";
import { FIGHT_ON } from "../fight/moves.ts";
import { liveFightOf } from "../fight/rows.ts";
import { startFight } from "../fight/start.ts";
import { gameRow, playerRow } from "../rows.ts";
import { RINGS, ringSetup } from "./rings.ts";

/**
 * start_ring: a fight in one of the zoo's rings, for the caller's game (its host's, out of a scene
 * still being played, with no fight on). The ring's people come at the player, who starts rested,
 * and the ring leaves their sheet as it was. `fast`: the other side's turns follow each other at once
 * (QA). The player stays where they were on the map, and walks out there again once it's over.
 */
export function startRingReducer(tx: TxCtx, sender: Identity, args: { ring: string; fast?: boolean | undefined }): void {
  const actor = actorOf(tx, sender);
  const player = actor.id === undefined ? undefined : (tx.db.player.id.find(actor.id) ?? undefined);
  if (!player) throw new Refused(refusal("not_in_game"));
  const game = gameRow(tx, player.gameId);
  if (player.id !== game.hostId) throw new Refused(refusal("not_controller", { name: playerRow(tx, game.hostId).name }));
  const scene = player.sceneId === undefined ? undefined : tx.db.scene.id.find(player.sceneId);
  if (scene && scene.status !== "ended") throw new Refused(refusal("scene_on"));
  if (liveFightOf(tx, game.id)?.status === "on") throw new Refused(refusal("not_now", { text: FIGHT_ON }));
  const ring = RINGS[args.ring];
  if (!ring) throw new Refused(refusal("not_now", { text: `(There's no ring called ${args.ring || "that"} in the Arena: there's ${andList(Object.keys(RINGS))}.)` }));

  startFight(tx, player, ringSetup(ring, player, { fast: args.fast ?? false }));
}
