import type { Db } from "./context.ts";
import type { RowOf } from "./rows.ts";

/**
 * Each table's primary key, auto-increment, unique columns and indexes, as plain data: what the
 * memory host (host/memory.ts) needs to answer `tx.db.<table>.<column>.find/filter/update/delete`
 * the way SpacetimeDB does, since it can't load schema.ts (spacetimedb/server doesn't load in Node).
 * Typed against the schema's own rows, so a column named here that a table hasn't got is a type
 * error, and a table missing from here is one too. Keep it in step with schema.ts.
 */

type Column<T extends keyof Db> = keyof RowOf<T> & string;

export interface TableMeta<T extends keyof Db> {
  primaryKey: Column<T>;
  /** Inserted as 0n, given the next id. */
  autoInc?: boolean;
  unique?: Array<Column<T>>;
  /** Single-column btree indexes. */
  indexes?: Array<Column<T>>;
  /** Multi-column indexes, by their accessor. */
  named?: Record<string, Array<Column<T>>>;
}

export const TABLES: { [T in keyof Db]: TableMeta<T> } = {
  game: { primaryKey: "id", autoInc: true, unique: ["uid"] },
  player: { primaryKey: "id", autoInc: true, indexes: ["identity", "gameId"] },
  seat: { primaryKey: "identity" },
  sheet: { primaryKey: "playerId", indexes: ["gameId"] },
  dice: { primaryKey: "gameId" },
  admin: { primaryKey: "identity" },

  scene: { primaryKey: "id", autoInc: true, indexes: ["gameId"] },
  gmState: { primaryKey: "sceneId" },
  onStage: { primaryKey: "entityId", indexes: ["sceneId"] },
  turn: { primaryKey: "id", autoInc: true, indexes: ["sceneId"] },
  transcript: { primaryKey: "id", autoInc: true, indexes: ["sceneId"] },
  replyDraft: { primaryKey: "turnId", indexes: ["sceneId"] },
  sceneSuggestion: { primaryKey: "id", autoInc: true, indexes: ["sceneId"] },
  heard: { primaryKey: "id", autoInc: true, indexes: ["playerId"] },

  place: { primaryKey: "id", autoInc: true, indexes: ["gameId"] },
  entity: { primaryKey: "id", autoInc: true, indexes: ["placeId"], named: { byGameKey: ["gameId", "key"] } },
  position: { primaryKey: "entityId", indexes: ["placeId"] },
  area: { primaryKey: "entityId", indexes: ["placeId"] },
  material: { primaryKey: "entityId", indexes: ["placeId"] },
  health: { primaryKey: "entityId", indexes: ["placeId"] },
  stack: { primaryKey: "entityId", indexes: ["placeId"] },
  surface: { primaryKey: "entityId", indexes: ["placeId"] },
  creature: { primaryKey: "entityId", indexes: ["placeId"] },
  playerCharacter: { primaryKey: "entityId", indexes: ["placeId"] },
  gear: { primaryKey: "entityId", indexes: ["placeId"] },
  narrative: { primaryKey: "entityId", indexes: ["placeId"] },
  gmNote: { primaryKey: "entityId", indexes: ["placeId"] },
  worldLog: { primaryKey: "id", autoInc: true, indexes: ["placeId"] },
  look: { primaryKey: "entityId", indexes: ["placeId"] },

  job: { primaryKey: "id", autoInc: true, unique: ["key"], indexes: ["state", "turnId"] },
  jobDispatch: { primaryKey: "scheduledId", autoInc: true },
  reaper: { primaryKey: "scheduledId", autoInc: true },

  campaign: { primaryKey: "id" },
  sceneDef: { primaryKey: "id", indexes: ["campaignId"] },
  placeDef: { primaryKey: "id", indexes: ["campaignId"] },
};
