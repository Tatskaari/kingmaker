import type { LoreIssue } from "../../lore/backstory.ts";
import type { BuildOption } from "../../rules/builds.ts";
import { C } from "../theme.ts";
import { fit, flow, prose, run, widthOf, type Row } from "./sheet-layout.ts";

/**
 * Character creation's screens, laid out as styled rows (pure, as the sheet's are: the checks read
 * them as they are): a build's card (who they'd be, how they'd play, the numbers that matter), the
 * player's own build in a line or two, the backstory with the words a lore issue is about marked,
 * and what the lore check says of an issue.
 */

/**
 * What the lore check says of an issue, in at most `room` rows w wide: the story's words, what the
 * world says, and the fix, which Accept puts in, so it's what's kept whole when room is short (the
 * quote, lit in the story too, gives way first, then the problem, each to a row). `whole`: the fix
 * is all there; when it can't be (a fix longer than the room), Accept waits for a bigger screen.
 * `fixLabel` is how the fix is introduced ("A fix that keeps its spirit", or, rewriting, "It suggested").
 */
export function issueRows(issue: LoreIssue, w: number, room: number, fixLabel = "A fix that keeps its spirit"): { rows: Row[]; whole: boolean } {
  const says = `Your story says: "${issue.quote ?? "(the GM couldn't point at the words)"}"`, problem = `The world says: ${issue.problem}`, fix = `${fixLabel}: "${issue.fix}"`;
  const all = { quote: prose(says, w, C.text), problem: prose(problem, w, C.warn), fix: prose(fix, w, C.good) };
  room = Math.max(3, room);
  if (all.quote.length + all.problem.length + all.fix.length <= room) return { rows: [...all.quote, ...all.problem, ...all.fix], whole: true };
  if (all.fix.length > room - 2) return { rows: [...prose(says, w, C.text, {}, 1), ...prose(problem, w, C.warn, {}, 1), ...prose(fix, w, C.good, {}, room - 2)], whole: false };
  const left = room - all.fix.length;
  const problemRows = Math.max(1, Math.min(all.problem.length, left - 1));
  const quoteRows = Math.max(1, Math.min(all.quote.length, left - problemRows));
  return { rows: [...prose(says, w, C.text, {}, quoteRows), ...prose(problem, w, C.warn, {}, problemRows), ...all.fix], whole: true };
}

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

/**
 * The player's own build in a few rows w wide: who, the numbers in a run (a caster's spells first,
 * with their DC, then the attack and the features), a caster's spells by name, how it plays.
 */
export function ownRows(o: BuildOption, w: number, h: number): Row[] {
  const t = buildTitle(o), c = o.card;
  const attack = c.attack ? [[run(c.attack.name, C.text, { bold: true }), run(` ${signed(c.attack.bonus)}`, C.lead, { bold: true }), run(` ${c.attack.damage} ${c.attack.type}`, C.dim)]] : [];
  const casting = c.casting ? [[run("Spells", C.text, { bold: true }), run(" "), ...chip("DC", String(c.casting.saveDC)), run(` ${signed(c.casting.attackBonus)}`, C.text, { bold: true })]] : [];
  const caster = CASTERS.has(c.className);
  const atoms: Row[] = [
    chip("HP", String(c.hp)), chip("AC", String(c.ac)), [run(`${c.speed} ft`, C.dim)],
    ...(caster ? [...casting, ...attack] : [...attack, ...casting]),
    ...c.features.map(f => [run(f, C.lead)]),
  ];
  const head = flow([[run(t.name, C.title, { bold: true })], ...(t.more ? [[run(t.more, C.dim)]] : [])], w, dot());
  const nums = flow(atoms, w, dot());
  const plays = prose(o.plays, w, C.text, { italic: true });
  const numRoom = Math.max(1, h - head.length - (c.casting ? 1 : 0) - Math.min(1, plays.length));
  const shownNums = nums.slice(0, numRoom);
  // A caster's spells by name, the cantrips first (what they'd be casting): two rows at most, in what's left.
  const spellRoom = Math.min(2, Math.max(1, h - head.length - shownNums.length - Math.min(1, plays.length)));
  const spells = c.casting ? prose([...c.casting.cantrips, ...c.casting.spells].join(", "), w, C.dim, {}, spellRoom) : [];
  const rows: Row[] = [...head, ...shownNums, ...spells, ...plays];
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
