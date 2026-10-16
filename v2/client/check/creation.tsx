// After the prototype's src/app/smoke/screens-check.tsx at 44c6d4a: its sheet's checks (:798-849), the title's (:853-874) and making a character's (:890-1306), drawn from fixture rows with the moves recorded (no engine, no model, no server).
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../app.tsx";
import { AppModel, type Intent } from "../app/model.ts";
import type { HomeRows } from "../backend.ts";
import { DEFAULT_CONCEPT, DEFAULT_NAME } from "../creation/words.ts";
import type { SceneView } from "../scene/view.ts";
import { YARD } from "./fixture.ts";
import { CONCEPT, creationRow, DRAFT, FIGHTER, gameRow, LISTS, NAME, NEPHEW, NEPHEW_ISSUE, OFFER, OWN, sheetRow, WIZARD } from "./rows.ts";
import { StubBackend } from "./stub.ts";

/**
 * The title, character creation's screens and the sheet, drawn by the real App over fixture rows,
 * played with the keys and the mouse, each move it makes recorded (v1-design §4.4), at 80x24 and
 * 130x42 (and the prototype's own sizes where its checks had them): the title's New game, Continue
 * and delete; the create screen's fields and its defaults; the creating screen's lines; the three
 * cards, picked out by the pointer and chosen by a click, the keys and a number; their own, picked
 * by a click and the keys; the backstory typed, drafted, taken or left, the lore check's fix accepted
 * or rewritten, and what the prototype's review found (a long fix shown whole, one too long refused,
 * the word count, a story too long, the wheel); the sheet the engine made and setting off; the
 * sheet over a scene, a spell on it clicked and back. screens.tsx runs these after its scene's.
 */
export async function checkCreation(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  // The spinners and the models' timers (the box saved) redraw between frames, as in play: React's word on each isn't news.
  const error = console.error;
  console.error = (...args: unknown[]) => { if (!/not wrapped in act/.test(String(args[0]))) error(...args); };
  try {
    await everyCheck(checks, show);
  } finally {
    console.error = error;
  }
}

async function everyCheck(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  for (const size of [[80, 24], [130, 42]] as const) {
    await title(checks, size, show);
    await create(checks, size, show);
    await creating(checks, size);
    await choose(checks, size, show);
    await custom(checks, size, show);
    await backstory(checks, size, show);
    await lore(checks, size, show);
    await created(checks, size, show);
    await sheet(checks, size, show);
  }
  for (const size of [[80, 24], [100, 30]] as const) await longFixes(checks, size, show);
  await smallCases(checks, show);
}

// ---------------------------------------------------------------------------------------------
// The harness: the App over a stub backend, drawn, played.

type Size = readonly [number, number];

/** The App over these rows at this size, with what drives it and reads it. */
async function open(rows: Partial<HomeRows>, intent: Intent, [w, h]: Size, scene?: SceneView) {
  const backend = new StubBackend(rows, scene);
  // The box's text saved, as the simulation keeps it.
  backend.answers.setBackstory = ({ text }: { text: string }) => { const c = backend.rows.creation; if (c) backend.set({ creation: { ...c, story: text } }); };
  const app = new AppModel(backend, { campaign: "caerwyn", intent, saveMs: 30 });
  const setup = await testRender(<App app={app} />, { width: w, height: h });
  const draw = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  /** The rows changed, as a commit changes them. */
  const set = (patch: Partial<HomeRows>, view?: SceneView | null) => act(() => backend.set(patch, view));
  const go = (to: Intent) => act(() => app.go(to));
  /** A beat for timers and redraws: the spinner, the box saved, a lone Esc. */
  const settle = async (ms = 30) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); return await draw(); };
  /** A lone Esc is held a moment by the key parser (it might start a sequence): wait it out. */
  const esc = async () => { await act(async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 80)); }); return await draw(); };
  /** A click on some words as the screen has them now; false (and the screen shown) when they aren't there. */
  const click = async (words: string): Promise<boolean> => {
    const frame = await draw();
    const p = at(frame, words);
    if (!p) { console.log(`(no "${words}" to click on:)\n${frame}`); return false; }
    await act(async () => { await setup.mockMouse.click(p.x, p.y); });
    await draw();
    return true;
  };
  const press = async (keys: () => void) => { act(keys); return await draw(); };
  const type = async (text: string) => { await act(async () => { await setup.mockInput.typeText(text); }); return await draw(); };
  await draw();
  return { backend, app, setup, draw, set, go, settle, esc, click, press, type, frame: await draw() };
}

/** The middle of some text on screen, in cells; undefined when it isn't there. */
function at(frame: string, text: string): { x: number; y: number } | undefined {
  const rows = frame.split("\n");
  const y = rows.findIndex(r => r.includes(text));
  if (y < 0) return undefined;
  return { x: [...rows[y]!].join("").indexOf(text) + Math.floor(text.length / 2), y };
}

const flat = (t: string) => t.replace(/\s+/g, " ");
/** The screen's words without the boxes' edges, as one line: wrapped words read whole. */
const unboxed = (frame: string) => flat(frame.replace(/[│╭╮╰╯─┃┌┐└┘║═╔╗╚╝]/g, " "));
const label = ([w, h]: Size) => `${w}x${h}`;

/** The choose screen's rows: Tamsin's creation, the three builds offered. */
const choosing = (): Partial<HomeRows> => ({ creation: creationRow() });
/** The backstory screen's: the bard chosen, `more` laid over. */
const writing = (more: Parameters<typeof creationRow>[0] = {}): Partial<HomeRows> => ({ creation: creationRow({ step: "backstory", chosen: OFFER.options[1]!, ...more }) });

// ---------------------------------------------------------------------------------------------
// The title.

async function title(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const games = [gameRow(1n, "Pell Marrow", "in The Hanged Clerk", 5), gameRow(2n, "Wren Ashdown", "heading for The Hanged Clerk", 60 * 50, Date.now(), false)];
  const s = await open({ games }, "title", size);
  if (show) console.log(`title ${label(size)}\n${s.frame}`);
  checks.push([`the title ${label(size)}: its name, Continue with the game played last as describe says it, an older one, New game, Quit`,
    s.frame.includes("The Hanged Clerk of Caerwyn") && s.frame.includes("Continue") && s.frame.includes("Pell Marrow: Morning, in The Hanged Clerk (5 min ago)")
    && s.frame.includes("Continue an older game") && s.frame.includes("New game") && s.frame.includes("Quit") && !s.frame.includes("zoo")]);

  await s.click("New game");
  checks.push([`the title ${label(size)}: a click on New game makes a character (the create screen)`, s.app.screen === "create" && (await s.draw()).includes("Who are you?")]);
  s.go("title");
  await s.draw();

  await s.click("Continue");
  const resumed = s.backend.moves.at(-1);
  checks.push([`the title ${label(size)}: a click on Continue carries the game on (continue_game)`, resumed?.name === "continueGame" && (resumed.args as { game: bigint }).game === 1n]);
  s.go("title");
  await s.draw();

  let frame = await s.press(() => s.setup.mockInput.pressKey("x"));
  const asked = frame.includes("Delete this game?") && frame.includes("Pell Marrow's, for good: x again deletes it");
  await s.press(() => s.setup.mockInput.pressKey("x"));
  const deleted = s.backend.moves.at(-1);
  checks.push([`the title ${label(size)}: x asks, and x again deletes it (delete_game)`, asked && deleted?.name === "deleteGame" && (deleted.args as { game: bigint }).game === 1n]);
  frame = await s.press(() => s.setup.mockInput.pressKey("x"));
  await s.press(() => s.setup.mockInput.pressArrow("down"));
  checks.push([`the title ${label(size)}: any other key keeps it`, frame.includes("Delete this game?") && s.backend.moves.at(-1) === deleted && !(await s.draw()).includes("Delete this game?")]);
  await s.setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// The name and the concept, and the creating screen.

async function create(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const s = await open({}, "new", size);
  if (show) console.log(`create ${label(size)}\n${s.frame}`);
  checks.push([`the create screen ${label(size)}: who are you, the name and the concept's fields with their defaults, the level's builds, the examples`,
    s.frame.includes("Who are you?") && s.frame.includes(" Name ") && s.frame.includes(" Who they are, in a sentence ") && s.frame.includes(`${DEFAULT_NAME} (Enter for the default)`)
    && s.frame.includes("Next: three level 3 D&D builds") && s.frame.includes("Tamsin Vell: a disgraced palace auditor")]);

  // Enter in the name goes on to the concept; Enter there, both empty, starts it with the defaults.
  await s.press(() => s.setup.mockInput.pressEnter());
  await s.press(() => s.setup.mockInput.pressEnter());
  await s.settle();
  const started = s.backend.moves.at(-1);
  const defaults = JSON.stringify({ campaign: "caerwyn", name: DEFAULT_NAME, concept: DEFAULT_CONCEPT, how: "three", afresh: true });
  checks.push([`the create screen ${label(size)}: Enter, Enter with nothing typed starts it afresh with the defaults (start_creation, three)`,
    started?.name === "startCreation" && JSON.stringify(started.args) === defaults]);
  await s.setup.dispose();

  // New game over a character half made: nothing of it on the screen, and it starts afresh (the prototype's newCharacter drops its creation).
  const half = await open({ creation: creationRow({ name: "Bet Vell", concept: "a ledger-keeper's sister who sells eggs", step: "backstory", chosen: OFFER.options[1]!, story: "I kept the Exchequer's ledgers." }) }, "new", size);
  const empty = !half.frame.includes("Bet Vell") && !half.frame.includes("sells eggs") && half.frame.includes(`${DEFAULT_NAME} (Enter for the default)`);
  await half.press(() => half.setup.mockInput.pressEnter());
  await half.press(() => half.setup.mockInput.pressEnter());
  await half.settle();
  const afresh = half.backend.moves.at(-1);
  checks.push([`the create screen ${label(size)}: New game over a character half made shows none of it, and starts afresh`, empty && afresh?.name === "startCreation" && JSON.stringify(afresh.args) === defaults]);
  await half.setup.dispose();

  const t = await open({}, "new", size);
  await t.type("Tamsin Vell");
  await t.press(() => t.setup.mockInput.pressTab());
  await t.type("a disgraced palace auditor");
  await t.press(() => t.setup.mockInput.pressEnter());
  await t.settle();
  const typed = t.backend.moves.at(-1)?.args as { name?: string; concept?: string } | undefined;
  checks.push([`the create screen ${label(size)}: a name, Tab, a concept and Enter start that one`, typed?.name === "Tamsin Vell" && typed.concept === "a disgraced palace auditor"]);
  await t.esc();
  checks.push([`the create screen ${label(size)}: Esc goes to the title`, t.app.screen === "title"]);
  await t.setup.dispose();

  // A refusal says why, on the screen.
  const r = await open({ refusal: "(Your character's concept needs to be 300 characters or fewer.)" }, "new", size);
  checks.push([`the create screen ${label(size)}: a refused concept says why`, r.frame.includes("(Your character's concept needs to be 300 characters or fewer.)")]);
  await r.setup.dispose();
}

async function creating(checks: Array<[string, boolean]>, size: Size): Promise<void> {
  for (const [busy, line] of [["builds", "Three tailors take your measurements…"], ["pick", "Consulting the Standard Array…"], ["traits", "Writing you into the story…"]] as const) {
    const s = await open({ creation: creationRow({ busy, step: busy === "builds" ? "choose" : "backstory", chosen: OFFER.options[0]! }) }, "creation", size);
    const frame = await s.settle();
    checks.push([`the creating screen ${label(size)}: busy ${busy}, who's being made and "${line}"`, s.app.screen === "creating" && frame.includes(NAME) && frame.includes("a disgraced palace auditor") && frame.includes(line)]);
    await s.setup.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Three builds, and their own.

async function choose(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const titles = OFFER.options.map(o => `${o.card.species} ${o.card.className} 3`);
  {
    const s = await open(choosing(), "creation", size);
    if (show) console.log(`choose ${label(size)}\n${s.frame}`);
    const missing = [...titles, ...OFFER.options.map(o => `HP ${o.card.hp}`), "Make my own", "Back", `Three ways to be ${NAME}`].filter(t => !s.frame.includes(t));
    checks.push([`the cards ${label(size)}: three, each whole (who, HP and AC), and Make my own and Back${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !missing.length]);
    const third = at(s.frame, titles[2]!)!;
    await act(async () => { await s.setup.mockMouse.moveTo(third.x, third.y + 4); });
    await s.draw();
    checks.push([`the cards ${label(size)}: the pointer moving over the third card picks it out`, s.app.creation.creation?.index === 2]);
    const second = at(s.frame, titles[1]!)!;
    await act(async () => { await s.setup.mockMouse.click(second.x, second.y + 3); });
    await s.draw();
    const chose = s.backend.moves.at(-1);
    checks.push([`the cards ${label(size)}: a click on the second card chooses it (choose_build 1)`, chose?.name === "chooseBuild" && (chose.args as { index: number }).index === 1]);
    await s.setup.dispose();
  }
  {
    const s = await open(choosing(), "creation", size);
    await s.press(() => s.setup.mockInput.pressArrow("right"));
    await s.press(() => s.setup.mockInput.pressArrow("right"));
    await s.press(() => s.setup.mockInput.pressEnter());
    const keys = s.backend.moves.at(-1);
    await s.press(() => s.setup.mockInput.pressKey("1"));
    const one = s.backend.moves.at(-1);
    await s.press(() => s.setup.mockInput.pressKey("m"));
    const own = s.backend.moves.at(-1);
    await s.esc();
    const back = s.backend.moves.at(-1);
    checks.push([`the cards ${label(size)}: → → Enter takes the third, 1 the first, m makes their own from the one picked out (the first), Esc goes back`,
      keys?.name === "chooseBuild" && (keys.args as { index: number }).index === 2 && one?.name === "chooseBuild" && (one.args as { index: number }).index === 0
      && own?.name === "makeOwn" && (own.args as { from: number }).from === 0 && back?.name === "creationBack"]);
    await s.setup.dispose();
  }
}

async function custom(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const from = { speciesId: "halfling", classId: "rogue", subclassId: "thief", backgroundId: "sage" };
  const s = await open({ creation: creationRow({ step: "custom", own: { picks: from, option: OFFER.options[0]!, lists: LISTS } }) }, "creation", size);
  if (show) console.log(`custom ${label(size)}\n${s.frame}`);
  await s.click("Orc");
  const orc = s.backend.moves.at(-1)?.args as Record<string, string> | undefined;
  await s.settle();
  await s.press(() => s.setup.mockInput.pressArrow("right"));
  await s.press(() => s.setup.mockInput.pressArrow("down"));
  const next = s.backend.moves.at(-1)?.args as Record<string, string> | undefined;
  await s.settle();
  const after = LISTS.classes[LISTS.classes.findIndex(c => c.id === "rogue") + 1]!.id;
  checks.push([`their own ${label(size)}: a click on Orc picks it, → the classes, ↓ the next class (pick_own, with its subclass)`,
    orc?.speciesId === "orc" && orc.classId === "rogue" && next?.classId === after && next.subclassId === LISTS.subclasses[after]?.[0]?.id && s.app.creation.creation?.own?.column === 1]);

  s.set({ creation: creationRow({ step: "custom", own: { picks: { speciesId: "orc", classId: "rogue", subclassId: "thief", backgroundId: "criminal" }, option: OWN, lists: LISTS } }) });
  const frame = await s.draw();
  checks.push([`their own ${label(size)}: what it comes to is the engine's card`, frame.includes("What it comes to") && unboxed(frame).includes("Orc Rogue 3 · Thief · Criminal") && frame.includes(`HP ${OWN.card.hp}`)]);
  await s.click("Take this one");
  checks.push([`their own ${label(size)}: Take this one takes it (take_own)`, s.backend.moves.at(-1)?.name === "takeOwn"]);

  // The engine making it: Take this one waits.
  s.set({ creation: creationRow({ step: "custom", busy: "own", own: { picks: from, option: OWN, lists: LISTS } }) });
  const made = s.backend.moves.length;
  const making = await s.draw();
  await s.click("Take this one");
  checks.push([`their own ${label(size)}: while the engine makes it, the preview says so and Take this one waits`, making.includes("The rules engine is making it") && s.backend.moves.length === made]);
  await s.setup.dispose();

  const waiting = await open({ creation: creationRow({ step: "custom", busy: "own", own: { picks: from } }) }, "creation", size);
  checks.push([`their own ${label(size)}: before the engine's first answer, a word while the lists come`, (await waiting.settle()).includes("The rules engine lays out the SRD's species")]);
  await waiting.setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// The backstory.

async function backstory(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const h = size[1];
  {
    const s = await open(writing(), "creation", size);
    if (show) console.log(`backstory ${label(size)}\n${s.frame}`);
    checks.push([`the backstory ${label(size)}: who were you, the build chosen, the box, its buttons (no "GM offline")`,
      s.frame.includes("Who were you, before the King sent for you?") && s.frame.includes("human bard 3 (College of Lore), sage background")
      && ["Draft one", "Work it in", "Skip", "Done"].every(b => s.frame.includes(b)) && !s.frame.includes("GM offline")]);
    await s.type("I kept a grain factor's books for nine years.");
    await s.press(() => { s.setup.mockInput.pressEnter(); s.setup.mockInput.pressEnter(); });
    await s.type("I owe Fat Jory three crowns.");
    checks.push([`the backstory ${label(size)}: what's typed is in the box, paragraphs and all`, s.app.creation.creation?.story === "I kept a grain factor's books for nine years.\n\nI owe Fat Jory three crowns."]);
    const saved = await s.settle(80);
    checks.push([`the backstory ${label(size)}: saved once typing stops (set_backstory), and the box's title counts the words`,
      s.backend.moves.at(-1)?.name === "setBackstory" && (s.backend.moves.at(-1)?.args as { text: string }).text.endsWith("three crowns.") && saved.includes("Your backstory · 15 words")]);
    // Filled past the box: it scrolls to keep the cursor in sight.
    await act(async () => { for (let i = 0; i < h; i++) { s.setup.mockInput.pressKey("END"); s.setup.mockInput.pressEnter(); await s.setup.mockInput.typeText(`Line ${i}.`); } });
    const full = await s.draw();
    checks.push([`the backstory ${label(size)}: filled past the box, it scrolls (the last line in view, the first gone)`, full.includes(`Line ${h - 1}.`) && !full.includes("I kept a grain factor's")]);
    await s.press(() => s.setup.mockInput.pressTab());
    await s.press(() => { s.setup.mockInput.pressArrow("left"); s.setup.mockInput.pressArrow("left"); s.setup.mockInput.pressArrow("left"); });
    await s.press(() => s.setup.mockInput.pressEnter());
    const drafted = s.backend.moves.at(-1);
    checks.push([`the backstory ${label(size)}: Tab to the buttons, ← to Draft one, Enter: draft_backstory with the box's text`,
      drafted?.name === "draftBackstory" && (drafted.args as { text: string }).text.includes(`Line ${h - 1}.`)]);
    await s.setup.dispose();
  }
  {
    const s = await open(writing({ story: "My own first line.", proposal: { kind: "draft", text: DRAFT } }), "creation", size);
    checks.push([`the backstory ${label(size)}: a draft shown first, not in the box, with Use this and Keep mine`,
      s.frame.includes("A draft: not in your box until you take it") && s.frame.includes("chandler's shop") && !s.frame.includes("My own first line.") && s.frame.includes("Use this") && s.frame.includes("Keep mine")]);
    await s.click("Keep mine");
    const left = s.backend.moves.at(-1)?.name;
    await s.click("Use this");
    checks.push([`the backstory ${label(size)}: Keep mine leaves it, Use this takes it`, left === "leaveProposal" && s.backend.moves.at(-1)?.name === "takeProposal"]);
    s.set(writing({ story: DRAFT, version: 2, note: "It's yours now: change anything you like." }));
    const taken = await s.settle();
    checks.push([`the backstory ${label(size)}: taken, it's in the box, with the row's word`, taken.includes("chandler's shop") && taken.includes("Your backstory") && taken.includes("It's yours now")]);
    s.set(writing({ story: DRAFT, version: 2, proposal: { kind: "work", text: "I grew up in the Nine Furrows. I still owe Fat Jory three crowns." } }));
    const worked = await s.draw();
    await s.esc();
    checks.push([`the backstory ${label(size)}: their notes worked in, shown first; Esc keeps theirs`, worked.includes("Your notes, worked in") && worked.includes("Nine Furrows") && s.backend.moves.at(-1)?.name === "leaveProposal"]);
    await s.setup.dispose();
  }
  {
    const s = await open(writing({ busy: "check" }), "creation", size);
    const frame = await s.settle();
    checks.push([`the backstory ${label(size)}: the lore check at work, its spinner`, frame.includes("The GM checks your story against the world…")]);
    s.set(writing({ busy: "check", again: true }));
    checks.push([`the backstory ${label(size)}: and again, with the fixes in`, (await s.settle()).includes("The GM checks it again, with the fixes in…")]);
    s.set(writing({ busy: "draft" }));
    checks.push([`the backstory ${label(size)}: a draft being written`, (await s.settle()).includes("The GM drafts one…")]);
    await s.setup.dispose();
  }
}

async function lore(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const s = await open(writing({ story: NEPHEW, issues: [NEPHEW_ISSUE] }), "creation", size);
  if (show) console.log(`lore ${label(size)}\n${s.frame}`);
  checks.push([`the lore check ${label(size)}: what doesn't fit, what the world says, and a fix that keeps its spirit`,
    s.frame.includes("The lore check: 1 of 1") && flat(s.frame).includes("Your story says: \"I'm the King's nephew\"") && unboxed(s.frame).includes("The world says: King Aldren's family")
    && flat(s.frame).includes("A fix that keeps its spirit") && s.frame.includes("Accept the fix") && s.frame.includes("Rewrite it myself")]);
  await s.click("Rewrite it myself");
  const rewrote = s.backend.moves.at(-1)?.name;
  await s.click("Accept the fix");
  checks.push([`the lore check ${label(size)}: Rewrite it myself, Accept the fix (rewrite_issue, accept_fix)`, rewrote === "rewriteIssue" && s.backend.moves.at(-1)?.name === "acceptFix"]);
  s.set(writing({ story: NEPHEW, rewriting: NEPHEW_ISSUE }));
  const rewriting = await s.settle();
  checks.push([`the lore check ${label(size)}: rewriting, what it said and suggested stay over the box`, rewriting.includes("Rewrite this so it fits") && rewriting.includes("It suggested:") && rewriting.includes("Your backstory")]);
  s.set(writing({ story: NEPHEW, issues: [NEPHEW_ISSUE], again: true }));
  checks.push([`the lore check ${label(size)}: the second look says so`, (await s.settle()).includes("The lore check, again, with the fixes in: 1 of 1")]);
  await s.setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// The sheet the engine made, and setting off.

async function created(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const unchecked = "Your backstory went in as you wrote it, without the lore check: the GM is offline.";
  const rows: Partial<HomeRows> = {
    creation: creationRow({ step: "made", gameId: 3n, unchecked }),
    seat: { playerId: 9n, gameId: 3n, sceneId: undefined }, player: { name: WIZARD.name, concept: WIZARD.concept }, sheet: sheetRow(WIZARD),
    games: [gameRow(3n, WIZARD.name, "heading for The Hanged Clerk", 0, Date.now(), false)],
  };
  const s = await open(rows, "game", size);
  const frame = await s.settle();
  if (show) console.log(`created ${label(size)}\n${frame}`);
  checks.push([`the sheet ${label(size)}: where the story starts, the unchecked line, the sheet the engine made, Set off and Choose again`,
    flat(frame).includes("Morning, on the eve of the Assembly. This morning a palace clerk") && unboxed(frame).includes("without the lore check")
    && frame.includes("Character sheet") && frame.includes(WIZARD.name) && frame.includes("Set off") && frame.includes("r Choose again")]);
  await s.press(() => s.setup.mockInput.pressEnter());
  const begun = s.backend.moves.at(-1)?.name;
  await s.press(() => s.setup.mockInput.pressKey("r"));
  checks.push([`the sheet ${label(size)}: Enter sets off (begin), r chooses again (choose_again)`, begun === "begin" && s.backend.moves.at(-1)?.name === "chooseAgain"]);
  await s.setup.dispose();

  // A game carried on before it began: its sheet, but no choosing again (no creation made it now).
  const t = await open({ ...rows, creation: undefined }, "game", size);
  const carried = await t.settle();
  await t.press(() => t.setup.mockInput.pressKey("r"));
  checks.push([`the sheet ${label(size)}: a game this creation didn't make has no r, nor its unchecked line`,
    carried.includes("Set off") && !carried.includes("Choose again") && !unboxed(carried).includes("without the lore check") && !t.backend.moves.length]);
  await t.setup.dispose();
}

async function sheet(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const h = size[1];
  const rows: Partial<HomeRows> = { seat: { playerId: 1n, gameId: 1n, sceneId: 7n }, player: { name: WIZARD.name, concept: WIZARD.concept }, sheet: sheetRow(WIZARD) };
  const s = await open(rows, "game", size, YARD);
  await s.type("/sheet");
  let frame = await s.press(() => s.setup.mockInput.pressEnter());
  checks.push([`the sheet over a scene ${label(size)}: /sheet opens it`, s.app.scene?.overlay?.kind === "sheet" && frame.includes("Character sheet") && frame.includes(WIZARD.name)]);
  // To the spells by a click on their page's tab (the first "Spells" on screen).
  const tab = at(frame, "Spells");
  if (tab) await act(async () => { await s.setup.mockMouse.click(tab.x, tab.y); });
  const spells = await s.draw();
  if (show) console.log(`sheet ${label(size)}\n${spells}`);
  const spell = at(spells, "Burning Hands");
  checks.push([`the sheet ${label(size)}: a click on its tab turns to the spells`, !!spell]);
  if (spell) await act(async () => { await s.setup.mockMouse.click(spell.x, spell.y); });
  frame = await s.draw();
  // Each of these whole, inside the sheet's box.
  const box = flat(frame.split("\n").filter(r => r.includes("║")).join(" "));
  const wanted = [
    "← Back", "Burning Hands Level 1 Evocation (Sorcerer, Wizard)", "Casting time Action · Range Self (15-foot cone) · Duration Instantaneous", "Components V, S",
    "In this game", "Dexterity save, DC 13: 3d6 fire, half as much on a success", "Area: a 15-foot cone from you", "With a higher slot: +1d6 fire for each level above 1st",
    "From the SRD 5.2.1", "CC BY 4.0", "A thin sheet of flames shoots forth from you.", "Esc back to the sheet",
  ];
  const missing = wanted.filter(t => !box.includes(t));
  checks.push([`the sheet ${label(size)}: a click on Burning Hands shows it, every line whole${missing.length ? ` (not: ${missing.join(" | ")})` : ""}`, !!spell && !missing.length]);
  const lines = frame.split("\n");
  const top = lines.findIndex(r => r.includes("╔")), bottom = lines.findIndex(r => r.includes("╚"));
  const left = lines[top]?.indexOf("╔") ?? -1, right = lines[top]?.indexOf("╗") ?? -1;
  checks.push([`the sheet ${label(size)}: the spell in the sheet's own box, its sides unbroken`, top >= 0 && bottom > top && bottom < h && lines.slice(top + 1, bottom).every(r => r[left] === "║" && r[right] === "║")]);
  const back = at(frame, "← Back");
  if (back) await act(async () => { await s.setup.mockMouse.click(back.x, back.y); });
  checks.push([`the sheet ${label(size)}: a click on ← Back puts the sheet back as it was`, (await s.draw()) === spells]);
  // By keys: ↓ picks the first spell, Enter shows it, Esc puts it back, Esc lets it go, Esc puts the sheet away.
  await s.press(() => s.setup.mockInput.pressArrow("down"));
  frame = await s.press(() => s.setup.mockInput.pressEnter());
  checks.push([`the sheet ${label(size)}: ↓ and Enter show Fire Bolt`, /← Back {2}Fire Bolt/.test(frame) && frame.includes("Ranged spell attack, +5 to hit: 1d10 fire on a hit") && frame.includes("You hurl a mote of fire")]);
  frame = await s.esc();
  checks.push([`the sheet ${label(size)}: Esc goes back to the sheet, Fire Bolt still picked`, frame.includes("Burning Hands") && frame.includes("Enter about it") && s.app.scene?.overlay?.kind === "sheet"]);
  await s.esc();
  frame = await s.esc();
  checks.push([`the sheet ${label(size)}: Esc lets the spell go, then puts the sheet away, back to the scene`, !s.app.scene?.overlay && frame.includes("What do you say?")]);
  // c is the sheet too, and c (or Esc) closes it.
  await s.type("/c");
  await s.press(() => s.setup.mockInput.pressEnter());
  const opened = s.app.scene?.overlay?.kind === "sheet";
  await s.press(() => s.setup.mockInput.pressKey("c"));
  checks.push([`the sheet ${label(size)}: /c opens it, c closes it`, opened && !s.app.scene?.overlay]);
  await s.setup.dispose();
}

// ---------------------------------------------------------------------------------------------
// What the review of character creation found (the prototype's screens-check.tsx:1100-1306).

async function longFixes(checks: Array<[string, boolean]>, size: Size, show: boolean): Promise<void> {
  const SALLOW = "I clerked for two years under Master Josiah Sallow at the Royal Purveyor's office. He's a fussy, honest man who never once fiddled a figure, and he'd vouch for me to anyone. I left when my mother fell ill in Darn Fell, and I owe her doctor six crowns.";
  const ISSUE = {
    quote: "I clerked for two years under Master Josiah Sallow at the Royal Purveyor's office. He's a fussy, honest man who never once fiddled a figure, and he'd vouch for me to anyone.",
    problem: "Sallow is a named officer of the Royal Purveyor's office; a former clerk who worked under him for two years would be a recorded connection, and the story's named people do not know Tamsin yet. His willingness to vouch for her doesn't fit the premise either.",
    fix: "I clerked for two years in the Royal Purveyor's office, where Master Sallow's fussy ways taught me to check every figure twice. I left before I could learn whether he'd vouch for anyone but himself.",
  };
  {
    const s = await open(writing({ story: SALLOW, issues: [ISSUE] }), "creation", size);
    const frame = await s.settle();
    if (show) console.log(`long fix ${label(size)}\n${frame}`);
    checks.push([`the lore check ${label(size)}: a long issue's fix is on screen whole, with what the world says and the story's words`, unboxed(frame).includes(flat(`A fix that keeps its spirit: "${ISSUE.fix}"`)) && frame.includes("The world says:") && frame.includes("Your story says:")]);
    await s.click("Accept the fix");
    checks.push([`the lore check ${label(size)}: the fix seen whole is the fix taken`, s.backend.moves.at(-1)?.name === "acceptFix"]);
    await s.setup.dispose();
  }
  {
    const huge = { ...ISSUE, fix: "I clerked for two years in the Royal Purveyor's office, where I learned to check every figure twice. ".repeat(14).trim() };
    const s = await open(writing({ story: SALLOW, issues: [huge] }), "creation", size);
    await s.settle();
    await s.click("Accept the fix");
    const frame = await s.settle();
    checks.push([`the lore check ${label(size)}: a fix longer than the screen can show isn't taken, and the screen says why`, !s.backend.moves.length && frame.includes("The fix is longer than this window can show")]);
    await s.press(() => s.setup.mockInput.pressEnter());
    checks.push([`the lore check ${label(size)}: Enter rewrites it instead`, s.backend.moves.at(-1)?.name === "rewriteIssue"]);
    s.set(writing({ story: SALLOW, rewriting: ISSUE }));
    const rewriting = await s.settle();
    checks.push([`rewriting ${label(size)}: what the world says and the fix it suggested stay over the box, whole`, rewriting.includes("Rewrite this so it fits") && rewriting.includes("The world says:") && unboxed(rewriting).includes(flat(`It suggested: "${ISSUE.fix}"`)) && rewriting.includes("Your backstory")]);
    await s.setup.dispose();
  }
}

async function smallCases(checks: Array<[string, boolean]>, show: boolean): Promise<void> {
  const size = [80, 24] as const;
  // The wheel in the box: wrapped prose three rows a notch, up and back down, the bar beside it; the box's title counts the words.
  {
    const prose = Array.from({ length: 14 }, (_, i) => `Long line ${i}: the Purveyor's office kept two sets of books and I only ever saw one of them.`).join("\n");
    const s = await open(writing({ story: prose }), "creation", size);
    const seen = (f: string) => [...f.matchAll(/Long line (\d+)/g)].map(m => Number(m[1]));
    let frame = await s.settle();
    const before = Math.min(...seen(frame));
    const y = frame.split("\n").findIndex(r => r.includes(`Long line ${before + 2}`));
    for (let i = 0; i < 2; i++) { await act(async () => { await s.setup.mockMouse.scroll(20, y, "up"); }); await s.draw(); }
    frame = await s.draw();
    const up = Math.min(...seen(frame));
    checks.push([`the backstory 80x24: the wheel scrolls wrapped prose up, a few rows a notch (line ${before} to ${up})`, up <= before - 2 && frame.includes("┃")]);
    await act(async () => { await s.setup.mockMouse.scroll(20, y, "down"); });
    frame = await s.draw();
    checks.push([`the backstory 80x24: and back down`, Math.min(...seen(frame)) > up]);
    checks.push([`the backstory 80x24: the box's title counts the words`, frame.includes(`Your backstory · ${prose.split(/\s+/).length} words`)]);
    await s.setup.dispose();
  }
  // Longer than the GM can be given: Done keeps it in the box, says how long, and sends nothing.
  {
    const long = "word ".repeat(2001).trim();
    const s = await open(writing({ story: long }), "creation", size);
    await s.settle();
    await s.click("Done");
    const frame = await s.settle();
    checks.push([`the backstory 80x24: longer than the GM can be given, Done keeps it in the box and says how long it is`, !s.backend.moves.length && frame.includes("It's 2,001 words") && frame.includes("(2,000 at most)")]);
    await s.setup.dispose();
  }
  // A refusal on the note line; a note of the row's when nothing's refused.
  {
    const s = await open({ ...writing({ note: "The GM couldn't be reached: HTTP 503." }), refusal: "(The GM is still working on it.)" }, "creation", size);
    const refused = await s.settle();
    s.set({ refusal: undefined });
    const noted = await s.settle();
    checks.push([`the backstory 80x24: a refusal on the note line, before the row's own note`, refused.includes("(The GM is still working on it.)") && noted.includes("The GM couldn't be reached: HTTP 503.")]);
    await s.setup.dispose();
  }
  // The cards when the GM couldn't be reached: why, in two lines at 80 columns (what it means first).
  {
    const offer = { ...OFFER, note: "The GM couldn't be reached, so here are three from the class defaults that best match your words (OpenRouter rules.builds HTTP 401: {\"error\":{\"message\":\"No auth credentials found\",\"code\":401}})." };
    const s = await open({ creation: creationRow({ offer }) }, "creation", size);
    const frame = await s.settle();
    if (show) console.log(`cards, unreachable\n${frame}`);
    checks.push([`the cards 80x24: the GM out of reach, and that these are the class defaults, in two lines`, /The GM couldn't be reached, so here are three from the class defaults that best match your words/.test(flat(frame)) && frame.includes("HTTP 401")]);
    await s.setup.dispose();
  }
  // Their own, a caster: its spell DC and spells are in what it comes to.
  {
    const bard = OFFER.options[1]!;
    const s = await open({ creation: creationRow({ step: "custom", own: { picks: { speciesId: "human", classId: "bard", subclassId: "college-of-lore", backgroundId: "sage" }, option: bard, lists: LISTS } }) }, "creation", size);
    const frame = await s.settle();
    checks.push([`their own 80x24: a caster's spell DC and spells are in what it comes to`, /Spells DC \d+ \+\d/.test(frame) && frame.includes("Fire Bolt")]);
    await s.setup.dispose();
  }
  // Out of reach or offline: into the game unchecked, and the sheet says so over it.
  for (const reason of ["the GM is offline", "the GM couldn't be reached (OpenRouter backstory.check HTTP 401: no auth)"]) {
    const unchecked = `Your backstory went in as you wrote it, without the lore check: ${reason}.`;
    const s = await open({
      creation: creationRow({ step: "made", gameId: 3n, unchecked }), seat: { playerId: 9n, gameId: 3n, sceneId: undefined },
      player: { name: FIGHTER.name, concept: FIGHTER.concept }, sheet: sheetRow(FIGHTER), games: [gameRow(3n, FIGHTER.name, "heading for The Hanged Clerk", 0)],
    }, "game", size);
    const frame = await s.settle();
    checks.push([`the backstory, ${reason.slice(0, 32)}…: the sheet says it went in unchecked, over it, at 80x24`, flat(frame).includes(flat(unchecked).slice(0, 60)) && frame.includes("Character sheet")]);
    await s.setup.dispose();
  }
}
