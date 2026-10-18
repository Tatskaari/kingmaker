// Copied from PR #666's src/runtime/two-part.ts at origin/claude/two-part-gm c749270: FORMAT and SCHEMA (the reply format), routeLine, mouthpieceInstructions, characters, mouthpieceInput with gmText, speak, movedDirective, the wind-down's words (twoPartTurn's), the co-GM's tools (UPDATE_ROLE, MOVE_SCENE, CO_GM_TOOLS), coGmInput and coGm, whole but at the seams docs/two-part-design.md names. It reads a TurnView (gm/view.ts) for the session. Where the scene is, is shared/scene/beats.ts's (its stage, the routes open, a route taken) in place of the beat and its transitions; the prep ({{beats}}) is the scene format's, rendered as the design orders it, in place of beatsBlock; {{characters}} has the cards' whyHere and limits too, and the co-GM's each person's role palette and the clues via them. speak doesn't roll: the check comes back with its five outcomes, and the simulation rolls it; the narration streams through the game's markup (who says each line) as it's written. The per-turn note is twoPartNow, nowNote's copy (brief.ts) with the open routes. The co-GM's moves are beats.ts's takeRoute on a copy of the request's bookkeeping, and its answer is the roles it set and the moves it made, for the simulation to make again. The speakers paragraph is gm.md's, appended after the format. The narration's names the player hasn't heard are swapped for what they'd call them before it's shown or kept (unheard.ts, QA round qa1-1018), and the per-turn note says what to call each of them (namesNote).

import { titleCase } from "../../shared/dice.ts";
import type { GmState, TwoPartRole } from "../../shared/gm/state.ts";
import { BANDS, type Band } from "../../shared/gm/two-part.ts";
import type { Markup } from "../../shared/markup.ts";
import type { CoGmAnswer, Reply, SpokenCheck, TurnCheck } from "../../shared/protocol/ai.ts";
import { enteringAt, isDiscovery, isEvent, openRoutes, reachedOf, stageOf, takeRoute, targetsOf, type RouteOutcome } from "../../shared/scene/beats.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import { SKILLS, type Character, type Exit, type Scene, type SceneRoute, type Skill } from "../../shared/scene/types.ts";
import { worldView } from "../../shared/world/scene-world.ts";
import { PHYSICS } from "../../shared/world/systems.ts";
import { respond, type CallContext, type Message } from "../llm/openrouter.ts";
import { runTools, type ToolDef } from "../llm/tools.ts";
import { prompt } from "../prompts/index.ts";
import { bullets, castBlock, OWED_PLACE, outOfSight, playerNow, sceneBrief, sceneEntries, scriptTranscript } from "./brief.ts";
import { FIGHT_CLOSE } from "./directives.ts";
import type { TurnView } from "./view.ts";
import { asKnown, unheardOf, type Unheard } from "./unheard.ts";
import { asWritten, readReply, streamed } from "./voice.ts";

/**
 * The GM in two parts (docs/two-part-design.md), for a scene of the story:
 * - The mouthpiece (ai/prompts/two-part-gm.md) voices the scene. Its instructions are the scene's
 *   prep and its people, and stay put for the scene; before each player turn a note from the co-GM
 *   gives every character's situation now and the role they play this turn, beside the per-turn note
 *   (where the scene is, the routes open, what's settled, the world, names not yet heard).
 * - It asks for a check when a roll should settle something, writing all five outcomes; the
 *   simulation rolls it with the player's own modifiers, and the outcome that came up is what the
 *   player reads.
 * - The co-GM (ai/prompts/two-part-co-gm.md) runs after each reply, beside the stage manager. It keeps
 *   each character's role (the stage's cast notes are its suggestions; what a character remembers,
 *   wants or owes can override them) and moves the scene on along its own routes, each move checked
 *   against the routes open now (beats.ts) before it's taken.
 */

const tone = () => prompt("tone-comic");

const FORMAT = `## How to reply
Reply as JSON with two fields.
- \`narration\`: what you say to the player this turn, with a blank line between paragraphs as usual.
- \`check\`: null on most turns. When the player attempts something whose outcome is uncertain and matters (seeing through a lie, winning someone over, a climb, a close look at something that hides a clue), and the roll would move the scene towards a beat, call for a skill check instead of deciding it yourself. Where your prep's routes say the dice decide something the player is trying, use that route's skill and DC. Then \`narration\` sets up the attempt and stops before the result, and \`check\` gives the skill, a DC (10 easy, 13 moderate, 15 hard, 18 very hard) and five outcomes. The game rolls the dice with the player's own modifiers, and the player sees your narration, the roll, and the one outcome that came up.
  Write each outcome as the next words of the reply, carrying straight on from the narration, in the same voice and length as any reply (the characters react, then stop for the player):
  - major_failure (missed by 5 or more): it goes wrong, with a cost: offence taken, a door shut for now, a wrong impression.
  - minor_failure (missed by 1 to 4): no progress, a small complication, and a hint of another way in.
  - barely_passed (made it, by 0 to 2): the next step, with a catch or only part of it.
  - minor_success (beat it by 3 to 6): the next step, cleanly.
  - major_success (beat it by 7 or more): the next step and a little more: the character warms, or a further hook opens.
  Even a major success gives only what the attempt could earn now: the next step for that character, never the whole of a secret.
- Don't roll or report numbers yourself, and don't ask the player to roll: the check is how you ask.`;

/** The speakers part of the game's markup, word for word from gm.md: the screen gives each person's lines their own colour. */
const SPEAKERS = `## Who says each line
Put the speaker in square brackets before every spoken line, each time they speak: [Kell] “Out.” She turns to the boy. [Kell] “You too.” Use their name, or what the player calls them until they've heard it ([the pie-seller] “Threepence, my lamb.”). The tag is for the screen: your prose still makes clear who's speaking.`;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["narration", "check"],
  properties: {
    narration: { type: "string" },
    check: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false, required: ["skill", "dc", "outcomes"],
      properties: {
        skill: { type: "string", enum: [...SKILLS] }, dc: { type: "integer" },
        outcomes: { type: "object", additionalProperties: false, required: [...BANDS], properties: Object.fromEntries(BANDS.map(b => [b, { type: "string" }])) },
      },
    }] },
  },
};

// --- The prep as the two parts see it ({{beats}}, {{characters}}) --------------------------------

/** A node's title, by its id. */
function titleOf(scene: Scene, id: string): string {
  return scene.beats.find(b => b.id === id)?.title ?? scene.exits.find(e => e.id === id)?.title ?? id;
}

const named = (scene: Scene, id: string) => `${titleOf(scene, id)} [${id}]`;
const listed = (scene: Scene, ids: string[]) => ids.map(id => named(scene, id)).join(ids.length === 2 ? " and " : ", ");

/**
 * A route as the prep and the co-GM's input put it, with its id (the co-GM's handle on it): where
 * it goes from and to, what it needs reached first, its dice or that it's a cue, then ". When: "
 * and what has to have happened. The fake model reads this line (ai/llm/fake-openrouter.ts).
 */
export function routeLine(scene: Scene, r: SceneRoute, options: { revelation?: boolean } = {}): string {
  const target = scene.beats.find(b => b.id === r.target);
  const needs = r.requires?.length ? `, once ${listed(scene, r.requires)} ${r.requires.length === 1 ? "is" : "are"} reached` : "";
  const how = r.skill
    ? `; the dice decide (${titleCase(r.skill)} DC ${r.dc}): a success takes it, a failure ${r.onFailure ? `goes to ${named(scene, r.onFailure)}` : "leaves the scene where it is"}`
    : r.phase === "cue" ? "; a cue: bring it about when its moment comes" : "";
  const discovery = !!target && isDiscovery(target);
  const when = r.condition.trim() || (discovery ? `its revelation has landed with the player${options.revelation && target.revelation ? ` (${target.revelation})` : ""}` : r.label);
  return `- [${r.id}] from ${named(scene, r.source)} to ${named(scene, r.target)}${needs}${how}. When: ${when}`;
}

/** The routes into a node, as the prep lists them under it. */
const routesInto = (scene: Scene, id: string) => scene.routes.filter(r => r.target === id).map(r => routeLine(scene, r));

/** The sections of the GM's prep (brief.ts sceneBrief) the two parts don't have: the people are the characters, the endings and what's needed are the beats', and the check is how the mouthpiece asks for dice. */
const NOT_HERE = ["## The people here", "## Ways this scene can end", "## What the player needs to come across", "## Table rules"];

/**
 * The prep ({{beats}}), in the design's order: the scene (setting, premise, truth, clock, background
 * and the story so far, the boundary's adjustments, limits, what locals know, the player), where it
 * starts, the discoveries, the events, the endings, and what's still owed from scenes already over.
 * The co-GM's has each stage's suggested roles too.
 */
export function prepOf(scene: Scene, view: TurnView, options: { coGm?: boolean } = {}): string {
  const sections = sceneBrief(scene, view).split(/\n\n(?=## )/).filter(s => !NOT_HERE.some(h => s.startsWith(h)));
  const about = sections.findIndex(s => s.startsWith("## What this scene is about"));
  sections.splice(about + 1, 0,
    ...(scene.truth ? [`## What really happened\nNever told outright: it comes out through the discoveries' paths.\n${scene.truth}`] : []),
    ...(scene.clock ? [`## The clock\n${scene.clock}`] : []));
  const player = sections.findIndex(s => s.startsWith("## The player character"));
  if (scene.known?.length) sections.splice(player, 0, `## What any local knows\nNever a secret: what anyone here knows and a newcomer wouldn't.\n${bullets(scene.known)}`);
  return [...sections, startOf(scene, options), discoveriesOf(scene), eventsOf(scene, options), endingsOf(scene), ...owedOf(scene, view)].join("\n\n");
}

/** A stage's suggested roles, for the co-GM: each person's cast note, by their name and id. */
function suggested(scene: Scene, cast: Record<string, string> | undefined): string[] {
  const notes = Object.entries(cast ?? {});
  return notes.length ? [`Suggested roles while the scene is here:\n${notes.map(([id, note]) => `- ${scene.cast.find(c => c.id === id)?.name ?? id} [${id}]: ${note}`).join("\n")}`] : [];
}

function startOf(scene: Scene, options: { coGm?: boolean }): string {
  const start = scene.beats.find(b => b.id === scene.start)!;
  return [`## Where it starts: ${start.title} [${start.id}]`, start.direction, ...(options.coGm ? suggested(scene, start.cast) : [])].join("\n");
}

function discoveriesOf(scene: Scene): string {
  const found = scene.beats.filter(isDiscovery);
  if (!found.length) return "## The discoveries\n(none)";
  return [
    "## The discoveries\nWhat the player can come to understand here, in any order, each by any of its paths: they're examples, not a sequence, and other plausible ways count too. One is reached when its revelation has landed with the player.",
    ...found.map(b => [
      `### ${b.title} [${b.id}]${b.required ? " (required: the scene can't end well without it)" : ""}`,
      `The revelation: ${b.revelation}`,
      b.direction,
      ...(b.paths?.length ? [`Its paths:\n${b.paths.map(p => `- Via ${via(scene, p.via)} (${p.strength}): ${p.clue} What earns it: ${p.earn}${p.check ? ` A check that suits it: ${titleCase(p.check.skill)} DC ${p.check.dc}.` : ""}`).join("\n")}`] : []),
      `Routes into it:\n${routesInto(scene, b.id).join("\n")}`,
    ].join("\n")),
  ].join("\n\n");
}

/** Who or what holds a path: one of the cast by name and id, or a thing or place as the prep says it. */
const via = (scene: Scene, id: string) => { const c = scene.cast.find(x => x.id === id); return c ? `${c.name} [${c.id}]` : id; };

function eventsOf(scene: Scene, options: { coGm?: boolean }): string {
  const events = scene.beats.filter(b => isEvent(scene, b));
  if (!events.length) return "## The events\n(none)";
  return [
    "## The events\nTurns the scene takes: each is the scene's new situation from then on.",
    ...events.map(b => {
      const arriving = enteringAt(scene, b.id);
      return [
        `### ${b.title} [${b.id}]`, b.direction,
        ...(b.pressure ? [`If it stalls here: ${b.pressure}`] : []),
        ...(arriving.length ? [`Who arrives: ${arriving.map(c => `${c.name} [${c.id}]`).join(", ")}`] : []),
        ...(options.coGm ? suggested(scene, b.cast) : []),
        `Routes into it:\n${routesInto(scene, b.id).join("\n")}`,
      ].join("\n");
    }),
  ].join("\n\n");
}

/** The scene's own endings (the game's improvised one has no route into it, and isn't the prep's). */
const endingsHere = (scene: Scene) => scene.exits.filter(e => scene.routes.some(r => r.target === e.id));

function endingsOf(scene: Scene): string {
  return [
    "## The endings\nThe only ways this scene can end. The player's choices decide which; don't force one. An ending is reached when a route into it is taken, and the scene closes on the reply after.",
    ...endingsHere(scene).map(e => [
      `### ${e.title} [${e.id}]: ${e.result === "good" ? "a good" : e.result === "bad" ? "a bad" : "a mixed"} ending`,
      `What's true: ${e.outcome}`,
      `Routes into it:\n${routesInto(scene, e.id).join("\n")}`,
    ].join("\n")),
  ].join("\n\n");
}

/** What the story still owes the player from scenes already over, brought into this scene by the boundary (not one of its own beats). */
function owedOf(scene: Scene, view: TurnView): string[] {
  const owed = (scene.essentials ?? []).filter(e => !scene.beats.some(b => b.id === e.id));
  if (!owed.length) return [];
  return [`## Still owed from scenes already over\nThe story needs the player to come across these, and they can come out here: through whoever and whatever the player engages with, never in the narration's own words.\n${owed.map(e => `- ${e.what} (placed with: ${e.placedWith.join("; ")}). It opens up: ${e.unlocks} [${OWED_PLACE}]${view.landed.includes(e.id) ? " [already come across]" : view.hinted.includes(e.id) ? " [already hinted at: don't point at it again]" : " [not come across yet]"}`).join("\n")}`];
}

/**
 * The people ({{characters}}): each card as the GM's prep has it (castBlock), with why they're here
 * and what never works on them; for the co-GM, each person's role palette (how they're
 * characterised, the inconsistency that invites a question, the hooks they offer) and the clues
 * that are theirs to give (the discoveries' paths via them).
 */
export function charactersOf(scene: Scene, view: TurnView, options: { coGm?: boolean } = {}): string {
  const present = new Set(presentCast(scene, view).map(c => c.id));
  return scene.cast.map(c => [castBlock(scene, c, present.has(c.id)), ...cardExtras(scene, c, options)].join("\n")).join("\n\n");
}

function cardExtras(scene: Scene, c: Character, options: { coGm?: boolean }): string[] {
  const palette = c.roles ? [["How they're characterised", c.roles.characterise], ["The inconsistency that invites a question", c.roles.inconsistency], ["The hooks they offer", c.roles.hooks]].filter(([, v]) => v) : [];
  const clues = scene.beats.flatMap(b => (b.paths ?? []).filter(p => p.via === c.id).map(p => `  - Towards ${b.title} [${b.id}]: ${p.clue} What earns it: ${p.earn}`));
  return [
    ...(c.whyHere ? [`- Why they're here, now: ${c.whyHere}`] : []),
    ...(c.limits ? [`- What never works on them, and what they never do: ${c.limits}`] : []),
    ...(options.coGm && palette.length ? [`- Their role palette:\n${palette.map(([k, v]) => `  - ${k}: ${v}`).join("\n")}`] : []),
    ...(options.coGm && clues.length ? [`- The clues that are theirs to give:\n${clues.join("\n")}`] : []),
  ];
}

export function mouthpieceInstructions(scene: Scene, view: TurnView): string {
  return `${prompt("two-part-gm", { tone: tone(), beats: prepOf(scene, view), characters: charactersOf(scene, view) })}\n\n${FORMAT}\n\n${SPEAKERS}`;
}

// --- The mouthpiece's input -------------------------------------------------------------------

/**
 * The per-turn note (nowNote's, brief.ts): where the scene is (its stage), the pressure once it has
 * sat there a while (offered once: `offered`), the routes open now (a dice route with its check,
 * which the mouthpiece calls as the route says), what's settled, the player's state, the world, and
 * the names the player hasn't heard; the reply's directives last.
 */
export function twoPartNow(scene: Scene, view: TurnView, directive: string[]): string {
  const stage = stageOf(scene, view);
  const unseen = outOfSight(scene, view);
  const open = openRoutes(scene, view);
  const parts = [
    `## Where the scene is now: ${stage.title}\n${stage.direction}`,
    // Pressure is for stalls, and is offered once: offered every turn, it gets replayed word for word.
    ...(pressureOffered(scene, view) ? [`The scene has been sitting here a while. If it's stalling or drifting, the world can push: ${stage.pressure}`] : []),
    `(The scene has been at this point for ${view.turnsInBeat} exchange${view.turnsInBeat === 1 ? "" : "s"}.)`,
    `## What moves the scene on from here\n${open.length ? open.map(r => routeLine(scene, r)).join("\n") : "- (nothing: the scene is closing)"}${open.some(r => r.skill) ? "\nWhen the player attempts what a route the dice decide describes, call that route's check: its skill and DC." : ""}`,
    ...(view.canon.length || view.established.length ? [`## Details established in play (keep them true)\nWhat has happened and been found, in the order it happened.${view.world ? " Where people are and what they're doing now is the world's, below: a detail here about where someone was or what they were doing was true then, and where the world says otherwise, they've moved on (people who have left don't come back unless the story brings them)." : ""}\n${bullets([...view.established, ...view.canon])}`] : []),
    ...(playerNow(view) ? [playerNow(view)!] : []),
    ...(view.world ? [`## The world right now\nWhere everyone and everything is, and what state it's in (ids in brackets). Keep to it, since it's updated after every reply: people and things are where it says, and what's destroyed, burning or gone stays that way until the story changes it. Details it doesn't list are yours to invent, consistent with it. It's as things stood before the player's turn: what the player does in it (shutting a book and buttoning it into their coat, picking something up, crossing the room) has happened by your reply, and the world catches up after it. It's the truth behind the screen, not what the player has seen: of what people carry, the player sees what's out in the open (worn, in hand, held up), and of the rest (in a pocket, a fist, a lining, a box) they know only what they've seen or been told.${unseen.length ? ` Out of the player's sight, and nobody has shown or told them of it: ${unseen.map(e => `${e.name} [${e.id}]`).join("; ")}. Until they find it, the narration doesn't mention it or where it is.` : ""}\n${PHYSICS}\n\n${worldView(view.world)}`] : []),
    ...(namesNote(unheardOf(scene, view)) ? [namesNote(unheardOf(scene, view))!] : []),
    ...(directive.length ? [`## For this reply\n${directive.join("\n\n")}`] : []),
  ];
  return parts.join("\n\n");
}

/**
 * The names the player hasn't heard, of whoever's here, with what to call them (unheard.ts): the
 * first time in a reply in full, then the short way. The game swaps any the narration uses anyway
 * (`asKnown`, as the reply is shown and kept), but a reply written with them reads better.
 */
export function namesNote(unheard: Unheard[]): string | undefined {
  const here = unheard.filter(u => u.here);
  if (!here.length) return undefined;
  return `## Names the player hasn't heard yet\nUntil someone says a name aloud where the player can hear it (or the player reads it or says it), the narration calls them what the player would: in full the first time in a reply, then the short way. Someone who knows a name may say it in a line: that's how the player hears it. Your prep, the details established, the world and your directions use the names; your narration doesn't.\n${here.map(u => `- ${u.name}${u.aka?.length ? ` (${u.aka.join(", ")})` : ""}: "${u.called}"${u.short !== u.called ? `, then "${u.short}"` : ""}`).join("\n")}`;
}

/** The stage whose pressure this reply's note offers: two exchanges in, once a stage (the simulation marks it offered). */
export function pressureOffered(scene: Scene, view: Pick<TurnView, "reached" | "beat" | "turnsInBeat" | "pressureOffered" | "closing">): string | undefined {
  const stage = stageOf(scene, view);
  return stage.pressure && !view.closing && view.turnsInBeat >= 2 && !view.pressureOffered.includes(stage.id) ? stage.id : undefined;
}

/** A GM turn as the player read it: its dice lines and what was said, the speakers tagged as the GM writes them. */
function gmText(scene: Scene, view: TurnView, entries: TurnView["transcript"]): string {
  return entries.filter(e => e.kind !== "player" && e.kind !== "system").map(e => (e.kind === "roll" ? `🎲 ${e.text}` : asWritten(scene, view, e))).join("\n\n");
}

/**
 * The mouthpiece's history: the co-GM's notes (as system messages, each before the player turn it
 * was written for), the player's turns and its own replies as the player read them. The latest note
 * goes last with the per-turn note beside it, so the reply has the world as it stands.
 */
export function mouthpieceInput(scene: Scene, view: TurnView, directive: string[]): Message[] {
  const notes = view.twoPart.notes;
  const here = sceneEntries(view);
  const input: Message[] = [];
  // Turn t's note was written after the reply to turn t-1 (the opening's, -1, before the scene began).
  for (let t = 0; t <= view.turn; t++) {
    const note = notes.find(n => n.turn === t - 1)?.text;
    const now = t === view.turn ? twoPartNow(scene, view, directive) : undefined;
    if (note || now) input.push({ role: "system", content: [note, now].filter(Boolean).join("\n\n") });
    input.push({ role: "user", content: t === 0 ? "(The player is ready. Begin.)" : here.find(e => e.turn === t && e.kind === "player")?.text ?? "(The player waits.)" });
    if (t < view.turn) input.push({ role: "assistant", content: gmText(scene, view, here.filter(e => e.turn === t)) });
  }
  return input;
}

// --- Speaking ---------------------------------------------------------------------------------

/** What the mouthpiece said: its narration as the screen has it, the check it called with the five outcomes, whether a closing closed, and what it cost. */
export interface Spoke { narration: Reply; check?: SpokenCheck; closes: boolean; costUsd: number; firstTextMs: number | null }

/** How the mouthpiece is asked: its operation, the request's calls, a reply as it's written, and whether a closing may wait once. */
export interface SpeakHow { operation: string; calls: CallContext; byKey(markup: Markup): Markup; onText?: (text: string, markup?: Markup) => void; mayHold?: boolean }

/**
 * The mouthpiece's reply: its narration, streamed to the turn's draft as it's written (the JSON's
 * first field, read as it grows), who says each line, and for a check its five outcomes as the
 * screen would have each. A closing that may wait once says whether it closed.
 */
export async function speak(scene: Scene, view: TurnView, directive: string[], how: SpeakHow): Promise<Spoke> {
  // A closing that may wait once says whether it closed: { closes } beside the reply.
  const schema = how.mayHold ? { ...SCHEMA, required: [...SCHEMA.required, "closes"], properties: { ...SCHEMA.properties, closes: { type: "boolean" } } } : SCHEMA;
  const show = how.onText ? streamed(scene, view, how.onText) : undefined;
  // Names the player hasn't heard come out of the narration before it's shown or kept (unheard.ts).
  const unheard = unheardOf(scene, view);
  const result = await respond({
    operation: how.operation, instructions: mouthpieceInstructions(scene, view), input: mouthpieceInput(scene, view, directive), effort: "none", maxOutputTokens: 2500,
    json: { name: "reply", schema }, calls: how.calls,
    ...(show ? { onText: (raw: string) => { const said = narrationOf(raw); if (said) show(asKnown(said.text, unheard, { partial: !said.done }).text); } } : {}),
  });
  const out = JSON.parse(result.text) as { narration: string; check: { skill: Skill; dc: number; outcomes: Record<Band, string> } | null; closes?: boolean };
  const said = (text: string): Reply => {
    const { text: words, marked } = readReply(scene, view, text.trim());
    return { speaker: "gm", kind: "narration", text: words, ...(marked.speech.length ? { markup: how.byKey({ speech: marked.speech }) } : {}) };
  };
  const narration = asKnown(out.narration, unheard);
  // An outcome follows the narration: a name said aloud there has been heard.
  const after = unheard.filter(u => !narration.heard.includes(u.id));
  const check = out.check && SKILLS.includes(out.check.skill) && Number.isInteger(out.check.dc) && BANDS.every(b => typeof out.check!.outcomes?.[b] === "string")
    ? { skill: out.check.skill, dc: out.check.dc, outcomes: Object.fromEntries(BANDS.map(b => [b, said(asKnown(out.check!.outcomes[b], after).text)])) as Record<Band, Reply> }
    : undefined;
  return { narration: said(narration.text), ...(check ? { check } : {}), closes: out.closes !== false, costUsd: result.costUsd, firstTextMs: result.firstTextMs };
}

/**
 * The narration as far as it's been written: the JSON's `narration` string, read as the reply
 * streams in (its escapes undone, one cut off part-way held back), or undefined before it starts.
 */
export const narrationSoFar = (raw: string): string | undefined => narrationOf(raw)?.text;

/** The narration so far, and whether it's whole (its closing quote has come). */
export function narrationOf(raw: string): { text: string; done: boolean } | undefined {
  const start = /"narration"\s*:\s*"/.exec(raw);
  if (!start) return undefined;
  let out = "";
  for (let i = start.index + start[0].length; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === "\"") return { text: out, done: true };
    if (c !== "\\") { out += c; continue; }
    const next = raw[i + 1];
    if (next === undefined) return { text: out, done: false };
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { text: out, done: false };
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[next] ?? next;
    i++;
  }
  return { text: out, done: false };
}

/**
 * The scene moved on after the last reply (the co-GM took a route to an event), so this reply shows
 * it: the stage it's at now, and whoever that brings on, seen arriving. Moved on silently, the
 * corporal and his cart were simply in the lane, never seen coming.
 */
export function movedDirective(scene: Scene, view: TurnView): string | undefined {
  const moved = view.twoPart.moved;
  const stage = stageOf(scene, view);
  if (!moved || moved !== stage.id) return undefined;
  const arriving = enteringAt(scene, stage.id).map(c => c.called ?? c.name);
  return `The scene has just moved on to "${stage.title}": ${stage.direction} Answer the player's turn first; then let it show in this reply${arriving.length ? `: ${arriving.join(" and ")} arrive${arriving.length === 1 ? "s" : ""} now, seen arriving` : ""}.`;
}

/**
 * The wind-down's directive (the co-GM took a route to an ending; this reply answers the player and
 * closes). Once, it may wait: when the player has just started something the ending has to answer
 * (calling the killer down from the loft), that plays first and the scene closes on the next reply.
 * A fight's ending closes on the moment it breaks out (the game's words).
 */
export function closingDirective(exit: Exit, mayHold: boolean): string {
  const close = `bring the scene to a close in a few sentences, landing on a moment that belongs to the player. What this ending should feel like: ${exit.closing} Don't narrate beyond the ending into what comes next.${exit.kind === "combat" ? FIGHT_CLOSE : ""}`;
  return mayHold
    ? `The scene is ending: ${exit.outcome} First answer what the player just said or did. If they've just started something this ending has to answer first (a challenge, a confrontation, a new move that would change how it ends), play that and set \`closes\` to false: the scene closes on your next reply. Otherwise ${close} and set \`closes\` to true.`
    : `This reply closes the scene: ${exit.outcome} First answer what the player just said or did. Then ${close}`;
}

// --- The co-GM --------------------------------------------------------------------------------

const UPDATE_ROLE: ToolDef = {
  name: "update_character_role",
  description: "Set a character's role for the GM's next reply. The GM sees every character's latest role before each player turn. Call it for each character whose role should change after the latest exchange; a character you don't update keeps their last role.",
  parameters: {
    type: "object", additionalProperties: false, required: ["char_id", "status", "mental_state", "conversation_role"],
    properties: {
      char_id: { type: "string", description: "The character's id, in square brackets in your prep." },
      status: { type: "string", description: "What the character is doing and where, right now. E.g. 'Sitting on the wall above the yard, fist shut.'" },
      mental_state: { type: "string", description: "How they feel right now, towards the player and the situation. E.g. 'Cob is overly fearful of the newcomer, and hiding it with cheek.'" },
      conversation_role: { type: "string", description: "What they could do or reveal next to move the scene towards a beat, and what they hold back for now. E.g. 'Cob could let slip that he sleeps in the loft and was hiding there when the men came; he won't say who.'" },
    },
  },
};

const MOVE_SCENE: ToolDef = {
  name: "move_scene",
  description: "Move the scene on along one of its open routes, once what the route describes has happened in the story (into a discovery: once its revelation has landed with the player; for a cue, when its moment has come). A route the dice decide takes the outcome of the check the GM called on it. Leading to an ending, the scene closes on the GM's next reply.",
  parameters: {
    type: "object", additionalProperties: false, required: ["route_id", "outcome", "why"],
    properties: {
      route_id: { type: "string", description: "The route's id, in square brackets in your prep." },
      outcome: { type: "string", enum: ["success", "failure", "none"], description: "For a route the dice decide: how the GM's check on it went. Otherwise 'none'." },
      why: { type: "string", description: "What happened in the story that takes this route, in a sentence." },
    },
  },
};

const CO_GM_TOOLS = `## Your tools
- update_character_role: each character's role for the GM's next reply. While the scene is at a stage (where it starts, or the latest of its events), that stage's suggested roles are your default for each character; what a character remembers, wants, has been promised or owes, and what just happened, can give them a better reason, and then that wins. Keep each role to what they do or could reveal next, and what they hold back for now.
- move_scene: when what one of the open routes describes has happened in the story (a discovery's revelation has landed, or a cue's moment has come), take it. Only the routes listed as open can be taken. When the scene moves to a new stage, update the roles for it. Don't hold the scene at a stage the story has already moved past; don't take a route for something that hasn't happened yet.
Then reply "done".`;

function coGmInput(scene: Scene, view: TurnView, check: TurnCheck | undefined): Message[] {
  const stage = stageOf(scene, view);
  const present = presentCast(scene, view);
  const open = openRoutes(scene, view);
  const dice = check ? open.filter(r => r.skill === check.skill && r.dc === check.dc) : [];
  const notes = Object.entries(stage.cast ?? {}).filter(([id]) => present.some(c => c.id === id));
  return [{ role: "user", content: [
    `# The scene so far\n\n${scriptTranscript(scene, view)}`,
    `# Where the scene is: ${stage.title} [${stage.id}]\nIt has been here for ${view.turnsInBeat} exchange${view.turnsInBeat === 1 ? "" : "s"}. Reached so far: ${reachedOf(view).map(id => `[${id}]`).join(", ")}.${notes.length ? `\nSuggested roles while it's here:\n${notes.map(([id, n]) => `- ${id}: ${n}`).join("\n")}` : ""}`,
    `# The targets\nThe discoveries not reached yet:\n${targetsOf(scene, view).map(b => `- ${b.title} [${b.id}]${b.required ? " (required)" : ""}: ${b.revelation}`).join("\n") || "- (none: every discovery is reached)"}`,
    `# Open routes\n${open.map(r => routeLine(scene, r, { revelation: true })).join("\n") || "- (none)"}`,
    ...(check ? [`# This turn's check\nThe GM called ${titleCase(check.skill)} DC ${check.dc}, and the roll came to ${check.total}: a ${check.success ? "success" : "failure"} (${check.band.replace("_", " ")}).${dice.length ? ` It is the check of ${dice.map(r => `[${r.id}]`).join(" and ")}: take ${dice.length === 1 ? "it" : "the one the player was attempting"} with outcome ${check.success ? "success" : "failure"} if that's what the player was attempting.` : ""}`] : []),
    ...(view.established.length ? [`# Established in play\n${view.established.map(f => `- ${f}`).join("\n")}`] : []),
    `# Current character roles\n\n${rolesBody(scene, view.twoPart.roles)}`,
    `# Who's on stage now\n${present.map(c => `- ${c.name} [${c.id}]`).join("\n")}`,
    `The GM's reply to turn ${view.turn} is the latest exchange. Update the roles that need it, and move the scene on if a route's moment has come.`,
  ].join("\n\n") }];
}

/** Each person's role as the co-GM's note has it, without its heading. */
function rolesBody(scene: Scene, roles: Record<string, TwoPartRole>): string {
  return Object.entries(roles).map(([id, r]) => [
    `Character role for ${scene.cast.find(c => c.id === id)?.name ?? id}:`,
    ...(r.status ? [`Status: ${r.status}`] : []), ...(r.mental_state ? [`Mental state: ${r.mental_state}`] : []),
    `Conversation role: ${r.conversation_role}`,
  ].join("\n")).join("\n\n") || "(nobody yet)";
}

export function coGmInstructions(scene: Scene, view: TurnView): string {
  return `${prompt("two-part-co-gm", { tone: tone(), beats: prepOf(scene, view, { coGm: true }), characters: charactersOf(scene, view, { coGm: true }) })}\n\n${CO_GM_TOOLS}`;
}

/**
 * The co-GM is on the turn's way (the next line's reply waits for its note), so it can't wait as a
 * background review does: a round with no answer in 20 s is asked again once, and the whole loop
 * has 45 s, inside the settle's minute (shared/protocol/ai.ts STEP_TIMEOUT_MS), so the simulation
 * never sends the settle again while it's still thinking. Past either it fails, and the turn goes
 * on with the stage manager's work and everyone's roles as they were. (M2's live game had a round
 * hang for 180 s, the tool loop's old limit, holding the turn three minutes.)
 */
export const CO_GM_ROUND_MS = 20_000;
export const CO_GM_DEADLINE_MS = 45_000;

/**
 * The co-GM after a reply: the roles it set (the latest for each person) and the moves it made, each
 * taken with beats.ts takeRoute on a copy of the bookkeeping as it went (so it was answered at once,
 * and the simulation, taking them again on its rows, gets the same), and what it called, in order.
 */
export async function coGm(scene: Scene, view: TurnView, gm: GmState, check: TurnCheck | undefined, calls: CallContext): Promise<CoGmAnswer & { costUsd: number }> {
  let state = structuredClone(gm);
  const roles: Record<string, TwoPartRole> = {};
  const moves: CoGmAnswer["moves"] = [];
  const result = await runTools({ operation: "two-part.co-gm", instructions: coGmInstructions(scene, view), input: coGmInput(scene, view, check), tools: [UPDATE_ROLE, MOVE_SCENE], effort: "low", maxTurns: 16, roundMs: CO_GM_ROUND_MS, deadlineMs: CO_GM_DEADLINE_MS, calls }, async (name, args) => {
    if (name === "move_scene") {
      const outcome: RouteOutcome = args.outcome === "success" || args.outcome === "failure" ? args.outcome : "none";
      const route = String(args.route_id);
      const taken = takeRoute(scene, state, route, outcome, view.turn);
      if ("error" in taken) return `error: ${taken.error}`;
      state = taken.gm;
      moves.push({ route, outcome, why: String(args.why ?? "") });
      return movedText(scene, state, taken.reached);
    }
    const id = String(args.char_id);
    if (!scene.cast.some(c => c.id === id)) return `error: no character "${id}" (ids: ${scene.cast.map(c => c.id).join(", ")})`;
    roles[id] = { status: String(args.status ?? ""), mental_state: String(args.mental_state ?? ""), conversation_role: String(args.conversation_role ?? "") };
    return "ok";
  });
  return { roles, moves, log: result.calls.map(c => ({ name: c.name, args: c.args, result: typeof c.result === "string" ? c.result : JSON.stringify(c.result) })), costUsd: result.costUsd };
}

/** What a move the co-GM made comes to, for it to go on from: an ending, a new stage (its suggested roles, who arrives), a discovery made, or a check failed with nowhere to go. */
function movedText(scene: Scene, gm: GmState, reached: string | undefined): string {
  const open = () => openRoutes(scene, gm).map(r => r.id).join(", ") || "none";
  const exit = scene.exits.find(e => e.id === reached);
  if (exit) return `The scene is ending: ${exit.title}. The GM closes it on the next reply.`;
  const beat = scene.beats.find(b => b.id === reached);
  if (beat && isEvent(scene, beat)) {
    const arriving = enteringAt(scene, beat.id);
    return `Moved to "${beat.title}".${arriving.length ? ` Arriving now: ${arriving.map(c => `${c.name} [${c.id}]`).join(", ")}.` : ""} Its suggested roles: ${Object.entries(beat.cast ?? {}).map(([id, n]) => `${id}: ${n}`).join("; ") || "(none)"}. Update the characters' roles for it. Open routes now: ${open()}.`;
  }
  if (beat) return `Reached "${beat.title}": the player has it now. Open routes now: ${open()}.`;
  return `Taken; the scene stays at "${stageOf(scene, gm).title}". Open routes now: ${open()}.`;
}
