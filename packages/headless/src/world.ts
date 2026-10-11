import { fromJson } from "@bufbuild/protobuf";
import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { WorldGameRuntime, type WorldSnapshot, type WorldOptions } from "../../../apps/web/src/world-runtime.js";
import { characterDocuments } from "../../lore/src/character-id.js";
import { activityGoal } from "../../lore/src/activity.js";
import { inventoryOwners } from "../../core/src/inventory.js";
import { worldForCharacter } from "../../core/src/physical-view.js";
import { physicalCharacterObservation } from "../../../apps/web/src/physical-observation.js";
import { renderJevRoomView } from "../../../apps/web/src/jev-room-view.js";
import { buildIssueReport } from "../../../apps/web/src/issue-report.js";

/** The production console uses the same v2 host as the browser worker. */
export class WorldHeadlessGame {
  runtime: WorldGameRuntime;
  private activeConversationId: string | undefined;
  constructor(source: WorldState | WorldSnapshot, private readonly apiKey = "", private readonly options: WorldOptions = {}) {
    this.runtime = this.create(source);
  }
  private create(source: WorldState | WorldSnapshot) {
    return "version" in source
      ? new WorldGameRuntime(fromJson(WorldStateSchema, source.world), this.apiKey, source, undefined, undefined, this.options)
      : new WorldGameRuntime(source, this.apiKey, undefined, undefined, undefined, this.options);
  }
  load(source: WorldState | WorldSnapshot) {
    this.runtime.movement.dispose(); this.runtime = this.create(source); this.activeConversationId = undefined;
  }
  snapshot() { return this.runtime.snapshot(); }
  inspect() { return this.runtime.world(); }
  /** Simulation reads are immutable; commands use the same services as the game. */
  get services() { return this.runtime.services; }
  private observation(id = "player", selectedActionId?: string) {
    const visible = this.runtime.map.observe(id, selectedActionId), entries = characterDocuments(this.inspect());
    const entry = entries.find(entry => entry.id === id);
    if (!entry) throw new Error("Character is not placed in the palace.");
    const characters = entries.map(({ id, document, character }) => ({ id,
      name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
      inventory: character.inventory }));
    const known = worldForCharacter(visible.map, inventoryOwners(characters, visible.map), id);
    const goal = id === "player" ? "" : activityGoal(this.inspect(), id) ?? "";
    return { ...physicalCharacterObservation(known, id, goal, visible.actions), map: visible.map, characters };
  }
  observe(id = "player") {
    const observation = this.observation(id);
    const rendered = renderJevRoomView(observation.map, observation.characters,
      this.activeConversationId && id === "player" ? { ...observation, actions: [] } : observation);
    return this.activeConversationId && id === "player"
      ? `In conversation with ${this.activeConversationId}.\n\n${rendered}` : rendered;
  }
  actions() { return this.activeConversationId ? [] : this.observation().actions.map(({ id, description, type, legality }) =>
    ({ id, description, type, legality: legality ?? "normal" })); }
  conversation() { return this.activeConversationId ? { characterId: this.activeConversationId } : undefined; }
  quests() { return this.runtime.services.quests.listActive().map(({ quest, currentStageId }) => {
    const stage = quest!.stages.find(stage => stage.id === currentStageId);
    return { id: quest!.id, title: quest!.title || quest!.id,
      stage: stage?.title || currentStageId, description: stage?.description || "" };
  }); }
  dump(filepath: string, description: string) {
    if (!isAbsolute(filepath)) throw new Error("Diagnostic dump filepath must be absolute.");
    const generatedAt = new Date().toISOString();
    const archive = buildIssueReport({
      description, generatedAt, worldState: this.runtime.world(), requests: this.runtime.recentTranscripts(),
      agentRuns: this.runtime.transcriptRuns(), alerts: [], environment: {
        source: "headless-qa", node: process.version, platform: process.platform,
        activeConversation: this.activeConversationId ?? null,
      },
    });
    writeFileSync(filepath, archive, { flag: "wx", mode: 0o600 });
  }
  overview() { return this.runtime.view(); }
  async act(id: string) {
    if (this.activeConversationId) throw new Error(`End the conversation with ${this.activeConversationId} before acting.`);
    const action = this.observation("player", id).actions.find(action => action.id === id);
    if (!action) throw new Error(`Unavailable player action: ${id}`);
    const movement = await this.move(action.path.at(-1)!.x, action.path.at(-1)!.y);
    if (!movement.done || action.type === "move") return movement;
    if (action.type === "door" || action.type === "fixture") {
      const command = action.type === "door" ? { kind: "door" as const, id: action.target, open: action.open! } : { kind: "fixture" as const, id };
      const result = await this.runtime.executeAction({ command });
      await this.runtime.presentMap("player", result);
      return result;
    }
    this.activeConversationId = action.target;
    return { characterId: action.target };
  }
  async move(x: number, y: number) {
    const result = await this.runtime.executeAction({ command: { kind: "move", destination: { x, y } } });
    await this.runtime.presentMap("player", result);
    return result;
  }
  async talk(id: string, message: string) {
    if (!this.activeConversationId) await this.act(`talk_${id}`);
    if (this.activeConversationId !== id) throw new Error(`Already in conversation with ${this.activeConversationId}.`);
    return this.runtime.checkedTalkToCharacter(id, message);
  }
  async say(message: string) {
    if (!this.activeConversationId) throw new Error("Start a conversation with a talk action before speaking.");
    const characterId = this.activeConversationId;
    return { characterId, reply: await this.runtime.checkedTalkToCharacter(characterId, message) };
  }
  /** Explicitly advance one NPC through the same plan/step/review path used by the worker. */
  async advanceNpc(id: string, maxActions = 24) {
    const signal = AbortSignal.timeout(180_000), actions: string[] = [];
    for (let count = 0; count < maxActions; count++) {
      if (!this.runtime.hasActiveObjective(id)) break;
      const plan = await this.runtime.planNpc(id, signal);
      actions.push(plan.decision.choice);
      if (!plan.action) {
        const reason = plan.decision.choice;
        if (reason !== "complete" && reason !== "wait" && reason !== "unable") throw new Error("Unexpected terminal action.");
        this.runtime.finishNpcRun(id, reason, JSON.stringify(plan.decision));
        await this.runtime.reviewNpcOutcome(id, true, signal);
        break;
      }
      let done = false;
      for (let step = 0; step < 256 && !done; step++) {
        const result = await this.runtime.executeAction({ command: { kind: "step", characterId: id,
          actionId: plan.action.id, goal: plan.goal } }, signal);
        done = result.done;
        if (result.talkTarget) {
          const revision = this.inspect().simulation!.map!.revision;
          if (result.talkTarget === "player") {
            const opening = await this.runtime.initiatePlayerConversation(id, plan.action.id, revision, plan.goal, signal);
            return { actions, opening, jail: this.runtime.jail() };
          }
          await this.runtime.executeNpcTalk(id, plan.action.id, revision, plan.goal, signal);
        }
      }
      if (!done) throw new Error("NPC movement step limit reached.");
    }
    return { actions, jail: this.runtime.jail() };
  }
  async endConversation(id: string, message?: string, signal?: AbortSignal) {
    if (message !== undefined) await this.runtime.checkedTalkToCharacter(id, message, undefined, {}, signal);
    const result = await this.runtime.endConversation(id, signal);
    if (this.activeConversationId === id) this.activeConversationId = undefined;
    return result;
  }
  async endActiveConversation(signal?: AbortSignal) {
    if (!this.activeConversationId) throw new Error("No active conversation to end.");
    return this.endConversation(this.activeConversationId, undefined, signal);
  }
}
