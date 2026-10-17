// New: the story's screens (story-design §4.5), drawn by the real components from view models, after the prototype's src/app/smoke/screens-check.tsx at 44c6d4a (its way on and between-scenes checks).
/**
 * The way on and the screens between scenes, at 80x24 and 130x42: once a scene is over, the box
 * becomes the way on (the story moving on, with the spinner; stuck, with why; on with Kell; the fight
 * in red; a summons; The End; a spectator's), and Enter or a click goes on; Kell's talk, a line at a
 * time, word for word talkBetween's, and Enter walking to the lead; the card with nobody to walk with;
 * the notebook and the quests over it; the fight's stand-in card and Fight it out; The End.
 */
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { Rejection } from "../backend.ts";
import { ScenePlay } from "../app.tsx";
import { SceneModel, type SceneActions } from "../scene/model.ts";
import type { SceneView } from "../scene/view.ts";
import { STANDIN, talkBetween } from "../story/words.ts";
import { C } from "../theme.ts";
import { clerkEnded, heronFought, OPEN_CASE, ratOpening, ratWaiting, storyOf, storyOver, yardOver } from "./story.ts";

type Checks = Array<[string, boolean]>;

const flat = (t: string) => t.replace(/\s+/g, " ");
const hex = (c: { r: number; g: number; b: number }) => `#${[c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
/** The text inside a frame's borders, as one line, so wrapped words read whole. */
const inside = (frame: string) => flat(frame.replace(/[│┃╭╮╰╯─┌┐└┘║╔╗╚╝═▄█▀]/g, " "));

/** The moves the screens make, kept to read back; each answered as `answer` says (made, by default). */
function recorder(answer: (move: string) => Rejection | undefined = () => undefined): { made: string[]; actions: SceneActions } {
  const made: string[] = [];
  const call = (move: string) => () => { made.push(move); return Promise.resolve(answer(move)); };
  return {
    made,
    actions: {
      say: text => { made.push(`say ${text}`); }, retry: () => { made.push("retry"); }, setSuggestions: () => Promise.resolve(undefined), quit: () => { made.push("quit"); },
      walk: call("walk"), carryOn: call("carryOn"), fightItOut: call("fightItOut"), end: exit => { made.push(`end ${exit}`); return Promise.resolve(answer(`end ${exit}`)); },
    },
  };
}

export async function checkStory(checks: Checks, show: boolean): Promise<void> {
  const was = process.env.KM_APP_TALK_MS;
  for (const [w, h] of [[80, 24], [130, 42]] as const) await sizes(checks, show, w, h);
  if (was === undefined) delete process.env.KM_APP_TALK_MS;
  else process.env.KM_APP_TALK_MS = was;
}

async function sizes(checks: Checks, show: boolean, w: number, h: number): Promise<void> {
  const size = `${w}x${h}`;
  const { made, actions } = recorder();
  const scene = new SceneModel(yardOver(clerkEnded()), actions);
  const setup = await testRender(<ScenePlay scene={scene} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const style = (text: string) => {
    for (const line of setup.captureSpans().lines) {
      let row = "";
      for (const s of line.spans) { if ((row + s.text).includes(text) && s.text.includes(text.slice(0, 3))) return { fg: hex(s.fg), bold: (s.attributes & 1) !== 0 }; row += s.text; }
    }
    return undefined;
  };
  const set = (view: SceneView) => act(() => scene.update(view));
  const enter = async () => { act(() => setup.mockInput.pressEnter()); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); };
  const box = (frame: string) => frame.split("\n").slice(-5).join("\n");
  let frame = await draw();
  frame = await draw();
  if (show) console.log(`${size}, the story moving on\n${frame}`);

  // The scene's end: a rule across with its title, the way on in place of the box, not ready, the spinner.
  checks.push([`${size}: story: the scene's end is a rule across with its title`, new RegExp(`─ ${OPEN_CASE.ending} ─`).test(frame)]);
  checks.push([`${size}: story: moving on, the way on says to wait, and the last word stays put`, /▶ Continue, once the story has moved on/.test(box(frame)) && (w < 90 ? /\(take your time\)/ : /\(take your time: the last word stays put\)/).test(flat(box(frame))) && !/What do you say\?/.test(frame)]);
  checks.push([`${size}: story: moving on, the spinner says the story moves on`, /The story moves on…/.test(frame)]);
  checks.push([`${size}: story: the way on's title is how the scene ended`, new RegExp(`╭─ ${OPEN_CASE.ending} ─`).test(box(frame)) || box(frame).includes(` ${OPEN_CASE.ending} `)]);
  // Enter before it's ready: queued.
  await enter();
  frame = await draw();
  checks.push([`${size}: story: Enter before the story's ready waits for it ("Going on as soon as the story's ready")`, /Going on as soon as the story's ready/.test(frame) && scene.queued]);

  // Waiting on the GM: the note on the status line.
  set(yardOver({ ...clerkEnded(), game: { ...clerkEnded().game, onward: "waiting", onwardNote: "The GM has lost the thread for a moment: trying again." } }));
  frame = await draw();
  checks.push([`${size}: story: a boundary waiting on the GM says so on the status line`, style("The GM has lost the thread for a moment")?.fg === C.warn]);

  // Stuck: the way on tries again, the note says why; Enter carries it on.
  const stuck = { ...clerkEnded(), game: { ...clerkEnded().game, onward: "failed", onwardNote: "The story got stuck on the way: the AI service turned it down." } };
  scene.queued = false;
  set(yardOver(stuck));
  frame = await draw();
  if (show) console.log(`${size}, stuck\n${frame}`);
  checks.push([`${size}: story: stuck, the way on is to try again, ready, and the status line says why`, /▶ The story got stuck on the way: try again/.test(frame) && /Enter, or click here/.test(frame) && style("The story got stuck on the way: the AI service")?.fg === C.warn]);
  await enter();
  checks.push([`${size}: story: Enter on it calls carry_on`, made.at(-1) === "carryOn"]);

  // Ready, with Kell: in the lead's gold; the keys say Enter goes on.
  scene.status = undefined;
  set(yardOver(ratWaiting()));
  frame = await draw();
  if (show) console.log(`${size}, on with Kell\n${frame}`);
  checks.push([`${size}: story: ready, the way on goes on with Kell, in the lead's gold`, /▶ On, with Sergeant Agnes Kell/.test(frame) && style("On, with Sergeant Agnes Kell")?.fg === C.lead && /Enter, or click here/.test(frame) && !/The story moves on…/.test(frame)]);
  checks.push([`${size}: story: the keys say Enter goes on`, /^ *Enter go on/.test(frame.split("\n").filter(r => r.trim()).at(-1) ?? "")]);
  checks.push([`${size}: story: the frame keeps the scene's own time, though the story's has moved on to evening`, frame.split("\n")[0]!.includes(" The Hanged Clerk · Morning ")]);

  // /journal: the notebook, with how things stood; /quests.
  act(() => scene.input("/journal"));
  frame = await draw();
  if (show) console.log(`${size}, the notebook\n${frame}`);
  checks.push([`${size}: story: /journal, the notebook: the scene's ending, its line, how things stood`, /The investigator's notebook/.test(frame) && inside(frame).includes(`The Hanged Clerk: ${OPEN_CASE.ending}`) && inside(frame).includes(`· ${OPEN_CASE.journal}`) && inside(frame).includes("- Prout was murdered, and the watch has it down as persons unknown.")]);
  await esc();
  act(() => scene.input("/quests"));
  frame = await draw();
  if (show) console.log(`${size}, the quests\n${frame}`);
  checks.push([`${size}: story: /quests: each quest as it stands`, /The quests/.test(frame) && inside(frame).includes(`The Hanged Clerk (active): ${OPEN_CASE.quest}`)]);
  await esc();

  // Enter: between scenes, Kell's talk, all at once (KM_APP_TALK_MS=0), word for word talkBetween's.
  process.env.KM_APP_TALK_MS = "0";
  await enter();
  frame = await draw();
  if (show) console.log(`${size}, Kell's talk\n${frame}`);
  const talk = talkBetween({ id: "kell", name: "Sergeant Agnes Kell" }, { notebook: [OPEN_CASE.journal], next: { id: "drowned-rat", title: "The Drowned Rat" }, time: "evening" });
  // (Read without the spaces: the terminal's wrapping can put a closing quote on a row of its own.)
  const said = inside(frame).replace(/ /g, "");
  checks.push([`${size}: story: Enter goes between scenes: under the time of day, Kell's talk, word for word talkBetween's`, scene.page === "between" && /Evening, on the eve of the Assembly/.test(frame) && talk.every(l => said.includes(l.text.replace(/\s/g, "")))]);
  checks.push([`${size}: story: Kell's lines in the talk under her name, the way on "On to The Drowned Rat" with her`, /Sergeant Agnes Kell:/.test(frame) && /With Sergeant Agnes Kell/.test(frame) && /▶ On to The Drowned Rat/.test(frame) && style("On to The Drowned Rat")?.fg === C.lead]);
  // j: the notebook, between scenes too.
  act(() => setup.mockInput.pressKey("j"));
  frame = await draw();
  checks.push([`${size}: story: j between scenes opens the notebook`, scene.overlay?.kind === "journal" && /The investigator's notebook/.test(frame)]);
  await esc();
  // Enter walks to the lead; the seat moves, and the Rat's opening comes up, streaming.
  await enter();
  checks.push([`${size}: story: Enter at the end of the talk walks to the lead`, made.at(-1) === "walk"]);
  set(ratOpening());
  frame = await draw();
  if (show) console.log(`${size}, the Rat opening\n${frame}`);
  checks.push([`${size}: story: the lead's scene comes up, its opening streaming, at evening`, scene.page === "scene" && frame.split("\n")[0]!.includes(" The Drowned Rat · Evening ") && /The Drowned Rat smells of river/.test(frame) && /The GM is speaking…/.test(frame)]);
  await setup.dispose();

  // The talk paced: a line at a time; Enter hurries it to its end.
  process.env.KM_APP_TALK_MS = "5000";
  const paced = new SceneModel(yardOver(ratWaiting()), recorder().actions);
  paced.goOn();
  const pacedSetup = await testRender(<ScenePlay scene={paced} />, { width: w, height: h });
  await pacedSetup.renderOnce();
  let pacedFrame = pacedSetup.captureCharFrame();
  checks.push([`${size}: story: the talk comes a line at a time (Kell hasn't finished)`, inside(pacedFrame).includes("“For the record.”") && !inside(pacedFrame).includes("“The Drowned Rat, then.”") && /hasn't finished/.test(pacedFrame)]);
  act(() => pacedSetup.mockInput.pressEnter());
  await pacedSetup.renderOnce();
  pacedFrame = pacedSetup.captureCharFrame();
  checks.push([`${size}: story: Enter hurries it to its end`, inside(pacedFrame).includes("“The Drowned Rat, then.”") && /▶ On to The Drowned Rat/.test(pacedFrame)]);
  await pacedSetup.dispose();

  // The card, with nobody to walk with.
  process.env.KM_APP_TALK_MS = "0";
  const alone = new SceneModel(yardOver({ ...ratWaiting("Dusk finds you on the river stairs."), followers: [] }), recorder().actions);
  alone.goOn();
  const cardSetup = await testRender(<ScenePlay scene={alone} />, { width: w, height: h });
  await cardSetup.renderOnce();
  const card = cardSetup.captureCharFrame();
  if (show) console.log(`${size}, the card\n${card}`);
  checks.push([`${size}: story: with nobody to walk with, the card: the notebook, the boundary's lead, the lead, Enter goes on`, /Evening, on the eve of the Assembly/.test(card) && /Your notebook:/.test(card) && inside(card).includes("Dusk finds you on the river stairs.") && /The lead: The Drowned Rat\./.test(card) && /Press Enter to go on\./.test(card)]);
  await cardSetup.dispose();

  // A summons: the next scene has come for the player while the last is still on screen.
  const summoned = new SceneModel(yardOver(heronFought(), { title: "The Heron Warehouse", sceneId: "10" }), recorder().actions);
  summoned.update({ ...ratOpening(storyOver()), sceneId: "11", title: "The King's Morning", time: "The morning of the Assembly" });
  const summonSetup = await testRender(<ScenePlay scene={summoned} />, { width: w, height: h });
  await summonSetup.renderOnce();
  let summon = summonSetup.captureCharFrame();
  if (show) console.log(`${size}, a summons\n${summon}`);
  checks.push([`${size}: story: a summons: the scene that's over stays up, the way on goes on to the next`, summon.split("\n")[0]!.includes(" The Heron Warehouse ") && /▶ On to The King's Morning/.test(summon)]);
  act(() => summonSetup.mockInput.pressEnter());
  await summonSetup.renderOnce();
  summon = summonSetup.captureCharFrame();
  checks.push([`${size}: story: Enter shows it, its opening coming in`, summon.split("\n")[0]!.includes(" The King's Morning · The morning of the Assembly ")]);
  await summonSetup.dispose();

  // A spectator: the lead goes on.
  const watcher = new SceneModel(yardOver(ratWaiting(), { watching: "Pell Marrow" }), recorder().actions);
  const watchSetup = await testRender(<ScenePlay scene={watcher} />, { width: w, height: h });
  await watchSetup.renderOnce();
  const watching = watchSetup.captureCharFrame();
  checks.push([`${size}: story: a spectator's way on: the lead goes on when ready`, /▶ Watching: Pell Marrow goes on when ready/.test(watching)]);
  await watchSetup.dispose();

  // The fight: the way on in red; Enter, the stand-in's card; Fight it out.
  const { made: fought, actions: fightActions } = recorder();
  const fighter = new SceneModel({ ...yardOver(heronFought(), { title: "The Heron Warehouse", sceneId: "10", entries: [...yardOver().entries.slice(0, -1), { turn: 3, speaker: "system", kind: "system", text: "Scene ends: Roll for initiative" }] }), over: false, fighting: true }, fightActions);
  const fightSetup = await testRender(<ScenePlay scene={fighter} />, { width: w, height: h });
  const fightDraw = async () => { await fightSetup.renderOnce(); return fightSetup.captureCharFrame(); };
  const fightStyle = (text: string) => {
    for (const line of fightSetup.captureSpans().lines) {
      let row = "";
      for (const s of line.spans) { if ((row + s.text).includes(text) && s.text.includes(text.slice(0, 3))) return hex(s.fg); row += s.text; }
    }
    return undefined;
  };
  let fight = await fightDraw();
  if (show) console.log(`${size}, the fight's way on\n${fight}`);
  checks.push([`${size}: story: a combat exit: "Roll for initiative" across, and the way on in red: To the fight`, /─ Roll for initiative ─/.test(fight) && /Roll for initiative!/.test(fight) && /▶ To the fight/.test(fight) && fightStyle("To the fight") === C.danger]);
  act(() => fightSetup.mockInput.pressEnter());
  fight = await fightDraw();
  if (show) console.log(`${size}, the fight's card\n${fight}`);
  checks.push([`${size}: story: Enter: the stand-in's card, its word on itself, Fight it out`, fighter.page === "fight" && inside(fight).includes(STANDIN.observe) && /▶ Fight it out/.test(fight) && fightStyle("Roll for initiative!") === C.danger]);
  act(() => fightSetup.mockInput.pressEnter());
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  fight = await fightDraw();
  checks.push([`${size}: story: Enter fights it out (fight_it_out), and it's back to the scene`, fought.at(-1) === "fightItOut" && fighter.page === "scene"]);
  await fightSetup.dispose();

  // The End: the way on, then the screen.
  const ender = new SceneModel(yardOver(storyOver(), { title: "The King's Morning", sceneId: "11" }), recorder().actions);
  const endSetup = await testRender(<ScenePlay scene={ender} />, { width: w, height: h });
  await endSetup.renderOnce();
  let end = endSetup.captureCharFrame();
  checks.push([`${size}: story: the last scene over, the way on is The End`, /▶ The End/.test(end)]);
  act(() => endSetup.mockInput.pressEnter());
  await endSetup.renderOnce();
  end = endSetup.captureCharFrame();
  if (show) console.log(`${size}, The End\n${end}`);
  const big = w >= 70 && h >= 30;
  checks.push([`${size}: story: The End${big ? " in big letters" : ""}: the closing, how it went, each chapter's notebook lines, the bar tab`, ender.page === "end" && (big ? /█/.test(end) : /T H E {3}E N D/.test(end))
    && inside(end).includes("Kell's pencil stops.") && /How it went/.test(end) && /1\. The Hanged Clerk: Murder by persons unknown/.test(end) && /4\. The King's Morning: Done right by/.test(end)
    && inside(end).includes("The fight wasn't played: it's told as won.") && inside(end).includes("The GM's bar tab this sitting: $0.05.")]);
  act(() => endSetup.mockInput.pressEnter());
  await endSetup.renderOnce();
  checks.push([`${size}: story: Enter at The End goes back to the title`, ender.page === "scene"]);
  await endSetup.dispose();

}
