import assert from "node:assert/strict";
import { test } from "node:test";
import type { Backend } from "../backend.ts";
import { clerkEnded, heronFought, OPEN_CASE, ratWaiting, storyOf, storyOver, yardOver } from "../check/story.ts";
import { demoBackend } from "../demo.ts";
import * as verbs from "../headless.ts";
import type { SceneView } from "../scene/view.ts";
import { STANDIN } from "./words.ts";

/**
 * The headless client between scenes (story-design §4.5), as an agent plays it: end (the endings,
 * then one, and the story moving on to MODE: between), journal, go (the Rat's opening), and
 * observe's MODE: between, fight and end, as the QA console printed them.
 */

function capture(): verbs.Out & { printed: string } {
  const out = { printed: "", print: (text: string) => { out.printed += `${text}\n`; }, progress: () => {} };
  return out;
}

/** A backend whose only view is `view` (observe and journal read nothing else). */
const showing = (view: SceneView): Backend => ({ ...demoBackend({ ms: 1 }), view: () => view, home: () => ({ games: [], campaigns: [], seat: { playerId: 1n, gameId: 1n, sceneId: 7n } }) });

test("the demo's yard: a line that makes the case ends it, the story moves on, then MODE: between with Kell's talk, and go opens the Rat", async () => {
  const game = demoBackend({ ms: 1 });
  const said = capture();
  assert.equal(await verbs.say(game, "Sergeant, that's a cord mark. Write him down as murdered, persons unknown.", said), 0);
  assert.match(said.printed, /^Kell looks at the mark on Prout's neck/);
  assert.match(said.printed, new RegExp(`— Scene ends: ${OPEN_CASE.ending} —`));
  assert.match(said.printed, /PHASE: over \(the story is moving on: observe again\)\n$/);

  await new Promise(resolve => setTimeout(resolve, 120));
  const between = capture();
  verbs.observe(game, between);
  assert.match(between.printed, /^MODE: between\n\n\[Evening, on the eve of the Assembly\] With you: Sergeant Agnes Kell\.\n\n/);
  assert.match(between.printed, /Sergeant Agnes Kell: “For the record\.” She reads the entry back to you, in the words of the record: “Prout was murdered\. The watch has it down as persons unknown\.” She looks at it a moment longer\. “Noted\.”/);
  assert.match(between.printed, /Sergeant Agnes Kell: “The Drowned Rat, then\.” She writes it down\. “I’ll walk with you: somebody has to write it down\.”/);
  assert.match(between.printed, /ACTIONS:\n- go_to_lead: On to The Drowned Rat\n\nPHASE: between \(Use: go\)\n$/);

  const journal = capture();
  verbs.journal(game, journal);
  assert.match(journal.printed, /^MODE: journal\n\nThe investigator's notebook:\n\nThe Hanged Clerk: Murder by persons unknown\n· Prout was murdered\./);
  assert.match(journal.printed, /Quests:\n- The Hanged Clerk \(active\): Prout's death is on the books as murder by persons unknown\./);
  assert.match(journal.printed, /Flags: prout_death = murder, unnamed/);

  const went = capture();
  assert.equal(await verbs.go(game, went, { afterMs: 50 }), 0);
  assert.match(went.printed, /^MODE: scene\n\n\[The Drowned Rat, evening\] Here: Sergeant Agnes Kell, the big man with the bandaged hand, the landlady\./);
  assert.match(went.printed, /The Drowned Rat leans over the river stairs/);
  assert.match(went.printed, /PHASE: done \(your turn/);
});

test("end: with no exit, the endings; with one, the scene ends as the owner ends it, and the story moves on (MODE: between); a wrong one is refused", async () => {
  const game = demoBackend({ ms: 1 });
  const listed = capture();
  assert.equal(await verbs.end(game, undefined, listed), 0);
  assert.match(listed.printed, /^\(The endings here: case-made \(The case is made\), open-case \(Murder by persons unknown\), .* and walked-away \(Walked away\)\.\)\n$/);
  const wrong = capture();
  assert.equal(await verbs.end(game, "fight", wrong), 1);
  assert.match(wrong.printed, /^\(There's no ending called fight here: there's case-made/);

  const ended = capture();
  assert.equal(await verbs.end(game, "open-case", ended), 0);
  assert.match(ended.printed, /^MODE: between\n/);
  const again = capture();
  assert.equal(await verbs.end(game, "open-case", again), 1, "nothing being played");
  assert.equal(again.printed, "(There's no scene being played.)\n");
});

test("observe once the scene is over: still moving on, stuck (carry_on), the fight (MODE: fight), The End (MODE: end); a spectator's", () => {
  const moving = capture();
  verbs.observe(showing(yardOver(clerkEnded())), moving);
  assert.match(moving.printed, /^MODE: scene\n/);
  assert.match(moving.printed, /PHASE: over \(the story is moving on: observe again\)\n$/);

  const stuck = capture();
  verbs.observe(showing(yardOver({ ...clerkEnded(), game: { ...clerkEnded().game, onward: "failed", onwardNote: "The story got stuck on the way: the AI service refused it." } })), stuck);
  assert.match(stuck.printed, /ACTIONS:\n- carry_on: The story got stuck on the way: try again\n\nPHASE: over \(the story got stuck on the way: the AI service refused it\.\)\. Use: go, which tries it again\n$/);

  const fight = capture();
  verbs.observe(showing({ ...yardOver(heronFought()), title: "The Heron Warehouse", over: false, fighting: true }), fight);
  assert.equal(fight.printed, `MODE: fight\n\n[The Heron Warehouse] Roll for initiative!\n\n${STANDIN.observe}\n\nACTIONS:\n- fight: To the fight\n\nPHASE: fight (Use: act --id fight)\n`);

  const end = capture();
  verbs.observe(showing(yardOver(storyOver(), { title: "The King's Morning", sceneId: "11" })), end);
  assert.match(end.printed, /^MODE: end\n\nTHE END\n\nKell's pencil stops\./);
  assert.match(end.printed, /How it went:\n1\. The Hanged Clerk: Murder by persons unknown\n {3}Prout was murdered\. .*\n2\. The Drowned Rat: What Big Hobb knows\n/);
  assert.match(end.printed, /The GM's bar tab this sitting: \$0\.05\. The King has graciously declined to pay it\.\n\nPHASE: end \(the story is over\)\n$/);

  const watching = capture();
  verbs.observe(showing(yardOver(ratWaiting(), { watching: "Pell Marrow" })), watching);
  assert.match(watching.printed, /^MODE: scene\n[\s\S]*PHASE: over \(Pell Marrow goes on when ready: observe again\)\n$/);
  assert.equal(storyOf(ratWaiting()).lead?.title, "The Drowned Rat");
});
