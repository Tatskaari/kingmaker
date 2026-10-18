// Copied from the prototype's src/runtime/engine.ts at 44c6d4a: resumeAfterFight's middle (1010-1018), aftermathDirective (1023-1030), stageAftermath (1032-1043) and settledFacts (419-422), with the usual edits (a TurnView for the session, the request's calls). What resumeAfterFight did to the session first (the ending and what was pending cleared, the exit fought, "The fight is over: …" established, "The fight: …" on the transcript) is the simulation's, before it asks; the notes and the lines the reply gets are their own thinks (the simulation queues them, as after any reply); and the stage manager's operations are returned for the simulation to apply through its gate, rather than applied here, with the player left in the place (stageAftermath's last lines, as a filter).

import type { CallContext } from "../llm/openrouter.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import type { Scene } from "../../shared/scene/types.ts";
import type { WorldOp } from "../../shared/world/scene-world.ts";
import { stageManage } from "./stage.ts";
import type { TurnView } from "./view.ts";
import { gmReply, type GmCall, type Spoken } from "./voice.ts";

/**
 * After a fight, the scene picks up from its outcome: the GM narrates the aftermath (streamed, as a
 * reply is), and the scene goes on to whichever ending the story reaches (the fight's exit is
 * spent). The world takes in what the aftermath narrated, once its words are in: `staging`.
 */
export async function resumeAfterFight(scene: Scene, state: TurnView, summary: string, how: GmCall): Promise<{ spoken: Spoken; staging: Promise<WorldOp[]> }> {
  const spoken = await gmReply(scene, state, [aftermathDirective(summary)], how);
  // What the aftermath did (the winners took the book) is in the world from now on, as a turn's reply is.
  const staging = stageAftermath(scene, state, spoken.text, how.calls);
  return { spoken, staging };
}

/**
 * The aftermath's direction. The fight's result is the summary's, not the world's or the details
 * established before it: after a lost fight the GM had Sallow "down beside you" and the wizard
 * waking with the ledger under his arm, though the summary had Sallow on his feet.
 */
export function aftermathDirective(summary: string): string {
  return `The fight is over, and this is how it went: ${summary}. Narrate the immediate aftermath in a short paragraph: who is down, who is held, who has run, what is burning or broken, and how people are taking it. Don't replay the fight blow by blow. The fight's result stands as it went, whatever the details established before it or the world's last word say: who is standing and who is down is as this says. If the player's side lost, they lost, and the winners do what they'd do with a beaten foe (what the player carried that they'd want is theirs to take, and they take it); nothing in the aftermath turns it round. Only people the world has here are here. Then hand the moment back to the player: the scene isn't over until the story says so.`;
}

/** The world takes in what the aftermath narrated (best effort, as a turn's stage manager is): its operations, by the world's ids. */
export async function stageAftermath(scene: Scene, state: TurnView, text: string, calls: CallContext): Promise<WorldOp[]> {
  if (!state.world) return [];
  const staged = await stageManage(state.world, state.player, "(The fight is over.)", text, {
    cast: presentCast(scene, state).map(c => ({ id: c.id, name: c.name, look: c.look })),
    settled: settledFacts(state),
  }, calls).catch(() => undefined);
  // (Only the player walking out takes them out of the place, as on a turn.)
  return (staged?.ops ?? []).flatMap(op => {
    if (op.what !== "player") return [op];
    if (op.op === "remove") return [];
    return op.op === "state" && op.add?.includes("gone") ? [{ ...op, add: op.add.filter(s => s !== "gone") }] : [op];
  });
}

/** What was settled before this exchange, for the stage manager: the scene's facts and the GM's rulings, how they went (the last 16). */
export function settledFacts(state: Pick<TurnView, "established" | "rulings">): string[] {
  const rulings = (state.rulings ?? []).map(r => `${r.act.replace(/\.$/, "")}: ${r.went === "success" ? "it worked" : "it didn't"} (${r.changed})`);
  return [...state.established, ...rulings].slice(-16);
}
