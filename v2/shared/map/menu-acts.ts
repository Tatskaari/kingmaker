// K's stand-in for the town unit (v2/docs/town-design.md §2, §3.3-3.4): package S copies the prototype's src/game/menu.ts at 44c6d4a here, lines 477-928 (doing it: storyRoute, doMenuAct, the town's reactions and its fight, a scene's or a talk's act, resting, hiding, lifting, leaping), with the usual edits (the host's Rules and the RulesSession handed in, no await; the companions' cards handed in, not looked up in SCENES; townFight makes a TownFight; liftNow's pennies through the world's inventory). The simulation's: the client never loads it. The types and signatures below are the copy's.
import type { Character } from "../scene/types.ts";
import type { Entity } from "../world/scene-world.ts";
import type { Mechanic, Rules, RulesSession } from "../rules/types.ts";
import type { MenuCtx } from "./menu.ts";
import type { ExploreState } from "./explore.ts";
import type { TownWorld } from "./town-world.ts";
import type { TownFight } from "./types.ts";

/**
 * What doing something on the map needs beyond the menu's own context: the rules (the host's engine
 * and the player's rules session, its world swapped for the town's while an act runs), the cards of
 * whoever walks with the player (the rules take their stats from them: the scene they came from's
 * cast), and the story's lead (a landing in its place opens it).
 */
export interface ActCtx extends MenuCtx { rules: Rules; session: RulesSession; companions: Character[]; lead?: string }

/** What doing something on the map came to (the prototype's menu.ts Done), for the simulation to write. */
export interface Done {
  text: string;
  /** The lead scene opens (the act is its first turn). */
  scene?: boolean;
  /** A talk with someone walking with the player opens (the act is its first turn). */
  talk?: { with: string; where: string };
  /** The player's first turn in the scene or talk that opens: what they do (in brackets), and what the rules resolve (the decide request's `forced`). */
  act?: { text: string; mechanic: Mechanic };
  /** A fight breaks out on the map: recorded on the explore row for V12. */
  fight?: TownFight;
  /** The rules' lines (for the look layer's effects). */
  lines?: string[];
}

/** How one of the town's people takes what the player did (townReactions' table). */
export type TownReaction = "fight" | "flee" | "raise_alarm" | "cower" | "intervene" | "unmoved";

const notBuilt = (what: string) => new Error(`not built: shared/map/menu-acts.ts ${what} is package S's (town-design §2)`);

/**
 * An act aimed at one of the story's people (someone whose scene is waiting; Kell, for what would
 * hurt her or work on her mind): the scene or the talk it opens, at once, the act its first turn.
 * Undefined for anything else. menu.ts:503.
 */
export function storyRoute(_c: ActCtx, _id: string): Done | undefined {
  throw notBuilt("storyRoute");
}

/** Do one of the menu's acts on the town's world (the rules', then the town's reactions). menu.ts:520. */
export function doMenuAct(_c: ActCtx, _id: string): Done {
  throw notBuilt("doMenuAct");
}

/**
 * Everyone about takes what the player did, each by what they are: the guards come on for someone
 * hurt (and shout about property), the hurt and most passers-by get out, some cower, some run for the
 * watch; Kell steps in. From hiding, nobody knows who did it. menu.ts:684.
 */
export function townReactions(_tw: TownWorld, _ex: ExploreState, _act: { victims: Entity[]; property: Entity[]; hidden: boolean; seed: number }): { reactions: Record<string, TownReaction>; lines: string[]; fighters: Entity[] } {
  throw notBuilt("townReactions");
}
