import assert from "node:assert/strict";
import { test } from "node:test";
process.env.KM_LOOK_MODEL = "off";
const { carryGear, castSpell, createCharacter, sheetData, useFeature } = await import("../../rules/dnd.ts");
const { PREGENS } = await import("../../game/combat/pregen.ts");
const { sheetHeight, sheetPages } = await import("./sheet-layout.ts");
const { PORTRAIT_CLASSES, PORTRAIT_H, PORTRAIT_W, PORTRAITS, portraitCaption, portraitLines } = await import("./portraits.ts");
import type { SessionState } from "../../runtime/session.ts";
import type { Row } from "./sheet-layout.ts";

/**
 * The character sheet: the rules engine's sheet as data (sheetData), laid out for the screen at
 * 80x24 and wider (sheetPages), the twelve portraits, and SheetView drawn by OpenTUI headless. The
 * characters are made by createCharacter from the pregens' builds: no model calls.
 */

const NAMES: Record<string, string> = { fighter: "Wren Ashdown", wizard: "Pell Marrow", cleric: "Brother Odo" };

async function made(cls: string): Promise<SessionState> {
  const state = {
    id: `sheet-${cls}`, sceneId: "hanged-clerk", approach: "v2", seed: 7, rollCount: 0,
    player: { name: NAMES[cls]!, concept: PREGENS[cls]!.concept, modifiers: {} },
    turn: 0, beat: "opening", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  } as SessionState;
  await createCharacter(state, 3, PREGENS[cls]!.build);
  return state;
}

const plain = (rows: Row[]) => rows.map(r => r.map(s => s.text).join("")).join("\n");
const width = (r: Row) => r.reduce((n, s) => n + [...s.text].length, 0);

test("a fighter's sheet: abilities and saves, Second Wind and Action Surge with their uses, a sword in hand", async () => {
  const d = (await sheetData(await made("fighter")))!;
  assert.deepEqual(d.classes, [{ id: "fighter", name: "Fighter", level: 3, subclass: "Champion" }]);
  assert.equal(d.species, "Human");
  assert.equal(d.background, "Soldier");
  assert.deepEqual(d.hp, { current: 28, max: 28, temp: 0 });
  assert.equal(d.ac, 18, "chain mail and a shield");
  assert.equal(d.speeds["walk"], 35, "Remarkable Athlete");
  assert.equal(d.proficiency, 2);
  assert.deepEqual(d.hitDice, [{ die: 10, left: 3, total: 3 }]);
  const str = d.abilities.find(a => a.id === "STR")!;
  assert.deepEqual([str.score, str.modifier, str.save, str.proficient], [17, 3, 5, true]);
  assert.deepEqual(d.abilities.filter(a => a.proficient).map(a => a.id), ["STR", "CON"], "a fighter's saving throws");
  const athletics = d.skills.find(s => s.id === "athletics")!;
  assert.deepEqual([athletics.proficiency, athletics.modifier], ["proficient", 5]);
  assert.equal(d.skills.find(s => s.id === "arcana")!.proficiency, "none");
  const sword = d.attacks.find(a => a.name === "Longsword")!;
  assert.deepEqual([sword.bonus, sword.damage, sword.type, sword.versatile, sword.held], [7, "1d8+3", "slashing", "1d10+3", true]);
  assert.deepEqual(d.attacks.find(a => a.name === "Longbow")!.range, { normal: 150, long: 600 });
  const feature = (name: string) => d.features.find(f => f.name === name);
  assert.deepEqual(feature("Second Wind")!.uses, { current: 2, max: 2, recharge: "short rest" });
  assert.deepEqual(feature("Action Surge")!.uses, { current: 1, max: 1, recharge: "short rest" });
  assert.ok(feature("Fighting Style")!.choice, "the fighting style chosen");
  assert.equal(feature("Improved Critical")!.from, "Champion");
  assert.ok(d.feats.includes("Savage Attacker"), "the soldier's origin feat");
  assert.equal(d.spellcasting, undefined);
  assert.deepEqual(d.equipment.map(e => [e.name, e.slot]), [["Longsword", "in hand"], ["Longbow", undefined], ["Chain Mail", "worn"], ["Shield", "worn"]]);
  assert.deepEqual(d.conditions, []);
  assert.deepEqual(d.purse.map(c => `${c.quantity} ${c.name}`), ["2 silver crowns", "6 shillings", "12 pennies"], "the purse the story starts them with");
  assert.ok(d.proficiencies.armor.includes("Heavy") && d.proficiencies.weapons.includes("Martial"));
});

test("a wizard's sheet: the spellbook by level, slots spent and back after a long rest, Arcane Recovery", async () => {
  const state = await made("wizard");
  const d = (await sheetData(state))!;
  const sc = d.spellcasting!;
  assert.deepEqual([sc.className, sc.ability, sc.saveDC, sc.attackBonus], ["Wizard", "INT", 13, 5]);
  assert.deepEqual(sc.slots, [{ level: 1, max: 4, used: 0 }, { level: 2, max: 2, used: 0 }]);
  assert.deepEqual(sc.spells.map(g => g.level), [0, 1, 2]);
  assert.ok(sc.spells[0]!.spells.some(s => s.name === "Fire Bolt" && s.ready));
  assert.ok(sc.spells[1]!.spells.find(s => s.id === "sleep")!.concentration, "Sleep takes concentration");
  assert.ok(sc.spells.flatMap(g => g.spells).every(s => s.ready), "everything the pregen has is prepared");
  assert.deepEqual(d.features.find(f => f.name === "Arcane Recovery")!.uses, { current: 2, max: 2, recharge: "long rest" });
  assert.equal(d.ac, 12, "no armour: 10 and Dexterity");
  assert.ok(d.feats.includes("Magic Initiate (Wizard)"));
  // A slot spent shows as spent.
  await castSpell(state, [], "magic-missile", []);
  assert.deepEqual((await sheetData(state))!.spellcasting!.slots[0], { level: 1, max: 4, used: 1 });
  // Parted from the staff by the story: off the sheet, attacks and all.
  const staff = state.rules!.gear!.find(g => g.name === "Quarterstaff")!;
  await carryGear(state, staff.id, false);
  const after = (await sheetData(state))!;
  assert.ok(!after.equipment.some(e => e.name === "Quarterstaff") && !after.attacks.some(a => a.name === "Quarterstaff"));
});

test("a cleric's sheet: domain spells always prepared, Channel Divinity, a dwarf's darkvision; the purse and pockets from the story's world", async () => {
  const state = await made("cleric");
  const d = (await sheetData(state))!;
  assert.equal(d.species, "Dwarf");
  assert.equal(d.classes[0]!.subclass, "Life Domain");
  const spells = d.spellcasting!.spells.flatMap(g => g.spells);
  assert.ok(["Bless", "Cure Wounds", "Aid", "Lesser Restoration"].every(n => spells.find(s => s.name === n)?.always), "the Life Domain's spells");
  assert.ok(!spells.find(s => s.name === "Guiding Bolt")!.always);
  assert.deepEqual(d.features.find(f => f.name === "Channel Divinity")!.uses, { current: 2, max: 2, recharge: "one back per short rest" });
  assert.ok(d.traits.includes("Darkvision 120 ft") && d.traits.includes("Poison resistance"));
  assert.deepEqual(d.languages, ["Common", "Dwarvish"]);
  assert.ok(d.proficiencies.armor.includes("Heavy"), "the Life Domain's armour training");
  // Bless on themselves: a condition while it lasts.
  await castSpell(state, [], "bless", ["self"]);
  assert.ok((await sheetData(state))!.conditions.includes("Blessed"));
  // Once the story has begun, the purse and pockets are whatever they carry in the world.
  state.carried = [
    { id: "pennies", name: "pennies", kind: "item", parent: "player", tags: [], states: [], notes: [], quantity: 3 },
    { id: "satchel", name: "a satchel", kind: "item", parent: "player", tags: ["container"], states: [], notes: [] },
    { id: "letter", name: "a letter from the King", kind: "item", parent: "satchel", tags: [], states: [], notes: [] },
    { id: "odo-mace", name: "Brother's mace", kind: "item", parent: "player", tags: ["weapon"], states: [], notes: [], gear: "x" },
  ];
  const later = (await sheetData(state))!;
  assert.deepEqual(later.purse, [{ name: "pennies", quantity: 3 }]);
  assert.deepEqual(later.carrying, [{ name: "a satchel", quantity: 1 }, { name: "a letter from the King", quantity: 1, in: "a satchel" }]);
});

test("Second Wind spent: one pip of two left", async () => {
  const state = await made("fighter");
  await useFeature(state, [], "second-wind");
  assert.deepEqual((await sheetData(state))!.features.find(f => f.name === "Second Wind")!.uses, { current: 1, max: 2, recharge: "short rest" });
});

test("the sheet laid out at 80x24: pages that fit, the portrait beside the numbers, nothing wider than the screen", async () => {
  for (const cls of ["fighter", "wizard", "cleric"]) {
    const state = await made(cls);
    const d = (await sheetData(state))!;
    // The overlay at 80x24: the whole screen, less its border and padding, a close bar and a row of hints.
    const pages = sheetPages(d, state.player, 76, 21, { bar: true });
    assert.ok(pages.length > 1, `${cls}: in pages at 80x24`);
    assert.equal(pages[0]!.title, "Character");
    for (const p of pages) {
      assert.ok(!p.scrolls, `${cls}: "${p.title}" fits without scrolling`);
      assert.ok(p.rows.length <= 20);
      for (const r of p.rows) assert.ok(width(r) <= 76, `${cls}: a row ${width(r)} wide: ${plain([r])}`);
    }
    const first = plain(pages[0]!.rows);
    assert.match(first, new RegExp(NAMES[cls]!));
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
    if (cls === "cleric") assert.match(all, /Channel Divinity/);
  }
});

test("the sheet wide: one page with everything when there's room, laid out in columns beside the portrait", async () => {
  const state = await made("cleric");
  const d = (await sheetData(state))!;
  const pages = sheetPages(d, state.player, 196, 56, { bar: true });
  assert.equal(pages.length, 1);
  const rows = pages[0]!.rows;
  assert.ok(rows.length < 50 && rows.every(r => width(r) <= 196));
  // Saving throws sit to the right of the head, not under it.
  const saves = plain(rows).split("\n").findIndex(l => l.includes("Saving throws"));
  assert.ok(saves >= 0 && saves < PORTRAIT_H, "the saves beside the portrait");
  assert.ok(sheetHeight(d, state.player, 196, 56, { bar: true }) < 56, "a box sized to the sheet, not the screen");
});

test("a bad day on the sheet: down with death saves, conditions, temporary hit points; a warlock's pact slots", async () => {
  const d = (await sheetData(await made("fighter")))!;
  const down = { ...d, hp: { current: 0, max: 28, temp: 0 }, deathSaves: { successes: 1, failures: 2, stable: false }, conditions: ["Unconscious", "Prone"] };
  const text = sheetPages(down, { name: "", concept: "" }, 76, 21, { bar: true }).map(p => plain(p.rows)).join("\n");
  assert.match(text, /HP ░+ 0\/28/, "an empty bar");
  assert.match(text, /Death saves ●○○ saved {2}●●○ failed/);
  assert.match(text, /Conditions Unconscious, Prone/);
  const propped = sheetPages({ ...d, hp: { current: 20, max: 28, temp: 5 } }, { name: "", concept: "" }, 76, 21, { bar: true });
  assert.match(plain(propped[0]!.rows), /20\/28 \+5 temp/);
  // A warlock's slots are all of one level and come back on a short rest.
  const state = { ...(await made("wizard")), id: "sheet-warlock" } as SessionState;
  await createCharacter(state, 3, { classId: "warlock" });
  const warlock = (await sheetData(state))!;
  assert.deepEqual(warlock.spellcasting!.pact, { level: 2, max: 2, used: 0 });
  const pages = sheetPages(warlock, state.player, 76, 21, { bar: true }).map(p => plain(p.rows)).join("\n");
  assert.match(pages, /Pact slots ●●/);
  assert.match(pages, /all 2nd level, back on a short rest/);
  // An invocation is a choice on its feature, not a feat as well.
  const invocations = warlock.features.find(f => /Eldritch Invocations/.test(f.name))!;
  assert.ok(invocations.choice && !warlock.feats.some(f => invocations.choice!.includes(f)));
});

test("a sheet for a session from before the rules engine says so", () => {
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
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const { testRender } = await import("@opentui/react/test-utils");
  const React = await import("react");
  const { SheetView } = await import("./sheet.tsx");
  for (const cls of ["fighter", "wizard", "cleric"]) {
    const state = await made(cls);
    const d = (await sheetData(state))!;
    const setup = await testRender(React.createElement(SheetView, { data: d, who: state.player, width: 76, height: 22, active: true, onClose: () => {} }), { width: 76, height: 22 });
    await setup.renderOnce();
    const pages = sheetPages(d, state.player, 76, 21, { bar: true });
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
  await unregister();
});

