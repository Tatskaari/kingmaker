import { castSpell, attack, type Outcome as RulesOutcome } from "../../../rules/dnd.ts";
import type { WorldOp } from "../../../world/scene-world.ts";
import { T, type TileDef } from "../../map/tiles.ts";
import type { Tile2 } from "../../types.ts";
import { freshWorld, passTurn } from "../world.ts";
import type { Ctx, Outcome, Trigger } from "../model.ts";

/** Floor for markers: the tile a marker letter stands for, in a wing's grid. */
export const floorFor = (chars: string, tile: TileDef): Record<string, TileDef> => Object.fromEntries([...chars].map(c => [c, tile]));

export const FLAGS = T("floor", { style: "flags" });
export const BOARDS = T("boards");
export const COBBLES = T("cobbles");
export const GRASS = T("grass");
export const DIRT = T("dirt");

/** The rules' lines, said as the map says things: the first one, and what came of it. */
export function told(lines: string[], lead = ""): string {
  const said = lines.filter(l => !/^\(/.test(l) || lines.length === 1).join(" · ");
  return `${lead}${lead && said ? " " : ""}${said}`.trim();
}

/** A spell cast by the visitor at things or people in the wing (their own spells, from their own slots: or not at all). */
export async function cast(z: Ctx, spell: string, targets: string[], lead = ""): Promise<Outcome> {
  const out: RulesOutcome = await castSpell(z.session, [], spell, targets);
  return { text: told(out.lines, lead), lines: out.lines };
}

/** A blow at something or someone in the wing: one attack through the engine (weapon "improvised" for a thrown bottle). */
export async function strike(z: Ctx, target: string, weapon?: string, lead = ""): Promise<Outcome> {
  const out = await attack(z.session, [], target, weapon);
  return { text: told(out.lines, lead), lines: out.lines };
}

/** World operations, as the stage manager writes them after a reply, said plainly. */
export function stage(z: Ctx, ops: Array<Partial<WorldOp> & { op: WorldOp["op"] }>, lead: string): Outcome {
  const changes = z.ops(ops);
  return { text: `${lead}${changes.length ? ` (${changes.join("; ")})` : ""}`, lines: changes.filter(c => !/^\(not done\)/.test(c)) };
}

/** The sand-glass: a turn of story time passes in the wing (what burns burns, and spreads; puddles dry; smoke drifts off). */
export function sandGlass(id: string, at: Tile2): Trigger {
  return {
    id, label: "Turn the sand-glass (a minute passes)", at, station: { name: "a sand-glass", glyph: "⌛", color: "#e0c890" },
    run: async z => {
      const lines = await passTurn(z);
      return { text: lines.length ? `A minute passes. ${lines.join(" · ")}` : "A minute passes. Nothing here is in any hurry.", lines };
    },
  };
}

/** The wing's "put everything back" lever: its world as it was when the zoo opened. */
export function resetLever(id: string, at: Tile2): Trigger {
  return {
    id, label: "Pull the lever: put everything back", at, station: { name: "the put-it-all-back lever", glyph: "╥", color: "#9ab0c0" },
    run: z => {
      const fresh = freshWorld(z.wing, { name: z.session.player.name });
      z.ex.roam = { ...(z.ex.roam ?? {}), [z.wing.id]: fresh };
      delete z.zoo.turns[z.wing.id];
      return { text: `Clunk. A great many small men in brown coats put ${z.wing.name} back exactly as it was, and leave without making eye contact.` };
    },
  };
}
