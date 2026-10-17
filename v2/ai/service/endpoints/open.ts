import { writePlayerBackstory } from "../../docs/docs.ts";
import { resumeAfterFight } from "../../gm/aftermath.ts";
import { openingDirective } from "../../gm/directives.ts";
import { planTalk, prepareTalk, talkFacts } from "../../gm/talk.ts";
import { keysOf, openSource, type TurnView, type ViewSource } from "../../gm/view.ts";
import { gmReply, replyOf } from "../../gm/voice.ts";
import type { Markup } from "../../../shared/markup.ts";
import type { OpenRequest, OpenResponse, TalkOpen, TalkPrep } from "../../../shared/protocol/ai.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import { opToGame } from "../../../shared/world/rows.ts";
import type { AiContext, Handler } from "../context.ts";
import { director, disclosed, sceneAndView, withOpened } from "./turn.ts";

/**
 * POST /v1/scenes/open (v0-design §5.3, gm-port §5): the scene's opening. The player's doc is made
 * if it's missing, with their backstory in it when they wrote one at character creation (v1-design
 * §3.7: the GM's notes and its note of what the player knows both read it, so it's written before
 * disclosure), what bears on the scene's start is opened, and the GM opens the scene, its words
 * streamed to the opening's draft with who says each line. The answer says who's here, the opening
 * (who says each line by the game's keys, and the marks the GM made, for its notes) and the notes
 * opened, for the simulation to commit. After a boundary the opening picks up from how the last
 * scene ended, as the boundary rewrote it (the opening directive's second branch: story-design §4.4).
 *
 * With `aftermath`, the scene picks up after a fight instead (the prototype's resumeAfterFight): the
 * GM narrates the aftermath (`gm.aftermath`), streamed as an opening is, and the stage manager's
 * operations for what it narrated come back with it (`ops`, by the game's keys), for the simulation
 * to apply through its gate. No disclosure: the prototype's resumeAfterFight opens none.
 *
 * With `talk`, a talk with a companion opens (town-design §3.6: talk.ts startTalk and openTalk): the
 * GM takes as given what startTalk set (where and when, how often they've talked, where the story
 * goes next, what the companion knew in the story's scenes), and their greeting (`gm.talk.opening`)
 * streams as an opening does, beside the talk's prep: which of their notes are still theirs to tell
 * (talk.sift), then the one thing they might open up about this time and the opening lines
 * (talk.plan). The answer's `talk` is what the prep came to (prepare), for the open's commit to keep;
 * a prep that fails leaves the facts as the talk opened, and nothing kept back. No disclosure, as
 * openTalk opens none, and the earlier talks' entries join the view's transcript (the prep reads them).
 */
export const open: Handler<OpenRequest, OpenResponse> = async (req, ctx) => {
  const source = openSource(req);
  const { scene, view, byKey } = sceneAndView(ctx, req.scene.key, req.talk ? withEarlierTalks(source, req.talk) : source);
  if (req.aftermath) return aftermath(req, req.aftermath.summary, ctx, scene, view, byKey);
  if (req.talk) return talk(req, req.talk, ctx, scene, view, byKey);
  writePlayerBackstory(view.id, view.player);

  const opened = await disclosed(scene, view, "", ctx.calls);
  withOpened(view, opened);

  const sink = ctx.stream(req.stream.turn);
  const spoken = await gmReply(scene, view, [openingDirective(scene, view)], { operation: "gm.opening", calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  const opening = replyOf(spoken, byKey);
  await sink.finish(opening.text, opening.markup);

  return { present: presentCast(scene, view).map(c => c.id), entries: [opening], opened, usage: ctx.usage() };
};

/** The scene after a fight: the aftermath streamed to its turn's draft, and what the stage manager made of it. */
async function aftermath(req: OpenRequest, summary: string, ctx: AiContext, scene: Scene, view: TurnView, byKey: (markup: Markup) => Markup): Promise<OpenResponse> {
  const sink = ctx.stream(req.stream.turn);
  const { spoken, staging } = await resumeAfterFight(scene, view, summary, { operation: "gm.aftermath", calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  const said = replyOf(spoken, byKey);
  await sink.finish(said.text, said.markup);
  const ops = await staging;

  return { present: presentCast(scene, view).map(c => c.id), entries: [said], opened: [], ops: ops.map(op => opToGame(op, view.world!, keysOf(openSource(req)))), usage: ctx.usage() };
}

/** The story so far with the companion's earlier talks in it, as the prototype's transcript has them: what the prep reads of them (earlierTalks), each entry with its talk's key. */
function withEarlierTalks(source: ViewSource, open: TalkOpen): ViewSource {
  const told = source.told ?? { time: "", day: 1, flags: {} };
  return { ...source, told: { ...told, earlier: [...(told.earlier ?? []), ...open.earlier] } };
}

/**
 * A talk's opening (talk.ts openTalk): the facts it opens on, then the greeting streamed beside the
 * prep; the greeting failing fails the open (nothing is kept), the prep failing keeps the facts it
 * opened on.
 */
async function talk(req: OpenRequest, open: TalkOpen, ctx: AiContext, scene: Scene, view: TurnView, byKey: (markup: Markup) => Markup): Promise<OpenResponse> {
  // This talk counted, as startTalk counts it before anything reads the record.
  view.talks = { ...view.talks, [open.with]: open.record };
  view.established = talkFacts(view, scene, open);
  const sink = ctx.stream(req.stream.turn);
  const [greeting, prep] = await Promise.allSettled([
    gmReply(scene, view, [`Open the talk. ${scene.opening}`], { operation: "gm.talk.opening", calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) }),
    planTalk(view, scene, open, { calls: ctx.calls, decider: director(ctx.calls) }),
  ]);
  if (greeting.status === "rejected") throw greeting.reason;
  const said = replyOf(greeting.value, byKey);
  await sink.finish(said.text, said.markup);
  const talk: TalkPrep = prep.status === "fulfilled" ? prepareTalk(view, scene, open, prep.value) : { established: view.established, patches: [], withheld: [], suggestions: [] };

  return { present: presentCast(scene, view).map(c => c.id), entries: [said], opened: [], talk, usage: ctx.usage() };
}
