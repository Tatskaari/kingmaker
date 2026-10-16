/**
 * Writes Walk Caerwyn's campaign data from the prototype (v2/docs/map-design.md §2): its four maps
 * as maps/<key>.json (the town's people by the hour on Caerwyn's), and campaign.json's `maps` and
 * where the story starts walking. Then checks the output against the prototype.
 *
 *   node --no-warnings tools/v2/map-files.mts --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2/campaigns/caerwyn
 *   node --no-warnings tools/v2/map-files.mts --proto … --out v2/campaigns/caerwyn --check     (checks only: writes nothing)
 *
 * - maps/<key>.json for caerwyn, drowned-rat, heron and palace (src/game/map/maps/<key>.ts): the
 *   MapSpec as data (shared/map/tiles.ts MapFile). Each module is read as it was written: run with a
 *   T() that returns its arguments and a buildMap() that returns its spec, so the legend is each
 *   character's T() arguments as authored, the grid its rows (as buildMap splits them) and the exits
 *   written out.
 * - caerwyn.json's `people`: who's about at each hour, presence.ts's town() at 44c6d4a, whose adds
 *   are run for each time of day and merged, in order, into one list with the hours each is about.
 *   (The palace page stays code: it's the King's summons, not one of the town's.)
 * - campaign.json: `maps` (after `places`), and `start.map` and `start.at`, where the prototype's
 *   newExploration puts a fresh story; every other field as it was.
 *
 * The check: each map file built with v2's mapOf deep-equals the prototype's built MapDef (the map
 * and its decor), and at each time of day of the arc v2's presence() puts the same town's people
 * (and decor) on Caerwyn as the prototype's. It reads and imports the prototype at 44c6d4a, which
 * never changes, and v2's shared code from this checkout; v2 never imports it. Run it, review the
 * diff, commit the output.
 */
import { isDeepStrictEqual } from "node:util";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`usage: map-files.mts --proto <the prototype at 44c6d4a> --out <v2>/campaigns/caerwyn [--check] (no ${name})`);
  return process.argv[i + 1]!;
};
const PROTO = resolve(arg("--proto"));
const OUT = resolve(arg("--out"));
const CHECK_ONLY = process.argv.includes("--check");
const V2 = resolve(import.meta.dirname, "..", "..", "v2");

/** The maps, by key, and the module and export each is in. */
const MAPS: Array<{ key: string; module: string; name: string }> = [
  { key: "caerwyn", module: "caerwyn.ts", name: "caerwyn" },
  { key: "drowned-rat", module: "drowned-rat.ts", name: "drownedRat" },
  { key: "heron", module: "heron.ts", name: "heron" },
  { key: "palace", module: "palace.ts", name: "palace" },
];

const TIMES = ["morning", "afternoon", "evening", "night", "next-morning"] as const;
type Time = (typeof TIMES)[number];

// The prototype's run output somewhere that isn't the repo, and no model: set before its modules load.
const scratch = mkdtempSync(join(tmpdir(), "km-map-files-"));
process.env.KM_RUNS_DIR = scratch;
process.env.OPENROUTER_API_KEY = "offline";
const proto = (path: string) => import(pathToFileURL(join(PROTO, path)).href);
const v2 = (path: string) => import(pathToFileURL(join(V2, path)).href);

try {
  const files: Record<string, Record<string, unknown>> = {};
  for (const m of MAPS) files[m.key] = await mapFile(m);
  files.caerwyn!.people = await townPeople();

  const campaignPath = join(OUT, "campaign.json");
  const campaign = withMaps(JSON.parse(readFileSync(campaignPath, "utf8")) as Record<string, unknown>, MAPS.map(m => m.key), await startOf());

  const problems = await check(files);
  if (problems.length) throw new Error(`the map files don't match the prototype:\n  ${problems.join("\n  ")}`);
  console.log(`maps: ${MAPS.map(m => m.key).join(", ")} each build as the prototype's; the town's people (${(files.caerwyn!.people as unknown[]).length}) are the prototype's at every time of day`);

  if (!CHECK_ONLY) {
    mkdirSync(join(OUT, "maps"), { recursive: true });
    for (const [key, file] of Object.entries(files)) writeFileSync(join(OUT, "maps", `${key}.json`), mapJson(file));
    writeFileSync(campaignPath, `${JSON.stringify(campaign, null, 2)}\n`);
    console.log(`wrote ${MAPS.map(m => `maps/${m.key}.json`).join(", ")} and campaign.json's maps and start`);
  } else {
    const same = MAPS.every(m => readOr(join(OUT, "maps", `${m.key}.json`)) === mapJson(files[m.key]!)) && readOr(campaignPath) === `${JSON.stringify(campaign, null, 2)}\n`;
    if (!same) throw new Error("the committed files aren't what the prototype gives: run without --check and review the diff");
    console.log("the committed files are what the prototype gives");
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------
// The maps.

/**
 * A map module run as written, but with T() giving back its arguments ({ terrain, ...extra, decor })
 * and buildMap() its spec: a copy of the module, its one import swapped for those two, in the scratch
 * folder.
 */
async function mapFile(m: { key: string; module: string; name: string }): Promise<Record<string, unknown>> {
  const source = readFileSync(join(PROTO, "src", "game", "map", "maps", m.module), "utf8");
  const IMPORT = 'import { buildMap, T, type MapDef } from "../tiles.ts";';
  if (!source.includes(IMPORT)) throw new Error(`${m.module}: its import isn't ${IMPORT}`);
  const captured = source.replace(IMPORT, [
    "type MapDef = unknown;",
    "const T = (terrain: string, extra: Record<string, unknown> = {}, decor?: Record<string, unknown>) => ({ terrain, ...extra, ...(decor ? { decor } : {}) });",
    "const buildMap = (spec: Record<string, unknown>) => spec;",
  ].join("\n"));
  const path = join(scratch, `${m.key}.mts`);
  writeFileSync(path, captured);
  const spec = (await import(pathToFileURL(path).href))[m.name] as { id: string; name: string; grid: string; legend: Record<string, unknown>; regions: unknown[]; exits?: unknown[] };
  if (spec.id !== m.key) throw new Error(`${m.module}: its map is ${spec.id}, not ${m.key}`);
  // The rows as buildMap reads them (src/game/map/tiles.ts): the first newline and any trailing blank line dropped.
  const grid = spec.grid.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  return { id: spec.id, name: spec.name, grid, legend: spec.legend, regions: spec.regions, exits: spec.exits ?? [] };
}

/** Where a fresh story starts walking: the prototype's newExploration. */
async function startOf(): Promise<{ map: string; at: [number, number] }> {
  const { newExploration } = await proto("src/game/map/explore.ts");
  const ex = newExploration({ time: "morning", played: [], flags: {} }) as { map: string; at: { x: number; y: number } };
  return { map: ex.map, at: [ex.at.x, ex.at.y] };
}

/** campaign.json with `maps` after `places`, and the start's map and tile; everything else as it was, in its order. */
function withMaps(campaign: Record<string, unknown>, maps: string[], start: { map: string; at: [number, number] }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campaign)) {
    if (k === "maps") continue;
    out[k] = k === "start" ? { ...(v as Record<string, unknown>), map: start.map, at: start.at } : v;
    if (k === "places") out.maps = maps;
  }
  if (!("maps" in out)) throw new Error("campaign.json has no places to put maps after");
  return out;
}

// ---------------------------------------------------------------------------------------------
// The town's people.

/**
 * presence.ts's town(): its adds run at each time of day (the block between `const add` and `const
 * out`, which reads nothing but the story's time), then merged into one list in the order they're
 * met, each with the hours it's about.
 */
async function townPeople(): Promise<Array<Record<string, unknown>>> {
  const source = readFileSync(join(PROTO, "src", "game", "map", "presence.ts"), "utf8");
  const start = source.indexOf("  const add = (e: Extra) => extras.push(e);\n");
  const end = source.indexOf("  const out: MapActor[] = extras.map(");
  if (start < 0 || end < start) throw new Error("presence.ts: no town() adds between `const add` and `const out`");
  const adds = source.slice(start, end).replace("const add = (e: Extra) => extras.push(e);", "const add = (e: Record<string, unknown>) => extras.push(e);");
  const path = join(scratch, "town.mts");
  writeFileSync(path, `export function extras(story: { time: string }): Array<Record<string, unknown>> {\n  const extras: Array<Record<string, unknown>> = [];\n${adds}  return extras;\n}\n`);
  const { extras } = (await import(pathToFileURL(path).href)) as { extras: (story: { time: string }) => Array<Record<string, unknown>> };

  // Each time's list, by each one's JSON; then one list consistent with all of them (the order each
  // time has them in: a topological order, the earliest seen first).
  const lists = TIMES.map(time => extras({ time }).map(e => JSON.stringify(e)));
  const times = new Map<string, Time[]>();
  const seen: string[] = [];
  lists.forEach((list, t) => {
    if (new Set(list).size !== list.length) throw new Error(`two of the town's people at ${TIMES[t]} are the same`);
    for (const e of list) { if (!times.has(e)) { times.set(e, []); seen.push(e); } times.get(e)!.push(TIMES[t]!); }
  });
  const after = new Map<string, Set<string>>(seen.map(e => [e, new Set<string>()]));
  for (const list of lists) for (let i = 1; i < list.length; i++) after.get(list[i]!)!.add(list[i - 1]!);
  const order: string[] = [];
  while (order.length < seen.length) {
    const next = seen.find(e => !order.includes(e) && [...after.get(e)!].every(b => order.includes(b)));
    if (!next) throw new Error("the town's people aren't in one order at every time of day");
    order.push(next);
  }
  return order.map(e => person(JSON.parse(e) as Record<string, unknown>, times.get(e)!));
}

/** One of the town's people as the map file has them (MapPerson): its fields in one order, and its hours. */
function person(e: Record<string, unknown>, times: Time[]): Record<string, unknown> {
  const known = ["name", "glyph", "color", "kind", "states", "blocks", "at", "text"];
  const other = Object.keys(e).filter(k => !known.includes(k));
  if (other.length) throw new Error(`${String(e.name)} has ${other.join(", ")}, which MapPerson hasn't`);
  return Object.fromEntries([["name", e.name], ["times", times], ...known.slice(1).filter(k => k in e).map(k => [k, e[k]])]);
}

// ---------------------------------------------------------------------------------------------
// The check.

/** Each map built by v2 as the prototype builds it; the town's people at each time of day as the prototype has them. */
async function check(files: Record<string, Record<string, unknown>>): Promise<string[]> {
  const problems: string[] = [];
  const { mapOf } = await v2("shared/map/tiles.ts");
  const { useMaps } = await v2("shared/map/maps.ts");
  const { presence: v2Presence } = await v2("shared/map/presence.ts");
  const { presence: protoPresence } = await proto("src/game/map/presence.ts");
  for (const m of MAPS) {
    const built = mapOf(JSON.parse(mapJson(files[m.key]!)));
    const theirs = (await proto(`src/game/map/maps/${m.module}`))[m.name];
    if (!isDeepStrictEqual(built, theirs)) problems.push(`maps/${m.key}.json doesn't build as the prototype's ${m.module} does${firstDifference(built, theirs)}`);
  }
  useMaps(MAPS.map(m => JSON.parse(mapJson(files[m.key]!))));
  // The arc's stories, a time of day each: the town's people (and the page, the next morning), and the decor lit or not.
  const stories = [
    { time: "morning", played: [], lead: "hanged-clerk", flags: {} },
    { time: "afternoon", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} },
    { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} },
    { time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} },
    { time: "next-morning", played: ["hanged-clerk", "drowned-rat", "heron-warehouse"], lead: "kings-morning", flags: {} },
  ];
  // The places' people come from rows in v2 (and only the lead's place is built): those are the simulation's to show, not compared here.
  const ours = (a: { id: string }) => !/^(hanged-clerk|drowned-rat|heron-warehouse|kings-morning):/.test(a.id);
  for (const story of stories) {
    for (const map of MAPS) {
      const mine = (v2Presence(story, map.key) as Array<{ id: string }>).filter(ours);
      const theirs = (protoPresence(story, map.key) as Array<{ id: string }>).filter(ours);
      if (!isDeepStrictEqual(mine, theirs)) problems.push(`${map.key} at ${story.time}: v2's presence isn't the prototype's${firstDifference(mine, theirs)}`);
    }
  }
  return problems;
}

/** Where two values first differ, for a problem line. */
function firstDifference(a: unknown, b: unknown, at = ""): string {
  if (isDeepStrictEqual(a, b)) return "";
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`);
      if (d) return d;
    }
  }
  return ` (at ${at || "the top"}: ${JSON.stringify(a)?.slice(0, 200)} vs ${JSON.stringify(b)?.slice(0, 200)})`;
}

// ---------------------------------------------------------------------------------------------
// Writing.

/** A map file as a person would edit it: the grid a row a line, each legend entry, region, exit and person on a line of its own. */
function mapJson(file: Record<string, unknown>): string {
  const inline = (v: unknown) => JSON.stringify(v, null, 1).replace(/\n\s*/g, " ");
  const lines = ["{", `  "id": ${JSON.stringify(file.id)},`, `  "name": ${JSON.stringify(file.name)},`];
  const list = (key: string, items: string[], last: boolean) => {
    lines.push(`  ${JSON.stringify(key)}: ${key === "legend" ? "{" : "["}`);
    items.forEach((item, i) => lines.push(`    ${item}${i < items.length - 1 ? "," : ""}`));
    lines.push(`  ${key === "legend" ? "}" : "]"}${last ? "" : ","}`);
  };
  const people = file.people as unknown[] | undefined;
  list("grid", (file.grid as string[]).map(row => JSON.stringify(row)), false);
  list("legend", Object.entries(file.legend as Record<string, unknown>).map(([ch, entry]) => `${JSON.stringify(ch)}: ${inline(entry)}`), false);
  list("regions", (file.regions as unknown[]).map(inline), false);
  list("exits", (file.exits as unknown[]).map(inline), !people);
  if (people) list("people", people.map(inline), true);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function readOr(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

