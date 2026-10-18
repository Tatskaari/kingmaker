// Copied from the prototype's src/runtime/engine.ts at 44c6d4a: betweenScenes is openScene's lines 192-201 (the time between scenes, coming to, a milestone's level, the scene's rest), rulesFirst is playerTurn's lines 517-542 (the rules first, as a turn starts), and gearMoves the gear loop of lines 933-942 (a gear item's holder, and whether the player still carries it), as a list of changes. Each works on the session and the world rebuilt from the rows (inPlay) and writes back what changed (playedOut); the dice lines go to the transcript and the directives to the plan; the rules calls the prototype caught (.catch) are caught alike (quietly). The rest is v1-design §3.6's and world-bridge-design §3.4's.
import type { RollResult } from "../../../shared/dice.ts";
import type { GmState } from "../../../shared/gm/state.ts";
import { hazard, levelUp, passTime, rest } from "../../../shared/rules/acts.ts";
import { carryGear, comeTo, rollFor } from "../../../shared/rules/index.ts";
import { comeRound, landThreat } from "../../../shared/rules/threats.ts";
import type { Rules, SceneSession } from "../../../shared/rules/types.ts";
import type { Scene, Skill } from "../../../shared/scene/types.ts";
import { areaOf, tick, type SceneWorld } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import { playerRow, type PlayerRow, type SceneRow } from "../rows.ts";
import { addEntry, entriesOf } from "../transcript.ts";
import { placeWorldOf, savePlaceWorld, type PlaceWorld } from "../world/place.ts";
import { engineCall, refreshPockets, saveSession, sceneSessionBack, sceneSessionOf, sessionOf, writeSheet } from "./session.ts";

/**
 * What the rules engine does to the player's character in play (v1-design §3.6, world-bridge-design
 * §3.4), each pinned and written back in the transaction that does it: the time between scenes as a
 * scene opens; the rules first as a turn starts (a spell running out, fire burning on, coming round,
 * a blow left hanging); a route's check rolled on their sheet; and the story parting them from their
 * gear. The player's act and the reactions to it are the say turn's commits' (say-commits.ts), on
 * inPlay and playedOut. Each logs its time: the engine holds every other transaction up while it
 * runs.
 */

/**
 * As a scene opens (the prototype's openScene, engine.ts:192-201): the time since the last scene
 * passes (a spell with a duration runs out quietly), someone dropped comes to with 1 HP, a milestone
 * scene brings a level (first, so a night's rest fills the new hit points too), and a scene with a
 * rest gives it. Coming to is one roll's draw either way, so the first check is the seed's second
 * draw, as in the prototype; for someone who isn't down, no line and the sheet as it was. The dice
 * lines (the level's a system line) are turn 0's. No world: nothing has been conjured in a place
 * just built, which is all the prototype's passTime read of it here.
 */
export function betweenScenes(tx: TxCtx, scene: SceneRow, graph: Scene): void {
  const started = tx.elapsedMs();
  const player = playerRow(tx, scene.controllerId);
  if (!tx.db.rulesState.playerId.find(player.id)) return;
  const session = sessionOf(tx, player);
  const before = session.rules?.campaign;
  const engine = <T>(fn: (rules: Rules) => T): T => engineCall(tx, player.gameId, fn);

  engine(rules => quietly(() => passTime(rules, session, 60), []));
  const woke = engine(rules => quietly(() => comeTo(rules, session), undefined));
  const levelled = graph.milestone ? engine(rules => quietly(() => levelUp(rules, session), [])) : [];
  const kind = graph.rest;
  const rested = kind ? engine(rules => quietly(() => rest(rules, session, kind), undefined)) : undefined;

  saveSession(tx, player, session);
  if (session.rules && session.rules.campaign !== before) engine(rules => writeSheet(tx, player, session, rules));
  for (const text of [...(woke ? [woke] : []), ...(rested?.lines ?? [])]) addEntry(tx, scene, { turn: 0, speaker: "dice", kind: "roll", text });
  for (const text of levelled) addEntry(tx, scene, { turn: 0, speaker: "system", kind: "system", text });
  tx.log(`[rules] between scenes ${ms(tx, started)} ms${woke ? `: ${woke}` : ""}${levelled.length ? `; ${levelled.join(" ")}` : ""}`);
}

/** What the rules did as a turn started (SayPlan.rulesFirst, and its dice lines): nothing, on an ordinary turn. */
export interface RulesFirst { lines: string[]; directives: string[]; down: boolean; shielded: boolean }

/**
 * The rules first, as a turn starts (the prototype's playerTurn, engine.ts:517-542): a running
 * spell's minute passing (it may run out), what's burning burning on and spreading (an explosion
 * catches the player too), coming round after being knocked down, and what the last reply left
 * hanging over the player landing before they act, as at the table. Each one's dice lines in the
 * transcript; the world, the character and the GM's bookkeeping (the threat taken off, a hold)
 * written back when any of it happened; and its directives, which lead the reply. Whether the blow
 * put the player down (what they meant to do doesn't happen) or met their Shield. `gm` is the
 * scene's, changed in place: the caller puts it.
 */
export function rulesFirst(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState, n: number, input: string): RulesFirst {
  const started = tx.elapsedMs();
  const played = inPlay(tx, scene, graph, gm, n);
  const { session } = played, world = played.place.world;
  const engine = <T>(fn: (rules: Rules) => T): T => engineCall(tx, scene.gameId, fn);
  const lines: string[] = [], ruled: string[] = [];
  const dice = (texts: string[]) => {
    for (const text of texts) addEntry(tx, scene, { turn: n, speaker: "dice", kind: "roll", text });
    lines.push(...texts);
  };
  let ran = !!session.threat;

  if (session.rules?.timed) {
    ran = true;
    const passed = engine(rules => quietly(() => passTime(rules, session, 1), []));
    dice(passed);
    if (passed.length) ruled.push(`Rules: ${passed.join("; ")} (the spell's time is up).`);
  }
  // The world moves on its own between replies: what's burning burns, and spreads.
  if (Object.values(world.entities).some(e => e.states.includes("burning"))) {
    ran = true;
    const burned = tick(world, n, session.seed + 31337 * n);
    dice(burned);
    if (burned.length) ruled.push(`Rules, since the last reply: ${burned.join("; ")}. The world shows what's burning now; let the fire be felt (smoke, heat, people's reactions).`);
    // An explosion catches everyone in it, the player included.
    const here = world.entities.player ? areaOf(world, "player") : undefined;
    if (session.rules && here?.states.includes("exploded") && burned.some(l => /explosion/i.test(l))) {
      const blast = engine(rules => quietly(() => hazard(rules, session, "fire", "serious"), undefined));
      if (blast) { dice(blast.lines); ruled.push(blast.directive); }
    }
  }
  // Knocked down last reply: they come round first. Then what was hanging over them lands (threats.ts).
  const cameRound = engine(rules => comeRound(rules, session));
  const landed = session.threat && session.rules ? engine(rules => landThreat(rules, graph, session, input)) : undefined;
  for (const outcome of [cameRound, landed]) {
    if (!outcome) continue;
    ran = true;
    dice(outcome.lines);
    ruled.push(outcome.directive);
  }

  if (ran) playedOut(tx, scene, graph, gm, played);
  if (ran) tx.log(`[rules] first, turn ${n}: ${ms(tx, started)} ms, ${lines.length} dice lines`);
  return { lines, directives: ruled, down: !!landed?.down, shielded: !!landed?.shielded };
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
// The rules at work in a scene's commit.

/** The player's character at work in a scene: the player, the place's world rebuilt from its rows, the session in it, and the engine's campaign as it was. */
export interface InPlay { player: PlayerRow; place: PlaceWorld; session: SceneSession; campaign: string | undefined; talk?: boolean }

/** The player's character in the scene's place at turn n, as the rules code reads it (sceneSessionOf), from the rows. */
export function inPlay(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState, n: number): InPlay {
  const player = playerRow(tx, scene.controllerId);
  const place = placeWorldOf(tx, scene);
  // A talk has no world (town-design §3.6, as the prototype's had none): the rules act on its cast alone, and nothing of a place is kept.
  const talk = scene.kind === "talk";
  const session = sceneSessionOf(tx, player, talk ? undefined : place.world, { turn: n, graph, transcript: entriesOf(tx, scene.id), gm });
  return { player, place, session, campaign: session.rules?.campaign, ...(talk ? { talk } : {}) };
}

/**
 * What the rules changed, written back: the dice's count and rules_state; the sheet, when the
 * engine changed the character; the world, and the pockets read from it; and on `gm` (which the
 * caller puts) what the scene acts wrote: who fled, a fight, what hangs over the player, a hold.
 */
export function playedOut(tx: TxCtx, scene: SceneRow, graph: Scene, gm: GmState, played: InPlay): void {
  const { player, place, session } = played;
  saveSession(tx, player, session);
  if (session.rules && session.rules.campaign !== played.campaign) engineCall(tx, player.gameId, rules => writeSheet(tx, player, session, rules));
  if (!played.talk) {
    savePlaceWorld(tx, scene, place, graph);
    refreshPockets(tx, player.id, place.world);
  }
  sceneSessionBack(gm, session);
}

/** A rules call the prototype made with .catch: what it comes to, or `otherwise` when it throws. */
export function quietly<T>(fn: () => T, otherwise: T): T {
  try {
    return fn();
  } catch {
    return otherwise;
  }
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
