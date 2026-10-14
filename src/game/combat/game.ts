import { createRequire } from "node:module";
import type { Game } from "boardgame.io";
import type { _ClientImpl, ClientOpts } from "boardgame.io/dist/types/src/client/client.js";
import type { Tile2 } from "../types.ts";
import type { CombatG } from "./model.ts";
import type { Rules } from "./rules.ts";
import { Skirmish } from "./skirmish.ts";

/**
 * The fight as a boardgame.io game: one player per combatant, in initiative order (player i is
 * G.order[i]), moves for everything a combatant can do on their turn, and the rules engine
 * resolving every roll inside them. The engine's encounter keeps whose turn it is; boardgame.io's
 * turn order follows it (turn.onEnd advances the engine past anyone out of the fight, and
 * order.next reads where it landed).
 */

// boardgame.io has no exports map, so Node's ESM loader can't import "boardgame.io/client" (a
// directory); its CommonJS build loads fine, under node and under tsx.
const require = createRequire(import.meta.url);
export const Client = (require("boardgame.io/dist/cjs/client.js") as { Client: <G>(opts: ClientOpts<G>) => _ClientImpl<G> }).Client;
export type CombatClient = _ClientImpl<CombatG>;

export function combatGame(initial: CombatG, rules: Rules): Game<CombatG> {
  /** Every move: a Skirmish over the draft, the work, and the campaign written back. A refusal is G.error. */
  const act = (G: CombatG, work: (s: Skirmish) => string | undefined) => {
    const s = new Skirmish(G, rules);
    delete G.error;
    const error = work(s);
    if (error) G.error = error;
    s.done();
  };
  const me = (s: Skirmish) => s.activeUnit()!;
  return {
    name: "kingmaker-combat",
    setup: () => structuredClone(initial),
    disableUndo: true,
    turn: {
      order: { first: ({ G }) => G.active, next: ({ G }) => G.active },
      onBegin: ({ G }) => { const s = new Skirmish(G, rules); s.beginTurn(); s.done(); },
      onEnd: ({ G }) => { if (G.outcome) return; const s = new Skirmish(G, rules); s.advance(); s.done(); },
    },
    moves: {
      move: ({ G }, to: Tile2) => act(G, s => s.move(me(s), to)),
      attack: ({ G }, target: string, weapon?: string) => act(G, s => s.attack(me(s), target, weapon)),
      cast: ({ G }, spell: string, target?: string, at?: Tile2) => act(G, s => s.cast(me(s), spell, target, at)),
      use: ({ G }, prop: string) => act(G, s => s.use(me(s), prop)),
      dash: ({ G }) => act(G, s => s.simple(me(s), "dash")),
      dodge: ({ G }) => act(G, s => s.simple(me(s), "dodge")),
      disengage: ({ G }) => act(G, s => s.simple(me(s), "disengage")),
      leave: ({ G }) => act(G, s => s.leave(me(s))),
      surrender: ({ G }) => act(G, s => s.surrender(me(s))),
      arrest: ({ G }, target: string) => act(G, s => s.arrest(me(s), target)),
      nerve: ({ G }, dc: number, why: string, test?: string) => act(G, s => s.nerve(me(s), dc, why, test)),
      /** A line of flavour the AI wants said (Sallow keeping a Crake between himself and the sharp end). */
      remark: ({ G }, kind: string) => act(G, s => { s.say(kind, me(s)); return undefined; }),
      endTurn: ({ G, events }) => { delete G.error; events.endTurn(); },
    },
    endIf: ({ G }) => (G.outcome ? { outcome: G.outcome } : undefined),
  };
}
