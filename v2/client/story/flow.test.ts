import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal } from "../../shared/protocol/refusals.ts";
import type { Rejection } from "../backend.ts";
import { clerkEnded, heronFought, OPEN_CASE, ratOpening, ratWaiting, storyOf, storyOver, yardOver } from "../check/story.ts";
import { YARD } from "../check/fixture.ts";
import { SceneModel, type SceneActions } from "../scene/model.ts";
import { STANDIN } from "./words.ts";

/**
 * The way on through the scene's model (story-design §4.5), as the screens drive it: a scene that's
 * over stays up until Enter, whatever the seat does meanwhile; Enter waits for the story (and goes
 * as soon as it's ready), carries a stuck one on, goes between scenes, to the next scene that has
 * come, to the fight, or to The End; between scenes, Enter walks to the lead, and the lead's scene
 * comes up when the seat moves to it.
 */

/** The moves the model makes, kept to read back, each answered as `answer` says (made, by default). */
function moves(answer: (move: string) => Rejection | undefined = () => undefined) {
  const made: string[] = [];
  const call = (move: string) => () => { made.push(move); return Promise.resolve(answer(move)); };
  const actions: SceneActions = {
    say: text => { made.push(`say ${text}`); }, retry: () => { made.push("retry"); }, setSuggestions: () => Promise.resolve(undefined), out: () => { made.push("out"); }, quit: () => { made.push("quit"); },
    walk: call("walk"), carryOn: call("carryOn"), fightItOut: call("fightItOut"), end: exit => { made.push(`end ${exit}`); return Promise.resolve(answer(`end ${exit}`)); },
  };
  return { made, actions };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("over, the story moving on: Enter waits (queued), and goes between scenes as soon as the lead is there", () => {
  const { made, actions } = moves();
  const scene = new SceneModel(yardOver(), actions);
  assert.equal(scene.busy(), "The story moves on…");
  scene.goOn();
  assert.equal(scene.queued, true);
  assert.equal(scene.wayOn()?.go, "Going on as soon as the story's ready");
  assert.equal(scene.page, "scene");

  scene.update(yardOver(ratWaiting()));
  assert.equal(scene.page, "between", "queued: on as soon as it's ready");
  assert.equal(scene.between()?.go, "On to The Drowned Rat");
  assert.deepEqual(made, []);
});

test("between scenes, Enter walks to the lead; the seat moved, the lead's scene comes up", async () => {
  const { made, actions } = moves();
  const scene = new SceneModel(yardOver(ratWaiting()), actions);
  assert.equal(scene.wayOn()?.go, "On, with Sergeant Agnes Kell");
  scene.goOn();
  assert.equal(scene.page, "between");
  scene.toLead();
  await tick();
  assert.deepEqual(made, ["walk"]);
  scene.update(ratOpening());
  assert.deepEqual([scene.page, scene.view.title, scene.wayOn()], ["scene", "The Drowned Rat", undefined]);
  assert.equal(scene.busy(), "The GM is speaking…");
});

test("walking to the lead refused: the between screen says why, and stays", async () => {
  const { actions } = moves(() => refusal("no_lead"));
  const scene = new SceneModel(yardOver(ratWaiting()), actions);
  scene.goOn();
  scene.toLead();
  await tick();
  assert.deepEqual([scene.page, scene.status], ["between", "(The story hasn't said where it goes next yet.)"]);
});

test("a summons, or a spectator's seat following the lead: the scene that's over stays up until Enter, then the next one", () => {
  const { actions } = moves();
  const scene = new SceneModel(yardOver(clerkEnded()), actions);
  const king = { ...ratOpening(storyOver()), sceneId: "11", title: "The King's Morning" };
  scene.update(king);
  assert.equal(scene.view.title, "The Hanged Clerk", "the yard's last word stays put");
  assert.deepEqual(scene.wayOn(), { title: OPEN_CASE.ending, go: "On to The King's Morning", ready: true, to: "next" });
  scene.goOn();
  assert.deepEqual([scene.view.title, scene.page, scene.next], ["The King's Morning", "scene", undefined]);

  // A spectator who pressed Enter early goes on as soon as their seat moves.
  const watcher = new SceneModel(yardOver(ratWaiting(), { watching: "Pell Marrow" }), moves().actions);
  assert.equal(watcher.wayOn()?.go, "Watching: Pell Marrow goes on when ready");
  watcher.goOn();
  watcher.update({ ...ratOpening(), watching: "Pell Marrow" });
  assert.equal(watcher.view.title, "The Drowned Rat");
});

test("stuck: Enter carries the story on, and a refusal says why", async () => {
  const stuck = { ...clerkEnded(), game: { ...clerkEnded().game, onward: "failed", onwardNote: "The story got stuck on the way: the AI service said no." } };
  const { made, actions } = moves(move => (move === "carryOn" ? refusal("not_stuck") : undefined));
  const scene = new SceneModel(yardOver(stuck), actions);
  assert.equal(scene.wayOn()?.go, "The story got stuck on the way: try again");
  scene.goOn();
  await tick();
  assert.deepEqual(made, ["carryOn"]);
  assert.equal(scene.status, "(The story isn't stuck: there's nothing to carry on.)");
});

test("the fight: to its card, Fight it out, and back in the scene as it picks up; refused, the card says why", async () => {
  const { made, actions } = moves();
  const fighting = { ...yardOver(heronFought()), over: false, fighting: true };
  const scene = new SceneModel(fighting, actions);
  scene.goOn();
  assert.deepEqual([scene.page, scene.fight().go], ["fight", "Fight it out"]);
  scene.fightOn();
  await tick();
  assert.deepEqual([made, scene.page], [["fightItOut"], "scene"]);
  // The rows come with the move: the same scene, live again, the stand-in's lines in it and the aftermath being written.
  scene.update({ ...YARD, story: storyOf(heronFought()), phase: "replying", mayType: false, entries: [...fighting.entries, { turn: 4, speaker: "system", kind: "system", text: `The fight: ${STANDIN.summary}` }] });
  assert.deepEqual([scene.page, scene.wayOn(), scene.busy()], ["scene", undefined, "The GM is speaking…"]);

  const refused = new SceneModel(fighting, moves(() => refusal("no_fight")).actions);
  refused.goOn();
  refused.fightOn();
  await tick();
  assert.deepEqual([refused.page, refused.status], ["fight", "(There's no fight to be had here.)"]);
});

test("The End: Enter on the way on, then Enter goes back to the title", () => {
  const { made, actions } = moves();
  const scene = new SceneModel(yardOver(storyOver()), actions);
  scene.goOn();
  assert.equal(scene.page, "end");
  assert.match(scene.epilogue()!.tab, /^The GM's bar tab this sitting: \$0\.05\./);
  scene.toTitle();
  assert.deepEqual([made, scene.page], [["quit"], "scene"]);
});

test("/journal and /quests open their overlays; /end and /exits call end_scene as the owner, its refusal on the status line", async () => {
  const { made, actions } = moves(move => (move === "end " ? refusal("no_exit", { exits: "case-made (The case is made) and open-case (Murder by persons unknown)" }) : undefined));
  const scene = new SceneModel({ ...YARD, story: storyOf(clerkEnded()) }, actions);
  scene.input("/j");
  assert.equal(scene.overlay?.kind, "journal");
  scene.input("/quests");
  assert.equal(scene.overlay?.kind, "quests");
  scene.closeOverlay();
  scene.input("/end open-case");
  scene.input("/exits");
  await tick();
  assert.deepEqual(made, ["end open-case", "end "]);
  assert.equal(scene.status, "(The endings here: case-made (The case is made) and open-case (Murder by persons unknown).)");
});
