import { dirname, join } from "node:path";
import { deciderFor } from "../llm/decide.ts";
import { respond, respondJson } from "../llm/openrouter.ts";
import { sceneApproach } from "./approaches.ts";
import { withhold } from "../lore/disclosure.ts";
import { characterEntry, linksIn, memoryLines, permitted, readDoc, saveMemory, titleOf, type Doc } from "../lore/docs.ts";
import { SCENES, sceneById } from "../../scenes/index.ts";
import { talkOf, talkSceneId, TOLD } from "../../scenes/talk.ts";
import { nameTokens, playerWho, sceneEntries, scriptTranscript } from "./brief.ts";
import { GUARD_STAGES, type Mechanic } from "./director.ts";
import { playerTurn, pushReply, type TurnHooks, type TurnResult } from "./engine.ts";
import type { Character, Scene } from "./scene.ts";
import { saveSession, snapshotSession, type Entry, type SessionState, type Stage, type TalkRecord } from "./session.ts";
import { gmReply } from "./voices.ts";
import type { Markup } from "./markup.ts";

/**
 * A word with a companion between scenes, as a cRPG has it at camp: the player stops beside
 * someone walking with them on the map and talks, in free text or by choosing one of a few
 * suggested lines. It's a scene built from the companion's lore (scenes/talk.ts), played by the
 * ordinary turn (playerTurn), with the scene the story is heading for put aside until it's over:
 * the story's lead stays the lead, and nothing in the talk moves it.
 *
 * Backstory comes slowly, through the runtime's own machinery rather than a system of its own:
 * - At the start of each talk, one small call (alongside the greeting) reads how things stand
 *   between them (their memories of the player), what they've told already, anywhere, and how
 *   many times the two have talked, and picks the one thing they might open up about this time: a
 *   note of their lore not yet told. It goes on their card as what they're keeping back, and the
 *   GM is told by name what's already been told and what may come out now.
 * - Staged secrets move it out a step at a time (something shows, guard up, torn, told), judged
 *   after each reply as in any scene, starting as near the surface as the prep says it is. How far
 *   they got carries over to the next talk that turns to it.
 * - Once it's out (an outcome only they can give, judged after a reply), the talk moves to its
 *   "told" beat, and it goes in the talk record and their memories: never told twice, not in a
 *   later talk and not in a scene of the story either.
 * Each reply also brings the next few dialogue choices: one small call, alongside the after-reply
 * decision, so a talk's turn takes no longer than a scene's (which waits on the stage manager).
 */

/** What a session keeps across scenes (the story, the dice, the sheet, the talks): a talk shares it. */
const STORY_WIDE = new Set(["id", "approach", "seed", "rollCount", "player", "turn", "transcript", "metrics", "rules", "history", "speculation", "lateRepairs", "talk", "talks", "owed"]);

/** Everything else is the waiting scene's own: set aside as it is, and put back as it was. */
function sceneOwn(state: SessionState): Partial<SessionState> {
  return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => !STORY_WIDE.has(key))))) as Partial<SessionState>;
}

function clearSceneOwn(state: SessionState): void {
  for (const key of Object.keys(state)) if (!STORY_WIDE.has(key)) delete (state as unknown as Record<string, unknown>)[key];
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`;
const firstName = (name: string) => name.split(" ")[0] ?? name;
const companionOf = (scene: Scene) => scene.cast.find(c => c.id === scene.companion) ?? scene.cast[0]!;

/**
 * The talk begins (synchronously, so a UI can show it opening at once): the scene the story is
 * heading for is set aside, and the talk is the scene now. `where` is where and when, as the map has it.
 */
export function startTalk(state: SessionState, companion: string, where: string): void {
  if (state.talk) throw new Error(`Already talking with ${state.talk.with}.`);
  const record = ((state.talks ??= {})[companion] ??= { count: 0, told: [] });
  record.count++;
  const waiting = sceneOwn(state);
  clearSceneOwn(state);
  const scene = sceneById(talkSceneId(companion, record.count));
  Object.assign(state, {
    sceneId: scene.id, beat: scene.start, turnsInBeat: 0, path: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], whispers: [], entered: [], absent: [], memory: { opened: [] }, landed: [], hinted: [], guard: {},
    established: [...facts(state, companionOf(scene).name, record, where, waiting.lead), ...knewThere(state, companion, companionOf(scene).name)],
  } satisfies Partial<SessionState>);
  state.talk = { with: companion, where, waiting, suggestions: [] };
}

/**
 * What the talk's GM takes as given: where and when, how often they've talked, where the story goes
 * next, what they've already told of their own story (`told`, from the prep; the talk record's
 * otherwise), the one part of it they might open up about now (`topic`), and the deepest part,
 * kept back for a later talk (`held`), by name.
 */
function facts(state: SessionState, name: string, record: TalkRecord, where: string, lead: string | undefined, told: string[] = [], topic?: string, held?: Doc): string[] {
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
 * true), for the talk's GM, which otherwise has only their lore and memories: asked how she knew the
 * thief's real name, Kell made something up, then wouldn't say, though her card at the granary had
 * it plainly (a palace page came to the watch house with it).
 */
function knewThere(state: SessionState, companion: string, name: string): string[] {
  for (const h of [...state.history].reverse()) {
    const scene = SCENES.find(s => s.id === h.sceneId);
    const card = scene?.cast.find(c => c.id === companion);
    if (scene && card?.knows.length) return [`What ${name} knew in ${scene.title} (their prep there, as things stood then; what's happened since is the story's): ${card.knows.join(" ")} It's theirs to tell, as they would, when it comes up.`];
  }
  return [];
}

const speak = (hooks: TurnHooks) => {
  let started = false;
  return (text: string, markup?: Markup) => {
    if (!started) { started = true; hooks.onSpeaker?.("gm", "narration"); }
    hooks.onText?.(text, markup);
  };
};

function push(state: SessionState, hooks: TurnHooks, entry: Omit<Entry, "turn" | "scene">): Entry {
  const full: Entry = { turn: state.turn, scene: state.sceneId, ...entry };
  state.transcript.push(full);
  hooks.onEntry?.(full);
  return full;
}

/**
 * The companion's greeting, and alongside it the talk's prep: what they might open up about this
 * time, how near the surface it is, and the opening dialogue choices.
 */
export async function openTalk(state: SessionState, hooks: TurnHooks = {}): Promise<Entry[]> {
  const scene = sceneById(state.sceneId);
  const before = state.transcript.length;
  const [greeting, prep] = await Promise.allSettled([
    gmReply(scene, state, [`Open the talk. ${scene.opening}`], speak(hooks), "gm.talk.opening"),
    plan(state, scene),
  ]);
  if (prep.status === "fulfilled") prepare(state, scene, prep.value.prep, prep.value.held);
  // Nothing is saved on a failed greeting: the game's saved state is still from before the talk.
  if (greeting.status === "rejected") throw greeting.reason;
  await pushReply(scene, state, hooks, greeting.value, e => push(state, hooks, e));
  saveSession(state);
  snapshotSession(state);
  return state.transcript.slice(before);
}

interface Plan { told: string[]; standing: string; willing: "yes" | "no"; note: string; topic: string; what: string; shows: string; opens: string; ready: keyof typeof READY; memory: string; suggestions: string[] }

/** How readily they'd tell it, as the staged secrets' stage it starts from (each step is a reply in which the player gives them reason). */
const READY: Record<string, Stage> = { when_asked: "torn", asked_twice: "stirred", picked_at: "tell", not_yet: "surface" };

/** The route by which the one thing they were keeping back comes out (to the talk's TOLD beat). */
const CONFIDED = "confided";

/** Has it come out? The route was taken, or the staged secret settled. */
const toldIt = (state: SessionState, companion: string) => state.path.some(p => p.via === CONFIDED) || state.guard?.[companion]?.stage === "settled";

/**
 * What a companion might open up about, each once: their own notes (what they know and believe of
 * people and things that matter to them). Their lore entry holds all of them at once, so it's a
 * candidate only for someone with no notes.
 */
export function confidences(state: SessionState, companion: string): Doc[] {
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
function inTheStory(state: SessionState, companion: Character): string {
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

/** The companion's earlier talks with the player, word for word. */
function earlierTalks(state: SessionState, companion: string): string {
  const talks = [...new Set(state.transcript.map(e => e.scene ?? "").filter(id => id !== state.sceneId && talkOf(id)?.companion === companion))];
  return talks.map(id => {
    const scene = sceneById(id);
    return `### ${scene.title} (${id})\n${scriptTranscript(scene, state, state.transcript.filter(e => e.scene === id && e.kind !== "system"))}`;
  }).join("\n\n");
}

/** The talk from which what would cost them most to tell can come out: two talks at least come before it. */
const DEEPEST_FROM = 3;

/**
 * Which of their notes are still theirs to tell (one decision, a question per note, alongside the
 * greeting): a note whose heart they've already told, anywhere, is out, and so is the one that
 * would cost them most, until the talks have built up to it. A hand-off, or a model choosing on
 * its own, can't be trusted to keep either.
 */
async function sift(state: SessionState, scene: Scene, candidates: Doc[]): Promise<{ open: Doc[]; held?: Doc }> {
  const talk = state.talk!;
  const name = companionOf(scene).name;
  if (!candidates.length) return { open: [] };
  const label = (d: Doc) => `${titleOf(d)}${d.meta.summary ? `: ${d.meta.summary}` : ""}`;
  const entry = characterEntry(talk.with);
  const truth = entry ? readDoc(state.id, join(dirname(entry), "gm.md")) : undefined;
  const decision = await deciderFor(sceneApproach(state, scene).decider).decide([
    `# ${name}, a companion in a roleplaying game, and what they've told the player of their own story so far`,
    ...(truth ? [`## The truth about them (the GM's notes)\n${truth.body}`] : []),
    `## What they said and did in the story's scenes (the replies that mention them)\n${inTheStory(state, companionOf(scene)) || "(nothing yet)"}`,
    `## Their earlier talks with the player between scenes\n${earlierTalks(state, talk.with) || "(none)"}`,
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
async function plan(state: SessionState, scene: Scene): Promise<{ prep: Plan; held?: Doc }> {
  const talk = state.talk!;
  const name = companionOf(scene).name;
  const record = state.talks![talk.with]!;
  const entry = characterEntry(talk.with)!;
  const all = confidences(state, talk.with);
  const sifted = await sift(state, scene, all).catch((): { open: Doc[]; held?: Doc } => ({ open: all }));
  const candidates = sifted.open;
  const told = record.told;
  // The GM's truth about them is for when the deepest may come out; before then it only tempts.
  const gm = record.count >= DEEPEST_FROM ? readDoc(state.id, join(dirname(entry), "gm.md")) : undefined;
  const memories = memoryLines(state.id, talk.with);
  const earlier = earlierTalks(state, talk.with);
  const input = [
    `# A talk with ${name} between scenes: the prep`,
    `## Their lore entry (${entry}): who they are, written to them\n${readDoc(state.id, entry)?.body ?? "(none)"}`,
    ...(candidates.length ? [`## The notes they might open up about now: what they know and believe\n${candidates.map(d => `### ${d.path}\n${d.body}`).join("\n\n")}`] : []),
    ...(gm ? [`## The truth about them (the GM's notes)\n${gm.body}`] : []),
    `## How things stand: what they remember (their memories of the player and the story, by title)\n${memories.join("\n") || "(nothing yet)"}`,
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
      `- standing: how things stand between ${name} and the player now, in a sentence, from their memories and the story so far.`,
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
  });
  return { prep, ...(sifted.held ? { held: sifted.held } : {}) };
}

/**
 * The prep takes effect: what they've told already and the one thing they might tell now go into
 * what the GM takes as given, and that one thing goes on their card, as near the surface as it is.
 */
function prepare(state: SessionState, scene: Scene, prep: Plan, held?: Doc): void {
  const talk = state.talk!;
  const name = companionOf(scene).name;
  const record = state.talks![talk.with]!;
  talk.suggestions = choices(prep.suggestions);
  const told = prep.told.map(t => t.trim().replace(/\.$/, "")).filter(Boolean);
  // The deepest stays out of the talk however it comes up: named as not this talk's, and its note withheld.
  if (held) withhold(state, held.path);
  const note = prep.willing === "yes" ? confidences(state, talk.with).find(d => d.path === prep.note && d.path !== held?.path) : undefined;
  const knew = knewThere(state, talk.with, name);
  if (!note || !prep.what.trim()) {
    state.established = [...facts(state, name, record, talk.where, talk.waiting.lead, told, undefined, held), ...knew];
    return;
  }
  const topic = prep.topic.trim() || titleOf(note);
  state.established = [...facts(state, name, record, talk.where, talk.waiting.lead, told, topic, held), ...knew];
  talk.confide = { note: note.path, topic, what: prep.what.trim(), memory: prep.memory.trim() || `I told ${state.player.name} about ${topic}.` };
  const secret = [prep.what.trim(), prep.shows.trim() ? `It shows first as: ${prep.shows.trim().replace(/\.$/, "")}.` : "", prep.opens.trim() ? `What would bring it out: ${prep.opens.trim().replace(/\.$/, "")}.` : ""].filter(Boolean).join(" ");
  state.patches.push({ turn: state.turn, why: `What ${name} might open up about in this talk: ${topic}.`, cast: { id: talk.with, secrets: [secret] } });
  // Once it's out (judged after a reply, never handed over on the player's say-so), the talk moves on.
  state.patches.push({ turn: state.turn, why: `${topic}, once told.`, transition: { beat: scene.start, transition: {
    id: CONFIDED, on: "outcome", given: true, to: TOLD,
    // Told over a reply or two, and in their own words, not the prep's: the heart of it is what counts.
    when: `By now (in this reply or an earlier one), ${name} has told ${state.player.name} about ${topic}: the heart of it, in their own words, even if not every detail (${prep.what.trim()})`,
    establishes: [`${name} has told ${state.player.name} about ${topic}.`],
  } } });
  // As readily as the prep says, or as far as an earlier talk already brought it.
  const ready = READY[prep.ready] ?? "surface";
  const carried = state.talks?.[talk.with]?.stages?.[note.path];
  const stage = carried && GUARD_STAGES.indexOf(carried) > GUARD_STAGES.indexOf(ready) ? carried : ready;
  state.guard = { ...state.guard, [talk.with]: { stage, turn: state.turn } };
}

/** Dialogue choices as the player sees them: plain lines, no quotes, none of the GM's markup (anything in square brackets), no repeats, four at most. */
function choices(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.map(l => l.trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim())
    .filter(l => l && l.length <= 160 && !/[[\]]/.test(l) && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .slice(0, 4);
}

/**
 * A turn in a talk: the ordinary scene turn, and alongside its after-reply decision, the next
 * dialogue choices (one small call, started as soon as the reply is in), unless they're turned off
 * (`suggest: false`: the game's setting).
 */
export async function talkTurn(state: SessionState, input: string, hooks: TurnHooks = {}, options: { mechanic?: Mechanic; suggest?: boolean } = {}): Promise<TurnResult> {
  const talk = state.talk;
  if (!talk) throw new Error("Not talking with anyone.");
  let next: { controller: AbortController; made: Promise<{ lines: string[]; costUsd: number } | undefined> } | undefined;
  const turn = await playerTurn(state, input, {
    ...hooks,
    onEntry: entry => {
      hooks.onEntry?.(entry);
      if (entry.kind !== "narration" || entry.speaker !== "gm" || options.suggest === false) return;
      next?.controller.abort();
      const controller = new AbortController();
      next = { controller, made: suggest(state, controller.signal).catch(() => undefined) };
    },
  }, options.mechanic ? { mechanic: options.mechanic } : {});
  // Out is out: the staged secret is settled, whichever judgement saw it first.
  if (talk.confide && toldIt(state, talk.with) && state.guard?.[talk.with]?.stage !== "settled") state.guard = { ...state.guard, [talk.with]: { stage: "settled", turn: state.turn } };
  if (turn.ended || state.ended) {
    next?.controller.abort();
    talk.suggestions = [];
  } else {
    const made = await next?.made;
    // Without new ones, the old ones less the line just said.
    talk.suggestions = made?.lines.length ? made.lines : talk.suggestions.filter(l => l !== input.trim());
    if (made) { turn.metric.costUsd += made.costUsd; turn.metric.calls++; }
  }
  saveSession(state);
  return turn;
}

/** The next dialogue choices, from the talk so far (the reply included). */
async function suggest(state: SessionState, signal: AbortSignal): Promise<{ lines: string[]; costUsd: number }> {
  const talk = state.talk!;
  const scene = sceneById(state.sceneId);
  const name = companionOf(scene).name;
  const told = state.talks?.[talk.with]?.told ?? [];
  const keeping = talk.confide && state.guard?.[talk.with]?.stage !== "settled" ? talk.confide : undefined;
  const story = state.history.slice(-2).map(h => h.summary).join("\n\n");
  // Plain lines, not JSON: structured output costs about a second more before the first word.
  const result = await respond({
    operation: "talk.suggest", effort: "none", maxOutputTokens: 300, signal,
    instructions: `You suggest what the player might say next in a conversation with ${name} in a roleplaying game, like the dialogue choices a cRPG offers. Give 2 to 4 short lines in the player character's own voice (plain speech without quotes, under 15 words each), one per line and nothing else. Each raises something the player hasn't asked in this conversation, and no two are about the same thing: a follow-up to what ${name} just said, something about ${name}'s own life or past (not the story), the story so far, someone the player has met. Lines a player would really want to say, curious, warm, wry or pointed, as the player character would be. Never something ${name} has already told them, and no goodbyes (that choice is always there).`,
    input: [{ role: "user", content: [
      `## The player character\n${playerWho(state)}`,
      ...(story ? [`## The story so far (the latest hand-offs between scenes)\n${story}`] : []),
      ...(told.length ? [`## What ${name} has already told them of their own story (don't ask again)\n${told.map(t => `- ${t.topic}`).join("\n")}`] : []),
      ...(keeping ? [`## What ${name} might open up about in this talk (one line may lead towards it without naming it)\n${keeping.topic}`] : []),
      `## The conversation so far\n${scriptTranscript(scene, state, sceneEntries(state).filter(e => e.kind !== "system"))}`,
    ].join("\n\n") }],
  });
  return { lines: choices(result.text.split("\n").map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""))), costUsd: result.costUsd };
}

/** The player walks on without a word: the talk ends here (no reply). */
export function leaveTalk(state: SessionState): string {
  if (!state.talk) return "";
  state.transcript.push({ turn: state.turn, scene: state.sceneId, speaker: "system", kind: "system", text: `${state.player.name} walks on` });
  return endTalk(state);
}

/**
 * The talk is over: what came out of it goes on record (the talk record, and their memories when
 * they told the thing they were keeping back), and the scene the story is heading for is put back
 * exactly as it was.
 */
export function endTalk(state: SessionState): string {
  const talk = state.talk;
  if (!talk) return "";
  const name = companionOf(sceneById(state.sceneId)).name;
  const record = ((state.talks ??= {})[talk.with] ??= { count: 1, told: [] });
  const stage = state.guard?.[talk.with]?.stage;
  if (talk.confide && toldIt(state, talk.with)) {
    record.told.push({ note: talk.confide.note, topic: talk.confide.topic, turn: state.turn });
    if (record.stages) delete record.stages[talk.confide.note];
    // In their memories, so no scene of the story has them tell it as news either.
    try {
      saveMemory(state.id, { id: talk.with, name }, { title: `Told ${firstName(state.player.name)} about ${talk.confide.topic}`, context: `A word with ${state.player.name} between scenes: ${talk.where}.`, content: talk.confide.memory }, { scene: state.sceneId, turn: state.turn });
    } catch { /* the talk record still has it */ }
  } else if (talk.confide && stage && stage !== "surface") {
    record.stages = { ...record.stages, [talk.confide.note]: stage };
  }
  clearSceneOwn(state);
  Object.assign(state, talk.waiting);
  delete state.talk;
  saveSession(state);
  return `(The talk with ${name} is over: back to the map.)`;
}
