// New (M3): the scene format's per-scene rules (docs/scene-format.md, "Rules the campaign check enforces"), moved out of hosts/dev/campaign.ts so the Obsidian plugin can run them as a scene is edited, and the campaign check calls them as it did; the talk template's own rules (M2's, for a talk on the two-part GM) moved here too when M3 took M2's talks in.
import { isBeat, isDiscovery, isEnding, isStart, type BeatData, type EndingData, type SceneDocument, type SceneNode } from "./document.ts";
import type { Effect, PlaceFile } from "./files.ts";
import { sceneOf } from "./load.ts";
import { GOODBYE, TOLD } from "./talk.ts";
import { validateScene } from "./types.ts";

/**
 * The rules a scene of the format is held to beyond its shape (document.ts's parse): its ids, the
 * prose it must have, its lore, its routes and what they require, its discoveries' paths, that every
 * node can be reached and it can end well, the evidence its good endings need, the people and places
 * it names, its effects, that it loads as the game loads it, and where the story goes from it. Each
 * problem says what's wrong and where it is: the scene itself (a field of it), a node, a route or a
 * person of the cast, so an editor can take the author there. These are pure: what they need of the
 * campaign around the scene comes in a SceneContext, from the campaign's folder (the campaign check)
 * or the vault it's edited in (the plugin).
 */

/**
 * Where a problem is: the scene, a node, a route, or a person of the cast, and the part of it when it's
 * one part's (`field`, a dot path into it: "closing", "paths.1.clue" for the second path's clue,
 * "effects.0" for the first effect).
 */
export type ProblemAt =
  | { kind: "scene"; field?: string }
  | { kind: "node"; id: string; field?: string }
  | { kind: "route"; id: string; field?: string }
  | { kind: "cast"; id: string; field?: string };

/** What's wrong (a sentence, as the campaign check prints it after the file's name), and where. */
export interface SceneProblem { message: string; at: ProblemAt }

/** What the rules need of the campaign around a scene. */
export interface SceneContext {
  /** Is this path (under the campaign's lore/: "Cast/Cob/public.md") one of its files? */
  hasLore: (path: string) => boolean;
  /** The campaign's scenes, by id (campaign.json's `scenes`): where an ending may go on to. */
  scenes: string[];
  /** The talk template's id (campaign.json's `talk`), which is held to the talk's own rules for its cast. */
  talk?: string;
  /** The campaign's places, each as places/<key>.json has it. */
  places: PlaceFile[];
  /** The story's quests by key (campaign.json's `quests`). */
  quests: Record<string, string>;
  /** The campaign's other scenes as their files have them, whatever their shape: what the story carries between scenes. */
  others: SceneDocument[];
}

/**
 * A scene held to the format's rules, its shape already whole (document.ts's shapeProblems finds
 * nothing): `key` is its file's name (scenes/<key>.kmscene). The problems come in the campaign
 * check's order.
 */
export function sceneRuleProblems(key: string, doc: SceneDocument, context: SceneContext): SceneProblem[] {
  const problems: SceneProblem[] = [];
  const p = (message: string, at: ProblemAt) => problems.push({ message, at });
  const scene = { doc, context, p };

  idProblems(key, scene);
  proseProblems(scene);
  loreProblems(scene);
  routeProblems(scene);
  discoveryProblems(scene);
  peopleProblems(scene);
  reachProblems(scene);
  evidenceProblems(scene);
  storyWiringProblems(scene);

  // And, held to all that, it loads as the game loads it.
  if (!problems.length) loadProblems(scene);
  return problems;
}

/**
 * Where the story goes from a scene (story-design §4.6): when play has overtaken it, to a scene of the
 * campaign (`sceneIds`: the campaign's scenes and its talk template), and only if it says what it
 * assumes; and an interlude, which the story skips, goes on from one of its endings.
 */
export function sceneStoryProblems(doc: SceneDocument, sceneIds: ReadonlySet<string>): SceneProblem[] {
  const problems: SceneProblem[] = [];
  const at = (field: string): ProblemAt => ({ kind: "scene", field });
  if (doc.overtaken && !sceneIds.has(doc.overtaken)) problems.push({ message: `overtaken, the story goes to ${doc.overtaken}, which isn't one of the campaign's scenes`, at: at("overtaken") });
  if (doc.assumes?.length && !doc.overtaken) problems.push({ message: "it assumes things, but doesn't say where the story goes when play has overtaken them (overtaken)", at: at("overtaken") });
  if (doc.overtaken && !doc.assumes?.length) problems.push({ message: "it says where the story goes when it's overtaken, but assumes nothing that play could overtake", at: at("assumes") });
  if (doc.interlude && !doc.nodes.filter(isEnding).some(n => n.data.next)) problems.push({ message: "an interlude, but none of its endings goes on (the story skips it to where they go)", at: at("interlude") });
  return problems;
}

/**
 * The talk template (campaign.json's `talk`, town-design §3.6) held to the talk's own rules, beyond
 * the scene's: its companion is `{companion}`, its first cast entry whoever walks with the player
 * (`{companion}`, named `{name}`), its start has their opening role (the co-GM's first note), each
 * talk's prep fills the discovery TOLD with the one thing they might confide, saying goodbye or
 * walking on ends it at the ending GOODBYE with a way into it from the start (so it's open all talk
 * long), and it has no place of its own. (That everyone the story has walk with the player has a lore
 * entry to talk from is the campaign check's: it needs the campaign's lore.)
 */
export function talkTemplateProblems(doc: SceneDocument): SceneProblem[] {
  const problems: SceneProblem[] = [];
  const p = (message: string, at: ProblemAt) => problems.push({ message, at });
  if (doc.companion !== "{companion}") p(`the talk template's companion is ${JSON.stringify(doc.companion)}, not "{companion}"`, field("companion"));
  const [first] = doc.cast;
  if (first?.id !== "{companion}" || first.name !== "{name}") p("the talk template's first cast entry isn't the companion's ({companion}, named {name})", first ? person(first.id, "id") : field());
  const start = doc.nodes.find(isStart);
  if (start && !start.data.cast?.["{companion}"]?.trim()) p("the talk template's start has no role for {companion} (their opening role, the co-GM's first note)", node(start.id, "cast"));
  const told = doc.nodes.find(n => n.id === TOLD);
  if (!told || !isDiscovery(told)) p(`the talk template has no discovery ${TOLD} (the one thing they might confide, which each talk's prep fills in)`, told ? node(told.id, "kind") : field());
  if (!doc.nodes.some(n => n.id === GOODBYE && isEnding(n))) p(`the talk template has no ending ${GOODBYE} (where saying goodbye or walking on ends a talk)`, field());
  else if (!doc.edges.some(e => e.source === start?.id && e.target === GOODBYE)) p(`the talk template has no way into ${GOODBYE} from its start (saying goodbye ends a talk wherever it's got to)`, node(GOODBYE, "ways-in"));
  if (doc.place !== undefined) p("the talk template has a place (a talk is wherever the player stopped)", field("place"));
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The rules, a part of the scene each.

type Scene = { doc: SceneDocument; context: SceneContext; p: (message: string, at: ProblemAt) => void };

const field = (name?: string): ProblemAt => (name === undefined ? { kind: "scene" } : { kind: "scene", field: name });
const node = (id: string, part?: string): ProblemAt => (part === undefined ? { kind: "node", id } : { kind: "node", id, field: part });
const route = (id: string, part?: string): ProblemAt => (part === undefined ? { kind: "route", id } : { kind: "route", id, field: part });
const person = (id: string, part?: string): ProblemAt => (part === undefined ? { kind: "cast", id } : { kind: "cast", id, field: part });

/** A slug, as the format's ids are. */
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Ids: slugs, the scene's its file's name (the cast's but the talk template's companion). */
function idProblems(key: string, { doc, context, p }: Scene): void {
  const talk = doc.id === context.talk;
  if (doc.id !== key) p(`its id ${doc.id} isn't its file's name`, field("id"));
  const ids = [
    ["scene", [doc.id], () => field("id")],
    ["node", doc.nodes.map(n => n.id), (id: string) => node(id, "id")],
    ["route", doc.edges.map(e => e.id), (id: string) => route(id, "id")],
    ["cast", doc.cast.map(c => c.id), (id: string) => person(id, "id")],
  ] as const;
  for (const [what, list, at] of ids) {
    for (const id of list) if (!SLUG.test(id) && !(talk && what === "cast" && id === "{companion}")) p(`the ${what} id ${JSON.stringify(id)} isn't a slug ([a-z0-9][a-z0-9-]*)`, at(id));
  }
}

/** The prose it must have (an interlude needs no premise or truth), each person's, each node's. */
function proseProblems({ doc, p }: Scene): void {
  for (const k of ["title", "description", "hook", "setting", "premise", "truth"] as const) if (!doc[k].trim() && !(doc.interlude && (k === "premise" || k === "truth"))) p(`it has no ${k}`, field(k));
  for (const c of doc.cast) for (const k of ["name", "look", "voice", "wants", "whyHere", "attitude"] as const) if (!c[k].trim()) p(`${c.id} has no ${k}`, person(c.id, k));
  for (const n of doc.nodes) {
    if (!n.data.title.trim() || !n.data.description.trim()) p(`${n.id} has no ${n.data.title.trim() ? "description" : "title"}`, node(n.id, n.data.title.trim() ? "description" : "title"));
    if (isEnding(n) && !n.data.closing.trim()) p(`ending ${n.id} has no closing`, node(n.id, "closing"));
  }
}

/** Its lore, its people's and its nodes' are in lore/: each path once, where it's first named. */
function loreProblems({ doc, context, p }: Scene): void {
  const named: Array<[string, ProblemAt]> = [
    ...doc.lore.map(path => [path, field("lore")] as [string, ProblemAt]),
    ...(doc.fronts ? [[doc.fronts, field("fronts")] as [string, ProblemAt]] : []),
    ...doc.cast.flatMap(c => (c.lore ? [[c.lore, person(c.id, "lore")] as [string, ProblemAt]] : [])),
    ...doc.nodes.flatMap(n => n.data.lore.map(path => [path, node(n.id, "lore")] as [string, ProblemAt])),
  ];
  const seen = new Set<string>();
  for (const [path, at] of named) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!context.hasLore(path)) p(`lore ${path} isn't in lore/`, at);
  }
}

/** The routes: none leaves an ending, what they require is a beat, an empty condition is only into a discovery, a cue's outer limit counts from and until beats. */
function routeProblems({ doc, p }: Scene): void {
  const nodes = new Map(doc.nodes.map(n => [n.id, n]));
  for (const e of doc.edges) {
    if (nodes.get(e.source)?.data.kind === "exit") p(`route ${e.id} leaves an ending (${e.source})`, route(e.id));
    for (const r of e.data.requires ?? []) if (nodes.get(r)?.data.kind !== "beat") p(`route ${e.id} requires ${r}, which isn't a beat`, route(e.id, "requires"));
    if (!e.data.condition.trim() && !isDiscovery(nodes.get(e.target)!)) p(`route ${e.id} has no condition, and only a route into a discovery may go without`, route(e.id, "condition"));
    // A cue's outer limit counts from and until beats (from the start when it names none).
    (e.data.limit ?? []).forEach((count, i) => {
      for (const id of [...(count.after ? [count.after] : []), ...(count.until ?? [])]) if (nodes.get(id)?.data.kind !== "beat") p(`route ${e.id}'s outer limit counts from or until ${id}, which isn't a beat`, route(e.id, `limit.${i}`));
    });
  }
}

/** The discoveries: a revelation and two paths, three for one that's required (one free of dice); a way in that's no roll. */
function discoveryProblems({ doc, p }: Scene): void {
  const castIds = new Set(doc.cast.map(c => c.id));
  for (const n of doc.nodes.filter(isBeat)) {
    const paths = n.data.paths ?? [];
    if (n.data.revelation === undefined) {
      if (paths.length) p(`beat ${n.id} has paths but no revelation`, node(n.id, "paths"));
      continue;
    }
    if (!n.data.revelation.trim()) p(`discovery ${n.id} has no revelation`, node(n.id, "revelation"));
    if (paths.length < 2) p(`discovery ${n.id} has ${paths.length} path${paths.length === 1 ? "" : "s"}, not two or more`, node(n.id, "paths"));
    if (n.data.required && (paths.length < 3 || paths.every(path => path.check))) p(`discovery ${n.id} is required, but hasn't three paths with one that needs no dice`, node(n.id, "paths"));
    paths.forEach((path, i) => {
      for (const k of ["via", "clue", "earn"] as const) if (!path[k].trim()) p(`discovery ${n.id}'s path ${i + 1} has no ${k}`, node(n.id, `paths.${i}.${k}`));
      if (!path.via.includes(" ") && !castIds.has(path.via)) p(`discovery ${n.id}'s path ${i + 1} is via ${path.via}, who isn't in the cast`, node(n.id, `paths.${i}.via`));
    });
    if (!doc.edges.some(e => e.target === n.id && !e.data.skill)) p(`discovery ${n.id} is locked behind a roll: no route into it is free of dice`, node(n.id));
  }
}

/** Who comes on where, and whose notes the start and the events hold. */
function peopleProblems({ doc, p }: Scene): void {
  const nodes = new Map(doc.nodes.map(n => [n.id, n]));
  const castIds = new Set(doc.cast.map(c => c.id));
  for (const c of doc.cast) {
    const at = c.enters === undefined ? undefined : nodes.get(c.enters);
    if (c.enters !== undefined && !(at && isBeat(at) && !isDiscovery(at))) p(`${c.id} enters at ${c.enters}, which isn't an event beat`, person(c.id, "enters"));
  }
  for (const n of doc.nodes) for (const id of Object.keys(("cast" in n.data ? n.data.cast : undefined) ?? {})) if (!castIds.has(id)) p(`${n.id} has a note for ${id}, who isn't in the cast`, node(n.id, "cast"));
}

/** Every node can be reached from the start, and it can end well. */
function reachProblems({ doc, context, p }: Scene): void {
  const reached = reachable(doc);
  for (const n of doc.nodes) if (!reached.has(n.id)) p(`${n.id} can't be reached from the start`, node(n.id));
  const talk = doc.id === context.talk;
  if (!talk && !goodEndings(doc).some(n => reached.has(n.id))) p("it has no good or mixed ending that can be reached", field());
}

/** What its good endings need: in a scene with a required discovery, each way into one says what it needs, and each required discovery is needed by one. */
function evidenceProblems({ doc, p }: Scene): void {
  const required = doc.nodes.filter(isDiscovery).filter(n => n.data.required);
  if (!required.length) return;
  const good = goodEndings(doc);
  const intoGood = doc.edges.filter(e => good.some(n => n.id === e.target && n.data.result === "good"));
  for (const e of intoGood) if (!e.data.requires?.length) p(`route ${e.id} goes to a good ending (${e.target}) but requires nothing found`, route(e.id, "requires"));
  for (const n of required) if (!intoGood.some(e => e.data.requires?.includes(n.id))) p(`discovery ${n.id} is required, but no route into a good ending requires it`, node(n.id, "required"));
}

/** Where the story goes, the place, and what the effects may name. */
function storyWiringProblems({ doc, context, p }: Scene): void {
  const castIds = new Set(doc.cast.map(c => c.id));
  for (const n of doc.nodes.filter(isEnding)) if (n.data.next && !context.scenes.includes(n.data.next)) p(`ending ${n.id} goes on to ${n.data.next}, which isn't one of the campaign's scenes`, node(n.id, "next"));
  const place = doc.place ? context.places.find(pl => pl.key === doc.place) : undefined;
  if (doc.place && !place) p(`its place ${doc.place} isn't one of the campaign's places`, field("place"));

  const carried = carriedThings([doc, ...context.others]);
  const carriedElsewhere = carriedThings(context.others);
  for (const n of doc.nodes.filter(isBeat)) for (const t of n.data.carry?.things ?? []) if (!place?.things.some(x => x.id === t) && !carriedElsewhere.has(t)) p(`beat ${n.id} carries ${t}, which isn't a thing of its place, nor carried from another scene`, node(n.id, "carry"));

  // What an effect may name: the cast, the place's areas and things, and the things the story carries between scenes (Prout's page, owed into the Rat in Cob's boot).
  const keys = new Set([...castIds, ...(place ? [...place.areas.map(a => a.id), ...place.things.map(t => t.id)] : []), ...carried]);
  const effects: Array<[string, ProblemAt, Effect]> = [
    ...(doc.onStart ?? []).map((e, i) => ["onStart", field(`onStart.${i}`), e] as [string, ProblemAt, Effect]),
    ...(doc.onEnd ?? []).map((e, i) => ["onEnd", field(`onEnd.${i}`), e] as [string, ProblemAt, Effect]),
    ...doc.nodes.filter(isEnding).flatMap(n => (n.data.effects ?? []).map((e, i) => [`ending ${n.id}`, node(n.id, `effects.${i}`), e] as [string, ProblemAt, Effect])),
  ];
  for (const [where, at, e] of effects) for (const problem of effectProblems(e, keys, castIds, doc.facts ?? {}, context.quests)) p(`${where}: ${problem}`, at);
  (doc.afterwards ?? []).forEach((op, i) => { for (const k of namedKeys(op).filter(k => !keys.has(k))) p(`afterwards: ${op.op} names unknown ${k}`, field(`afterwards.${i}`)); });
  for (const id of Object.keys(place?.people ?? {})) if (id !== "player" && !castIds.has(id)) p(`${doc.place}'s people: ${id} isn't in the cast`, field("place"));
}

/** The runtime's own validation of the Scene the game makes from the file. */
function loadProblems({ doc, p }: Scene): void {
  try {
    for (const problem of validateScene(sceneOf(doc))) p(problem, field());
  } catch (e) {
    p(`it doesn't load: ${(e as Error).message}`, field());
  }
}

/** The good and mixed endings. */
function goodEndings(doc: SceneDocument): Array<SceneNode<EndingData>> {
  return doc.nodes.filter(isEnding).filter(n => n.data.result !== "bad");
}

/** The nodes reachable from the start, a route opening once its source and everything it requires are reached (the play's open routes, as a fixed point). */
export function reachable(doc: SceneDocument): Set<string> {
  const reached = new Set(doc.nodes.filter(n => n.data.kind === "start").map(n => n.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of doc.edges) {
      if (reached.has(e.source) && !reached.has(e.target) && (e.data.requires ?? []).every(r => reached.has(r))) { reached.add(e.target); grew = true; }
      if (e.data.onFailure && reached.has(e.source) && !reached.has(e.data.onFailure) && (e.data.requires ?? []).every(r => reached.has(r))) { reached.add(e.data.onFailure); grew = true; }
    }
  }
  return reached;
}

/** The things the story carries between scenes: those of every carried beat of these scenes (what it owes goes with whoever has them), a file of the wrong shape's too, as far as it has them. */
function carriedThings(scenes: SceneDocument[]): Set<string> {
  const things = (n: SceneNode<BeatData>) => (Array.isArray(n?.data?.carry?.things) ? n.data.carry.things.filter(t => typeof t === "string") : []);
  return new Set(scenes.flatMap(doc => (Array.isArray(doc?.nodes) ? (doc.nodes as Array<SceneNode<BeatData>>).flatMap(things) : [])));
}

/**
 * An exit's effect (or onStart's or onEnd's): an op the story knows, its condition on known facts, the cast or
 * things it names, and a quest campaign.json titles (story-design §4.6).
 */
function effectProblems(effect: Effect, keys: Set<string>, cast: Set<string>, facts: Record<string, string>, quests: Record<string, string>): string[] {
  const problems: string[] = [];
  const op: string = effect.op;
  if (!(op in EFFECT_OPS) && op !== START_FIGHT) return [`${op} isn't an effect the story knows`];
  for (const cond of [effect.if, effect.unless]) for (const fact of cond ? [cond.established].flat() : []) if (!(fact in facts)) problems.push(`condition on unknown fact ${fact}`);
  if (op === START_FIGHT) {
    // The fight's set-up (the Heron's combat exit), recorded for the fight to come: who's in it, where.
    const fight = effect as unknown as { enemies?: Array<{ leader?: string }>; allies?: string[]; at?: string };
    for (const who of [...(fight.allies ?? []), ...(fight.enemies ?? []).flatMap(e => e.leader ? [e.leader] : [])]) if (!cast.has(who)) problems.push(`startFight names unknown ${who}`);
    if (fight.at !== undefined && !keys.has(fight.at)) problems.push(`startFight is at unknown ${fight.at}`);
  } else if (effect.op === "attitude" || effect.op === "remember" || effect.op === "follow") {
    if (!cast.has(effect.who)) problems.push(`${effect.op} names unknown ${effect.who}`);
    if (effect.op === "attitude" && !ATTITUDES.includes(effect.to)) problems.push(`attitude ${String(effect.to)} isn't an attitude`);
  } else if (effect.op === "promise") {
    for (const who of [effect.by, effect.to]) if (who !== "$player" && !cast.has(who)) problems.push(`promise names unknown ${who}`);
  } else if (effect.op === "quest") {
    if (!(effect.quest in quests)) problems.push(`quest ${effect.quest} isn't one of campaign.json's quests`);
  } else if (effect.op === "flag") {
    if (!effect.name?.trim()) problems.push("flag has no name");
  } else if (effect.op !== "journal") {
    // A world op acts on something (a create makes something, by its name): without it, it does nothing.
    if (effect.op === "create" ? !effect.name?.trim() : !effect.what?.trim()) problems.push(effect.op === "create" ? "create doesn't name what it creates" : `${effect.op} doesn't say what it acts on`);
    for (const k of namedKeys(effect)) if (!keys.has(k)) problems.push(`${effect.op} names unknown ${k}`);
  }
  return problems;
}

/** Every op an effect may have (files.ts Effect): the story's, and the world's (WorldOp's). */
export const EFFECT_OPS: Record<Effect["op"], true> = {
  quest: true, flag: true, attitude: true, remember: true, journal: true, follow: true, promise: true,
  move: true, place: true, give: true, drop: true, create: true, state: true, note: true, forget: true, remove: true,
  destroy: true, ignite: true, douse: true, spill: true, chill: true, bleed: true, break: true,
};
/** The fight's set-up, which the effects have no op for yet: recorded, as the prototype's startCombat was, for the fight to come (V12). */
export const START_FIGHT = "startFight";
/** The attitudes an attitude effect may set. */
export const ATTITUDES: string[] = ["hostile", "unfriendly", "wary", "neutral", "friendly", "devoted"];

/** The keys a world operation names (what it acts on, where it goes); "$player" is the controller's character. */
function namedKeys(op: { what?: string; to?: string }): string[] {
  return [op.what, op.to].filter((k): k is string => !!k && k !== "$player");
}
