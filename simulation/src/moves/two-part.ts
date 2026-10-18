// New (M2): the two-part GM's turn in the simulation (docs/two-part-design.md "A turn, step by step"), its commits made after PR #666's twoPartTurn and twoPartOpening (src/runtime/two-part.ts at origin/claude/two-part-gm c749270) as the game's commits: the check rolled here from the game's dice (speak's roll), the co-GM's moves taken again on the rows with shared/scene/beats.ts's takeRoute, the roles and the note for the next turn written to gm_state, the closing ended through the story's own end. Since the old pipeline's salvage a talk plays on these steps too (docs/migration-log.md): its goodbye said in so many words is taken as its turn starts, so the reply to it is the talk's closing; its settle has no world, its lines are its own (the settle's, not the suggest job's), and the co-GM's move into its goodbye ends it at once.
import type { GmState } from "../../../shared/gm/state.ts";
import { bandOf, defaultRole, diceLine, openingRoles, rolesNote } from "../../../shared/gm/two-part.ts";
import type { CoGmAnswer, Outcome, Reply, ReplyResponse, SettleResponse, SpokenCheck, TurnCheck } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import type { Mechanic } from "../../../shared/rules/types.ts";
import { openRoutes, oweName, takeRoute } from "../../../shared/scene/beats.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { GOODBYE, isFarewell } from "../../../shared/scene/talk.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { rollerFor } from "../dice-row.ts";
import { afterTurn } from "../gm/background.ts";
import { putGm } from "../gm/rows.ts";
import { playerRow, updateScene, updateTurn, type SceneRow, type TurnRow } from "../rows.ts";
import { mightAct, spellsOf } from "../../../shared/rules/acting.ts";
import { markConjured } from "../../../shared/rules/acts.ts";
import { carryGearAfter, rulesFirst } from "../rules/play.ts";
import { refreshPockets } from "../rules/session.ts";
import { exitOf } from "../scenes.ts";
import { addEntry, noteHeard, writeReply } from "../transcript.ts";
import { finishTurn } from "../turns.ts";
import { talkLines } from "../map/talk.ts";
import { applyStage, joinArrivals, placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { syncStage } from "../world/stage.ts";
import { keysIn, lookForNew } from "./looks.ts";
import type { Next } from "./move.ts";
import type { SayPlan } from "./plans.ts";
import { combatTurnPlan, startCombat } from "./combat.ts";
import { atTurn, beforeReply, endScene, noteReply, resolveAct, type At } from "./say-commits.ts";
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
 * A two-part turn's plan as it starts (startPlan's, for a scene that plays two-part): in a talk, the
 * goodbye said in so many words (its last choice, say_goodbye) taken now, so this reply is its
 * closing; unless this is the wind-down, the rules first (a spell's time, fire's tick, coming round, a
 * blow left hanging), each with its dice lines; then the player's act. The map's, its mechanic chosen
 * already (town-design §3.4), is resolved by the rules now (resolveAct: its dice lines, its directive
 * the reply's after the rules'); a line that might be one (actingIn: a spell, a blow, a shot or a
 * throw, a class feature, by its words) is asked what it is first, by the act step. An act that was
 * violence draws the reactions of whoever saw it; then the reply.
 */
export function twoPartStart(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState, turn: TurnRow, line: string, base: Omit<SayPlan, "step" | "lines" | "outcome">): SayPlan {
  if (scene.kind === "talk" && !gm.closing && isFarewell(line)) farewell(tx, scene, graph, gm, turn.n);
  const first = gm.closing ? undefined : rulesFirst(tx, scene, graph, gm, turn.n, line);
  const outcome: Outcome = {
    lines: [...(first?.lines ?? [])], directives: [...(first?.directives ?? [])],
    ...(gm.closing ? { windDown: { exit: gm.closing.exitId } } : {}),
  };
  const rules = first?.directives.length ? { rulesFirst: { directives: first.directives, down: first.down, shielded: first.shielded } } : {};
  // A fight on (docs/combat-gm.md): the line is the player's turn in it, the GM's to play through its tools.
  if (gm.combat && !gm.closing) { putGm(tx, scene.id, gm); return combatTurnPlan(tx, { scene, graph, gm }, { ...base, ...rules, step: "combat", windDown: false, outcome, lines: outcome.lines }); }
  const forced = turn.mechanic && !gm.closing ? JSON.parse(turn.mechanic) as Mechanic : undefined;
  const resolved = forced ? resolveAct(tx, { scene, graph, gm }, { n: turn.n, input: line, ...rules }, forced, outcome) : undefined;
  const acting = forced || gm.closing ? undefined : actingIn(tx, scene, line);
  putGm(tx, scene.id, gm);

  const plan: SayPlan = { ...base, ...rules, step: "reply", windDown: !!gm.closing, outcome, lines: outcome.lines, ...(forced ? { forced } : {}) };
  if (acting) tx.log(`[scene ${scene.id} turn ${turn.n}] the line might be an act (${acting}): the rules are asked first`);
  return acting ? { ...plan, step: "act", acting } : beforeReply(plan, resolved);
}

/**
 * Why the player's line might be an act the rules resolve (shared/rules/acting.ts mightAct: by its
 * words, on the character's sheet and every spell the rules know), in a scene of the story for a
 * character the rules have made; undefined for any other line, so it goes straight to the reply. A
 * talk is a conversation between scenes, with no world and no dice: its lines are the GM's alone.
 */
function actingIn(tx: TxCtx, scene: SceneRow, line: string): string | undefined {
  if (scene.kind === "talk" || !tx.db.rulesState.playerId.find(scene.controllerId)) return undefined;
  const sheet = tx.db.sheet.playerId.find(scene.controllerId);
  return sheet ? mightAct(line, sheet, spellsOf(tx.rules())) : undefined;
}

/**
 * A talk's goodbye said in so many words (town-design §3.6: the talk's last choice, "I'll leave you
 * to it."): the way into its goodbye taken before the reply, as the old pipeline's decider took it,
 * so the reply is the talk's closing and the talk ends with it. The goodbye in the player's own
 * words is the co-GM's to see, after the reply (talkSettled).
 */
function farewell(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState, n: number): void {
  const route = openRoutes(graph, gm).find(r => r.target === GOODBYE);
  const taken = route ? takeRoute(graph, gm, route.id, "none", n) : { error: "no way into the goodbye is open" };
  if ("error" in taken) { tx.log(`[scene ${scene.id} turn ${n}] the goodbye said, but not taken: ${taken.error}`); return; }
  Object.assign(gm, taken.gm);
  tx.log(`[scene ${scene.id} turn ${n}] the goodbye said: ${route!.id}, the reply its closing`);
}

/**
 * What the mouthpiece said, written (the reply commit, and the opening's): its narration, the draft
 * gone; and when it called a check, the check rolled from the game's dice with the player's own
 * modifiers, through the rules engine as every check is (rollerFor), its dice line with how far it
 * made or missed it (diceLine: a natural 20 or 1 says so instead), and the outcome that came up. The words as the next steps read them, the dice
 * line, and the check as rolled.
 */
export function writeSpoken(tx: TxCtx, scene: SceneRow, n: number, turnId: bigint, narration: Reply[], check: SpokenCheck | undefined): { text: string; lines: string[]; check?: TurnCheck } {
  writeReply(tx, scene, n, turnId, narration);
  const said = narration.map(r => r.text);
  if (!check) return { text: said.join("\n\n"), lines: [] };
  const roll = rollerFor(tx, scene)(check.skill, check.dc);
  const band = bandOf(roll);
  const line = diceLine(roll);
  addEntry(tx, scene, { turn: n, speaker: "dice", kind: "roll", text: line });
  const outcome = check.outcomes[band];
  addEntry(tx, scene, { turn: n, speaker: "gm", kind: "narration", text: outcome.text, ...(outcome.markup ? { markup: { speech: outcome.markup.speech } } : {}) });
  tx.log(`[scene ${scene.id} turn ${n}] the GM's check: ${check.skill} DC ${check.dc}, ${roll.total} (${band})`);
  return { text: [...said, outcome.text].join("\n\n"), lines: [line], check: { skill: check.skill, dc: check.dc, total: roll.total, success: roll.success, band } };
}

/**
 * After a two-part reply (twoPartTurn's): what it said written, its check rolled and the outcome that
 * came up; the stage whose pressure it offered marked (once a stage), and the move it showed done
 * with, whoever it brought on joining the place and the stage now it has shown them arriving. The
 * wind-down's reply closes the scene through the story's end, unless it waited (closes: false, once:
 * twoPart.held), when the scene goes on one more reply; neither has a settle. Any other goes on to
 * the settle (the stage manager and the co-GM), with what it said, its dice and its check; the lines
 * to suggest after it asked for, the box open again.
 */
export function afterTwoPartReply(tx: TxCtx, plan: SayPlan, answer: ReplyResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const turnId = idOf(plan.turn);
  const spoken = writeSpoken(tx, at.scene, plan.n, turnId, answer.entries ?? [], answer.check);
  noteReply(at.gm, answer);
  const shown = at.gm.twoPart.moved;
  delete at.gm.twoPart.moved;
  if (shown) arrivalsShown(tx, at, plan.n, turnId);
  noteHeard(tx, at.scene, at.graph);

  if (plan.outcome?.windDown) return windDown(tx, at, plan, answer.closes !== false || !!at.gm.twoPart.held);
  // The reply rolled for initiative (docs/combat-gm.md): the fight takes the scene's turns from here.
  if (answer.initiative) return startCombat(tx, at, { ...plan, lines: [...plan.lines, ...spoken.lines] }, answer.initiative);

  // A talk's lines to choose come with its settle (talk.suggest: town-design §3.6), not the suggest job.
  if (at.scene.kind !== "talk") suggestAfter(tx, at.scene, turnId);
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
  else if (at.scene.kind !== "talk") suggestAfter(tx, at.scene, idOf(plan.turn));
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] the closing reply ${closes ? `closed it: ${closing?.exitId}` : "waited, once"}`);
  afterTurn(tx, plan);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

/**
 * Whoever the stage the last settle moved to brings on (Tull and his constables with the dead-cart,
 * the Master and his Crakes at the midnight bell), into the place's world at the way in and onto the
 * stage, once the reply that shows them arriving is written (QA round qa3-1018: "Here:" listed the
 * corporal, and the place drew him, a reply before the narration brought him in); a look asked for
 * any of them that has none, as the settle asks for what the stage manager makes.
 */
function arrivalsShown(tx: TxCtx, at: At, n: number, turnId: bigint): void {
  const place = placeWorldOf(tx, at.scene);
  const keys = keysIn(tx, at.scene.placeId);
  const joined = joinArrivals(place.world, at.graph, at.gm, n);
  if (joined.length) savePlaceWorld(tx, at.scene, place, at.graph);
  syncStage(tx, at.scene, at.graph, at.gm);
  lookForNew(tx, at.scene, n, turnId, keys);
  if (joined.length) tx.log(`[scene ${at.scene.id} turn ${n}] shown arriving: ${joined.join(", ")}`);
}

/**
 * After a two-part settle (twoPartTurn's, after the reply): the stage manager's operations through
 * the gate (what the turn's spell conjured, the map's or a line's, marked as the spell's); the co-GM's moves taken again with
 * takeRoute on the rows, which are the authority, and the roles it set; the stage's count of
 * exchanges bumped, or, when the stage moved, the move kept for the next reply to show; whoever an
 * event brought on given a role (the stage's cast note, else their attitude), and joined to the world
 * and the stage only once that reply has shown them arriving (afterTwoPartReply); the co-GM's note
 * for the next turn. A route to an ending leaves the scene closing: the next line's reply is the
 * closing. Then the memory review is queued, and the turn is done.
 */
export function afterTwoPartSettle(tx: TxCtx, plan: SayPlan, answer: SettleResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  if (at.scene.kind === "talk") return talkSettled(tx, at, plan, answer);
  const place = placeWorldOf(tx, at.scene);
  const keys = keysIn(tx, at.scene.placeId);
  const staged = applyStage(place, answer.ops ?? [], plan.n);
  const cast = plan.forced ?? plan.read;
  if (cast?.kind === "cast") markConjured(place.world, cast.spell, plan.n);
  const stageBefore = at.gm.beat;
  const moved = coGmTakesEffect(tx, at, plan.n, answer.coGm);
  const tp = at.gm.twoPart;
  if (at.gm.beat !== stageBefore) tp.moved = at.gm.beat;
  else if (!at.gm.closing) at.gm.turnsInBeat++;

  carryGearAfter(tx, at.scene, place.world, plan.n);
  joinArrivals(place.world, at.graph, at.gm, plan.n);
  for (const c of presentCast(at.graph, at.gm)) tp.roles[c.id] ??= defaultRole(at.graph, at.gm, c);
  tp.notes = [...tp.notes, { turn: plan.n, text: rolesNote(at.graph, tp.roles, plan.n) }];

  savePlaceWorld(tx, at.scene, place, at.graph);
  refreshPockets(tx, at.scene.controllerId, place.world);
  syncStage(tx, at.scene, at.graph, at.gm);
  lookForNew(tx, at.scene, plan.n, idOf(plan.turn), keys);
  putGm(tx, at.scene.id, at.gm);
  if (at.gm.closing) updateScene(tx, at.scene.id, { status: "closing" });
  noteHeard(tx, at.scene, at.graph);
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] settled: ${staged.changes.length} changed, ${staged.problems.length} not done; the co-GM ${moved}${at.gm.closing ? `; closing on ${at.gm.closing.exitId}` : ""}`);

  afterTurn(tx, plan);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

/**
 * A talk's settle (town-design §3.6), after the reply: no world to settle (a talk has none) and no
 * stage manager. The co-GM's moves and roles, as any scene's: its move into the talk's discovery once
 * what the companion kept back has come out (endTalk records it told), and its move into the goodbye
 * once the player has said goodbye in their own words, which ends the talk now, since the reply it
 * followed was the farewell; its note for the next turn; and the next lines to choose (the settle's),
 * unless it's over. Then the memory review, and the turn is done.
 */
function talkSettled(tx: TxCtx, at: At, plan: SayPlan, answer: SettleResponse): Next<SayPlan> {
  const moved = coGmTakesEffect(tx, at, plan.n, answer.coGm);
  const tp = at.gm.twoPart;
  for (const c of presentCast(at.graph, at.gm)) tp.roles[c.id] ??= defaultRole(at.graph, at.gm, c);
  tp.notes = [...tp.notes, { turn: plan.n, text: rolesNote(at.graph, tp.roles, plan.n) }];
  const closing = at.gm.closing;
  if (closing) delete at.gm.closing;
  else at.gm.turnsInBeat++;
  putGm(tx, at.scene.id, at.gm);
  if (!closing && playerRow(tx, at.scene.controllerId).suggestions) talkLines(tx, at.scene, plan.n, answer.talk?.suggestions ?? [], plan.input);
  if (closing) endScene(tx, at.scene.id, exitOf(at.graph, closing.exitId), plan.n);
  noteHeard(tx, at.scene, at.graph);
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] the talk settled: the co-GM ${moved}${closing ? `; it ends: ${closing.exitId}` : ""}`);

  afterTurn(tx, plan);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  return { done: true };
}

/**
 * The co-GM's answer on the rows: each move taken again with takeRoute (one the rows refuse, which
 * the AI service's copy took, is logged and left), each lead whose name it left owed kept on the
 * path (oweName: the replies after it have its holder say the name, until it's said), then the roles
 * it set for the cast. What it did, for the log.
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
  for (const lead of answer.owed ?? []) at.gm = oweName(at.graph, at.gm, lead, n);
  const cast = new Set(at.graph.cast.map(c => c.id));
  const roles = Object.entries(answer.roles ?? {}).filter(([id]) => cast.has(id));
  for (const [id, role] of roles) at.gm.twoPart.roles[id] = { status: role.status, mental_state: role.mental_state, conversation_role: role.conversation_role };
  return `moved ${taken.join(", ") || "nothing"}${answer.owed?.length ? `, owes the name for ${answer.owed.join(", ")}` : ""}, set ${roles.map(([id]) => id).join(", ") || "no roles"}`;
}
