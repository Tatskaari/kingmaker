// New (docs/combat-gm.md; docs/combat-design.md §5, "Handing back to the story"): a fight that broke
// out in a scene, set out on the board as the zoo's combat ring sets one out, and its end handed back
// to the scene. The board is the map that lays the scene's place (the region the player is in), each
// fighter where the place's world has them, the lit things the world has lit, its dusty floors and
// what burns; the scene's people are the same engine characters they are in the scene (the rules
// made them when they were first needed), and the player is their own, their hit points and slots
// kept (FightSetup.keep). How it went goes back into the place's world: who's down, hurt, held or
// gone, where everyone ended up, the lights it knocked over.

import { key, neighbours, solid } from "../../../shared/fight/grid.ts";
import type { FightBoard, FightResult, FightSetup, Role, Unit } from "../../../shared/fight/types.ts";
import { onSide, type FightSide, type SceneFight } from "../../../shared/gm/fight.ts";
import { feetToTile, tileToFeet } from "../../../shared/map/reconcile.ts";
import { mapOf, type MapFile, type PlaceRegion } from "../../../shared/map/tiles.ts";
import type { CombatantSetup, MapActor, Tile2, TileMap } from "../../../shared/map/types.ts";
import { bystander } from "../../../shared/rules/acts.ts";
import { fighterOf } from "../../../shared/scene/graph.ts";
import { beingCalled, unnamed } from "../../../shared/scene/names.ts";
import type { Character, Scene } from "../../../shared/scene/types.ts";
import { positionOf, type Entity, type Point, type SceneWorld } from "../../../shared/world/scene-world.ts";
import { idText } from "../../../shared/protocol/keys.ts";
import type { TxCtx } from "../context.ts";
import { mapFilesOf } from "../map/rows.ts";
import { gameRow, playerRow, type SceneRow } from "../rows.ts";
import { entriesOf } from "../transcript.ts";
import { placeWorldOf } from "../world/place.ts";

/** The board a scene's fight is on: the map that lays its place, the region of it the player is in, and its tiles. */
export interface SceneBoard { file: MapFile; region: PlaceRegion; tiles: TileMap }

/**
 * The map a scene's fight is fought on: of the regions that lay the scene's place (a sceneId and a
 * worldOrigin), the one the player stands in (the hanged clerk has the yard and the tally loft), else
 * the first. None when no map lays it.
 */
export function sceneBoard(tx: TxCtx, scene: SceneRow, world: SceneWorld): SceneBoard | undefined {
  const files = mapFilesOf(tx, gameRow(tx, scene.gameId));
  const me = Object.values(world.entities).find(e => e.player);
  const at = me ? positionOf(world, me.id) : undefined;
  const laid = files.flatMap(file => file.regions.filter(r => r.sceneId === scene.sceneKey && r.worldOrigin).map(region => ({ file, region })));
  const here = at ? laid.find(l => inRect(l.region.rect, feetToTile(l.region, at))) : undefined;
  const pick = here ?? laid[0];
  return pick ? { ...pick, tiles: mapOf(pick.file).map } : undefined;
}

const inRect = (r: PlaceRegion["rect"], t: Tile2) => t.x >= r.x && t.y >= r.y && t.x < r.x + r.w && t.y < r.y + r.h;

/** How the board's fight plays each side: with the player, against them, running (for the door, and off out of the scene), keeping clear (standing by, out of it). */
const SIDE: Record<FightSide, CombatantSetup["side"]> = { with: "ally", against: "enemy", flee: "neutral", clear: "neutral" };

/**
 * A scene's fight set out (docs/combat-gm.md): its board, the player where the world has them, and
 * everyone with a side, each where the world has them (one with no place of their own beside whoever
 * they came with), on a tile of their own, as the player knows them (by what they call them until
 * they've heard the name), with their card's statblock and weapon (a being with none, a commoner, or
 * a dog a mastiff), and as the rules' own character when the rules have made them already. Those
 * gone from the place, and those down, dead or out cold with no character in the rules, aren't in it.
 * Its title is the event's whose fight it is, else where it is.
 */
export function sceneFightSetup(tx: TxCtx, scene: SceneRow, graph: Scene, fight: SceneFight): FightSetup {
  const controller = playerRow(tx, scene.controllerId);
  const { world } = placeWorldOf(tx, scene);
  const board = sceneBoard(tx, scene, world);
  if (!board) throw new Error(`fight: no map lays ${scene.sceneKey}'s place (a region with its sceneId and a worldOrigin)`);
  const heard = { transcript: entriesOf(tx, scene.id) };
  const npcs = npcsOf(tx, scene.controllerId);
  const taken = new Set<string>();
  const tileFor = (p: Point | undefined, near?: Tile2) => freeTile(board.tiles, p ? feetToTile(board.region, p) : near ?? board.region.rect, taken);

  const me = Object.values(world.entities).find(e => e.player);
  const start = tileFor(me ? positionOf(world, me.id) : undefined);
  const combatants: CombatantSetup[] = [{ id: "player", name: controller.name, side: "player", role: "player", at: start }];
  const against = new Set(onSide(fight, "against"));
  // Who comes later (a reinforcement not in the place yet, a card's members with them: smoke4-1018 had Old Wat, the yard's card and a reinforcement, beside the player from round 1) is set out with the reinforcements below.
  const later = new Set((graph.reinforcements ?? []).filter(r => !world.entities[r.id])
    .flatMap(r => [r.id, ...(graph.cast.find(c => c.id === r.id)?.members ?? []).map(m => m.id)]));
  for (const [id, side] of Object.entries(fight.sides)) {
    const e = world.entities[id];
    const who = castOf(graph, id, world);
    if (!who || later.has(id) || e?.states.includes("gone") || (!npcs[id] && e?.states.some(s => OUT_COLD.has(s)))) continue;
    const leader = graph.cast.find(c => c.members?.some(m => m.id === id));
    const at = positionOf(world, id) ?? (leader ? positionOf(world, leader.id) : undefined);
    combatants.push({
      id, castId: id, name: nameOf(graph, world, heard, id, who), side: SIDE[side], role: roleOf(graph, who, side, against),
      ...(who.statblock ? { statblock: who.statblock } : {}), ...(who.weapon ? { weapon: who.weapon } : {}),
      ...(npcs[id] ? { engine: { ...npcs[id] } } : {}), ...(side === "flee" && fight.stays?.includes(id) ? { stays: true } : {}),
      at: tileFor(at, start),
    });
  }
  // Who'll come in when it's been going a while (the scene's reinforcements, on a side), in at the way in at the top of their round.
  const ways = waysOut(board);
  for (const r of graph.reinforcements ?? []) {
    const side = fight.sides[r.id];
    if ((side !== "with" && side !== "against") || combatants.some(c => c.id === r.id) || world.entities[r.id]) continue;
    const card = graph.cast.find(c => c.id === r.id);
    const due = r.after + 1;
    const way = ways[0]?.at ?? start;
    const why = r.why.trim();
    const who: Array<{ id: string; name: string; statblock?: string; weapon?: string }> = card
      ? [{ id: card.id, name: nameOf(graph, world, heard, card.id, card), ...(card.statblock ? { statblock: card.statblock } : {}), ...(card.weapon ? { weapon: card.weapon } : {}) },
        ...(card.members ?? []).map(m => ({ id: m.id, name: m.name, ...(m.statblock ? { statblock: m.statblock } : {}), ...(m.weapon ? { weapon: m.weapon } : {}) }))]
      : [{ id: r.id, name: r.name ?? r.id, ...(r.statblock ? { statblock: r.statblock } : {}), ...(r.weapon ? { weapon: r.weapon } : {}) }];
    for (const w of who) {
      combatants.push({
        id: w.id, castId: w.id, name: w.name, side: SIDE[side], role: side === "with" ? "ally" : !w.statblock || w.statblock === "commoner" ? "brawler" : "bruiser",
        ...(w.statblock ? { statblock: w.statblock } : {}), ...(w.weapon ? { weapon: w.weapon } : {}), ...(npcs[w.id] ? { engine: { ...npcs[w.id]! } } : {}),
        at: { ...way }, due, ...(why ? { why } : {}),
      });
    }
  }
  const beat = fight.beat ? graph.beats.find(b => b.id === fight.beat) : undefined;
  const dust = dustOf(world, board.region);
  return {
    title: beat?.title ?? `A fight in ${board.region.name}`,
    place: board.region.name,
    map: { key: board.file.id },
    combatants,
    ...nonEmpty("props", litThings(world, board.region, board.file.id)),
    ...nonEmpty("dust", dust),
    ...nonEmpty("fuel", [...fuelOf(world, board.region), ...dust]),
    exits: ways,
    keep: true,
    scene: idText(scene.id),
    ...(graph.time ? { time: graph.time } : {}),
  };
}

const nonEmpty = <K extends string, T>(k: K, xs: T[]): Partial<Record<K, T[]>> => (xs.length ? { [k]: xs } as Record<K, T[]> : {});

/** The world's states of someone out of a fight before it starts, by the world's word. */
const OUT_COLD: ReadonlySet<string> = new Set(["down", "dead", "unconscious"]);

/** The rules' characters the scene has made so far (rules_state.npcs), by the cast's ids. */
function npcsOf(tx: TxCtx, playerId: bigint): Record<string, { id: string; weapon: string }> {
  const json = tx.db.rulesState.playerId.find(playerId)?.npcs;
  return json ? JSON.parse(json) as Record<string, { id: string; weapon: string }> : {};
}

/** Someone in the fight as the rules know them: their card, a group's member, or a being in the place's world with no card (a dog), by its stats. */
export function castOf(graph: Scene, id: string, world: SceneWorld): Character | undefined {
  const known = fighterOf(graph, id);
  if (known) return known;
  const e = world.entities[id];
  return e && (e.kind === "person" || e.kind === "creature") && !e.player ? bystander(e) : undefined;
}

/** What the player calls someone: by their name once they've heard it, else what they'd call them (a card's `called`, a being by what it is: the mastiff). */
function nameOf(graph: Scene, world: SceneWorld, heard: { transcript: ReturnType<typeof entriesOf> }, id: string, who: Character): string {
  const card = unnamed(graph, heard)[id];
  if (card) return card;
  if (fighterOf(graph, id)) return who.name;
  const e = world.entities[id];
  return e ? beingCalled(e, heard) : who.name;
}

/**
 * How the board's AI plays someone: beside the player, an ally; running from it, a coward (for the
 * door); keeping clear, a bystander; against the player, the leader of a group whose people fight with
 * them is the villain (when he yields they yield with him), a bow or a crossbow keeps its distance,
 * a commoner brawls (and gives up hurt), anyone else is a bruiser.
 */
function roleOf(graph: Scene, who: Character, side: FightSide, against: ReadonlySet<string>): Role {
  if (side === "with") return "ally";
  if (side === "flee") return "coward";
  if (side === "clear") return "bystander";
  const card = graph.cast.find(c => c.id === who.id);
  if (card?.members?.some(m => against.has(m.id))) return "villain";
  if (/bow|sling/i.test(who.weapon ?? "")) return "archer";
  return !who.statblock || who.statblock === "commoner" ? "brawler" : "bruiser";
}

/** The nearest tile to `want` that someone can stand on and nobody else has: a step round, then further. */
function freeTile(map: TileMap, want: Tile2 | PlaceRegion["rect"], taken: Set<string>): Tile2 {
  const first = "w" in want ? { x: want.x + Math.floor(want.w / 2), y: want.y + Math.floor(want.h / 2) } : want;
  const queue: Tile2[] = [{ x: Math.max(0, Math.min(map.width - 1, first.x)), y: Math.max(0, Math.min(map.height - 1, first.y)) }];
  const seen = new Set<string>([key(queue[0]!)]);
  for (let i = 0; i < queue.length && i < map.width * map.height; i++) {
    const t = queue[i]!;
    if (!solid(map, t) && !taken.has(key(t)) && map.tiles[t.y]?.[t.x]?.terrain !== "water") { taken.add(key(t)); return t; }
    for (const n of neighbours(map, t)) if (!seen.has(key(n))) { seen.add(key(n)); queue.push(n); }
  }
  return queue[0]!;
}

/**
 * The ways out of the fight: the map's own exits when the place is the whole map (the Heron, the
 * Rat, the palace); a region of a bigger map (the granary yard on the town's) is left by its
 * doorways, the open tiles just outside it (the yard gate), or by the map's exits when it has none.
 */
function waysOut(board: SceneBoard): Array<{ at: Tile2; label: string }> {
  const { tiles: map, file, region } = board;
  const own = file.exits.filter(e => !solid(map, e.at)).map(e => ({ at: { ...e.at }, label: e.label }));
  const r = region.rect;
  if (r.w * r.h >= 0.8 * map.width * map.height) return own;
  const out = new Map<string, Tile2>();
  for (let x = r.x; x < r.x + r.w; x++) {
    for (let y = r.y; y < r.y + r.h; y++) {
      if (x !== r.x && y !== r.y && x !== r.x + r.w - 1 && y !== r.y + r.h - 1) continue;
      for (const n of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
        if (inRect(r, n) || n.x < 0 || n.y < 0 || n.x >= map.width || n.y >= map.height) continue;
        if (!solid(map, n) && map.tiles[n.y]?.[n.x]?.terrain !== "water") out.set(key(n), n);
      }
    }
  }
  return out.size ? [...out.values()].map(at => ({ at, label: `the way out of ${region.name}` })) : own;
}

/** The place's lit things that burn or give light (a brazier, a lantern) as the fight's props, where the world has them: one carried goes where its carrier does. */
function litThings(world: SceneWorld, region: PlaceRegion, mapId: string): MapActor[] {
  return Object.values(world.entities)
    .filter(e => (e.kind === "object" || e.kind === "feature" || e.kind === "item") && e.states.includes("lit") && e.tags.some(t => t === "fire" || t === "light") && !!positionOf(world, e.id))
    .map(e => {
      const brazier = /brazier|fire/i.test(`${e.id} ${e.name}`);
      const holder = e.parent ? world.entities[e.parent] : undefined;
      const carried = holder && (holder.kind === "person" || holder.kind === "creature") ? holder : undefined;
      return {
        id: e.id, name: e.name.replace(/^(a|an|the) /i, ""), kind: "object" as const, glyph: brazier ? "&" : "o", color: brazier ? "#ff7f2a" : "#ffd966",
        map: mapId, at: feetToTile(region, positionOf(world, e.id)!), states: ["lit"], ...(carried ? { ref: carried.player ? "player" : carried.id } : {}),
      };
    });
}

/** The tiles of the place's dusty floors (the Heron's: grain dust hanging in the lantern light), and of dusty things. */
function dustOf(world: SceneWorld, region: PlaceRegion): Tile2[] {
  const tiles = new Map<string, Tile2>();
  for (const e of Object.values(world.entities).filter(e => e.states.includes("dusty"))) {
    if (e.rect) for (let x = e.rect.x; x < e.rect.x + e.rect.w; x += 5) for (let y = e.rect.y; y < e.rect.y + e.rect.h; y += 5) { const t = feetToTile(region, { x, y }); tiles.set(key(t), t); }
    else { const p = positionOf(world, e.id); if (p) { const t = feetToTile(region, p); tiles.set(key(t), t); } }
  }
  return [...tiles.values()];
}

/** Where what burns stands: what's flammable, and sacks, straw and hay. */
function fuelOf(world: SceneWorld, region: PlaceRegion): Tile2[] {
  return Object.values(world.entities)
    .filter(e => (e.kind === "object" || e.kind === "feature") && !e.states.includes("gone") && (e.tags.includes("flammable") || /\b(sacks?|sacking|straw|hay|bales?|tar)\b/i.test(e.name)))
    .flatMap(e => { const p = positionOf(world, e.id); return p ? [feetToTile(region, p)] : []; });
}

// ---------------------------------------------------------------------------------------------
// After the fight: how it went, in the scene's world.

/**
 * How the fight went, in the place's world: each fighter's state as the board left them (hurt or
 * badly hurt, down, dead, given up, in irons; anyone who ran off the board out of the place, but one
 * the story needs, who cowers where they left it, and is here after it), each where they ended up,
 * and the lights the fight broke or knocked over out (and off the floor). Who left the place, for
 * the scene's absent list.
 */
export function fightIntoWorld(world: SceneWorld, region: PlaceRegion, board: FightBoard, keep: ReadonlySet<string>): { gone: string[] } {
  const gone: string[] = [];
  for (const u of Object.values(board.units)) {
    const e = u.id === board.pc ? Object.values(world.entities).find(x => x.player) : world.entities[u.castId ?? u.id];
    if (!e) continue;
    e.at = tileToFeet(region, u.at);
    if (u.id === board.pc) continue;
    const ran = u.state === "fled" && !keep.has(e.id);
    const hid = (u.stays && u.state === "fighting") || (u.state === "fled" && !ran);
    e.states = [...e.states.filter(s => !FIGHT_STATES.has(s)), ...statesAfter(u, ran), ...(hid ? ["cowering"] : [])];
    if (ran) gone.push(e.id);
  }
  for (const p of Object.values(board.props)) {
    const e = world.entities[p.id];
    if (!e || p.state === "standing") continue;
    e.states = [...e.states.filter(s => s !== "lit" && s !== "hanging"), p.state];
  }
  return { gone };
}

/** What a fight's end says of someone in the world's words. */
const FIGHT_STATES: ReadonlySet<string> = new Set(["hurt", "badly hurt", "down", "unhurt", "dead", "surrendered", "in irons", "gone", "cowering", "asleep", "prone"]);

function statesAfter(u: Unit, ran: boolean): string[] {
  if (ran) return ["gone"];
  if (u.state === "dead") return ["dead"];
  const hurt = u.hp <= 0 || u.state === "down" ? "down" : u.hp >= u.maxHp ? undefined : u.hp * 2 <= u.maxHp ? "badly hurt" : "hurt";
  return [
    ...(hurt ? [hurt] : []),
    ...(u.state === "surrendered" ? ["surrendered"] : []),
    ...(u.arrested ? ["in irons"] : []),
    ...(u.state === "fighting" && u.conditions.includes("unconscious") ? ["asleep"] : []),
  ];
}

/** A fight's result, read from its row. */
export const resultOf = (json: string | undefined): FightResult | undefined => (json ? JSON.parse(json) as FightResult : undefined);
