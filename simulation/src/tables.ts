import { Timestamp } from "spacetimedb";
import type { Db } from "./context.ts";
import type { RowOf } from "./rows.ts";

/**
 * Each table's primary key, auto-increment, unique columns and indexes, as plain data: what the
 * memory host (host/memory.ts) needs to answer `tx.db.<table>.<column>.find/filter/update/delete`
 * the way SpacetimeDB does, since it can't load schema.ts (spacetimedb/server doesn't load in Node).
 * Typed against the schema's own rows, so a column named here that a table hasn't got is a type
 * error, and a table missing from here is one too. Keep it in step with schema.ts.
 *
 * And what a host that keeps rows outside SpacetimeDB needs (the page's: browser-design §4.2):
 * which tables clients subscribe to, and the defaults a row saved before its column was added
 * takes when it's restored. tables.test.ts checks both, and that each SQL name is its accessor in
 * snake_case, against schema.ts's text.
 */

/** The module's tables, by their accessors: Db's own keys (not its index signature, which the SDK adds for namespaces the module hasn't got). */
export type TableName = keyof { [T in keyof Db as T extends string ? (string extends T ? never : T) : never]: Db[T] };

type Column<T extends TableName> = keyof RowOf<T> & string;

export interface TableMeta<T extends TableName> {
  primaryKey: Column<T>;
  /** Inserted as 0n, given the next id. */
  autoInc?: boolean;
  unique?: Array<Column<T>>;
  /** Single-column btree indexes. */
  indexes?: Array<Column<T>>;
  /** Multi-column indexes, by their accessor. */
  named?: Record<string, Array<Column<T>>>;
  /** Clients subscribe to it (schema.ts's `public: true`); the other tables are the module's own. */
  public?: true;
  /** schema.ts's `.default(…)` for each column that has one, but an option's (undefined, which a row without the column reads as anyway). */
  defaults?: Partial<RowOf<T>>;
}

export const TABLES: { [T in TableName]: TableMeta<T> } = {
  game: { primaryKey: "id", autoInc: true, unique: ["uid"], public: true },
  player: { primaryKey: "id", autoInc: true, indexes: ["identity", "gameId"], public: true, defaults: { suggestions: true, lastPlayedAt: new Timestamp(0n) } },
  seat: { primaryKey: "identity" },
  sheet: {
    primaryKey: "playerId", indexes: ["gameId"], public: true,
    defaults: { level: 0, hp: 0, maxHp: 0, ac: 0, slots: [], conditions: [], spells: [], weapons: [], features: [], data: "", pockets: "", spellFacts: "", actions: "" },
  },
  dice: { primaryKey: "gameId" },
  admin: { primaryKey: "identity" },

  scene: { primaryKey: "id", autoInc: true, indexes: ["gameId"], public: true },
  gmState: { primaryKey: "sceneId", defaults: { patches: "[]", absent: [], adjustments: [], owed: [], fought: [], reached: [] } },
  onStage: { primaryKey: "entityId", indexes: ["sceneId"], public: true },
  turn: { primaryKey: "id", autoInc: true, indexes: ["sceneId"], public: true, defaults: { notes: "none", suggest: "none", suggestAsks: 0 } },
  transcript: { primaryKey: "id", autoInc: true, indexes: ["sceneId"], public: true },
  replyDraft: { primaryKey: "turnId", indexes: ["sceneId"], public: true },
  sceneSuggestion: { primaryKey: "id", autoInc: true, indexes: ["sceneId"], public: true },
  heard: { primaryKey: "id", autoInc: true, indexes: ["playerId"] },

  chapter: { primaryKey: "sceneId", indexes: ["gameId"], public: true },
  quest: { primaryKey: "id", autoInc: true, indexes: ["gameId"], public: true },
  flag: { primaryKey: "id", autoInc: true, indexes: ["gameId"], public: true },
  journal: { primaryKey: "id", autoInc: true, indexes: ["gameId"], public: true },
  attitude: { primaryKey: "id", autoInc: true, indexes: ["gameId"], public: true },
  follower: { primaryKey: "id", autoInc: true, indexes: ["gameId"], public: true },
  talkRecord: { primaryKey: "id", autoInc: true, indexes: ["gameId"] },

  place: { primaryKey: "id", autoInc: true, indexes: ["gameId"], public: true, defaults: { active: false, town: "" } },
  entity: { primaryKey: "id", autoInc: true, indexes: ["placeId"], named: { byGameKey: ["gameId", "key"] }, public: true },
  position: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  area: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  material: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  health: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  stack: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  surface: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  creature: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  playerCharacter: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  gear: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  narrative: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  gmNote: { primaryKey: "entityId", indexes: ["placeId"] },
  worldLog: { primaryKey: "id", autoInc: true, indexes: ["placeId"], public: true },
  look: { primaryKey: "entityId", indexes: ["placeId"], public: true },
  lookInvention: { primaryKey: "key" },

  job: { primaryKey: "id", autoInc: true, unique: ["key"], indexes: ["state"] },
  jobDispatch: { primaryKey: "scheduledId", autoInc: true },
  reaper: { primaryKey: "scheduledId", autoInc: true },

  campaign: { primaryKey: "id", public: true },
  sceneDef: { primaryKey: "id", indexes: ["campaignId"] },
  placeDef: { primaryKey: "id", indexes: ["campaignId"] },
  mapDef: { primaryKey: "id", indexes: ["campaignId"], public: true },

  creation: { primaryKey: "identity" },
  rulesState: { primaryKey: "playerId", indexes: ["gameId"], defaults: { npcs: "{}", timed: false } },

  explore: { primaryKey: "playerId", indexes: ["gameId"], public: true },
  placeTick: { primaryKey: "scheduledId", autoInc: true },
};
