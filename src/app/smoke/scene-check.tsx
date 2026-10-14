/**
 * Does the scene screen show every character of the conversation, at every width? A made-up
 * conversation at the granary (long lines, dice, an item changing hands, things to say), drawn by
 * the real screens at several terminal sizes: the scene mid-talk, the same talk growing past the
 * panel (its scrollbar coming in), the scene once it's over (its last word still up, the way on
 * below it), and Kell telling the news between scenes. Each line's words are looked for in what was
 * drawn, whole; only a line scrolled partly off the top may be cut.
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
import { SceneScreen } from "../ui/scene.tsx";

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
  { id: "say-1", label: "“Who cut him down last time, Sergeant?”", kind: "say" as Action["kind"] },
  { id: "say-2", label: "*looks at the girl's fist*", kind: "say" as Action["kind"] },
  { id: "say-3", label: "(I cast Detect Magic on the rope, because you never know, and the King is paying)", kind: "say" as Action["kind"] },
];
const ended: Line = { kind: "system", speaker: "system", text: "Scene ends: The case is made" };
const talk = talkBetween({ id: "kell", name: "Sergeant Kell" }, {
  notebook: ["Wendell Prout didn't hang himself. The trail leads to Master Sallow of the Royal Purveyor's office."],
  lead: "Kell stays beside you as the yard empties; by dusk the watch-house has a name for the big man with the bandaged hand, and a place: the Drowned Rat, halfway down the river stairs.",
  next: { id: "drowned-rat", title: "The Drowned Rat" }, where: "the Drowned Rat", pointing: "south-west", time: "evening",
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
for (const [what, ok] of checks) {
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
  if (!ok) failed++;
}
console.log(failed ? `FAIL: ${failed}` : "PASS");
process.exit(failed ? 1 : 0);
