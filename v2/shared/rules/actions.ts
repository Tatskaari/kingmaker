// K's stand-in for the town unit (town-design §2): package S copies the prototype's src/rules/actions.ts at 44c6d4a here, with the usual edits (rulesNow(state) is reading(rules, state); dnd.ts's helpers are acts.ts's, character.ts's and engine.ts's), its types and words being shared/rules/aim.ts's, and catalogue filling Catalogue.you. Not re-exported by index.ts, so the client never loads it: it reads the catalogue from the sheet row (sheet.actions).
import type { Catalogue, Context } from "./aim.ts";
import type { Rules, RulesSession } from "./types.ts";

export type { Aim, Catalogue, Context, Effect, Entry, Group, Section } from "./aim.ts";
export { entryLabel, rangeFeet } from "./aim.ts";

/**
 * What the player can do now, out of a fight, by kind (the action menu's catalogue: actions.ts:450);
 * undefined for a session without a rules character. `context.rested`: what they've rested since the
 * story's clock last moved. sheetRows writes it as the sheet's `actions`.
 */
export function catalogue(_rules: Rules, _state: RulesSession, _context: Context = {}): Catalogue | undefined {
  throw new Error("not built: shared/rules/actions.ts catalogue is package S's (town-design §2)");
}
