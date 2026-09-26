import type { Choose, JevChoice } from "../../../packages/providers/src/jev.js";
import type { NavRoute, Point } from "./navigation.js";
import { canUseDoor, type Door } from "./palace-doors.js";

export interface PalaceAction { id: string; type: "move" | "open" | "close" | "open_container" | "close_container" | "take_item"; target: string; itemId?: string; description: string }
export function legalActions(routes: readonly NavRoute[], doors: readonly Door[], position: Point): PalaceAction[] {
  return [
    ...routes.map(route => ({ id: `move_${route.node.id}`, type: "move" as const, target: route.node.id,
      description: `Walk to ${route.node.name} (${route.path.length - 1} tiles).` })),
    ...doors.filter(door => canUseDoor(door, position)).map(door => ({ id: `${door.open ? "close" : "open"}_${door.id}`,
      type: door.open ? "close" as const : "open" as const, target: door.id,
      description: `${door.open ? "Close" : "Open"} ${door.name}, connecting ${door.connection.join(" and ")}.` })),
  ];
}
export const PALACE_INSTRUCTIONS = {
            role: "Choose physical actions for the character described in `characterContext.character`, within the supplied scenario and current world. Use their authored identity, lore, relationships, motivation and visible events as context.",
            question: "Which action should this character perform next to pursue their current goal, given who they are and what has happened?",
            evidence: ["characterContext", "goal", "world", "actions", "recentEvents"],
            knowledge: "The world describes what the character knows. Unknown facts are unknown, not false. The offered actions are legal now; their descriptions explain their immediate effects. Actions may change which actions become available next.",
            goalOrder: "Respect the full free-form goal, including ordering and conditions. Recent events describe completed actions, not future plans.",
            completion: "Choose complete only when the current situation and completed events establish that the entire goal has been achieved.",
            stopping: "Choose unable only when no available action can make progress, or when essential clarification is required. Judge progress toward the goal, not whether a single action completes it.",
          };

export function palaceCriteria(actions: readonly PalaceAction[]): Record<string, string> {
  return { ...Object.fromEntries(actions.map(action => [action.id, action.description])),
            complete: "The entire goal is already satisfied, as evidenced by the current world and completed events.",
            unable: "No offered action can make progress toward the goal, or essential clarification is required." };
}

export interface AgentSnapshot { at: string; revision: number; actions: PalaceAction[]; world: unknown }
export interface AgentHost {
  snapshot(): AgentSnapshot;
  characterContext?(goal: string): unknown;
  execute(action: PalaceAction): Promise<void>;
  report(message: string, decision?: JevChoice): void;
  changed(): void;
}
/** One request at a time; stale/aborted responses cannot dispatch actions. */
export class PalaceAgent {
  #controller: AbortController | undefined;
  #goal = "";
  #steps = 0;
  #history: string[] = [];
  constructor(private readonly host: AgentHost) {}
  get running(): boolean { return !!this.#controller; }
  get history(): readonly string[] { return this.#history; }
  pause(): void {
    this.#controller?.abort(); this.#controller = undefined;
    this.host.report("Paused. An active walk finishes before another command can start."); this.host.changed();
  }
  reset(): void { this.pause(); this.#goal = ""; this.#steps = 0; this.#history = []; }
  async run(goal: string, choose: Choose, singleStep = false): Promise<void> {
    if (this.running || !goal.trim()) return;
    const controller = new AbortController(); this.#controller = controller;
    const active = (): boolean => this.#controller === controller && !controller.signal.aborted;
    this.host.changed();
    try {
      if (this.#goal !== goal) {
        this.#goal = goal; this.#steps = 0; this.#history = [];
      }
      while (active()) {
        const before = this.host.snapshot();
        if (this.#steps >= 24) throw new Error("Stopped after 24 actions. Set a new goal or reset to try again.");
        this.host.report(`Jev is choosing action ${this.#steps + 1}…`);
        const result = await choose({ goal, ...(this.host.characterContext ? { characterContext: this.host.characterContext(goal) } : {}), ...before, recentEvents: this.#history },
          PALACE_INSTRUCTIONS, palaceCriteria(before.actions), controller.signal);
        if (!active()) return;
        const now = this.host.snapshot();
        if (now.revision !== before.revision) throw new Error("World changed. Run again to replan.");
        if (result.choice === "complete") { this.host.report("Jev reports the goal complete.", result); break; }
        if (result.choice === "unable") { this.host.report("Jev chose to stop: it judged that no available action would fulfil this goal, or that it needs clarification. This is a model judgment, not an engine verdict.", result); break; }
        const action = now.actions.find(action => action.id === result.choice);
        if (now.revision !== before.revision || !action) throw new Error("World changed or action is unavailable. Run again to replan.");
        this.#steps++;
        this.host.report(action.description, result);
        const history = this.#history;
        await this.host.execute(action);
        history.push(`Completed: ${action.description} Now at ${this.host.snapshot().at}.`);
        if (!active()) return;
        if (singleStep) { this.host.report("Step complete."); break; }
      }
    } catch (error) {
      if (active()) this.host.report(error instanceof Error ? error.message : "Jev request failed.");
    } finally {
      if (this.#controller === controller) { this.#controller = undefined; this.host.changed(); }
    }
  }
}
