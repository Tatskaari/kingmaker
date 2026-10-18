// New (M6's screen, docs/combat-design.md §3): a moment as the screen plays it, beat by beat: the steps of a walk a tile at a time, a blow's flash, a shot or a bolt crossing the floor, an area lighting up, what it did to whoever it reached (a hit, a miss, a save, a condition, a push), and each fall; each beat timed by the shared pace table's parts (shared/fight/pace.ts partsOf), so the screen's playback and the simulation's spacing agree. The headless client prints the same beats as lines (scriptLines).
import { PACE, partsOf } from "../../shared/fight/pace.ts";
import type { FightEvent, UnitState } from "../../shared/fight/types.ts";
import type { Tile2 } from "../../shared/map/types.ts";

/** One thing a moment shows on screen, from `t` ms into the moment, for `ms`. */
export type Beat = { t: number; ms: number } & (
  | { kind: "order" }
  | { kind: "pause" }
  | { kind: "turn"; unit: string }
  | { kind: "step"; unit: string; to: Tile2; n: number }
  | { kind: "swing"; by: string; target?: string; to: Tile2; with: string }
  | { kind: "shot"; by: string; target?: string; to: Tile2; with: string }
  | { kind: "bolt"; by: string; target?: string; to: Tile2; spell: string; element?: string }
  | { kind: "area"; by: string; to: Tile2; tiles: Tile2[]; spell: string; element?: string }
  | { kind: "hit"; unit: string; amount: number; type?: string; critical: boolean }
  | { kind: "heal"; unit: string; amount: number }
  | { kind: "miss"; unit: string; word: "miss" | "parried" }
  | { kind: "save"; unit: string; saved: boolean }
  | { kind: "tag"; unit: string; condition: string; gained: boolean }
  | { kind: "push"; unit: string; to: Tile2 }
  | { kind: "fall"; unit: string; state: UnitState }
  | { kind: "gone"; unit: string; state: UnitState }
  | { kind: "hold" }
);

/** A moment's beats, in the order they play, and how long it takes; and when its turn starts on the bar, and when what it did lands (ms into it). */
export interface Script { beats: Beat[]; ms: number; turnAt?: number; hitAt?: number }

/**
 * How a moment plays (docs/combat-design.md §3's table): the start's order coming up; a turn's beat
 * between combatants, then the bar moving on to them; each tile of a walk; the act (a blow's flash
 * between them, a shot or a bolt crossing to the target, an area's tiles lit); then, all at once, what
 * it did to each of them (damage popping up, healing, a miss or a parry, a save, a condition gained or
 * lost, a push, someone giving up or going); then each fall in turn; and the caption held to its
 * least time. Every beat's time is the pace table's, part by part.
 */
export function scriptOf(e: Pick<FightEvent, "kind" | "actor" | "target" | "turn" | "detail">): Script {
  const d = e.detail;
  const parts = partsOf(e);
  const beats: Beat[] = [];
  const by = e.actor ?? e.turn;
  const target = e.target ?? d.target ?? d.rolls[0]?.target;
  const to = d.at ?? d.path?.[d.path.length - 1] ?? { x: 0, y: 0 };
  const falls = d.hits.filter(h => h.fell);
  let fall = 0;
  for (const p of parts) {
    switch (p.part) {
      case "start": beats.push({ kind: "order", t: p.t, ms: p.ms }); break;
      case "beat": beats.push({ kind: "pause", t: p.t, ms: p.ms }); break;
      case "turn": beats.push({ kind: "turn", t: p.t, ms: p.ms, unit: by }); break;
      case "steps": (d.path ?? []).forEach((step, i) => beats.push({ kind: "step", t: p.t + i * PACE.tile, ms: PACE.tile, unit: by, to: { ...step }, n: i + 1 })); break;
      case "swing": beats.push({ kind: "swing", t: p.t, ms: p.ms, by, ...(target ? { target } : {}), to, with: d.with ?? d.rolls[0]?.with ?? (e.kind === "wrestle" ? "Shove" : "") }); break;
      case "projectile":
        if (e.kind === "cast") beats.push({ kind: "bolt", t: p.t, ms: p.ms, by, ...(target ? { target } : {}), to, spell: d.with ?? "", ...(d.element ? { element: d.element } : {}) });
        else beats.push({ kind: "shot", t: p.t, ms: p.ms, by, ...(target ? { target } : {}), to, with: d.with ?? d.rolls[0]?.with ?? "" });
        break;
      case "area": beats.push({ kind: "area", t: p.t, ms: p.ms, by, to, tiles: (d.area ?? []).map(t => ({ ...t })), spell: d.with ?? "", ...(d.element ? { element: d.element } : {}) }); break;
      case "hit": beats.push(...outcomes(e, p.t, p.ms)); break;
      case "fall": { const h = falls[fall++]; if (h) beats.push({ kind: "fall", t: p.t, ms: p.ms, unit: h.unit, state: h.state }); break; }
      case "hold": beats.push({ kind: "hold", t: p.t, ms: p.ms }); break;
    }
  }
  const last = parts[parts.length - 1];
  const turnAt = parts.find(p => p.part === "turn")?.t, hitAt = parts.find(p => p.part === "hit")?.t;
  return { beats, ms: last ? last.t + last.ms : PACE.caption, ...(turnAt !== undefined ? { turnAt } : {}), ...(hitAt !== undefined ? { hitAt } : {}) };
}

/**
 * What a moment did to whoever it reached, all from the same instant: each hit's damage (a critical
 * if a roll at them was one), healing, a save, conditions gained and lost, a push; a roll at someone
 * that did them no harm, a miss (or a parry); and anyone who gave up or went in it.
 */
function outcomes(e: Pick<FightEvent, "kind" | "actor" | "detail">, t: number, ms: number): Beat[] {
  const d = e.detail;
  const out: Beat[] = [];
  for (const h of d.hits) {
    const amount = h.damage.reduce((n, x) => n + x.amount, 0);
    const critical = d.rolls.some(r => r.target === h.unit && r.critical);
    if (amount > 0) out.push({ kind: "hit", t, ms, unit: h.unit, amount, ...(h.damage[0] ? { type: h.damage[0].type } : {}), critical });
    if (h.healed > 0) out.push({ kind: "heal", t, ms, unit: h.unit, amount: h.healed });
    if (h.saved !== undefined) out.push({ kind: "save", t, ms, unit: h.unit, saved: h.saved });
    // Out cold as they fall goes without saying (the fall says it).
    for (const c of h.gained) if (!(c === "unconscious" && h.fell)) out.push({ kind: "tag", t, ms, unit: h.unit, condition: c, gained: true });
    for (const c of h.lost) out.push({ kind: "tag", t, ms, unit: h.unit, condition: c, gained: false });
    if (h.movedTo) out.push({ kind: "push", t, ms, unit: h.unit, to: { ...h.movedTo } });
    if (!h.fell && (h.state === "fled" || h.state === "surrendered") && h.was?.state !== h.state) out.push({ kind: "gone", t, ms, unit: h.unit, state: h.state });
  }
  // A roll at someone that did them no harm: a miss, or a parry.
  const harmed = new Set(d.hits.filter(h => h.damage.length).map(h => h.unit));
  for (const r of d.rolls) {
    if (harmed.has(r.target) || out.some(b => b.kind === "miss" && b.unit === r.target)) continue;
    if (!r.hit || r.parried) out.push({ kind: "miss", t, ms, unit: r.target, word: r.parried ? "parried" : "miss" });
  }
  return out;
}

/** Someone's name in a line: what the moment's board calls them. */
type NameOf = (id: string) => string;

/**
 * A moment's beats as one line for the headless client (the screen's playback, read): the walk with
 * its tiles, the act, and what it did, in the order they play. Nothing for a moment that only says
 * something (a turn, a dodge, a remark): its caption says it all.
 */
export function scriptLine(e: Pick<FightEvent, "kind" | "actor" | "target" | "turn" | "detail">, name: NameOf): string | undefined {
  const parts: string[] = [];
  const steps: Tile2[] = [];
  // A verb for whoever it is: "you save", "the wolf saves".
  const v = (id: string, you: string, them: string) => `${name(id)} ${name(id) === "you" ? you : them}`;
  for (const b of scriptOf(e).beats) {
    switch (b.kind) {
      case "step": steps.push(b.to); break;
      case "swing": parts.push(`${b.with ? `${b.with.toLowerCase()} ` : ""}swing at ${b.target ? name(b.target) : tile(b.to)}`); break;
      case "shot": parts.push(`${b.with ? `${b.with.toLowerCase()} ` : ""}shot at ${b.target ? name(b.target) : tile(b.to)}`); break;
      case "bolt": parts.push(`${b.spell || "a spell"} flies at ${b.target ? name(b.target) : tile(b.to)}${b.element ? ` (${b.element})` : ""}`); break;
      case "area": parts.push(`${b.spell || "a spell"} lights ${b.tiles.length} tiles round ${tile(b.to)}${b.element ? ` (${b.element})` : ""}`); break;
      case "hit": parts.push(`${name(b.unit)} hit: ${b.amount}${b.type ? ` ${b.type}` : ""}${b.critical ? ", critical" : ""}`); break;
      case "heal": parts.push(`${name(b.unit)} +${b.amount} HP`); break;
      case "miss": parts.push(`${name(b.unit)}: ${b.word}`); break;
      case "save": parts.push(b.saved ? v(b.unit, "save", "saves") : v(b.unit, "fail the save", "fails the save")); break;
      case "tag": parts.push(`${name(b.unit)} ${b.gained ? "now" : "no longer"} ${b.condition === "unconscious" ? "asleep" : b.condition}`); break;
      case "push": parts.push(`${name(b.unit)} pushed to ${tile(b.to)}`); break;
      case "fall": parts.push(b.state === "dead" ? v(b.unit, "die", "dies") : v(b.unit, "go down", "goes down")); break;
      case "gone": parts.push(b.state === "fled" ? v(b.unit, "are gone", "is gone") : v(b.unit, "give up", "gives up")); break;
      default: break;
    }
  }
  if (steps.length) parts.unshift(`walks ${[e.detail.from, ...steps].filter((t): t is Tile2 => !!t).map(tile).join(" → ")}`);
  return parts.length ? `▸ ${parts.join(" · ")}` : undefined;
}

const tile = (t: Tile2) => `${t.x},${t.y}`;

/**
 * A moment's lines under its caption, less what the caption says already: the caption itself, and
 * a line the caption only adds to ("You go out through the gate." under "You go out through the gate
 * and are gone.").
 */
export function linesUnder(e: Pick<FightEvent, "caption" | "detail">): string[] {
  const said = e.caption.replace(/[.!]$/, "");
  return e.detail.lines.filter(l => { const line = l.replace(/[.!]$/, ""); return l !== e.caption && !(line.length > 12 && said.startsWith(line)); });
}
