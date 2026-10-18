import { endingsOf, type Loose } from "./scenes.ts";

/**
 * A scene's prep as the GM had it, for a blind reviewer: the runtime scene the AI service loaded
 * (scenes.ts), written out as Markdown. It reads the scene loosely and shows what's there: today's
 * scenes (the setting, the people's cards, the beats with their routes and checks, the essentials,
 * the endings) and the M2 format's when a scene has them (the truth behind it, the clock, a
 * discovery's revelation and its paths, the people's roles, graded endings, routes as a list of
 * their own). A field it doesn't know but that's prose is shown at the end, so nothing the GM was
 * given is left out because the format moved on.
 */
export function prepText(scene: Loose): string {
  return [
    heading(scene),
    theScene(scene),
    theOpening(scene),
    thePeople(scene),
    theBeats(scene),
    theAnytime(scene),
    theRoutes(scene),
    theEssentials(scene),
    theEndings(scene),
    theFacts(scene),
    theRest(scene),
  ].filter(Boolean).join("\n\n");
}

/** The fields shown by a part above (or, like a scene's world, not prep): theRest leaves them. */
const SHOWN = new Set([
  "id", "title", "summary", "description", "setting", "premise", "truth", "clock", "hook", "opening", "background", "assumes", "overtaken",
  "limits", "known", "cast", "start", "beats", "anytime", "routes", "edges", "nodes", "essentials", "exits", "facts", "lore", "fronts",
  "world", "afterwards", "onEnd", "kind", "time", "place", "interlude", "rest", "milestone", "anchors", "companion", "createsCharacter", "format", "version",
]);

// ---------------------------------------------------------------------------------------------
// The parts

function heading(scene: Loose): string {
  const about = str(scene.summary) ?? str(scene.description);
  return `# The prep: ${str(scene.title) ?? str(scene.id)}${about ? `\n\n${about}` : ""}`;
}

function theScene(scene: Loose): string {
  return section("The scene", [
    para("Setting", scene.setting),
    para("Premise", scene.premise),
    para("What really happened (never told outright: it comes out through the beats)", scene.truth),
    para("The clock", scene.clock),
    list("Carried in from earlier scenes", scene.background),
    list("What it takes for granted about the story so far", scene.assumes),
    para("Where the story goes instead if play has overtaken it", scene.overtaken),
    list("What the world can't offer here", scene.limits),
    list("What anyone here knows (never a secret)", scene.known),
  ]);
}

function theOpening(scene: Loose): string {
  return section("The opening", [str(scene.opening)]);
}

function thePeople(scene: Loose): string {
  return section("The people", objs(scene.cast).map(person));
}

function person(c: Loose): string {
  const roles = rec(c.roles);
  const who = [
    str(c.called) ? `Called “${str(c.called)}” until the player hears the name.` : undefined,
    strs(c.aka).length ? `Also known as ${strs(c.aka).join(", ")}.` : undefined,
    str(c.enters) ? `Arrives with [${str(c.enters)}].` : undefined,
    str(c.group) ? `A group: ${str(c.group)}.` : undefined,
  ].filter(Boolean).join(" ");
  return [
    `### ${str(c.name) ?? str(c.id)} [${str(c.id)}]`,
    who,
    bullets([
      field("Look", c.look), field("Voice", c.voice), field("Wants", c.wants), field("Fears", c.fears), field("Why here", c.whyHere),
      nested("Knows", c.knows), nested("Keeps back", c.secrets), field("Attitude", c.attitude), field("Never", c.limits),
      Object.keys(roles).length ? `**Their part in the talk (the co-GM's palette):** ${Object.entries(roles).map(([k, v]) => `${k}: ${v}`).join("; ")}` : undefined,
    ]),
  ].filter(Boolean).join("\n");
}

function theBeats(scene: Loose): string {
  const start = str(scene.start);
  return section("The beats", objs(scene.beats).map(b => beat(b, b.id === start)));
}

function beat(b: Loose, start: boolean): string {
  const required = b.required === true ? " (the scene can't end well without it)" : "";
  return [
    `### [${str(b.id)}] ${str(b.title) ?? ""}${start ? ": where it starts" : ""}`,
    str(b.direction) ?? str(b.description),
    para(`What the player can come to understand${required}`, b.revelation),
    objs(b.paths).length ? `**Ways it can come out (examples, not a sequence):**\n${bullets(objs(b.paths).map(path))}` : undefined,
    b.carry ? para("The story needs it later", carried(b.carry as Loose)) : undefined,
    notes("The people here", b.cast),
    para("If the scene stalls here", b.pressure),
    list("Settles", b.establishes),
    objs(b.transitions).length ? `**Routes on from here:**\n${bullets(objs(b.transitions).map(transition))}` : undefined,
  ].filter(Boolean).join("\n\n");
}

function path(p: Loose): string {
  const check = p.check as Loose | undefined;
  return joined([
    `via ${str(p.via)}: ${str(p.clue)}`,
    str(p.earn) ? `Earned by: ${str(p.earn)}` : undefined,
    str(p.strength) ? `As evidence: ${str(p.strength)}` : undefined,
    check ? `A check that suits it: ${skill(check.skill)} DC ${String(check.dc)}` : undefined,
  ], ". ");
}

function carried(c: Loose): string {
  return [str(c.unlocks) ? `it opens up ${str(c.unlocks)}` : undefined, str(c.later), strs(c.things).length ? `in ${strs(c.things).join(", ")}` : undefined].filter(Boolean).join("; ");
}

/** A route out of a beat (today's transitions): when, how it's judged, where to, the check and what it settles. */
function transition(t: Loose): string {
  const check = t.check as Loose | undefined;
  const how = check
    ? `${skill(check.skill)} DC ${String(check.dc)}${str(check.reason) ? `, ${str(check.reason)}` : ""}: to [${str(check.onSuccess)}] on a success, ${str(check.onFailure) ? `[${str(check.onFailure)}]` : "staying here"} on a failure`
    : `to [${str(t.to)}]`;
  const extra = [
    t.given === true ? "only someone else can bring it about" : undefined,
    str(t.essential) ? `brings the essential [${str(t.essential)}]` : undefined,
    str(t.towards) ? `a way towards [${str(t.towards)}] that brings nothing out` : undefined,
    strs(t.establishes).length ? `settles: ${strs(t.establishes).join(" ")}` : undefined,
  ].filter(Boolean);
  const outcomes = check ? `\n  - On a success: ${str(check.success)}\n  - On a failure: ${str(check.failure)}` : "";
  return `[${str(t.id)}] (${str(t.on) ?? (check ? "attempt" : "outcome")}) ${how}. When: ${str(t.when)}${extra.length ? ` (${extra.join("; ")})` : ""}${outcomes}`;
}

function theAnytime(scene: Loose): string {
  return section("From any beat", objs(scene.anytime).length ? [bullets(objs(scene.anytime).map(transition))] : []);
}

/** A route list of the scene's own (the M2 format's edges): from where to where, on what, needing what first, the check. */
function theRoutes(scene: Loose): string {
  const routes = [...objs(scene.routes), ...objs(scene.edges)];
  return section("The routes", routes.length ? [bullets(routes.map(route))] : []);
}

function route(r: Loose): string {
  const d = { ...r, ...(r.data as Loose | undefined ?? {}) };
  return joined([
    `[${str(d.id)}] ${str(d.source) ?? "?"} → ${str(d.target) ?? "?"}${str(d.label) ? ` (${str(d.label)})` : ""}`,
    str(d.phase) ? `on ${str(d.phase)}` : undefined,
    str(d.condition) ? `when ${str(d.condition)}` : undefined,
    strs(d.requires).length ? `needing first ${strs(d.requires).map(x => `[${x}]`).join(", ")}` : undefined,
    str(d.skill) ? `${skill(d.skill)} DC ${String(d.dc)}${str(d.onFailure) ? `, to [${str(d.onFailure)}] on a failure` : ""}` : undefined,
    strs(d.establishes).length ? `settles ${strs(d.establishes).join(", ")}` : undefined,
  ], "; ");
}

function theEssentials(scene: Loose): string {
  return section("What the player needs to come across", objs(scene.essentials).map(e => [
    `- [${str(e.id)}] ${str(e.what)}`,
    strs(e.placedWith).length ? `  - Placed with: ${strs(e.placedWith).join("; ")}` : undefined,
    strs(e.carriers).length ? `  - Carried by: ${strs(e.carriers).join(", ")}` : undefined,
    str(e.unlocks) ? `  - Unlocks: ${str(e.unlocks)}` : undefined,
    str(e.later) ? `  - Later: ${str(e.later)}` : undefined,
    str(e.missed) ? `  - This scene's own prep for ${str(e.missed)}, if it was missed there` : undefined,
  ].filter(Boolean).join("\n")));
}

function theEndings(scene: Loose): string {
  const graded = new Map(endingsOf(scene).map(e => [e.id, e]));
  const exits: Loose[] = [...objs(scene.exits), ...objs(scene.nodes).filter(n => (n.data as Loose | undefined)?.kind === "exit").map(n => ({ ...(n.data as Loose), id: n.id }))];
  return section("The endings", exits.map(e => {
    const ending = graded.get(str(e.id) ?? "");
    const how = [ending?.grade ?? "not graded", ending?.kind, str(e.next) ? `on to ${str(e.next)}` : "the story's end"].filter(Boolean).join("; ");
    return [
      `### [${str(e.id)}] ${str(e.title) ?? ""} (${how})`,
      para("What's true", e.outcome ?? e.description),
      para("How to close it", e.closing),
      strs(e.requires).length ? `**Needs first:** ${strs(e.requires).map(x => `[${x}]`).join(", ")}` : undefined,
    ].filter(Boolean).join("\n\n");
  }));
}

function theFacts(scene: Loose): string {
  const facts = rec(scene.facts);
  return section("Facts that can be settled", Object.keys(facts).length ? [bullets(Object.entries(facts).map(([id, text]) => `[${id}] ${text}`))] : []);
}

/** Prose the scene has that no part above shows: under its own name. */
function theRest(scene: Loose): string {
  const rest = Object.entries(scene).filter(([key, v]) => !SHOWN.has(key) && (str(v) || strs(v).length));
  return section("More of the prep", rest.map(([key, v]) => (str(v) ? para(key, v) : list(key, v))));
}

// ---------------------------------------------------------------------------------------------
// Reading loosely, and writing Markdown

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const objs = (v: unknown): Loose[] => (Array.isArray(v) ? v.filter((x): x is Loose => !!x && typeof x === "object") : []);
const rec = (v: unknown): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Loose).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
const skill = (v: unknown) => (str(v) ?? "?").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

/** A titled section of the parts that have something in them; nothing when none do. */
function section(title: string, parts: Array<string | undefined>): string {
  const body = parts.filter(Boolean);
  return body.length ? `## ${title}\n\n${body.join("\n\n")}` : "";
}

function para(label: string, v: unknown): string | undefined {
  return str(v) ? `**${label}.** ${str(v)}` : undefined;
}

function list(label: string, v: unknown): string | undefined {
  return strs(v).length ? `**${label}:**\n${bullets(strs(v))}` : undefined;
}

function field(label: string, v: unknown): string | undefined {
  return str(v) ? `**${label}:** ${str(v)}` : undefined;
}

function nested(label: string, v: unknown): string | undefined {
  return strs(v).length ? `**${label}:**\n${strs(v).map(x => `  - ${x}`).join("\n")}` : undefined;
}

function notes(label: string, v: unknown): string | undefined {
  const r = rec(v);
  return Object.keys(r).length ? `**${label}:**\n${bullets(Object.entries(r).map(([k, x]) => `${k}: ${x}`))}` : undefined;
}

/** Parts joined with `by`, each part's own full stop taken off so none doubles up. */
const joined = (parts: Array<string | undefined>, by: string) => parts.filter((p): p is string => !!p).map(p => p.replace(/\.$/, "")).join(by);

const bullets = (items: Array<string | undefined>) => items.filter(Boolean).map(i => `- ${i}`).join("\n");
