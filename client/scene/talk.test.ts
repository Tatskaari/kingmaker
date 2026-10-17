import assert from "node:assert/strict";
import { test } from "node:test";
import { FAREWELL, WALK_ON } from "../../shared/scene/talk.ts";
import type { Rejection } from "../backend.ts";
import { yardRows } from "../check/fixture.ts";
import { ratWaiting, yardOver } from "../check/story.ts";
import { KELL_LINES, kellTalk, kellTalkOver } from "../check/town.ts";
import { demoBackend } from "../demo.ts";
import * as verbs from "../headless.ts";
import { actionLines, phaseLine } from "./text.ts";
import { SceneModel, type SceneActions } from "./model.ts";
import { sceneViewOf } from "./rows.ts";

/**
 * A talk with someone who walks with the player (town-design §3.6, §3.9): its choices (its lines,
 * the goodbye, walking on), said at once; its way on back to the map; the card's t; a talk from the
 * rows (scene.kind); and the demo's talk with Kell, headless.
 */

function recorder(): { sent: string[]; actions: SceneActions } {
  const sent: string[] = [];
  return {
    sent,
    actions: {
      say: text => sent.push(text), retry: () => {}, setSuggestions: async () => undefined, out: () => sent.push("(out)"), quit: () => {},
      talk: async (who): Promise<Rejection | undefined> => { sent.push(`(talk ${who})`); return undefined; },
    },
  };
}

test("a talk's choices: its lines, then the goodbye, then walking on; none for a spectator, while it's ending, or once it's over", () => {
  const { actions } = recorder();
  const scene = new SceneModel(kellTalk(), actions);
  assert.deepEqual(scene.choices().map(c => [c.id, c.label, c.kind]), [
    ["say_1", KELL_LINES[0], "say"], ["say_2", KELL_LINES[1], "say"], ["say_3", KELL_LINES[2], "say"],
    ["say_goodbye", FAREWELL, "say"], ["walk_on", WALK_ON, "move"],
  ]);
  // The lines off: the ways out stay.
  assert.deepEqual(new SceneModel(kellTalk({ suggestions: [], suggestionsOn: false }), actions).choices().map(c => c.id), ["say_goodbye", "walk_on"]);
  assert.deepEqual(new SceneModel(kellTalk({ watching: "Pell Marrow", mayType: false }), actions).choices(), []);
  assert.deepEqual(new SceneModel(kellTalk({ ending: true }), actions).choices(), []);
  assert.deepEqual(new SceneModel(kellTalkOver(), actions).choices(), []);
  assert.deepEqual(new SceneModel(yardOver(ratWaiting()), actions).choices(), [], "a scene of the story has suggested lines, not choices");
});

test("choosing: a line is said as typed (the goodbye too); walking on walks out of the talk", () => {
  const { sent, actions } = recorder();
  const scene = new SceneModel(kellTalk(), actions);
  const [first, , , goodbye, walkOn] = scene.choices();
  scene.choose(first!);
  assert.deepEqual(sent, [KELL_LINES[0]]);
  scene.choose(goodbye!);
  assert.deepEqual(sent, [KELL_LINES[0], FAREWELL]);
  scene.choose(walkOn!);
  assert.deepEqual(sent, [KELL_LINES[0], FAREWELL, "(out)"]);
});

test("a talk that's over: its way on goes back to the map, with no card; it holds no scene that comes after it", () => {
  const { sent, actions } = recorder();
  const scene = new SceneModel(kellTalkOver(), actions);
  const way = scene.wayOn()!;
  assert.deepEqual({ title: way.title, go: way.go, ready: way.ready, to: way.to }, { title: "Goodbye for now", go: "Back to the map", ready: true, to: "map" });
  scene.goOn();
  assert.deepEqual(sent, ["(out)"]);
  assert.equal(scene.page, "scene", "no moment between scenes after a talk");
  // Back on the map, and on to the Rat: its view is shown, not held behind the talk.
  scene.update({ ...kellTalk(), sceneId: "8", title: "The Drowned Rat", talk: undefined });
  assert.equal(scene.view.title, "The Drowned Rat");
  assert.equal(scene.next, undefined);

  const watching = new SceneModel({ ...kellTalkOver(), watching: "Pell Marrow" }, actions);
  assert.equal(watching.wayOn()?.to, "wait", "a spectator's is the lead's to take");
  assert.match(phaseLine(kellTalkOver()), /^PHASE: over \(the talk is over\. Use: act --id out, back to the map\)$/);
});

test("the card between scenes: t is a word with whoever walks with the player", async () => {
  const { sent, actions } = recorder();
  const scene = new SceneModel({ ...yardOver(ratWaiting()), onMap: true }, actions);
  scene.goOn();
  assert.equal(scene.page, "between");
  assert.deepEqual(scene.between()?.friend, { key: "kell", name: "Sergeant Agnes Kell" });
  scene.talkWith("kell");
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(sent, ["(talk kell)"]);
});

test("from the rows: a scene of kind talk is a talk; an invented look's colour isn't the cast's", () => {
  const rows = yardRows();
  assert.equal(sceneViewOf(rows).talk, undefined);
  const talk = sceneViewOf({ ...rows, scene: { ...rows.scene, kind: "talk" } });
  assert.equal(talk.talk, true);
  const kell = rows.onStage.find(s => s.role !== "controller")!;
  const invented = { entityId: kell.entityId, fg: "orange", invention: { glyph: "v", color: "orange", motion: "still", light: false, being: true, group: false, nerd: undefined, material: undefined } };
  const view = sceneViewOf({ ...rows, looks: [...rows.looks.filter(l => l.entityId !== kell.entityId), invented] });
  assert.ok(view.present.every(p => p.color?.startsWith("#")), "the invented look's colour name isn't taken for the cast's hex");
});

test("headless, a talk's ACTIONS: its lines, say_goodbye and walk_on; none of them for a spectator", () => {
  assert.deepEqual(actionLines(kellTalk()), ["ACTIONS:", ...KELL_LINES.map((l, i) => `- say_${i + 1}: ${l}`), `- say_goodbye: ${FAREWELL}`, `- walk_on: ${WALK_ON}`]);
  assert.deepEqual(actionLines(kellTalk({ watching: "Pell Marrow", suggestions: [] })), []);
  assert.deepEqual(actionLines(kellTalkOver()), ["ACTIONS:", "- out: Back to the map, where the scene left you"]);
});

test("the demo's talk with Kell, headless: from the card, her greeting and lines; a line and her reply; the goodbye ends it; walking on puts the yard back as it was", async () => {
  const game = demoBackend({ ms: 1 });
  const capture = () => { const out = { printed: "", print: (t: string) => { out.printed += `${t}\n`; }, progress: () => {} }; return out; };
  assert.equal(await verbs.say(game, "Write him down as murdered, persons unknown.", capture()), 0);
  await new Promise(resolve => setTimeout(resolve, 120));
  const yard = game.view()!;
  assert.equal(yard.over, true);

  assert.equal(await game.interact({ verb: "talk", target: "kell" }), undefined);
  await new Promise(resolve => setTimeout(resolve, 40));
  const opened = capture();
  verbs.observe(game, opened);
  assert.match(opened.printed, /^MODE: scene\n\n\[A word with Sergeant Agnes Kell, morning\]/);
  assert.match(opened.printed, /Kell is leaning on the lane wall/);
  assert.match(opened.printed, /\nACTIONS:\n- say_1: How long have you been with the watch, Sergeant\?\n- say_2: .*\n- say_3: .*\n- say_goodbye: I'll leave you to it\.\n- walk_on: Walk on without a word \(back to the map\)\n/);

  const line = capture();
  assert.equal(await verbs.act(game, "say_1", line, { afterMs: 400 }), 0);
  assert.match(line.printed, /^> How long have you been with the watch, Sergeant\?\n\nKell considers that/);
  assert.match(line.printed, /- say_1: What made you join the watch\?/);

  const goodbye = capture();
  assert.equal(await verbs.act(game, "say_goodbye", goodbye, { afterMs: 100 }), 0);
  assert.match(goodbye.printed, /^> I'll leave you to it\.\n\nKell nods and goes back to her notebook\./);
  assert.equal(game.view()?.over, true);
  assert.equal(game.view()?.talk, true);

  const back = capture();
  assert.equal(await verbs.act(game, "out", back), 0);
  assert.deepEqual(game.view(), yard, "the yard, exactly as the talk found it");

  // Again, and this time walking on without a word, mid-talk.
  await game.interact({ verb: "talk", target: "kell" });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(game.view()?.talk, true);
  const walked = capture();
  assert.equal(await verbs.act(game, "walk_on", walked), 0);
  assert.deepEqual(game.view(), yard, "walking on puts it back too");
  assert.match(walked.printed, /^MODE: between/);
});
