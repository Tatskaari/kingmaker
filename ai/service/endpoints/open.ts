import { writePlayerBackstory } from "../../docs/docs.ts";
import { resumeAfterFight } from "../../gm/aftermath.ts";
import { openingDirective } from "../../gm/directives.ts";
import { nothingToConfide, planTalk, prepareTalk, talkFacts, talkOpening } from "../../gm/talk.ts";
import { speak } from "../../gm/two-part.ts";
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
 * (who says each line by the game's keys) and the lore notes disclosure opened, for the simulation
 * to commit. After a boundary the opening picks up from how the last
 * scene ended, as the boundary rewrote it (the opening directive's second branch: story-design §4.4).
 *
 * With `aftermath`, the scene picks up after a fight instead (the prototype's resumeAfterFight): the
 * GM narrates the aftermath (`gm.aftermath`), streamed as an opening is, and the stage manager's
 * operations for what it narrated come back with it (`ops`, by the game's keys), for the simulation
 * to apply through its gate. No disclosure: the prototype's resumeAfterFight opens none.
 *
 * With `talk`, a talk with a companion opens (town-design §3.6: talk.ts startTalk and openTalk): the
 * GM takes as given what startTalk set (where and when, how often they've talked, where the story
 * goes next, what the companion knew in the story's scenes), and their greeting streams as an opening
 * does, beside the talk's prep: which of their notes are still theirs to tell (talk.sift), then the
 * one thing they might open up about this time and the opening lines (talk.plan). On the two-part GM
 * (`twoPart`, as the simulation sends every talk since the old pipeline's salvage) the greeting is the
 * mouthpiece's (`two-part.opening`), from the companion's opening role (note -1) and the talk's
 * opening; otherwise the old pipeline's (`gm.talk.opening`). The answer's `talk` is what the prep came
 * to (prepare: on the two-part GM, the talk's discovery filled with it), for the open's commit to
 * keep; a prep that fails leaves the facts as the talk opened, and nothing kept back (the discovery
 * dropped). No disclosure, as openTalk opens none, and the earlier talks' entries join the view's
 * transcript (the prep reads them).
 */
export const open: Handler<OpenRequest, OpenResponse> = async (req, ctx) => {
  const source = openSource(req);
  const { scene, view, byKey } = sceneAndView(ctx, req.scene.key, req.talk ? withEarlierTalks(source, req.talk) : source);
  if (req.aftermath) return aftermath(req, req.aftermath.summary, ctx, scene, view, byKey);
  if (req.talk) return req.twoPart ? twoPartTalk(req, req.talk, ctx, scene, view, byKey) : talk(req, req.talk, ctx, scene, view, byKey);
  writePlayerBackstory(view.id, view.player);
  if (req.twoPart) return twoPartOpening(req, ctx, scene, view, byKey);

  const opened = await disclosed(scene, view, "", ctx.calls);
  withOpened(view, opened);

  const sink = ctx.stream(req.stream.turn);
  const spoken = await gmReply(scene, view, [openingDirective(scene, view)], { operation: "gm.opening", calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  const opening = replyOf(spoken, byKey);
  await sink.finish(opening.text, opening.markup);

  return { present: presentCast(scene, view).map(c => c.id), entries: [opening], opened, usage: ctx.usage() };
};

/**
 * A scene of the story's opening, by the two-part GM (docs/two-part-design.md, step 6): the
 * mouthpiece speaks it, streamed to the opening's draft, from the roles the simulation gave everyone
 * present as it opened (the co-GM's note -1: their stage's cast note, else their attitude), the
 * opening directive as the boundary left it (its rewritten opening, after the story so far). No
 * disclosure: the two-part GM reads no memories. A check it calls comes back for the simulation to
 * roll, as a reply's does.
 */
async function twoPartOpening(req: OpenRequest, ctx: AiContext, scene: Scene, view: TurnView, byKey: (markup: Markup) => Markup): Promise<OpenResponse> {
  const sink = ctx.stream(req.stream.turn);
  const spoke = await speak(scene, view, [openingDirective(scene, view)], { operation: "two-part.opening", calls: ctx.calls, byKey, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  await sink.finish(spoke.narration.text, spoke.narration.markup);
  return { present: presentCast(scene, view).map(c => c.id), entries: [spoke.narration], opened: [], ...(spoke.check ? { check: spoke.check } : {}), usage: ctx.usage() };
}

/** The scene after a fight: the aftermath streamed to its turn's draft, and what the stage manager made of it. */
async function aftermath(req: OpenRequest, summary: string, ctx: AiContext, scene: Scene, view: TurnView, byKey: (markup: Markup) => Markup): Promise<OpenResponse> {
  const sink = ctx.stream(req.stream.turn);
  const { spoken, staging } = await resumeAfterFight(scene, view, summary, { operation: "gm.aftermath", calls: ctx.calls, setting: ctx.campaign.title, onText: (text, markup) => sink.show(text, markup && byKey(markup)) });
  const said = replyOf(spoken, byKey);
  await sink.finish(said.text, said.markup);
  const ops = await staging;

  return { present: presentCast(scene, view).map(c => c.id), entries: [said], opened: [], ops: ops.map(op => opToGame(op, view.world!, keysOf(openSource(req)))), usage: ctx.usage() };
}

/** The story so far with the companion's earlier talks in it, as the prototype's transcript has them: what the prep reads of them (earlierTalks), each entry with its talk's key (a talk the story's entries have already, not twice). */
function withEarlierTalks(source: ViewSource, open: TalkOpen): ViewSource {
  const told = source.told ?? { time: "", day: 1, flags: {} };
  const had = new Set((told.earlier ?? []).map(e => e.scene));
  return { ...source, told: { ...told, earlier: [...(told.earlier ?? []), ...open.earlier.filter(e => !had.has(e.scene))] } };
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

/**
 * A talk's opening on the two-part GM: the facts it opens on, then the mouthpiece's greeting (from
 * the companion's opening role, the roles' note -1 the simulation wrote as the talk opened) streamed
 * beside the prep, which its turns play from: the greeting failing fails the open (nothing is kept),
 * the prep failing keeps the facts it opened on, with nothing to confide. A greeting has no dice.
 */
async function twoPartTalk(req: OpenRequest, open: TalkOpen, ctx: AiContext, scene: Scene, view: TurnView, byKey: (markup: Markup) => Markup): Promise<OpenResponse> {
  // This talk counted, as startTalk counts it before anything reads the record.
  view.talks = { ...view.talks, [open.with]: open.record };
  view.established = talkFacts(view, scene, open);
  const sink = ctx.stream(req.stream.turn);
  const [greeting, prep] = await Promise.allSettled([
    speak(scene, view, [talkOpening(scene)], { operation: "two-part.opening", calls: ctx.calls, byKey, onText: (text, markup) => sink.show(text, markup && byKey(markup)) }),
    planTalk(view, scene, open, { calls: ctx.calls, decider: director(ctx.calls) }),
  ]);
  if (greeting.status === "rejected") throw greeting.reason;
  await sink.finish(greeting.value.narration.text, greeting.value.narration.markup);
  const talk: TalkPrep = prep.status === "fulfilled" ? prepareTalk(view, scene, open, prep.value) : { established: view.established, patches: [nothingToConfide(view.turn)], withheld: [], suggestions: [] };

  return { present: presentCast(scene, view).map(c => c.id), entries: [greeting.value.narration], opened: [], talk, usage: ctx.usage() };
}
