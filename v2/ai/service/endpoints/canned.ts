import type { Reply } from "../../../shared/protocol/ai.ts";
import { effectiveScene, presentCast } from "../../../shared/scene/graph.ts";
import { noUsage } from "../calls.ts";
import type { Endpoints } from "../context.ts";
import type { StreamSink } from "../stream.ts";

/**
 * The four thinks with no model at all (KM_AI_GM=canned): for bringing a stack up and playing it end
 * to end before, or without, the GM, and for telling the plumbing's faults from the GM's. The opening
 * and each reply stream a word at a time, as a model's would, so the draft grows on every screen.
 * Nothing moves the scene: no route is taken, nothing lands, no ending comes.
 */
export const canned: Endpoints = {
  async open(req, ctx) {
    const scene = effectiveScene(ctx.campaign.scene(req.scene.key), req.gm.patches);
    const text = `${scene.title}. (The AI service is canned: no model was asked, and nothing here is the GM's.) Say something, and it answers.`;

    await written(ctx.stream(req.stream.turn), text);

    return { present: presentCast(scene, req.gm).map(c => c.id), entries: [narration(text)], opened: [], usage: noUsage() };
  },

  async decide() {
    return { decision: { earned: false, daft: false, outOfCharacter: false }, opened: [], usage: noUsage() };
  },

  async reply(req, ctx) {
    const said = req.turn.line.text.length > 200 ? `${req.turn.line.text.slice(0, 199)}…` : req.turn.line.text;
    const text = req.outcome.windDown && !req.decision.outOfCharacter
      ? "The scene draws to a close. (Canned: no model was asked.)"
      : `You said: “${said}” The yard hears you out. (Canned: no model was asked.)`;
    const sink = ctx.stream(req.stream.turn);

    await written(sink, text);

    return { entries: [narration(text)], gm: { repeated: null }, firstTextMs: sink.firstTextMs(), usage: noUsage() };
  },

  async settle(req) {
    const closed = !!req.turn.gm.ended;
    return { ops: [], ...(closed ? {} : { after: { status: "on_track", landed: [], hinted: [], unanswered: false, theirs: false } }), usage: noUsage() };
  },
};

const narration = (text: string): Reply => ({ speaker: "gm", kind: "narration", text });

/** How long each word takes, so a canned reply grows over a second or so, as a model's does. */
const WORD_MS = 30;

/** The words shown a word at a time, then the whole of them as final. */
async function written(sink: StreamSink, text: string): Promise<void> {
  const words = text.match(/\S+\s*/g) ?? [text];
  for (let n = 1; n <= words.length; n++) {
    sink.show(words.slice(0, n).join("").trimEnd());
    await new Promise(resolve => setTimeout(resolve, WORD_MS));
  }
  await sink.finish(text);
}
