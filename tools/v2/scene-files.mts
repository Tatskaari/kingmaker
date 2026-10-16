/**
 * Writes the campaign's scenes from the prototype (v2/docs/story-design.md §4.6): every scene of the
 * arc (the hanged clerk, the afternoon interlude, the Drowned Rat, the wharf at night, the Heron
 * warehouse and the King's morning) as scenes/<id>/ (scene.json and its Markdown), each scene's
 * world as places/<key>.json, and campaign.json's scenes, places and quests. Generalised from the
 * scratchpad's convert-hanged-clerk.mts, whose shapes and Markdown it keeps (the hanged clerk comes
 * out as it did, with its onEnd); what it can't infer (the facts' ids, the exits' scripts as effects,
 * the place's key) is in a table per scene, tools/v2/scenes/<scene>.mts.
 *
 *   node --no-warnings tools/v2/scene-files.mts --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2/campaigns/caerwyn
 *   node --no-warnings tools/v2/scene-files.mts --proto … --out v2/campaigns/caerwyn --check     (checks only: writes nothing)
 *
 * It checks its output:
 *  - round trip: each scene's files, read back by v2's loader (shared/scene/load.ts sceneOf, with
 *    its words), give back the prototype's Scene exactly, bar the exit scripts (now effects), the
 *    world (now its place's file) and the anchors (which only scripts read), with the table's onEnd;
 *  - effects: each exit's effects, for every set of the scene's facts, are the operations its script
 *    records against the prototype's recordingWorld, in the same order (as data: `normal` below);
 *  - the scene validates (validateScene, with its place's world), every id its effects and
 *    afterwards name is in its cast, its place or a scene it stands in for (an essential's `missed`),
 *    and every lore doc it names is in the campaign's lore/;
 *  - with --check, the committed files are what the prototype gives.
 * It imports the prototype at 44c6d4a, which never changes, and v2's shared code from this
 * checkout; v2 never imports it. Run it, review the diff, commit the output.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { Effect, SceneTable } from "./scenes/table.mts";
import { hangedClerk } from "./scenes/hanged-clerk.mts";
import { caerwynAfternoon } from "./scenes/caerwyn-afternoon.mts";
import { drownedRat } from "./scenes/drowned-rat.mts";
import { wharfNight } from "./scenes/wharf-night.mts";
import { heronWarehouse } from "./scenes/heron-warehouse.mts";
import { kingsMorning } from "./scenes/kings-morning.mts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`usage: scene-files.mts --proto <the prototype at 44c6d4a> --out <v2>/campaigns/caerwyn [--check] (no ${name})`);
  return process.argv[i + 1]!;
};
const PROTO = resolve(arg("--proto"));
const OUT = resolve(arg("--out"));
const CHECK_ONLY = process.argv.includes("--check");
const V2 = resolve(import.meta.dirname, "..", "..", "v2");

/** The arc's scenes, in the order the story plays them (the map unit's places: shared/map/places.ts). */
const TABLES: SceneTable[] = [hangedClerk, caerwynAfternoon, drownedRat, wharfNight, heronWarehouse, kingsMorning];

/**
 * The story's quests by key, each with its title (campaign.json's quests): the titles the scripts
 * start them with (hanged-clerk.ts:403, drowned-rat.ts:60), and for the hanged clerk's, which no
 * script starts (its exits advance, complete or fail it), its scene's title. The prototype records
 * quests and shows none; v2 shows them, so a quest an exit moves before any starts it needs a title.
 */
const QUESTS: Record<string, string> = { "hanged-clerk": "The Hanged Clerk", "purveyors-man": "The Purveyor's Man", "heron-ledger": "The Heron Ledger" };

const proto = (path: string) => import(pathToFileURL(join(PROTO, path)).href);
const v2 = (path: string) => import(pathToFileURL(join(V2, path)).href);

const { recordingWorld } = await proto("src/world/dsl.ts");
const { ASSETS } = await proto("src/world/assets.ts") as { ASSETS: Array<{ id: string; kind: string; name: string; tags: string[] }> };
const { sceneOf } = await v2("shared/scene/load.ts");
const { validateScene } = await v2("shared/scene/types.ts");

// ------------------------------------------------------------------------------------------------
// The v2 file shapes (shared/scene/files.ts, kept loose here: the converter writes what the loader reads).

type Phase = "attempt" | "cue" | "outcome";
interface CheckFile { skill: string; dc: number; reason?: string; success: string; failure: string; onSuccess: string; onFailure?: string; establishes?: { success?: string[]; failure?: string[] } }
interface RouteFile { id: string; on: Phase; when: string; to?: string; check?: CheckFile; establishes?: string[]; given?: true; essential?: string; towards?: string }
interface CastFile { id: string; name: string; card: string; called?: string; aka?: string[]; enters?: string; group?: string; statblock?: string; weapon?: string; members?: Array<{ id: string; name: string; statblock?: string; weapon?: string; look?: string }> }
interface SceneFile {
  id: string; title: string; summary: string; kind: "scene" | "talk"; time?: string;
  interlude?: boolean; assumes?: string[]; overtaken?: string; rest?: "short" | "long"; milestone?: boolean; background?: string[]; onEnd?: Effect[];
  place?: string; start: string;
  cast: CastFile[]; facts: Record<string, string>;
  beats: Record<string, { title: string; text: string; routes: RouteFile[] }>;
  anytime: RouteFile[];
  exits: Record<string, { kind: string; title: string; next?: string; text: string; effects: Effect[] }>;
  essentials: Record<string, { what: string; placedWith: string[]; carriers?: string[]; unlocks: string; later?: string; things?: string[]; missed?: string }>;
  afterwards: Array<Record<string, unknown>>;
  lore: string[]; fronts?: string;
}
interface PlaceFile { key: string; name: string; description: string; size: { w: number; h: number }; areas: Array<{ id: string }>; things: Array<{ id: string; in: string }>; people: Record<string, { in: string }> }

// ------------------------------------------------------------------------------------------------
// Markdown: what the converter writes, and the loader reads back.

const phaseOf = (t: { on?: Phase; check?: unknown }): Phase => t.on ?? (t.check ? "attempt" : "outcome");
const para = (text: string) => `${text.trim()}\n`;
const bullets = (items: string[]) => items.map(i => `- ${i}`).join("\n");
const section = (title: string, body: string) => `## ${title}\n\n${body.trim()}\n`;

const castCard = (c: any) => [
  section("Look", c.look), section("Voice", c.voice), section("Wants", c.wants),
  ...(c.fears ? [section("Fears", c.fears)] : []),
  section("Knows", bullets(c.knows)),
  // An empty list too (the King's morning's Kell has none left to keep), so it reads back as written.
  ...(c.secrets ? [section("Secrets", bullets(c.secrets))] : []),
  section("Attitude", c.attitude),
].join("\n");
const beatMd = (b: any) => [
  para(b.direction),
  ...(b.cast && Object.keys(b.cast).length ? [section("Cast", bullets(Object.entries(b.cast).map(([id, note]) => `${id}: ${note}`)))] : []),
  ...(b.pressure ? [section("Pressure", b.pressure)] : []),
].join("\n");
const exitMd = (e: any) => [section("Outcome", e.outcome), section("Closing", e.closing)].join("\n");

// ------------------------------------------------------------------------------------------------
// Convert: a scene into its files (by path in the campaign folder), and its place's.

interface Converted { table: SceneTable; scene: any; file: SceneFile; files: Map<string, string>; place?: PlaceFile }

function convert(table: SceneTable, scene: any): Converted {
  const factTexts: string[] = [];
  const noteFact = (f: string) => { if (!factTexts.includes(f)) factTexts.push(f); };
  for (const t of [...scene.beats.flatMap((b: any) => b.transitions), ...(scene.anytime ?? [])]) {
    (t.establishes ?? []).forEach(noteFact);
    (t.check?.establishes?.success ?? []).forEach(noteFact);
    (t.check?.establishes?.failure ?? []).forEach(noteFact);
  }
  const factId = (text: string): string => {
    const hit = table.facts.find(([start]) => text.startsWith(start));
    if (!hit) throw new Error(`${scene.id}: no fact id for "${text.slice(0, 60)}…": add one to its table's facts`);
    return hit[1];
  };
  const facts = Object.fromEntries(factTexts.map(t => [factId(t), t]));

  const route = (t: any): RouteFile => ({
    id: t.id, on: phaseOf(t), when: t.when,
    ...(t.to ? { to: t.to } : {}),
    ...(t.check ? { check: {
      skill: t.check.skill, dc: t.check.dc, ...(t.check.reason ? { reason: t.check.reason } : {}),
      success: t.check.success, failure: t.check.failure, onSuccess: t.check.onSuccess,
      ...(t.check.onFailure ? { onFailure: t.check.onFailure } : {}),
      ...(t.check.establishes ? { establishes: Object.fromEntries(Object.entries(t.check.establishes).map(([k, v]) => [k, (v as string[]).map(factId)])) } : {}),
    } } : {}),
    ...(t.establishes ? { establishes: t.establishes.map(factId) } : {}),
    ...(t.given ? { given: true as const } : {}),
    ...(t.essential ? { essential: t.essential } : {}),
    ...(t.towards ? { towards: t.towards } : {}),
  });

  const file: SceneFile = {
    id: scene.id, title: scene.title, summary: scene.summary, kind: "scene",
    ...(scene.time ? { time: scene.time } : {}),
    ...(scene.interlude ? { interlude: true } : {}),
    ...(scene.assumes?.length ? { assumes: scene.assumes } : {}), ...(scene.overtaken ? { overtaken: scene.overtaken } : {}),
    ...(scene.rest ? { rest: scene.rest } : {}), ...(scene.milestone ? { milestone: true } : {}),
    ...(scene.background?.length ? { background: scene.background } : {}),
    ...(table.onEnd?.length ? { onEnd: table.onEnd } : {}),
    ...(table.place ? { place: table.place } : {}), start: scene.start,
    cast: scene.cast.map((c: any): CastFile => ({
      id: c.id, name: c.name, card: `cast/${c.id}.md`,
      ...(c.called ? { called: c.called } : {}), ...(c.aka ? { aka: c.aka } : {}), ...(c.enters ? { enters: c.enters } : {}),
      ...(c.group ? { group: c.group } : {}), ...(c.statblock ? { statblock: c.statblock } : {}), ...(c.weapon ? { weapon: c.weapon } : {}),
      ...(c.members ? { members: c.members } : {}),
    })),
    facts,
    beats: Object.fromEntries(scene.beats.map((b: any) => [b.id, { title: b.title, text: `beats/${b.id}.md`, routes: b.transitions.map(route) }])),
    anytime: (scene.anytime ?? []).map(route),
    exits: Object.fromEntries(scene.exits.map((e: any) => {
      const effects = table.effects[e.id];
      if (!effects) throw new Error(`${scene.id}: no effects written for exit ${e.id}: add them to its table (an empty list if it has no script)`);
      return [e.id, { kind: e.kind, title: e.title, ...(e.next ? { next: e.next } : {}), text: `exits/${e.id}.md`, effects }];
    })),
    essentials: Object.fromEntries((scene.essentials ?? []).map((e: any) => {
      const { id, ...rest } = e;
      return [id, rest];
    })),
    afterwards: scene.afterwards ?? [],
    lore: scene.lore ?? [], ...(scene.fronts ? { fronts: scene.fronts } : {}),
  };
  for (const id of Object.keys(table.effects)) if (!scene.exits.some((e: any) => e.id === id)) throw new Error(`${scene.id}: its table has effects for ${id}, which isn't one of its exits`);

  const dir = `scenes/${scene.id}`;
  const files = new Map<string, string>();
  files.set(`${dir}/scene.json`, `${JSON.stringify(file, null, 2)}\n`);
  files.set(`${dir}/setting.md`, para(scene.setting));
  files.set(`${dir}/premise.md`, para(scene.premise));
  files.set(`${dir}/hook.md`, para(scene.hook));
  files.set(`${dir}/opening.md`, para(scene.opening));
  files.set(`${dir}/limits.md`, `${bullets(scene.limits ?? [])}\n`);
  for (const c of scene.cast) files.set(`${dir}/cast/${c.id}.md`, castCard(c));
  for (const b of scene.beats) files.set(`${dir}/beats/${b.id}.md`, beatMd(b));
  for (const e of scene.exits) files.set(`${dir}/exits/${e.id}.md`, exitMd(e));

  // The place: the WorldSpec as authored, keyed. Defaults (kind, size, material, AC, HP, flammable) are
  // the engine's, applied when the place is built (src/world/scene-world.ts:148-163), so they stay out.
  let place: PlaceFile | undefined;
  if (table.place) {
    if (!scene.world) throw new Error(`${scene.id}: its table names the place ${table.place}, but it has no world`);
    const { name, description, size, areas, things, people } = scene.world;
    place = { key: table.place, name, description, size, areas, things, people };
    files.set(`places/${table.place}.json`, `${JSON.stringify(place, null, 2)}\n`);
  } else if (scene.world) throw new Error(`${scene.id}: it has a world, but its table names no place for it`);
  return { table, scene, file, files, place };
}

/** campaign.json with the story's scenes, places and quests; every other field as it was, in its order (quests last, where it's new). */
function withScenes(campaign: Record<string, unknown>, converted: Converted[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campaign)) {
    out[k] = k === "scenes" ? converted.map(c => c.scene.id)
      : k === "places" ? converted.flatMap(c => c.table.place ? [c.table.place] : [])
      : k === "quests" ? QUESTS
      : v;
  }
  if (!("scenes" in out) || !("places" in out)) throw new Error("campaign.json has no scenes or places to replace");
  if (!("quests" in out)) out.quests = QUESTS;
  return out;
}

// ------------------------------------------------------------------------------------------------
// The checks.

/** The prototype's Scene as the loader should give it back: `on` explicit, the world and anchors gone, each exit's script its effects, the table's onEnd. */
function expectedOf(c: Converted): Record<string, unknown> {
  const { world: _w, anchors: _a, ...rest } = c.scene;
  const route = (x: any) => ({ ...x, on: phaseOf(x) });
  return {
    ...rest,
    beats: rest.beats.map((b: any) => ({ ...b, transitions: b.transitions.map(route) })),
    anytime: rest.anytime?.length ? rest.anytime.map(route) : undefined,
    exits: rest.exits.map(({ script: _s, ...e }: any) => ({ ...e, effects: c.table.effects[e.id] })),
    ...(c.table.onEnd?.length ? { onEnd: c.table.onEnd } : {}),
  };
}

function roundTrip(c: Converted): string[] {
  const dir = `scenes/${c.scene.id}`;
  let loaded: Record<string, unknown>;
  try {
    loaded = sceneOf(c.file, (path: string) => c.files.get(`${dir}/${path}`));
  } catch (e) {
    return [`${c.scene.id}: round trip: it doesn't load (${(e as Error).message})`];
  }
  const expected = expectedOf(c);
  return [...new Set([...Object.keys(expected), ...Object.keys(loaded)])]
    .filter(key => !isDeepStrictEqual(expected[key], loaded[key]))
    .map(key => `${c.scene.id}: round trip: ${key} differs`);
}

/** A recorded operation of the prototype's world (src/world/dsl.ts recordingWorld) as the effect that stands for it. */
function normal(o: { op: string; args: any }, table: SceneTable): Effect {
  const a = o.args;
  const who = (id: string) => id === "player" ? "$player" : id;
  const key = (ref: string) => {
    const anchor = /^anchor:(.+)$/.exec(ref)?.[1];
    const found = anchor === undefined ? undefined : table.anchors?.[anchor];
    return found ?? `?${ref}`;
  };
  switch (o.op) {
    case "quest.start": return { op: "quest", quest: a.id, do: "start", title: a.title, text: a.summary };
    case "quest.advance": return { op: "quest", quest: a.id, do: "advance", stage: a.stage, text: a.note };
    case "quest.complete": return { op: "quest", quest: a.id, do: "complete", text: a.note };
    case "quest.fail": return { op: "quest", quest: a.id, do: "fail", text: a.note };
    case "character.setAttitude": return { op: "attitude", who: a.id, to: a.attitude, text: a.reason };
    case "character.remember": return { op: "remember", who: a.id, text: a.fact };
    case "character.moveTo": return { op: "remove", what: a.id, text: a.place };
    case "character.leaveScene": return { op: "remove", what: a.id, text: a.destination };
    case "player.addItem": {
      // A thing of a world the player is given (the ledger page, the true book); anything else, made for them.
      const thing = table.items?.[a.item.id];
      return thing ? { op: "give", what: thing, to: "$player" } : { op: "create", name: a.item.name, kind: "item", to: "$player", text: a.item.description };
    }
    case "setFlag": return { op: "flag", name: a.name, value: String(a.value) };
    case "journal": return { op: "journal", text: a.entry };
    case "promise": return { op: "promise", by: who(a.by), to: who(a.to), text: a.what, ...(a.due !== undefined ? { due: a.due } : {}) };
    // An asset put at an anchor: a feature made there, named as the asset is (src/world/assets.ts).
    case "place": return { op: "create", name: ASSETS.find(x => x.id === a.asset)?.name ?? `?${a.asset}`, kind: "feature", to: key(a.at), ...(a.note ? { text: a.note } : {}) };
    // What the world can't show: a note on the thing it happened to.
    case "unsupported": return { op: "note", what: table.unsupported?.find(([start]) => String(a.description).startsWith(start))?.[1] ?? "?unsupported", text: a.description };
    // The fight's set-up, as the prototype's combat reads it (src/game/combat/fights.ts:460): the enemies, the allies, where.
    case "startCombat": return { op: "startFight", enemies: a.enemies, allies: a.allies, at: key(a.at), ...(a.surprise !== undefined ? { surprise: a.surprise } : {}) };
    default: return { op: `?${o.op}` };
  }
}

const listOf = (x: string | string[] | undefined) => x === undefined ? [] : [x].flat();

/** Each exit's effects against its script, for every set of the scene's facts (all of them: 2^9 at most). */
function effectsCheck(c: Converted): string[] {
  const problems: string[] = [];
  const facts = Object.entries(c.file.facts);
  const holds = (e: Effect, established: Set<string>) =>
    listOf(e.if?.established).every(id => established.has(c.file.facts[id]!)) && !listOf(e.unless?.established).some(id => established.has(c.file.facts[id]!));
  for (const ex of c.scene.exits) {
    for (let mask = 0; mask < 1 << facts.length; mask++) {
      const established = facts.filter((_, i) => mask & (1 << i)).map(([, t]) => t);
      const rec = recordingWorld({ assets: ASSETS, characters: c.scene.cast.map((x: any) => x.id), anchors: c.scene.anchors ?? [] });
      ex.script?.(rec.world, { sceneId: c.scene.id, exitId: ex.id, established });
      const want = rec.operations.map((o: { op: string; args: any }) => normal(o, c.table));
      const got = c.table.effects[ex.id]!.filter(e => holds(e, new Set(established))).map(({ if: _i, unless: _u, ...e }) => e);
      if (!isDeepStrictEqual(want, got)) {
        problems.push(`${c.scene.id}: effects: ${ex.id} with [${facts.filter((_, i) => mask & (1 << i)).map(([k]) => k).join(", ")}] differ`);
        break;
      }
      if (rec.warnings.length) { problems.push(`${c.scene.id}: effects: ${ex.id}'s script warns: ${rec.warnings.join("; ")}`); break; }
    }
  }
  return problems;
}

/** validateScene's rules with the place's world, and the ids, people and lore the scene names. */
function sceneCheck(c: Converted, all: Converted[], lore: Set<string>): string[] {
  const problems: string[] = [];
  const f = c.file, at = c.scene.id;
  let loaded: any;
  try {
    loaded = sceneOf(f, (path: string) => c.files.get(`scenes/${at}/${path}`));
  } catch {
    return problems; // the round trip says why
  }
  problems.push(...validateScene({ ...loaded, ...(c.place ? { world: c.place } : {}) }).map((p: string) => `${at}: ${p}`));

  const cast = new Set(f.cast.map(x => x.id));
  // What its effects may name: its cast, its place's areas and things, and the things of the essentials it stands in for.
  const missedThings = Object.values(f.essentials).flatMap(e => {
    if (!e.missed) return [];
    const [scene, id] = e.missed.split(":");
    return all.find(x => x.scene.id === scene)?.file.essentials[id!]?.things ?? [];
  });
  const keys = new Set([...cast, ...(c.place ? [...c.place.areas.map(x => x.id), ...c.place.things.map(x => x.id)] : []), ...missedThings, "$player"]);
  const known = (k: unknown) => typeof k !== "string" || keys.has(k);
  for (const [eid, e] of Object.entries(f.exits)) for (const x of [...(f.onEnd ?? []), ...e.effects]) {
    for (const k of ["what", "who", "to", "by", "at"] as const) if (!(x.op === "attitude" && k === "to") && !known(x[k])) problems.push(`${at}: exit ${eid}: ${x.op} names unknown ${String(x[k])}`);
    if (x.op === "startFight") {
      for (const ally of (x.allies as string[] | undefined) ?? []) if (!cast.has(ally)) problems.push(`${at}: exit ${eid}: startFight's ally ${ally} isn't in the cast`);
      for (const enemy of (x.enemies as Array<{ leader?: string }> | undefined) ?? []) if (enemy.leader && !cast.has(enemy.leader)) problems.push(`${at}: exit ${eid}: startFight's leader ${enemy.leader} isn't in the cast`);
    }
    if (x.op === "quest" && !(String(x.quest) in QUESTS)) problems.push(`${at}: exit ${eid}: quest ${String(x.quest)} isn't one of the campaign's quests`);
    for (const id of [...listOf(x.if?.established), ...listOf(x.unless?.established)]) if (!(id in f.facts)) problems.push(`${at}: exit ${eid}: condition on unknown fact ${id}`);
  }
  for (const op of f.afterwards) if (!known(op.what)) problems.push(`${at}: afterwards names unknown ${String(op.what)}`);
  if (c.place) {
    for (const id of Object.keys(c.place.people)) if (id !== "player" && !cast.has(id)) problems.push(`${at}: its place's people: ${id} isn't in the cast`);
    const placed = new Set([...c.place.areas.map(x => x.id), ...c.place.things.map(x => x.id)]);
    for (const t of c.place.things) if (!placed.has(t.in) && !cast.has(t.in)) problems.push(`${at}: its place's thing ${t.id} is in unknown ${t.in}`);
  }
  for (const p of [...f.lore, ...(f.fronts ? [f.fronts] : [])]) if (!lore.has(p)) problems.push(`${at}: lore ${p} isn't in the campaign's lore/`);
  for (const [eid, e] of Object.entries(f.exits)) if (e.next && !all.some(x => x.scene.id === e.next)) problems.push(`${at}: exit ${eid} goes on to ${e.next}, which isn't one of the story's scenes`);
  if (f.overtaken && !all.some(x => x.scene.id === f.overtaken)) problems.push(`${at}: overtaken goes to ${f.overtaken}, which isn't one of the story's scenes`);
  return problems;
}

/** Every file under a folder, by its path in it ("/" separators). */
function walk(root: string, d = ""): string[] {
  if (!existsSync(join(root, d))) return [];
  return readdirSync(join(root, d), { withFileTypes: true })
    .flatMap(e => e.name.startsWith(".") ? [] : e.isDirectory() ? walk(root, join(d, e.name)) : [join(d, e.name)]);
}

// ------------------------------------------------------------------------------------------------
// Run.

const converted: Converted[] = [];
for (const table of TABLES) converted.push(convert(table, (await proto(table.module))[table.name]));
const campaignPath = join(OUT, "campaign.json");
const campaign = `${JSON.stringify(withScenes(JSON.parse(readFileSync(campaignPath, "utf8")), converted), null, 2)}\n`;
const lore = new Set(walk(join(OUT, "lore")).filter(p => p.endsWith(".md")));

const problems = [
  ...converted.flatMap(roundTrip),
  ...converted.flatMap(effectsCheck),
  ...converted.flatMap(c => sceneCheck(c, converted, lore)),
];
const outputs = new Map(converted.flatMap(c => [...c.files]));

if (CHECK_ONLY) {
  const stale = [
    ...[...outputs].filter(([path, text]) => !existsSync(join(OUT, path)) || readFileSync(join(OUT, path), "utf8") !== text).map(([path]) => path),
    ...converted.flatMap(c => walk(join(OUT, "scenes", c.scene.id)).map(p => `scenes/${c.scene.id}/${p}`)).filter(path => !outputs.has(path)),
    ...(readFileSync(campaignPath, "utf8") === campaign ? [] : ["campaign.json"]),
  ];
  if (stale.length) problems.push(`the committed files aren't what the prototype gives: ${stale.join(", ")} (run without --check and review the diff)`);
} else {
  for (const c of converted) rmSync(join(OUT, "scenes", c.scene.id), { recursive: true, force: true });
  for (const [path, text] of outputs) { mkdirSync(dirname(join(OUT, path)), { recursive: true }); writeFileSync(join(OUT, path), text); }
  writeFileSync(campaignPath, campaign);
}

console.log(JSON.stringify({
  out: OUT, wrote: CHECK_ONLY ? "nothing (--check)" : `${outputs.size} files and campaign.json`,
  scenes: converted.map(c => ({
    id: c.scene.id, place: c.table.place ?? "(none: an interlude)", facts: Object.keys(c.file.facts).length,
    beats: Object.keys(c.file.beats).length, routes: Object.values(c.file.beats).reduce((n, b) => n + b.routes.length, 0) + c.file.anytime.length,
    exits: Object.fromEntries(Object.entries(c.file.exits).map(([id, e]) => [id, e.effects.length])),
  })),
  quests: Object.keys(QUESTS), problems,
}, null, 1));
if (problems.length) process.exitCode = 1;
