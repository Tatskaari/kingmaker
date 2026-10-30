import assert from "node:assert/strict";
import { test } from "node:test";
import type { Beat } from "../fight/script.ts";
import { YARD } from "../check/fixture.ts";
import type { SceneView } from "../scene/view.ts";
import type { Unit } from "../../shared/fight/types.ts";
import { moodOf, musicOf } from "./attach.ts";
import { audition, music, setSoundOut, sfx, ui } from "./cues.ts";
import type { SoundMessage } from "./engine.ts";
import { fightSounds } from "./fight.ts";
import { SceneSound } from "./scene.ts";
import { Voices } from "./voices.ts";

/**
 * What the client says to the engine (cues.ts) and when: nothing with nowhere to say it; a turn's
 * words together; the menus' ticks; the music only when it changes, and the sound board's held over
 * it; a scene's chime, talk, dice and close (scene.ts); a fight's beats (fight.ts); and the music for
 * each screen (attach.ts moodOf).
 */

/** What's said from now on, kept. */
function heard(): SoundMessage[] {
  const said: SoundMessage[] = [];
  setSoundOut({ send: messages => said.push(...messages) });
  return said;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const sfxOf = (said: SoundMessage[]) => said.flatMap(m => (m.type === "sfx" ? [m.cue.sfx] : []));

test("nothing is said with nowhere to say it, and a turn's words go together", async () => {
  setSoundOut(undefined);
  sfx("dice.roll");
  const sends: SoundMessage[][] = [];
  setSoundOut({ send: messages => sends.push(messages) });
  sfx("dice.roll");
  sfx("dice.success", {}, { delay: 480 });
  await flush();
  assert.deepEqual(sends, [[{ type: "sfx", cue: { sfx: "dice.roll" } }, { type: "sfx", cue: { sfx: "dice.success" }, delay: 480 }]]);
});

test("the menus: moves within 30 ms are one tick; a menu closing as something's chosen in it says only the choice", async () => {
  const said = heard();
  await new Promise(resolve => setTimeout(resolve, 40));
  ui("move");
  ui("move");
  ui("choose");
  ui("close");
  await flush();
  assert.deepEqual(sfxOf(said), ["ui.move", "ui.choose"]);
});

test("the music is said when it changes, and the sound board's mood is held over the screen's until it lets go", async () => {
  const said = heard();
  music("title");
  music("title");
  audition("fight");
  music("town");
  audition(undefined);
  await flush();
  assert.deepEqual(said.filter(m => m.type === "music").map(m => m.type === "music" && m.mood), ["title", "fight", "town"]);
});

test("music context changes send a new request even in the same mood, and audition restores the latest context", async () => {
  const said = heard();
  music("town", { map: "caerwyn", slot: "morning" });
  music("town", { slot: "morning", map: "caerwyn" });
  music("town", { map: "caerwyn", slot: "afternoon" });
  music("town", { map: "palace", slot: "afternoon" });
  audition("fight");
  music("scene", { scene: "kings-morning", map: "palace", slot: "next-morning", track: "royal" });
  audition(undefined);
  await flush();
  assert.deepEqual(said, [
    { type: "music", mood: "town", map: "caerwyn", slot: "morning" },
    { type: "music", mood: "town", map: "caerwyn", slot: "afternoon" },
    { type: "music", mood: "town", map: "palace", slot: "afternoon" },
    { type: "music", mood: "fight" },
    { type: "music", mood: "scene", scene: "kings-morning", map: "palace", slot: "next-morning", track: "royal" },
  ]);
});

test("a scene opens with its chime (what it had isn't news); another opens with its own, a talk's quietly", async () => {
  const said = heard();
  const scene = new SceneSound(new Voices());
  scene.hear(YARD);
  scene.hear({ ...YARD, sceneId: "8" });
  scene.hear({ ...YARD, sceneId: "9", talk: true });
  await flush();
  assert.deepEqual(sfxOf(said), ["story.scene", "story.scene"]);
  assert.ok(!said.some(m => m.type === "blip"), "nothing of what was said before is said again");
});

test("a reply streaming in is said as it comes: the narration in the narrator's tick, a person's lines in their voice", async () => {
  const said = heard();
  const scene = new SceneSound(new Voices());
  scene.hear(YARD);
  const text = "Kell looks up. “Investigator.”";
  const draft = { speaker: "gm", kind: "narration" as const, text, markup: { speech: [{ start: 15, end: 30, speaker: "kell" }] }, attempt: 1, seq: 1 };
  scene.hear({ ...YARD, phase: "replying", turn: 4, draft });
  await flush();
  const blips = said.flatMap(m => (m.type === "blip" ? [m] : []));
  assert.equal(blips[0]?.voice.pitch, 330, "the narration in the narrator's voice");
  const kell = blips.filter(b => b.voice.pitch !== 330);
  assert.ok(kell.length && kell[0]!.letter === "I", "her line in hers, from its first letter");
  // It grows: only what's new is said.
  const before = blips.length;
  scene.hear({ ...YARD, phase: "replying", turn: 4, draft: { ...draft, text: `${text} She writes.`, seq: 2 } });
  await flush();
  assert.deepEqual(said.flatMap(m => (m.type === "blip" ? [m.letter] : [])).slice(before), ["S", "w", "t"]);
});

test("the dice: a roll's rattle, and how a check went once they've settled; an attack's rattle alone", async () => {
  const rolled = async (text: string) => {
    const said = heard();
    const scene = new SceneSound(new Voices());
    scene.hear(YARD);
    scene.hear({ ...YARD, entries: [...YARD.entries, { turn: 4, speaker: "dice", kind: "roll", text }] } satisfies SceneView);
    await flush();
    return said.flatMap(m => (m.type === "sfx" && m.cue.sfx !== "story.scene" ? [`${m.cue.sfx}${m.delay ? `@${m.delay}` : ""}`] : []));
  };
  assert.deepEqual(await rolled("Insight check: 12 + 2 = 14 vs DC 12: success (only just)."), ["dice.roll", "dice.success@480"]);
  assert.deepEqual(await rolled("Insight check: 5 + 2 = 7 vs DC 12: failure (well short)."), ["dice.roll", "dice.failure@480"]);
  assert.deepEqual(await rolled("Persuasion check: 20 + 2 = 22 vs DC 15: success (natural 20!)."), ["dice.roll", "dice.crit@480"]);
  assert.deepEqual(await rolled("Persuasion check: 1 + 2 = 3 vs DC 15: failure (natural 1!)."), ["dice.roll", "dice.fumble@480"]);
  assert.deepEqual(await rolled("Fire Bolt: your attack on the boy: 14 +5 = 19 vs AC 12: hit"), ["dice.roll"]);
});

test("a scene's end closes with a chord", async () => {
  const said = heard();
  const scene = new SceneSound(new Voices());
  scene.hear(YARD);
  scene.hear({ ...YARD, over: true });
  await flush();
  assert.deepEqual(sfxOf(said), ["story.scene", "story.ended"]);
});

test("a fight's beats, each when it plays: the player's turn chimes, an area's blast is its moment's one boom", async () => {
  const said = heard();
  const unit = (id: string, role: Unit["role"]) => ({ id, role }) as Unit;
  const units = { pc: unit("pc", "player"), crake: unit("crake", "bruiser") };
  const beats: Beat[] = [
    { kind: "turn", t: 0, ms: 300, unit: "crake" },
    { kind: "swing", t: 300, ms: 200, by: "crake", to: { x: 1, y: 1 }, with: "Club" },
    { kind: "hit", t: 500, ms: 300, unit: "pc", amount: 4, type: "bludgeoning", critical: false },
    { kind: "turn", t: 800, ms: 300, unit: "pc" },
    { kind: "area", t: 1100, ms: 600, by: "pc", to: { x: 2, y: 2 }, tiles: [{ x: 2, y: 2 }, { x: 3, y: 2 }], spell: "Burning Hands", element: "fire" },
    { kind: "hit", t: 1700, ms: 300, unit: "crake", amount: 9, type: "fire", critical: false },
  ];
  fightSounds(beats, units, b => b.t);
  await flush();
  assert.deepEqual(said.flatMap(m => (m.type === "sfx" ? [`${m.cue.sfx}@${m.delay ?? 0}`] : [])), [
    "blow.swing@300", "blow.hit@500", "fight.turn@800", "spell.cast@1100", "spell.area@1400",
  ]);
  assert.ok(said.every(m => m.type !== "sfx" || m.group === "fight"), "each in the fight's group, for a hurried moment to stop");
});

test("the music for each screen", () => {
  const screen = (s: object) => moodOf(s as Parameters<typeof moodOf>[0]);
  assert.equal(screen({ screen: "title" }), "title");
  assert.equal(screen({ screen: "creating" }), "title");
  assert.equal(screen({ screen: "explore", explore: { view: { ex: { story: { time: "morning" } } } } }), "town");
  assert.equal(screen({ screen: "explore", explore: { view: { ex: { story: { time: "night" } } } } }), "night");
  assert.equal(screen({ screen: "scene", scene: { page: "scene", view: { ...YARD } } }), "scene");
  assert.equal(screen({ screen: "scene", scene: { page: "scene", view: { ...YARD, talk: true } } }), "between");
  assert.equal(screen({ screen: "scene", scene: { page: "scene", view: { ...YARD, musicTime: "evening", place: { time: "evening" } } } }), "night");
  assert.equal(screen({ screen: "scene", scene: { page: "between", view: YARD } }), "between");
  assert.equal(screen({ screen: "scene", scene: { page: "end", view: YARD } }), "end");
  assert.equal(screen({ screen: "fight", fight: { view: { status: "on" }, player: { caughtUp: false } } }), "fight");
  assert.equal(screen({ screen: "fight", fight: { view: { status: "over" }, player: { caughtUp: true } } }), null);
});

test("authored music follows the active scene and map, including fights, without leaking an old scene into a new one", () => {
  const request = (app: object) => musicOf(app as Parameters<typeof musicOf>[0]);
  const explore = { view: { game: "1", ex: { map: "music-test-town", scene: "hanged-clerk", story: { time: "next-morning" } } } };
  const scene = { page: "scene", view: { ...YARD, musicTime: "next-morning" } };
  assert.deepEqual(request({ screen: "explore", explore }), { mood: "town", map: "music-test-town", slot: "next-morning" });
  assert.deepEqual(request({ screen: "scene", explore, scene }), { mood: "scene", scene: "hanged-clerk", map: "music-test-town", slot: "next-morning" });
  assert.deepEqual(request({ screen: "scene", explore, scene: { ...scene, view: { ...scene.view, talk: true, sceneKey: "companion-conversation" } } }), { mood: "between", scene: "companion-conversation", map: "music-test-town", slot: "next-morning" });
  assert.deepEqual(request({ screen: "scene", explore, scene: { ...scene, page: "fight" } }), { mood: "fight", scene: "hanged-clerk", map: "music-test-town", slot: "combat" });
  const fight = { view: { game: "1", status: "on", map: { id: "music-test-town", music: { combat: "drums" } } }, player: { caughtUp: false } };
  assert.deepEqual(request({ screen: "fight", explore, scene, fight }), { mood: "fight", scene: "hanged-clerk", map: "music-test-town", slot: "combat", track: "drums" });
  assert.deepEqual(request({ screen: "fight", explore: { view: { ...explore.view, game: "old-game" } }, scene, fight }), { mood: "fight", map: "music-test-town", slot: "combat", track: "drums" });
  assert.deepEqual(request({ screen: "fight", explore, scene, fight: { ...fight, view: { ...fight.view, status: "over" }, player: { caughtUp: true } } }), { mood: null });
  for (const page of ["between", "end"]) assert.deepEqual(request({ screen: "scene", explore, scene: { ...scene, page } }), { mood: page });
  assert.deepEqual(request({ screen: "title", explore, scene }), { mood: "title" });
  assert.deepEqual(request({ screen: "explore", explore: { view: { ...explore.view, fight: { title: "Brawl" } } } }), { mood: "fight", map: "music-test-town", slot: "combat" });
});
