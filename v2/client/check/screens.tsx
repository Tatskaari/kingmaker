// After the prototype's src/app/smoke/screens-check.tsx at 44c6d4a (its scene's checks, :1355-1453; the suggested lines, :606-720; the popover's card, :1359-1460), drawing view models: no game core, no server, no model.
/**
 * The scene screen drawn by the real components, offline, from view models (no server, no model):
 * at 80x24 and up, the last reply's every word drawn whole, each speaker's colour, the marks on
 * their tints, the box's placeholder; then a turn through its phases as the rows would give it (the
 * line said and sent, the GM thinking, the reply growing with its cursor, the note being made, the
 * box open again), a refusal on the status line, a line kept in the box while the GM has the floor,
 * a failed turn's word, the commands over the box and the help, a mark opened by a click and by
 * Tab and Enter. And V0's: the game's number, a turn waiting on the AI service (its note), the
 * reply written again from the start (attempt 2), a mark with no note drawn as plain words, a
 * spectator's shut box and their line refused, and the scene's end. And V5's: the suggested lines,
 * from rows (their rows kept while they come, numbered over the box, a number or a click into the
 * box, typing puts them away, /suggestions off, none for a spectator), each speaker's colour as the
 * draft grows, and the popover's card, dropped first when there's no room. (The prototype's
 * src/app/smoke/screens-check.tsx, for this client.)
 *
 *   npm run screens        (node --experimental-ffi --no-warnings --import tsx client/check/screens.tsx [--show])
 */
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../app.tsx";
import { GM_BUSY } from "../busy.ts";
import { SceneModel, SUGGESTIONS_OFF, SUGGESTIONS_ON, type SceneActions } from "../scene/model.ts";
import { markupOf, sceneViewOf, type SceneRows } from "../scene/rows.ts";
import type { SceneView, Suggestion } from "../scene/view.ts";
import { C, MARK_TINT } from "../theme.ts";
import { sceneSide } from "../ui/scene.tsx";
import { YARD, yardRows } from "./fixture.ts";

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

const SIZES = [[80, 24], [100, 30], [130, 42], [160, 45]] as const;

/** The moves the screen makes, kept to read back (none of them changes anything: the checks change the views). */
function recorder(): { sent: string[]; actions: SceneActions } {
  const sent: string[] = [];
  return { sent, actions: { say: text => sent.push(text), retry: () => sent.push("/retry"), setSuggestions: on => { sent.push(`/suggestions ${on ? "on" : "off"}`); return Promise.resolve(undefined); }, quit: () => {} } };
}

for (const [w, h] of SIZES) {
  const { sent, actions } = recorder();
  const said = (frame: string) => talkIn(frame, w - sceneSide(w));
  let view: SceneView = YARD;
  const scene = new SceneModel(view, actions);
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

  // A failed turn: its word in red, and /retry.
  set({ phase: "failed", failed: "the AI API timed out" });
  frame = await draw();
  checks.push([`${size}: a failed turn says why and what to do, in red`, said(frame).includes("The AI API timed out. /retry carries the turn on from where it got to.") && style("The AI API timed out")?.fg === C.danger]);
  await act(async () => { await setup.mockInput.typeText("/retry"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  await draw();
  checks.push([`${size}: /retry calls retryTurn`, sent.at(-1) === "/retry"]);
  const { failed: _f, ...ok } = view;
  view = { ...ok, phase: "done" };
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

  // The scene's end: a rule across with its title, and a box that says it's over.
  view = { ...YARD, entries: [...YARD.entries, { turn: 3, speaker: "system", kind: "system", text: "Scene ends: The Hanged Clerk" }], mayType: false, over: true };
  set({});
  frame = await draw();
  checks.push([`${size}: the scene's end: a rule with its title, and the box says the scene is over`, /─ The Hanged Clerk ─/.test(frame) && /The scene is over\./.test(frame)]);
  await setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// V5's checks (v5-design §4.5), with these helpers: the colour and attributes text is drawn in, the
// rows over the box, what's in the box, the conversation's frame row by row, the bottom line.

type Setup = Awaited<ReturnType<typeof testRender>>;

/** The colour and attributes of the first cell of some text on screen; undefined when it isn't there. */
function styleIn(setup: Setup, text: string): { fg: string; bg: string; bold: boolean; underline: boolean } | undefined {
  for (const line of setup.captureSpans().lines) {
    let row = "";
    for (const s of line.spans) {
      if ((row + s.text).includes(text) && s.text.includes(text.slice(0, 3))) return { fg: hex(s.fg), bg: hex(s.bg), bold: (s.attributes & 1) !== 0, underline: (s.attributes & 8) !== 0 };
      row += s.text;
    }
  }
  return undefined;
}

/** The rows over the box: from under the status line to the box's top (the conversation's frame ends on the first row to start with └). */
const over = (frame: string) => { const rows = frame.split("\n"); return rows.slice(rows.findIndex(r => /^└/.test(r)) + 2, rows.findIndex(r => r.includes("What do you say?"))); };
/** What's in the box (its hint, when it's empty). */
const boxed = (frame: string) => { const rows = frame.split("\n"); return rows[rows.findIndex(r => r.includes("What do you say?")) + 1]!.replace(/│/g, "").trim(); };
/** The conversation's frame, row by row, to its bottom edge, cut to `columns`. */
const framed = (frame: string, columns: number) => { const rows = frame.split("\n"); return rows.slice(0, rows.findIndex(r => /^└/.test(r))).map(r => [...r].slice(0, columns).join("")); };
const bottomLine = (frame: string) => frame.split("\n").filter(r => r.trim()).at(-1)!.trim();
/** What's inside a box drawn with a double border (the help), as one line. */
const doubled = (frame: string) => flat(frame.split("\n").filter(r => r.includes("║")).map(r => r.slice(r.indexOf("║") + 1, r.lastIndexOf("║"))).join(" "));

/** The prototype's suggested lines (screens-check.tsx:617-623): two to say, a deed, a risky try, a way out. */
const LINES: Suggestion[] = [
  { kind: "say", text: "Sergeant, who found him, and when exactly did the porters raise the alarm?" },
  { kind: "say", text: "Nice boots. Yours?" },
  { kind: "do", text: "(I look up at the body, then along the hoist rope to the loft door)" },
  { kind: "try", text: "(I try to coax the boy down from his stones with a pie)" },
  { kind: "leave", text: "(I leave the yard to the pigeons)" },
];

/** A turn's rows, as the moves and the GM's jobs leave them: its phase, its notes and its lines' state. */
function turnRow(n: number, phase: string, more: Partial<SceneRows["turns"][number]> = {}): SceneRows["turns"][number] {
  return { id: BigInt(100 + n), n, phase, note: undefined, error: undefined, notes: "none", suggest: "none", ...more };
}

// ---------------------------------------------------------------------------------------------
// The suggested lines (the prototype's :606-720, adapted to rows): each view is the one rows.ts
// makes of the rows as the moves and the GM's jobs would change them. A line said takes the last
// set away at once and keeps its rows for the next while it comes, so the conversation doesn't move
// when it does; they're numbered over the box, a line each that fits (a second line to say gives
// way on a short screen); a number puts one in the box with the GM still making a note, and the
// box's line puts them away; emptied, they're back; a click puts another in; Enter sends it;
// typing puts them away; /suggestions off says so and keeps no rows for them; on says so; a
// spectator gets none. "/" lists /suggestions, and the help has their paragraph.

for (const [w, h] of SIZES) {
  const size = `${w}x${h}`;
  const { sent, actions } = recorder();
  const rows = yardRows();
  const scene = new SceneModel(sceneViewOf(rows), actions);
  const setup = await testRender(<App scene={scene} onQuit={() => {}} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); };
  /** The rows changed (a move made, a job's answer committed): the view the connection would give the screen. */
  const changed = () => act(() => scene.update(sceneViewOf(rows)));
  const turn = (t: SceneRows["turns"][number]) => { rows.turns = [...rows.turns.filter(x => x.n !== t.n), t]; };
  const entry = (n: number, speaker: string, kind: string, text: string, markup?: string) => { rows.transcript = [...rows.transcript, { seq: rows.transcript.length + 1, turn: n, speaker, kind, text, markup }]; };
  const linesFor = (n: number) => LINES.map((l, i) => ({ sceneId: rows.scene.id, turn: n, ord: i + 1, kind: l.kind, text: l.text }));
  const keep = h < 26 ? 4 : 5;
  const wanted = h < 26 ? [LINES[0]!, LINES[2]!, LINES[3]!, LINES[4]!] : LINES;
  const talkColumns = w - sceneSide(w) - 3;

  // Turn 2's lines are in, numbered over the box. A line is said: the move, then its rows (turn 3
  // deciding; the old set's rows are still in the table, for turn 2).
  rows.suggestions = linesFor(2);
  changed();
  let frame = await draw();
  frame = await draw();
  checks.push([`${size}: lines: turn 2's, numbered over the box`, over(frame).filter(r => r.trim()).length === wanted.length]);
  await act(async () => { await setup.mockInput.typeText("Who else was here?"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  await draw();
  entry(3, "player:1", "player", "Who else was here?");
  rows.scene = { ...rows.scene, turns: 3, turnId: 103n };
  turn(turnRow(3, "deciding"));
  changed();
  frame = await draw();
  if (show) console.log(`${size}, lines coming\n${frame}`);
  checks.push([`${size}: lines: a line said, the old lines go at once, and their ${keep} rows are kept blank over the box`, sent.at(-1) === "Who else was here?" && over(frame).length === keep && over(frame).every(r => !r.trim())]);

  // The reply in: the world settling, the notes being written, the lines asked for. Still kept.
  const reply = "Kell shrugs. “The porters, at first light. Nobody else, unless you count the pigeons.”";
  entry(3, "gm", "narration", reply, JSON.stringify({ speech: [{ start: reply.indexOf("“"), end: reply.length, speaker: "kell" }], marks: [] }));
  turn(turnRow(3, "settling", { notes: "writing", suggest: "coming" }));
  changed();
  frame = await draw();
  const before = framed(frame, talkColumns);
  checks.push([`${size}: lines: the reply in, its lines on their way: their rows still kept, the GM making a note`, over(frame).length === keep && over(frame).every(r => !r.trim()) && /The GM makes a note…/.test(frame)]);

  // The world settled, the notes still coming (noting); the lines land.
  turn(turnRow(3, "noting", { notes: "writing", suggest: "landed" }));
  rows.suggestions = linesFor(3);
  changed();
  frame = await draw();
  if (show) console.log(`${size}, lines in\n${frame}`);
  checks.push([`${size}: lines: when they come, the conversation doesn't move`, framed(frame, talkColumns).every((r, i) => r === before[i])]);
  const shown = over(frame).map(r => r.trim());
  checks.push([`${size}: lines: numbered over the box, a line each that fits${h < 26 ? " (the second to say gives way)" : ""}: ${shown.join(" | ").slice(0, 120)}`,
    shown.length === wanted.length && wanted.every((l, i) => shown[i]!.startsWith(`${i + 1} ${l.text.slice(0, 12)}`) && (l.text.length + 4 < w || shown[i]!.endsWith("…")))]);
  checks.push([`${size}: lines: a risky try in the dice's yellow, a way out dimmed, a line to say in the player's blue`, styleIn(setup, LINES[3]!.text.slice(0, 12))?.fg === C.dice && styleIn(setup, LINES[4]!.text.slice(0, 12))?.fg === C.dim && styleIn(setup, LINES[0]!.text.slice(0, 12))?.fg === C.player]);
  checks.push([`${size}: lines: the keys say a number puts one in the box`, new RegExp(`1–${wanted.length} into the box`).test(bottomLine(frame))]);

  // A number: its line in the box, with the GM still making a note; the lines put away; nothing sent.
  const sends = sent.length;
  act(() => setup.mockInput.pressKey("2"));
  frame = await draw();
  checks.push([`${size}: lines: 2 puts its line in the box with the GM still making a note, and puts them away`, boxed(frame) === wanted[1]!.text && /The GM makes a note…/.test(frame) && !over(frame).some(r => /^\s*1 /.test(r)) && sent.length === sends]);
  // Emptied, they're back; a click puts another in; Enter sends it (the move queues it behind the notes).
  for (let i = 0; i < wanted[1]!.text.length; i++) act(() => setup.mockInput.pressBackspace());
  frame = await draw();
  checks.push([`${size}: lines: the box emptied, they're back`, /^Say it out loud/.test(boxed(frame)) && over(frame).filter(r => r.trim()).length === wanted.length]);
  const third = at(frame, wanted[2]!.text.slice(0, 10));
  if (third) await act(async () => { await setup.mockMouse.click(third.x, third.y); });
  frame = await draw();
  checks.push([`${size}: lines: a click puts its line in the box`, !!third && boxed(frame) === wanted[2]!.text]);
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: lines: Enter sends it, while the GM makes a note`, sent.at(-1) === wanted[2]!.text && /^Say it out loud/.test(boxed(frame))]);
  // Typing puts them away.
  await act(async () => { await setup.mockInput.typeText("Mor"); });
  frame = await draw();
  checks.push([`${size}: lines: typing puts them away`, boxed(frame) === "Mor" && !over(frame).some(r => /^\s*1 /.test(r))]);
  for (let i = 0; i < 3; i++) act(() => setup.mockInput.pressBackspace());

  // "/" lists /suggestions with the other commands.
  await act(async () => { await setup.mockInput.typeText("/"); });
  frame = await draw();
  checks.push([`${size}: lines: "/" lists /suggestions over the box`, /\/suggestions +\[on\|off\]: the suggested lines over the box/.test(frame)]);
  act(() => setup.mockInput.pressBackspace());

  // /suggestions off: the move, its words; with the setting off (the move's row), no lines and no
  // rows kept, even with the next turn's reply on its way.
  await act(async () => { await setup.mockInput.typeText("/suggestions off"); });
  await draw();
  await act(async () => { setup.mockInput.pressEnter(); await Promise.resolve(); });
  rows.players = rows.players.map(p => (p.id === rows.me ? { ...p, suggestions: false } : p));
  entry(4, "player:1", "player", "Show me the loft.");
  rows.scene = { ...rows.scene, turns: 4, turnId: 104n };
  turn(turnRow(3, "done", { notes: "written", suggest: "landed" }));
  turn(turnRow(4, "replying"));
  changed();
  frame = await draw();
  if (show) console.log(`${size}, lines off\n${frame}`);
  checks.push([`${size}: lines: /suggestions off says so (${SUGGESTIONS_OFF}), and keeps no rows for them, the GM speaking`, sent.at(-1) === "/suggestions off" && frame.includes(SUGGESTIONS_OFF) && over(frame).length === 0]);
  // On again: its words, and the rows kept while the turn's lines come.
  await act(async () => { await setup.mockInput.typeText("/suggestions"); });
  await draw();
  await act(async () => { setup.mockInput.pressEnter(); await Promise.resolve(); });
  rows.players = rows.players.map(p => (p.id === rows.me ? { ...p, suggestions: true } : p));
  changed();
  frame = await draw();
  checks.push([`${size}: lines: /suggestions with no word turns them on again, says so, and keeps their rows while they come`, sent.at(-1) === "/suggestions on" && frame.includes(SUGGESTIONS_ON.slice(0, Math.min(SUGGESTIONS_ON.length, w - 4))) && over(frame).length === keep]);

  // The help has their paragraph.
  await act(async () => { await setup.mockInput.typeText("/help"); });
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  checks.push([`${size}: lines: the help says how they work`, scene.overlay?.kind === "help" && doubled(frame).includes("After each reply, suggested lines come up over the box (a risky try in yellow): a number or a click puts one in the box to send or change; typing hides them. /suggestions off turns them off.")]);
  await esc();

  // A spectator: the same rows, the turn's lines in; none for them, and no rows kept.
  turn(turnRow(4, "done", { notes: "written", suggest: "landed" }));
  rows.scene = { ...rows.scene, turnId: undefined };
  rows.suggestions = linesFor(4);
  rows.me = 2n;
  changed();
  frame = await draw();
  checks.push([`${size}: lines: a spectator gets none, and no rows are kept for them`, scene.view.watching === YARD.player.name && over(frame).length === 0 && !frame.includes(LINES[1]!.text)]);
  await setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// The GM's markup as the draft grows, and the popover's card (the prototype's :1359-1460): Kell's,
// Cob's and Moll's lines each in their colour while the reply is still being written (speakers by
// game key, as the AI service streams them); a mark opened with room has its card under the note
// (the title bold in the title's colour, its lines dimmed), and without room the card goes first,
// the note whole.

for (const [w, h] of SIZES) {
  const size = `${w}x${h}`;
  const { actions } = recorder();
  let view: SceneView = { ...YARD, suggestions: LINES };
  const scene = new SceneModel(view, actions);
  const setup = await testRender(<App scene={scene} onQuit={() => {}} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const soon = async () => { await act(async () => { await new Promise(r => setTimeout(r, 50)); }); };
  const set = (patch: Partial<SceneView>) => { view = { ...view, ...patch }; act(() => scene.update(view)); };
  await draw();

  // The draft grows: Kell's line, then the start of Cob's, then Moll's, each speaker's colour as it comes.
  const reply = "Kell looks up. “The porters found him.” The boy scuffs a boot. “Weren't me.” On the wall, the girl snorts. “Weren't anyone, then.”";
  const quotes = [...reply.matchAll(/“[^”]*”/g)].map(m => ({ start: m.index, end: m.index + m[0].length }));
  const growing = (upTo: number, seq: number) => {
    const speakers = ["kell", "cob", "moll"];
    const speech = quotes.filter(q => q.start < upTo).map((q, i) => ({ start: q.start, end: Math.min(q.end, upTo), speaker: speakers[i]! }));
    set({ phase: "replying", mayType: false, suggestions: [], suggestionsComing: true, draft: { speaker: "gm", kind: "narration", text: reply.slice(0, upTo), markup: { speech, marks: [] }, attempt: 1, seq } });
  };
  growing(quotes[1]!.start + 4, 1);
  await soon();
  let frame = await draw();
  if (show) console.log(`${size}, the draft growing\n${frame}`);
  const colour = (text: string) => styleIn(setup, text)?.fg;
  checks.push([`${size}: the draft: Kell's line in her colour, and Cob's in his as it starts (${colour("“The porters")}, ${colour("“Wer")})`, colour("“The porters") === "#6d9eeb" && colour("“Wer") === "#e8b15a" && /▍/.test(frame)]);
  growing(reply.length, 2);
  await soon();
  frame = await draw();
  checks.push([`${size}: the draft: Moll's line in hers (${colour("“Weren't anyone")}), Cob's whole in his`, colour("“Weren't anyone") === "#e07ab0" && colour("“Weren't me") === "#e8b15a" && colour("“The porters") === "#6d9eeb"]);
  const { draft: _draft, ...rest } = view;
  view = { ...rest, phase: "done", mayType: true, suggestions: LINES, suggestionsComing: false };
  set({});

  // The popover: Tab and Enter open the last reply's mark (a "you", its card what the player did).
  frame = await draw();
  act(() => setup.mockInput.pressTab());
  await draw();
  act(() => setup.mockInput.pressEnter());
  frame = await draw();
  if (show) console.log(`${size}, the card\n${frame}`);
  const card = YARD.entries.at(-1)!.markup!.marks[0]!.card!;
  const popover = flat(frame);
  const note = "You barked at him to stop throwing stones a minute ago.";
  const whole = (text: string) => popover.includes(text) || frame.split("\n").some(r => r.includes(text));
  if (h >= 26) {
    checks.push([`${size}: the popover, with room: the note, then the card's title (bold, in the title's colour) and its lines (dimmed)`, scene.overlay?.kind === "mark" && /You barked at him/.test(frame)
      && whole(card.title) && card.lines.every(whole) && styleIn(setup, card.title)?.fg === C.title && styleIn(setup, card.title)?.bold === true && styleIn(setup, card.lines[0]!)?.fg === C.dim]);
  } else {
    checks.push([`${size}: the popover, without room (the lines over the box): the card goes first, the note whole`, scene.overlay?.kind === "mark" && !whole(card.title) && flat(frame.split("\n").map(r => r.replace(/[│╭╮╰╯─]/g, " ")).join(" ")).includes(note)]);
  }
  await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); });
  await setup.dispose();
}

let failed = 0;
for (const [what, ok] of checks) {
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
  if (!ok) failed++;
}
console.log(failed ? `FAIL: ${failed}` : `PASS: ${checks.length}`);
process.exit(failed ? 1 : 0);
