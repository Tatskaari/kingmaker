import type { InteractArgs, TravelArgs, WalkArgs } from "../../shared/map/moves.ts";
import type { MoveWire } from "../../shared/protocol/port.ts";
import { refusal } from "../../shared/protocol/refusals.ts";
import type { Backend, HomeRows, MoveName, Moves, NewGame, Rejection } from "../backend.ts";
import { exploreViewOf, type ExploreRows, type ExploreView, type MapPlaceTables } from "../explore/rows.ts";
import { fightViewOf, type FightView } from "../fight/view.ts";
import { keepInvented } from "../look/invented.ts";
import type { Look, SeatView } from "../module_bindings/types.ts";
import type { PlaceTables } from "../scene/place-rows.ts";
import { sceneViewOf, type SceneRows } from "../scene/rows.ts";
import type { SceneView } from "../scene/view.ts";
import { PLACE_TABLES, type Link, type LinkMoves, type LinkStatus, type RowListener, type RowOp, type Watched } from "./link.ts";

/**
 * The client's rows and its views over them, whatever brings the rows (browser-design §4.1): the
 * SpacetimeDB connection (connection.ts's Connection is this over a SpacetimeLink), or a port to the
 * page's server worker (port.ts). Each row change rebuilds the scene's rows from the link's tables,
 * once a tick; each row event also goes, in arrival order, to whoever listens; the map's view is made
 * again only when its tables have moved. The moves go through the link: a refusal comes back as the
 * simulation wrote it, in the game's words, and is kept for the status line until the next move.
 */
export class Replica implements Backend {
  /** Resolves once the seat and its rows are in (connect awaits it); rejects when the server can't be reached. */
  readonly ready: Promise<void>;

  private readonly link: Link;
  private refused?: string;
  /** What's wrong with the link, while something is: shown on the status line. Cut off, every move is refused with it. */
  private status: LinkStatus = {};
  private pending = false;
  /** Moves on with every row event of a table the map is read from: the explore view is made again only then. */
  private mapRev = 0;
  private explored?: { rev: number; refused: string | undefined; trouble: string | undefined; seat: string; view: ExploreView | undefined };
  private readonly changes = new Set<() => void>();
  private readonly events = new Set<RowListener>();

  constructor(link: Link) {
    this.link = link;
    this.ready = link.ready;
    link.onRow((table, op, row) => this.event(table, op, row));
    link.onStatus(status => this.troubled(status));
  }

  /** The scene's rows as this client holds them; undefined while there's no seat, or its rows haven't come. */
  rows(): SceneRows | undefined {
    const seat = this.seat();
    const t = this.link.tables;
    const game = seat ? t.game.id.find(seat.gameId) : undefined;
    const scene = seat?.sceneId === undefined ? undefined : t.scene.id.find(seat.sceneId);
    if (!seat || !game || !scene) return undefined;

    const of = <T>(table: { iter(): Iterable<T> }, keep: (row: T) => boolean) => [...table.iter()].filter(keep);
    const mine = <T extends { gameId: bigint }>(table: { iter(): Iterable<T> }) => of(table, r => r.gameId === game.id);
    const onStage = of(t.onStage, s => s.sceneId === scene.id);
    // Whoever's on stage keeps their look wherever their entity is: a talk's companion is on stage in a talk on the town's place, their entity still in the waiting scene's (town-design §3.6).
    const staged = new Set(onStage.map(s => s.entityId));
    return {
      me: seat.playerId,
      game, scene,
      players: of(t.player, p => p.gameId === game.id),
      sheets: of(t.sheet, s => s.gameId === game.id),
      transcript: of(t.transcript, r => r.sceneId === scene.id),
      drafts: of(t.replyDraft, d => d.sceneId === scene.id),
      turns: of(t.turn, r => r.sceneId === scene.id),
      onStage,
      names: [...t.myNames.iter()],
      looks: of(t.look, l => l.placeId === scene.placeId || staged.has(l.entityId)),
      suggestions: of(t.sceneSuggestion, s => s.sceneId === scene.id),
      story: {
        game, scenes: mine(t.scene), chapters: mine(t.chapter), quests: mine(t.quest), flags: mine(t.flag),
        journal: mine(t.journal), attitudes: mine(t.attitude), followers: mine(t.follower), turns: mine(t.turn),
      },
      ...this.placeOf(scene),
      ...(t.explore.playerId.find(game.hostId) ? { onMap: true } : {}),
      ...(this.refused ? { refusal: this.refused } : {}),
      ...(this.status.trouble ? { trouble: this.status.trouble } : {}),
      ...(this.status.cutOff ? { cutOff: true } : {}),
    };
  }

  view(): SceneView | undefined {
    const rows = this.rows();
    return rows && sceneViewOf(rows);
  }

  /**
   * The map's rows as this client holds them (map-design §3.6): the seat's game, its players and
   * sheets, the campaign's maps, the game's explore rows and scenes, its places on maps with their
   * rows, and the names the player knows the people in them by; undefined while there's no seat or
   * its game's row hasn't come.
   */
  exploreRows(): ExploreRows | undefined {
    const seat = this.seat();
    const t = this.link.tables;
    const game = seat ? t.game.id.find(seat.gameId) : undefined;
    if (!seat || !game) return undefined;
    const campaign = `${game.campaign}@${game.campaignVersion}`;
    const ofGame = <T extends { gameId: bigint }>(table: { iter(): Iterable<T> }) => [...table.iter()].filter(r => r.gameId === game.id);
    const places: MapPlaceTables[] = ofGame(t.place).filter(p => p.mapKey !== undefined).map(place => {
      const here = <T extends { placeId: bigint }>(table: { iter(): Iterable<T> }) => [...table.iter()].filter(r => r.placeId === place.id);
      return {
        place, entity: here(t.entity), position: here(t.position), area: here(t.area), material: here(t.material), health: here(t.health),
        stack: here(t.stack), surface: here(t.surface), creature: here(t.creature), playerCharacter: here(t.playerCharacter),
        gear: here(t.gear), narrative: here(t.narrative), worldLog: here(t.worldLog),
      };
    });
    return {
      me: seat.playerId, game,
      players: ofGame(t.player), sheets: ofGame(t.sheet),
      maps: [...t.mapDef.iter()].filter(m => m.campaignId === campaign),
      explore: ofGame(t.explore), scenes: ofGame(t.scene), places,
      names: [...t.myNames.iter()],
      ...(this.refused ? { refusal: this.refused } : {}),
      ...(this.status.trouble ? { trouble: this.status.trouble } : {}),
      ...(this.status.cutOff ? { cutOff: true } : {}),
    };
  }

  /**
   * The map between scenes, made from the rows: made again only when they (or the words beside it)
   * have changed. While the link doesn't yet cover the game's places on maps (over SpacetimeDB, the
   * set naming them is still coming: a game just begun, a map just reached), the map as it was, or
   * none yet: a place's row comes with the game's, but its world's rows only with that set, and a
   * waiting yard without them has nobody in it.
   */
  explore(): ExploreView | undefined {
    const seat = this.seat();
    const key = { rev: this.mapRev, refused: this.refused, trouble: this.status.trouble, seat: seat ? `${seat.playerId}:${seat.gameId}` : "" };
    const was = this.explored;
    if (!this.link.covers()) return was?.seat === key.seat ? was.view : undefined;
    if (was && was.rev === key.rev && was.refused === key.refused && was.trouble === key.trouble && was.seat === key.seat) return was.view;
    const rows = this.exploreRows();
    const view = rows && exploreViewOf(rows);
    this.explored = { ...key, view };
    return view;
  }

  /**
   * The seat's game's fight (M6, docs/combat-design.md), while it's on or its end is on screen (not
   * yet done), made from its rows: the fight row, its moments, and the campaign's map it's on when
   * it's the campaign's. Undefined with none, or before its map has come.
   */
  fight(): FightView | undefined {
    const seat = this.seat();
    const t = this.link.tables;
    const game = seat ? t.game.id.find(seat.gameId) : undefined;
    if (!seat || !game) return undefined;
    const fight = [...t.fight.iter()].filter(f => f.gameId === game.id).sort((a, b) => (a.id > b.id ? -1 : 1))[0];
    if (!fight || fight.status === "done") return undefined;
    const mapId = fight.mapKey === undefined ? undefined : `${game.campaign}@${game.campaignVersion}/${fight.mapKey}`;
    const mapFile = mapId === undefined ? undefined : [...t.mapDef.iter()].find(m => m.id === mapId)?.json;
    return fightViewOf({
      me: seat.playerId, game: game.id, fight, events: [...t.fightEvent.iter()].filter(e => e.fightId === fight.id),
      ...(mapFile ? { mapFile } : {}), owner: t.player.id.find(fight.playerId)?.name ?? "someone", ...(this.refused ? { refusal: this.refused } : {}),
    });
  }

  /** The scene's place and its world's rows, once its row has come (the world bridge's §3.5). */
  private placeOf(scene: { placeId: bigint; sceneKey: string }): { place?: PlaceTables } {
    const t = this.link.tables;
    const place = t.place.id.find(scene.placeId);
    if (!place) return {};
    const here = <T extends { placeId: bigint }>(table: { iter(): Iterable<T> }) => [...table.iter()].filter(r => r.placeId === place.id);
    return {
      place: {
        sceneKey: scene.sceneKey, place,
        entity: here(t.entity), position: here(t.position), area: here(t.area), material: here(t.material), health: here(t.health),
        stack: here(t.stack), surface: here(t.surface), creature: here(t.creature), playerCharacter: here(t.playerCharacter),
        gear: here(t.gear), narrative: here(t.narrative), worldLog: here(t.worldLog),
      },
    };
  }

  /** The caller's seat (my_seat): its player, game, place and scene; undefined when it has none. */
  seat(): SeatView | undefined {
    return [...this.link.tables.mySeat.iter()][0];
  }

  /** The caller's games and the character they're making, the campaigns, and the seat's own player and sheet (before its game has a scene too). */
  home(): HomeRows {
    const t = this.link.tables;
    const seat = this.seat();
    const player = seat ? t.player.id.find(seat.playerId) : undefined;
    const sheet = seat ? t.sheet.playerId.find(seat.playerId) : undefined;
    const creation = [...t.myCreation.iter()][0];
    return {
      games: [...t.myGames.iter()],
      ...(creation ? { creation } : {}),
      campaigns: [...t.campaign.iter()],
      ...(seat ? { seat } : {}),
      ...(player ? { player } : {}),
      ...(sheet ? { sheet } : {}),
      ...(this.refused ? { refusal: this.refused } : {}),
    };
  }

  onChange(listener: () => void): () => void {
    this.changes.add(listener);
    return () => { this.changes.delete(listener); };
  }

  /** Every row event of the watched tables, in the order they arrive (a move's row events come before its promise resolves). */
  onEvent(listener: RowListener): () => void {
    this.events.add(listener);
    return () => { this.events.delete(listener); };
  }

  newGame(args: NewGame): Promise<Rejection | undefined> {
    return this.move("newGame", args);
  }

  joinGame(game: bigint): Promise<Rejection | undefined> {
    return this.move("joinGame", { game });
  }

  say(text: string): Promise<Rejection | undefined> {
    return this.move("say", { text });
  }

  walk(args: WalkArgs): Promise<Rejection | undefined> {
    return this.move("walk", { to: args.to, toward: args.toward });
  }

  interact(args: InteractArgs): Promise<Rejection | undefined> {
    return this.move("interact", { verb: args.verb, target: args.target, at: args.at });
  }

  travel(args: TravelArgs): Promise<Rejection | undefined> {
    return this.move("travel", { way: args.way, at: args.at });
  }

  /** This player's own setting: the suggested lines on or off (on, this moment's are asked for at once). */
  setSuggestions(on: boolean): Promise<Rejection | undefined> {
    return this.move("setSuggestions", { on });
  }

  /** Carries the failed turn on: the one holding the scene's lease. */
  retry(): Promise<Rejection | undefined> {
    const turn = this.rows()?.scene.turnId;
    return turn === undefined ? Promise.resolve(refusal("not_failed")) : this.retryTurn(turn);
  }

  retryTurn(turn: bigint): Promise<Rejection | undefined> {
    return this.move("retryTurn", { turn });
  }

  act<K extends MoveName>(move: K, args: Moves[K]): Promise<Rejection | undefined> {
    // end_scene is the owner's (testing): the link makes it as the owner, not as this player, so none of this player's moves' bookkeeping.
    if (move === "endScene") return this.link.move("endScene", args as Moves["endScene"]);
    return this.move(move, args as LinkMoves[K]);
  }

  close(): void {
    this.link.close();
  }

  // -------------------------------------------------------------------------------------------
  // Rows and moves.

  private event(table: Watched, op: RowOp, row: unknown): void {
    if (MAP_TABLES.has(table)) this.mapRev++;
    if (table === "look" && op !== "delete") this.invented(row as Look);
    for (const listener of this.events) listener(table, op, row);
    this.changed();
  }

  /** A look the AI service invented for something the story made up (town-design §3.7): the look layer's from now on, by the thing's name (its entity's, in the same commit). */
  private invented(look: Look): void {
    if (!look.invention) return;
    const thing = [...this.link.tables.entity.iter()].find(e => e.id === look.entityId);
    keepInvented(thing?.name, look.invention, thing?.kind);
  }

  /** The link's trouble (or what it covers) changed: the listeners hear of it. */
  private troubled(status: LinkStatus): void {
    this.status = status;
    this.changed();
  }

  /** The rows changed: once a tick, the listeners hear of it. */
  private changed(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const listener of this.changes) listener();
    });
  }

  /**
   * A move through the link: undefined when it was made; else why not, and the words kept for the
   * status line until the next move. Once the link is cut off, none is sent: the words say why.
   */
  private async move<K extends MoveWire>(name: K, args: LinkMoves[K]): Promise<Rejection | undefined> {
    this.refused = this.status.cutOff;
    this.changed();
    if (this.status.cutOff) return { code: "error", text: this.status.cutOff };
    const why = await this.link.move(name, args);
    if (why) {
      this.refused = why.text;
      this.changed();
    }
    return why;
  }
}

/** The tables the map is read from (map-design §3.6): an event in one makes the explore view again. */
const MAP_TABLES = new Set<Watched>(["my_seat", "my_names", "game", "player", "sheet", "scene", "place", ...PLACE_TABLES, "map_def", "explore"]);
