import { fromJson } from "@bufbuild/protobuf";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { WorldGameRuntime, type WorldSnapshot, type WorldOptions } from "../../../apps/web/src/world-runtime.js";
import { characterDocuments } from "../../lore/src/character-id.js";
import { activityGoal } from "../../lore/src/activity.js";
import { inventoryOwners } from "../../core/src/inventory.js";
import { worldForCharacter } from "../../core/src/physical-view.js";
import { physicalCharacterObservation } from "../../../apps/web/src/physical-observation.js";
import { renderJevRoomView } from "../../../apps/web/src/jev-room-view.js";

/** The production console uses the same v2 host as the browser worker. */
export class WorldHeadlessGame {
  runtime: WorldGameRuntime;
  constructor(source: WorldState | WorldSnapshot, private readonly apiKey = "", private readonly options: WorldOptions = {}) {
    this.runtime = this.create(source);
  }
  private create(source: WorldState | WorldSnapshot) {
    return "version" in source
      ? new WorldGameRuntime(fromJson(WorldStateSchema, source.world), this.apiKey, source, undefined, undefined, this.options)
      : new WorldGameRuntime(source, this.apiKey, undefined, undefined, undefined, this.options);
  }
  load(source: WorldState | WorldSnapshot) { this.runtime = this.create(source); }
  snapshot() { return this.runtime.snapshot(); }
  inspect() { return this.runtime.world(); }
  /** Trusted console edits use live state; document tooling should use the CAS services. */
  edit(change: (state: WorldState) => void) { change(this.inspect()); }
  private observation(id = "player") {
    const visible = this.runtime.map.observe(id), entries = characterDocuments(this.inspect());
    const entry = entries.find(entry => entry.id === id);
    if (!entry) throw new Error("Character is not placed in the palace.");
    const characters = entries.map(({ id, document }) => ({ id,
      name: typeof document.frontmatter?.name === "string" ? document.frontmatter.name : id,
      inventory: document.characterProperties?.inventory }));
    const known = worldForCharacter(visible.map, inventoryOwners(characters, visible.map), id);
    const goal = id === "player" ? "" : activityGoal(this.inspect(), id) ?? "";
    return { ...physicalCharacterObservation(known, id, goal, visible.actions), map: visible.map, characters };
  }
  observe(id = "player") {
    const observation = this.observation(id);
    return renderJevRoomView(observation.map, observation.characters, observation);
  }
  actions() { return this.observation().actions.map(({ id, description, type, legality }) => ({ id, description, type, legality })); }
  overview() { return this.runtime.view(); }
  async act(id: string) {
    const action = this.observation().actions.find(action => action.id === id);
    if (!action) throw new Error(`Unavailable player action: ${id}`);
    const movement = await this.move(action.path.at(-1)!.x, action.path.at(-1)!.y);
    if (action.type === "move") return movement;
    if (action.type === "door" || action.type === "fixture") {
      const command = action.type === "door" ? { kind: "door" as const, id: action.target, open: action.open! } : { kind: "fixture" as const, id };
      const result = await this.runtime.executeAction({ command });
      await this.runtime.presentMap("player", result);
      return result;
    }
    return { characterId: action.target };
  }
  async move(x: number, y: number) {
    const result = await this.runtime.executeAction({ command: { kind: "move", destination: { x, y } } });
    await this.runtime.presentMap("player", result);
    return result;
  }
  async talk(id: string, message: string) { await this.act(`talk_${id}`); return this.runtime.checkedTalkToCharacter(id, message); }
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
          const revision = this.inspect().map!.revision;
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
    return this.runtime.endConversation(id, signal);
  }
}
