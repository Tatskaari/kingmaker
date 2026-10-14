import type { Span } from "../../game/types.ts";
import type { SheetData } from "../../rules/dnd.ts";
import { C } from "../theme.ts";
import { PORTRAIT_W, portraitCaption, portraitLines } from "./portraits.ts";

/**
 * The character sheet, laid out: the class's portrait beside who they are and how they stand (hit
 * points, armour, the six abilities in boxes), then saves and skills, attacks, features and their
 * uses, spells and their slots, and what they carry. sheetPages lays it out for a size as styled
 * rows, a page at a time when the whole sheet doesn't fit (pure: the tests and pictures use it as
 * is); SheetView (sheet.tsx) shows them.
 */

/** A run of text in one style: a StyledLine span that can also be italic. */
export type Run = Span & { italic?: boolean };
export type Row = Run[];
export interface SheetPage { title: string; rows: Row[]; scrolls?: boolean }
/** Who they are, for a session without a rules sheet. */
export interface Who { name: string; concept: string }

/** Columns narrower than this don't get used; sections lay themselves out for whatever they get above it. */
const MIN_COL = 34;
const GAP = 3;

const cells = (t: string) => [...t].length;
const widthOf = (row: Row) => row.reduce((n, r) => n + cells(r.text), 0);
const run = (text: string, fg?: string, style: Omit<Run, "text" | "fg"> = {}): Run => ({ text, ...(fg ? { fg } : {}), ...style });
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const ordinal = (n: number) => ["Cantrips", "1st", "2nd", "3rd"][n] ?? `${n}th`;

/** A row cut (with an ellipsis) or padded to exactly w cells. */
function fit(row: Row, w: number): Row {
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
function flow(atoms: Row[], w: number, sep: Row = [run(" ")], indent = 0): Row[] {
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
function prose(text: string, w: number, fg: string, style: Omit<Run, "text" | "fg"> = {}, max = Infinity): Row[] {
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
    const atoms = spells.map(sp => [
      run(sp.name, !sp.ready ? C.faint : sp.always ? C.lead : C.text),
      ...(sp.concentration ? [run(" (C)", C.faint)] : []),
      ...(sp.ritual ? [run(" (R)", C.faint)] : []),
    ]);
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
