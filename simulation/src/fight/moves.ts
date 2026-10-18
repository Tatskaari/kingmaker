// New (M6, docs/combat-design.md §1): the player's moves in a fight. The map's own (walk, attack, cast: shared/map/moves.ts's ids) are fight moves on their turn, routed here by the map's reducers; fight_turn has the fight's own acts (dash, dodge, disengage, end_turn, yield, leave, auto) and hurry, the screen's skip to their turn; and walk out, once it's over, goes back to the map. The prototype's TacticalFight.act and parse (src/game/combat/fights.ts at bc2ab1f), as moves.
import type { Identity } from "spacetimedb";
import { isFightAct, type FightResult } from "../../../shared/fight/types.ts";
import { OUT, type MenuMove, type WalkArgs } from "../../../shared/map/moves.ts";
import { exploreRowOf, exploreOf, LOG_LINES } from "../../../shared/map/rows.ts";
import type { Tile2 } from "../../../shared/map/types.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { actorOf, Refused, type Actor, type TxCtx } from "../context.ts";
import { gameRow, playerRow, type PlayerRow } from "../rows.ts";
import { mapRowsOf, walkerOf, writeExplore } from "../map/rows.ts";
import { nothingLeft } from "./options.ts";
import { liveFightOf, play, type FightRow } from "./rows.ts";
import type { Skirmish } from "./skirmish.ts";
import { afterAct, autoTurn, endTurn, playersTurn, step } from "./turns.ts";

/** What the map's other moves are refused with while a fight is on: it's the fight first. */
export const FIGHT_ON = "(There's a fight on: see it through first.)";
/** And once it's over, until the player goes back to the map. */
export const FIGHT_OVER = "(The fight's over: out goes back to the map.)";
/** hurry on the player's own turn. */
export const HURRY_MINE = "(It's your turn already: there's nothing to hurry.)";

/** The actor's game's fight, while it's on or its end is still on screen: the map's moves are the fight's then. */
export function fightFor(tx: TxCtx, actor: Actor): FightRow | undefined {
  const player = actor.id === undefined ? undefined : tx.db.player.id.find(actor.id);
  return player ? liveFightOf(tx, player.gameId) : undefined;
}

/** A map move that's no fight move, refused while there's a fight: the fight first (or, once it's over, out first). */
export function refuseInAFight(tx: TxCtx, actor: Actor): void {
  const fight = fightFor(tx, actor);
  if (fight) throw new Refused(refusal("not_now", { text: fight.status === "on" ? FIGHT_ON : FIGHT_OVER }));
}

/** fight_turn: one of the fight's own acts, on the player's turn; or hurry, on the other side's. */
export function fightTurnReducer(tx: TxCtx, sender: Identity, args: { act: string }): void {
  const act = args.act;
  if (!isFightAct(act)) throw new Refused(refusal("unavailable"));
  const actor = actorOf(tx, sender);
  if (act === "hurry") return hurry(tx, theirFight(tx, actor));
  onTheirTurn(tx, theirFight(tx, actor), s => {
    const pc = s.pc();
    switch (act) {
      case "dash": case "dodge": case "disengage": return s.simple(pc, act);
      case "leave": return s.leave(pc);
      case "yield": return s.yieldFight(pc);
      case "end_turn": endTurn(s); return undefined;
      case "auto": autoTurn(s); return undefined;
    }
  });
}

/**
 * hurry (the screen's "skip to your turn"): the other side's turns still to come before the player's
 * are played now, one after another in this one move, each written as its moments as fight_step
 * would, until it's the player's turn or the fight is over. On the player's own turn there's nothing
 * to hurry, and it says so. The step on the clock, if any, finds nothing left to do.
 */
function hurry(tx: TxCtx, fight: FightRow): void {
  if (fight.options) throw new Refused(refusal("not_now", { text: HURRY_MINE }));
  play(tx, fight, s => {
    for (let i = 0; i < 64 && step(s); i++);
  });
}

/**
 * walk in a fight: walk@x,y on the player's turn moves them there, a tile at a time (an
 * opportunity attack as they leave someone's reach); walk out, once it's over, goes back to the map.
 */
export function fightWalk(tx: TxCtx, actor: Actor, fight: FightRow, args: WalkArgs): void {
  if (args.toward === OUT) return goBack(tx, actor, fight);
  const to = args.to;
  if (!to) throw new Refused(refusal("not_now", { text: "(In a fight you walk to a tile: walk@x,y, one you can reach this turn.)" }));
  onTheirTurn(tx, theirFight(tx, actor), s => s.move(s.pc(), tile(to)));
}

/**
 * The action menu's acts in a fight (cast and attack: town-design §3.2's ids), on the player's turn:
 * a spell at whoever or whatever is at the tile (an area's spot, if nobody is), or on themselves; a
 * blow at whoever's there (or a lantern); a shove over, or a grab; a brazier or a lantern beside
 * them knocked over with a shove. The rest of the menu isn't a fight's yet, and says so.
 */
export function fightMenuMove(tx: TxCtx, actor: Actor, fight: FightRow, move: MenuMove): void {
  const why = notInAFight(move);
  if (why) throw new Refused(refusal("not_now", { text: why }));
  onTheirTurn(tx, theirFight(tx, actor), s => {
    const pc = s.pc();
    if (move.move === "cast") {
      if (move.args.self || !move.args.at) return s.cast(pc, move.args.spell, move.args.self ? pc.id : undefined);
      const at = tile(move.args.at);
      return s.cast(pc, move.args.spell, whoAt(s, at), at);
    }
    if (move.move !== "attack") return "That isn't something to do in a fight.";
    const at = tile(move.args.at);
    const who = whoAt(s, at);
    // attack@x,y is the attack the options listed: the first weapon that reaches them (a bow across the room), else the one in hand, to say why not.
    if (move.args.how === "attack") return who ? s.attack(pc, who, pc.weapons.find(w => !s.attackCheck(pc, { at, id: who }, w).error)) : "There's nobody there to attack.";
    if (who && s.G.props[who]) return move.args.how === "shove" ? s.use(pc, who) : `You can't get hold of the ${s.G.props[who]!.name}.`;
    if (!who) return "There's nobody there to get hold of.";
    return s.wrestle(pc, who, move.args.how === "grapple" ? "grapple" : "prone");
  });
}

/** Why one of the action menu's acts isn't a fight move yet (as the prototype's fights refused them), or nothing when it is. */
function notInAFight(move: MenuMove): string | undefined {
  switch (move.move) {
    case "cast": return undefined;
    case "attack": return move.args.how === "throw" ? "(Throwing isn't part of a fight yet: attack with what's in your hand.)" : move.args.how === "lift" ? "(Picking pockets isn't part of a fight.)" : undefined;
    case "useFeature": return "(Class features aren't part of a fight yet: attack, cast, dash, dodge or disengage.)";
    case "leap": return "(Jumping isn't part of a fight yet: walk there.)";
    case "hide": return "(Hiding isn't part of a fight yet: dodge, or get out of their sight.)";
    case "rest": return "(There's no resting in a fight.)";
    case "useItem": return "(Using what you carry isn't part of a fight yet.)";
  }
}

// ---------------------------------------------------------------------------------------------

/** The fight the actor may move in: theirs, the game's live one, on (a fight that's over has only out). */
function theirFight(tx: TxCtx, actor: Actor): FightRow {
  const player = actor.id === undefined ? undefined : (tx.db.player.id.find(actor.id) ?? undefined);
  if (!player) throw new Refused(refusal("not_in_game"));
  const fight = liveFightOf(tx, player.gameId);
  if (!fight) throw new Refused(refusal("no_fight"));
  if (fight.playerId !== player.id) throw new Refused(refusal("not_controller", { name: playerRow(tx, fight.playerId).name }));
  if (fight.status !== "on") throw new Refused(refusal("not_now", { text: FIGHT_OVER }));
  return fight;
}

/**
 * One of the player's acts on their turn: refused when it isn't their turn, or when the rules say no
 * (in the rules' own words, and nothing written); else done, and with nothing at all left of their
 * turn, the turn passes by itself (fight/turns.ts afterAct).
 */
function onTheirTurn(tx: TxCtx, fight: FightRow, act: (s: Skirmish) => string | undefined): void {
  play(tx, fight, s => {
    if (!playersTurn(s)) throw new Refused(refusal("not_your_turn"));
    const error = act(s);
    if (error) throw new Refused(refusal("not_now", { text: `(${error})` }));
    afterAct(s, nothingLeft);
  });
}

/**
 * Out, once the fight's over: it's done, and the player is back on the map where they were, the
 * fight's end what the map last said (and in its log), as a scene's end is.
 */
function goBack(tx: TxCtx, actor: Actor, fight: FightRow): void {
  const player = actor.id === undefined ? undefined : (tx.db.player.id.find(actor.id) ?? undefined);
  if (!player) throw new Refused(refusal("not_in_game"));
  if (fight.playerId !== player.id) throw new Refused(refusal("not_controller", { name: playerRow(tx, fight.playerId).name }));
  if (fight.status === "on") throw new Refused(refusal("not_now", { text: FIGHT_ON }));
  tx.db.fight.id.update({ ...fight, status: "done", rev: fight.rev + 1 });
  tellTheMap(tx, player, fight);
  tx.log(`[fight] game ${fight.gameId}: ${fight.title} done (${fight.outcome ?? "?"}), back to the map`);
}

/** How the fight went, as the map's latest words: "The fight: …". */
function tellTheMap(tx: TxCtx, player: PlayerRow, fight: FightRow): void {
  const game = gameRow(tx, player.gameId);
  const walker = walkerOf(tx, game);
  if (!walker) return;
  const result = fight.result ? (JSON.parse(fight.result) as FightResult) : undefined;
  const said = `${fight.title}: ${result?.summary ?? "it's over."}`;
  const rows = mapRowsOf(tx, game, walker);
  const written = exploreRowOf(exploreOf(rows), rows.explore, said);
  writeExplore(tx, { ...written, log: [...rows.explore.log, said].slice(-LOG_LINES) });
}

/** Who or what is on a tile: someone still on the board (the standing first), else a prop standing there. */
function whoAt(s: Skirmish, at: Tile2): string | undefined {
  const here = s.units.filter(u => u.state !== "fled" && u.at.x === at.x && u.at.y === at.y).sort((a, b) => Number(b.state === "fighting") - Number(a.state === "fighting"));
  if (here[0]) return here[0].id;
  return Object.values(s.G.props).find(p => p.state === "standing" && !p.carriedBy && p.at.x === at.x && p.at.y === at.y)?.id;
}

const tile = (t: Tile2): Tile2 => ({ x: t.x, y: t.y });
