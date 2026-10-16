// After the prototype's src/app/smoke/screens-check.tsx at 44c6d4a (its scene's checks, :1355-1453), drawing view models: no game core, no server, no model.
/**
 * The scene screen drawn by the real components, offline, from view models (no server, no model):
 * at 80x24 and up, the last reply's every word drawn whole, each speaker's colour, the marks on
 * their tints, the box's placeholder; then a turn through its phases as the rows would give it (the
 * line said and sent, the GM thinking, the reply growing with its cursor, the note being made, the
 * box open again), a refusal on the status line, a line kept in the box while the GM has the floor,
 * a failed turn's word, the commands over the box and the help, a mark opened by a click and by
 * Tab and Enter. And V0's: the game's number, a turn waiting on the AI service (its note), the
 * reply written again from the start (attempt 2), a mark with no note drawn as plain words, a
 * spectator's shut box and their line refused (the refusal giving way when the turn moves on), the
 * scene's end, a failed turn's box and a line sent to be refused with its /retry, a long paste kept
 * to a turn's 2,000 characters, and a game gone from the server. (The prototype's
 * src/app/smoke/screens-check.tsx, for this client.)
 *
 *   npm run screens        (node --experimental-ffi --no-warnings --import tsx client/check/screens.tsx [--show])
 */
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../app.tsx";
import { GM_BUSY } from "../busy.ts";
import { SceneModel } from "../scene/model.ts";
import { markupOf } from "../scene/rows.ts";
import type { SceneView } from "../scene/view.ts";
import { C, MARK_TINT } from "../theme.ts";
import { sceneSide } from "../ui/scene.tsx";
import { YARD } from "./fixture.ts";

const show = process.argv.includes("--show");
const checks: Array<[string, boolean]> = [];
const flat = (t: string) => t.replace(/\s+/g, " ");
const hex = (c: { r: number; g: number; b: number }) => `#${[c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

/** The middle of some text on screen, in cells; undefined when it isn't there. */
function at(frame: string, text: string): { x: number; y: number } | undefined {
  const rows = frame.split("\n");
  const y = rows.findIndex(r => r.includes(text));
  if (y < 0) return undefined;
  return { x: [...rows[y]!].join("").indexOf(text) + Math.floor(text.length / 2), y };
}

/** The text in the conversation's frame (the `columns` left of the side panel), as one line, so wrapped words read whole. */
const talkIn = (frame: string, columns: number) => flat(frame.split("\n").map(r => [...r].slice(0, columns).join("").replace(/[│┃╭╮╰╯─┌┐└┘▄█]/g, " ")).join(" "));

for (const [w, h] of [[80, 24], [100, 30], [130, 42], [160, 45]] as const) {
  const sent: string[] = [];
  const said = (frame: string) => talkIn(frame, w - sceneSide(w));
  let view: SceneView = YARD;
  const scene = new SceneModel(view, { say: text => sent.push(text), retry: () => sent.push("/retry"), quit: () => {} });
  const set = (patch: Partial<SceneView>) => { view = { ...view, ...patch }; act(() => scene.update(view)); };
  const setup = await testRender(<App scene={scene} onQuit={() => {}} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  /** A lone Esc is held a moment by the key parser (it might start a sequence): wait it out, as the prototype's checks do. */
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); };
  /** The draft growing is drawn at most ~30 times a second (SceneModel.emitSoon): wait for the redraw. */
  const soon = async () => { await act(async () => { await new Promise(r => setTimeout(r, 50)); }); };
  const style = (text: string) => {
    for (const line of setup.captureSpans().lines) {
      let row = "";
      for (const s of line.spans) { if ((row + s.text).includes(text) && s.text.includes(text.slice(0, 3))) return { fg: hex(s.fg), bg: hex(s.bg), underline: (s.attributes & 8) !== 0 }; row += s.text; }
    }
    return undefined;
  };
  let frame = await draw();
  frame = await draw();
  if (show) console.log(`${w}x${h}\n${frame}`);
  const size = `${w}x${h}`;

  // The last reply whole, the title, and the side panel's people.
  const last = view.entries.at(-1)!.text;
  checks.push([`${size}: the last reply drawn whole`, said(frame).includes(flat(last))]);
  checks.push([`${size}: the scene's title and the time`, frame.split("\n")[0]!.includes(" The Hanged Clerk · Morning ")]);
  checks.push([`${size}: the side panel names who's there, as the player knows them`, /At the scene/.test(frame) && /Sergeant Agnes Kell/.test(frame) && /the boy in the too/.test(frame)]);
  checks.push([`${size}: the side panel gives the game's number, to watch it by`, /Game 1/.test(frame) && /--join 1 to watch/.test(frame)]);
  // Colours: a speaker's line in their look's colour, the narration in the GM's, a mark underlined on its kind's tint.
  checks.push([`${size}: Kell's line in her colour (${style("“You told the boy")?.fg})`, style("“You told the boy")?.fg === "#6d9eeb"]);
  checks.push([`${size}: the narration in the GM's colour`, style("The boy looks at your hands")?.fg === C.gm]);
  const you = style("asking");
  checks.push([`${size}: a "you" mark underlined on its tint, in Kell's colour (${you?.fg} on ${you?.bg})`, !!you && you.underline && you.bg === MARK_TINT.you && you.fg === "#6d9eeb"]);
  checks.push([`${size}: the box is open, with its hint`, /What do you say\?/.test(frame) && /Say it out loud/.test(frame)]);

  // A line said: sent as the move, the box emptied.
  await act(async () => { await setup.mockInput.typeText("Sergeant, who found him?"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: a line and its Enter call say, and the box empties`, sent.at(-1) === "Sergeant, who found him?" && !/Sergeant, who found him\?/.test(frame.split("\n").slice(-4).join("\n"))]);

  // The rows come back: the line in its own turn, the GM thinking.
  const turn = view.entries.at(-1)!.turn + 1;
  set({ entries: [...view.entries, { turn, speaker: "player:1", kind: "player", name: view.player.name, text: "Sergeant, who found him?" }], phase: "deciding", mayType: false });
  frame = await draw();
  if (show) console.log(`${size}, deciding\n${frame}`);
  const thinking = GM_BUSY.find(l => frame.includes(l.slice(0, 20)));
  checks.push([`${size}: deciding: the line in a turn under the player's name, the spinner's line (${thinking ?? "none"}), the box shut`, /╭─ Pell Marrow/.test(frame) && /Sergeant, who found him\?/.test(frame) && !!thinking && /The GM has the floor/.test(frame)]);

  // A line typed while the GM has the floor waits in the box.
  await act(async () => { await setup.mockInput.typeText("Who else"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: a line typed while the GM has the floor waits in the box, unsent`, sent.length === 1 && /Who else/.test(frame)]);
  for (let i = 0; i < "Who else".length; i++) act(() => setup.mockInput.pressBackspace());

  // Replying: the draft grows, with its cursor, and who's speaking.
  set({ phase: "replying", draft: { speaker: "gm", kind: "narration", text: "Sergeant Kell glances up at the body, then back to her notebook.", attempt: 1, seq: 1 } });
  frame = await draw();
  checks.push([`${size}: replying: the draft drawn with its cursor, and the GM speaking`, said(frame).includes("Sergeant Kell glances up at the body") && /▍/.test(frame) && /The GM is speaking…/.test(frame)]);
  set({ draft: { speaker: "gm", kind: "narration", text: "Sergeant Kell glances up at the body, then back to her notebook. “The porters. First light.”", attempt: 1, seq: 2 } });
  await soon();
  frame = await draw();
  if (show) console.log(`${size}, replying\n${frame}`);
  checks.push([`${size}: the draft grows`, said(frame).includes("“The porters. First light.”")]);

  // The AI service lost mid-reply: the turn's note in place of the spinner, then the reply written
  // again from the start as attempt 2, shorter for now, and drawn at once (no waiting for a redraw).
  set({ note: "The GM has lost the thread for a moment: trying again." });
  frame = await draw();
  checks.push([`${size}: a turn waiting on the AI service: its note on the status line, in place of the spinner`, style("The GM has lost the thread for a moment")?.fg === C.warn && !/The GM is speaking…/.test(frame)]);
  const { note: _note, ...back } = view;
  view = back;
  set({});
  set({ draft: { speaker: "gm", kind: "narration", text: "Sergeant Kell looks up.", attempt: 2, seq: 3 } });
  frame = await draw();
  if (show) console.log(`${size}, attempt 2\n${frame}`);
  checks.push([`${size}: the reply written again (attempt 2) is drawn at once, the first attempt's words gone`, said(frame).includes("Sergeant Kell looks up.") && !said(frame).includes("First light") && /The GM is speaking…/.test(frame)]);

  // Settling: the reply in the transcript, the draft gone, the box open, the GM making a note.
  const { draft: _gone, ...rest } = view;
  view = rest;
  set({ entries: [...view.entries, { turn, speaker: "gm", kind: "narration", text: "Sergeant Kell glances up at the body, then back to her notebook. “The porters. First light. They came to open the yard, saw him, and ran for the watch.”" }], phase: "settling", mayType: true });
  frame = await draw();
  checks.push([`${size}: settling: the reply final (no cursor), the box open, the GM making a note`, said(frame).includes("ran for the watch.”") && !/▍/.test(frame) && /The GM makes a note…/.test(frame) && /Say it out loud/.test(frame)]);
  set({ phase: "done" });
  frame = await draw();
  checks.push([`${size}: done: no spinner`, !/The GM makes a note…/.test(frame)]);

  // A refusal's words on the status line.
  set({ refusal: "(The GM is still answering.)" });
  frame = await draw();
  checks.push([`${size}: a refusal's words on the status line`, style("(The GM is still answering.)")?.fg === C.warn]);
  const { refusal: _r, ...clean } = view;
  view = clean;
  set({});

  // A long paste: the box takes as much as a turn does (2,000 characters), says so when it's full, and sends it whole.
  const pasted = "word ".repeat(420);
  await act(async () => { await setup.mockInput.pasteBracketedText(pasted); });
  frame = await draw();
  checks.push([`${size}: a long paste fills the box to 2,000 characters, and the status line says it's full`, /\(The box is full: a turn takes 2,000 characters at most\.\)/.test(frame) && style("(The box is full")?.fg === C.warn]);
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: its Enter sends the first 2,000 (${sent.at(-1)?.length}, trimmed)`, sent.at(-1) === pasted.slice(0, 2000).trim() && !/The box is full/.test(frame)]);

  // A failed turn: its word in red, and /retry. (Its box is shut, as the rows make it.)
  set({ phase: "failed", failed: "the AI API timed out", mayType: false });
  frame = await draw();
  checks.push([`${size}: a failed turn says why and what to do, in red`, said(frame).includes("The AI API timed out. /retry carries the turn on from where it got to.") && style("The AI API timed out")?.fg === C.danger]);
  // Its box says what to do, and a line typed goes to the simulation, which refuses it with the /retry.
  checks.push([`${size}: a failed turn's box says /retry carries it on`, /The GM lost the thread: \/retry carries it on\./.test(frame) && !/The GM has the floor/.test(frame)]);
  await act(async () => { await setup.mockInput.typeText("Hello? Kell?"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: a line while the turn is failed goes to the simulation, and the box empties`, sent.at(-1) === "Hello? Kell?" && !/Hello\? Kell\?/.test(frame)]);
  set({ refusal: "(The GM lost the thread: /retry to carry on.)" });
  frame = await draw();
  checks.push([`${size}: its refusal, on the status line`, style("(The GM lost the thread: /retry to carry on.)")?.fg === C.warn]);
  const { refusal: _turnFailed, ...unrefused } = view;
  view = unrefused;
  set({});
  await act(async () => { await setup.mockInput.typeText("/retry"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  await draw();
  checks.push([`${size}: /retry calls retryTurn`, sent.at(-1) === "/retry"]);
  const { failed: _f, ...ok } = view;
  view = { ...ok, phase: "done", mayType: true };
  set({});

  // The commands over the box as one's typed, and the help.
  await act(async () => { await setup.mockInput.typeText("/"); });
  frame = await draw();
  checks.push([`${size}: "/" lists the commands over the box`, /\/help +how to play/.test(frame) && /\/quit/.test(frame)]);
  await act(async () => { await setup.mockInput.typeText("help"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: /help opens the help`, scene.overlay?.kind === "help" && /How to play/.test(frame)]);
  checks.push([`${size}: the help says nothing of marks or ⓘ lines, which V0 never shows`, /🎲 lines/.test(frame) && !/Underlined|marks|ⓘ/.test(frame)]);
  await esc();
  frame = await draw();
  checks.push([`${size}: Esc closes it`, !scene.overlay && !/How to play/.test(frame)]);

  // A mark: Tab picks out the last reply's (here the yard's last mark is two replies up: none in the last), so put the yard back.
  view = YARD;
  set({});
  frame = await draw();
  act(() => setup.mockInput.pressTab());
  frame = await draw();
  const bottom = frame.split("\n").filter(r => r.trim()).at(-1)!.trim();
  checks.push([`${size}: Tab picks out the last reply's mark, and the bottom line says what it is (${bottom.slice(0, 40)})`, scene.markFocus?.mark === 0 && /^You did this: you're asking him for help/.test(bottom)]);
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: Enter opens it`, scene.overlay?.kind === "mark" && /You barked at him/.test(frame)]);
  await esc();
  frame = await draw();
  const p = at(frame, "asking");
  if (p) await act(async () => { await setup.mockMouse.click(p.x, p.y); });
  frame = await draw();
  checks.push([`${size}: a click on a mark opens it, clear of the words clicked`, scene.overlay?.kind === "mark" && /You did this/.test(frame) && (frame.split("\n")[p?.y ?? 0] ?? "").includes("asking")]);
  await act(async () => { await setup.mockMouse.click(w - 3, h - 2); });
  frame = await draw();
  // (The bottom line still says what Tab picked out, note and all, on a wide screen: the popover's frame is what goes.)
  checks.push([`${size}: a click outside it closes it`, !scene.overlay && !/╭─ You did this/.test(frame)]);

  // A mark that came with no note: its words drawn plain, and nothing for Tab to pick out.
  scene.markFocus = undefined;
  const noted = YARD.entries.at(-1)!;
  const bare = markupOf(JSON.stringify({ ...noted.markup, marks: noted.markup!.marks.map(m => ({ ...m, note: "" })) }));
  view = { ...YARD, entries: [...YARD.entries.slice(0, -1), { ...noted, ...(bare ? { markup: bare } : {}) }] };
  set({});
  frame = await draw();
  act(() => setup.mockInput.pressTab());
  frame = await draw();
  checks.push([`${size}: a mark with no note is drawn as plain words, with nothing for Tab to pick out`, style("asking")?.underline === false && style("asking")?.fg === "#6d9eeb" && scene.markFocus === undefined]);

  // A spectator: the same conversation; the box never opens and says who has the lead; a line typed
  // there goes to the simulation, which refuses it in the game's words.
  view = { ...YARD, mayType: false, watching: "Pell Marrow" };
  set({});
  frame = await draw();
  if (show) console.log(`${size}, watching\n${frame}`);
  checks.push([`${size}: a spectator's box is shut, and says who has the lead`, /Pell Marrow has the lead: you're watching\./.test(frame) && style("What do you say?")?.fg === C.border && /Watching/.test(frame)]);
  await act(async () => { await setup.mockInput.typeText("Can I help?"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: a spectator's line goes to the simulation, and the box empties`, sent.at(-1) === "Can I help?" && !/Can I help\?/.test(frame)]);
  set({ refusal: "(Pell Marrow has the lead here: you're watching.)" });
  frame = await draw();
  checks.push([`${size}: the simulation's refusal, on the status line`, style("(Pell Marrow has the lead here")?.fg === C.warn]);
  // The lead says a line: the refusal (still on the view, as the connection keeps it until the next
  // move) gives way to the spinner, and then to the turn's note.
  const next = YARD.entries.at(-1)!.turn + 1;
  set({ entries: [...view.entries, { turn: next, speaker: "player:1", kind: "player", name: "Pell Marrow", text: "Who found him?" }], phase: "deciding", turn: next });
  frame = await draw();
  const spinning = GM_BUSY.find(l => frame.includes(l.slice(0, 20)));
  checks.push([`${size}: when the lead's next line comes, the spectator's refusal gives way to the spinner (${spinning ?? "none"})`, !!spinning && !/has the lead here: you're watching\.\)/.test(frame)]);
  set({ phase: "replying", note: "The GM has lost the thread for a moment: trying again." });
  frame = await draw();
  checks.push([`${size}: and to the turn's note`, style("The GM has lost the thread for a moment")?.fg === C.warn]);
  // The scene's end: a spectator's box says so, as the lead's does.
  view = { ...YARD, entries: [...YARD.entries, { turn: 3, speaker: "system", kind: "system", text: "Scene ends: The Hanged Clerk" }], mayType: false, watching: "Pell Marrow", over: true };
  set({});
  frame = await draw();
  checks.push([`${size}: after the end, a spectator's box says the scene is over`, /The scene is over\./.test(frame) && !/Pell Marrow has the lead: you're watching\./.test(frame)]);

  // The game gone from the server (a stack started again with --fresh): the last view stays, the
  // status line says so, the box is shut, and a line typed waits in it, unsent.
  view = YARD;
  set({});
  act(() => scene.lose("(The game's server no longer has this game: /quit, then start one with --new, or watch one with --join.)"));
  frame = await draw();
  checks.push([`${size}: a game gone from the server: the status line says so, the box is shut`, style("(The game's server no longer has this game")?.fg === C.warn && /The game is gone from the server\./.test(frame) && style("What do you say?")?.fg === C.border]);
  const before = sent.length;
  await act(async () => { await setup.mockInput.typeText("Is anyone here?"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: a line typed then stays in the box, unsent`, sent.length === before && /Is anyone here\?/.test(frame)]);
  for (let i = 0; i < "Is anyone here?".length; i++) act(() => setup.mockInput.pressBackspace());
  set({});
  frame = await draw();
  checks.push([`${size}: a view coming again takes it back`, !/no longer has this game/.test(frame) && style("What do you say?")?.fg === C.borderHot]);

  // The scene's end: a rule across with its title, and a box that says it's over. A line typed after
  // it goes to the simulation, which refuses it in the game's words.
  view = { ...YARD, entries: [...YARD.entries, { turn: 3, speaker: "system", kind: "system", text: "Scene ends: The Hanged Clerk" }], mayType: false, over: true };
  set({});
  frame = await draw();
  checks.push([`${size}: the scene's end: a rule with its title, and the box says the scene is over`, /─ The Hanged Clerk ─/.test(frame) && /The scene is over\./.test(frame)]);
  await act(async () => { await setup.mockInput.typeText("Wait, one more thing."); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: a line after the scene's end goes to the simulation, and the box empties`, sent.at(-1) === "Wait, one more thing." && !/one more thing/.test(frame)]);
  set({ refusal: "(The scene is over.)" });
  frame = await draw();
  checks.push([`${size}: its refusal, on the status line`, style("(The scene is over.)")?.fg === C.warn]);
  await setup.dispose();
}

let failed = 0;
for (const [what, ok] of checks) {
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
  if (!ok) failed++;
}
console.log(failed ? `FAIL: ${failed}` : `PASS: ${checks.length}`);
process.exit(failed ? 1 : 0);
