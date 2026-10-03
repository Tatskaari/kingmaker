import { fromJson, toJson } from "@bufbuild/protobuf";
import { WorldStateSchema, type WorldState } from "../../contracts/src/v2.js";
import { WorldGameRuntime, type WorldSnapshot, type WorldOptions } from "../../../apps/web/src/world-runtime.js";
import { projectWorld } from "../../../apps/web/src/world-projection.js";
import { characterCourtObservation } from "../../../apps/web/src/court-agent.js";
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
  edit(change: (state: WorldState) => void) {
    const before = this.snapshot(), world = this.inspect();
    change(world);
    this.runtime.restore({ ...before, world: toJson(WorldStateSchema, world), worldGeneration: crypto.randomUUID() });
  }
  private observation(id = "player") { return characterCourtObservation(projectWorld(this.inspect()), id); }
  observe(id = "player") { return renderJevRoomView(projectWorld(this.inspect()), this.observation(id)); }
  actions() { return this.observation().actions.map(({ id, description, type, legality }) => ({ id, description, type, legality })); }
  overview() { return this.runtime.view(); }
  act(id: string) {
    const action = this.observation().actions.find(action => action.id === id);
    if (!action) throw new Error(`Unavailable player action: ${id}`);
    this.runtime.movePlayer(action.path.at(-1)!);
    if (action.type === "door") return { event: this.runtime.setDoor(action.target, action.open!) };
    if (action.type === "fixture") return this.runtime.interactFixtureWithEvent(id);
    return { characterId: action.target };
  }
  move(x: number, y: number) { this.runtime.movePlayer({ x, y }); }
  async talk(id: string, message: string) { this.act(`talk_${id}`); return this.runtime.checkedTalkToCharacter(id, message); }
  async endConversation(id: string, message?: string, signal?: AbortSignal) {
    if (message !== undefined) this.runtime.endConversationAsPlayer(id, message);
    return this.runtime.endConversation(id, signal);
  }
}
