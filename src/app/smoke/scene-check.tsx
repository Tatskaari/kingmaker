/**
 * Does the scene screen show every character of the conversation, at every width? A made-up
 * conversation at the granary (long lines, dice, an item changing hands, things to say), drawn by
 * the real screens at several terminal sizes: the scene mid-talk, the same talk growing past the
 * panel (its scrollbar coming in), the scene once it's over (its last word still up, the way on
 * below it), and Kell telling the news between scenes. Each line's words are looked for in what was
 * drawn, whole; only a line scrolled partly off the top may be cut.
 *
 * Then the keys and clicks on them: a suggestion by its number and by a click; a command as it's
 * typed; a line and its Enter in one read (sent whole, the box emptied); the way on from a scene
 * that's over by Enter and by a click, but not by typing (nor by the Enter that ends the typing, nor
 * by the Enter meant for a line left in the box as the scene ended); a talk's lines, its goodbye and
 * walking on, numbered and clicked, at 80x24 too; and Kell between scenes, typed at and gone on from.
 *
 *   KM_RUNS_DIR=runs/check node --experimental-ffi --no-warnings --import tsx src/app/smoke/scene-check.tsx [--show]
 */
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { sceneById } from "../../../scenes/index.ts";
import { pregenSession } from "../../game/combat/pregen.ts";
import { registerLookCanvas } from "../../game/look/opentui.ts";
import type { Action } from "../../game/play.ts";
import { presentCast } from "../../runtime/brief.ts";
import { buildWorld, joinWorld } from "../../world/scene-world.ts";
import { Game, talkBetween, type Line } from "../game.ts";
import { BetweenScreen } from "../ui/between.tsx";
import { fitChoices, SceneScreen } from "../ui/scene.tsx";

process.env.KM_APP_TALK_MS = "0";
registerLookCanvas();
const session = await pregenSession({ pregen: "rogue", name: "Tamsin Vell", level: 3, seed: 3, sceneId: "hanged-clerk" });
const scene = sceneById("hanged-clerk");
Object.assign(session, { beat: scene.start });
const cast = presentCast(scene, session);
session.world = buildWorld(scene.id, scene.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name })), 0);

const lines: Line[] = [
  { kind: "header", speaker: "system", name: scene.title, text: scene.hook },
  { kind: "narration", speaker: "gm", text: "The yard behind the King's Granary smells of wet grain and pigeons. Wendell Prout turns slowly on the sack hoist above the shut loft door, and a scrawny boy in enormous boots is lobbing gutter stones at him with a running commentary." },
  { kind: "dialogue", speaker: "kell", name: "Sergeant Agnes Kell", text: "“Sergeant Kell, of the watch. The Captain says suicide.” She does not say what she says. “Investigator.”" },
  { kind: "player", speaker: "player", name: "Tamsin Vell", text: "\"Morning, Sergeant. What have we got?\" I look up at the body, then at the boy with the stones, and I take out my notebook so that everybody can see that I have one too." },
  { kind: "roll", speaker: "dice", text: "Medicine check to examine Prout for signs he was killed before he was hanged: 11 + 1 = 12 vs DC 12: success" },
  { kind: "narration", speaker: "gm", text: "Up close, from the loft ladder, Prout's neck tells a different story from the Captain's: the rope mark rides high and clean, and under it, lower down, there is a second, darker bruise where a thumb pressed hard.\n\nSomebody held him first. The rope came after." },
  { kind: "player", speaker: "player", name: "Tamsin Vell", text: "*throws my javelin at the rope to bring him down*" },
  { kind: "info", speaker: "dice", text: "You no longer have your javelin" },
  { kind: "dialogue", speaker: "kell", name: "Sergeant Agnes Kell", text: "“That's a javelin in the King's granary wall, investigator.” She writes it down. “Noted.” Abcdefghij klmnopqrst uvwxyz0123 ABCDEFGHIJ KLMNOPQRST UVWXYZ4567 abcdefghij klmnopqrst uvwxyz8901 ABCDEFGHIJ KLMNOPQRST" },
];
const choices: Action[] = [
  { id: "say_1", label: "“Who cut him down last time, Sergeant?”", kind: "say" },
  { id: "say_2", label: "*looks at the girl's fist*", kind: "say" },
  { id: "say_3", label: "(I cast Detect Magic on the rope, because you never know, and the King is paying)", kind: "say" },
];
const ended: Line = { kind: "system", speaker: "system", text: "Scene ends: The case is made" };
const talk = talkBetween({ id: "kell", name: "Sergeant Kell" }, {
  notebook: ["Wendell Prout didn't hang himself. The trail leads to Master Sallow of the Royal Purveyor's office."],
  lead: "At the noon break Kell saw a big dock-man nursing a bandaged hand at a gentleman's elbow by the Purveyor's wagons, and followed him down the river stairs to the Drowned Rat; at dusk you go down after him together.",
  next: { id: "drowned-rat", title: "The Drowned Rat" }, way: "the Drowned Rat ↓ 22 paces", time: "evening",
});

function gameFor(mode: "scene" | "explore"): Game {
  const game = new Game();
  game.core = { session, state: { version: 1, id: "check", mode, story: { time: mode === "scene" ? "morning" : "evening", played: [], flags: {} }, explore: {}, recent: [] }, observe: () => ({ mode, text: "", actions: [] }) } as unknown as Game["core"];
  return game;
}

interface Scenario { name: string; expect: Line[]; marks?: RegExp[]; render: () => { game: Game; node: ReactNode }; then?: (game: Game) => void }
const scenarios: Scenario[] = [
  {
    name: "mid-scene", expect: lines.filter(l => l.kind !== "header"), marks: [/🎲 Medicine check/, /ⓘ\s+You no longer have your javelin/, /1 “Who cut him down/, /3 \(I cast Detect Magic/],
    render: () => { const game = gameFor("scene"); game.screen = "scene"; game.lines = lines; game.choices = choices; return { game, node: <SceneScreen game={game} /> }; },
  },
  {
    // The talk grows past the panel as it's played: the scrollbar comes in after the text was laid out.
    name: "growing", expect: lines.filter(l => l.kind !== "header"),
    render: () => { const game = gameFor("scene"); game.screen = "scene"; game.lines = lines.slice(0, 3); return { game, node: <SceneScreen game={game} /> }; },
    then: game => { game.lines = lines; game.emit(); },
  },
  {
    name: "over", expect: lines.filter(l => l.kind !== "header").slice(-3), marks: [/The case is made/, /On, with Sergeant Kell/],
    render: () => {
      const game = gameFor("explore");
      game.screen = "scene"; game.lines = [...lines, ended]; game.over = { ready: true, ending: "The case is made" };
      game.card = { title: "Evening, on the eve of the Assembly", lines: [], next: "explore", talk };
      return { game, node: <SceneScreen game={game} /> };
    },
  },
  {
    name: "kell", expect: talk, marks: [/Evening, on the eve/, /Back to the map/],
    render: () => {
      const game = gameFor("explore");
      game.screen = "between"; game.card = { title: "Evening, on the eve of the Assembly", lines: [], next: "explore", talk };
      return { game, node: <BetweenScreen game={game} /> };
    },
  },
];

const EDGES = /[│┃║╭╮╰╯┌┐└┘─━═▀▄█▌▐]/g;

/** The first box's rows, between its sides: the conversation's panel. */
function panelRows(frame: string): string[] {
  const rows = frame.split("\n");
  const top = rows.findIndex(r => /[┌╭]/.test(r));
  const left = [...rows[top]!].findIndex(ch => ch === "┌" || ch === "╭");
  const right = [...rows[top]!].findIndex((ch, i) => i > left && (ch === "┐" || ch === "╮"));
  return rows.slice(top + 1).map(r => [...r].slice(left, right + 1).join(""));
}

/** What a panel's words are, read off its rows with the borders and the scrollbar wiped out. */
const panelText = (rows: string[]) => rows.map(r => r.replace(EDGES, " ")).join(" ").replace(/\s+/g, " ").trim();

/** Rows where words run right up to a box's side (into its padding: word wrap working to a column more than there is). */
const touching = (rows: string[]) => rows.filter(r => /[^\s│┃║╭╮╰╯┌┐└┘─━═▀▄█▌▐]│/.test(r));

let failed = 0;
for (const { name, expect, marks, render, then } of scenarios) {
  for (const [w, h] of [[80, 24], [80, 40], [100, 40], [130, 42], [160, 45]] as const) {
    const { game, node } = render();
    const setup = await testRender(node, { width: w, height: h });
    await setup.renderOnce();
    if (then) { act(() => then(game)); await setup.renderOnce(); }
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    if (process.argv.includes("--show")) console.log(`${name} ${w}x${h}\n${frame}`);
    const rows = panelRows(frame);
    const panel = panelText(rows);
    const tight = touching(rows);
    // Word wrap may break at a hyphen ("south-" then "west"), which the rows join with a space.
    const flat = (t: string) => t.replace(/\s+/g, " ").replace(/- /g, "-");
    const whole = (l: Line) => flat(panel).includes(flat(l.text));
    // The panel sticks to the bottom: lines above the first one drawn whole may have scrolled off; none after it.
    const first = expect.findIndex(whole);
    const missing = first < 0 ? expect : expect.filter((l, i) => i > first && !whole(l));
    const unmarked = h >= 40 ? (marks ?? []).filter(m => !m.test(frame.replace(/\s+/g, " "))) : [];
    const ok = !missing.length && !unmarked.length && !tight.length;
    console.log(`${name} ${w}x${h}: ${ok ? "every line drawn whole" : `${missing.length} lines not drawn whole, ${tight.length} rows run into a side, ${unmarked.length} marks missing`}`);
    for (const r of tight) console.log(`  runs into a side: ${r.trim().slice(-40)}`);
    for (const l of missing) {
      const t = l.text.replace(/\s+/g, " ");
      let n = 0;
      while (n < t.length && panel.includes(t.slice(0, n + 1))) n++;
      console.log(`  ${l.kind}: lost after "${t.slice(Math.max(0, n - 30), n)}" (next: "${t.slice(n, n + 20)}")`);
    }
    for (const m of unmarked) console.log(`  missing ${m}`);
    if (!ok) failed++;
    await setup.dispose();
  }
}
// The things to press and click: a suggestion by its number and with the mouse, a command as it's
// typed, and the way on from a scene that's over, by Enter and by a click.
const at = (frame: string, text: string) => {
  const rows = frame.split("\n");
  const y = rows.findIndex(r => r.includes(text));
  return { x: [...rows[y] ?? ""].join("").indexOf(text) + Math.floor(text.length / 2), y };
};
const checks: Array<[string, boolean]> = [];
{
  const game = gameFor("scene");
  game.screen = "scene"; game.lines = lines; game.choices = choices;
  const said: string[] = [];
  game.input = async (text: string) => { said.push(text); };
  const setup = await testRender(<SceneScreen game={game} />, { width: 100, height: 40 });
  await setup.renderOnce();
  act(() => setup.mockInput.pressKey("2"));
  await setup.renderOnce();
  checks.push(["2 says the second suggestion", said.at(-1) === choices[1]!.label]);
  const third = at(setup.captureCharFrame(), "(I cast Detect Magic");
  await act(async () => { await setup.mockMouse.click(third.x, third.y); });
  checks.push(["a click on the third suggestion says it", said.at(-1) === choices[2]!.label]);
  await act(async () => { await setup.mockInput.typeText("/jo"); });
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  checks.push(["typing /jo offers /journal", /\/journal\s+the investigator's notebook/.test(frame)]);
  const journal = at(frame, "/journal the investigator");
  await act(async () => { await setup.mockMouse.click(journal.x, journal.y); });
  checks.push(["a click on /journal opens the notebook", game.overlay?.kind === "journal"]);
  // With the GM mid-sentence, what is only looked at still opens: the footer's /map.
  act(() => { game.overlay = undefined; game.busy = "The GM is speaking…"; game.emit(); });
  await setup.renderOnce();
  const map = at(setup.captureCharFrame(), "/map ");
  await act(async () => { await setup.mockMouse.click(map.x - 1, map.y); });
  checks.push(["/map at the bottom opens with the GM talking", game.overlay?.kind === "scene-map"]);
  await setup.dispose();
}
{
  const game = gameFor("explore");
  game.screen = "scene"; game.lines = [...lines, ended]; game.over = { ready: true, ending: "The case is made" };
  game.card = { title: "Evening", lines: [], next: "explore", talk };
  let went = 0;
  game.continueScene = () => { went++; };
  const setup = await testRender(<SceneScreen game={game} />, { width: 100, height: 40 });
  await setup.renderOnce();
  act(() => setup.mockInput.pressEnter());
  checks.push(["Enter goes on from a scene that's over", went === 1]);
  const on = at(setup.captureCharFrame(), "On, with Sergeant Kell");
  await act(async () => { await setup.mockMouse.click(on.x, on.y); });
  checks.push(["a click on the way on goes on", went === 2]);
  await setup.dispose();
}
{
  // A line and its Enter in the same read (a paste, a fast typist, the browser's terminal): what's
  // sent is what the box holds, not the draft of the render before; and the next line isn't doubled.
  const game = gameFor("scene");
  game.screen = "scene"; game.lines = lines;
  const said: string[] = [];
  game.input = async (text: string) => { said.push(text); };
  const setup = await testRender(<SceneScreen game={game} />, { width: 100, height: 40 });
  await setup.renderOnce();
  await act(async () => { await setup.mockInput.pressKeys(["#exits\r"]); });
  await setup.renderOnce();
  await act(async () => { await setup.mockInput.pressKeys(["/end case-made\r"]); });
  await setup.renderOnce();
  checks.push([`"#exits\\r" in one read sends #exits, and the next line once (sent: ${JSON.stringify(said)})`, said.join("|") === "#exits|/end case-made"]);
  checks.push(["the box is empty after", !/#exits|case-made/.test(setup.captureCharFrame())]);
  await setup.dispose();
}
{
  // Typing on as a scene ends: nothing goes on but an Enter of its own (or a click), and nothing typed leaks on.
  const game = gameFor("explore");
  game.screen = "scene"; game.lines = [...lines, ended]; game.over = { ready: true, ending: "The case is made" };
  game.card = { title: "Evening", lines: [], next: "explore", talk };
  let went = 0;
  game.continueScene = () => { went++; };
  const setup = await testRender(<SceneScreen game={game} />, { width: 100, height: 40 });
  await setup.renderOnce();
  await act(async () => { await setup.mockInput.typeText("and the boy, wasd e "); });
  checks.push(["typed characters, spaces too, don't go on from a scene that's over", went === 0]);
  act(() => setup.mockInput.pressEnter());
  await setup.renderOnce();
  checks.push(["the Enter that ends a typed line ends the line, not the scene", went === 0]);
  checks.push(["... and the screen says so", /went unsaid\. Enter goes on/.test(setup.captureCharFrame())]);
  act(() => setup.mockInput.pressEnter());
  checks.push(["then an Enter of its own goes on", went === 1]);
  await setup.dispose();
}
{
  // A line in the box as the scene ends (typed while the GM had the floor): the Enter was meant for it.
  const game = gameFor("scene");
  game.screen = "scene"; game.lines = lines;
  let went = 0;
  game.continueScene = () => { went++; };
  const setup = await testRender(<SceneScreen game={game} />, { width: 100, height: 40 });
  await setup.renderOnce();
  await act(async () => { await setup.mockInput.typeText("Who cut him down"); });
  await setup.renderOnce();
  act(() => { game.lines = [...lines, ended]; game.over = { ready: true, ending: "The case is made" }; game.emit(); });
  await setup.renderOnce();
  act(() => setup.mockInput.pressEnter());
  checks.push(["a line in the box as the scene ended: its Enter doesn't go on", went === 0]);
  act(() => setup.mockInput.pressEnter());
  checks.push(["the next Enter does", went === 1]);
  await setup.dispose();
}
{
  // A talk: its lines to say, its goodbye and walking on, numbered and clickable; a short screen keeps the ways out.
  const talking: Action[] = [
    { id: "say_1", label: "How long have you been with the watch?", kind: "say" },
    { id: "say_2", label: "What do you make of Sallow?", kind: "say" },
    { id: "say_3", label: "Who was the boy with the stones?", kind: "say" },
    { id: "say_4", label: "Does the Captain always call it suicide?", kind: "say" },
    { id: "say_goodbye", label: "I'll leave you to it.", kind: "say" },
    { id: "walk_on", label: "Walk on without a word (back to the map)", kind: "move" },
  ];
  checks.push(["a short screen lists fewer lines, never fewer ways out", fitChoices(talking, 3).map(a => a.id).join() === "say_1,say_goodbye,walk_on" && fitChoices(talking, 9).length === 6]);
  for (const [w, h] of [[80, 24], [100, 40]] as const) {
    const game = gameFor("scene");
    game.screen = "scene";
    game.lines = [{ kind: "header", speaker: "system", name: "A word with Sergeant Kell", text: "A word with Sergeant Kell, between one thing and the next." }, { kind: "narration", speaker: "gm", text: "Kell is writing on the steps of the watch-house. “Investigator.”" }];
    game.choices = talking;
    const chosen: string[] = [];
    game.choose = (a: Action) => { chosen.push(a.id); };
    const setup = await testRender(<SceneScreen game={game} />, { width: w, height: h });
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    checks.push([`${w}x${h}: a talk's lines, its goodbye and walking on are listed, numbered`, /1 How long.*4 Does the Captain.*5 I'll leave you to it\..*6 Walk on without a word/s.test(frame)]);
    act(() => setup.mockInput.pressKey("2"));
    checks.push([`${w}x${h}: 2 says the second line`, chosen.at(-1) === "say_2"]);
    act(() => setup.mockInput.pressKey("6"));
    checks.push([`${w}x${h}: 6 walks on`, chosen.at(-1) === "walk_on"]);
    const goodbye = at(frame, "I'll leave you to it.");
    await act(async () => { await setup.mockMouse.click(goodbye.x, goodbye.y); });
    checks.push([`${w}x${h}: a click on the goodbye says it`, chosen.at(-1) === "say_goodbye"]);
    const walk = at(frame, "Walk on without a word");
    await act(async () => { await setup.mockMouse.click(walk.x, walk.y); });
    checks.push([`${w}x${h}: a click on walking on walks on`, chosen.at(-1) === "walk_on"]);
    await setup.dispose();
  }
}
{
  // Kell between scenes: typing at her goes nowhere; an Enter of its own (or a click) goes on.
  const game = gameFor("explore");
  game.screen = "between"; game.card = { title: "Evening", lines: [], next: "explore", talk };
  let went = 0;
  game.continueFromCard = () => { went++; };
  const setup = await testRender(<BetweenScreen game={game} />, { width: 100, height: 40 });
  await setup.renderOnce();
  await act(async () => { await setup.mockInput.typeText("wasd e "); });
  checks.push(["typed characters don't go on from Kell between scenes", went === 0]);
  act(() => setup.mockInput.pressEnter());
  await setup.renderOnce();
  checks.push(["nor does the Enter that ends them", went === 0]);
  checks.push(["... which the way on says", /that typing went nowhere: Enter goes on/.test(setup.captureCharFrame())]);
  act(() => setup.mockInput.pressEnter());
  checks.push(["an Enter of its own goes on to the map", went === 1]);
  const back = at(setup.captureCharFrame(), "Back to the map");
  await act(async () => { await setup.mockMouse.click(back.x, back.y); });
  checks.push(["and so does a click", went === 2]);
  await setup.dispose();
}
for (const [what, ok] of checks) {
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
  if (!ok) failed++;
}
console.log(failed ? `FAIL: ${failed}` : "PASS");
process.exit(failed ? 1 : 0);
