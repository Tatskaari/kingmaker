// Copied from the prototype's src/runtime/consider.ts:119-129 (CONTEST, contest), 550-557 (changed), 588-600 (NO_CHANGE, refusalOf), 620-675 (Settled, settleRuling), 677-686 (exitOf, patchesFor) and 688-699 (landRuling) at 44c6d4a. They read and write GmState, not the session, and the turn is the scene's, passed in. settleRuling is its state half: the verdict and the ruling's route come from the AI service (its consider.ts makes them, and tells the GM: settleRuling's directive lines, 650-665, and noDirective stay there), the route's check rolls through the game's dice (the roll handed in, V1's rollerFor), and who's who goes by the names the player has heard (the prototype's rules aliases, shared/scene/names.ts unnamed); a route with no `to` stays where the scene is.

import { describeRoll } from "../../../shared/dice.ts";
import type { Ruling, RulingOutcome, RulingRecord, Verdict } from "../../../shared/gm/consider.ts";
import type { GmState, ScenePatch } from "../../../shared/gm/state.ts";
import { currentBeat, targetTitle } from "../../../shared/scene/graph.ts";
import type { Scene, Skill, Transition } from "../../../shared/scene/types.ts";
import { resolveMove, type Move, type Roll } from "./bookkeeping.ts";

/**
 * Considered rolls, as the simulation settles them (full-gm-design §4.2): the GM's ruling on an act
 * the decider flagged, which the AI service judged, gave its verdict (a roll and its DC, or a yes or
 * a no without dice) and wrote as a route of the scene's. Here the route's check rolls from the
 * game's dice like any route's, the outcome played is chosen (a no without dice plays an honest
 * refusal), the ways of trying it shuts are closed in the scene's prep, and the ruling is kept on
 * record. What lands is what the reply showed, less what the dice kept back.
 */

/** Taking something from under someone's nose, a grab, or slipping past them: a contest with whoever could notice. */
const CONTEST: readonly Skill[] = ["sleight_of_hand", "stealth", "athletics"];

/**
 * A lift, a snatch or a slip past someone in the cast: their attention and what they stand to lose
 * against the player's cover, so it's rolled like working on them (Cob's boot, Sallow's purse in
 * front of the King), not ruled a feat. Taking a thing nobody's watching is a feat.
 */
export function contest(scene: Scene, ruling: Pick<Ruling, "target" | "skill">): boolean {
  return CONTEST.includes(ruling.skill) && scene.cast.some(c => c.id === ruling.target);
}

/** What a played outcome says in a line, for the record (and the next ruling). */
function changed(scene: Scene, o: RulingOutcome): string {
  const bits = [o.happens.replace(/\.$/, "")];
  if (o.to) bits.push(`the scene went to ${targetTitle(scene, o.to)}`);
  if (o.reveals.length) bits.push(`came out: ${o.reveals.join(", ")}`);
  if (o.closes.length) bits.push(`closed: ${o.closes.join(", ")}`);
  return bits.join("; ");
}

/** A plain no: nothing moves, nothing comes out, nothing is shut, nothing is lost. */
const NO_CHANGE: RulingOutcome = { happens: "", gets: "none", establishes: [], reveals: [], closes: [] };

/**
 * What a no without dice plays: an honest refusal, never the failure's cost (that's for a roll that
 * went against them). The review's own, when the success it wrote gets them nothing (Hobb pressing
 * the coin back: "Coin won't keep her safe"), shutting nothing; otherwise the person's (or the
 * world's) plain no, which moves nothing and costs nothing. The same push again keeps the answer it
 * got before.
 */
export function refusalOf(ruling: Ruling, v: Verdict): RulingOutcome {
  return v.no === "hollow" ? { ...ruling.success, closes: [] } : NO_CHANGE;
}

/**
 * A settled considered turn: the move to make (like any route's), the record, and what came out
 * (`found`, as the ruling says) or was kept back by how it went (`withheld`: what the outcome not
 * played would have brought out, which no reply can let slip this turn).
 */
export interface Settled { move: Move; record: RulingRecord; dice?: string; found: string[]; withheld: string[] }

/**
 * Settle the ruling: roll (the rules), choose the outcome (a no without dice plays its refusal), and
 * set its changes in the scene's own machinery (patches for the ways of trying it closes; the move
 * carries the beat and the facts). The caller applies the move as it applies any route's, writes
 * the dice line, and lands what came out.
 */
export function settleRuling(scene: Scene, state: GmState, ruling: Ruling, v: Verdict, route: Transition, roll: Roll, turn: number, aliases: Record<string, string>): Settled {
  const name = (id: string) => aliases[id] ?? scene.cast.find(c => c.id === id)?.name ?? id;
  const refusal = v.kind === "no" ? refusalOf(ruling, v) : undefined;
  let move: Move;
  if (v.kind === "roll") {
    move = resolveMove(scene, state, route, { id: route.id, phase: "attempt" }, roll);
  } else {
    const to = route.to ?? state.beat;
    move = { transition: route, phase: "attempt", to, chosen: v.kind === "yes", ...exitOf(scene, to) };
  }
  const went = v.kind === "yes" || move.roll?.success ? "success" : "failure";
  const o = refusal ?? (went === "success" ? ruling.success : ruling.failure);
  // What the outcome not played would have brought out is kept back (for a no, what either would have).
  const others = refusal ? [ruling.success, ruling.failure] : [went === "success" ? ruling.failure : ruling.success];
  for (const patch of patchesFor(scene, state, ruling, o, turn)) state.patches.push(patch);
  // (Whose no it is: the person worked on, not the one a lift was tried on, who never got to say.)
  const person = scene.cast.some(c => c.id === ruling.target) && !contest(scene, ruling) ? name(ruling.target) : undefined;
  const who = person && `${person[0]!.toUpperCase()}${person.slice(1)}`;
  const plainNo = refusal === NO_CHANGE ? (v.no === "same_again" ? "the same answer as before: nothing changed" : `${who ? `${who} said no` : "it couldn't be done like that"}, and nothing else changed`) : undefined;
  const record: RulingRecord = {
    turn, act: ruling.act, target: ruling.target, skill: ruling.skill, kind: v.kind, ...(v.dc ? { dc: v.dc } : {}), why: v.why,
    ...(move.roll ? { roll: move.roll } : {}), went, changed: plainNo ?? changed(scene, o), costUsd: ruling.costUsd, latencyMs: ruling.latencyMs,
  };
  return {
    move, record, ...(move.roll ? { dice: describeRoll(move.roll, ruling.reason) } : {}),
    found: o.reveals, withheld: [...new Set(others.flatMap(x => x.reveals))].filter(id => !o.reveals.includes(id)),
  };
}

function exitOf(scene: Scene, to: string): { exit?: Move["exit"] } {
  const exit = scene.exits.find(e => e.id === to);
  return exit ? { exit } : {};
}

/** The ways of trying an outcome shuts, as patches on the scene's prep: closed where they are (the beat's own, or from anywhere). */
export function patchesFor(scene: Scene, state: GmState, ruling: Ruling, o: RulingOutcome, turn: number): ScenePatch[] {
  const here = new Set(currentBeat(scene, state).transitions.map(t => t.id));
  return o.closes.map(id => ({ turn, close: { beat: here.has(id) ? state.beat : "*", id }, why: `Closed by the ruling on: ${ruling.act}` }));
}

/**
 * What lands on a ruled turn is what the reply showed, as the after-reply decider read it (`judged`),
 * which settles what the story owes the player (an owed essential come across here is owed no more:
 * owed.ts); not what the ruling's list said comes out (the gill of gossip that listed the Heron, its
 * text only "drinking for two"). What the outcome not played would have brought out doesn't land this
 * turn, whatever the reply let slip: the dice kept it back.
 */
export function landRuling(state: GmState, settled: Pick<Settled, "withheld">, judged: string[] = []): string[] {
  const landed = judged.filter(id => !settled.withheld.includes(id));
  if (landed.length) state.landed = [...new Set([...(state.landed ?? []), ...landed])];
  return landed;
}
