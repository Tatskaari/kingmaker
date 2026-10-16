import { knowledgeCard } from "../../gm/knowledge.ts";
import { writeNotes } from "../../gm/notes.ts";
import { keysOf, localMarkup, turnSource, type TurnView, type ViewEntry } from "../../gm/view.ts";
import type { Mark } from "../../../shared/markup.ts";
import type { NotesRequest, NotesResponse } from "../../../shared/protocol/ai.ts";
import type { Handler } from "../context.ts";
import { sceneAndView } from "./turn.ts";

/**
 * POST /v1/turns/notes (v5-design §3.6): the notes the player reads on a reply's marked words,
 * written once the reply is on the transcript, from what the player knows (gm/notes.ts): placed on
 * its words, linked to what each is about, and each link with the card its popover shows, as the
 * player knows it now. Only a reply with something to note (a spoken line, or a mark the GM made) is
 * read; one that the model fails on has none, and the turn goes on without them (the prototype's
 * annotate, notes.ts:331-345). People go back by the game's keys.
 */
export const notes: Handler<NotesRequest, NotesResponse> = async (req, ctx) => {
  const source = turnSource(req);
  const { scene, view, byKey } = sceneAndView(ctx, req.turn.scene.key, source);
  const reply = { text: req.reply.text, speech: localMarkup({ speech: req.reply.speech, marks: [] }, keysOf(source)).speech, drafted: req.reply.drafted };
  if (!reply.speech.length && !reply.drafted.length) return { marks: [], usage: ctx.usage() };

  const before = view.transcript.slice(0, replyAt(view.transcript, req.reply));
  const written = await writeNotes(scene, view, reply, before, ctx.calls).catch(() => undefined);
  const marks = (written?.marks ?? []).map(m => withCard(view, m, ctx.campaign.title));

  return { marks: byKey({ speech: [], marks }).marks, usage: ctx.usage() };
};

/** Where the reply is on the request's transcript (which runs up to it): its seq, numbered from 1 as a scene's are; or else the last entry in its words. */
function replyAt(transcript: ViewEntry[], reply: NotesRequest["reply"]): number {
  if (transcript[reply.seq - 1]?.text === reply.text) return reply.seq - 1;
  const said = transcript.findLastIndex(e => e.text === reply.text);
  return said < 0 ? transcript.length : said;
}

/** A linked mark with the card its popover shows: only what the player knows, as of the note. */
function withCard(view: TurnView, mark: Mark, setting: string): Mark {
  const card = mark.link && knowledgeCard(view, mark.link, setting);
  return card ? { ...mark, card } : mark;
}
