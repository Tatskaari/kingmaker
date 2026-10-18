// New (M6): the zoo's exhibits as data (campaigns/zoo/README.md): each a small setup on the campaign format's files (a scene's cast on its place, laid on a map) and a starting situation, the combat ring's a fight with line-ups of foes to pick from; what an exhibit names, held to the files it names; and a fight's line-up read off them, where everyone starts.
import type { Role } from "../fight/types.ts";
import { feetToTile } from "../map/reconcile.ts";
import { mapOf, type MapFile, type PlaceRegion } from "../map/tiles.ts";
import type { MapActor, Tile2, TileMap } from "../map/types.ts";
import type { CastMember, SceneDocument } from "../scene/document.ts";
import type { CampaignFile, PlaceFile } from "../scene/files.ts";
import { standable } from "../scene/scenario-rules.ts";

/**
 * The zoo (the user: "zoos that help demonstrate every feature in the game e.g. all the world effects,
 * and interactions, scenes, combat etc."): a campaign of its own (campaigns/zoo), whose scenario lists
 * its exhibits. An exhibit is a small setup on the campaign's own files: a scene (its cast: who's
 * there, with their statblocks and their notes on how they fight) on its place (where everyone
 * starts), laid on a map by the region that plays it; and its starting situation. The combat ring's
 * is a fight: who fights beside the player (its allies), and the line-ups of foes the player picks
 * from, each fighter by their cast id with how the fight's AI plays them. The simulation sets an
 * exhibit out (simulation/src/zoo), the campaign check holds it to the files it names, and the
 * client offers the exhibits and their line-ups.
 */

/** The zoo's campaign key. */
export const ZOO = "zoo";

/** How the fight's AI plays someone an exhibit names (the fight's roles, but the player's own). */
export type ExhibitRole = Exclude<Role, "player">;
export const EXHIBIT_ROLES: readonly ExhibitRole[] = ["ally", "bruiser", "villain", "coward", "brawler", "archer", "bystander"];

/** A line-up of foes to pick: its id and title, a line about it, and who's in it by cast id, with how each fights. */
export interface LineUp {
  id: string;
  title: string;
  description?: string;
  fighters: Record<string, ExhibitRole>;
}

/** A fight exhibit's: who fights beside the player (by cast id, with how), and the line-ups of foes, the first the one it starts with. */
export interface ExhibitFight {
  allies?: Record<string, ExhibitRole>;
  foes: LineUp[];
}

/** One of the zoo's exhibits, as the scenario lists it. */
export interface Exhibit {
  id: string;
  title: string;
  description: string;
  /** The scene whose cast and place it's set out from (the map is the one with a region laying the scene's place). */
  scene: string;
  /** A fight: started as the exhibit opens. */
  fight?: ExhibitFight;
}

/** A campaign's exhibits (the scenario's `exhibits`): none for a campaign that isn't a zoo. */
export const exhibitsOf = (campaign: Pick<CampaignFile, "exhibits">): Exhibit[] => campaign.exhibits ?? [];

/** An exhibit of a campaign by its id. */
export const exhibitIn = (campaign: Pick<CampaignFile, "exhibits">, id: string): Exhibit | undefined => exhibitsOf(campaign).find(e => e.id === id);

/** A fight exhibit's line-up by its id; with none named, the first (the one it starts with). */
export function lineUpOf(exhibit: Exhibit, id?: string): LineUp | undefined {
  const foes = exhibit.fight?.foes ?? [];
  return id === undefined || id === "" ? foes[0] : foes.find(f => f.id === id);
}

// ---------------------------------------------------------------------------------------------
// A fight exhibit set out: who's in it and where, from its files.

/** A fighter an exhibit names, as their files have them: their cast card, how they fight, which side, and where they start. */
export interface ExhibitFighter {
  id: string;
  card: CastMember;
  role: ExhibitRole;
  side: "ally" | "enemy";
  at: Tile2;
}

/** A fight exhibit set out with one of its line-ups: the map it's on and the place laid there, where the player starts, everyone else, and the lit things a fight can knock over. */
export interface ExhibitLayout {
  map: MapFile;
  place: PlaceFile;
  player: Tile2;
  fighters: ExhibitFighter[];
  props: MapActor[];
}

/** The files an exhibit is set out from: the campaign's scenes, places and maps, as the game keeps them. */
export interface ExhibitFiles {
  scenes: SceneDocument[];
  places: PlaceFile[];
  maps: MapFile[];
}

/**
 * A fight exhibit, set out with a line-up: its scene's place, laid on the map whose region plays the
 * scene (its worldOrigin, five feet a tile), the player where the place starts them, the allies and
 * the line-up's foes each from their cast card where the place starts them, and the place's lit
 * things that burn or give light (a brazier, a lantern) as what a fight can knock over. Throws, in
 * words, when a file it needs isn't there (the campaign check says so first: exhibitProblems).
 */
export function exhibitLayout(exhibit: Exhibit, lineUp: LineUp, files: ExhibitFiles): ExhibitLayout {
  const scene = files.scenes.find(s => s.id === exhibit.scene);
  if (!scene) throw new Error(`the exhibit ${exhibit.id}'s scene ${exhibit.scene} isn't the campaign's`);
  const place = files.places.find(p => p.key === scene.place);
  if (!place) throw new Error(`the exhibit ${exhibit.id}'s scene has no place the campaign has (${scene.place ?? "none"})`);
  const laid = layingRegion(files.maps, scene.id);
  if (!laid) throw new Error(`no map lays the exhibit ${exhibit.id}'s scene ${scene.id} (a region with its sceneId and a worldOrigin)`);

  const at = (id: string): Tile2 => {
    const spot = place.people[id]?.at;
    if (!spot) throw new Error(`the exhibit ${exhibit.id}'s place ${place.key} doesn't start ${id} anywhere`);
    return feetToTile(laid.region, { x: spot[0], y: spot[1] });
  };
  const fighter = (id: string, role: ExhibitRole, side: ExhibitFighter["side"]): ExhibitFighter => {
    const card = scene.cast.find(c => c.id === id);
    if (!card) throw new Error(`the exhibit ${exhibit.id}'s ${id} isn't in its scene's cast`);
    return { id, card, role, side, at: at(id) };
  };
  return {
    map: laid.map,
    place,
    player: at("player"),
    fighters: [
      ...Object.entries(exhibit.fight?.allies ?? {}).map(([id, role]) => fighter(id, role, "ally")),
      ...Object.entries(lineUp.fighters).map(([id, role]) => fighter(id, role, "enemy")),
    ],
    props: litThings(place, laid.region, laid.map.id),
  };
}

/** Where a scene exhibit starts the player (docs/combat-gm.md): the map that lays its scene's place, and the tile its place starts them on. */
export function exhibitStart(exhibit: Exhibit, files: ExhibitFiles): { map: MapFile; player: Tile2 } {
  const scene = files.scenes.find(s => s.id === exhibit.scene);
  const place = scene && files.places.find(p => p.key === scene.place);
  const laid = scene && layingRegion(files.maps, scene.id);
  const spot = place?.people.player?.at;
  if (!laid || !spot) throw new Error(`the exhibit ${exhibit.id}'s scene has no place laid on a map that starts the player`);
  return { map: laid.map, player: feetToTile(laid.region, { x: spot[0], y: spot[1] }) };
}

/** The map and region that lay a scene's place: a region with its sceneId and a worldOrigin. */
export function layingRegion(maps: MapFile[], sceneId: string): { map: MapFile; region: PlaceRegion } | undefined {
  for (const map of maps) {
    const region = map.regions.find(r => r.sceneId === sceneId && r.worldOrigin);
    if (region) return { map, region };
  }
  return undefined;
}

/** The place's things that are lit and burn or give light (tagged fire or light, with a spot), as a fight's props: a brazier, a lantern. */
function litThings(place: PlaceFile, region: PlaceRegion, mapId: string): MapActor[] {
  return place.things
    .filter(t => t.at && (t.states ?? []).includes("lit") && (t.tags ?? []).some(tag => tag === "fire" || tag === "light"))
    .map(t => {
      const brazier = /brazier/i.test(`${t.id} ${t.name}`);
      return {
        id: t.id, name: t.name.replace(/^(a|an|the) /i, ""), kind: "object" as const, glyph: brazier ? "&" : "o", color: brazier ? "#ff7f2a" : "#ffd966",
        map: mapId, at: feetToTile(region, { x: t.at![0], y: t.at![1] }), states: ["lit"],
      };
    });
}

// ---------------------------------------------------------------------------------------------
// The rules an exhibit is held to.

/** What's wrong with the scenario's exhibits' shape, each problem naming where: [] when they're fit to read. */
export function exhibitShapeProblems(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ["its exhibits aren't a list"];
  const p: string[] = [];
  value.forEach((e, i) => {
    const at = `exhibits[${i}]${isObject(e) && typeof e.id === "string" ? ` (${e.id})` : ""}`;
    if (!isObject(e)) return p.push(`${at} isn't an object`);
    for (const k of ["id", "title", "description", "scene"]) if (typeof e[k] !== "string") p.push(`${at} has no ${k}`);
    if (e.fight === undefined) return;
    const fight = e.fight;
    if (!isObject(fight)) return p.push(`${at}'s fight isn't { allies?, foes }`);
    if (fight.allies !== undefined && !isRoles(fight.allies)) p.push(`${at}'s allies aren't { cast id: how they fight }`);
    if (!Array.isArray(fight.foes)) return p.push(`${at}'s foes aren't a list of line-ups`);
    fight.foes.forEach((f, j) => {
      const where = `${at}'s foes[${j}]${isObject(f) && typeof f.id === "string" ? ` (${f.id})` : ""}`;
      if (!isObject(f)) return p.push(`${where} isn't an object`);
      for (const k of ["id", "title"]) if (typeof f[k] !== "string") p.push(`${where} has no ${k}`);
      if (f.description !== undefined && typeof f.description !== "string") p.push(`${where}'s description isn't text`);
      if (!isRoles(f.fighters)) p.push(`${where}'s fighters aren't { cast id: how they fight }`);
    });
  });
  return p;
}

/** A problem with an exhibit: what's wrong, and which exhibit (and line-up) it's in. */
export interface ExhibitProblem { message: string; exhibit?: string; lineUp?: string }

/**
 * The exhibits held to the files they name: their ids slugs, each once; their prose; their scene one of
 * the campaign's; and a fight's scene with a place laid on a map, every fighter (an ally, or a foe of
 * a line-up) someone in the scene's cast with a statblock, started by the place, and playing a role the
 * fight's AI knows; at least one line-up, each with fighters, none an ally too; and everyone in a
 * line-up's fight (the player, the allies, its foes) on a tile of their own that a person can stand on.
 */
export function exhibitProblems(campaign: Pick<CampaignFile, "exhibits" | "scenes">, files: ExhibitFiles): ExhibitProblem[] {
  const problems: ExhibitProblem[] = [];
  const exhibits = exhibitsOf(campaign);
  const seen = new Set<string>();
  for (const e of exhibits) {
    const p = (message: string, lineUp?: string) => problems.push({ message, exhibit: e.id, ...(lineUp ? { lineUp } : {}) });
    if (!SLUG.test(e.id)) p(`the exhibit id ${JSON.stringify(e.id)} isn't a slug ([a-z0-9][a-z0-9-]*)`);
    if (seen.has(e.id)) p(`the exhibit ${e.id} is there twice`);
    seen.add(e.id);
    for (const k of ["title", "description"] as const) if (!e[k].trim()) p(`${e.id} has no ${k}`);
    if (!campaign.scenes.includes(e.scene)) { p(`${e.id}'s scene ${e.scene} isn't one of the scenario's scenes`); continue; }
    if (e.fight) fightProblems(e, e.fight, files, p);
  }
  return problems;
}

/** A fight exhibit's own rules (exhibitProblems). */
function fightProblems(e: Exhibit, fight: ExhibitFight, files: ExhibitFiles, p: (message: string, lineUp?: string) => void): void {
  const scene = files.scenes.find(s => s.id === e.scene);
  const place = scene?.place === undefined ? undefined : files.places.find(pl => pl.key === scene.place);
  if (!scene || !place) return p(`${e.id}'s scene ${e.scene} has no place to fight in`);
  const laid = layingRegion(files.maps, scene.id);
  if (!laid) return p(`no map lays ${e.id}'s scene ${scene.id} (a region with its sceneId and a worldOrigin)`);
  if (!place.people["player"]?.at) p(`${e.id}'s place ${place.key} doesn't say where the player starts`);

  const fighter = (id: string, role: string, lineUp?: string) => {
    const card = scene.cast.find(c => c.id === id);
    if (!card) p(`${id} isn't in ${scene.id}'s cast`, lineUp);
    else if (!card.statblock) p(`${id} has no statblock to fight with`, lineUp);
    if (!place.people[id]?.at) p(`${place.key} doesn't start ${id} anywhere`, lineUp);
    if (!(EXHIBIT_ROLES as readonly string[]).includes(role)) p(`${id} fights as ${JSON.stringify(role)}, which isn't one of ${EXHIBIT_ROLES.join(", ")}`, lineUp);
  };
  const allies = fight.allies ?? {};
  for (const [id, role] of Object.entries(allies)) fighter(id, role);
  if (!fight.foes.length) p(`${e.id} has no line-up of foes to fight`);
  const lineUps = new Set<string>();
  for (const f of fight.foes) {
    if (!SLUG.test(f.id)) p(`the line-up id ${JSON.stringify(f.id)} isn't a slug`, f.id);
    if (lineUps.has(f.id)) p(`the line-up ${f.id} is there twice`, f.id);
    lineUps.add(f.id);
    if (!f.title.trim()) p(`line-up ${f.id} has no title`, f.id);
    if (!Object.keys(f.fighters).length) p(`line-up ${f.id} has nobody in it`, f.id);
    for (const [id, role] of Object.entries(f.fighters)) {
      fighter(id, role, f.id);
      if (id in allies) p(`${id} is an ally and one of line-up ${f.id}'s foes`, f.id);
    }
    standingProblems(e, f, files, laid.map, p);
  }
}

/** Everyone in a line-up's fight on a tile of their own a person can stand on (when the files set them all out). */
function standingProblems(e: Exhibit, lineUp: LineUp, files: ExhibitFiles, file: MapFile, p: (message: string, lineUp?: string) => void): void {
  let layout: ExhibitLayout;
  let map: TileMap;
  try {
    layout = exhibitLayout(e, lineUp, files);
    map = mapOf(file).map;
  } catch {
    return;
  }
  const spots = [{ id: "the player", at: layout.player }, ...layout.fighters.map(f => ({ id: f.id, at: f.at }))];
  const taken = new Map<string, string>();
  for (const s of spots) {
    const key = `${s.at.x},${s.at.y}`;
    if (!standable(map, s.at)) p(`${s.id} starts at (${s.at.x}, ${s.at.y}) on ${file.id}, where nobody can stand`, lineUp.id);
    const other = taken.get(key);
    if (other) p(`${s.id} and ${other} both start at (${s.at.x}, ${s.at.y})`, lineUp.id);
    else taken.set(key, s.id);
  }
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function isRoles(v: unknown): boolean {
  return isObject(v) && Object.values(v).every(r => typeof r === "string");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
