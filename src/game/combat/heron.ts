import { sceneById } from "../../../scenes/index.ts";
import type { SessionState } from "../../runtime/session.ts";
import type { CombatantSetup, CombatSetup, MapActor, TileMap, Tile2 } from "../types.ts";
import { explore, key, same, solid, steps } from "./grid.ts";
import { HERON_LAYOUT, HERON_MAP_ID } from "./heron-grid.ts";

/**
 * The Heron's fight, as a CombatSetup: who's in it (the scene's present cast with statblocks:
 * Sallow's group expanded into Sallow, the Crakes and the lantern-boy; Kell on the player's side),
 * where they stand, and the hazards (the grain dust, what burns, the lanterns and the brazier).
 *
 * Master Sallow gets a statblock of his own: the scene's card calls him a bandit captain with a
 * rapier; on the map he's a duellist (two thrusts a turn, a parry, and the nerve of a man who signs
 * other people's death warrants), so a level 3 investigator with a sergeant at their elbow can beat
 * him, but not by standing still. He surrenders when badly hurt, or runs for the land door.
 */

const MASTER_HERE = "Master Sallow has come to the Heron.";

export interface HeronOptions {
  /** Is Master Sallow here (the midnight beat)? Read from the session when omitted. */
  sallow?: boolean;
  /** Where Kell is: at the player's elbow (default), out on the wharf (she comes in at the land door), or not here. */
  kell?: "inside" | "wharf" | "absent";
  /** Things already on the map (the map module's lanterns and brazier): used instead of the Heron grid's. */
  actors?: MapActor[];
  /** Seed for the dice (from the session when omitted). */
  seed?: number;
  /**
   * Where people stand when it starts, by cast id and "player" (the scene's world laid out on the
   * map: see the map module's battlefield()). Whoever it leaves out stands by their leader, or where
   * the layout puts them.
   */
  at?: Record<string, Tile2>;
  /** Tiles thick with grain dust, and tiles that burn (the scene's world, on another map than the Heron grid). */
  dust?: Tile2[];
  fuel?: Tile2[];
}

export function heronEncounter(map: TileMap, session: SessionState, options: HeronOptions = {}): CombatSetup {
  const scene = sceneById("heron-warehouse");
  const card = (id: string) => scene.cast.find(c => c.id === id);
  const startOp = session.ended?.operations.find(o => o.op === "startCombat")?.args as { enemies?: Array<{ leader?: string; count?: number }> } | undefined;
  const sallowHere = options.sallow ?? (startOp?.enemies?.[0]?.leader ? startOp.enemies[0].leader === "sallow" : session.established.includes(MASTER_HERE) || session.beat === "midnight");
  const kellWhere = options.kell ?? (session.absent?.includes("kell") ? "absent" : "inside");
  const ours = map.id === HERON_MAP_ID;
  const place = placer(map, ours, options.at ?? {});
  const combatants: CombatantSetup[] = [];
  combatants.push({ id: "player", name: session.player.name, side: "player", at: place("player"), role: "player" });
  if (kellWhere !== "absent") {
    const kell = card("kell");
    combatants.push({ id: "kell", castId: "kell", name: kell?.name ?? "Sergeant Agnes Kell", side: "ally", role: "ally", statblock: kell?.statblock ?? "guard", weapon: kell?.weapon ?? "club", at: place(kellWhere === "wharf" ? "kellWharf" : "kell") });
  }
  if (sallowHere) {
    const sallow = card("sallow");
    combatants.push({ id: "sallow", castId: "sallow", name: sallow?.name ?? "Master Josiah Sallow", side: "enemy", role: "villain", statblock: "sword-cane-duellist", at: place("sallow") });
    const members = sallow?.members ?? [
      { id: "crake-1", name: "the talking Crake" }, { id: "crake-2", name: "the silent Crake" }, { id: "lantern-boy", name: "the lantern-boy" },
    ];
    for (const m of members) {
      const boy = /lantern|boy/i.test(m.id);
      combatants.push({ id: m.id, castId: m.id, name: m.name, side: "enemy", role: boy ? "coward" : "bruiser", statblock: boy ? "lantern-boy" : "river-bruiser", at: place(m.id) });
    }
  } else {
    const hep = card("hep");
    combatants.push({ id: "hep", castId: "hep", name: hep?.name ?? "Hepzibah Grist", side: "enemy", role: "brawler", statblock: hep?.statblock ?? "tough", weapon: hep?.weapon ?? "dagger", at: place("hep") });
    const count = Math.min(4, Math.max(2, (startOp?.enemies?.[0]?.count ?? 6) - 2));
    for (let i = 0; i < count; i++) combatants.push({ id: `porter-${i + 1}`, name: ["a floury porter", "a porter with a sack-needle", "a big porter", "a small, fierce porter"][i]!, side: "enemy", role: "brawler", statblock: "porter", at: place("porter") });
  }
  const props = (options.actors?.filter(a => a.kind === "object") ?? (ours ? HERON_LAYOUT.props(map) : guessProps(map)))
    .filter(p => sallowHere || p.ref !== "lantern-boy");
  return {
    map, combatants, sceneId: "heron-warehouse", seed: options.seed ?? (session.seed + 104729 * (session.rollCount + 1)) >>> 0, props,
    dust: options.dust ?? (ours ? HERON_LAYOUT.dust(map) : guessDust(map)),
    ...(options.fuel ? { fuel: options.fuel } : ours ? { fuel: HERON_LAYOUT.fuel(map) } : {}),
  };
}

/**
 * Where everyone starts: where the scene's world has them, if it says; otherwise the Heron grid's
 * own spots, or on another map the land-door end for Sallow's people and the far end for the player.
 */
function placer(map: TileMap, ours: boolean, at: Record<string, Tile2> = {}): (who: string) => Tile2 {
  const taken: Tile2[] = [];
  const free = (t: Tile2) => !solid(map, t) && !taken.some(o => same(o, t));
  const claim = (want: Tile2): Tile2 => {
    const seen = explore(map, want, { maxSteps: 6 });
    const spot = [want, ...[...seen.keys()].map(k => ({ x: Number(k.split(",")[0]), y: Number(k.split(",")[1]) }))].find(free) ?? want;
    taken.push(spot);
    return spot;
  };
  const s = HERON_LAYOUT.starts;
  if (Object.keys(at).length) {
    // Sallow's people stand with him, Hep's porters where her gang is; anyone else as the layout has them.
    const known = (who: string): Tile2 | undefined => at[who === "kellWharf" ? "kell" : who]
      ?? (["crake-1", "crake-2", "lantern-boy"].includes(who) ? at["sallow"] : who === "porter" ? at["gang"] ?? at["hep"] : undefined);
    const layout = placer(map, ours);
    return who => claim(known(who) ?? layout(who));
  }
  if (ours) {
    let porter = 0;
    return who => claim(who === "porter" ? s.porters[porter++ % s.porters.length]! : (s as unknown as Record<string, Tile2>)[who] ?? s.player);
  }
  // Somebody else's Heron: find its doors.
  const land = map.exits.find(e => /land|wharf/i.test(e.label))?.at ?? map.exits[0]?.at ?? { x: 1, y: Math.floor(map.height / 2) };
  const river = map.exits.find(e => /river|plank|barge/i.test(e.label))?.at ?? { x: map.width - 2, y: Math.floor(map.height / 2) };
  const lerp = (f: number): Tile2 => ({ x: Math.round(land.x + (river.x - land.x) * f), y: Math.round(land.y + (river.y - land.y) * f) });
  const spots: Record<string, Tile2> = {
    player: lerp(0.78), kell: lerp(0.76), kellWharf: lerp(0.05), sallow: lerp(0.4), "crake-1": lerp(0.52), "crake-2": lerp(0.52), "lantern-boy": lerp(0.36), hep: lerp(0.45), porter: lerp(0.5),
  };
  return who => claim(spots[who] ?? lerp(0.5));
}

/** On another map: the open floor away from the doors is the dusty part. */
function guessDust(map: TileMap): Tile2[] {
  const doors = map.exits.map(e => e.at);
  const out: Tile2[] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const t = { x, y };
    const tile = map.tiles[y]?.[x];
    if (!tile || solid(map, t) || !["floor", "boards"].includes(tile.terrain) || (tile.height ?? 0) > 0) continue;
    if (doors.some(d => steps(d, t) <= 6)) continue;
    out.push(t);
  }
  return out;
}

function guessProps(map: TileMap): MapActor[] {
  const dust = guessDust(map);
  if (!dust.length) return [];
  const pick = (f: number) => dust[Math.min(dust.length - 1, Math.floor(dust.length * f))]!;
  const unique = [pick(0.2), pick(0.5), pick(0.8)].filter((t, i, all) => all.findIndex(o => key(o) === key(t)) === i);
  return unique.map((at, i) => ({ id: `lantern-${i + 1}`, name: "hanging lantern", kind: "object" as const, glyph: "o", color: "#ffd966", map: map.id, at, states: ["lit"] }));
}
