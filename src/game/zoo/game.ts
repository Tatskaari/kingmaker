import { Game as Core } from "../play.ts";
import type { TacticalFights } from "../combat/index.ts";
import { BUILDS, ZOO_LEVEL, ZOO_NAME } from "./builds.ts";
import { zoo } from "./explorer.ts";
import { zooFights } from "./fights.ts";

/**
 * A new zoo visit: a game of its own (game.hub = "zoo"), kept apart from the story's saves, with the
 * visitor in the wizard's robes (the gallery's fire is in them), at level 5, made by the rules engine
 * from a ready-made build (no model). The app's title, the QA console and the tour all start here.
 */
export async function newZoo(options: { id?: string; seed?: number; fights?: TacticalFights } = {}): Promise<Core> {
  const wizard = BUILDS.wizard!;
  return Core.create({
    player: `${ZOO_NAME}: ${wizard.concept}`, level: ZOO_LEVEL, build: wizard.build, firstScene: ZOO_FIRST_SCENE,
    explorer: zoo, fights: options.fights ?? zooFights(), hub: "zoo",
    ...(options.id ? { id: options.id } : {}), ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });
}

/** The scene a zoo session is made with (any scene would do: the zoo opens its own when the visitor walks into one). */
export const ZOO_FIRST_SCENE = "zoo-pie-stall";

/** Load a zoo visit saved earlier. */
export function loadZoo(id: string, fights: TacticalFights = zooFights()): Core {
  return Core.load(id, zoo, fights);
}
