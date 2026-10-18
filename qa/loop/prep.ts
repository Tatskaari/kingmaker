import { routeLine } from "../../ai/gm/two-part.ts";
import { titleCase } from "../../shared/dice.ts";
import { enteringAt, isDiscovery, isEvent } from "../../shared/scene/beats.ts";
import type { Path } from "../../shared/scene/document.ts";
import type { Beat, Character, Exit, Scene, SceneRoute } from "../../shared/scene/types.ts";
import { endingsOf, type Ending } from "./scenes.ts";

/**
 * A scene's prep as the GM had it, for a blind reviewer: the runtime scene the AI service loaded
 * from its .kmscene file (scenes.ts), written out as Markdown in the order the two-part GM's prep
 * has it (docs/two-part-design.md, ai/gm/two-part.ts prepOf and charactersOf):
 * - the scene: its setting and premise, what really happened, its clock, what it can't offer;
 * - where it starts, with each person's part as it opens (the co-GM's first roles);
 * - the people, each card with why they're here, what never works on them and their role palette;
 * - the discoveries, each with its revelation, its paths and the routes into it;
 * - the events, each with what it does if it stalls, who arrives, each person's part and the routes
 *   into it (a cue among them);
 * - the endings, each with its result, what's true, how to close it and the routes into it with
 *   what they need reached first;
 * - the facts a beat or a route settles.
 * Each route reads as the GM read it (routeLine), under the node it goes to. Prose the scene has that
 * no part shows is put at the end under its own name, so nothing the GM was given goes unshown if
 * the format grows.
 */
export function prepText(scene: Scene): string {
  return [
    heading(scene),
    theScene(scene),
    whereItStarts(scene),
    thePeople(scene),
    theDiscoveries(scene),
    theEvents(scene),
    theEndings(scene),
    theFacts(scene),
    theRest(scene),
  ].filter(Boolean).join("\n\n");
}

/**
 * The fields a part above shows, and those that aren't the GM's prep (the hook is what the player
 * was told, which the pack shows apart; the rest is the story's wiring, the place's world, the
 * copied code's views of the routes and the lore's paths): theRest leaves them.
 */
const SHOWN = new Set<string>([
  "id", "title", "summary", "setting", "premise", "truth", "clock", "background", "assumes", "overtaken", "limits", "known",
  "hook", "opening", "start", "cast", "beats", "exits", "routes", "facts",
  "anytime", "essentials", "lore", "fronts", "world", "afterwards", "onEnd", "time", "interlude", "rest", "milestone", "anchors", "companion", "createsCharacter",
]);

// ---------------------------------------------------------------------------------------------
// The parts

function heading(scene: Scene): string {
  return `# The prep: ${scene.title}${scene.summary ? `\n\n${scene.summary}` : ""}`;
}

function theScene(scene: Scene): string {
  return section("The scene", [
    para("Setting", scene.setting),
    para("Premise", scene.premise),
    para("What really happened (never told outright: it comes out through the discoveries' paths)", scene.truth),
    para("The clock", scene.clock),
    list("Carried in from earlier scenes", scene.background),
    list("What it takes for granted about the story so far", scene.assumes),
    para("Where the story goes instead if play has overtaken it", scene.overtaken),
    list("What the world can't offer here", scene.limits),
    list("What any local knows (never a secret)", scene.known),
  ]);
}

function whereItStarts(scene: Scene): string {
  const start = scene.beats.find(b => b.id === scene.start);
  if (!start) return section("Where it starts", [scene.opening]);
  return [
    `## Where it starts: ${start.title} [${start.id}]`,
    start.direction || scene.opening,
    partsOf(scene, "Each person's part as the scene opens (the co-GM's first roles)", start.cast),
  ].filter(Boolean).join("\n\n");
}

function thePeople(scene: Scene): string {
  return section("The people", scene.cast.map(c => person(scene, c)));
}

function person(scene: Scene, c: Character): string {
  const arrives = c.enters ? scene.beats.find(b => b.id === c.enters) : undefined;
  const who = [
    c.called ? `Called “${c.called}” until the player hears the name.` : undefined,
    c.aka?.length ? `Also known as ${c.aka.join(", ")}.` : undefined,
    c.enters ? `Not here as it opens: arrives with ${arrives ? `${arrives.title} [${arrives.id}]` : `[${c.enters}]`}.` : undefined,
    c.group ? `A group: ${c.group}${c.members?.length ? ` (${c.members.map(m => m.name).join(", ")})` : ""}.` : undefined,
  ].filter(Boolean).join(" ");
  const palette = ([["How they're characterised", c.roles?.characterise], ["The inconsistency that invites a question", c.roles?.inconsistency], ["The hooks they offer", c.roles?.hooks]] as const)
    .flatMap(([label, v]) => (str(v) ? [`  - ${label}: ${str(v)}`] : []));
  return [
    `### ${c.name} [${c.id}]`,
    who || undefined,
    bullets([
      field("Look", c.look), field("Voice", c.voice), field("Wants", c.wants), field("Fears", c.fears), field("Why they're here, now", c.whyHere),
      nested("Knows", c.knows), nested("Keeps back", c.secrets), field("Attitude", c.attitude),
      field("What never works on them, and what they never do", c.limits),
      palette.length ? `**Their role palette (the co-GM's):**\n${palette.join("\n")}` : undefined,
    ]),
  ].filter(Boolean).join("\n");
}

function theDiscoveries(scene: Scene): string {
  const found = scene.beats.filter(isDiscovery);
  return section("The discoveries", found.length ? [
    "What the player can come to understand here, in any order, each by any of its paths: they're examples, not a sequence, and other plausible ways count too. One is reached when its revelation has landed with the player.",
    ...found.map(b => discovery(scene, b)),
  ] : []);
}

function discovery(scene: Scene, b: Beat): string {
  return [
    `### ${b.title} [${b.id}]${b.required ? " (required: the scene can't end well without it)" : ""}`,
    para("The revelation", b.revelation),
    b.direction,
    b.paths?.length ? `**Its paths:**\n${bullets(b.paths.map(p => pathLine(scene, p)))}` : undefined,
    b.carry ? para("The story needs it later", carried(b.carry)) : undefined,
    settles(scene, b.establishes),
    routesInto(scene, b.id),
  ].filter(Boolean).join("\n\n");
}

/** A path as the GM's prep words it: who or what holds it, how strong it is, the clue, what earns it, a check that suits it. */
function pathLine(scene: Scene, p: Path): string {
  return `Via ${nameOf(scene, p.via)} (${p.strength}): ${p.clue} What earns it: ${p.earn}${p.check ? ` A check that suits it: ${titleCase(p.check.skill)} DC ${p.check.dc}.` : ""}`;
}

function carried(c: NonNullable<Beat["carry"]>): string {
  return [`it opens up ${c.unlocks}`, c.later, c.things?.length ? `the things it's in: ${c.things.join(", ")}` : undefined].filter(Boolean).join("; ");
}

function theEvents(scene: Scene): string {
  const events = scene.beats.filter(b => isEvent(scene, b));
  return section("The events", events.length ? [
    "Turns the scene takes: each is the scene's new situation from then on, and whoever arrives with it comes on.",
    ...events.map(b => event(scene, b)),
  ] : []);
}

function event(scene: Scene, b: Beat): string {
  const arriving = enteringAt(scene, b.id);
  return [
    `### ${b.title} [${b.id}]`,
    b.direction,
    para("If it stalls here", b.pressure),
    arriving.length ? `**Who arrives:** ${arriving.map(c => `${c.name} [${c.id}]`).join(", ")}` : undefined,
    partsOf(scene, "Each person's part while the scene is here (the co-GM's suggested roles)", b.cast),
    settles(scene, b.establishes),
    routesInto(scene, b.id),
  ].filter(Boolean).join("\n\n");
}

function theEndings(scene: Scene): string {
  const graded = new Map(endingsOf(scene).map(e => [e.id, e]));
  return section("The endings", scene.exits.length ? [
    "The only ways this scene can end; the player's choices decide which. An ending is reached when a route into it is taken, and the scene closes on the reply after.",
    ...scene.exits.map(e => ending(scene, e, graded.get(e.id))),
  ] : []);
}

function ending(scene: Scene, e: Exit, graded: Ending | undefined): string {
  const how = [graded?.grade ? `a ${graded.grade} ending` : "not graded", e.kind, e.next ? `on to ${e.next}` : "the story's end"].join("; ");
  return [
    `### ${e.title} [${e.id}] (${how})`,
    para("What's true", e.outcome),
    para("How to close it", e.closing),
    routesInto(scene, e.id) ?? "**Routes into it:** none: the scene's prep has no way here.",
  ].filter(Boolean).join("\n\n");
}

function theFacts(scene: Scene): string {
  const facts = Object.entries(scene.facts ?? {});
  return section("Facts that can be settled", facts.length ? [bullets(facts.map(([id, text]) => `[${id}] ${text}`))] : []);
}

/** Prose the scene has that no part above shows: under its own name. */
function theRest(scene: Scene): string {
  const rest = Object.entries(scene as unknown as Record<string, unknown>).filter(([key, v]) => !SHOWN.has(key) && (str(v) || strs(v).length));
  return section("More of the prep", rest.map(([key, v]) => (str(v) ? para(key, v) : list(key, v))));
}

// ---------------------------------------------------------------------------------------------
// The parts' parts

/** The routes into a node, each as the GM read it, and the facts each settles. */
function routesInto(scene: Scene, id: string): string | undefined {
  const into = scene.routes.filter(r => r.target === id);
  return into.length ? `**Routes into it:**\n${into.map(r => `${routeLine(scene, r)}${routeSettles(scene, r)}`).join("\n")}` : undefined;
}

function routeSettles(scene: Scene, r: SceneRoute): string {
  return r.establishes?.length ? `\n  - Settles: ${r.establishes.map(id => `[${id}] ${scene.facts?.[id] ?? ""}`.trim()).join("; ")}` : "";
}

/** The facts a beat settles as it's reached, each by its id and sentence. */
function settles(scene: Scene, ids: string[] | undefined): string | undefined {
  return ids?.length ? `**Settles:**\n${bullets(ids.map(id => `[${id}] ${scene.facts?.[id] ?? ""}`.trim()))}` : undefined;
}

/** A stage's notes on each person's part (the start's and an event's cast), by name and id. */
function partsOf(scene: Scene, label: string, cast: Record<string, string> | undefined): string | undefined {
  const notes = Object.entries(cast ?? {});
  return notes.length ? `**${label}:**\n${bullets(notes.map(([id, note]) => `${nameOf(scene, id)}: ${note}`))}` : undefined;
}

/** One of the cast by name and id; anything else (a thing or a place a path is via) as the prep says it. */
function nameOf(scene: Scene, id: string): string {
  const c = scene.cast.find(x => x.id === id);
  return c ? `${c.name} [${c.id}]` : id;
}

// ---------------------------------------------------------------------------------------------
// Writing Markdown

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);

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

const bullets = (items: Array<string | undefined>) => items.filter(Boolean).map(i => `- ${i}`).join("\n");
