import { diffLines } from "diff";
import { stringify } from "yaml";
import type { Document } from "../../contracts/src/v2.js";
import type { OpenRouterMessage } from "../../providers/src/openrouter.js";
import { renderPrompt } from "../../prompts/src/index.js";
import { runGameMaster } from "./game-master.js";
import { advanceQuestTool, gameMasterTools } from "./gm-tools.js";
import { activityTools } from "./activity-tools.js";
import { reviewGuidance } from "./review-prompt-context.js";
import type { RuntimeServices } from "./services.js";

export interface NarrativeEvent { id: string; summary: string; characterId?: string }

/** One in-memory history and one worker, asleep between batches. No classifier or summarizer. */
export class NarrativeReviewer {
  readonly history: OpenRouterMessage[] = [];
  private pending: NarrativeEvent[] = [];
  private requested = false;
  private running: Promise<void> | undefined;
  private lifetime = new AbortController();
  constructor(private work: (history: OpenRouterMessage[], take: () => NarrativeEvent[], signal: AbortSignal) => Promise<unknown>,
    private warning: (error: unknown) => void) {}

  enqueue(events: NarrativeEvent[], wake = true) {
    if (!events.length || this.lifetime.signal.aborted) return;
    this.pending.push(...events);
    this.requested ||= wake;
    if (this.running || !this.requested) return;
    this.running = Promise.resolve().then(async () => {
      while (this.requested && !this.lifetime.signal.aborted) {
        this.requested = false;
        try {
          await this.work(this.history, () => {
            this.requested = false;
            return this.pending.splice(0);
          }, this.lifetime.signal);
        } catch (error) {
          // Keep prior evidence, but close any interrupted tool exchange before the next event.
          const lastCall = this.history.findLastIndex(message => !!message.tool_calls?.length);
          if (lastCall >= 0) for (const call of this.history[lastCall]!.tool_calls!) {
            if (!this.history.slice(lastCall + 1).some(message => message.tool_call_id === call.id)) {
              this.history.push({ role: "tool", tool_call_id: call.id,
                content: "Review interrupted; this tool's outcome is unknown. Read current state before retrying." });
            }
          }
          if (!this.lifetime.signal.aborted) this.warning(error);
          // A failed batch is retained in history; another external event can resume it.
        }
      }
    }).finally(() => { this.running = undefined; });
  }
  async drain() { await this.running; }
  cancel() { this.lifetime.abort(); this.pending = []; }
}

/** Compact changed lines, not complete documents or another model call. */
export function documentChangeSummary(path: string, before: Document | undefined, after: Document | undefined): string {
  const markdown = (doc: Document | undefined) => doc ? `${stringify(doc.frontmatter ?? {})}\n${doc.body}` : "";
  const changes = diffLines(markdown(before), markdown(after)).filter(part => part.added || part.removed)
    .flatMap(part => part.value.trim().split("\n").map(line => `${part.added ? "+" : "-"} ${line}`));
  const detail = changes.join("\n");
  if (!detail) return "";
  return `${after ? before ? "Edited" : "Created" : "Deleted"} ${path}\n${detail.slice(0, 1600)}${detail.length > 1600 ? "\n[…read the document for the remaining changes]" : ""}`;
}

export async function reviewNarrative(history: OpenRouterMessage[], take: () => NarrativeEvent[],
  services: RuntimeServices, signal: AbortSignal) {
  const tools = [...gameMasterTools.filter(tool => !activityTools.some(activity => activity.function.name === tool.function.name)
    && !["observe_world", "observe_room"].includes(tool.function.name)), advanceQuestTool];
  return runGameMaster({ model: "openai/gpt-6-luna", api: "responses", reasoning: { effort: "high" }, tools,
    messages: [{ role: "system", content: renderPrompt("narrative-review", { reviewGuidance }) }],
  }, services, signal, { review: true, systemPrompt: renderPrompt("review-system"), history,
    prepare: async messages => {
      const events = take();
      if (events.length) messages.push({ role: "system", content: `## New developments\n\n${events.map(event => `[${event.id}] ${event.summary}`).join("\n\n")}\n\n${narrativeContext(services, events)}` });
      return messages;
    },
  });
}

function narrativeContext(services: RuntimeServices, events: NarrativeEvent[]) {
  const world = services.scenario.read(), scenario = services.scenario.info().scenario;
  const sources = Object.entries(world.docs).filter(([path, doc]) => path.startsWith("Conversations/")
    || path.includes("/Quests/") && !!world.quests[String(doc.frontmatter?.id)])
    .flatMap(([path, doc]) => {
      const state = world.quests[String(doc.frontmatter?.id)];
      if (state?.quest?.stages.find(stage => stage.id === state.currentStageId)?.completed) return [];
      return [`- ${path}${state ? ` (id=${state.quest!.id}; active=${state.active}; stage=${state.currentStageId}; revision=${state.revision})` : ""}`];
    });
  // Supply the host's observations directly; no discovery tools or raw WorldState dump.
  const rooms = world.simulation?.map?.rooms.map(room => services.map.observeRoom(room.id)) ?? [];
  const roomText = rooms.map(({ room, doors, fixtures, actors }) => `### ${room.name} (${room.id})\n`
    + `Exits: ${doors.map(door => `${door.id}: ${door.open ? "open" : "closed"}, connects ${door.roomIds.join(", ")}`).join("; ")}\n`
    + `Characters: ${actors.map(actor => `${actor.characterId} at (${actor.position?.x}, ${actor.position?.y})`).join("; ")}\n`
    + `Fixtures: ${fixtures.map(fixture => `${fixture.id}: ${fixture.name}; ${fixture.actions.map(action => action.id).join(", ")}`).join("; ")}`).join("\n\n");
  const ids = [...new Set(["player", ...events.flatMap(event => event.characterId ? [event.characterId] : [])])];
  const actions = ids.filter(id => world.simulation?.map?.actors.some(actor => actor.characterId === id && actor.position))
    .map(id => `### Actions for ${id}\n${services.map.observe(id).actions.map(action => `- ${action.id}: ${action.description}${action.legality === "illegal" ? " (illegal)" : ""}`).join("\n")}`).join("\n\n");
  return `## Current story sources\n\nScenario: ${scenario}\nQuest index: ${scenario.replace(/scenario\.md$/, "Quests/index.md")}\n${sources.join("\n")}\n\n## Current world\n\n${roomText}\n\n${actions}`;
}
