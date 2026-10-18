// New (M5: problem reports): every table's rows of a game, and what each one's ids name, as a report reads them and a restore writes them back.
import type { TxCtx } from "../context.ts";
import type { GameRow } from "../rows.ts";
import type { TableName } from "../tables.ts";

/**
 * Every row of a game, table by table (V16: a report's rows, a restore's), as delete.ts deletes
 * them: by the game, and by its players, scenes, places, jobs and fights. Each table says what its
 * ids name, so a restore can give the rows new ids in another database: its own id (the tables
 * whose rows others point at), and each column that points at another row of the game. A table that
 * isn't a game's (the campaigns, the owner, the reaper, the looks invented by name) is in NOT_A_GAMES,
 * with why; tables.test.ts holds every table to one list or the other, so a vertical that adds a
 * table says which it is.
 */

/** A row as a report and a restore handle it: its columns by name. */
export type Row = Record<string, unknown>;

/** What a game's rows are found by: the game, and the ids of its players, scenes, places, jobs and fights. */
export interface GameOf { game: GameRow; players: bigint[]; scenes: bigint[]; places: bigint[]; jobs: bigint[]; fights: bigint[] }

/** What an id names: a row of one of the game's tables that others point at. */
export type IdKind = "game" | "player" | "scene" | "place" | "entity" | "turn" | "fight";

export interface GameTable {
  table: TableName;
  /** The game's rows of it. */
  rows(tx: TxCtx, of: GameOf): Row[];
  /** Its own id, where other rows point at it: what it is. (Any other autoInc table's rows take new ids of their own.) */
  own?: IdKind;
  /** Its columns that point at other rows of the game, and what they point at. */
  refs?: Record<string, IdKind>;
  /** Which of them are options: one pointing at a row the restore leaves out is none, where another's row is left out with it. */
  options?: string[];
  /** A restore rebuilds these (a job's request from the rows as they are), or leaves them: not written back as they are. */
  rebuilt?: true;
}

/** Rows by one of the ids the game has of a kind (players, scenes, places, fights). */
const by = <R>(ids: bigint[], rows: (id: bigint) => Iterable<R>) => ids.flatMap(id => [...rows(id)]) as Row[];
const one = <R>(row: R | null | undefined) => (row ? [row as Row] : []);

/** In the order a restore writes them: whatever a row points at by its own id comes before it, but where they point at each other (the game and its host, a place and its root). */
export const GAME_TABLES: GameTable[] = [
  { table: "game", rows: (_tx, { game }) => [game as Row], own: "game", refs: { hostId: "player" } },
  { table: "player", rows: (tx, { game }) => [...tx.db.player.gameId.filter(game.id)], own: "player", refs: { gameId: "game", characterId: "entity", placeId: "place", sceneId: "scene" }, options: ["characterId", "placeId", "sceneId"] },
  { table: "place", rows: (tx, { game }) => [...tx.db.place.gameId.filter(game.id)], own: "place", refs: { gameId: "game", rootId: "entity", sceneId: "scene" }, options: ["sceneId"] },
  { table: "scene", rows: (tx, { game }) => [...tx.db.scene.gameId.filter(game.id)], own: "scene", refs: { gameId: "game", placeId: "place", controllerId: "player", turnId: "turn" }, options: ["turnId"] },
  { table: "entity", rows: (tx, { places }) => by(places, id => tx.db.entity.placeId.filter(id)), own: "entity", refs: { gameId: "game", placeId: "place", parentId: "entity" }, options: ["parentId"] },
  { table: "turn", rows: (tx, { scenes }) => by(scenes, id => tx.db.turn.sceneId.filter(id)), own: "turn", refs: { gameId: "game", sceneId: "scene", playerId: "player" } },
  { table: "fight", rows: (tx, { game }) => [...tx.db.fight.gameId.filter(game.id)], own: "fight", refs: { gameId: "game", playerId: "player" } },

  { table: "seat", rows: (tx, { players }) => [...tx.db.seat.iter()].filter(s => players.includes(s.playerId)), refs: { playerId: "player" } },
  { table: "sheet", rows: (tx, { game }) => [...tx.db.sheet.gameId.filter(game.id)], refs: { playerId: "player", gameId: "game" } },
  { table: "dice", rows: (tx, { game }) => one(tx.db.dice.gameId.find(game.id)), refs: { gameId: "game" } },
  { table: "rulesState", rows: (tx, { game }) => [...tx.db.rulesState.gameId.filter(game.id)], refs: { playerId: "player", gameId: "game" } },
  { table: "creation", rows: (tx, { game }) => [...tx.db.creation.iter()].filter(c => c.gameId === game.id), refs: { gameId: "game" } },
  { table: "explore", rows: (tx, { game }) => [...tx.db.explore.gameId.filter(game.id)], refs: { playerId: "player", gameId: "game" } },
  { table: "heard", rows: (tx, { players }) => by(players, id => tx.db.heard.playerId.filter(id)), refs: { gameId: "game", playerId: "player" } },

  { table: "gmState", rows: (tx, { scenes }) => by(scenes, id => one(tx.db.gmState.sceneId.find(id))), refs: { sceneId: "scene" } },
  { table: "onStage", rows: (tx, { scenes }) => by(scenes, id => tx.db.onStage.sceneId.filter(id)), refs: { entityId: "entity", sceneId: "scene" } },
  { table: "transcript", rows: (tx, { scenes }) => by(scenes, id => tx.db.transcript.sceneId.filter(id)), refs: { gameId: "game", sceneId: "scene" } },
  { table: "replyDraft", rows: (tx, { scenes }) => by(scenes, id => tx.db.replyDraft.sceneId.filter(id)), refs: { turnId: "turn", sceneId: "scene" } },
  { table: "sceneSuggestion", rows: (tx, { scenes }) => by(scenes, id => tx.db.sceneSuggestion.sceneId.filter(id)), refs: { gameId: "game", sceneId: "scene", playerId: "player" } },

  { table: "chapter", rows: (tx, { game }) => [...tx.db.chapter.gameId.filter(game.id)], refs: { sceneId: "scene", gameId: "game" } },
  { table: "quest", rows: (tx, { game }) => [...tx.db.quest.gameId.filter(game.id)], refs: { gameId: "game" } },
  { table: "flag", rows: (tx, { game }) => [...tx.db.flag.gameId.filter(game.id)], refs: { gameId: "game", sceneId: "scene" } },
  { table: "journal", rows: (tx, { game }) => [...tx.db.journal.gameId.filter(game.id)], refs: { gameId: "game", sceneId: "scene" } },
  { table: "attitude", rows: (tx, { game }) => [...tx.db.attitude.gameId.filter(game.id)], refs: { gameId: "game", playerId: "player" } },
  { table: "follower", rows: (tx, { game }) => [...tx.db.follower.gameId.filter(game.id)], refs: { gameId: "game", leaderId: "player" } },
  { table: "talkRecord", rows: (tx, { game }) => [...tx.db.talkRecord.gameId.filter(game.id)], refs: { gameId: "game" } },

  ...(["position", "area", "material", "health", "stack", "surface", "creature", "gear", "narrative", "gmNote", "look"] as const).map((table): GameTable => ({
    table, rows: (tx, { places }) => by(places, id => (tx.db[table] as unknown as { placeId: { filter(id: bigint): Iterable<Row> } }).placeId.filter(id)), refs: { entityId: "entity", placeId: "place" },
  })),
  { table: "playerCharacter", rows: (tx, { places }) => by(places, id => tx.db.playerCharacter.placeId.filter(id)), refs: { entityId: "entity", placeId: "place", playerId: "player" } },
  { table: "worldLog", rows: (tx, { places }) => by(places, id => tx.db.worldLog.placeId.filter(id)), refs: { placeId: "place" } },
  { table: "placeTick", rows: (tx, { places }) => [...tx.db.placeTick.iter()].filter(t => places.includes(t.placeId)), refs: { placeId: "place" } },

  { table: "fightRules", rows: (tx, { game }) => [...tx.db.fightRules.gameId.filter(game.id)], refs: { fightId: "fight", gameId: "game" } },
  { table: "fightEvent", rows: (tx, { game }) => [...tx.db.fightEvent.gameId.filter(game.id)], refs: { fightId: "fight", gameId: "game" } },
  { table: "fightClock", rows: (tx, { fights }) => [...tx.db.fightClock.iter()].filter(c => fights.includes(c.fightId)), refs: { fightId: "fight" } },

  { table: "job", rows: (tx, { jobs }) => jobs.map(id => tx.db.job.id.find(id)).filter(Boolean) as Row[], rebuilt: true },
  { table: "jobDispatch", rows: (tx, { jobs }) => [...tx.db.jobDispatch.iter()].filter(d => jobs.includes(d.jobId)), rebuilt: true },
];

/** The tables that aren't a game's, and why. */
export const NOT_A_GAMES: Partial<Record<TableName, string>> = {
  admin: "the database's owner",
  reaper: "the job loop's own interval",
  campaign: "a campaign version, which every game of it shares",
  sceneDef: "a campaign version's scenes",
  placeDef: "a campaign version's places",
  mapDef: "a campaign version's maps",
  lookInvention: "a look invented for a thing by its name, which every game shares",
};

/** What the game's rows are found by. */
export function gameOf(tx: TxCtx, game: GameRow): GameOf {
  const fights = [...tx.db.fight.gameId.filter(game.id)].map(f => f.id);
  return {
    game,
    players: [...tx.db.player.gameId.filter(game.id)].map(p => p.id),
    scenes: [...tx.db.scene.gameId.filter(game.id)].map(s => s.id),
    places: [...tx.db.place.gameId.filter(game.id)].map(p => p.id),
    jobs: [...tx.db.job.iter()].filter(j => j.gameId === game.id).map(j => j.id),
    fights,
  };
}

/** Every row of the game, by table (each table in GAME_TABLES, its rows in no order). */
export function gameRows(tx: TxCtx, game: GameRow): Partial<Record<TableName, Row[]>> {
  const of = gameOf(tx, game);
  return Object.fromEntries(GAME_TABLES.map(t => [t.table, t.rows(tx, of)]));
}
