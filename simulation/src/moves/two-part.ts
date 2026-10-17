// New (M2): the two-part GM's turn in the simulation (docs/two-part-design.md "A turn, step by step"), its commits made after PR #666's twoPartTurn and twoPartOpening (src/runtime/two-part.ts at origin/claude/two-part-gm c749270) as the game's commits: the check rolled here from the game's dice (speak's roll), the co-GM's moves taken again on the rows with shared/scene/beats.ts's takeRoute, the roles and the note for the next turn written to gm_state, the closing ended through the story's own end.
import { describeRoll } from "../../../shared/dice.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import { BAND_NAME, bandOf, defaultRole, openingRoles, rolesNote } from "../../../shared/gm/two-part.ts";
import type { CoGmAnswer, Outcome, Reply, ReplyResponse, SettleResponse, SpokenCheck, TurnCheck } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import type { Mechanic } from "../../../shared/rules/types.ts";
import { takeRoute } from "../../../shared/scene/beats.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { rollerFor } from "../dice-row.ts";
import { afterTurn } from "../gm/background.ts";
import { putGm } from "../gm/rows.ts";
import { updateScene, updateTurn, type SceneRow, type TurnRow } from "../rows.ts";
import { markConjured } from "../../../shared/rules/acts.ts";
import { carryGearAfter, rulesFirst } from "../rules/play.ts";
import { refreshPockets } from "../rules/session.ts";
import { exitOf } from "../scenes.ts";
import { addEntry, noteHeard, writeReply } from "../transcript.ts";
import { finishTurn } from "../turns.ts";
import { applyStage, joinArrivals, placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import { keysIn, lookForNew } from "./looks.ts";
import type { Next } from "./move.ts";
import type { SayPlan } from "./plans.ts";
import { atTurn, endScene, noteReply, takeAct, type At } from "./say-commits.ts";
import { suggestAfter } from "./suggest.ts";

/**
 * The roles as the scene opens (twoPartOpening's): everyone present, each by their stage's cast note
 * (the start's, for a scene opening) or their attitude, as note -1, which the mouthpiece reads
 * before the opening. Only the opening sets them: the scene picking up after a fight keeps its own.
 */
export function openingRolesFor(graph: Scene, gm: GmState): void {
  const roles = openingRoles(graph, gm, presentCast(graph, gm));
  gm.twoPart = { roles, notes: [{ turn: -1, text: rolesNote(graph, roles, -1) }] };
}

/**
 * A two-part turn's plan as it starts (startPlan's, for a scene that plays two-part): unless this is
 * the wind-down, the rules first (a spell's time, fire's tick, coming round, a blow left hanging),
 * then the map's act when it's this turn's (town-design §3.4: resolved by the rules as it is now,
 * without the decider; its directive the reply's, after the rules'), each with its dice lines; the
 * reply next. Nothing reacts to the act: the reactions step is the old pipeline's.
 */
export function twoPartStart(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState, turn: TurnRow, line: string, base: Omit<SayPlan, "step" | "lines" | "outcome">): SayPlan {
  const first = gm.closing ? undefined : rulesFirst(tx, scene, graph, gm, turn.n, line);
  const outcome: Outcome = {
    lines: [...(first?.lines ?? [])], directives: [...(first?.directives ?? [])], wasStuck: false,
    ...(gm.closing ? { windDown: { exit: gm.closing.exitId } } : {}),
  };
  const rules = first?.directives.length ? { rulesFirst: { directives: first.directives, down: first.down, shielded: first.shielded } } : {};
  const forced = turn.mechanic && !gm.closing ? JSON.parse(turn.mechanic) as Mechanic : undefined;
  if (forced) takeAct(tx, { scene, graph, gm }, { n: turn.n, input: line, ...rules }, forced, undefined, outcome);
  putGm(tx, scene.id, gm);
  return { ...base, ...rules, step: "reply", twoPart: true, outcome, lines: outcome.lines, ...(forced ? { forced } : {}) };
}

/**
 * What the mouthpiece said, written (the reply commit, and the opening's): its narration, the draft
 * gone; and when it called a check, the check rolled from the game's dice with the player's own
 * modifiers, through the rules engine as every check is (rollerFor), its dice line with how far it
 * made or missed it, and the outcome that came up. The words as the next steps read them, the dice
 * line, and the check as rolled.
 */
export function writeSpoken(tx: TxCtx, scene: SceneRow, n: number, turnId: bigint, narration: Reply[], check: SpokenCheck | undefined): { text: string; lines: string[]; check?: TurnCheck } {
  writeReply(tx, scene, n, turnId, narration);
  const said = narration.map(r => r.text);
  if (!check) return { text: said.join("\n\n"), lines: [] };
  const roll = rollerFor(tx, scene)(check.skill, check.dc);
  const band = bandOf(roll);
  const line = `${describeRoll(roll)} (${BAND_NAME[band]}).`;
  addEntry(tx, scene, { turn: n, speaker: "dice", kind: "roll", text: line });
  const outcome = check.outcomes[band];
  addEntry(tx, scene, { turn: n, speaker: "gm", kind: "narration", text: outcome.text, ...(outcome.markup ? { markup: { speech: outcome.markup.speech, marks: [] } } : {}) });
  tx.log(`[scene ${scene.id} turn ${n}] the GM's check: ${check.skill} DC ${check.dc}, ${roll.total} (${band})`);
  return { text: [...said, outcome.text].join("\n\n"), lines: [line], check: { skill: check.skill, dc: check.dc, total: roll.total, success: roll.success, band } };
}

/**
 * After a two-part reply (twoPartTurn's): what it said written, its check rolled and the outcome that
 * came up; the stage whose pressure it offered marked (once a stage), and the move it showed done
 * with. The wind-down's reply closes the scene through the story's end, unless it waited (closes:
 * false, once: twoPart.held), when the scene goes on one more reply; neither has a settle. Any other
 * goes on to the settle (the stage manager and the co-GM), with what it said, its dice and its check;
 * the lines to suggest after it asked for, the box open again.
 */
export function afterTwoPartReply(tx: TxCtx, plan: SayPlan, answer: ReplyResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const turnId = idOf(plan.turn);
  const spoken = writeSpoken(tx, at.scene, plan.n, turnId, answer.entries ?? [], answer.check);
  noteReply(at.gm, answer);
  delete at.gm.twoPart.moved;
  noteHeard(tx, at.scene, at.graph);

  if (plan.outcome?.windDown) return windDown(tx, at, plan, answer.closes !== false || !!at.gm.twoPart.held);

  suggestAfter(tx, at.scene, turnId);
  putGm(tx, at.scene.id, at.gm);
  updateTurn(tx, turnId, { phase: "settling" });
  return { done: false, plan: { ...plan, step: "settle", reply: spoken.text, lines: [...plan.lines, ...spoken.lines], ...(spoken.check ? { check: spoken.check } : {}) } };
}

/** The closing reply: it closed the scene (the story's end: the ending's effects, onEnd, afterwards, then the boundary), or waited once. No settle either way: the turn's last commit. */
function windDown(tx: TxCtx, at: At, plan: SayPlan, closes: boolean): Next<SayPlan> {
  const closing = at.gm.closing;
  if (closes) delete at.gm.closing;
  else at.gm.twoPart.held = true;
  putGm(tx, at.scene.id, at.gm);
  if (closes && closing) endScene(tx, at.scene.id, exitOf(at.graph, closing.exitId), plan.n);
  else suggestAfter(tx, at.scene, idOf(plan.turn));
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] the closing reply ${closes ? `closed it: ${closing?.exitId}` : "waited, once"}`);
  afterTurn(tx, at.scene.id, plan, at.gm);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

/**
 * After a two-part settle (twoPartTurn's, after the reply): the stage manager's operations through
 * the gate (what the map's spell conjured marked as the spell's); the co-GM's moves taken again with
 * takeRoute on the rows, which are the authority, and the roles it set; whoever an event brought on
 * joined to the world and given a role (the stage's cast note, else their attitude); the co-GM's
 * note for the next turn; the stage's count of exchanges bumped, or, when the stage moved, the move
 * kept for the next reply to show. A route to an ending leaves the scene closing: the next line's
 * reply is the closing. Then the memory review is queued, and the turn is done.
 */
export function afterTwoPartSettle(tx: TxCtx, plan: SayPlan, answer: SettleResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const place = placeWorldOf(tx, at.scene);
  const keys = keysIn(tx, at.scene.placeId);
  const staged = applyStage(place, answer.ops ?? [], plan.n);
  if (plan.forced?.kind === "cast") markConjured(place.world, plan.forced.spell, plan.n);
  const stageBefore = at.gm.beat;
  const moved = coGmTakesEffect(tx, at, plan.n, answer.coGm);

  carryGearAfter(tx, at.scene, place.world, plan.n);
  joinArrivals(place.world, at.graph, at.gm, plan.n);
  const tp = at.gm.twoPart;
  for (const c of presentCast(at.graph, at.gm)) tp.roles[c.id] ??= defaultRole(at.graph, at.gm, c);
  tp.notes = [...tp.notes, { turn: plan.n, text: rolesNote(at.graph, tp.roles, plan.n) }];
  if (at.gm.beat === stageBefore && !at.gm.closing) at.gm.turnsInBeat++;
  else if (at.gm.beat !== stageBefore) tp.moved = at.gm.beat;

  savePlaceWorld(tx, at.scene, place, at.graph);
  refreshPockets(tx, at.scene.controllerId, place.world);
  syncStage(tx, at.scene, at.graph, at.gm);
  lookForNew(tx, at.scene, plan.n, idOf(plan.turn), keys);
  putGm(tx, at.scene.id, at.gm);
  if (at.gm.closing) updateScene(tx, at.scene.id, { status: "closing" });
  noteHeard(tx, at.scene, at.graph);
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] settled: ${staged.changes.length} changed, ${staged.problems.length} not done; the co-GM ${moved}${at.gm.closing ? `; closing on ${at.gm.closing.exitId}` : ""}`);

  afterTurn(tx, at.scene.id, plan, at.gm);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

/**
 * The co-GM's answer on the rows: each move taken again with takeRoute (one the rows refuse, which
 * the AI service's copy took, is logged and left), then the roles it set for the cast. What it did,
 * for the log.
 */
function coGmTakesEffect(tx: TxCtx, at: At, n: number, answer: CoGmAnswer | undefined): string {
  if (!answer) return "didn't answer";
  if (answer.error) tx.log(`[scene ${at.scene.id} turn ${n}] the co-GM failed: ${answer.error}`);
  const taken: string[] = [];
  for (const move of answer.moves ?? []) {
    const done = takeRoute(at.graph, at.gm, move.route, move.outcome, n);
    if ("error" in done) { tx.log(`[scene ${at.scene.id} turn ${n}] the co-GM's move ${move.route} (${move.outcome}) refused on the rows: ${done.error}`); continue; }
    at.gm = done.gm;
    taken.push(`${move.route}${move.outcome === "none" ? "" : ` (${move.outcome})`}${done.reached ? ` to ${done.reached}` : ""}`);
  }
  const cast = new Set(at.graph.cast.map(c => c.id));
  const roles = Object.entries(answer.roles ?? {}).filter(([id]) => cast.has(id));
  for (const [id, role] of roles) at.gm.twoPart.roles[id] = { status: role.status, mental_state: role.mental_state, conversation_role: role.conversation_role };
  return `moved ${taken.join(", ") || "nothing"}, set ${roles.map(([id]) => id).join(", ") || "no roles"}`;
}
