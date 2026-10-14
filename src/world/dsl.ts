/**
 * Stub world-update DSL. Scripts never touch real game state: every call is recorded as an
 * operation so we can see what fixtures, items and state changes a scene's ending produces.
 * Phase 2 grows this into the surface the outcome agent writes against.
 */

export type AssetKind = "decal" | "prop" | "item" | "creature" | "effect";
export interface Asset { id: string; kind: AssetKind; name: string; tags: string[] }

export interface Anchor { type: "anchor"; id: string }
export interface CharacterRef { type: "character"; id: string }
export type Place = Anchor | CharacterRef;

export interface ItemSpec { id: string; name: string; kind: "readable" | "key" | "quest" | "weapon" | "trinket" | "consumable" | "coin"; description: string; content?: string; asset?: string; quantity?: number }

export type Attitude = "hostile" | "unfriendly" | "wary" | "neutral" | "friendly" | "devoted";

export interface SceneOutcome {
  sceneId: string;
  exitId: string;
  /** Facts the runtime established through transitions. */
  established: string[];
  /** Free-form summary of what happened (from the transcript). */
  summary?: string;
}

export type Operation = { op: string; args: Record<string, unknown> };

export interface WorldApi {
  assets: { search(query: string, kind?: AssetKind): Asset[]; get(id: string): Asset };
  anchor(id: string): Anchor;
  character(id: string): CharacterHandle;
  player: { addItem(item: ItemSpec): void; removeItem(id: string): void; addGold(amount: number): void };
  newReadable(spec: { id: string; name: string; content: string }): ItemSpec;
  newItem(spec: Omit<ItemSpec, "content">): ItemSpec;
  scatter(spec: { asset: Asset; count: number; around: Place; radius?: number }): void;
  place(spec: { asset: Asset; at: Place; note?: string }): void;
  quest(id: string): { start(title: string, summary: string): void; advance(stage: string, note: string): void; complete(note: string): void; fail(note: string): void };
  startCombat(spec: { enemies: Array<{ asset: Asset; count: number; leader?: string }>; allies?: string[]; at: Place; surprise?: "party" | "enemies" }): void;
  setFlag(name: string, value: string | number | boolean): void;
  journal(entry: string): void;
  /** Record a change the story needs that this API can't express (feeds DSL design). */
  unsupported(description: string): void;
}

/** A character handle is also a place: things can be scattered around a character. */
export interface CharacterHandle extends CharacterRef {
  setAttitude(attitude: Attitude, reason: string): void;
  moveTo(place: Place | string): void;
  kill(cause: string): void;
  wound(description: string): void;
  giveItem(item: ItemSpec): void;
  takeItem(id: string): void;
  joinParty(): void;
  leaveScene(destination: string): void;
  remember(fact: string): void;
  setHostile(hostile: boolean): void;
}

export type WorldScript = (world: WorldApi, outcome: SceneOutcome) => void;

/** A world that records operations against a fixed asset catalogue and known ids. */
export function recordingWorld(options: { assets: Asset[]; characters: string[]; anchors: string[] }): { world: WorldApi; operations: Operation[]; warnings: string[] } {
  const operations: Operation[] = [];
  const warnings: string[] = [];
  const record = (op: string, args: Record<string, unknown>) => { operations.push({ op, args }); };
  const assetById = new Map(options.assets.map(a => [a.id, a]));
  const known = new Set(options.characters);
  const anchors = new Set(options.anchors);
  const character = (id: string): CharacterHandle => {
    if (!known.has(id) && id !== "player") warnings.push(`unknown character ${id}`);
    const on = (op: string) => (args: Record<string, unknown>) => record(`character.${op}`, { id, ...args });
    return {
      type: "character", id,
      setAttitude: (attitude, reason) => on("setAttitude")({ attitude, reason }),
      moveTo: place => on("moveTo")({ place: typeof place === "string" ? place : ref(place) }),
      kill: cause => on("kill")({ cause }),
      wound: description => on("wound")({ description }),
      giveItem: item => on("giveItem")({ item }),
      takeItem: itemId => on("takeItem")({ item: itemId }),
      joinParty: () => on("joinParty")({}),
      leaveScene: destination => on("leaveScene")({ destination }),
      remember: fact => on("remember")({ fact }),
      setHostile: hostile => on("setHostile")({ hostile }),
    };
  };
  const ref = (place: Place) => `${place.type}:${place.id}`;
  const world: WorldApi = {
    assets: {
      search(query, kind) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return options.assets
          .filter(a => !kind || a.kind === kind)
          .map(a => ({ a, score: words.filter(w => a.name.toLowerCase().includes(w) || a.tags.some(t => t.includes(w))).length }))
          .filter(x => x.score > 0).sort((x, y) => y.score - x.score).map(x => x.a);
      },
      get(id) {
        const asset = assetById.get(id);
        if (!asset) { warnings.push(`unknown asset ${id}`); return { id, kind: "prop", name: id, tags: [] }; }
        return asset;
      },
    },
    anchor(id) {
      if (!anchors.has(id)) warnings.push(`unknown anchor ${id}`);
      return { type: "anchor", id };
    },
    character,
    player: {
      addItem: item => record("player.addItem", { item }),
      removeItem: id => record("player.removeItem", { id }),
      addGold: amount => record("player.addGold", { amount }),
    },
    newReadable: spec => ({ ...spec, kind: "readable", description: spec.name }),
    newItem: spec => ({ ...spec }),
    scatter: spec => record("scatter", { asset: spec.asset.id, count: spec.count, around: ref(spec.around), radius: spec.radius }),
    place: spec => record("place", { asset: spec.asset.id, at: ref(spec.at), note: spec.note }),
    quest: id => ({
      start: (title, summary) => record("quest.start", { id, title, summary }),
      advance: (stage, note) => record("quest.advance", { id, stage, note }),
      complete: note => record("quest.complete", { id, note }),
      fail: note => record("quest.fail", { id, note }),
    }),
    startCombat: spec => record("startCombat", { enemies: spec.enemies.map(e => ({ asset: e.asset.id, count: e.count, leader: e.leader })), allies: spec.allies, at: ref(spec.at), surprise: spec.surprise }),
    setFlag: (name, value) => record("setFlag", { name, value }),
    journal: entry => record("journal", { entry }),
    unsupported: description => record("unsupported", { description }),
  };
  return { world, operations, warnings };
}
