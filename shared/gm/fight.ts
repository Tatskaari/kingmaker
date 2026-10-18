// New (docs/combat-gm.md): a fight that breaks out in a scene, played on the board as the zoo's
// combat ring plays one (docs/combat-design.md). The GM rolls for initiative in its reply (or the
// co-GM takes the scene into an event with a fight, or a combat exit closes it); everyone here takes
// a side or runs; then the fight is set out on the scene's own map, and its end goes back into the
// scene. What the scene keeps of it in between (gm_state's fight).

/**
 * The side someone takes: with the player, against them, running from it (gone from the scene once
 * they're off the board), or keeping clear of it (one the story needs, who runs but never leaves:
 * the companion, whoever holds what the player still needs).
 */
export type FightSide = "with" | "against" | "flee" | "clear";
export const FIGHT_SIDES: readonly FightSide[] = ["with", "against", "flee", "clear"];

/** A side the GM picks for someone (pick_sides): with the player, against them, or running from it. */
export type SidePick = "with_player" | "against_player" | "flee";
export const SIDE_PICKS: readonly SidePick[] = ["with_player", "against_player", "flee"];

/** A pick as a side. */
export const sideOfPick = (pick: SidePick): FightSide => (pick === "with_player" ? "with" : pick === "against_player" ? "against" : "flee");

/**
 * A fight in a scene, from the moment it breaks out until it's over (gm_state's fight):
 * - `turn`: the turn it broke out on; `why`: what started it, in words (the reply's, or the event's title).
 * - `from`: the reply that rolled for initiative (or said so), the co-GM's move into an event with a
 *   fight (the Heron's blades out), or the combat exit the scene closed on.
 * - `beat`: the event whose fight it is, when it's one of the prep's.
 * - `sides`: everyone here by id, and the scene's reinforcements still to come, with their side.
 * - `pending`: who's still to take one, the GM's to pick before the fight is set out (pick_sides).
 * - `board`: the fight's row, once it's set out on the map (its id, as text).
 */
export interface SceneFight {
  turn: number;
  why: string;
  from: "reply" | "settle" | "exit";
  beat?: string;
  sides: Record<string, FightSide>;
  pending?: string[];
  /** Of those running from it, whoever the story needs (moves/fight.ts keepers): on the board they hide from it, as far off as they can get, but never leave the place. */
  stays?: string[];
  board?: string;
}

/** The people on a side, by id, in the order the fight lists them. */
export const onSide = (fight: Pick<SceneFight, "sides">, side: FightSide): string[] => Object.entries(fight.sides).filter(([, s]) => s === side).map(([id]) => id);
