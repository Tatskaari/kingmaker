// Copied from PR #666's src/runtime/two-part.ts at origin/claude/two-part-gm c749270: FORMAT and SCHEMA (the reply format), routeLine, mouthpieceInstructions, characters, mouthpieceInput with gmText, speak, movedDirective, the wind-down's words (twoPartTurn's), the co-GM's tools (UPDATE_ROLE, MOVE_SCENE, CO_GM_TOOLS), coGmInput and coGm, whole but at the seams docs/two-part-design.md names. It reads a TurnView (gm/view.ts) for the session. Where the scene is, is shared/scene/beats.ts's (its stage, the routes open, a route taken) in place of the beat and its transitions; the prep ({{beats}}) is the scene format's, rendered as the design orders it, in place of beatsBlock; {{characters}} has the cards' whyHere and limits too, and the co-GM's each person's role palette and the clues via them. speak doesn't roll: the check comes back with its five outcomes, and the simulation rolls it; the narration streams through the game's markup (who says each line) as it's written. The per-turn note is twoPartNow, nowNote's copy (brief.ts) with the open routes. The co-GM's moves are beats.ts's takeRoute on a copy of the request's bookkeeping, and its answer is the roles it set and the moves it made, for the simulation to make again. The speakers paragraph is gm.md's, appended after the format. QA round qa1-1018 added what's ours after it: written words read untagged, what the player sees and hears (SEEN), the companion, the checks' outcomes following on from their setup, a closing going on from the last reply, and in the per-turn note what's hidden right now, the names not yet heard with what to call them, and what the player did or thought in brackets; and the narration's names the player hasn't heard are swapped for what they'd call them before it's shown or kept (unheard.ts). The co-GM's tools section, its input and its moves' answers have what QA round qa1-1018 showed they needed (docs/migration-log.md, M2's fixes from it): the turns counted, each cue's outer limit and whether it's overdue, what's true at each ending a route goes to, how to take a route, and a move whose own reason denies it refused. QA round qa2-1018 added to what's ours: the check rule's prep that wins over the dice, a setup that stops at the attempt and outcomes that add only what the roll decided, a failure that never puts a required discovery out of reach (said in the format, its holders listed in the per-turn note, and a failure that sends one of them out of the scene swapped for the other failure: inReach), nobody stating their own terms, the player character's body as the player's, the scene kept to its place, the companion's restraint (and the co-GM told to write it into the companion's role every turn: companionRoles), and a closing that plays only what its last reply didn't, where the player is.

import { titleCase } from "../../shared/dice.ts";
import type { GmState, TwoPartRole } from "../../shared/gm/state.ts";
import { BANDS, type Band } from "../../shared/gm/two-part.ts";
import type { Markup } from "../../shared/markup.ts";
import type { CoGmAnswer, Reply, SpokenCheck, TurnCheck } from "../../shared/protocol/ai.ts";
import { enteringAt, isDiscovery, isEvent, limitOf, openRoutes, reachedOf, reachedTurns, stageOf, takeRoute, targetsOf, type RouteOutcome } from "../../shared/scene/beats.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import { SKILLS, type Character, type Exit, type Scene, type SceneRoute, type Skill } from "../../shared/scene/types.ts";
import { worldView } from "../../shared/world/scene-world.ts";
import { PHYSICS } from "../../shared/world/systems.ts";
import { respond, type CallContext, type Message } from "../llm/openrouter.ts";
import { runTools, type ToolDef } from "../llm/tools.ts";
import { prompt } from "../prompts/index.ts";
import { bullets, castBlock, OWED_PLACE, outOfSight, playerNow, sceneBrief, sceneEntries, scriptTranscript } from "./brief.ts";
import { FIGHT_CLOSE } from "./directives.ts";
import { nameAsKnown } from "./knowledge.ts";
import { speechIn } from "./markup.ts";
import { pronounOf } from "./speakers.ts";
import type { TurnView } from "./view.ts";
import { asKnown, shortOf, unheardOf, type Unheard } from "./unheard.ts";
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
- \`check\`: null on most turns. But when the player makes a clear, risky attempt at a turning point, whether it works is for the dice to say, not you: when they try to frighten, persuade, trick or press someone who could go either way (break or bolt, give in or dig in), or try something whose failure would matter (seeing through a lie, a climb, a lock, a close look at something that hides a clue), and the roll would move the scene towards a beat, call for a skill check instead of deciding it yourself. Never for a remark, a compliment or a question: answer those in the story. Where your prep's routes say the dice decide something the player is trying, use that route's skill and DC. Then \`narration\` sets up the attempt and stops before the result, and \`check\` gives the skill, a DC (10 easy, 13 moderate, 15 hard, 18 very hard) and five outcomes. The game rolls the dice with the player's own modifiers, and the player sees your narration, the roll, and the one outcome that came up.
  What your prep says for certain wins over the dice. Where a path or someone's card says what an approach gets (no dice; what they do for a promise that answers their fear, or for someone they trust; what coin never buys), and the player has made that approach, it gets exactly that, with no check. The dice are only for what your prep leaves open (it could go either way, or a check suits it) or doesn't cover. What it says never works doesn't, with a roll or without: coin offered for a look at Cob's boot gets haggling, never the look. And a check is for what the player has just tried in their turn, never for something you're still waiting for them to say or do, nor for what's already in plain view or already told: what's there to see, they see.
  The narration before a check stops at the attempt: the player reaching, looking or speaking, and where everyone is as they do. Nothing the roll is for comes before the dice: not what they find, see or hear, not how someone takes it, and, where it's whether anyone notices, nobody looks up, stops or watches their hands before the dice.
  Write each outcome as the next words of the reply, carrying straight on from the narration, in the same voice and length as any reply (the characters react, then stop for the player). Each one follows on from the narration as you wrote it and never undoes it: what it had someone say, do or offer stands, so an offer made there is still on the table after a failure, which goes wrong another way (a higher price, a condition, someone interrupting). And each says only what the roll decided, once: never what the narration has already said.
  - major_failure (missed by 5 or more): it goes wrong, with a cost: offence taken, a higher price, a wrong impression, a door shut for now.
  - minor_failure (missed by 1 to 4): no progress, a small complication, and a hint of another way in.
  - barely_passed (made it, by 0 to 2): the next step, with a catch or only part of it.
  - minor_success (beat it by 3 to 6): the next step, cleanly.
  - major_success (beat it by 7 or more): the next step and a little more: the character warms, or a further hook opens.
  A failure never puts what the player still needs out of reach: nobody who holds a required discovery leaves, bolts or goes silent for good on a roll (the per-turn note says who holds one), and the way stays open (no, but). Even a major success gives only what the attempt could earn now: the next step for that character, never the whole of a secret.
- Don't roll or report numbers yourself, and don't ask the player to roll: the check is how you ask.`;

/**
 * The speakers part of the game's markup, word for word from gm.md: the screen gives each person's
 * lines their own colour. Then what's ours (QA round qa1-1018: Prout's pencilled note came out as a
 * line said by nobody): written words are read in the narration, untagged.
 */
const SPEAKERS = `## Who says each line
Put the speaker in square brackets before every spoken line, each time they speak: [Kell] “Out.” She turns to the boy. [Kell] “You too.” Use their name, or what the player calls them until they've heard it ([the pie-seller] “Threepence, my lamb.”). The tag is for the screen: your prose still makes clear who's speaking.
Only words said aloud get a tag. Words written or printed (a page, a sign, an order, a note) are read out in the narration, in single quotes and with no tag: Under the last entry, in pencil: ‘Not goblins.’`;

/**
 * What the player can see and hear, and what stays behind the screen (QA round qa1-1018's patterns:
 * names the player hadn't heard, hidden things named, the player's private words heard, and the
 * prep's meaning narrated). The per-turn note lists the names and the hidden things as they stand.
 */
const SEEN = `## What the player sees and hears
Your narration is what the player character sees and hears, and nothing they haven't seen or been told. Your prep, the co-GM's notes, the world and your directions are the truth behind the screen: play everyone truly from all of it, but narrate only what's in front of the player.
- Names: until someone says a name aloud where the player can hear it (or the player reads it, or says it), the narration calls that person what the player would. The per-turn note lists who, and what to call them. Someone who knows a name may say it in a line: that's how the player hears it.
- What's hidden: what's out of the player's sight (in a fist, a pocket or a lining, behind something, behind a door or up in a loft they haven't got into) and what people are keeping back stays out of the narration until the player finds it, or someone shows or tells them of it. Don't name it, say where it is or that it's still hidden, or confirm or deny it from where the player can't see it. A fist that stays shut is a shut fist. Someone's tell can show (eyes going to the water butt, a hand that won't open), never what the tell is about. The per-turn note lists what's hidden right now.
- The player's words: in their turn, what's in brackets or between asterisks is what their character does or thinks, not what they say aloud. People see what they do, and never hear what they only think, or their reasons: nobody answers, repeats or quotes those.
- Your notes stay behind the screen. The narration shows what people do and say, never the game's workings in its own words: what a move has or hasn't earned, which lever is the right one, what someone's rules are, what the player should do next. Not "The promise has found the fear.", "rather than taking the decision from you" or "The shilling has bought no permission."
- What would win someone over (a promise that answers their fear, a fair hand, a kindness, the right proof) is yours to know from their card, and it shows only in how they behave: what they want, test or haggle over, what they won't do yet. Nobody states their own terms or price unasked, or says their card's words for what would open them ("ask nice and you can look", "sit in, play fair, and tell me what becomes of him"): the player finds out by trying. Show it instead: a hand dealt to them, a look at how they play, a question about what they want with him. Answering an offer the player has made, they can haggle, or say what they're afraid of.

## The player character
Their body and mind are the player's. Never give them a wound, an ache, tiredness, fear or any other condition that play (a blow that landed, a fall, a spell, a roll) or the rules (the per-turn note's "The player character now") haven't given them, and never have them do, say, feel or go anywhere the player didn't say.

## Where the scene plays
This scene plays in its place, as your prep's "The place" has it. When the player sets off somewhere else, follow them as far as its edge (out of the door, to the top of the stairs) and stop there: what's at the other end is another scene's, which the story opens when this one ends. Never narrate the way there, arriving, or anything that happens there.`;

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

/** The reply's schema: a closing that may wait once says whether it closed, { closes } beside the reply. */
export const replySchema = (mayHold: boolean): Record<string, unknown> => (mayHold ? { ...SCHEMA, required: [...SCHEMA.required, "closes"], properties: { ...SCHEMA.properties, closes: { type: "boolean" } } } : SCHEMA);

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
 * and what has to have happened. The fake model reads this line (ai/llm/fake-openrouter.ts). The
 * co-GM's open routes say more after it: into a discovery, its revelation (`revelation`); into an
 * ending, how it went and what's true there (`ending`); and for a cue, how far its outer limit has
 * run after the reply to `now.turn`, and whether it's overdue (`now`: limitOf).
 */
export function routeLine(scene: Scene, r: SceneRoute, options: { revelation?: boolean; ending?: boolean; now?: Where & Pick<GmState, "path"> & { turn: number } } = {}): string {
  const target = scene.beats.find(b => b.id === r.target);
  const needs = r.requires?.length ? `, once ${listed(scene, r.requires)} ${r.requires.length === 1 ? "is" : "are"} reached` : "";
  const how = r.skill
    ? `; the dice decide (${titleCase(r.skill)} DC ${r.dc}): a success takes it, a failure ${r.onFailure ? `goes to ${named(scene, r.onFailure)}` : "leaves the scene where it is"}`
    : r.phase === "cue" ? "; a cue: bring it about when its moment comes" : "";
  const discovery = !!target && isDiscovery(target);
  const when = r.condition.trim() || (discovery ? `its revelation has landed with the player${options.revelation && target.revelation ? ` (${target.revelation})` : ""}` : r.label);
  const exit = options.ending ? scene.exits.find(e => e.id === r.target) : undefined;
  const more = [
    ...(options.now ? [limitLine(scene, r, options.now)].filter(Boolean) : []),
    ...(exit ? [`It's ${exit.result === "good" ? "a good" : exit.result === "bad" ? "a bad" : "a mixed"} ending. What's true there: ${exit.outcome}`] : []),
  ];
  return `- [${r.id}] from ${named(scene, r.source)} to ${named(scene, r.target)}${needs}${how}. When: ${more.length ? `${sentence(when)} ${more.join(" ")}` : when}`;
}

/** What the bookkeeping these read: the nodes reached and the stage. */
type Where = Pick<GmState, "reached" | "beat">;

/** Text ending as a sentence does, so more can follow it. */
const sentence = (s: string) => (/[.!?]["'’”)\]]*$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/**
 * A cue's outer limit as the co-GM reads it after the reply to `now.turn`: each count with how far
 * it has run (which of its exchanges the next reply is), one whose beat isn't reached yet or that a
 * beat has stopped saying so; then, once one still running has run out, that it's overdue. Empty
 * for a route with none.
 */
function limitLine(scene: Scene, r: SceneRoute, now: Where & Pick<GmState, "path"> & { turn: number }): string {
  const limit = limitOf(r, now, now.turn);
  if (!limit) return "";
  const counts = limit.counts.map(c => {
    const what = c.after ? `${c.exchanges} after ${named(scene, c.after)}` : `${c.exchanges} exchanges into the scene`;
    if (c.stopped) return `${what} (stopped: ${named(scene, c.stopped)} is reached)`;
    if (c.next === undefined) return `${what} (not reached yet)`;
    return `${what} (${c.after ? `reached on turn ${c.reachedOn}: the next reply is the ${ordinal(Math.max(1, c.next))} after it` : `the next reply is the ${ordinal(Math.max(1, c.next))}`})`;
  });
  return `Its outer limit, whichever runs out first: ${counts.join(", or ")}.${limit.overdue ? " Overdue: bring it about now." : ""}`;
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

/**
 * Who goes with the player through the story (Kell): the scene's cast here whom an ending of this
 * scene, or of one played before it, has walk with them (a `follow` effect).
 */
export function companionsOf(scene: Scene, view: TurnView): Character[] {
  const played = view.history.map(h => view.story?.scene(h.sceneId)).filter((s): s is Scene => !!s);
  const follow = new Set([scene, ...played].flatMap(s => [...(s.onEnd ?? []), ...s.exits.flatMap(e => e.effects ?? [])]).flatMap(e => (e.op === "follow" ? [e.who] : [])));
  return presentCast(scene, view).filter(c => follow.has(c.id));
}

/**
 * How the companion is spoken of: their names, and "she" or "he" with the verb's singular, or "they"
 * with its plural (several, or one whose card doesn't say).
 */
function companionWords(who: Character[]) {
  const one = who.length === 1 ? pronounOf([who[0]!.name, who[0]!.look].join(". ")) : undefined;
  const [they, them, their, theirs] = one === "she" ? ["she", "her", "her", "hers"] : one === "he" ? ["he", "him", "his", "his"] : ["they", "them", "their", "theirs"];
  return { names: who.map(c => c.name).join(" and "), they, They: they[0]!.toUpperCase() + they.slice(1), them, their, theirs, v: (singular: string, plural: string) => (one ? singular : plural) };
}

/**
 * The companion, as the mouthpiece is told to play them (QA round qa1-1018: Kell examined the body
 * and read out the evidence while the player was still up in the loft, and made the whole case in a
 * closing; QA round qa2-1018: she drew the dragging from the heels, said what the case still needed
 * ("I still need a lead placing someone here"), answered Hobb's question to the player with her own
 * chair, kept the page the player had said not to take, and tested a case nobody had put to her).
 */
function companionNote(scene: Scene, view: TurnView): string | undefined {
  const who = companionsOf(scene, view);
  if (!who.length) return undefined;
  const w = companionWords(who);
  return `## The companion
${w.names} ${w.v("goes", "go")} with the player, and it's the player's case, not ${w.theirs}:
- What ${w.they} ${w.v("sees", "see")}, ${w.they} ${w.v("says", "say")} plainly when asked and ${w.v("writes", "write")} down, and ${w.v("stops", "stop")} there: what it means (murder or not, who did it, where it leads) and what the case still needs are the player's to say. Never "That tells us…", "That establishes…" or "I still need…".
- A question put to the player is the player's to answer: ${w.they} never ${w.v("answers", "answer")} it for them, or ${w.v("makes", "make")} an offer or a promise in their place.
- The player's word stands: a promise or a condition they've made ("don't take it", "his name stays out"), ${w.they} ${w.v("keeps", "keep")}, and ${w.they} never ${w.v("overrides", "override")} their choice.
- ${w.They} ${w.v("tests", "test")} a case once, at its weakest point, when the player puts it to ${w.them}, never before.
- ${w.They} never ${w.v("examines", "examine")} or ${w.v("searches", "search")} anything for them unasked, or ${w.v("chooses", "choose")} their next step or where they go, or ${w.v("hints", "hint")} at it. ${w.They} ${w.v("does", "do")} what ${w.they}${w.v("'s", "'re")} asked.`;
}

/**
 * The companion, as the co-GM is told to write their role (QA round qa2-1018: its role for Kell had
 * her "state plainly that the cord mark and blow show Prout was struck and strangled" and "still
 * need a concrete lead placing someone at the scene", and the mouthpiece said both): ours, after its
 * tools, so her role every turn carries what she holds back.
 */
export function companionRoles(scene: Scene, view: TurnView): string | undefined {
  const who = companionsOf(scene, view);
  if (!who.length) return undefined;
  const w = companionWords(who);
  return `## The companion
${who.map(c => `${c.name} [${c.id}]`).join(" and ")} ${w.v("goes", "go")} with the player, and it's the player's case. Every turn, ${w.their} conversation role says what ${w.they} ${w.v("holds", "hold")} back as well as what ${w.they} ${w.v("does", "do")}. What ${w.they} ${w.v("sees", "see")}, ${w.they} ${w.v("says", "say")} when asked and ${w.v("writes", "write")} down; what it means (murder or not, who did it, where it leads), what the case or an ending still needs, the answer to a question put to the player, and anything that would override the player's word, ${w.they} ${w.v("holds", "hold")} back for the player. Never put a conclusion, what the case still needs or the player's next step in ${w.their} status, mental state or role: the GM voices what it's given.`;
}

/** What's ours after the user's prompt: the reply format, who says each line, what the player sees and hears (and the player character, and where the scene plays), and the companion. */
export function mouthpieceRules(scene: Scene, view: TurnView): string {
  const companion = companionNote(scene, view);
  return [FORMAT, SPEAKERS, SEEN, ...(companion ? [companion] : [])].join("\n\n");
}

export function mouthpieceInstructions(scene: Scene, view: TurnView): string {
  return `${prompt("two-part-gm", { tone: tone(), beats: prepOf(scene, view), characters: charactersOf(scene, view) })}\n\n${mouthpieceRules(scene, view)}`;
}

// --- The mouthpiece's input -------------------------------------------------------------------

/**
 * The per-turn note (nowNote's, brief.ts): where the scene is (its stage), the pressure once it has
 * sat there a while (offered once: `offered`), the routes open now (a dice route with its check,
 * which the mouthpiece calls as the route says), what's settled, the player's state, the world,
 * what's hidden from the player right now, the names they haven't heard, what in their turn they
 * did or thought rather than said; the reply's directives last.
 */
export function twoPartNow(scene: Scene, view: TurnView, directive: string[]): string {
  const stage = stageOf(scene, view);
  const open = openRoutes(scene, view);
  const parts = [
    `## Where the scene is now: ${stage.title}\n${stage.direction}`,
    // Pressure is for stalls, and is offered once: offered every turn, it gets replayed word for word.
    ...(pressureOffered(scene, view) ? [`The scene has been sitting here a while. If it's stalling or drifting, the world can push: ${stage.pressure}`] : []),
    `(The scene has been at this point for ${view.turnsInBeat} exchange${view.turnsInBeat === 1 ? "" : "s"}.)`,
    `## What moves the scene on from here\n${open.length ? open.map(r => routeLine(scene, r)).join("\n") : "- (nothing: the scene is closing)"}${open.some(r => r.skill) ? "\nWhen the player attempts what a route the dice decide describes, call that route's check: its skill and DC." : ""}`,
    ...(view.canon.length || view.established.length ? [`## Details established in play (keep them true)\nWhat has happened and been found, in the order it happened.${view.world ? " Where people are and what they're doing now is the world's, below: a detail here about where someone was or what they were doing was true then, and where the world says otherwise, they've moved on (people who have left don't come back unless the story brings them)." : ""}\n${bullets([...view.established, ...view.canon])}`] : []),
    ...(playerNow(view) ? [playerNow(view)!] : []),
    ...(view.world ? [`## The world right now\nWhere everyone and everything is, and what state it's in (ids in brackets). Keep to it, since it's updated after every reply: people and things are where it says, and what's destroyed, burning or gone stays that way until the story changes it. Details it doesn't list are yours to invent, consistent with it. It's as things stood before the player's turn: what the player does in it (shutting a book and buttoning it into their coat, picking something up, crossing the room) has happened by your reply, and the world catches up after it. It's the truth behind the screen, not what the player has seen: of what people carry, the player sees what's out in the open (worn, in hand, held up), and of the rest (in a pocket, a fist, a lining, a box) they know only what they've seen or been told.\n${PHYSICS}\n\n${worldView(view.world)}`] : []),
    ...[hiddenNote(scene, view), holdersNote(scene, view), namesNote(unheardOf(scene, view)), asidesNote(view)].filter((n): n is string => !!n),
    ...(directive.length ? [`## For this reply\n${directive.join("\n\n")}`] : []),
  ];
  return parts.join("\n\n");
}

/**
 * What's hidden from the player right now (QA round qa1-1018: Cob's loose board named three times
 * over, the crown in Moll's fist, the loft's smashed lantern confirmed from the foot of its stair):
 * the world's things out of their sight (outOfSight: hidden, or inside something that is, and not
 * yet come across), and what the people here keep back, each secret on their cards by its first
 * sentence (the board is Cob's, the crown Moll's), with what shows of it (each card's "Shows:", its
 * tell), which can show. The transcript says when one has come out: then it's the player's.
 */
export function hiddenNote(scene: Scene, view: TurnView): string | undefined {
  const unseen = outOfSight(scene, view);
  const keeping = presentCast(scene, view).filter(c => c.secrets?.some(s => !isTell(s)));
  const tells = presentCast(scene, view).flatMap(c => { const tell = tellOf(c.secrets ?? []); return tell ? [`- ${c.name}: ${tell}`] : []; });
  if (!unseen.length && !keeping.length && !tells.length) return undefined;
  return [
    "## Hidden from the player right now",
    "Behind the screen until the player finds it, or someone shows or tells them of it in play (the transcript says when: from then on it's theirs). Until then the narration never names it, says where it is or that it's still hidden, or confirms or denies it from where the player can't see it.",
    ...(unseen.length ? [`Out of the player's sight:\n${unseen.map(e => `- ${e.name} [${e.id}]`).join("\n")}`] : []),
    // QA round qa2-1018: "until it comes out in their own words, when it's earned" read as theirs to say, and people recited what would open them.
    ...(keeping.length ? [`What the people here keep back, as you know it (their cards have the whole of it, and what would bring each of them round). It's your knowledge, not theirs to explain: until the player has earned it, it shows only in how they behave and in their tells, and nobody says what would earn it.\n${keeping.map(c => `- ${c.name}: ${c.secrets!.filter(s => !isTell(s)).map(firstSentence).join(" ")}`).join("\n")}`] : []),
    ...(tells.length ? [`What shows of it is their tells, now and then when the moment suits (not every reply), never what a tell is about: a shut fist stays a shut fist, and a glance goes towards a place, not to the hidden thing there.\n${tells.join("\n")}`] : []),
  ].join("\n");
}

/**
 * Who here holds a required discovery the player hasn't reached (a path of it via them), so a
 * check's outcomes can be read against them (QA round qa2-1018, H4: a failed Persuasion roll had
 * Cob bolt with the scene's required lead, and it ran out of turns without it). Not a reason to
 * hand it over: it still comes out as it's earned.
 */
export function holdersNote(scene: Scene, view: TurnView): string | undefined {
  const present = presentCast(scene, view);
  const needed = targetsOf(scene, view).filter(b => b.required).map(b => ({ b, who: present.filter(c => b.paths?.some(p => p.via === c.id)) })).filter(n => n.who.length);
  if (!needed.length) return undefined;
  const names = (who: Character[]) => who.map(c => c.name).join(who.length === 2 ? " and " : ", ");
  return `## Who holds what the player still needs\n${needed.map(n => `- ${n.b.title} [${n.b.id}], which the scene can't end well without: ${names(n.who)}`).join("\n")}\nNo check's outcome puts it out of reach: none of them leaves, bolts or goes silent for good on a roll. A failure costs something else (a higher price, a condition, a wrong impression, time), and the way to it stays open. That's so nothing closes it off, not a reason to hand it over: it still comes out only as it's earned.`;
}

/** Words that send someone out of the scene, not across it: bolting, fleeing, off through the gate. */
const OFF = /\b(?:bolt(?:s|ed)?|flee(?:s)?|fled|scarper(?:s|ed)?|legs? it|(?:is|are) gone|(?:runs?|ran|dash(?:es|ed)?|darts?|darted|races?|raced|hurr(?:ies|ied)) (?:off|away|out)|(?:slips?|slipped|makes?|made|takes?|took) off|slip(?:s|ped)? away|(?:runs?|ran|dash(?:es|ed)?|darts?|races?|heads?|makes?) for the (?:gate|door|lane|stairs|street)|(?:through|out of) the (?:gate|door)|over the wall|leaves? (?:the (?:yard|room|house|tavern)|without))\b/gi;
/** A departure said not to happen ("they do not bolt", "neither leaves the yard"). */
const NOT_OFF = /\b(?:not|never|no|neither|nor|won't|don't|doesn't|didn't|isn't|aren't)\s+(?:\w+\s+)?$/i;
const goesOff = (sentence: string) => [...sentence.matchAll(OFF)].some(m => !NOT_OFF.test(sentence.slice(0, m.index)));

/**
 * A check's outcomes read against who holds what the player still needs (QA round qa2-1018, H4:
 * on a failed Persuasion roll Cob "recoils and bolts with Moll through the gate", and the scene ran
 * out of turns without its required lead): a failure that sends one of them out of the scene, by
 * name, by what the player calls them, or as "he" or "she" just after, is the other failure instead
 * when that one keeps them. When both do, they stand: the format and the per-turn note have said it.
 */
export function inReach(scene: Scene, view: TurnView, outcomes: Record<Band, string>): Record<Band, string> {
  const present = presentCast(scene, view);
  const who = present.filter(c => targetsOf(scene, view).some(b => b.required && b.paths?.some(p => p.via === c.id)));
  if (!who.length) return outcomes;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = who.flatMap(c => [...c.name.split(/\s+/).filter(w => w.length >= 3 && /^\p{Lu}/u.test(w) && !/^(?:Sergeant|Corporal|Master|Mister|Big|Old|Young|Little|Captain|Marshal|King|Queen)$/.test(w)), ...(c.aka ?? [])].map(w => new RegExp(`\\b${escape(w)}\\b`)).concat(c.called ? [c.called, shortOf(c.called)].map(w => new RegExp(`\\b${escape(w)}\\b`, "i")) : []));
  const sendsAway = (text: string) => {
    let named = false;
    for (const sentence of text.replace(/[“"][^”"]*[”"]/g, "…").split(/(?<=[.!?…])\s+/)) {
      const here = words.some(w => w.test(sentence));
      if (goesOff(sentence) && (here || (named && /\b(?:he|she|they)\b/i.test(sentence)))) return true;
      named = here;
    }
    return false;
  };
  const major = sendsAway(outcomes.major_failure), minor = sendsAway(outcomes.minor_failure);
  if (major && !minor) return { ...outcomes, major_failure: outcomes.minor_failure };
  if (minor && !major) return { ...outcomes, minor_failure: outcomes.major_failure };
  return outcomes;
}

/** A card's secret that's what shows of the rest ("Shows: … Torn: … Opens: … First: …"). */
const isTell = (secret: string) => /^Shows:/.test(secret.trim());

/** A card's tell: the first sentence of what its secrets say shows ("Shows: one fist kept tightly closed; …"). */
export function tellOf(secrets: string[]): string | undefined {
  const shows = secrets.find(isTell)?.trim().replace(/^Shows:\s*/, "");
  return shows ? firstSentence(shows) : undefined;
}

/** A secret's first sentence (a stop inside brackets or quoted words doesn't end it), at most 300 characters. */
export function firstSentence(text: string): string {
  let depth = 0;
  let quoted = false;
  const t = text.trim();
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    const before = t[i - 1] ?? " ", after = t[i + 1] ?? " ";
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    // A quote mark between letters is an apostrophe (Sallow's); otherwise it opens or closes quoted words.
    else if ((c === "'" || c === "‘" || c === "’") && !(/\p{L}/u.test(before) && /\p{L}/u.test(after))) {
      const closes: boolean = quoted && !(c === "‘" || (c === "'" && !/\p{L}/u.test(before) && /\p{L}/u.test(after)));
      quoted = !closes && (c === "‘" || (c === "'" && !/\p{L}/u.test(before)));
      // Quoted words that end their sentence ("…the proper channels.' Then…") end it there.
      if (closes && depth === 0 && /[.!?]/.test(before) && /^\s+[A-Z(‘“'"]/.test(t.slice(i + 1))) return clipped(t.slice(0, i + 1));
    } else if (depth === 0 && !quoted && /[.!?]/.test(c) && /^\s+[A-Z(‘“'"]/.test(t.slice(i + 1))) return clipped(t.slice(0, i + 1));
  }
  return clipped(t);
}

const clipped = (s: string) => (s.length > 300 ? `${s.slice(0, 299).replace(/\s+\S*$/, "")}…` : s);

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

/**
 * What the player's turn has in brackets or between asterisks (QA round qa1-1018: Cob quoted back
 * "first in gets first pick", the thief's reasoning in brackets, never said aloud): what their
 * character does or thinks, quoted for the reply, which nobody in the story hears as words.
 */
export function asidesNote(view: TurnView): string | undefined {
  const said = sceneEntries(view).findLast(e => e.kind === "player" && e.turn === view.turn)?.text;
  const asides = [...(said ?? "").matchAll(/\(([^()]*\p{L}[^()]*)\)|\*([^*]*\p{L}[^*]*)\*/gu)].map(m => (m[1] ?? m[2])!.trim().replace(/\s+/g, " "));
  if (!asides.length) return undefined;
  const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 199)}…` : s);
  return `## The player's turn\nIn the player's turn, ${asides.map(a => `(${clip(a)})`).join(" ")} ${asides.length === 1 ? "is" : "are"} what their character does or thinks, in the player's words, not words said aloud. People see what's done (and hear what the player says their character tells them), but nobody hears the thoughts or reasons in it: nobody answers, repeats or quotes those.`;
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
  const schema = replySchema(!!how.mayHold);
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
  const whole = out.check && SKILLS.includes(out.check.skill) && Number.isInteger(out.check.dc) && BANDS.every(b => typeof out.check!.outcomes?.[b] === "string");
  // Each outcome's names as the player knows them, and its failures kept from sending away whoever holds what the player still needs.
  const outcomes = whole ? inReach(scene, view, Object.fromEntries(BANDS.map(b => [b, asKnown(out.check!.outcomes[b], after).text])) as Record<Band, string>) : undefined;
  const check = whole && outcomes ? { skill: out.check!.skill, dc: out.check!.dc, outcomes: Object.fromEntries(BANDS.map(b => [b, said(outcomes[b])])) as Record<Band, Reply> } : undefined;
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
 * corporal and his cart were simply in the lane, never seen coming. One the story has already
 * played (a role brought it about before the co-GM took its route) isn't played again: in QA round
 * qa1-1018 Arlo made his third challenge twice, once by his role and again when it was moved to.
 */
export function movedDirective(scene: Scene, view: TurnView): string | undefined {
  const moved = view.twoPart.moved;
  const stage = stageOf(scene, view);
  if (!moved || moved !== stage.id) return undefined;
  const arriving = enteringAt(scene, stage.id).map(c => c.called ?? c.name);
  return `The scene has just moved on to "${stage.title}": ${stage.direction} Answer the player's turn first; then let it show in this reply${arriving.length ? `: ${arriving.join(" and ")} arrive${arriving.length === 1 ? "s" : ""} now, seen arriving` : ""}. If an earlier reply has already played it, it has happened: go on from it, and don't play it again.`;
}

/**
 * The wind-down's directive (the co-GM took a route to an ending; this reply answers the player and
 * closes). Once, it may wait: when the player has just started something the ending has to answer
 * (calling the killer down from the loft), that plays first and the scene closes on the next reply.
 * A fight's ending closes on the moment it breaks out (the game's words). Either way it goes on from
 * where the last reply ended, never staging it again, and the lines said there (`said`, saidLast's)
 * aren't said again (QA round qa1-1018: the Heron's close made Kell's arrest again in the same two
 * sentences, the ending's own words asking for "Kell's proper words", and the King's morning gave
 * its ruling twice).
 */
export function closingDirective(exit: Exit, mayHold: boolean, said: string[] = []): string {
  const done = `${GO_ON}${said.length ? ` Said there already, so not said again, in those words or others: ${said.join(" ")}` : ""}`;
  const close = `bring the scene to a close in a few sentences, where the player is now, landing on a moment that belongs to the player. ${done} Of what this ending should feel like, play only what your last reply didn't: ${exit.closing}${exit.kind === "combat" ? FIGHT_CLOSE : ""}`;
  return mayHold
    ? `The scene is ending: ${exit.outcome} First answer what the player just said or did. If they've just started something this ending has to answer first (a challenge, a confrontation, a new move that would change how it ends), play that and set \`closes\` to false: the scene closes on your next reply. Otherwise ${close} Set \`closes\` to true. ${STAY}`
    : `This reply closes the scene: ${exit.outcome} First answer what the player just said or did. Then ${close} ${STAY}`;
}

/**
 * Where a closing stays (QA round qa2-1018: the Heron's put the player out on the wharf mid-arrest
 * because its words leave them there, the Rat's walked on to the Heron's grille and through its door,
 * and the clerk's had Kell give Tull his order again because its words ask for it).
 */
const STAY = "Those words are how the ending should feel, not a script: where they ask for something your last reply already did (an order given, an arrest made), leave it out, and where they put the player somewhere they aren't (outside, on the wharf, at a door), close where the player is. Don't move the player anywhere they haven't gone themselves, and don't narrate beyond the ending: not the way to the next place, through a door they haven't gone through, arriving there, or anything that happens there.";

const GO_ON = "Your last reply's moment has happened (an arrest made, a ruling given, an order given, words said), even where it's what this ending should feel like: don't stage it again or say it again, but go on from where it ended.";

/** The lines said in the last reply, by who said them as the player knows them ([Kell] “Noted.”), each at most 200 characters: a closing doesn't say them again. */
export function saidLast(scene: Scene, view: TurnView): string[] {
  const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 199)}…”` : s);
  return sceneEntries(view).filter(e => e.turn === view.turn - 1 && e.kind === "narration").flatMap(e =>
    (e.marked?.speech ?? speechIn(e.text)).filter(l => l.speaker !== "you").map(l => `${l.speaker ? `[${nameAsKnown(scene, view, l.speaker) ?? l.speaker}] ` : ""}${clip(e.text.slice(l.start, l.end))}`));
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
      why: { type: "string", description: "What happened in the story that takes this route, in a sentence. (Never what hasn't happened: then don't call move_scene.)" },
    },
  },
};

const CO_GM_TOOLS = `## Your tools
- update_character_role: each character's role for the GM's next reply. While the scene is at a stage (where it starts, or the latest of its events), that stage's suggested roles are your default for each character; what a character remembers, wants, has been promised or owes, and what just happened, can give them a better reason, and then that wins. Keep each role to what they do or could reveal next, and what they hold back for now.
  - Write a role as behaviour the GM can show (what they do, say or want next, what they won't say) and what they hold back, never as analysis of the game: the GM voices what it's given, so "the promise has found his fear" ends up said aloud. Leave routes, beats and discoveries out of it.
  - Once something has happened in the story (a challenge made, a name given, a secret told), move everyone's role past it: nobody's role still has it to do, or it gets played twice.
  - A cue is brought about by taking its route (the GM shows it in the next reply), not by writing it into someone's role.
- move_scene: when what one of the open routes describes has happened in the story (a discovery's revelation has landed, or a cue's moment has come), take it. Only the routes listed as open can be taken. When the scene moves to a new stage, update the roles for it. Don't hold the scene at a stage the story has already moved past.
  - Take a route only when its condition has happened in the story as written, all of it. A condition about what the player does (makes the case, goes after someone, leaves) needs the player to have done it: someone else doing it for them, someone asking them to, or the player planning it isn't that.
  - Call move_scene only for a route whose moment has come, never to note that one hasn't: a route that hasn't happened needs no call, so don't go through them one by one.
  - When more than one open route fits, take the one whose ending matches what the player achieved. Each route into an ending says what's true there: read it against the story so far (a player who got the whole story out of someone has the ending where it was told, even if the way they leave matches another route's words).
  - Each cue says how far its outer limit has run. An overdue cue is brought about: take its route now, unless its condition says it's no longer needed.
  - If a reply has already played out what an open route describes (an event a role brought about), take that route now and write the roles from after it.
Then reply "done".`;

export function coGmInput(scene: Scene, view: TurnView, check: TurnCheck | undefined): Message[] {
  const stage = stageOf(scene, view);
  const present = presentCast(scene, view);
  const open = openRoutes(scene, view);
  const dice = check ? open.filter(r => r.skill === check.skill && r.dc === check.dc) : [];
  const notes = Object.entries(stage.cast ?? {}).filter(([id]) => present.some(c => c.id === id));
  return [{ role: "user", content: [
    `# The scene so far\n\n${scriptTranscript(scene, view)}`,
    `# Where the scene is: ${stage.title} [${stage.id}]\nIt's turn ${view.turn}: the scene has had ${view.turn} exchange${view.turn === 1 ? "" : "s"} since the opening (turn 0), and it has been at this stage for ${view.turnsInBeat} of them. Reached so far: ${reachedAt(view)}.${notes.length ? `\nSuggested roles while it's here:\n${notes.map(([id, n]) => `- ${id}: ${n}`).join("\n")}` : ""}`,
    `# The targets\nThe discoveries not reached yet:\n${targetsOf(scene, view).map(b => `- ${b.title} [${b.id}]${b.required ? " (required)" : ""}: ${b.revelation}`).join("\n") || "- (none: every discovery is reached)"}`,
    `# Open routes\n${open.map(r => routeLine(scene, r, { revelation: true, ending: true, now: view })).join("\n") || "- (none)"}`,
    ...(check ? [`# This turn's check\nThe GM called ${titleCase(check.skill)} DC ${check.dc}, and the roll came to ${check.total}: a ${check.success ? "success" : "failure"} (${check.band.replace("_", " ")}).${dice.length ? ` It is the check of ${dice.map(r => `[${r.id}]`).join(" and ")}: take ${dice.length === 1 ? "it" : "the one the player was attempting"} with outcome ${check.success ? "success" : "failure"} if that's what the player was attempting.` : ""}`] : []),
    ...(view.established.length ? [`# Established in play\n${view.established.map(f => `- ${f}`).join("\n")}`] : []),
    `# Current character roles\n\n${rolesBody(scene, view.twoPart.roles)}`,
    `# Who's on stage now\n${present.map(c => `- ${c.name} [${c.id}]`).join("\n")}`,
    `The GM's reply to turn ${view.turn} is the latest exchange. Update the roles that need it, and move the scene on if a route's moment has come.`,
  ].join("\n\n") }];
}

/** The nodes reached, in order, each with the turn it was reached on (the turn whose reply its move followed): "[start] (at the opening), [murder] (on turn 7)". The fake co-GM reads their ids off this line. */
function reachedAt(view: TurnView): string {
  const turns = reachedTurns(view);
  return reachedOf(view).map((id, i) => {
    const on = turns.get(id);
    return `[${id}]${i === 0 ? " (at the opening)" : on === undefined ? "" : ` (on turn ${on})`}`;
  }).join(", ");
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
  const companion = companionRoles(scene, view);
  return `${prompt("two-part-co-gm", { tone: tone(), beats: prepOf(scene, view, { coGm: true }), characters: charactersOf(scene, view, { coGm: true }) })}\n\n${companion ? `${companion}\n\n` : ""}${CO_GM_TOOLS}`;
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
      const why = String(args.why ?? "");
      // A cue's move is what brings it about; any other records what has happened, and one whose reason says it hasn't is refused.
      if (scene.routes.find(r => r.id === route)?.phase !== "cue" && deniesItself(why)) return `error: your reason says this hasn't happened, so [${route}] stays as it is: a move records what has happened in the story. If it has happened, say what happened; if not, leave it.`;
      const taken = takeRoute(scene, state, route, outcome, view.turn);
      if ("error" in taken) return `error: ${taken.error}`;
      state = taken.gm;
      moves.push({ route, outcome, why });
      return movedText(scene, state, taken.reached, view.turn);
    }
    const id = String(args.char_id);
    if (!scene.cast.some(c => c.id === id)) return `error: no character "${id}" (ids: ${scene.cast.map(c => c.id).join(", ")})`;
    roles[id] = { status: String(args.status ?? ""), mental_state: String(args.mental_state ?? ""), conversation_role: String(args.conversation_role ?? "") };
    return "ok";
  });
  return { roles, moves, log: result.calls.map(c => ({ name: c.name, args: c.args, result: typeof c.result === "string" ? c.result : JSON.stringify(c.result) })), costUsd: result.costUsd };
}

/**
 * What a move the co-GM made comes to, for it to go on from: an ending, a new stage (its suggested
 * roles, who arrives), a discovery made, or a check failed with nowhere to go; then the routes open
 * now, and any cue still overdue after the reply to `turn`, which a co-GM that had just recorded a
 * discovery would otherwise leave (QA round qa1-1018's probe).
 */
export function movedText(scene: Scene, gm: GmState, reached: string | undefined, turn: number): string {
  const open = () => {
    const routes = openRoutes(scene, gm);
    const overdue = routes.filter(r => limitOf(r, gm, turn)?.overdue);
    return `${routes.map(r => r.id).join(", ") || "none"}${overdue.length ? `. Still overdue: ${overdue.map(r => `[${r.id}]`).join(", ")}: bring ${overdue.length === 1 ? "it" : "them"} about now` : ""}`;
  };
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

/**
 * A move's reason that says what it records hasn't happened ("Not yet: Hobb hasn't been asked his
 * master's name", "No discovery: the player hasn't found the page", "but he has not yet explained
 * its entries", "do not move this discovery"). QA round qa1-1018's co-GM gave six in eight games,
 * each taking a discovery the player hadn't made or a way in they hadn't taken, and its replays more.
 * The ways of saying it are those the round used: on its 45 moves they catch the six and nothing else.
 */
export function deniesItself(why: string): boolean {
  return [
    /^\W*(?:not (?:yet )?(?:reached|happened|landed|revealed)|not yet|no discovery|nothing (?:has )?happened)\b/i,
    /\b(?:has|have|had|is|are|was|were)(?: not|n't) yet\b/i,
    /\bnot yet (?:been|reached|landed|revealed|happened)\b/i,
    /\bno one has (?:yet )?(?:revealed|discovered|found|said|told|shown|asked|offered|sought)\b/i,
    /\b(?:do|should|must)(?: not|n't) (?:move|take)\b/i,
    /\b(?:has|have)(?: not|n't) (?:yet )?happened\b/i,
  ].some(p => p.test(why));
}
