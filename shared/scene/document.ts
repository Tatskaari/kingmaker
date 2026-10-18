// New (M2): docs/scene-format.md's contract as TypeScript (the .kmscene file, version 2), and its parse.
import type { Effect, TimeOfDay, WorldOpData } from "./files.ts";
import { SKILLS, type ExitKind, type Skill } from "./types.ts";

/**
 * A scene is one file, campaigns/<campaign>/scenes/<id>.kmscene: JSON that the game loads as it is
 * and the Obsidian plugin edits as it is (docs/scene-format.md). The envelope is the plugin's graph
 * (nodes and edges); the game's fields sit in each node's or edge's `data`, and at the top level.
 * Unknown keys are kept: the parse checks the shape the game reads and returns the object as it was.
 * The runtime's Scene is made from it by load.ts (sceneOf); what play does with it is beats.ts's.
 */

/** A scene file's extension. */
export const SCENE_EXTENSION = ".kmscene";

export interface SceneDocument {
  format: "kingmaker";
  version: 2;
  kind: "scene";
  /** The scene's id: a slug, the file's name without .kmscene. Game state keys on it; never rename a played scene. */
  id: string;
  title: string;
  /** One line for listings and the map ("A palace clerk hanged behind the granary, two foul-mouthed kids…"). */
  description: string;
  /** Lore notes about this place and its world (paths under the campaign's lore/): the GM's always-in docs. */
  lore: string[];

  // ---- When and where (the story and the map) ----
  time?: TimeOfDay;
  /** The place's key: places/<key>.json, the world the stage manager keeps (areas, things, who stands where). */
  place?: string;
  /** Downtime between scenes, standing in for the map (the story skips it). */
  interlude?: boolean;
  rest?: "short" | "long";
  milestone?: boolean;

  // ---- The prep (prose, GM-facing unless it says otherwise) ----
  /** What the player knows walking in: player-facing (the map's lead, the between-scenes card). */
  hook: string;
  /** Where and when, in sensory detail. */
  setting: string;
  /** The dramatic question the scene answers, in a line. */
  premise: string;
  /** What really happened, behind the screen: never said outright, it comes out through the beats' paths. */
  truth: string;
  /** What happens if the player dawdles (the dead-cart at noon): the pressure, its outer limit, and how it's felt coming, a step nearer each exchange and never the same sign twice (Hep's count falls each time she calls it). */
  clock?: string;
  /** Tempting things that don't exist or can't work here, so the GM can say "no, but" honestly. */
  limits?: string[];
  /** What any local knows and a newcomer wouldn't (customs, prices, common talk). Never a secret. */
  known?: string[];

  cast: CastMember[];
  /** Fact ids → the sentence the GM is told when the fact is settled (by a beat or a route). Effects test them (if/unless established). */
  facts?: Record<string, string>;

  // ---- Story wiring (unchanged from the campaign format before it) ----
  /** Facts carried in from earlier scenes. */
  background?: string[];
  /** What the prep takes for granted, and where the story goes instead if play has overtaken it. */
  assumes?: string[];
  overtaken?: string;
  /** Effects as the scene comes into the story, before it's played (the hanged clerk's quest, started as the game begins): as the lead the player is heading for, or opened at once with none. */
  onStart?: Effect[];
  /** Effects on every ending, before the ending's own (Kell walks with the player after the granary). */
  onEnd?: Effect[];
  /** World ops applied to the place as the scene ends, whatever the ending (the body taken away). */
  afterwards?: WorldOpData[];
  /** The GM-only fronts doc for this scene's world. */
  fronts?: string;
  /** A talk's: the companion's cast id (only in the talk template). */
  companion?: string;

  nodes: SceneNode[];
  edges: Route[];
}

export interface CastMember {
  /** A slug; the GM sees it in square brackets. */
  id: string;
  name: string;
  /** What the player calls them until they've heard the name ("the boy in the too-big boots"). */
  called?: string;
  aka?: string[];
  /** Their lore note in the campaign's lore/ (Cast/Cob/public.md): the plugin links it, the GM's memory lives beside it. */
  lore?: string;
  /** Appearance and manner, for narration. */
  look: string;
  voice: string;
  wants: string;
  fears?: string;
  /** Why they're in this scene, now. */
  whyHere: string;
  /** What they know and will share when it makes sense. */
  knows: string[];
  /**
   * What they keep back. For each: how it shows, what pulls them both ways,
   * what opens it, and the first thing they'd say.
   */
  secrets?: string[];
  /** How they meet the player, and what moves them either way. */
  attitude: string;
  /** What never works on them and what they never do ("coin buys boasts, not trust; he never names the big man"). */
  limits?: string;
  /**
   * The co-GM's palette for their conversation role (the user's pacing ladder):
   * - how they're characterised;
   * - the inconsistency that invites a question;
   * - the hooks they offer.
   * The clues they can give are the beats' paths `via` them.
   */
  roles?: { characterise?: string; inconsistency?: string; hooks?: string };
  /** The node where they arrive (an event beat); present from the start when omitted. */
  enters?: string;
  /** A group voiced through its leader, and its members (as before). */
  group?: string;
  members?: Array<{ id: string; name: string; statblock?: string; weapon?: string; look?: string }>;
  /** Rules stats when the rules need them: an SRD statblock id and weapon id. */
  statblock?: string;
  weapon?: string;
}

/** A node of the graph: `{ id, type: "story", position: {x, y}, data }`, its id a slug unique in the scene. */
export interface SceneNode<D extends NodeData = NodeData> {
  id: string;
  type: "story";
  position: { x: number; y: number };
  data: D;
}

export type NodeData = StartData | BeatData | EndingData;

/** Where the scene opens. There's exactly one. It is always "reached", so its routes are open all scene long. */
export interface StartData {
  kind: "start";
  title: string;
  /**
   * The opening:
   * - the situation the player walks into;
   * - the suggested ways into it;
   * - how to play the people here;
   * - an opening image.
   */
  description: string;
  /** Each person's conversation role at the start (the co-GM's first note). */
  cast?: Record<string, string>;
  lore: string[];
}

/**
 * A beat. It is one of two kinds:
 * - With a `revelation`, it's a discovery: something the player can come to understand,
 *   in any order with the others, by any of its paths.
 * - Without one, it's an event: a turn the scene takes (the dead-cart arrives), and the
 *   scene's new situation from then on.
 */
export interface BeatData {
  kind: "beat";
  title: string;
  /** What the beat is for and how to play it. For an event: what happens and what it puts to the player. */
  description: string;
  /** A discovery's: what the player comes to understand, in a sentence or two. */
  revelation?: string;
  /** A discovery's suggested revelation paths: examples, not a sequence. Other plausible ways count too. */
  paths?: Path[];
  /** The scene can't end well without it (the lead to the next scene). Give it at least three paths, at least one needing no dice. */
  required?: boolean;
  /** Fact ids settled when the beat is reached. */
  establishes?: string[];
  /**
   * When the rest of the story needs it too:
   * - what it opens up;
   * - what later needs it;
   * - the things in the place it's in.
   * Missed, the story owes it the player in the next scene that can hold it.
   */
  carry?: { unlocks: string; later?: string; things?: string[] };
  /** An event's: each person's conversation role while the scene is here (the co-GM's suggestions). */
  cast?: Record<string, string>;
  /** An event's: what the world does if it stalls here. */
  pressure?: string;
  lore: string[];
}

/** How strong a path's clue is as evidence. */
export const STRENGTHS = ["hook", "suggestive", "strong", "proof"] as const;

/** One way a discovery can come out. */
export interface Path {
  /** Who or what holds it: a cast id, or a thing or place in a few words ("the body", "the tally loft"). */
  via: string;
  /** What's there to find or hear, concretely. */
  clue: string;
  /** What earns it: free to a look, a kindness, a promise, getting up there, a roll. An approach that needs no dice says so up front ("No dice: free to anyone who looks up"); where the path's check is for another approach, the free ones come first and the roll after them. */
  earn: string;
  /** What it amounts to as evidence. */
  strength: typeof STRENGTHS[number];
  /** A roll that suits the attempt (the mouthpiece uses it when the player tries this path and the outcome is uncertain). */
  check?: { skill: Skill; dc: number };
}

/** How an ending went for the player. */
export const RESULTS = ["good", "mixed", "bad"] as const;
export const EXIT_KINDS: readonly ExitKind[] = ["combat", "persuaded", "progress", "leave", "other"];

/** An ending. The scene closes on it with the next reply (which may wait once). */
export interface EndingData {
  kind: "exit";
  title: string;
  /** What is true if the scene ends this way. */
  description: string;
  /** How the GM should close it: the feeling, the last image. */
  closing: string;
  /** How it went for the player: a good ending, a mixed one, or a bad one. QA counts good and mixed endings reachable. */
  result: typeof RESULTS[number];
  /** The story's kind of ending (combat ends in a fight, before the scene picks up again). */
  exitKind: ExitKind;
  /** The scene the story goes on to (an interlude or a scene id). None at the story's end. */
  next?: string;
  /** What ending this way does to the story and the world (quests, flags, attitudes, memories, journal, follow, promises, world ops). */
  effects?: Effect[];
  lore: string[];
}

/** A route (an edge of the graph): how the scene moves from a node it has reached to another. */
export interface Route {
  /** A slug, unique in the scene. The co-GM sees it in square brackets and moves the scene by it. */
  id: string;
  /** Node ids: the start, a beat, an ending. */
  source: string;
  target: string;
  type: "smoothstep";
  /** The route's name on the graph. */
  label: string;
  data: {
    /**
     * What has to have happened in the story to take it, in prose.
     * Into a discovery it may be empty: the route is taken when the revelation has landed.
     * Into a bad or mixed ending that could be true at the same moment as a good one's, say it gives way to
     * that one, by its id ("...: that's [let-him-go]"); a cue into an ending says what has it no longer needed
     * ("Not needed once ...").
     */
    condition: string;
    /**
     * - "outcome": judged on what has happened (the default).
     * - "cue": a moment (the noon bell, the player setting off) that the co-GM
     *   brings about when it comes.
     */
    phase: "outcome" | "cue";
    /** Beats that must have been reached first (the endings' evidence, the lead). The runtime refuses the route until they are. */
    requires?: string[];
    /**
     * The dice decide it: when the player attempts what the condition says, the
     * mouthpiece calls this check. Success takes the route; failure goes to
     * `onFailure`, or leaves the scene where it is. Empty: no dice.
     */
    skill: Skill | "";
    dc: number;
    onFailure?: string;
    /** Fact ids settled when it's taken. */
    establishes?: string[];
    /**
     * A cue's outer limit: its moment comes by then, whatever else is happening. Each count runs
     * from the scene's start, or from when the beat `after` was reached, and stops once a beat of
     * `until` is reached; the cue is overdue once a count still running has run out, whichever
     * runs out first (the eleventh bell: 15 exchanges into the scene, or 8 after Arlo's
     * challenge). The co-GM is told how far each has run, and an overdue cue is brought about,
     * but an ending whose condition has happened comes first, and a cue into a bad ending waits
     * on a good or mixed one under way.
     */
    limit?: OuterLimit[];
  };
}

/** One count of a cue's outer limit: so many exchanges from the scene's start, or from when `after` was reached, until a beat of `until` is. */
export interface OuterLimit { exchanges: number; after?: string; until?: string[] }

export const isStart = (n: SceneNode): n is SceneNode<StartData> => n.data.kind === "start";
export const isBeat = (n: SceneNode): n is SceneNode<BeatData> => n.data.kind === "beat";
export const isEnding = (n: SceneNode): n is SceneNode<EndingData> => n.data.kind === "exit";
/** A discovery: a beat with a revelation. */
export const isDiscovery = (n: SceneNode): n is SceneNode<BeatData> => isBeat(n) && n.data.revelation !== undefined;

// ---------------------------------------------------------------------------------------------
// The parse: the shape the game reads, and the references it follows (a route's ends, what it
// requires, where its failure goes, the facts a beat or a route settles). The rules an author is
// held to beyond these (ids as slugs, reachability, three paths for what's required, effects) are
// the campaign check's (hosts/dev/campaign.ts).

/** A scene file that doesn't parse: every problem, each naming where it is. */
export class SceneFormatError extends Error {
  readonly where: string;
  readonly problems: string[];
  constructor(where: string, problems: string[]) {
    super(`${where}: ${problems.slice(0, 4).join("; ")}${problems.length > 4 ? `; and ${problems.length - 4} more` : ""}`);
    this.name = "SceneFormatError";
    this.where = where;
    this.problems = problems;
  }
}

/** A .kmscene file's text as a scene, or a SceneFormatError (`where` names the file in its message). */
export function parseScene(text: string, where = "the scene"): SceneDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new SceneFormatError(where, [`it isn't JSON (${(e as Error).message})`]);
  }
  return sceneDocumentOf(value, where);
}

/** A parsed value as a scene: the same object, once it has the format's shape; else a SceneFormatError listing what's wrong. */
export function sceneDocumentOf(value: unknown, where = "the scene"): SceneDocument {
  const problems = shapeProblems(value);
  if (problems.length) throw new SceneFormatError(where, problems);
  return value as SceneDocument;
}

/** What's wrong with a value's shape as a scene, each problem naming where: [] when it's a scene. */
export function shapeProblems(value: unknown): string[] {
  if (!isObject(value)) return ["it isn't a JSON object"];
  const p: string[] = [];
  const d = value;
  if (d.format !== "kingmaker" || d.version !== 2 || d.kind !== "scene") p.push(`it isn't a scene of the kingmaker format, version 2 (format ${JSON.stringify(d.format)}, version ${JSON.stringify(d.version)}, kind ${JSON.stringify(d.kind)})`);
  if (!nonEmpty(d.id)) p.push("it has no id");
  for (const k of ["title", "description", "hook", "setting", "premise", "truth"]) if (typeof d[k] !== "string") p.push(`it has no ${k}`);
  stringList(d, "lore", p, "its ");
  if (d.time !== undefined && !TIMES.includes(d.time as TimeOfDay)) p.push(`its time ${JSON.stringify(d.time)} isn't one of ${TIMES.join(", ")}`);
  if (d.rest !== undefined && d.rest !== "short" && d.rest !== "long") p.push(`its rest ${JSON.stringify(d.rest)} isn't short or long`);
  for (const k of ["interlude", "milestone"]) if (d[k] !== undefined && typeof d[k] !== "boolean") p.push(`its ${k} isn't true or false`);
  for (const k of ["place", "clock", "overtaken", "fronts", "companion"]) if (d[k] !== undefined && typeof d[k] !== "string") p.push(`its ${k} isn't text`);
  for (const k of ["limits", "known", "background", "assumes"]) if (d[k] !== undefined) stringList(d, k, p, "its ");
  if (d.facts !== undefined && !(isObject(d.facts) && Object.values(d.facts).every(s => typeof s === "string"))) p.push("its facts aren't { id: sentence }");
  for (const k of ["onStart", "onEnd"]) if (d[k] !== undefined && !(Array.isArray(d[k]) && d[k].every(e => isObject(e) && typeof e.op === "string"))) p.push(`its ${k} isn't a list of { op, … }`);
  if (d.afterwards !== undefined && !(Array.isArray(d.afterwards) && d.afterwards.every(e => isObject(e) && typeof e.op === "string" && nonEmpty(e.what)))) p.push("its afterwards isn't a list of { op, what, … }");

  const cast = Array.isArray(d.cast) ? d.cast : (p.push("it has no cast list"), []);
  const castIds = new Set<string>();
  cast.forEach((c, i) => {
    const at = `cast[${i}]${isObject(c) && typeof c.id === "string" ? ` (${c.id})` : ""}`;
    if (!isObject(c)) return p.push(`${at} isn't an object`);
    if (!nonEmpty(c.id)) p.push(`${at} has no id`);
    else if (castIds.has(c.id)) p.push(`${at}: the cast id ${c.id} is there twice`);
    else castIds.add(c.id);
    for (const k of ["name", "look", "voice", "wants", "whyHere", "attitude"]) if (typeof c[k] !== "string") p.push(`${at} has no ${k}`);
    stringList(c, "knows", p, `${at}'s `);
    for (const k of ["called", "lore", "fears", "limits", "enters", "group", "statblock", "weapon"]) if (c[k] !== undefined && typeof c[k] !== "string") p.push(`${at}'s ${k} isn't text`);
    for (const k of ["aka", "secrets"]) if (c[k] !== undefined) stringList(c, k, p, `${at}'s `);
    if (c.roles !== undefined && !(isObject(c.roles) && Object.values(c.roles).every(r => typeof r === "string"))) p.push(`${at}'s roles aren't { characterise, inconsistency, hooks } as text`);
    if (c.members !== undefined && !(Array.isArray(c.members) && c.members.every(m => isObject(m) && nonEmpty(m.id) && typeof m.name === "string"))) p.push(`${at}'s members aren't a list of { id, name, … }`);
  });

  const nodes = Array.isArray(d.nodes) ? d.nodes : (p.push("it has no nodes list"), []);
  const kinds = new Map<string, string>();
  nodes.forEach((n, i) => {
    const at = `nodes[${i}]${isObject(n) && typeof n.id === "string" ? ` (${n.id})` : ""}`;
    if (!isObject(n)) return p.push(`${at} isn't an object`);
    if (!nonEmpty(n.id)) p.push(`${at} has no id`);
    else if (kinds.has(n.id)) p.push(`${at}: the node id ${n.id} is there twice`);
    if (n.type !== "story") p.push(`${at}'s type isn't "story"`);
    if (!(isObject(n.position) && typeof n.position.x === "number" && typeof n.position.y === "number")) p.push(`${at} has no position { x, y }`);
    const data = n.data;
    if (!isObject(data) || !["start", "beat", "exit"].includes(data.kind as string)) return p.push(`${at}'s data.kind isn't start, beat or exit`);
    if (nonEmpty(n.id) && !kinds.has(n.id)) kinds.set(n.id, data.kind as string);
    p.push(...nodeProblems(data, `${at}: `));
  });
  const starts = [...kinds.values()].filter(k => k === "start").length;
  if (starts !== 1) p.push(`it has ${starts} start nodes, not one`);

  const facts = isObject(d.facts) ? d.facts : {};
  const settles = (ids: unknown, at: string) => {
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string" && !(id in facts)) p.push(`${at} establishes ${id}, which isn't one of its facts`);
  };
  nodes.forEach((n, i) => { if (isObject(n) && isObject(n.data)) settles(n.data.establishes, `nodes[${i}] (${String(n.id)})`); });

  const edges = Array.isArray(d.edges) ? d.edges : (p.push("it has no edges list"), []);
  const edgeIds = new Set<string>();
  edges.forEach((e, i) => {
    const at = `edges[${i}]${isObject(e) && typeof e.id === "string" ? ` (${e.id})` : ""}`;
    if (!isObject(e)) return p.push(`${at} isn't an object`);
    if (!nonEmpty(e.id)) p.push(`${at} has no id`);
    else if (edgeIds.has(e.id)) p.push(`${at}: the route id ${e.id} is there twice`);
    else edgeIds.add(e.id);
    for (const end of ["source", "target"]) if (!kinds.has(e[end] as string)) p.push(`${at}'s ${end} ${JSON.stringify(e[end])} isn't a node of the scene`);
    if (e.type !== "smoothstep") p.push(`${at}'s type isn't "smoothstep"`);
    if (typeof e.label !== "string") p.push(`${at} has no label`);
    const data = e.data;
    if (!isObject(data)) return p.push(`${at} has no data`);
    if (typeof data.condition !== "string") p.push(`${at} has no condition`);
    if (data.phase !== "outcome" && data.phase !== "cue") p.push(`${at}'s phase ${JSON.stringify(data.phase)} isn't outcome or cue`);
    if (data.skill !== "" && !SKILLS.includes(data.skill as Skill)) p.push(`${at}'s skill ${JSON.stringify(data.skill)} isn't a skill (or "" for no dice)`);
    if (typeof data.dc !== "number") p.push(`${at} has no dc`);
    if (data.requires !== undefined) {
      stringList(data, "requires", p, `${at}'s `);
      if (Array.isArray(data.requires)) for (const r of data.requires) if (typeof r === "string" && !kinds.has(r)) p.push(`${at} requires ${r}, which isn't a node of the scene`);
    }
    if (data.onFailure !== undefined && !kinds.has(data.onFailure as string)) p.push(`${at}'s onFailure ${JSON.stringify(data.onFailure)} isn't a node of the scene`);
    if (data.establishes !== undefined) stringList(data, "establishes", p, `${at}'s `);
    settles(data.establishes, at);
    if (data.limit !== undefined) p.push(...limitProblems(data.limit, kinds, at));
  });
  return p;
}

/** A route's outer limit: a list of counts, each a whole number of exchanges from the start or a node of the scene, until nodes of the scene. */
function limitProblems(limit: unknown, kinds: Map<string, string>, at: string): string[] {
  if (!Array.isArray(limit)) return [`${at}'s limit isn't a list of { exchanges, after?, until? }`];
  const p: string[] = [];
  limit.forEach((count, i) => {
    const where = `${at}'s limit[${i}]`;
    if (!isObject(count)) return p.push(`${where} isn't an object`);
    if (!(Number.isInteger(count.exchanges) && (count.exchanges as number) > 0)) p.push(`${where} has no whole number of exchanges`);
    if (count.after !== undefined && !kinds.has(count.after as string)) p.push(`${where} counts after ${JSON.stringify(count.after)}, which isn't a node of the scene`);
    if (count.until !== undefined) {
      stringList(count, "until", p, `${where}'s `);
      if (Array.isArray(count.until)) for (const u of count.until) if (typeof u === "string" && !kinds.has(u)) p.push(`${where} counts until ${u}, which isn't a node of the scene`);
    }
  });
  return p;
}

/** A node's data: what its kind has, each field of the type it should be. */
function nodeProblems(data: Record<string, unknown>, at: string): string[] {
  const p: string[] = [];
  for (const k of ["title", "description"]) if (typeof data[k] !== "string") p.push(`${at}it has no ${k}`);
  stringList(data, "lore", p, at);
  const notes = (k: string) => {
    if (data[k] !== undefined && !(isObject(data[k]) && Object.values(data[k]).every(v => typeof v === "string"))) p.push(`${at}its ${k} notes aren't { cast id: note }`);
  };
  if (data.kind === "start") notes("cast");
  if (data.kind === "beat") {
    notes("cast");
    for (const k of ["revelation", "pressure"]) if (data[k] !== undefined && typeof data[k] !== "string") p.push(`${at}its ${k} isn't text`);
    if (data.required !== undefined && typeof data.required !== "boolean") p.push(`${at}its required isn't true or false`);
    if (data.establishes !== undefined) stringList(data, "establishes", p, at);
    const carry = data.carry;
    if (carry !== undefined && !(isObject(carry) && typeof carry.unlocks === "string" && (carry.later === undefined || typeof carry.later === "string")
      && (carry.things === undefined || (Array.isArray(carry.things) && carry.things.every(t => typeof t === "string"))))) p.push(`${at}its carry isn't { unlocks, later?, things? }`);
    if (data.paths !== undefined) {
      if (!Array.isArray(data.paths)) p.push(`${at}its paths aren't a list`);
      else data.paths.forEach((path, i) => p.push(...pathProblems(path, `${at}paths[${i}] `)));
    }
  }
  if (data.kind === "exit") {
    if (typeof data.closing !== "string") p.push(`${at}it has no closing`);
    if (!RESULTS.includes(data.result as typeof RESULTS[number])) p.push(`${at}its result ${JSON.stringify(data.result)} isn't good, mixed or bad`);
    if (!EXIT_KINDS.includes(data.exitKind as ExitKind)) p.push(`${at}its exitKind ${JSON.stringify(data.exitKind)} isn't one of ${EXIT_KINDS.join(", ")}`);
    if (data.next !== undefined && !nonEmpty(data.next)) p.push(`${at}its next isn't a scene id`);
    if (data.effects !== undefined && !(Array.isArray(data.effects) && data.effects.every(e => isObject(e) && typeof e.op === "string"))) p.push(`${at}its effects aren't a list of { op, … }`);
  }
  return p;
}

function pathProblems(path: unknown, at: string): string[] {
  if (!isObject(path)) return [`${at}isn't an object`];
  const p: string[] = [];
  for (const k of ["via", "clue", "earn"]) if (typeof path[k] !== "string") p.push(`${at}has no ${k}`);
  if (!STRENGTHS.includes(path.strength as typeof STRENGTHS[number])) p.push(`${at}has strength ${JSON.stringify(path.strength)}, not one of ${STRENGTHS.join(", ")}`);
  const check = path.check;
  if (check !== undefined && !(isObject(check) && SKILLS.includes(check.skill as Skill) && typeof check.dc === "number")) p.push(`${at}has a check that isn't { skill, dc }`);
  return p;
}

const TIMES: TimeOfDay[] = ["morning", "afternoon", "evening", "night", "next-morning"];

function stringList(o: Record<string, unknown>, key: string, p: string[], at: string): void {
  const v = o[key];
  if (!Array.isArray(v) || !v.every(s => typeof s === "string")) p.push(`${at}${key} isn't a list of text`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
