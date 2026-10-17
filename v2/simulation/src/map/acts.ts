import type { Identity } from "spacetimedb";
import { isMenuAct, restedNow, type Keep } from "../../../shared/map/menu.ts";
import { doMenuAct, NotDone, storyRoute, type ActCtx, type Done } from "../../../shared/map/menu-acts.ts";
import { actionId, type AttackHow, type MenuMove } from "../../../shared/map/moves.ts";
import { exploreOf, exploreRowOf, keepOf, LOG_LINES, type ExploreRow } from "../../../shared/map/rows.ts";
import { Unavailable } from "../../../shared/map/town.ts";
import type { Tile2 } from "../../../shared/map/types.ts";
import { refusal } from "../../../shared/protocol/refusals.ts";
import { catalogue } from "../../../shared/rules/actions.ts";
import type { RulesSession } from "../../../shared/rules/types.ts";
import type { Character } from "../../../shared/scene/types.ts";
import { inventory } from "../../../shared/world/inventory.ts";
import type { Entity } from "../../../shared/world/scene-world.ts";
import { actorOf, Refused, type Actor, type TxCtx } from "../context.ts";
import { getGm } from "../gm/rows.ts";
import { playerRow, type GameRow, type PlayerRow } from "../rows.ts";
import { engineCall, refreshPockets, saveSession, sessionOf, writeSheet } from "../rules/session.ts";
import { sceneGraph } from "../scenes.ts";
import { placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { openLead } from "./lead.ts";
import { FIGHT_FIRST, leave, walker } from "./moves.ts";
import { mapPlaceOf, mapRowsOf, writeExplore } from "./rows.ts";
import { openTalk } from "./talk.ts";
import { burns, keepTicking } from "./tick.ts";

/**
 * The map's action menu as moves (v2/docs/town-design.md §3.2): the rules on the town's world, each
 * one to one with the prototype's menu ids (shared/map/moves.ts actionId and moveOf), each the
 * walker's as the map's own moves are (not_in_game, not_controller, scene_on, no_way; a walker in a
 * scene that has ended walks out of it first). The prototype's town.act for a menu id
 * (src/game/town.ts:587-598): the ExploreState from rows (the town's changes in its overlay), the
 * menu's keep from the explore row, the session from the rules rows (with the rests taken this time
 * of day), the catalogue made now; storyRoute first (a waiting scene's people open their scene, the
 * act its first turn; Kell, a talk), else doMenuAct, pinned. Refused in the prototype's own sentence
 * (§3.2's codes), with nothing written. Done: the dice, rules_state and the sheet (the catalogue with
 * it), pennies lifted into the player's pockets, the town's changes on the map's place (place.town,
 * its clock started when something starts to burn), what a played place was left with back in its
 * rows, and the explore row: where they are, hidden or not, what it said, the keep, a fight recorded.
 */

/** cast_<spell>, cast_<spell>_self, cast_<spell>@x,y: a spell, aimed at a tile, at yourself, or not at all. */
export function castReducer(tx: TxCtx, sender: Identity, args: { spell: string; at?: Tile2 | undefined; self?: boolean | undefined }): void {
  menuMove(tx, actorOf(tx, sender), { move: "cast", args: { spell: args.spell, ...aim(args) } });
}

/** attack@x,y, throw@x,y, shove@x,y, grapple@x,y, lift@x,y: a blow, a throw, a shove, a grab, a pocket picked, at a tile. `how` is the id's first word. */
export function attackReducer(tx: TxCtx, sender: Identity, args: { how: string; at: Tile2 }): void {
  if (!HOWS.includes(args.how as AttackHow)) throw new Refused(refusal("unavailable"));
  menuMove(tx, actorOf(tx, sender), { move: "attack", args: { how: args.how as AttackHow, at: tile(args.at) } });
}

/** feature_<id>, feature_<id>_self, feature_<id>@x,y: a class feature with uses, aimed as a spell is. */
export function useFeatureReducer(tx: TxCtx, sender: Identity, args: { feature: string; at?: Tile2 | undefined; self?: boolean | undefined }): void {
  menuMove(tx, actorOf(tx, sender), { move: "useFeature", args: { feature: args.feature, ...aim(args) } });
}

/** jump@x,y: a leap to a tile in reach (the rules' jump: farther takes Athletics). */
export function leapReducer(tx: TxCtx, sender: Identity, args: { at: Tile2 }): void {
  menuMove(tx, actorOf(tx, sender), { move: "leap", args: { at: tile(args.at) } });
}

/** hide: a Stealth check against whoever's watching; out of sight until they move or do something. */
export function hideReducer(tx: TxCtx, sender: Identity, _args: Record<string, never> = {}): void {
  menuMove(tx, actorOf(tx, sender), { move: "hide", args: {} });
}

/** rest_short, rest_short_recover, rest_long: an hour (and Arcane Recovery), a night; once each before the clock moves on. `length`: short, long. */
export function restReducer(tx: TxCtx, sender: Identity, args: { length: string; recover?: boolean | undefined }): void {
  if (args.length !== "short" && args.length !== "long") throw new Refused(refusal("unavailable"));
  menuMove(tx, actorOf(tx, sender), { move: "rest", args: { length: args.length, ...(args.recover ? { recover: true } : {}) } });
}

/** use_<item>: something carried that's used up (a potion), by the engine's instance id. */
export function useItemReducer(tx: TxCtx, sender: Identity, args: { item: string }): void {
  menuMove(tx, actorOf(tx, sender), { move: "useItem", args: { item: args.item } });
}

const HOWS: AttackHow[] = ["attack", "throw", "shove", "grapple", "lift"];
const tile = (t: Tile2): Tile2 => ({ x: t.x, y: t.y });
const aim = (a: { at?: Tile2 | undefined; self?: boolean | undefined }) => (a.at ? { at: tile(a.at) } : a.self ? { self: true } : {});

/** One of the menu's acts, by its id: refused, or done and its rows written. */
function menuMove(tx: TxCtx, actor: Actor, move: MenuMove): void {
  const started = tx.elapsedMs();
  const { game, scene, row } = walker(tx, actor);
  const id = actionId(move);
  if (!id || !isMenuAct(id)) throw new Refused(refusal("unavailable"));
  if (row.fight) throw new Refused(refusal("not_now", { text: FIGHT_FIRST }));
  const walking = scene ? leave(tx, game, scene, row) : row;

  const rows = mapRowsOf(tx, game, walking);
  const ex = exploreOf(rows);
  const host = playerRow(tx, game.hostId);
  const session = sessionOf(tx, host);
  const campaign = session.rules?.campaign;
  const scenesBefore = JSON.stringify(ex.overlay.scenes);
  const keep: Keep = keepOf(rows.explore);
  const restedBefore = JSON.stringify(keep.rested ?? null);
  const done = acting(tx, game, actor, id, { ex, keep, session, companions: companionsOf(tx, game, ex.followers.map(f => f.id)), ...(game.leadScene ? { lead: game.leadScene } : {}) });

  // The character as the rules left it (the scene or talk this opens reads it), the sheet's menu with it.
  saveSession(tx, host, session);
  session.rested = restedNow({ ex, catalogue: undefined, keep });
  if (session.rules && (session.rules.campaign !== campaign || JSON.stringify(keep.rested ?? null) !== restedBefore)) engineCall(tx, game.id, rules => writeSheet(tx, host, session, rules));
  if (session.carried?.length) pocket(tx, host, session.carried);
  keepTheTown(tx, game, ex, rows.places.find(p => p.key === `map:${ex.map}`)?.town ?? "");
  keepPlayedPlaces(tx, game, ex.overlay.scenes, scenesBefore);

  if (done.scene) openLead(tx, actor, game, ex, done.act);
  else if (done.talk) openTalk(tx, actor, game, ex, done.talk, done.act);
  const written = exploreRowOf(ex, rows.explore, done.text);
  writeExplore(tx, { ...written, log: [...rows.explore.log, noted(done.text)].slice(-LOG_LINES), ...kept(keep), ...(done.fight ? { fight: done.fight } : {}) });
  tx.log(`[map] game ${game.id} ${id} ${Math.round(tx.elapsedMs() - started)} ms${done.scene ? `: ${game.leadScene} opens, the act its first turn` : done.talk ? `: a talk with ${done.talk.with}` : done.fight ? ": a fight breaks out" : ""}`);
}

/** The act itself, pinned (one engine call: its ids and dice the game's): the story's people first (a scene or a talk opens), else the rules on the town's world. Refused in the prototype's words. */
function acting(tx: TxCtx, game: GameRow, _actor: Actor, id: string, base: Omit<ActCtx, "rules" | "catalogue">): Done {
  try {
    return engineCall(tx, game.id, rules => {
      const c: ActCtx = { ...base, rules, catalogue: undefined };
      c.catalogue = catalogue(rules, base.session, { rested: restedNow(c) });
      return storyRoute(c, id) ?? doMenuAct(c, id);
    });
  } catch (e) {
    if (e instanceof NotDone) throw new Refused(refusal(e.code, { text: e.text }));
    if (e instanceof Unavailable) throw new Refused(refusal("unavailable"));
    throw e;
  }
}

/** What the town's log keeps of a menu act: its first line and its last (the prototype's note, town.ts:594-596). */
function noted(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  return [...new Set([lines[0], lines[lines.length - 1]])].filter(Boolean).join(" ");
}

/** The keep as the explore row has it (what the act set; nothing it didn't). */
function kept(keep: Keep): Pick<ExploreRow, "rested" | "spotted" | "lifted"> {
  return { ...(keep.rested ? { rested: keep.rested } : {}), ...(keep.spotted ? { spotted: keep.spotted } : {}), ...(keep.lifted ? { lifted: keep.lifted } : {}) };
}

/**
 * The cards of whoever walks with the player, as the scenes they came from have them (the rules take
 * a statblock and a weapon from a card): the latest scene of the game that has each in its cast.
 */
export function companionsOf(tx: TxCtx, game: GameRow, ids: string[]): Character[] {
  if (!ids.length) return [];
  const scenes = [...tx.db.scene.gameId.filter(game.id)].filter(s => s.kind !== "talk" && s.status !== "waiting").sort((a, b) => (a.id > b.id ? -1 : 1));
  const out: Character[] = [];
  for (const id of ids) {
    for (const s of scenes) {
      const card = sceneGraph(tx, s, getGm(tx, s.id)).cast.find(c => c.id === id);
      if (card) { out.push(card); break; }
    }
  }
  return out;
}

/**
 * What the rules did to the town, on the map's own place (place.town, JSON TownChanges): its clock
 * started (tickedAt) when something there has just caught fire, so the first tick burns one round,
 * and its place_tick row put in if it has none (a game kept from before the town's clock, on
 * SpacetimeDB or in a page, has none until its host next walks out onto the map).
 */
function keepTheTown(tx: TxCtx, game: GameRow, ex: ReturnType<typeof exploreOf>, before: string): void {
  const town = ex.overlay.town?.[ex.map];
  const json = town ? JSON.stringify(town) : "";
  if (json === before) return;
  const place = mapPlaceOf(tx, game, ex.map);
  const started = burns(json) && !burns(before) ? { tickedAt: tx.now } : {};
  tx.db.place.id.update({ ...place, town: json, ...started, rev: place.rev + 1 });
  if (burns(json)) keepTicking(tx, place.id);
}

/**
 * What the rules did to a played scene's leftovers (the yard gate blasted after the granary): each
 * changed thing's states written back to that place's rows (the overlay is made from them), as
 * take_<x> moves what's picked up there.
 */
function keepPlayedPlaces(tx: TxCtx, game: GameRow, scenes: ReturnType<typeof exploreOf>["overlay"]["scenes"], before: string): void {
  const was = JSON.parse(before) as typeof scenes;
  for (const [sceneKey, overlay] of Object.entries(scenes)) {
    if (JSON.stringify(overlay.things) === JSON.stringify(was[sceneKey]?.things)) continue;
    const scene = [...tx.db.scene.gameId.filter(game.id)].find(s => s.sceneKey === sceneKey && s.status === "ended");
    if (!scene) continue;
    const place = placeWorldOf(tx, scene);
    let changed = false;
    for (const thing of overlay.things) {
      const e = place.world.entities[thing.id];
      const states = thing.states ?? [];
      if (!e || JSON.stringify(e.states) === JSON.stringify(states)) continue;
      e.states = [...states];
      changed = true;
    }
    if (changed) savePlaceWorld(tx, scene, place, sceneGraph(tx, scene, getGm(tx, scene.id)));
  }
}

/**
 * Pennies lifted from a purse (liftNow puts them in session.carried, as the prototype's did), into the
 * player's pockets: through the world's inventory in the place their character is in (the last
 * scene's: the character stays there until the next opens), and the sheet's pockets from it. Before
 * the story's first scene the character is in no place: then they have nowhere to go.
 */
function pocket(tx: TxCtx, host: PlayerRow, carried: Entity[]): void {
  const me = host.characterId === undefined ? undefined : tx.db.entity.id.find(host.characterId);
  const scene = me ? [...tx.db.scene.gameId.filter(host.gameId)].find(s => s.placeId === me.placeId) : undefined;
  if (!scene) return tx.log(`[map] player ${host.id}'s pennies have nowhere to go: no place yet`);
  const place = placeWorldOf(tx, scene);
  for (const coin of carried) inventory(place.world, scene.turns).add("player", { name: coin.name, quantity: coin.quantity ?? 1, description: coin.description ?? "a few pennies, lifted" });
  savePlaceWorld(tx, scene, place, sceneGraph(tx, scene, getGm(tx, scene.id)));
  refreshPockets(tx, host.id, place.world);
}

export type { RulesSession };
