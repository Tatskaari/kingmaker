import type { BuildOption } from "../../rules/builds.ts";
import { C } from "../theme.ts";
import { fit, flow, prose, run, widthOf, type Row } from "./sheet-layout.ts";

/**
 * Character creation's screens, laid out as styled rows (pure, as the sheet's are: the checks read
 * them as they are): a build's card (who they'd be, how they'd play, the numbers that matter), the
 * player's own build in a line or two, and the backstory with the words a lore issue is about marked.
 */

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const dot = (): Row => [run(" · ", C.faint)];
const chip = (label: string, value: string): Row => [run(`${label} `, C.dim), run(value, C.text, { bold: true })];

/** The full casters, whose spells are what matters on a card (the rest hit things first). */
const CASTERS = new Set(["Bard", "Cleric", "Druid", "Sorcerer", "Warlock", "Wizard"]);

/** Who the build makes them: "Halfling Rogue 3", then "Thief · Criminal". */
export function buildTitle(o: BuildOption): { name: string; more: string } {
  const c = o.card;
  return { name: `${c.species} ${c.className} ${c.level}`, more: [c.subclass, c.background].filter(Boolean).join(" · ") };
}

/** The first of some ways to say a thing that fits w (the last, cut, if none does). */
function first(rows: Row[], w: number): Row {
  return rows.find(r => widthOf(r) <= w) ?? fit(rows.at(-1)!, w);
}

/** The numbers that matter, as rows w wide: HP, AC, speed; the weapon or the spells first, by what the class does first; the features. */
function numbers(o: BuildOption, w: number, room: number): Row[] {
  const c = o.card;
  const rows: Row[] = [first([
    [...chip("HP", String(c.hp)), ...dot(), ...chip("AC", String(c.ac)), ...dot(), ...chip("Speed", `${c.speed} ft`)],
    [...chip("HP", String(c.hp)), ...dot(), ...chip("AC", String(c.ac)), ...dot(), run(`${c.speed} ft`, C.dim)],
    [...chip("HP", String(c.hp)), run(" "), ...chip("AC", String(c.ac))],
  ], w)];
  const weapon = c.attack ? [run(c.attack.name, C.text, { bold: true }), run(` ${signed(c.attack.bonus)}`, C.lead, { bold: true })] : [];
  const attack = c.attack ? [first([[...weapon, run(`  ${c.attack.damage} ${c.attack.type}`, C.dim)], [...weapon, run(` ${c.attack.damage}`, C.dim)], weapon], w)] : [];
  const spells = c.casting ? [
    first([[run("Spells", C.text, { bold: true }), ...dot(), ...chip("DC", String(c.casting.saveDC)), ...dot(), ...chip("attack", signed(c.casting.attackBonus))],
      [run("Spells", C.text, { bold: true }), run(" "), ...chip("DC", String(c.casting.saveDC)), run(" "), run(signed(c.casting.attackBonus), C.text, { bold: true })]], w),
    ...prose(c.casting.cantrips.join(", "), w, C.dim, {}, 1),
    ...prose(c.casting.spells.join(", "), w, C.text, {}, room > 12 ? 2 : 1),
  ] : [];
  rows.push(...(CASTERS.has(c.className) ? [...spells, ...attack] : [...attack, ...spells]));
  if (c.features.length) rows.push(...flow(c.features.map(f => [run(f, C.lead)]), w, dot()));
  return rows;
}

/**
 * A build's card, inside its border: who they'd be, how they'd play (in their own line), and the
 * numbers that matter; in at most h rows w wide (how they'd play gives way first, then the skills).
 */
export function cardRows(o: BuildOption, w: number, h: number): Row[] {
  const t = buildTitle(o);
  const head: Row[] = [...prose(t.name, w, C.title, { bold: true }, 2), ...prose(t.more, w, C.dim, {}, 2)];
  const skills = o.card.skills.length ? prose(o.card.skills.join(", "), w, C.faint, { italic: true }, 2) : [];
  // How they'd play gets three rows (or what it needs) before the numbers' last rows (the features) give way.
  const whole = prose(o.plays, w, C.text, { italic: true });
  let nums = numbers(o, w, h);
  while (nums.length > 2 && head.length + Math.min(3, whole.length) + nums.length + 2 > h) nums = nums.slice(0, -1);
  const playsRoom = Math.max(1, h - head.length - nums.length - 2);
  const plays = prose(o.plays, w, C.text, { italic: true }, playsRoom);
  const rows = [...head, [], ...plays, [], ...nums];
  // The skills, when there's room for them too.
  if (skills.length && rows.length + 1 + skills.length <= h) rows.push([], ...skills);
  return rows.slice(0, h).map(r => (widthOf(r) > w ? fit(r, w) : r));
}

/** The player's own build in a few rows w wide: who, the numbers in a run (the attack, the spells, the features), how it plays. */
export function ownRows(o: BuildOption, w: number, h: number): Row[] {
  const t = buildTitle(o), c = o.card;
  const atoms: Row[] = [
    chip("HP", String(c.hp)), chip("AC", String(c.ac)), [run(`${c.speed} ft`, C.dim)],
    ...(c.attack ? [[run(c.attack.name, C.text, { bold: true }), run(` ${signed(c.attack.bonus)}`, C.lead, { bold: true }), run(` ${c.attack.damage} ${c.attack.type}`, C.dim)]] : []),
    ...(c.casting ? [[run("Spells", C.text, { bold: true }), run(" "), ...chip("DC", String(c.casting.saveDC)), run(` ${signed(c.casting.attackBonus)}`, C.text, { bold: true })]] : []),
    ...c.features.map(f => [run(f, C.lead)]),
  ];
  const head = flow([[run(t.name, C.title, { bold: true })], ...(t.more ? [[run(t.more, C.dim)]] : [])], w, dot());
  const nums = flow(atoms, w, dot());
  const plays = prose(o.plays, w, C.text, { italic: true });
  const numRoom = Math.max(1, h - head.length - Math.min(1, plays.length));
  const rows: Row[] = [...head, ...nums.slice(0, numRoom), ...plays];
  return rows.slice(0, h).map(r => (widthOf(r) > w ? fit(r, w) : r));
}

/**
 * The backstory, wrapped to w by words (a paragraph a line of it), with the words between
 * mark.start and mark.end (a lore issue's quote) picked out. A word longer than a row is broken.
 */
export function storyRows(text: string, w: number, mark?: { start: number; end: number }): Row[] {
  const rows: Row[] = [];
  const inMark = (i: number) => !!mark && i >= mark.start && i < mark.end;
  const style = (i: number) => (inMark(i) ? { fg: C.text, bg: C.leadBg, bold: true } : { fg: C.text });
  /** Characters as runs, each run one style. */
  const runsOf = (from: number, to: number): Row => {
    const out: Row = [];
    for (let i = from; i < to; i++) {
      const s = style(i);
      const last = out.at(-1);
      if (last && last.bg === s.bg) last.text += text[i];
      else out.push({ text: text[i]!, ...s });
    }
    return out;
  };
  let offset = 0;
  for (const line of text.split("\n")) {
    let row: Row = [], n = 0;
    for (const m of line.matchAll(/\S+/g)) {
      let at = offset + m.index!, word = m[0];
      if (n && n + 1 + word.length > w) { rows.push(row); row = []; n = 0; }
      if (n) { row.push(...runsOf(at - 1, at)); n++; }
      while (word.length > w - n) {
        const take = Math.max(1, w - n);
        row.push(...runsOf(at, at + take));
        rows.push(row); row = []; n = 0;
        at += take; word = word.slice(take);
      }
      row.push(...runsOf(at, at + word.length));
      n += word.length;
    }
    rows.push(row);
    offset += line.length + 1;
  }
  return rows;
}

/** The row a character of the text is on, as storyRows lays it out (to show a quote in view). */
export function storyRowOf(text: string, w: number, at: number): number {
  const rows = storyRows(text.slice(0, at), w);
  return Math.max(0, rows.length - 1);
}
