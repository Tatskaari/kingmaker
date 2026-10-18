import type { Speech } from "../../../shared/markup.ts";
import type { BoundaryRequest, Reply, SceneContext, Suggestion } from "../../../shared/protocol/ai.ts";
import { effectiveScene, presentCast } from "../../../shared/scene/graph.ts";
import { unnamed } from "../../../shared/scene/names.ts";
import { TOLD } from "../../../shared/scene/talk.ts";
import type { Character, Scene } from "../../../shared/scene/types.ts";
import { noUsage } from "../calls.ts";
import type { Endpoints } from "../context.ts";
import type { StreamSink } from "../stream.ts";
import { backstories } from "./backstories.ts";
import { characters } from "./characters.ts";

/**
 * The thinks with no model at all (KM_AI_GM=canned): for bringing a stack up and playing it end to
 * end before, or without, the GM, and for telling the plumbing's faults from the GM's. The opening
 * and each reply stream a word at a time, as a model's would, so the draft grows on every screen, and
 * someone of the cast says a line in each, so the screen has a speaker to colour. Nothing moves the
 * scene: no route is taken, nothing lands, no ending comes (the two-part GM's co-GM sets no roles and
 * makes no move, and its mouthpiece calls no check; its closing closes), and no line is an act the
 * rules resolve (so nobody reacts: reactions asked for anyway come back with none).
 * The suggested lines are the same four every time, and a talk's the same two (town-design §3.6: a
 * talk's prep keeps nothing back and adds no facts). After a turn, nobody remembers anything, and
 * nothing gets a look invented. After a scene, the boundary goes to the first scene
 * it could, with the prototype's fallback hand-off, nothing rewritten, nobody absent, nothing owed
 * and no docs written (story-design §4.4). Character creation gets the prototype's offline
 * answers (its endpoints with no model to ask): three builds from the class defaults, the player's
 * own made legal, no draft, the backstory unchecked, its traits from the player's own words.
 */
export const canned: Endpoints = {
  async open(req, ctx) {
    const scene = effectiveScene(ctx.campaign.scene(req.scene.key), req.gm.patches);
    const voice = speakerAt(scene, presentCast(scene, req.gm), 0, []);
    const opening = said(`${scene.title}. (The AI service is canned: no model was asked, and nothing here is the GM's.) `, voice, "Say something, and it answers");
    await written(ctx.stream(req.stream.turn), opening);
    // A talk keeps nothing back: on the two-part GM, its discovery isn't this talk's (ai/gm/talk.ts nothingToConfide).
    const patches = req.talk ? [{ turn: 0, why: "Canned: nothing to confide.", drop: TOLD }] : [];
    const talk = req.talk ? { talk: { established: [], patches, suggestions: req.talk.suggest ? TALK_LINES : [] } } : {};
    return { present: presentCast(scene, req.gm).map(c => c.id), entries: [opening], ...talk, usage: noUsage() };
  },
  async act() {
    return { usage: noUsage() };
  },
  async reactions() {
    return { reactions: {}, usage: noUsage() };
  },
  async reply(req, ctx) {
    const scene = effectiveScene(ctx.campaign.scene(req.turn.scene.key), req.turn.gm.patches);
    const line = req.turn.line.text.length > 200 ? `${req.turn.line.text.slice(0, 199)}…` : req.turn.line.text;
    // The two-part GM's wind-down always closes.
    const reply = req.outcome.windDown
      ? narration("The scene draws to a close. (Canned: no model was asked.)")
      : answered(line, speakerAt(scene, presentCast(scene, req.turn.gm), req.turn.scene.turn, req.turn.transcript));
    const sink = ctx.stream(req.stream.turn);
    await written(sink, reply);
    return { entries: [reply], gm: {}, firstTextMs: sink.firstTextMs(), ...(req.outcome.windDown ? { closes: true } : {}), usage: noUsage() };
  },
  async settle(req) {
    // The two-part GM's co-GM, canned: it sets no roles and moves nothing (and a talk's lines, as ever).
    return { ops: [], coGm: { roles: {}, moves: [], log: [] }, ...(req.talk ? { talk: { suggestions: req.talk.suggest ? TALK_LINES : [] } } : {}), usage: noUsage() };
  },
  async suggest() {
    return { lines: LINES, dropped: [], usage: noUsage() };
  },
  async remember() {
    return { flags: [], reviews: [], usage: noUsage() };
  },
  async boundary(req, ctx) {
    const scene = effectiveScene(ctx.campaign.scene(req.turn.scene.key), req.turn.gm.patches);
    const exit = scene.exits.find(e => e.id === req.exit);
    const ended = exit ? `${exit.title} (${scene.id}: ${exit.id}). ${exit.outcome}` : req.exit;
    return {
      handOff: `Previous scene, "${scene.title}", ended: ${ended}`,
      lastMoments: lastMoments(scene, req),
      next: { scene: req.candidates[0]!, skipped: [], adjustments: [], absent: [], patches: [], hinted: [] },
      owed: [], fronts: [], usage: noUsage(),
    };
  },
  async looks() {
    return { looks: {}, usage: noUsage() };
  },
  // The GM on the board, canned (the canned GM never starts a fight): no words, and a typed turn ends at once.
  async narrate() {
    return { entries: [], usage: noUsage() };
  },
  async fight() {
    const narration = "(The AI service is canned: the turn passes.)";
    return { move: { kind: "end_turn" as const, narration }, entries: [{ speaker: "gm", kind: "narration", text: narration }], usage: noUsage() };
  },
  // The sides in a fight, canned (the canned GM never starts one): everyone with no side runs.
  async sides(req) {
    return { sides: Object.fromEntries(req.sides.pending.map(p => [p.id, "flee" as const])), entries: [], usage: noUsage() };
  },

  characters: characters(() => null),

  backstories: backstories(() => null),
};

/** The same four lines after every reply: two to say, a deed, a risky try. */
const LINES: Suggestion[] = [
  { kind: "say", text: "What happened here?" },
  { kind: "say", text: "Who else saw it?" },
  { kind: "do", text: "(I take a careful look around.)" },
  { kind: "try", text: "(I try to slip closer without anyone noticing.)" },
];

/** A talk's two lines, every time: something to ask, and something to say. */
const TALK_LINES = ["How are you keeping?", "What do you make of it all?"];

const narration = (text: string, speech: Speech[] = []): Reply => ({ speaker: "gm", kind: "narration", text, ...(speech.length ? { markup: { speech } } : {}) });

/** Someone of the cast here to say a canned line, a different one each turn, by the name the player knows them by. */
function speakerAt(scene: Scene, here: Character[], turn: number, transcript: SceneContext["transcript"]): { id: string; name: string } | undefined {
  const c = here[turn % Math.max(1, here.length)];
  return c ? { id: c.id, name: unnamed(scene, { transcript })[c.id] ?? c.name } : undefined;
}

/** Narration, then a line said by `voice` (when there's anyone to say it), its speech marked. `words` without their last stop. */
function said(before: string, voice: { id: string; name: string } | undefined, words: string): Reply {
  if (!voice) return narration(`${before}${words}.`);
  const quote = `“${words},”`;
  return narration(`${before}${quote} says ${voice.name}.`, [{ start: before.length, end: before.length + quote.length, speaker: voice.id }]);
}

/** The player's words given back, then someone of the cast's answer: two spoken lines, the player's and theirs. */
function answered(line: string, voice: { id: string; name: string } | undefined): Reply {
  const lead = "You said: ", quote = `“${line}”`;
  const reply = said(`${lead}${quote} `, voice, "Go on, then");
  const speech: Speech[] = [{ start: lead.length, end: lead.length + quote.length, speaker: "you" }, ...(reply.markup?.speech ?? [])];
  return { ...reply, text: `${reply.text} (Canned: no model was asked.)`, markup: { speech } };
}

/** The ended scene's last four moments that aren't the system's, as the prototype words them (engine.ts:1078-1079). */
function lastMoments(scene: Scene, req: BoundaryRequest): string[] {
  const player = req.turn.party[0]?.name ?? "The player";
  return req.turn.transcript.filter(e => e.kind !== "system").slice(-4)
    .map(e => (e.kind === "player" ? `${player} (player): ${e.text}` : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.text));
}

/** How long each word takes, so a canned reply grows over a second or so, as a model's does. */
const WORD_MS = 30;

/** The words shown a word at a time (who says each line once it's begun), then the whole of them as final. */
async function written(sink: StreamSink, reply: Reply): Promise<void> {
  const words = reply.text.match(/\S+\s*/g) ?? [reply.text];
  for (let n = 1; n <= words.length; n++) {
    const shown = words.slice(0, n).join("").trimEnd();
    const speech = reply.markup?.speech.filter(s => s.start < shown.length).map(s => ({ ...s, end: Math.min(s.end, shown.length) })) ?? [];
    sink.show(shown, speech.length ? { speech } : undefined);
    await new Promise(resolve => setTimeout(resolve, WORD_MS));
  }
  await sink.finish(reply.text, reply.markup);
}
