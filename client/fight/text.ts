// After the prototype's src/game/combat/fights.ts TacticalFight.observe at bc2ab1f (what happened lately, the head line, the grid, who's who, the key) and src/cli/qa.ts's ACTIONS: the fight as the headless client prints it (MODE: fight), from its view: whose turn, the order with everyone's hit points, the board, the last moments with what the screen plays of each (M6's screen: the same beats, as a line) and their dice, and the player's actions by id (docs/combat-design.md §7).
import { gridText, KEY, orderLines } from "../../shared/fight/board.ts";
import type { FightBoard, FightEvent } from "../../shared/fight/types.ts";
import { linesUnder, scriptLine } from "./script.ts";
import type { FightView } from "./view.ts";

/** How many of the last moments observe shows. */
const RECENT = 14;

/** The fight as the headless client prints it: MODE: fight. `recent`: the moments to show (observe's last few; an act's own). */
export function fightText(view: FightView, recent: FightEvent[] = view.events.slice(-RECENT)): string {
  const options = view.options;
  const text = [
    `${view.title}${view.place.toLowerCase() === view.title.toLowerCase() ? "" : ` (${view.place})`}: ${head(view)}`,
    `Order, round ${view.round}:\n${orderLines(view.board, view.status === "on" ? view.turn : "").join("\n")}`,
    gridText(view.board, view.map, options?.moves ?? []),
    KEY,
    ...(recent.length ? [`What happened:\n${eventLines(recent, view.board).join("\n")}`] : []),
    ...(view.watching ? [`(You're watching: it's ${view.watching}'s fight.)`] : []),
    ...(view.refusal && !view.watching ? [view.refusal] : []),
  ].join("\n\n");
  const actions = actionsOf(view);
  return `MODE: fight\n\n${text}${actions.length ? `\n\nACTIONS:\n${actions.join("\n")}` : ""}`;
}

/** Whose turn, and what the player has left of theirs; or how it went. */
function head(view: FightView): string {
  if (view.status !== "on") return `it's over (${view.outcome ?? "?"}). ${view.result?.told ?? view.result?.summary ?? ""}`.trim();
  const turn = view.board.units[view.turn];
  const o = view.options;
  if (o) return `your turn. ${o.movementLeft} ft to move, action ${o.actionUsed ? "spent" : "ready"}, bonus action ${o.bonusActionUsed ? "spent" : "ready"}.`;
  if (turn && turn.id === view.board.pc) return view.watching ? `${turn.name}'s turn.` : turn.state === "down" ? "your turn, on the floor: a death save." : "your turn.";
  return `${turn ? `${turn.name}'s turn` : "the others' turn"}: the other side acts a turn at a time (observe again in a moment).`;
}

/**
 * The moments as lines: each caption; under it, what the screen plays of it (the walk's tiles, the
 * act, what it did to whom, who fell: client/fight/script.ts, as one ▸ line), then its dice and
 * narration. Names as the board calls them ("you" for the player).
 */
export function eventLines(events: FightEvent[], board?: FightBoard): string[] {
  const name = (id: string) => (board?.units[id] ? (id === board.pc ? "you" : board.units[id].called) : board?.props[id] ? `the ${board.props[id].name}` : id);
  return events.flatMap(e => {
    const played = scriptLine(e, name);
    return [e.kind === "turn" ? `— ${e.caption}` : e.caption, ...(played ? [`    ${played}`] : []), ...linesUnder(e).map(l => `    ${l}`)];
  });
}

/** The player's actions by id; once it's over, out back to the map. A spectator has none. */
function actionsOf(view: FightView): string[] {
  if (view.watching) return [];
  if (view.status === "over") return ["- out: Back to the map"];
  const o = view.options;
  if (!o) return [];
  const walk = o.moves.length ? [`- walk@x,y: Move to any tile marked · (${o.movementLeft} ft left), a tile at a time`] : [];
  return [...o.actions.map(a => `- ${a.id}: ${a.label}`), ...walk];
}
