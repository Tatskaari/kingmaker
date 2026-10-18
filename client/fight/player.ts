// New (M6's screen, docs/combat-design.md §3): the fight played back on screen, a moment at a time in order, from its rows: each moment the rows bring is scheduled to start once the one before has played (a short beat between combatants), its beats (client/fight/script.ts) moving people a tile at a time, lighting up the struck, tipping the fallen over, and spawning the look layer's effects as they come; what's shown at any instant is a pure function of the clock, so a frame mid-move is exact however it was reached. A key finishes the moment playing, another skips to the player's turn, and with reduced motion each moment shows its end at once with its caption. Each beat sounds as it plays (client/sound/fight.ts), and a moment hurried past stops its sounds with its effects.
import { PACE } from "../../shared/fight/pace.ts";
import type { FightBoard, FightEvent, Unit } from "../../shared/fight/types.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import { Effects } from "../look/effects.ts";
import { blast, bolt, feetOf, healed, hitFlash, said, shot, struck, swing, tagWord, type Stance } from "../look/fight.ts";
import { fightSounds, hushFight } from "../sound/fight.ts";
import { linesUnder, scriptOf, type Script } from "./script.ts";
import { myTurn, type FightView } from "./view.ts";

/** A moment on the playback's clock: its script, when it starts and ends (the clock's ms), and whether it has begun (logged, its effects spawned). */
interface Slot { event: FightEvent; script: Script; start: number; end: number; entered: boolean }

/** A line of the fight's log: a moment that has begun playing, its caption, and its dice and words under it; the GM's words, the moment they follow (`after`). */
export interface LogEntry { seq: number; kind: FightEvent["kind"]; actor?: string; caption: string; lines: string[]; after?: number }

/** What the screen draws at an instant of the playback. */
export interface PlayFrame {
  /** Everyone as they stand at this instant: where, their hit points, how they are, their conditions. */
  stances: Record<string, Stance>;
  /** Whose turn the bar shows, and the round. */
  turn: string;
  round: number;
  /** The caption line: the moment playing, or the last one played; and who did what it says (their mark beside it). */
  caption: string;
  captionBy?: string;
  /** The moment playing, and how far into it (ms). */
  playing?: { event: FightEvent; elapsed: number; ms: number };
  /** Someone falling, and how far into their fall (0 to 1). */
  falling: Record<string, number>;
  /** Someone lit up as a blow lands on them. */
  flash: Record<string, { fg: string; bg: string }>;
  /** How fresh the turn is: 1 as the bar moves on to them, fading over the turn's beat (their tile's light). */
  fresh: number;
  /** The start's order coming up: how many of the bar's portraits are in so far. */
  revealed?: number;
}

export interface PlayerOptions {
  /** Play the fight's moments from its first (a fight seen starting); else start where it is (one already on as the screen comes up). */
  fromStart?: boolean;
  /** Reduced motion: each moment shows its end at once, with its caption, for the caption's least time. */
  reduced?: () => boolean;
}

/**
 * The fight's playback (docs/combat-design.md §3). Everything is on one clock (performance.now()'s,
 * or a test's): `see` schedules the rows' new moments, each starting as the last ends; `frame(now)`
 * says what's on screen at that instant (where everyone stands, hit points as the blows have landed,
 * who's falling, who's lit up, whose turn, the caption), folding the moments that have played into
 * what's shown and spawning each one's effects into `fx` as it begins. Once nothing is left to play,
 * what's shown is the board's own again (the rows are the truth: anything the moments didn't carry
 * comes right there).
 */
export class FightPlayer {
  /** The look layer's effects the moments spawn (blows, shots, bolts, sparks, numbers): the board draws them. */
  readonly fx = new Effects({ now: () => 0 });
  /** The moments that have begun playing, in order: the fight's log. */
  readonly log: LogEntry[] = [];

  private view: FightView;
  private readonly units: Record<string, Unit>;
  /** How everyone stands once the moments played so far are folded in. */
  private base: Record<string, Stance>;
  private turn: string;
  private round: number;
  private caption: string;
  private captionBy: string | undefined;
  private slots: Slot[] = [];
  /** The last moment scheduled. */
  private seen: number;
  /** Skipping to the player's turn: moments come in played already, until it's theirs (or it's over). */
  private skipping = false;
  private readonly reduced: () => boolean;

  constructor(view: FightView, now: number, options: PlayerOptions = {}) {
    this.view = view;
    this.reduced = options.reduced ?? (() => false);
    this.units = { ...view.board.units };
    const first = view.events[0];
    if (options.fromStart && first) {
      this.base = rewind(view.board, view.events);
      this.turn = first.turn;
      this.round = first.round;
      this.caption = "";
      this.seen = 0;
      this.schedule(view.events, now);
    } else {
      this.base = stancesOf(view.board);
      this.turn = view.turn;
      this.round = view.round;
      const last = view.events[view.events.length - 1];
      this.caption = last?.caption ?? "";
      this.captionBy = last?.actor;
      this.seen = last?.seq ?? 0;
      for (const e of view.events) { if (e.kind === "gm") this.placeWords(e); else this.log.push(entryOf(e)); }
    }
  }

  /** The GM's words waiting for the moment they follow to be in the log (docs/combat-gm.md: a telling can come after the next turn's moments). */
  private words: FightEvent[] = [];

  /**
   * The GM's words in the log, after the moment they follow (the turn they tell's last), however late
   * they came; held until that moment has played, when it hasn't yet. They play nothing on the board.
   */
  private placeWords(e: FightEvent): void {
    const after = e.detail.after ?? e.seq - 1;
    if (!this.log.some(l => l.kind !== "gm" && l.seq >= after)) { this.words.push(e); return; }
    // Back from the newest, past what comes after it (the board's later moments, the GM's words for later turns), then in.
    let i = this.log.length - 1;
    while (i >= 0 && (this.log[i]!.kind === "gm" ? (this.log[i]!.after ?? 0) > after : this.log[i]!.seq > after)) i--;
    this.log.splice(i + 1, 0, { ...entryOf(e), after });
  }


  /** The rows moved on: their new moments scheduled, each to start once the one before has played. */
  see(view: FightView, now: number): void {
    this.view = view;
    for (const [id, u] of Object.entries(view.board.units)) this.units[id] = u;
    const fresh = view.events.filter(e => e.seq > this.seen);
    if (fresh.length) this.schedule(fresh, now);
    this.advance(now);
  }

  /** Nothing left to play: what's shown is the rows' own. */
  get caughtUp(): boolean {
    return !this.slots.length;
  }

  /** A moment playing at `now`. */
  busy(now: number): boolean {
    this.advance(now);
    return !!this.slots[0] && this.slots[0].start <= now;
  }

  /** The moment playing ends now, and what comes after it plays on from here. */
  finish(now: number): void {
    this.advance(now);
    const current = this.slots[0];
    if (!current || current.start > now) return;
    this.fx.clear();
    hushFight();
    let at = now;
    for (const slot of this.slots) {
      const ms = slot === current ? 0 : slot.end - slot.start;
      slot.start = Math.max(at, slot === current ? slot.start : at);
      slot.end = slot === current ? now : slot.start + ms;
      at = slot.end;
    }
    this.advance(now);
  }

  /** Everything still to play, played now (its captions in the log); then, skipping on, whatever comes before the player's turn too. */
  skip(now: number): void {
    this.fx.clear();
    hushFight();
    for (const slot of this.slots) { slot.start = Math.min(slot.start, now); slot.end = now; }
    this.skipping = this.view.status === "on" && !myTurn(this.view);
    this.advance(now);
  }

  /** Whether moments still to come before the player's turn are being skipped. */
  get skippingOn(): boolean {
    return this.skipping;
  }

  /**
   * The next instant at which what the screen's words show changes (a moment begins, the bar moves
   * on, a blow lands, someone falls, a moment ends), for a redraw then; undefined with nothing to play.
   */
  nextChange(now: number): number | undefined {
    let next: number | undefined;
    const at = (t: number) => { if (t > now && (next === undefined || t < next)) next = t; };
    this.slots.forEach((slot, i) => {
      at(slot.start);
      at(slot.end);
      if (i > 0) return;
      if (slot.script.turnAt !== undefined) at(slot.start + slot.script.turnAt);
      if (slot.script.hitAt !== undefined) at(slot.start + slot.script.hitAt);
      for (const b of slot.script.beats) if (b.kind === "fall") { at(slot.start + b.t); at(slot.start + b.t + b.ms); }
    });
    return next;
  }

  /** What's on screen at `now`: the moments played folded in, and the one playing as far as it's got. */
  frame(now: number): PlayFrame {
    this.advance(now);
    this.fx.prune(now);
    const stances = clone(this.base);
    const out: PlayFrame = { stances, turn: this.turn, round: this.round, caption: this.caption, ...(this.captionBy ? { captionBy: this.captionBy } : {}), falling: {}, flash: {}, fresh: 0 };
    const slot = this.slots[0];
    if (!slot || slot.start > now) return out;
    const e = slot.event, s = slot.script;
    const elapsed = now - slot.start;
    out.playing = { event: e, elapsed, ms: slot.end - slot.start };
    if (this.reduced() || slot.end <= slot.start) {
      apply(stances, e);
      return e.caption ? { ...out, turn: e.turn || out.turn, round: e.round, caption: e.caption, ...by(e) } : { ...out, turn: e.turn || out.turn, round: e.round };
    }
    const turned = s.turnAt === undefined || elapsed >= s.turnAt;
    if (turned) { out.turn = e.turn || out.turn; out.round = e.round; if (e.caption) Object.assign(out, { caption: e.caption }, by(e)); }
    if (s.turnAt !== undefined && turned) out.fresh = Math.max(0, 1 - (elapsed - s.turnAt) / (PACE.turn * 2));
    const landed = s.hitAt !== undefined && elapsed >= s.hitAt;
    for (const b of s.beats) {
      if (b.t > elapsed) continue;
      const k = (elapsed - b.t) / b.ms;
      switch (b.kind) {
        case "order": out.revealed = Math.min(this.view.order.length, 1 + Math.floor(k * this.view.order.length)); break;
        case "step": { const who = stances[b.unit]; if (who) who.at = { ...b.to }; break; }
        case "hit": { const lit = hitFlash(k); if (lit) out.flash[b.unit] = lit; break; }
        case "fall": { const who = stances[b.unit]; if (who) who.state = b.state; if (k < 1) out.falling[b.unit] = k; break; }
        default: break;
      }
    }
    // What it did lands all at once: hit points, conditions, pushes, anyone giving up or going (a fall
    // waits for its own beat, and so does the out cold that comes with it: till then they're struck, not asleep).
    if (landed) for (const h of e.detail.hits) {
      const who = stances[h.unit];
      if (!who) continue;
      who.hp = h.hp;
      who.maxHp = h.maxHp;
      who.conditions = [...who.conditions.filter(c => !h.lost.includes(c)), ...h.gained.filter(c => !who.conditions.includes(c) && !(h.fell && c === "unconscious"))];
      if (h.movedTo) who.at = { ...h.movedTo };
      if (!h.fell) who.state = h.state;
    }
    return out;
  }

  /** Moments whose time has come begin (logged, their effects spawned); those played to their end are folded into what's shown. */
  private advance(now: number): void {
    while (this.slots.length) {
      const slot = this.slots[0]!;
      if (slot.start > now) break;
      if (!slot.entered) this.enter(slot, now);
      if (slot.end > now) break;
      this.fold(this.slots.shift()!);
    }
    if (!this.slots.length) this.settle();
  }

  private schedule(events: FightEvent[], now: number): void {
    let at = Math.max(now, this.slots.length ? this.slots[this.slots.length - 1]!.end : now);
    for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
      if (e.seq <= this.seen && this.seen > 0) continue;
      // The GM's words play nothing: into the log, after what they tell.
      if (e.kind === "gm") { this.seen = Math.max(this.seen, e.seq); this.placeWords(e); continue; }
      const script = scriptOf(e);
      const ms = this.skipping ? 0 : this.reduced() ? PACE.caption : script.ms;
      this.slots.push({ event: e, script, start: at, end: at + ms, entered: false });
      at += ms;
      this.seen = Math.max(this.seen, e.seq);
    }
  }

  /**
   * A moment begins: into the log, and its beats' effects spawned and sounds played at their times
   * (with reduced motion, only its sting or the player's turn's chime, at once; none for a moment skipped).
   */
  private enter(slot: Slot, now: number): void {
    slot.entered = true;
    this.log.push(entryOf(slot.event));
    const due = this.words.filter(w => (w.detail.after ?? w.seq - 1) <= slot.event.seq);
    if (due.length) { this.words = this.words.filter(w => !due.includes(w)); for (const w of due) this.placeWords(w); }
    if (slot.end <= slot.start) return;
    if (this.reduced()) { fightSounds(slot.script.beats.filter(b => b.kind === "order" || b.kind === "turn"), this.units, () => 0); return; }
    fightSounds(slot.script.beats, this.units, b => slot.start + b.t - now);
    const e = slot.event;
    const path = e.detail.path ?? [];
    const actor = e.actor ?? e.turn;
    // Where someone is as the act lands: the one acting at the end of their walk, everyone else where they stood.
    const where = (id: string): Tile2 => (id === actor && path.length ? path[path.length - 1]! : this.base[id]?.at ?? e.detail.at ?? { x: 0, y: 0 });
    for (const b of slot.script.beats) {
      const when = slot.start + b.t;
      switch (b.kind) {
        case "swing": swing(this.fx, where(b.by), b.to, b.with, when, b.ms); break;
        case "shot": shot(this.fx, where(b.by), b.to, when, b.ms); break;
        case "bolt": bolt(this.fx, where(b.by), b.to, b.element, b.spell, when, b.ms); break;
        case "area": blast(this.fx, where(b.by), b.to, b.tiles, b.element, when, b.ms); break;
        case "hit": struck(this.fx, b.unit, where(b.unit), b.amount, b.type, b.critical, when); break;
        case "heal": healed(this.fx, b.unit, where(b.unit), b.amount, when); break;
        case "miss": said(this.fx, b.unit, b.word, when); break;
        case "save": said(this.fx, b.unit, b.saved ? "saved" : "failed", when + 60, b.saved ? "#9fc8f0" : "#f4a259"); break;
        case "tag": { const w = tagWord(b.condition, b.gained); said(this.fx, b.unit, w.text, when + 160, w.color); break; }
        case "fall": this.fx.effect("poof", { at: feetOf(where(b.unit)), radius: 2 }, when + b.ms * 0.6); break;
        case "gone": if (b.state === "fled") this.fx.effect("poof", { at: feetOf(where(b.unit)), radius: 2 }, when); else said(this.fx, b.unit, "yields", when, "#f4f1e8"); break;
        default: break;
      }
    }
  }

  /** A moment played to its end: what it did is how things stand now. */
  private fold(slot: Slot): void {
    apply(this.base, slot.event);
    if (slot.event.turn) this.turn = slot.event.turn;
    this.round = slot.event.round;
    if (slot.event.caption) { this.caption = slot.event.caption; this.captionBy = slot.event.actor; }
  }

  /** Nothing left to play: how things stand is the board's (the rows are the truth), whose turn and the round the fight row's. */
  private settle(): void {
    this.base = stancesOf(this.view.board);
    if (this.view.turn) this.turn = this.view.turn;
    this.round = this.view.round;
    if (this.skipping && (myTurn(this.view) || this.view.status !== "on")) this.skipping = false;
  }
}

/** How everyone stands on a board. */
export function stancesOf(board: FightBoard): Record<string, Stance> {
  const out: Record<string, Stance> = {};
  for (const u of Object.values(board.units)) out[u.id] = { at: { ...u.at }, hp: u.hp, maxHp: u.maxHp, state: u.state, conditions: [...u.conditions] };
  return out;
}

/** A moment's end, folded into how everyone stands: the walker where their walk ended, then each hit's hit points, state, conditions and push. */
export function apply(stances: Record<string, Stance>, e: FightEvent): void {
  const path = e.detail.path ?? [];
  const actor = e.actor ? stances[e.actor] : undefined;
  if (actor && path.length) actor.at = { ...path[path.length - 1]! };
  for (const h of e.detail.hits) {
    const who = stances[h.unit];
    if (!who) continue;
    who.hp = h.hp;
    who.maxHp = h.maxHp;
    who.state = h.state;
    who.conditions = [...who.conditions.filter(c => !h.lost.includes(c)), ...h.gained.filter(c => !who.conditions.includes(c))];
    if (h.movedTo) who.at = { ...h.movedTo };
  }
}

/**
 * How everyone stood before some moments, from the board after them: each moment undone, last first
 * (a walker back where they set out, each hit's target as it stood as the moment began). Exact from a
 * hit's `was`; a moment written before hits carried it is undone from its damage and healing.
 */
export function rewind(board: FightBoard, events: FightEvent[]): Record<string, Stance> {
  const out = stancesOf(board);
  for (const e of [...events].sort((a, b) => b.seq - a.seq)) {
    for (const h of [...e.detail.hits].reverse()) {
      const who = out[h.unit];
      if (!who) continue;
      if (h.was) {
        who.hp = h.was.hp;
        who.state = h.was.state;
        if (h.movedTo) who.at = { ...h.was.at };
      } else {
        who.hp = Math.min(h.maxHp, Math.max(0, h.hp + h.damage.reduce((n, d) => n + d.amount, 0) - h.healed));
        if (h.fell || h.state === "fled" || h.state === "surrendered") who.state = "fighting";
        if (h.movedTo && e.detail.at) who.at = { ...e.detail.at };
      }
      who.conditions = [...who.conditions.filter(c => !h.gained.includes(c)), ...h.lost.filter(c => !who.conditions.includes(c))];
    }
    const actor = e.actor ? out[e.actor] : undefined;
    if (actor && e.kind === "move" && e.detail.from) actor.at = { ...e.detail.from };
  }
  return out;
}

/** Who did what a moment's caption says: its actor, else nobody's (the caption line's mark is then the plain one). */
const by = (e: FightEvent): { captionBy?: string } => ({ captionBy: e.actor });

const clone = (s: Record<string, Stance>): Record<string, Stance> => Object.fromEntries(Object.entries(s).map(([id, v]) => [id, { ...v, at: { ...v.at }, conditions: [...v.conditions] }]));

/** A moment as a line of the log: its caption, its dice and words under it (not the caption twice). */
const entryOf = (e: FightEvent): LogEntry => ({ seq: e.seq, kind: e.kind, ...(e.actor ? { actor: e.actor } : {}), caption: e.caption, lines: linesUnder(e) });
