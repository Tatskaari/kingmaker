// Copied from the prototype's src/app/ui/sheet-layout.ts at 44c6d4a: SheetData, SpellDetails and SrdBlock come from shared/rules/types.ts, Span from ./types.ts.
import type { SheetData, SpellDetails, SrdBlock } from "../../shared/rules/types.ts";
import { C } from "../theme.ts";
import { PORTRAIT_W, portraitCaption, portraitLines } from "./portraits.ts";
import type { Span } from "./types.ts";

/**
 * The character sheet, laid out: the class's portrait beside who they are and how they stand (hit
 * points, armour, the six abilities in boxes), then saves and skills, attacks, features and their
 * uses, spells and their slots, and what they carry. sheetPages lays it out for a size as styled
 * rows, a page at a time when the whole sheet doesn't fit (pure: the tests and pictures use it as
 * is); SheetView (sheet.tsx) shows them. A spell on the sheet is marked as one (its runs carry its
 * id) so it can be picked, and spellPage lays out what it is when it is.
 */

/** A run of text in one style: a StyledLine span that can also be italic, and part of a spell's name on the sheet (its id). */
export type Run = Span & { italic?: boolean; spell?: string };
export type Row = Run[];
export interface SheetPage { title: string; rows: Row[]; scrolls?: boolean }
/** Who they are, for a session without a rules sheet. */
export interface Who { name: string; concept: string }

/** Columns narrower than this don't get used; sections lay themselves out for whatever they get above it. */
const MIN_COL = 34;
const GAP = 3;

const cells = (t: string) => [...t].length;
export const widthOf = (row: Row) => row.reduce((n, r) => n + cells(r.text), 0);
export const run = (text: string, fg?: string, style: Omit<Run, "text" | "fg"> = {}): Run => ({ text, ...(fg ? { fg } : {}), ...style });
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const ordinal = (n: number) => ["Cantrips", "1st", "2nd", "3rd"][n] ?? `${n}th`;

/** A row cut (with an ellipsis) or padded to exactly w cells. */
export function fit(row: Row, w: number): Row {
  const out: Row = [];
  let n = 0;
  for (const r of row) {
    const chars = [...r.text];
    if (n + chars.length <= w) { out.push(r); n += chars.length; continue; }
    const room = w - n;
    if (room > 0) out.push({ ...r, text: room > 1 ? `${chars.slice(0, room - 1).join("")}…` : "…" });
    n = w;
    break;
  }
  if (n < w) out.push(run(" ".repeat(w - n)));
  return out;
}

/** Blocks side by side, each padded to its width. */
function beside(blocks: Array<{ rows: Row[]; w: number }>, gap = GAP): Row[] {
  const h = Math.max(0, ...blocks.map(b => b.rows.length));
  return Array.from({ length: h }, (_, y) => blocks.flatMap((b, i) => [...(i ? [run(" ".repeat(gap))] : []), ...fit(b.rows[y] ?? [], b.w)]));
}

/** Atoms (runs that stay together) in rows at most w wide, with sep between them on a row; later rows indented. */
export function flow(atoms: Row[], w: number, sep: Row = [run(" ")], indent = 0): Row[] {
  const rows: Row[] = [];
  const sw = widthOf(sep);
  let cur: Row = [], n = 0, empty = true;
  for (const atom of atoms) {
    const aw = widthOf(atom);
    if (!empty && n + sw + aw > w) { rows.push(cur); cur = indent ? [run(" ".repeat(indent))] : []; n = indent; empty = true; }
    if (!empty) { cur.push(...sep); n += sw; }
    cur.push(...atom);
    n += aw;
    empty = false;
  }
  if (!empty) rows.push(cur);
  return rows.map(r => (widthOf(r) > w ? fit(r, w) : r));
}

/** A label and a list after it, wrapped: "Armour Light, Medium, Heavy". */
function labelled(label: Row, items: Row[], w: number, sep: Row, indent = 2): Row[] {
  if (!items.length) return [label];
  return flow([[...label, ...items[0]!], ...items.slice(1)], w, sep, indent);
}

/** Words in one style, wrapped; at most `max` rows, the last ending in an ellipsis if there was more. */
export function prose(text: string, w: number, fg: string, style: Omit<Run, "text" | "fg"> = {}, max = Infinity): Row[] {
  const rows = flow(text.split(/\s+/).filter(Boolean).map(word => [run(word, fg, style)]), w);
  if (rows.length <= max) return rows;
  // A word off the end (and the space before it) until the ellipsis fits.
  let last = rows[max - 1]!;
  while (last.length > 1 && widthOf(last) + 1 > w) last = last.slice(0, -2);
  return [...rows.slice(0, max - 1), [...last, run("…", fg, style)]];
}

/** A section's heading: its title, then a rule to the edge. */
function rule(title: string, w: number): Row {
  const head = [run(title, C.title, { bold: true })];
  const rest = w - widthOf(head) - 1;
  return rest > 0 ? [...head, run(` ${"─".repeat(rest)}`, C.border)] : fit(head, w);
}

/** Uses or slots as pips (spent ones hollow); a big pool (Lay on Hands) as numbers. */
function pips(left: number, max: number, on: string = C.lead): Run[] {
  if (max > 8) return [run(`${left}/${max}`, on, { bold: true })];
  return [run("●".repeat(Math.max(0, left)), on), run("○".repeat(Math.max(0, max - left)), C.faint)];
}

const centre = (t: string, w: number) => {
  const left = Math.floor((w - cells(t)) / 2);
  return `${" ".repeat(Math.max(0, left))}${t}`.padEnd(w);
};

// ---------------------------------------------------------------------------------------------
// The head of the sheet: the portrait, who they are, how they stand, the six abilities.

function hpBar(d: SheetData, w: number): Row {
  const { current, max, temp } = d.hp;
  const label = [run("HP ", C.dim)];
  const nums = [run(` ${current}/${max}`, C.text, { bold: true }), ...(temp ? [run(` +${temp} temp`, C.player)] : [])];
  const barW = Math.max(6, Math.min(24, w - widthOf(label) - widthOf(nums)));
  const ratio = max ? Math.min(1, current / max) : 0;
  const color = ratio > 0.5 ? C.good : ratio > 0.25 ? C.warn : C.danger;
  const full = Math.round(barW * ratio);
  const extra = temp ? Math.min(barW - full, Math.max(1, Math.round((barW * temp) / Math.max(1, max)))) : 0;
  return [...label, run("█".repeat(full), color), run("█".repeat(extra), C.player), run("░".repeat(barW - full - extra), C.faint), ...nums];
}

function abilityBoxes(d: SheetData, w: number): Row[] {
  const box = (a: SheetData["abilities"][number]): Row[] => [
    [run("╭─", C.border), run(a.id, C.title, { bold: true }), run("─╮", C.border)],
    [run("│", C.border), run(centre(signed(a.modifier), 5), C.text, { bold: true }), run("│", C.border)],
    [run("│", C.border), run(centre(String(a.score), 5), C.dim), run("│", C.border)],
    [run("╰─────╯", C.border)],
  ];
  const across = w >= 6 * 7 ? 6 : 3;
  const gap = w >= 6 * 7 + 5 ? 1 : 0;
  const rows: Row[] = [];
  for (let i = 0; i < d.abilities.length; i += across) rows.push(...beside(d.abilities.slice(i, i + across).map(a => ({ rows: box(a), w: 7 })), gap));
  return rows;
}

function vitals(d: SheetData, w: number): Row[] {
  const dot = [run(" · ", C.faint)];
  const classes = d.classes.map(k => `${k.name} ${k.level}`).join(" / ");
  const subclasses = d.classes.map(k => k.subclass).filter((s): s is string => !!s);
  const rows: Row[] = [
    [run(d.name, C.title, { bold: true })],
    ...flow([[run(`${d.species} ${classes}`, C.text)], ...subclasses.map(s => [run(s, C.text)]), [run(`${d.background} background`, C.dim)]], w, dot),
    ...prose(d.concept, w, C.faint, { italic: true }, 3),
    [],
    hpBar(d, w),
  ];
  const walk = d.speeds["walk"] ?? 30;
  const others = Object.entries(d.speeds).filter(([k, v]) => k !== "walk" && v > 0).map(([k, v]) => `${k} ${v}`);
  const chip = (label: string, value: string): Row => [run(`${label} `, C.dim), run(value, C.text, { bold: true })];
  rows.push(...flow([chip("AC", String(d.ac)), chip("Speed", `${walk} ft${others.length ? ` (${others.join(", ")})` : ""}`), chip("Initiative", signed(d.initiative)), chip("Proficiency", signed(d.proficiency))], w, dot));
  const dice = d.hitDice.map(h => [...pips(h.left, h.total), run(` d${h.die}`, C.dim)]);
  rows.push(...flow([[run("Hit Dice ", C.dim), ...dice.flatMap((x, i) => [...(i ? [run(" ")] : []), ...x])], ...(d.inspiration ? [[run("♦ Heroic Inspiration", C.lead)]] : [])], w, dot));
  if (d.deathSaves) {
    rows.push(d.deathSaves.stable ? [run("Down, but stable", C.danger)]
      : [run("Death saves ", C.danger), ...pips(d.deathSaves.successes, 3, C.good), run(" saved  ", C.dim), ...pips(d.deathSaves.failures, 3, C.danger), run(" failed", C.dim)]);
  }
  rows.push(...labelled([run("Conditions ", C.dim)], d.conditions.length ? d.conditions.map(c => [run(c, C.danger)]) : [[run("none worth mentioning", C.faint)]], w, [run(", ", C.dim)]));
  return [...rows, [], ...abilityBoxes(d, w)];
}

/** A class's portrait with its caption under it. */
const portrait = (classId: string | undefined): Row[] => [...portraitLines(classId), [run(centre(portraitCaption(classId), PORTRAIT_W), C.faint, { italic: true })]];

/** The portrait beside the rest, or above it when there isn't room. */
function header(d: SheetData, w: number): Row[] {
  const picture = portrait(d.classes[0]?.id);
  if (w >= PORTRAIT_W + 2 + 42) {
    const iw = w - PORTRAIT_W - 2;
    return beside([{ rows: picture, w: PORTRAIT_W }, { rows: vitals(d, iw), w: iw }], 2);
  }
  const indent = Math.max(0, Math.floor((w - PORTRAIT_W) / 2));
  return [...picture.map(r => fit([run(" ".repeat(indent)), ...r], w)), [], ...vitals(d, w)];
}

// ---------------------------------------------------------------------------------------------
// The sections below it.

function savesRows(d: SheetData): Row[] {
  return d.abilities.map(a => [
    run(a.proficient ? "● " : "○ ", a.proficient ? C.lead : C.faint),
    run(a.name.padEnd(13), a.proficient ? C.text : C.dim),
    run(signed(a.save).padStart(3), a.proficient ? C.text : C.dim, a.proficient ? { bold: true } : {}),
  ]);
}

function skillRow(s: SheetData["skills"][number]): Row {
  const trained = s.proficiency !== "none";
  const mark = s.proficiency === "expertise" ? "◆ " : s.proficiency === "proficient" ? "● " : trained ? "· " : "○ ";
  return [
    run(mark, trained ? C.lead : C.faint),
    run(s.name.padEnd(16), trained ? C.text : C.dim),
    run(s.ability, C.faint),
    run(signed(s.modifier).padStart(4), trained ? C.text : C.dim, trained ? { bold: true } : {}),
    run(s.advantage ? "▲" : s.disadvantage ? "▼" : " ", s.advantage ? C.good : C.danger),
  ];
}

const PASSIVE = [["perception", "Perception"], ["insight", "Insight"], ["investigation", "Investigation"]] as const;

function skillsSection(d: SheetData, w: number): Row[] {
  const saves = savesRows(d);
  const skills = d.skills.map(skillRow);
  const half = Math.ceil(skills.length / 2);
  const legend = flow([
    [run("● ", C.lead), run("proficient", C.faint)],
    ...(d.skills.some(s => s.proficiency === "expertise") ? [[run("◆ ", C.lead), run("expertise", C.faint)]] : []),
    ...(d.skills.some(s => s.advantage) ? [[run("▲ ", C.good), run("advantage", C.faint)]] : []),
    ...(d.skills.some(s => s.disadvantage) ? [[run("▼ ", C.danger), run("disadvantage", C.faint)]] : []),
  ], w, [run("   ")]);
  // Wide: saves and passives in a column, the skills in two beside them.
  if (w >= 18 + 2 + 26 + 2 + 26) {
    const left = [rule("Saving throws", 18), ...saves, [], rule("Passive", 18), ...PASSIVE.map(([k, name]) => [run(name.padEnd(15), C.dim), run(String(d.passive[k] ?? 10).padStart(3), C.text, { bold: true })])];
    const right = [rule("Skills", w - 20), ...beside([{ rows: skills.slice(0, half), w: 26 }, { rows: skills.slice(half), w: 26 }], 2), [], ...legend];
    return beside([{ rows: left, w: 18 }, { rows: right, w: w - 20 }], 2);
  }
  const passive = flow(PASSIVE.map(([k, name]) => [run(`${name} `, C.dim), run(String(d.passive[k] ?? 10), C.text, { bold: true })]), w, [run(" · ", C.faint)]);
  const two = w >= 26 * 2 + 2;
  return [
    rule("Saving throws", w),
    ...(w >= 18 * 2 + 2 ? beside([{ rows: saves.slice(0, 3), w: 18 }, { rows: saves.slice(3), w: 18 }], 2) : saves),
    [],
    rule("Skills", w),
    ...(two ? beside([{ rows: skills.slice(0, half), w: 26 }, { rows: skills.slice(half), w: 26 }], 2) : skills),
    ...legend,
    [],
    rule("Passive", w),
    ...passive,
  ];
}

function attacksSection(d: SheetData, w: number): Row[] {
  const rows = [rule("Attacks", w)];
  // Names in a column (a long one, like Unarmed Strike, just runs on).
  const nameW = Math.min(14, Math.max(6, ...d.attacks.filter(a => !/^Unarmed/.test(a.name)).map(a => cells(a.name))));
  for (const a of d.attacks) {
    const hit = [run(a.name.padEnd(nameW), C.text, { bold: true }), run(` ${signed(a.bonus).padStart(3)}`, C.lead, { bold: true })];
    const damage = [run(a.damage, C.text), run(` ${a.type}`, C.dim)];
    const gap = widthOf(hit) + 2 + widthOf(damage) <= w ? 2 : widthOf(hit) + 1 + widthOf(damage) <= w ? 1 : 0;
    if (gap) rows.push([...hit, run(" ".repeat(gap)), ...damage]);
    else rows.push(fit(hit, w), fit([run("  "), ...damage], w));
    const notes = [
      ...(a.held ? ["in hand"] : []),
      ...(a.versatile ? [`two hands ${a.versatile}`] : []),
      ...(a.range ? [`${a.range.normal}/${a.range.long} ft`] : []),
      ...a.properties.filter(p => p !== "versatile"),
      ...(a.mastery ? [`mastery: ${a.mastery}`] : []),
    ];
    if (notes.length) rows.push(...flow(notes.map(n => [run(n, C.faint)]), w - 2, [run(" · ", C.faint)]).map(r => [run("  "), ...r]));
  }
  if (!d.attacks.length) rows.push([run("Nothing to hit anyone with. Diplomacy, then.", C.faint, { italic: true })]);
  return rows;
}

function featuresSection(d: SheetData, w: number): Row[] {
  const rows = [rule("Features", w)];
  const subclasses = new Set(d.classes.map(k => k.subclass).filter(Boolean));
  for (const f of d.features) {
    // The choice goes on to the next line when it's too long for this one (three invocations).
    const named: Row = [run(f.name, C.text), ...(f.choice ? [run(": ", C.dim), run(f.choice, C.lead)] : [])];
    const atoms: Row[] = widthOf(named) <= w || !f.choice ? [named] : [[run(f.name, C.text), run(":", C.dim)], [run(f.choice, C.lead)]];
    if (f.uses) atoms.push([...pips(f.uses.current, f.uses.max), ...(f.uses.recharge ? [run(` ${f.uses.recharge}`, C.faint)] : [])]);
    if (subclasses.has(f.from) && !f.name.includes(f.from)) atoms.push([run(f.from, C.faint)]);
    rows.push(...flow(atoms, w, [run("  ")], 2));
  }
  if (!d.features.length) rows.push([run("Nothing yet. Give it a level or two.", C.faint, { italic: true })]);
  return rows;
}

function featsSection(d: SheetData, w: number): Row[] {
  return [rule("Feats", w), ...(d.feats.length ? flow(d.feats.map(f => [run(f, C.text)]), w, [run(" · ", C.faint)]) : [[run("None", C.faint)]])];
}

function traitsSection(d: SheetData, w: number): Row[] {
  return [rule(d.species, w), ...(d.traits.length ? flow(d.traits.map(t => [run(t, C.text)]), w, [run(" · ", C.faint)]) : [[run("Nothing out of the ordinary", C.faint)]])];
}

function spellsSection(d: SheetData, w: number): Row[] {
  const sc = d.spellcasting!;
  const dot = [run(" · ", C.faint)];
  const rows = [
    rule("Spells", w),
    ...flow([
      [run(sc.className, C.text), run(` (${sc.ability})`, C.dim)],
      [run("save DC ", C.dim), run(String(sc.saveDC), C.text, { bold: true })],
      [run("spell attack ", C.dim), run(signed(sc.attackBonus), C.text, { bold: true })],
    ], w, dot),
  ];
  const gutter = 10;
  const levels = [...new Set([...sc.spells.map(g => g.level), ...sc.slots.map(s => s.level)])].sort((a, b) => a - b);
  for (const level of levels) {
    const slot = sc.slots.find(s => s.level === level);
    const label: Row = [run(ordinal(level).padEnd(level ? 4 : 9), C.dim), ...(slot ? pips(slot.max - slot.used, slot.max) : [])];
    const spells = sc.spells.find(g => g.level === level)?.spells ?? [];
    // A spell's name and its marks are one thing to click (or pick with ↑↓), when there's more to show about it.
    const atoms = spells.map(sp => [
      run(sp.name, !sp.ready ? C.faint : sp.always ? C.lead : C.text),
      ...(sp.concentration ? [run(" (C)", C.faint)] : []),
      ...(sp.ritual ? [run(" (R)", C.faint)] : []),
    ].map(r => (sp.details ? { ...r, spell: sp.id } : r)));
    const body = atoms.length ? flow(atoms, Math.max(10, w - gutter), dot) : [[run("for casting lower spells higher", C.faint, { italic: true })]];
    if (widthOf(label) > gutter - 1) rows.push(label, ...body.map(r => [run(" ".repeat(gutter)), ...r]));
    else rows.push(...body.map((r, i) => [...fit(i ? [] : label, gutter), ...r]));
  }
  if (sc.pact) rows.push(...flow([[run("Pact slots ", C.dim), ...pips(sc.pact.max - sc.pact.used, sc.pact.max)], [run(`all ${ordinal(sc.pact.level)} level, back on a short rest`, C.faint)]], w, [run("  ")]));
  const all = sc.spells.flatMap(g => g.spells);
  const legend = [
    ...(all.some(s => s.always) ? [[run("gold", C.lead), run(" always prepared", C.faint)]] : []),
    ...(all.some(s => !s.ready) ? [[run("dim", C.faint), run(" not prepared", C.faint)]] : []),
    ...(all.some(s => s.concentration) ? [[run("(C) concentration", C.faint)]] : []),
    ...(all.some(s => s.ritual) ? [[run("(R) ritual", C.faint)]] : []),
  ];
  if (legend.length) rows.push(...flow(legend, w, dot));
  return rows;
}

function equipmentSection(d: SheetData, w: number): Row[] {
  const rows = [rule("Equipment", w)];
  const order = (k: string) => (k === "weapon" ? 0 : k === "armor" ? 1 : 2);
  for (const e of [...d.equipment].sort((a, b) => order(a.kind) - order(b.kind))) {
    rows.push(...flow([[run(e.name, C.text), ...(e.quantity > 1 ? [run(` ×${e.quantity}`, C.dim)] : [])], ...(e.slot ? [[run(e.slot, C.dim)]] : [])], w, [run("  ")], 2));
  }
  if (!d.equipment.length) rows.push([run("Nothing. Travelling light, or robbed.", C.faint, { italic: true })]);
  return rows;
}

function carryingSection(d: SheetData, w: number): Row[] {
  const rows = [rule("Carrying", w)];
  for (const t of d.carrying) rows.push(...flow([[run(`${t.quantity > 1 ? `${t.quantity} ` : ""}${t.name}`, C.text)], ...(t.in ? [[run(`in ${t.in}`, C.faint)]] : [])], w, [run(", ", C.faint)], 2));
  return rows;
}

function purseSection(d: SheetData, w: number): Row[] {
  if (!d.purse.length) return [rule("Purse", w), [run("Not a penny.", C.faint, { italic: true })]];
  return [
    rule("Purse", w),
    ...flow(d.purse.map(c => [run(String(c.quantity), C.lead, { bold: true }), run(` ${c.name}`, C.text)]), w, [run(" · ", C.faint)]),
    ...prose("Twelve pennies to the shilling, five shillings to the crown.", w, C.faint, { italic: true }),
  ];
}

function knowsSection(d: SheetData, w: number): Row[] {
  const line = (label: string, items: string[], none: string) => labelled([run(`${label} `, C.dim)], items.length ? items.map(i => [run(i, C.text)]) : [[run(none, C.faint)]], w, [run(", ", C.faint)]);
  return [
    rule("Proficiencies", w),
    ...line("Armour", d.proficiencies.armor, "none"),
    ...line("Weapons", d.proficiencies.weapons, "none"),
    ...line("Tools", d.proficiencies.tools, "none"),
    ...line("Languages", d.languages, "none"),
  ];
}

/** What their backstory says of them: personality, ideals, bonds and flaws, each a label and its lines. */
function whoSection(d: SheetData, w: number): Row[] {
  const s = d.story!;
  const rows: Row[] = [rule("Who they are", w)];
  for (const [label, items] of [["Personality", s.personality], ["Ideals", s.ideals], ["Bonds", s.bonds], ["Flaws", s.flaws]] as const) {
    if (!items.length) continue;
    rows.push([run(label, C.lead, { bold: true })], ...items.flatMap(i => prose(i, w - 2, C.text).map(r => [run("  "), ...r])));
  }
  if (rows.length === 1) rows.push([run("Nothing drawn from it yet.", C.faint, { italic: true })]);
  return rows;
}

/** Their backstory, in their own words: a blank line between paragraphs, and a line break where they made one. */
function backstorySection(d: SheetData, w: number): Row[] {
  const paragraphs = d.story!.backstory.split(/\n\s*\n/).map(p => p.split("\n").map(l => l.trim()).filter(Boolean)).filter(p => p.length);
  return [rule("Backstory", w), ...paragraphs.flatMap((lines, i) => [...(i ? [[] as Row] : []), ...lines.flatMap(l => prose(l, w, C.text))])];
}

// ---------------------------------------------------------------------------------------------
// Pages.

interface Group { title: string; head?: boolean; sections: Array<(w: number) => Row[]> }

function groups(d: SheetData): Group[] {
  return [
    { title: "Character", head: true, sections: [] },
    { title: "Skills", sections: [w => skillsSection(d, w)] },
    { title: "Combat", sections: [w => attacksSection(d, w), w => featuresSection(d, w), w => featsSection(d, w), w => traitsSection(d, w)] },
    ...(d.spellcasting ? [{ title: "Spells", sections: [(w: number) => spellsSection(d, w)] }] : []),
    { title: "Gear", sections: [w => equipmentSection(d, w), ...(d.carrying.length ? [(w: number) => carryingSection(d, w)] : []), w => purseSection(d, w), w => knowsSection(d, w)] },
    // Their backstory (from character creation), when they wrote one.
    ...(d.story ? [{ title: "Story", sections: [(w: number) => whoSection(d, w), (w: number) => backstorySection(d, w)] }] : []),
  ];
}

/** Sections in balanced columns, in reading order (down the first column, then the next). */
function columns(sections: Array<(w: number) => Row[]>, w: number, most = Infinity): Row[] {
  const n = Math.max(1, Math.min(sections.length, most, Math.floor((w + GAP) / (MIN_COL + GAP))));
  const cw = Math.floor((w - GAP * (n - 1)) / n);
  const blocks = sections.map(s => s(cw));
  if (n === 1) return blocks.flatMap((b, i) => [...(i ? [[]] : []), ...b]);
  // The shortest height the sections fit into, n columns of them in order.
  const pack = (limit: number) => {
    const cols: Row[][] = [[]];
    for (const b of blocks) {
      const col = cols.at(-1)!;
      if (col.length && col.length + 1 + b.length > limit) cols.push([...b]);
      else col.push(...(col.length ? [[] as Row] : []), ...b);
    }
    return cols;
  };
  let limit = Math.max(...blocks.map(b => b.length));
  while (pack(limit).length > n) limit++;
  const packed = pack(limit);
  // A column to spare: fewer, wider columns instead (if they come out no taller).
  if (packed.length < n) {
    const wider = columns(sections, w, packed.length);
    if (wider.length <= limit) return wider;
  }
  return beside(packed.map(rows => ({ rows, w: cw })));
}

/** The head's width when there's room beside it for more. */
const HEAD_W = PORTRAIT_W + 2 + 52;

function layout(d: SheetData, gs: Group[], w: number): Row[] {
  const sections = gs.flatMap(g => g.sections);
  if (!gs.some(g => g.head)) return columns(sections, w);
  // Wide: the first sections beside the head, as long as they don't run on much below it.
  const sideW = w - HEAD_W - GAP;
  if (sideW >= MIN_COL && sections.length) {
    const head = header(d, HEAD_W);
    const side: Row[] = [];
    let used = 0;
    for (const section of sections) {
      const block = section(sideW);
      if (side.length + (side.length ? 1 : 0) + block.length > head.length + 4) break;
      side.push(...(side.length ? [[] as Row] : []), ...block);
      used++;
    }
    if (used) {
      const top = beside([{ rows: head, w: HEAD_W }, { rows: side, w: sideW }]);
      return used < sections.length ? [...top, [], ...columns(sections.slice(used), w)] : top;
    }
  }
  const head = header(d, w);
  return sections.length ? [...head, [], ...columns(sections, w)] : head;
}

/**
 * The sheet for w by h cells: one page when it all fits; otherwise pages of whole groups
 * (Character, Skills, Combat, Spells, Gear), as many to a page as fit, with a row kept for the
 * tabs (kept anyway with `bar`: a close button lives there). A page that still doesn't fit
 * scrolls, and is laid out two cells narrower for its scroll bar.
 */
export function sheetPages(d: SheetData | undefined, who: Who, w: number, h: number, options: { bar?: boolean } = {}): SheetPage[] {
  const room = h - 1;
  if (!d) return [{ title: "Sheet", rows: unsheeted(who, w) }];
  const gs = groups(d);
  const all = layout(d, gs, w);
  if (all.length <= (options.bar ? room : h)) return [{ title: "Sheet", rows: all }];
  const pages: Group[][] = [];
  let cur: Group[] = [];
  for (const g of gs) {
    if (cur.length && layout(d, [...cur, g], w).length > room) { pages.push(cur); cur = [g]; }
    else cur = [...cur, g];
  }
  pages.push(cur);
  return pages.map(p => {
    const rows = layout(d, p, w);
    const title = p.map(g => g.title).join(" · ");
    return rows.length > room ? { title, rows: layout(d, p, w - 2), scrolls: true } : { title, rows };
  });
}

/**
 * The rows SheetView needs to show the sheet in at most h: its tallest page, the bar over it (pages
 * or a close button) and the key hints under it. A box can shrink to fit the sheet with it.
 */
export function sheetHeight(d: SheetData | undefined, who: Who, w: number, h: number, options: { bar?: boolean } = {}): number {
  const pages = sheetPages(d, who, w, h - 1, options);
  const tallest = Math.max(...pages.map(p => p.rows.length));
  return Math.min(h, tallest + (pages.length > 1 || options.bar ? 1 : 0) + 1);
}

// ---------------------------------------------------------------------------------------------
// A spell, picked.

/** The spells on a page in reading order, by id: what ↑↓ step through. */
export function spellsOn(rows: Row[]): string[] {
  const out: string[] = [];
  for (const row of rows) for (const r of row) if (r.spell && !out.includes(r.spell)) out.push(r.spell);
  return out;
}

/** The row a spell is on (-1 if it isn't on the page). */
export const rowOf = (rows: Row[], spell: string) => rows.findIndex(row => row.some(r => r.spell === spell));

/** A spell's details on the sheet, by id. */
export const spellOn = (d: SheetData | undefined, id: string): SpellDetails | undefined => d?.spellcasting?.spells.flatMap(g => g.spells).find(s => s.id === id)?.details;

/** The SRD's emphasis (**bold**, _italic_, or both) as runs in a colour. */
function marked(text: string, fg: string): Run[] {
  const out: Run[] = [];
  let bold = false, italic = false, buf = "";
  const flush = () => {
    if (buf) out.push(run(buf, fg, { ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) }));
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("**", i)) { flush(); bold = !bold; i++; continue; }
    // An underscore opens at the start of a word and closes at its end.
    if (text[i] === "_" && !/\w/.test((italic ? text[i + 1] : text[i - 1]) ?? "")) { flush(); italic = !italic; continue; }
    buf += text[i];
  }
  flush();
  return out;
}

/** Runs as words to flow: each word's runs stay together (a word can change style partway: "_Shield_."). */
function words(runs: Run[]): Row[] {
  const out: Row[] = [[]];
  for (const r of runs) {
    for (const part of r.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { if (out.at(-1)!.length) out.push([]); continue; }
      out.at(-1)!.push({ ...r, text: part });
    }
  }
  return out.filter(w => w.length);
}

/** A paragraph of the SRD's, wrapped; its lead-in ("_Cantrip Upgrade._", "**Audible Alarm.**") stands out. */
function paragraph(text: string, w: number, indent = 0): Row[] {
  const runs = marked(text, C.text);
  const first = runs[0];
  if (first && (first.bold || first.italic) && /^(\*\*|_)/.test(text) && /[.:]$/.test(first.text.trim())) runs[0] = { ...first, fg: C.title, bold: true };
  return flow(words(runs), w, [run(" ")], indent);
}

/** A table: in columns when they fit; two columns with a short first one, the second wrapped beside it; otherwise a row at a time. */
function table(t: { table: string[][]; head?: boolean; caption?: string }, w: number): Row[] {
  const rows: Row[] = t.caption ? [[run(t.caption, C.title, { bold: true })]] : [];
  const n = Math.max(...t.table.map(r => r.length));
  const plainText = (c: string) => c.replace(/\*\*|_/g, "");
  const widths = Array.from({ length: n }, (_, i) => Math.max(0, ...t.table.map(r => cells(plainText(r[i] ?? "")))));
  const gap = 2;
  const colour = (head: boolean) => (head ? C.dim : C.text);
  if (widths.reduce((a, b) => a + b, 0) + gap * (n - 1) <= w) {
    for (const [y, r] of t.table.entries()) {
      const head = !!t.head && y === 0;
      rows.push(Array.from({ length: n }, (_, i) => [...marked(r[i] ?? "", colour(head)), run(" ".repeat(widths[i]! - cells(plainText(r[i] ?? "")) + (i < n - 1 ? gap : 0)))]).flat());
    }
    return rows;
  }
  if (n === 2 && widths[0]! <= Math.floor(w / 3)) {
    const left = widths[0]! + gap;
    for (const [y, r] of t.table.entries()) {
      const head = !!t.head && y === 0;
      const body = flow(words(marked(r[1] ?? "", colour(head))), w - left);
      body.forEach((line, i) => rows.push([run(i ? " ".repeat(left) : plainText(r[0] ?? "").padEnd(left), head ? C.dim : C.lead), ...line]));
    }
    return rows;
  }
  // A row at a time, its cells apart: "Very familiar · 01–05 · 06–13 · 14–24 · 25–00".
  for (const [y, r] of t.table.entries()) {
    const cellsOf = r.filter(c => c).map((c, i) => words(marked(c, i === 0 || (t.head && y === 0) ? C.dim : C.text)));
    rows.push(...flow(cellsOf.flatMap((ws, i) => (i ? [[run("·", C.faint)], ...ws] : ws)), w, [run(" ")], 2));
  }
  return rows;
}

/**
 * The SRD's description, a block at a time, with a line between paragraphs; a list's items, and a
 * stat block's lines (the creature a spell summons, from its heading on), close together.
 */
function description(blocks: SrdBlock[], w: number): Row[] {
  const rows: Row[] = [];
  let stats = false;
  for (const [i, b] of blocks.entries()) {
    const prev = blocks[i - 1];
    const heading = typeof b === "object" && "heading" in b;
    const listed = typeof b === "object" && "item" in b && !!prev && typeof prev === "object" && "item" in prev;
    if (i && (heading || (!listed && !stats))) rows.push([]);
    stats ||= heading;
    if (typeof b === "string") rows.push(...paragraph(b, w));
    else if ("item" in b) rows.push(...paragraph(b.item, w - 2).map((r, k) => [run(k ? "  " : "• ", C.lead), ...r]));
    else if ("heading" in b) rows.push([run(b.heading, C.title, { bold: true })]);
    else rows.push(...table(b, w));
  }
  return rows;
}

/** A label and its value, wrapped under itself: "Components V, S, M (a ball of bat guano and sulfur)". */
function field(label: string, value: Run[], w: number): Row[] {
  return flow([[run(`${label} `, C.dim), ...(words(value)[0] ?? [])], ...words(value).slice(1)], w, [run(" ")], 2);
}

/**
 * A spell, picked on the sheet, for a box w wide: its name and the SRD's line for it (level, school,
 * classes); its casting time (a ritual's way too, and the SRD's where it's another), range, duration
 * (concentration marked) and components with the material; what it does in this game, at the
 * caster's numbers (the attack or save, the damage and what the engine adds to it, the area, how it
 * grows), and whether a fight on the map offers it; then the SRD's description in its own words,
 * and its attribution statement.
 */
export function spellPage(d: SpellDetails, w: number): Row[] {
  const dot = [run(" · ", C.faint)];
  // The name, then the SRD's line for it (a long list of classes wraps under it).
  const rows: Row[] = flow([[run(d.name, C.title, { bold: true }), run(" ")], ...words([run(d.levelLine, C.dim)])], w, [run(" ")], 2);
  const c = d.components;
  const parts = [...(c.verbal ? ["V"] : []), ...(c.somatic ? ["S"] : []), ...(c.material ? [`M (${c.material})`] : [])];
  const conc = d.concentration && /^concentration/i.test(d.duration);
  const card: Array<[string, Run[]]> = [
    ["Casting time", [run(d.castingTime, C.text), ...(d.srdCastingTime ? [run(` (the SRD's: ${d.srdCastingTime})`, C.dim)] : []), ...(d.ritual ? [run(", or as a ritual (10 minutes longer, no slot)", C.lead)] : [])]],
    ["Range", [run(d.range, C.text)]],
    ["Duration", conc ? [run("Concentration", C.warn), run(d.duration.slice("Concentration".length), C.text)] : [run(d.duration, C.text)]],
    ["Components", [run(parts.join(", ") || "none", C.text)]],
  ];
  // Side by side while they fit on a line, each on its own when it's long.
  let line: Row[] = [];
  const done = () => { if (line.length) rows.push(...flow(line, w, dot)); line = []; };
  for (const [label, value] of card) {
    const chip = [run(`${label} `, C.dim), ...value];
    if (widthOf(chip) <= w && !(label === "Components" && c.material)) line.push(chip);
    else { done(); rows.push(...field(label, value, w)); }
  }
  done();

  rows.push(rule("In this game", w));
  const terms = [...d.does, ...(d.area ? [`Area: ${d.area}`] : []), ...d.scaling];
  for (const t of terms) rows.push(...flow(words([run(t, C.text)]), w, [run(" ")], 2));
  if (!d.does.length) rows.push(...prose(`No rolls: it does what it says${d.text ? " below" : ""}, as the GM plays it.`, w, C.dim, { italic: true }));
  if (!d.inFights) rows.push(...prose("Not in a fight on the map: cast it in a scene.", w, C.dim, { italic: true }));

  if (d.text?.length) {
    const tag = [run(" CC BY 4.0", C.faint)];
    const head = [run("From the SRD 5.2.1", C.title, { bold: true })];
    const rest = w - widthOf(head) - widthOf(tag) - 1;
    rows.push([], rest > 0 ? [...head, run(` ${"─".repeat(rest)}`, C.border), ...tag] : rule("From the SRD 5.2.1", w), ...description(d.text, w));
    if (d.credit) rows.push([], ...prose(d.credit, w, C.faint));
  }
  return rows.map(r => (widthOf(r) > w ? fit(r, w) : r));
}

/** A session without a rules sheet (from before the engine, or one it couldn't make): a name, a concept, and an apology. */
function unsheeted(who: Who, w: number): Row[] {
  const iw = Math.max(20, w - PORTRAIT_W - 2);
  const info = [
    [run(who.name, C.title, { bold: true })],
    ...prose(who.concept, iw, C.faint, { italic: true }),
    [],
    ...prose("No D&D character sheet: the rules engine had nothing to say about this one, so they get by on charm and the GM's good will.", iw, C.dim),
  ];
  return w >= PORTRAIT_W + 22 ? beside([{ rows: portrait(undefined), w: PORTRAIT_W }, { rows: info, w: iw }], 2) : info;
}
