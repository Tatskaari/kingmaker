// Copied from the prototype at 44c6d4a: src/runtime/talk.ts (the AI service's half: facts 82-98, knewThere 106-113, confidences 166-175, inTheStory 182-196, earlierTalks 199-205, sift 216-244, plan 251-309, prepare 315-346, choices 349-354, suggest 391-411, and endTalk's memory 431-437) and scenes/talk.ts (section and firstParagraph 37-50, talkScene's words from lore 58-87), with the usual edits: a TurnView for the SessionState, each call through the request's calls (respond, respondJson, and the director's decider: luna-decisions, the v2 approach's), the story's scenes (gm/story.ts) for SCENES and sceneById. What's the simulation's isn't here: startTalk, talkTurn, leaveTalk and endTalk's rows (a talk is a scene row of its own, and the waiting scene is never touched, so nothing is set aside or put back). So startTalk's facts are talkFacts, for the greeting; prepare returns the TalkPrep the open's commit keeps (withhold's note in its withheld) instead of writing the session; the next lines are asked in the settle (talkLines); and endTalk's memory of telling it is written by the settle that finds it told (rememberTold: once, a line of the GM's notes on them). talkScene fills the campaign's talk template (scenes/talk/, with shared/scene/talk.ts) and gives the companion their lore's look and voice.

import { characterEntry, linksIn, permitted, readDoc, seedDoc, titleOf, type Doc } from "../docs/docs.ts";
import { gmNotes, note } from "../docs/notes.ts";
import { dirname, join } from "../docs/paths.ts";
import type { Decider } from "../llm/decide.ts";
import { respond, respondJson, type CallContext } from "../llm/openrouter.ts";
import { GUARD_STAGES, type Confide, type GuardStage, type ScenePatch, type TalkRecord, type TalkState } from "../../shared/gm/state.ts";
import type { TalkOpen, TalkPrep } from "../../shared/protocol/ai.ts";
import type { SceneDocument } from "../../shared/scene/document.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import { nameTokens } from "../../shared/scene/names.ts";
import { CONFIDED, talkOf, talkSceneDocument, TOLD } from "../../shared/scene/talk.ts";
import type { Character, Scene } from "../../shared/scene/types.ts";
import { playerWho, sceneEntries, scriptTranscript } from "./brief.ts";
import type { TurnView } from "./view.ts";

/**
 * A word with a companion between scenes, as a cRPG has it at camp: the player stops beside
 * someone walking with them on the map and talks, in free text or by choosing one of a few
 * suggested lines. It's a scene built from the companion's lore (the campaign's talk template),
 * played by the ordinary turn, while the scene the story is heading for waits as it was: the
 * story's lead stays the lead, and nothing in the talk moves it.
 *
 * Backstory comes slowly, through the GM's own machinery rather than a system of its own:
 * - At the start of each talk, one small call (alongside the greeting) reads how things stand
 *   between them (the GM's notes on them), what they've told already, anywhere, and how
 *   many times the two have talked, and picks the one thing they might open up about this time: a
 *   note of their lore not yet told. It goes on their card as what they're keeping back, and the
 *   GM is told by name what's already been told and what may come out now.
 * - Staged secrets move it out a step at a time (something shows, guard up, torn, told), judged
 *   after each reply as in any scene, starting as near the surface as the prep says it is. How far
 *   they got carries over to the next talk that turns to it.
 * - Once it's out (an outcome only they can give, judged after a reply), the talk moves to its
 *   "told" beat, and it goes in the talk record and the GM's notes on them: never told twice, not in a
 *   later talk and not in a scene of the story either.
 * Each reply also brings the next few dialogue choices: one small call, alongside the after-reply
 * decision, so a talk's turn takes no longer than a scene's.
 */

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`;
const firstName = (name: string) => name.split(" ")[0] ?? name;
const companionOf = (scene: Scene) => scene.cast.find(c => c.id === scene.companion) ?? scene.cast[0]!;

// ---------------------------------------------------------------------------------------------
// The talk scene (scenes/talk.ts): the campaign's template, filled for the companion, their look
// and voice from their lore.

/** A "## " section of a lore doc as one line, by the heading's opening words. */
function section(doc: Doc | undefined, heading: string): string | undefined {
  const lines = doc?.body.split("\n") ?? [];
  const start = lines.findIndex(l => l.startsWith(`## ${heading}`));
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).map(l => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean).join(" ") || undefined;
}

/** The first paragraph under a doc's title. */
const firstParagraph = (doc: Doc | undefined) => doc?.body.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !p.startsWith("#"));

/**
 * The talk scene for an id ("talk-kell-2"), or undefined when it isn't one, or the companion has no
 * lore. `template` is the campaign's talk template (scenes/talk.kmscene); `authored` finds the
 * companion's card in a scene of the story, for what lore doesn't say: the statblock and weapon the
 * rules would use.
 */
export function talkScene(sceneId: string, template: SceneDocument, authored?: (id: string) => Character | undefined): Scene | undefined {
  const talk = talkOf(sceneId);
  const entry = talk ? characterEntry(talk.companion) : undefined;
  if (!talk || !entry) return undefined;
  const lore = seedDoc(entry);
  const face = seedDoc(join(dirname(entry), "public.md"));
  const card = authored?.(talk.companion);
  const name = lore ? titleOf(lore) : card?.name ?? talk.companion;
  const who = { id: talk.companion, name, ...(card?.statblock ? { statblock: card.statblock } : {}), ...(card?.weapon ? { weapon: card.weapon } : {}) };
  const scene = sceneOf(talkSceneDocument(template, who, talk.n));
  const [companion, ...rest] = scene.cast;
  return {
    ...scene,
    cast: [{
      ...companion!,
      look: section(face, "Look") ?? firstParagraph(face) ?? card?.look ?? companion!.look,
      voice: section(lore, "Voice") ?? card?.voice ?? companion!.voice,
    }, ...rest],
  };
}

// ---------------------------------------------------------------------------------------------
// What the talk's GM takes as given.

/**
 * What the talk's GM takes as given as the talk opens (startTalk's): where and when, how often
 * they've talked, where the story goes next, and what the companion knew in the story's scenes.
 * The prep, once it's in, says more (prepare).
 */
export function talkFacts(state: TurnView, scene: Scene, talk: TalkOpen): string[] {
  const name = companionOf(scene).name;
  return [...facts(state, name, talk.record, talk.where, talk.lead), ...knewThere(state, talk.with, name)];
}

/**
 * What the talk's GM takes as given: where and when, how often they've talked, where the story goes
 * next, what they've already told of their own story (`told`, from the prep; the talk record's
 * otherwise), the one part of it they might open up about now (`topic`), and the deepest part,
 * kept back for a later talk (`held`), by name.
 */
function facts(state: TurnView, name: string, record: TalkRecord, where: string, lead: string | undefined, told: string[] = [], topic?: string, held?: Doc): string[] {
  const player = state.player.name;
  const already = [...new Map([...record.told.map(t => t.topic), ...told].map(t => [t.toLowerCase(), t])).values()];
  return [
    `Where and when: ${where}. Time has passed since the last scene ended; the story's next place is still ahead.`,
    record.count === 1
      ? `This is the first time ${player} has stopped for a word with ${name} between scenes.`
      : `This is the ${ordinal(record.count)} time ${player} has stopped for a word with ${name} between scenes.`,
    // What the lead says the companion did or told is theirs: Kell flatly denied the sighting it gave her.
    ...(lead ? [`Where the story goes next, and how the time since passed, as ${player} knows it: ${lead} That's what happened: whatever it says ${name} did, saw or told ${player}, they did, saw and told, and they stand by it in their own words (if it comes up, they say what they know of it, once).`] : []),
    ...(already.length ? [`Of their own story, ${name} has already told ${player}: ${already.join("; ")}. Told is told: if it comes up again, even asked for, a line back to it at most ("You know that one."), never the story or its words again.`] : []),
    topic
      ? `In this talk, the only part of their own story ${name} may open up about is ${topic} (what they're keeping back, on their card), and only as far as they've opened up; the rest of their past stays theirs for now.`
      : `In this talk ${name} keeps their own story to themselves: what anyone could know of them, and no more.`,
    ...(held ? [`Not in this talk, however it comes up: the deepest of ${name}'s own story (their note "${titleOf(held)}": ${held.meta.summary || "what it holds"}). It comes in a later talk, once things stand well between them. Asked about it now, they take the question as asked and decline it, not even the gist: a non-answer in their own manner ("Another time."), without lying, and the talk moves on.`] : []),
  ];
}

/**
 * What the companion knew in the last scene of the story they were in (their card there, still
 * true), for the talk's GM, which otherwise has only their lore and the GM's notes: asked how she knew the
 * thief's real name, Kell made something up, then wouldn't say, though her card at the granary had
 * it plainly (a palace page came to the watch house with it).
 */
function knewThere(state: TurnView, companion: string, name: string): string[] {
  for (const h of [...state.history].reverse()) {
    const scene = state.story?.scene(h.sceneId);
    const card = scene?.cast.find(c => c.id === companion);
    if (scene && card?.knows.length) return [`What ${name} knew in ${scene.title} (their prep there, as things stood then; what's happened since is the story's): ${card.knows.join(" ")} It's theirs to tell, as they would, when it comes up.`];
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// The prep, alongside the greeting.

interface Plan { told: string[]; standing: string; willing: "yes" | "no"; note: string; topic: string; what: string; shows: string; opens: string; ready: keyof typeof READY; memory: string; suggestions: string[] }

/** How readily they'd tell it, as the staged secrets' stage it starts from (each step is a reply in which the player gives them reason). */
const READY: Record<string, GuardStage> = { when_asked: "torn", asked_twice: "stirred", picked_at: "tell", not_yet: "surface" };

/** Has it come out? The route was taken, or the staged secret settled. */
export const toldIt = (state: Pick<TurnView, "path" | "guard">, companion: string) => state.path.some(p => p.via === CONFIDED) || state.guard?.[companion]?.stage === "settled";

/**
 * What a companion might open up about, each once: their own notes (what they know and believe of
 * people and things that matter to them). Their lore entry holds all of them at once, so it's a
 * candidate only for someone with no notes.
 */
export function confidences(state: TurnView, companion: string): Doc[] {
  const entry = characterEntry(companion);
  const lore = entry ? readDoc(state.id, entry) : undefined;
  if (!entry || !lore) return [];
  const own = `${dirname(entry)}/`;
  const notes = linksIn(state.id, lore).filter(l => l.path.startsWith(own) && !l.path.includes("/memories/"))
    .map(l => readDoc(state.id, l.path)).filter((d): d is Doc => !!d && d.meta.visibility === "private" && permitted(d, `character:${companion}`));
  const told = new Set(state.talks?.[companion]?.told.map(t => t.note));
  return (notes.length ? notes : [lore]).filter(d => !told.has(d.path));
}

/**
 * What the companion said and did in the story's own scenes: the replies that mention them, with
 * what the player said just before, the latest last. A hand-off between scenes can leave out a word
 * they let slip, and told is told.
 */
function inTheStory(state: TurnView, companion: Character): string {
  const names = nameTokens(companion).map(t => new RegExp(`\\b${t}\\b`));
  const passages: string[] = [];
  let asked = "";
  for (const e of state.transcript) {
    if (!e.scene || talkOf(e.scene)) continue;
    if (e.kind === "player") { asked = `${state.player.name} (player): ${e.text}`; continue; }
    const theirs = e.kind === "dialogue" ? e.speaker === companion.id : e.kind === "narration" && names.some(n => n.test(e.text));
    if (!theirs) continue;
    passages.push([asked, e.kind === "dialogue" ? `${companion.name}: ${e.text}` : e.text].filter(Boolean).join("\n"));
    asked = "";
  }
  const text = passages.join("\n\n");
  return text.length > 12000 ? `…${text.slice(-12000)}` : text;
}

/** The companion's earlier talks with the player, word for word (each a talk with them: this talk's title and cast). */
function earlierTalks(state: TurnView, scene: Scene, companion: string): string {
  const talks = [...new Set(state.transcript.map(e => e.scene ?? "").filter(id => id !== state.sceneId && talkOf(id)?.companion === companion))];
  return talks.map(id => `### ${scene.title} (${id})\n${scriptTranscript(scene, state, state.transcript.filter(e => e.scene === id && e.kind !== "system"))}`).join("\n\n");
}

/** The talk from which what would cost them most to tell can come out: two talks at least come before it. */
const DEEPEST_FROM = 3;

/**
 * Which of their notes are still theirs to tell (one decision, a question per note, alongside the
 * greeting): a note whose heart they've already told, anywhere, is out, and so is the one that
 * would cost them most, until the talks have built up to it. A hand-off, or a model choosing on
 * its own, can't be trusted to keep either.
 */
async function sift(state: TurnView, scene: Scene, talk: TalkOpen, candidates: Doc[], decider: Decider): Promise<{ open: Doc[]; held?: Doc }> {
  const name = companionOf(scene).name;
  if (!candidates.length) return { open: [] };
  const label = (d: Doc) => `${titleOf(d)}${d.meta.summary ? `: ${d.meta.summary}` : ""}`;
  const entry = characterEntry(talk.with);
  const truth = entry ? readDoc(state.id, join(dirname(entry), "gm.md")) : undefined;
  const decision = await decider.decide([
    `# ${name}, a companion in a roleplaying game, and what they've told the player of their own story so far`,
    ...(truth ? [`## The truth about them (the GM's notes)\n${truth.body}`] : []),
    `## What they said and did in the story's scenes (the replies that mention them)\n${inTheStory(state, companionOf(scene)) || "(nothing yet)"}`,
    `## Their earlier talks with the player between scenes\n${earlierTalks(state, scene, talk.with) || "(none)"}`,
    `## What they've told the player in earlier talks\n${state.talks?.[talk.with]?.told.map(t => `- ${t.topic}`).join("\n") || "(nothing yet)"}`,
  ].join("\n\n"), {
    deepest: {
      instructions: `Which of these notes of ${name}'s holds what it would cost them most to tell the player: the secret at the heart of them (the GM's notes say what it is)?`,
      criteria: Object.fromEntries(candidates.map((d, i) => [`note_${i + 1}`, label(d)])),
    },
    ...Object.fromEntries(candidates.map((d, i) => [`told_${i + 1}`, {
      instructions: `Judge only by what's above. Has ${name} already told the player the heart of this, in their own words (more than a passing mention)? ${label(d)}`,
      criteria: { told: "Yes: they've told the player the heart of it.", not_yet: "No: not yet, or only in passing." },
    }])),
  }, "talk.sift");
  const yes = (id: string, choice: string, p = 0.6) => decision.answers[id]?.choice === choice && (decision.answers[id]?.probabilities?.[choice] ?? 1) >= p;
  const told = new Set(candidates.filter((_, i) => yes(`told_${i + 1}`, "told")));
  const deepest = candidates.find((d, i) => yes("deepest", `note_${i + 1}`, 0.4) && !told.has(d));
  const held = (state.talks?.[talk.with]?.count ?? 1) < DEEPEST_FROM ? deepest : undefined;
  return { open: candidates.filter(d => !told.has(d) && d !== held), ...(held ? { held } : {}) };
}

/**
 * Alongside the greeting: which notes are still theirs to tell (the sift), then one call for the
 * one thing they might open up about this time, and the opening choices. `held`: the deepest of
 * their story, kept back from this talk.
 */
export async function planTalk(state: TurnView, scene: Scene, talk: TalkOpen, how: { calls: CallContext; decider: Decider }): Promise<{ prep: Plan; held?: Doc }> {
  const name = companionOf(scene).name;
  const record = talk.record;
  const entry = characterEntry(talk.with)!;
  const all = confidences(state, talk.with);
  const sifted = await sift(state, scene, talk, all, how.decider).catch((): { open: Doc[]; held?: Doc } => ({ open: all }));
  const candidates = sifted.open;
  const told = record.told;
  // The GM's truth about them is for when the deepest may come out; before then it only tempts.
  const gm = record.count >= DEEPEST_FROM ? readDoc(state.id, join(dirname(entry), "gm.md")) : undefined;
  const notes = gmNotes(state.id, talk.with);
  const earlier = earlierTalks(state, scene, talk.with);
  const input = [
    `# A talk with ${name} between scenes: the prep`,
    `## Their lore entry (${entry}): who they are, written to them\n${readDoc(state.id, entry)?.body ?? "(none)"}`,
    ...(candidates.length ? [`## The notes they might open up about now: what they know and believe\n${candidates.map(d => `### ${d.path}\n${d.body}`).join("\n\n")}`] : []),
    ...(gm ? [`## The truth about them (the GM's notes)\n${gm.body}`] : []),
    `## How things stand: the GM's notes on them from play (how they stand with the player and why, what they've seen and learned, promises, what they did)\n${notes ?? "(nothing yet)"}`,
    `## What they've already told the player of their own story\n${told.length ? told.map(t => `- ${t.topic} (${t.note})`).join("\n") : "(nothing yet)"}`,
    `## Their earlier talks with the player between scenes, word for word\n${earlier || "(none: this is their first)"}`,
    `## The story so far (the hand-offs between scenes)\n${state.history.map(h => h.summary).join("\n\n") || "(it's just begun)"}`,
    `## What they said and did in the story's scenes (the replies that mention them, the latest last)\n${inTheStory(state, companionOf(scene)) || "(nothing yet)"}`,
    `## This talk\nThe ${ordinal(record.count)} time the player has stopped for a word with ${name} between scenes. Where and when: ${talk.where}.\nWhat they'd open up about next is in one of these notes: ${candidates.map(d => `${d.path} (${titleOf(d)})`).join("; ") || "(none left)"}.`,
    `## The player character\n${playerWho(state)}`,
  ].join("\n\n");
  const prep = await respondJson<Plan>({
    operation: "talk.plan", effort: "none", maxOutputTokens: 800,
    instructions: [
      `You prepare a short talk between the player character of a roleplaying game and ${name}, who walks with them between the scenes of the story: the kind of conversation a cRPG offers with a companion between quests. The player gets to know ${name} slowly, as with a real person: each talk opens one more thing at most, and nothing is told twice.`,
      `- told: what ${name} has already told the player of their own story, anywhere (look through the replies from the story's scenes and the earlier talks, not only the hand-offs), each in a few words ("Prout came to her three days before he died"); empty if nothing yet.`,
      `- standing: how things stand between ${name} and the player now, in a sentence, from the GM's notes on them and the story so far.`,
      `- willing: whether ${name} would open up about any of their own story in this talk: yes, unless things stand badly between them (distrust, hurt, anger) or there's nothing left they'd tell.`,
      `- note: the one thing about themselves ${name} would open up about next, as the note it's in (one listed under "This talk"). Their own story: what happened to them, what someone means to them, why something matters to them. Pace it as a good cRPG paces a companion: the first talks open small things (someone they're fond of, an old embarrassment, a habit and where it comes from), and what costs them more comes later, once things stand well between them. Within that, choose by what's in the air after the story so far.`,
      `- topic: that thing in a few words, in the third person ("the door at the Drowned Rat", "why she lets Cob go").`,
      `- what: what they'd tell, in a sentence or two in the third person: the heart of that note, from what it says.`,
      `- shows: how it shows before it comes out, in a few words (going still at a name, a dodge).`,
      `- opens: what would bring it out: the question or the moment.`,
      `- ready: how readily they'd tell it this time, from what it costs them and how things stand. when_asked: they'd tell it as soon as the player asks (most small things, and anything once trust is there). asked_twice: asked, they hold back a moment, and tell it if the player asks again. picked_at: it shows when the talk comes near it, and the player has to pick at it a while. not_yet: it would take a great deal, this time.`,
      `- memory: if they tell it, how they'd remember having told it, in one sentence in their own voice.`,
      `- suggestions: 2 to 4 lines the player might open the talk with, like a cRPG's dialogue choices: in the player character's own voice, plain speech without quotes, under 15 words each, each about something different: one about ${name}'s own life or past (not the story), one about the story so far, one about someone they've met. One of them may lead towards the thing above without naming what it is. Nothing ${name} has already told them.`,
    ].join("\n"),
    input: [{ role: "user", content: input }],
    json: { name: "talk", schema: {
      type: "object", additionalProperties: false, required: ["told", "standing", "willing", "note", "topic", "what", "shows", "opens", "ready", "memory", "suggestions"],
      properties: {
        told: { type: "array", items: { type: "string" } },
        standing: { type: "string" },
        willing: { type: "string", enum: ["yes", "no"] },
        note: { type: "string", enum: candidates.length ? candidates.map(d => d.path) : ["none"] },
        topic: { type: "string" }, what: { type: "string" }, shows: { type: "string" }, opens: { type: "string" },
        ready: { type: "string", enum: Object.keys(READY) },
        memory: { type: "string" },
        suggestions: { type: "array", items: { type: "string" } },
      },
    } },
    calls: how.calls,
  });
  return { prep, ...(sifted.held ? { held: sifted.held } : {}) };
}

/**
 * The prep takes effect: what they've told already and the one thing they might tell now go into
 * what the GM takes as given, and that one thing goes on their card, as near the surface as it is;
 * the deepest, held back, is named as not this talk's and its note withheld. Returned for the open's
 * commit to keep (the prototype wrote it to the session); the opening choices only when lines are
 * suggested (the controller's setting).
 */
export function prepareTalk(state: TurnView, scene: Scene, talk: TalkOpen, planned: { prep: Plan; held?: Doc }): TalkPrep {
  const { prep, held } = planned;
  const name = companionOf(scene).name;
  const record = talk.record;
  const suggestions = talk.suggest ? choices(prep.suggestions ?? []) : [];
  const told = (prep.told ?? []).map(t => t.trim().replace(/\.$/, "")).filter(Boolean);
  // The deepest stays out of the talk however it comes up: named as not this talk's, and its note withheld.
  const withheld = held ? [held.path] : [];
  const note = prep.willing === "yes" ? confidences(state, talk.with).find(d => d.path === prep.note && d.path !== held?.path) : undefined;
  const knew = knewThere(state, talk.with, name);
  if (!note || !prep.what?.trim()) return { established: [...facts(state, name, record, talk.where, talk.lead, told, undefined, held), ...knew], patches: [], withheld, suggestions };
  const topic = prep.topic?.trim() || titleOf(note);
  const confide: Confide = { note: note.path, topic, what: prep.what.trim(), memory: prep.memory?.trim() || `I told ${state.player.name} about ${topic}.` };
  const secret = [prep.what.trim(), prep.shows?.trim() ? `It shows first as: ${prep.shows.trim().replace(/\.$/, "")}.` : "", prep.opens?.trim() ? `What would bring it out: ${prep.opens.trim().replace(/\.$/, "")}.` : ""].filter(Boolean).join(" ");
  const patches: ScenePatch[] = [
    { turn: state.turn, why: `What ${name} might open up about in this talk: ${topic}.`, cast: { id: talk.with, secrets: [secret] } },
    // Once it's out (judged after a reply, never handed over on the player's say-so), the talk moves on.
    { turn: state.turn, why: `${topic}, once told.`, transition: { beat: scene.start, transition: {
      id: CONFIDED, on: "outcome", given: true, to: TOLD,
      // Told over a reply or two, and in their own words, not the prep's: the heart of it is what counts.
      when: `By now (in this reply or an earlier one), ${name} has told ${state.player.name} about ${topic}: the heart of it, in their own words, even if not every detail (${prep.what.trim()})`,
      establishes: [`${name} has told ${state.player.name} about ${topic}.`],
    } } },
  ];
  // As readily as the prep says, or as far as an earlier talk already brought it.
  const ready = READY[prep.ready] ?? "surface";
  const carried = record.stages?.[note.path];
  const stage = carried && GUARD_STAGES.indexOf(carried) > GUARD_STAGES.indexOf(ready) ? carried : ready;
  return { established: [...facts(state, name, record, talk.where, talk.lead, told, topic, held), ...knew], patches, guard: { stage, turn: state.turn }, confide, withheld, suggestions };
}

/** Dialogue choices as the player sees them: plain lines, no quotes, none of the GM's markup (anything in square brackets), no repeats, four at most. */
function choices(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.map(l => l.trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim())
    .filter(l => l && l.length <= 160 && !/[[\]]/.test(l) && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .slice(0, 4);
}

// ---------------------------------------------------------------------------------------------
// After a reply.

/** The next dialogue choices, from the talk so far (the reply included): talk.suggest, beside the after-reply decision. */
export async function talkLines(state: TurnView, scene: Scene, talk: TalkState, calls: CallContext): Promise<{ lines: string[]; costUsd: number }> {
  const name = companionOf(scene).name;
  const told = state.talks?.[talk.with]?.told ?? [];
  const keeping = talk.confide && state.guard?.[talk.with]?.stage !== "settled" ? talk.confide : undefined;
  const story = state.history.slice(-2).map(h => h.summary).join("\n\n");
  // Plain lines, not JSON: structured output costs about a second more before the first word.
  const result = await respond({
    operation: "talk.suggest", effort: "none", maxOutputTokens: 300,
    instructions: `You suggest what the player might say next in a conversation with ${name} in a roleplaying game, like the dialogue choices a cRPG offers. Give 2 to 4 short lines in the player character's own voice (plain speech without quotes, under 15 words each), one per line and nothing else. Each raises something the player hasn't asked in this conversation, and no two are about the same thing: a follow-up to what ${name} just said, something about ${name}'s own life or past (not the story), the story so far, someone the player has met. Lines a player would really want to say, curious, warm, wry or pointed, as the player character would be. Never something ${name} has already told them, and no goodbyes (that choice is always there). The player character's past is their own: a line may tell ${name} of it, never ask ${name} about it as if it were ${name}'s.`,
    input: [{ role: "user", content: [
      `## The player character (who says these lines: their past is theirs, not ${name}'s)\n${playerWho(state)}`,
      ...(story ? [`## The story so far (the latest hand-offs between scenes)\n${story}`] : []),
      ...(told.length ? [`## What ${name} has already told them of their own story (don't ask again)\n${told.map(t => `- ${t.topic}`).join("\n")}`] : []),
      ...(keeping ? [`## What ${name} might open up about in this talk (one line may lead towards it without naming it)\n${keeping.topic}`] : []),
      `## The conversation so far\n${scriptTranscript(scene, state, sceneEntries(state).filter(e => e.kind !== "system"))}`,
    ].join("\n\n") }],
    calls,
  });
  return { lines: choices(result.text.split("\n").map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""))), costUsd: result.costUsd };
}

/**
 * The one thing they were keeping back is out: it goes in the GM's notes on them, under what they
 * did, so no scene of the story has them tell it as news either (endTalk's memory, written once it's
 * told rather than as the talk ends, since the simulation ends the talk: once, a line the notes have
 * already being kept as it is). True when it was written now.
 */
export function rememberTold(state: TurnView, scene: Scene, talk: TalkState): boolean {
  if (!talk.confide) return false;
  const name = companionOf(scene).name;
  try {
    return note(state.id, { id: talk.with, name }, "did", `Told ${firstName(state.player.name)} about ${talk.confide.topic}, in a word between scenes (${talk.where}).`, { origin: { scene: state.sceneId, turn: state.turn } }).did !== "kept";
  } catch {
    return false; // the talk record still has it
  }
}
