import type { SessionState } from "../runtime/session.ts";
import type { Fight, FightFactory } from "./play.ts";

/**
 * Until tactical combat lands (src/game/combat), a fight resolves in one action. It keeps the story
 * flowing end to end (Roll for initiative → the outcome → the next scene) and says what it is.
 */
export const standinFights: FightFactory = {
  async start() { return fight(false); },
  load(saved: unknown, _session: SessionState) { return fight(Boolean((saved as { done?: boolean } | undefined)?.done)); },
};

function fight(done: boolean): Fight {
  let over = done;
  return {
    observe: () => over ? "The fight is over." : "(Tactical combat on the map isn't wired in yet: this stand-in resolves the fight in one go.)",
    actions: () => over ? [] : [{ id: "fight", label: "Fight it out", kind: "fight" }],
    async act(id) {
      if (id !== "fight" || over) throw new Error(`Unavailable action: ${id}`);
      over = true;
      return "Steel, dust and lantern light: after a short, ugly fight the Crakes are down and Sallow drops his sword-cane and asks, very politely, to surrender.";
    },
    result: () => over ? { outcome: "victory", summary: "After a short, ugly fight the Crakes went down and Sallow surrendered, very politely.", casualties: [], rounds: 3 } : undefined,
    save: () => ({ done: over }),
  };
}
