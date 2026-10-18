// New (M6's fight screen): the recorded wolf run (fixtures/fight-wolves.json, hosts/fight-fixture.ts) as the client gets it, frame by frame: each frame a fight row as it stood after a commit, with the moments written by then, made into the FightView a screen reads.
import type { FightEvent } from "../../shared/fight/types.ts";
import { fightViewOf, type FightRows, type FightView } from "../fight/view.ts";
import wolves from "./fixtures/fight-wolves.json" with { type: "json" };

/**
 * The wolf run as recorded: Wren Ashdown (the ready-made fighter) against three wolves, in initiative
 * order the lean grey wolf, Wren, the grey wolf and the big grey wolf. Frame 0 is the fight set out
 * (its start and the lean wolf's turn); frame 1 the lean wolf's walk and bite (a miss) and Wren's turn,
 * a wolf beside her; then her shot, her turn's end, the grey wolf's walk of six tiles, the big one's,
 * and so on, a wolf yielding in round 2, the big one going down in round 5, to her victory in round 6.
 */
export const WOLVES = wolves as unknown as {
  recorded: string; title: string; place: string; map: unknown;
  frames: Array<{ label: string; events: number; fight: { status: string; outcome?: string; round: number; turn: string; order: string[]; board: string; options: string; result?: string } }>;
  events: Array<Omit<FightEvent, "detail"> & { detail: FightEvent["detail"] }>;
};

/** The frame recorded with this label (the first, or the `nth` such). */
export function frameOf(label: string, nth = 0): number {
  const found = WOLVES.frames.map((f, i) => (f.label === label ? i : -1)).filter(i => i >= 0)[nth];
  if (found === undefined) throw new Error(`fight-wolves.json has no frame "${label}" (${nth})`);
  return found;
}

/** The wolf run's rows at a frame, as a client holds them: Wren's (player 1), or a spectator's (`me` 2). */
export function wolvesRows(frame: number, me = 1n): FightRows {
  const f = WOLVES.frames[frame]!;
  return {
    me, game: 1n, owner: "Wren Ashdown",
    fight: { id: 7n, playerId: 1n, title: WOLVES.title, place: WOLVES.place, map: JSON.stringify(WOLVES.map), ...f.fight, outcome: f.fight.outcome ?? undefined, result: f.fight.result ?? undefined },
    events: WOLVES.events.slice(0, f.events).map(e => ({ seq: e.seq, round: e.round, turn: e.turn, kind: e.kind, actor: e.actor, target: e.target, caption: e.caption, detail: JSON.stringify(e.detail) })),
  };
}

/** The wolf run's view at a frame. */
export function wolvesAt(frame: number, me = 1n): FightView {
  return fightViewOf(wolvesRows(frame, me))!;
}
