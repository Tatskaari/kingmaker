// Copied from the prototype's src/app/ui/sheet.test.ts at 44c6d4a, its layout half (the sheets' contents, and what casting, resting and features do to them, are shared/rules's to test): the sheets are recorded fixtures (the wizard's and the fighter's, as the engine made them), not made here; the cleric's cases use the wizard's or the fighter's; the warlock's pact slots and the spells the sheet doesn't carry (spellCard's) go with the engine.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createRef } from "react";
import { rgbToHex } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { FIGHTER, WIZARD } from "../check/rows.ts";
import { C } from "../theme.ts";
import { PORTRAIT_CLASSES, PORTRAIT_H, PORTRAIT_W, PORTRAITS, portraitCaption, portraitLines } from "./portraits.ts";
import { sheetHeight, sheetPages, spellOn, spellPage, spellsOn, type Row } from "./sheet-layout.ts";
import { SheetView, type SheetHandle } from "./sheet.tsx";

/**
 * The character sheet laid out for the screen at 80x24 and wider (sheetPages), the twelve
 * portraits, a spell picked, and SheetView drawn by OpenTUI headless. The sheets are the rules
 * engine's, recorded: no engine here, as the client has none.
 */

const SHEETS = { fighter: FIGHTER, wizard: WIZARD };
const who = (cls: keyof typeof SHEETS) => ({ name: SHEETS[cls].name, concept: SHEETS[cls].concept });

const plain = (rows: Row[]) => rows.map(r => r.map(s => s.text).join("")).join("\n");
const width = (r: Row) => r.reduce((n, s) => n + [...s.text].length, 0);

test("the sheet laid out at 80x24: pages that fit, the portrait beside the numbers, nothing wider than the screen", () => {
  for (const cls of ["fighter", "wizard"] as const) {
    const d = SHEETS[cls];
    // The overlay at 80x24: the whole screen, less its border and padding, a close bar and a row of hints.
    const pages = sheetPages(d, who(cls), 76, 21, { bar: true });
    assert.ok(pages.length > 1, `${cls}: in pages at 80x24`);
    assert.equal(pages[0]!.title, "Character");
    for (const p of pages) {
      assert.ok(!p.scrolls, `${cls}: "${p.title}" fits without scrolling`);
      assert.ok(p.rows.length <= 20);
      for (const r of p.rows) assert.ok(width(r) <= 76, `${cls}: a row ${width(r)} wide: ${plain([r])}`);
    }
    const first = plain(pages[0]!.rows);
    assert.match(first, new RegExp(d.name));
    assert.match(first, /HP .*\d+\/\d+/);
    assert.match(first, /AC \d+ · Speed \d+ ft · Initiative [+-]\d/);
    assert.match(first, /STR.*DEX.*CON.*INT.*WIS.*CHA/);
    // The portrait is in the left-hand columns of the first page.
    const portrait = plain(portraitLines(cls)).split("\n");
    const left = first.split("\n").map(l => l.slice(0, PORTRAIT_W));
    assert.deepEqual(left.slice(0, PORTRAIT_H).map(l => l.trimEnd()), portrait.map(l => l.trimEnd()), `${cls}: the portrait`);
    assert.equal(left[PORTRAIT_H]!.trim(), portraitCaption(cls), `${cls}: its caption under it`);
    const all = pages.map(p => plain(p.rows)).join("\n");
    for (const words of ["Saving throws", "Skills", "Passive", "Attacks", "Features", "Equipment", "Purse", "Proficiencies"]) assert.match(all, new RegExp(words), `${cls}: ${words}`);
    if (cls === "fighter") assert.match(all, /Second Wind\s+●● short rest/);
    if (cls === "wizard") assert.match(all, /1st\s+●●●●/);
  }
});

test("the sheet wide: one page with everything when there's room, laid out in columns beside the portrait", () => {
  const pages = sheetPages(FIGHTER, who("fighter"), 196, 56, { bar: true });
  assert.equal(pages.length, 1);
  const rows = pages[0]!.rows;
  assert.ok(rows.length < 50 && rows.every(r => width(r) <= 196));
  // Saving throws sit to the right of the head, not under it.
  const saves = plain(rows).split("\n").findIndex(l => l.includes("Saving throws"));
  assert.ok(saves >= 0 && saves < PORTRAIT_H, "the saves beside the portrait");
  assert.ok(sheetHeight(FIGHTER, who("fighter"), 196, 56, { bar: true }) < 56, "a box sized to the sheet, not the screen");
});

test("the Story page: a blank line between paragraphs, and a line break where the player made one (not a paragraph of its own)", () => {
  const story = { backstory: "I mend nets on the wharves.\nI owe Fat Jory three crowns.\n\nMy sister Ada writes every month.", personality: ["Dogged"], ideals: [], bonds: ["Ada"], flaws: [] };
  const pages = sheetPages({ ...FIGHTER, story }, { name: "Wren Ashdown", concept: "a net-mender" }, 76, 21, { bar: true });
  const page = pages.find(p => p.title.includes("Story"))!;
  // The Backstory section's column (it may be laid out beside another).
  const all = plain(page.rows).split("\n");
  const head = all.findIndex(l => l.includes("Backstory"));
  const col = all[head]!.indexOf("Backstory");
  const lines = all.slice(head + 1, head + 5).map(l => l.slice(col).trimEnd());
  assert.deepEqual(lines, ["I mend nets on the wharves.", "I owe Fat Jory three crowns.", "", "My sister Ada writes every month."]);
});

test("a bad day on the sheet: down with death saves, conditions, temporary hit points", () => {
  const down = { ...FIGHTER, hp: { current: 0, max: 28, temp: 0 }, deathSaves: { successes: 1, failures: 2, stable: false }, conditions: ["Unconscious", "Prone"] };
  const text = sheetPages(down, { name: "", concept: "" }, 76, 21, { bar: true }).map(p => plain(p.rows)).join("\n");
  assert.match(text, /HP ░+ 0\/28/, "an empty bar");
  assert.match(text, /Death saves ●○○ saved {2}●●○ failed/);
  assert.match(text, /Conditions Unconscious, Prone/);
  const propped = sheetPages({ ...FIGHTER, hp: { current: 20, max: 28, temp: 5 } }, { name: "", concept: "" }, 76, 21, { bar: true });
  assert.match(plain(propped[0]!.rows), /20\/28 \+5 temp/);
});

test("a sheet for a game without one from the rules engine says so", () => {
  const pages = sheetPages(undefined, { name: "Tamsin Vell", concept: "an auditor" }, 76, 20);
  assert.equal(pages.length, 1);
  assert.match(plain(pages[0]!.rows), /Tamsin Vell[\s\S]*an auditor[\s\S]*No D&D character sheet/);
});

test("twelve portraits, one a class, PORTRAIT_W by PORTRAIT_H, single-width characters only", () => {
  // ASCII, box drawing, block elements and the few code page 437 pictographs that are one cell everywhere.
  const safe = /^[\x20-\x7e─-▟☼♦♠♣♥♪♫•°·¤«»≈∩Ω⌂▲▼◄►○●◊√∞]*$/u;
  const seen = new Set<string>();
  for (const cls of PORTRAIT_CLASSES) {
    const p = PORTRAITS[cls];
    assert.ok(p, `a portrait for the ${cls}`);
    assert.ok(p.art.length >= 12 && p.art.length <= PORTRAIT_H, `${cls}: ${p.art.length} rows`);
    for (const row of p.art) {
      assert.ok([...row].length <= PORTRAIT_W, `${cls}: a row ${[...row].length} wide`);
      assert.match(row, safe, `${cls}: only single-width characters ("${row}")`);
    }
    assert.ok(p.caption && p.caption.length <= PORTRAIT_W, `${cls}: a caption that fits under it`);
    const lines = portraitLines(cls);
    assert.equal(lines.length, PORTRAIT_H);
    for (const l of lines) assert.equal(width(l), PORTRAIT_W);
    assert.ok(lines.flat().some(s => s.fg && s.fg !== lines.flat()[0]?.fg), `${cls}: in more than one colour`);
    seen.add(plain(lines));
  }
  assert.equal(seen.size, 12, "all different");
});

test("SheetView through OpenTUI: drawn exactly as laid out, and the pages turn with the keys", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  for (const cls of ["fighter", "wizard"] as const) {
    const d = SHEETS[cls];
    const setup = await testRender(createElement(SheetView, { data: d, who: who(cls), width: 76, height: 22, active: true, onClose: () => {} }), { width: 76, height: 22 });
    await setup.renderOnce();
    const pages = sheetPages(d, who(cls), 76, 21, { bar: true });
    const drawn = setup.captureCharFrame().split("\n");
    assert.match(drawn[0]!, /1 Character\s+2 Skills/, `${cls}: the tabs`);
    const want = plain(pages[0]!.rows).split("\n");
    assert.deepEqual(drawn.slice(1, 1 + want.length).map(l => l.trimEnd()), want.map(l => l.trimEnd()), `${cls}: the first page, cell for cell`);
    setup.mockInput.pressKey("2");
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /Saving throws[\s\S]*Skills/, `${cls}: 2 turns to the skills`);
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /Attacks/, `${cls}: → turns the page`);
    await setup.dispose();
  }
});

test("a spell picked, laid out: the card, the game's terms and the SRD's words, at 80x24 and wider", () => {
  const d = WIZARD;
  // On the sheet, each spell is something to pick, in reading order, its marks with it.
  const page = sheetPages(d, { name: "", concept: "" }, 76, 21, { bar: true }).find(p => spellsOn(p.rows).length)!;
  assert.deepEqual(spellsOn(page.rows).slice(0, 4), ["fire-bolt", "light", "ray-of-frost", "burning-hands"]);
  assert.equal(page.rows.flat().filter(r => r.spell === "sleep").map(r => r.text).join(""), "Sleep (C)");
  for (const w of [76, 126]) {
    const rows = spellPage(spellOn(d, "burning-hands")!, w);
    for (const r of rows) assert.ok(width(r) <= w, `a row ${width(r)} wide at ${w}: ${plain([r])}`);
    const text = plain(rows);
    assert.match(text, /^Burning Hands {2}Level 1 Evocation \(Sorcerer, Wizard\)/);
    assert.match(text, /Casting time Action · Range Self \(15-foot cone\) · Duration Instantaneous/);
    assert.match(text, /In this game ─+\nDexterity save, DC 13: 3d6 fire, half as much on a success\nArea: a 15-foot cone from you\nWith a higher slot: \+1d6 fire for each level above 1st/);
    assert.match(text, /From the SRD 5\.2\.1 ─+ CC BY 4\.0\nA thin sheet of flames shoots forth from you\./);
  }
  // Concentration stands out; the material is there in full.
  const sleep = spellPage(spellOn(d, "sleep")!, 76);
  assert.equal(sleep.flat().find(r => r.text === "Concentration")?.fg, C.warn);
  assert.match(plain(sleep), /Components V, S, M \(a pinch of sand or rose petals\)/);
  // No SRD text: the rules alone, and nothing in the text's place.
  const bare = plain(spellPage({ ...spellOn(d, "fire-bolt")!, text: undefined, credit: undefined }, 76));
  assert.match(bare, /Ranged spell attack, \+5 to hit: 1d10 fire on a hit/);
  assert.doesNotMatch(bare, /SRD|hurl/);
});

test("SheetView: a spell clicked, or picked with ↓ and Enter, shows what it is; Esc or ← Back put the sheet back as it was", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const d = WIZARD;
  const handle = createRef<SheetHandle>();
  let closed = 0;
  const setup = await testRender(createElement(SheetView, { ref: handle, data: d, who: who("wizard"), width: 76, height: 22, active: true, onClose: () => { closed++; } }), { width: 76, height: 22 });
  const frame = async () => { await setup.renderOnce(); return setup.captureCharFrame(); };
  const page = (f: string) => f.split("\n").slice(0, 21).join("\n");
  const hints = (f: string) => f.split("\n")[21]!;
  // A lone Esc reaches the app once the terminal is sure it's not the start of a sequence.
  const esc = async () => { setup.mockInput.pressEscape(); await new Promise(r => setTimeout(r, 60)); };
  await frame();
  setup.mockInput.pressKey("3");
  const sheet = await frame();
  assert.match(sheet, /3 Combat · Spells[\s\S]*Burning Hands/);
  assert.match(hints(sheet), /↑↓ a spell/);
  // Its spells, drawn a button each, land exactly where they're laid out.
  const laid = plain(sheetPages(d, who("wizard"), 76, 21, { bar: true })[2]!.rows).split("\n");
  assert.deepEqual(sheet.split("\n").slice(1, 1 + laid.length).map(l => l.trimEnd()), laid.map(l => l.trimEnd()));
  // ↓ picks the first spell (Esc lets it go, it says), and Enter shows it.
  setup.mockInput.pressArrow("down");
  assert.match(hints(await frame()), /Enter about it\s+·\s+Esc let go/);
  // The spell picked has a colour of its own: the pointer over another doesn't hide which one Enter shows.
  const bgOf = (text: string) => { for (const l of setup.captureSpans().lines) for (const sp of l.spans) if (sp.text.includes(text)) return rgbToHex(sp.bg).slice(0, 7); return undefined; };
  const pointAt = sheet.split("\n").findIndex(r => r.includes("Burning Hands"));
  await setup.mockMouse.moveTo(sheet.split("\n")[pointAt]!.indexOf("Burning Hands") + 3, pointAt);
  await frame();
  assert.deepEqual([bgOf("Fire Bolt"), bgOf("Burning Hands")], [C.pickBg, C.highlightBg]);
  setup.mockInput.pressEnter();
  const fire = await frame();
  assert.match(fire, /← Back {2}Fire Bolt[\s\S]*In this game[\s\S]*Ranged spell attack, \+5 to hit: 1d10 fire on a hit[\s\S]*You hurl a mote of fire/);
  assert.match(hints(fire), /Esc back to the sheet/);
  assert.ok(handle.current!.wants({ name: "c" } as never), "a spell open takes every key");
  // Esc: the same page as it was, Fire Bolt still picked; Esc again lets it go, and the caller has Esc back.
  await esc();
  const back = await frame();
  assert.equal(page(back), page(sheet), "the sheet as it was");
  assert.match(hints(back), /Enter about it/);
  await esc();
  assert.match(hints(await frame()), /↑↓ a spell/);
  assert.equal(handle.current!.wants({ name: "escape" } as never), false);
  // A click on a spell shows it; a click on ← Back puts it away.
  const rows = sheet.split("\n");
  const y = rows.findIndex(r => r.includes("Burning Hands"));
  await setup.mockMouse.click(rows[y]!.indexOf("Burning Hands") + 3, y);
  const hands = await frame();
  assert.match(hands, /← Back {2}Burning Hands[\s\S]*Dexterity save, DC 13: 3d6 fire, half as much on a success[\s\S]*A thin sheet of flames/);
  await setup.mockMouse.click(hands.split("\n")[0]!.indexOf("Back"), 0);
  assert.equal(page(await frame()), page(sheet), "back as it was");
  assert.equal(closed, 0);
  await setup.dispose();
});
