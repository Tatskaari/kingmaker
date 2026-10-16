import type { RepairResult } from "../../../shared/gm/repair.ts";
import type { Mark, Speech } from "../../../shared/markup.ts";
import type { NotesRequest, Reply, SceneContext, Suggestion } from "../../../shared/protocol/ai.ts";
import { effectiveScene, presentCast } from "../../../shared/scene/graph.ts";
import { unnamed } from "../../../shared/scene/names.ts";
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
 * someone of the cast says a line in each, so the screen has a speaker to colour and the notes a line
 * to go on. Nothing moves the scene: no route is taken, nothing lands, no ending comes, and the GM
 * rules on nothing (a ruling asked for anyway comes back without one, and without a check to roll).
 * The notes put one why on the first line someone of the cast says, linked to them, with their card;
 * the suggested lines are the same four every time. After a turn, nobody remembers anything, and the
 * co-GM finds the scene on track, with no notes. Character creation gets the prototype's offline
 * answers (its endpoints with no model to ask): three builds from the class defaults, the player's
 * own made legal, no draft, the backstory unchecked, its traits from the player's own words.
 */
export const canned: Endpoints = {
  async open(req, ctx) {
    const scene = effectiveScene(ctx.campaign.scene(req.scene.key), req.gm.patches);
    const voice = speakerAt(scene, presentCast(scene, req.gm), 0, []);
    const opening = said(`${scene.title}. (The AI service is canned: no model was asked, and nothing here is the GM's.) `, voice, "Say something, and it answers");
    await written(ctx.stream(req.stream.turn), opening);
    return { present: presentCast(scene, req.gm).map(c => c.id), entries: [opening], opened: [], usage: noUsage() };
  },
  async decide() {
    return { decision: { earned: false, daft: false, outOfCharacter: false }, opened: [], usage: noUsage() };
  },
  async consider() {
    return { error: "the canned GM rules on nothing (no model was asked)", ms: 0, usage: noUsage() };
  },
  async reply(req, ctx) {
    const scene = effectiveScene(ctx.campaign.scene(req.turn.scene.key), req.turn.gm.patches);
    const line = req.turn.line.text.length > 200 ? `${req.turn.line.text.slice(0, 199)}…` : req.turn.line.text;
    const reply = req.outcome.windDown && !req.decision.outOfCharacter
      ? narration("The scene draws to a close. (Canned: no model was asked.)")
      : answered(line, speakerAt(scene, presentCast(scene, req.turn.gm), req.turn.scene.turn, req.turn.transcript));
    const sink = ctx.stream(req.stream.turn);
    await written(sink, reply);
    return { entries: [reply], gm: { repeated: null }, firstTextMs: sink.firstTextMs(), usage: noUsage() };
  },
  async settle(req) {
    const closed = !!req.turn.gm.ended;
    return { ops: [], ...(closed ? {} : { after: { status: "on_track", landed: [], hinted: [], unanswered: false, theirs: false } }), usage: noUsage() };
  },
  async notes(req, ctx) {
    const scene = effectiveScene(ctx.campaign.scene(req.turn.scene.key), req.turn.gm.patches);
    const line = req.reply.speech.find(s => s.speaker && s.speaker !== "you" && scene.cast.some(c => c.id === s.speaker));
    if (!line) return { marks: [], usage: noUsage() };
    return { marks: [whyOn(scene, req, line)], usage: noUsage() };
  },
  async suggest() {
    return { lines: LINES, dropped: [], usage: noUsage() };
  },
  async remember() {
    return { flags: [], reviews: [], usage: noUsage() };
  },
  async repair(req) {
    return { review: onTrack(req.reviewed), usage: noUsage() };
  },

  characters: characters(() => null),

  backstories: backstories(() => null),
};

/** The co-GM's review of a turn, with no model: on track, nothing to steer, nothing to add. */
const onTrack = (turn: number): RepairResult => ({
  turn, assessment: "Canned: no model was asked.", status: "on_track", notes: "", whispers: [], relocations: [], canon: [], patches: [], costUsd: 0, latencyMs: 0,
});

/** The same four lines after every reply: two to say, a deed, a risky try. */
const LINES: Suggestion[] = [
  { kind: "say", text: "What happened here?" },
  { kind: "say", text: "Who else saw it?" },
  { kind: "do", text: "(I take a careful look around.)" },
  { kind: "try", text: "(I try to slip closer without anyone noticing.)" },
];

const narration = (text: string, speech: Speech[] = []): Reply => ({ speaker: "gm", kind: "narration", text, ...(speech.length ? { markup: { speech, marks: [] } } : {}) });

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
  return { ...reply, text: `${reply.text} (Canned: no model was asked.)`, markup: { speech, marks: [] } };
}

/** A why on the line, linked to whoever says it, with the card the popover shows of them: their name as the player knows it, and their last words. */
function whyOn(scene: Scene, req: NotesRequest, line: Speech): Mark {
  const who = scene.cast.find(c => c.id === line.speaker)!;
  const name = unnamed(scene, req.turn)[who.id] ?? who.name;
  const words = req.reply.text.slice(line.start, line.end);
  return {
    start: line.start, end: line.end, kind: "why",
    note: `${name.charAt(0).toUpperCase()}${name.slice(1)} wants to hear more. (Canned: no model was asked.)`,
    link: { kind: "person", id: who.id },
    card: { title: `${name.charAt(0).toUpperCase()}${name.slice(1)}`, lines: ["You met them in this scene.", `Last said to you (turn ${req.turn.scene.turn}): ${words}`] },
  };
}

/** How long each word takes, so a canned reply grows over a second or so, as a model's does. */
const WORD_MS = 30;

/** The words shown a word at a time (who says each line once it's begun), then the whole of them as final. */
async function written(sink: StreamSink, reply: Reply): Promise<void> {
  const words = reply.text.match(/\S+\s*/g) ?? [reply.text];
  for (let n = 1; n <= words.length; n++) {
    const shown = words.slice(0, n).join("").trimEnd();
    const speech = reply.markup?.speech.filter(s => s.start < shown.length).map(s => ({ ...s, end: Math.min(s.end, shown.length) })) ?? [];
    sink.show(shown, speech.length ? { speech, marks: [] } : undefined);
    await new Promise(resolve => setTimeout(resolve, WORD_MS));
  }
  await sink.finish(reply.text, reply.markup);
}
