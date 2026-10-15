import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import { dnd } from "../../rules/dnd.ts";
import type { SessionState } from "../../runtime/session.ts";
import { areaAt, type SceneWorld } from "../../world/scene-world.ts";
import type { CombatResult, CombatSetup, MapActor, Tile2 } from "../types.ts";
import { FEET, fromKey } from "./grid.ts";
import { decide, freshMemo, type PlayerStyle, type Step } from "./ai.ts";
import { Client, combatGame, type CombatClient } from "./game.ts";
import { listing } from "./flavour.ts";
import type { ActResult, CombatG, CombatView, LogLine, PlayerAction, PlayerOptions, Unit } from "./model.ts";
import { health, Rules, type Kit, type Table } from "./rules.ts";
import { initialState } from "./setup.ts";
import { Skirmish } from "./skirmish.ts";

/**
 * startCombat(setup, session): a fight on the map, as a controller over a boardgame.io headless
 * client. The app (or the QA API) reads view() and options(), makes the player's moves with act(),
 * and calls advance() to let everyone else take their turns; result() says how it ended, for the
 * story, and writes the player's hit points, spell slots and the people's fates back into the
 * session's rules state.
 */

export interface CombatController {
  readonly client: CombatClient;
  /** The story's session the fight is part of (its scene, its people, the player's sheet). */
  readonly session: SessionState;
  /** The fight's state (boardgame.io's G). */
  state(): CombatG;
  /** The board as the rules see it, to read (who can reach whom, what spells there are): act through act(). */
  look(): Skirmish;
  view(): CombatView;
  /** What the player can do now. */
  options(): PlayerOptions;
  /** A player action on their turn. Lines are what it put in the log. */
  act(action: PlayerAction): ActResult;
  /**
   * Everyone else's turns (and the player's, while they're down), until the player can act or it's
   * over, or for at most `turns` turns (1: just the next one, for a UI that paces them).
   */
  advance(onTurn?: (lines: LogLine[]) => void, turns?: number): LogLine[];
  /** It's the player's turn and they can act. */
  playerTurn(): boolean;
  over(): boolean;
  /** How it ended, for the story; the first call writes the rules state back into the session. */
  result(): CombatResult;
  /** The tiles a spell would cover aimed at a tile (for a targeting cursor). */
  area(spell: string, at: Tile2): Tile2[];
  /** What the AI would do for the player now (the demo plays itself with this). */
  suggest(style?: PlayerStyle): PlayerAction;
  /** The player's whole turn played by the AI (the demo; a "let the dice decide" button). */
  autoTurn(style?: PlayerStyle): LogLine[];
  /**
   * Table talk: words said in the fight, and the GM's line on what the rules did. It goes in the
   * fight's log as it's shown (view().log), after what the rules have said so far, and never in
   * the rules' own state: the dice don't hear it.
   */
  note(line: Omit<LogLine, "round">, at?: number): void;
  /** Everything needed to carry on later (JSON). */
  save(): SavedCombat;
}

/** A line of table talk, and where it goes in the fight's log: after its first `at` lines. */
export interface Note { at: number; line: LogLine }

export interface SavedCombat { version: 1; G: CombatG; seed: number; written: boolean; notes?: Note[] }

export async function startCombat(setup: CombatSetup, session: SessionState): Promise<CombatController> {
  const kit = kitFrom(await dnd(), setup.seed);
  const { G, table } = initialState(kit, setup, session);
  G.campaign = kit.E.serializeCampaign(table.campaign);
  return new Controller(G, kit, session, setup.seed, false, []);
}

/** Carry on a saved fight (the engine must have been loaded once in this process: see engineReady). */
export function resumeCombat(saved: SavedCombat, session: SessionState, loaded: Awaited<ReturnType<typeof dnd>>): CombatController {
  return new Controller(saved.G, kitFrom(loaded, saved.seed), session, saved.seed, saved.written, saved.notes ?? []);
}

/** The rules' log with the table talk where it was said. */
export function withNotes(log: LogLine[], notes: Note[]): LogLine[] {
  if (!notes.length) return log;
  const out: LogLine[] = [];
  let n = 0;
  for (let i = 0; i <= log.length; i++) {
    while (n < notes.length && notes[n]!.at <= i) out.push(notes[n++]!.line);
    if (i < log.length) out.push(log[i]!);
  }
  return out;
}

/** Load the rules engine (once per process; resumeCombat needs it). */
export const engineReady = () => dnd();

function kitFrom(loaded: Awaited<ReturnType<typeof dnd>>, seed: number): Kit {
  const { E, pack } = loaded;
  const rng = E.seededRNG(seed) as unknown as { state: number };
  const engine = E.createEngine({ contentPacks: [pack], rng: rng as unknown as Dnd.RNG });
  return { E, engine, rng, plan: engine.plan as unknown as Kit["plan"] };
}

class Controller implements CombatController {
  readonly client: CombatClient;
  private readonly rules: Rules;
  readonly session: SessionState;
  private readonly seed: number;
  private written: boolean;
  private finalResult?: CombatResult;
  private readonly notes: Note[];

  constructor(initial: CombatG, kit: Kit, session: SessionState, seed: number, written: boolean, notes: Note[]) {
    this.rules = new Rules(kit);
    this.session = session;
    this.seed = seed;
    this.written = written;
    this.notes = notes;
    this.client = Client({ game: combatGame(initial, this.rules), numPlayers: initial.order.length, debug: false });
    this.client.start();
  }

  state(): CombatG { return this.client.getState()!.G; }
  look(): Skirmish { return new Skirmish(this.state(), this.rules); }
  over(): boolean { return !!this.state().outcome || !!this.client.getState()?.ctx.gameover; }

  playerTurn(): boolean {
    const G = this.state();
    if (this.over()) return false;
    const s = this.look();
    return G.order[G.active] === G.pc && s.able(s.pc());
  }

  options(): PlayerOptions { return this.look().options(); }

  area(spell: string, at: Tile2): Tile2[] {
    const s = this.look();
    const def = s.t.kit.engine.content.spells.get(spell);
    return def ? s.spellArea(s.pc(), def, at) : [];
  }

  act(action: PlayerAction): ActResult {
    if (this.over()) return { ok: false, error: "The fight is over.", lines: [] };
    if (!this.playerTurn()) return { ok: false, error: "It isn't your turn.", lines: [] };
    return this.dispatch(action);
  }

  /** Make a step as a boardgame.io move (for whoever's turn it is). */
  private dispatch(action: PlayerAction | Step): ActResult {
    const before = this.state().log.length;
    const m = this.client.moves;
    switch (action.kind) {
      case "move": m["move"]!(action.to); break;
      case "attack": m["attack"]!(action.target, action.weapon); break;
      case "reckless": m["reckless"]!(); break;
      case "cast": m["cast"]!(action.spell, action.target, action.at, "slot" in action ? action.slot : undefined); break;
      case "use": m["use"]!(action.prop); break;
      case "wrestle": m["wrestle"]!(action.target, action.how); break;
      case "influence": m["influence"]!(action.target, action.skill, action.urge, action.mood); break;
      case "check": m["check"]!(action.skill, action.dc); break;
      case "dash": case "dodge": case "disengage": case "leave": case "surrender": case "standDown": m[action.kind]!(); break;
      case "arrest": m["arrest"]!(action.target); break;
      case "nerve": m["nerve"]!(action.dc, action.why, action.test); break;
      case "remark": m["remark"]!(action.line); break;
      case "end": m["endTurn"]!(); break;
    }
    const G = this.state();
    const lines = G.log.slice(before);
    return G.error && action.kind !== "end" ? { ok: false, error: G.error, lines } : { ok: true, lines };
  }

  advance(onTurn?: (lines: LogLine[]) => void, turns = 400): LogLine[] {
    const all: LogLine[] = [];
    for (let guard = 0; guard < Math.min(400, turns) && !this.over(); guard++) {
      const G = this.state();
      const id = G.order[G.active]!;
      if (id === G.pc && this.playerTurn()) break;
      const before = G.log.length;
      if (id !== G.pc) this.npcTurn(id);
      if (!this.over()) this.client.moves["endTurn"]!();
      const lines = this.state().log.slice(before);
      all.push(...lines);
      onTurn?.(lines);
    }
    return all;
  }

  private npcTurn(id: string): void {
    const memo = freshMemo();
    for (let i = 0; i < 16 && !this.over(); i++) {
      const G = this.state();
      if (G.order[G.active] !== id) return;
      const s = this.look();
      const u = s.unit(id)!;
      const step = decide(s, u, memo);
      if (step.kind === "end") return;
      const done = this.dispatch(step);
      if (!done.ok) memo.failed.push(`${step.kind}:${done.error}`);
      if (memo.failed.length > 3) return;
    }
  }

  suggest(style?: PlayerStyle): PlayerAction {
    const memo = freshMemo();
    const s = this.look();
    const step = decide(s, s.pc(), memo, style ?? this.style());
    return asPlayerAction(step) ?? { kind: "end" };
  }

  /** How the AI would play this character: a caster at range, or into the thick of it. */
  private style(): PlayerStyle {
    const s = this.look();
    const classes = s.t.char(s.pc().engineId)?.classes.map(c => c.classId) ?? [];
    return classes.some(c => ["wizard", "sorcerer", "warlock"].includes(c)) ? "wizard" : "fighter";
  }

  /** The player's whole turn, played by the AI (the demo). */
  autoTurn(style?: PlayerStyle): LogLine[] {
    style ??= this.style();
    const memo = freshMemo();
    const lines: LogLine[] = [];
    for (let i = 0; i < 12 && this.playerTurn(); i++) {
      const s = this.look();
      const step = decide(s, s.pc(), memo, style);
      if (step.kind === "end" || !asPlayerAction(step)) break;
      const done = this.dispatch(step);
      lines.push(...done.lines);
      if (!done.ok) { memo.failed.push(`${step.kind}:${done.error}`); if (memo.failed.length > 2) break; }
    }
    if (this.playerTurn()) lines.push(...this.dispatch({ kind: "end" }).lines);
    return lines;
  }

  view(): CombatView {
    const G = this.state();
    const s = this.look();
    const pc = s.pc();
    const active = s.activeUnit();
    const use = s.usage(pc);
    const me = s.t.char(pc.engineId);
    const units = Object.values(G.units);
    const actors: MapActor[] = [
      ...Object.values(G.props).filter(p => !p.carriedBy).map(p => ({ id: p.id, name: p.name, kind: "object" as const, glyph: p.glyph, color: p.lit && p.state === "standing" ? "#ffd966" : "#7f6000", map: G.map.id, at: p.at, states: [p.state, ...(p.lit ? ["lit"] : [])] })),
      ...units.filter(u => u.state !== "fled").map(u => ({
        id: u.id, name: u.name, kind: u.id === G.pc ? "player" as const : "person" as const, glyph: u.glyph, color: u.color, map: G.map.id, at: u.at,
        ...(u.castId ? { ref: u.castId } : {}), states: [u.state === "fighting" ? health(u) : u.state, ...(u.arrested ? ["arrested"] : []), ...u.conditions.filter(c => !/active$/.test(c))], blocks: u.state === "fighting",
      })),
    ];
    return {
      map: G.map, round: G.round,
      ...(active && !this.over() ? { turn: { id: active.id, name: active.name, side: active.side, isPlayer: active.id === G.pc } } : {}),
      order: G.order.map((id, i) => { const u = G.units[id]!; return { id, name: u.name, side: u.side, initiative: u.initiative, state: u.state, health: u.side === "enemy" || u.side === "neutral" ? health(u) : `${u.hp}/${u.maxHp}`, active: i === G.active }; }),
      units, actors,
      hazards: { dust: G.dust.map(k => ({ x: Number(k.split(",")[0]), y: Number(k.split(",")[1]) })), fire: G.fire.map(k => ({ x: Number(k.split(",")[0]), y: Number(k.split(",")[1]) })) },
      props: Object.values(G.props), log: withNotes(G.log, this.notes),
      player: {
        hp: pc.hp, maxHp: pc.maxHp, ac: pc.ac, speed: pc.speed, movementLeft: s.isTurnOf(pc) ? s.movementLeft(pc) : pc.speed, actionUsed: s.isTurnOf(pc) ? !!use?.actionUsed : false,
        slots: me ? slotsText(s.t, pc.engineId) : "", conditions: pc.conditions.filter(c => !/active$/.test(c)), ...(pc.deathSaves && pc.state === "down" ? { deathSaves: pc.deathSaves } : {}),
      },
      over: this.over(), ...(G.outcome ? { outcome: G.outcome } : {}),
    };
  }

  result(): CombatResult {
    if (this.finalResult) return this.finalResult;
    const G = this.state();
    if (!G.outcome) throw new Error("The fight isn't over yet.");
    this.finalResult = summarise(G);
    if (!this.written) { this.writeBack(); this.written = true; }
    return this.finalResult;
  }

  /** The story goes on with the player as the fight left them: hit points, slots, conditions; and who's who in the rules. */
  private writeBack(): void {
    const G = this.state();
    const t = this.rules.open(G);
    const rules = this.session.rules!;
    const ev = (type: string, rest: Record<string, unknown>) => t.event(type, rest);
    try { t.plan("endEncounter", { encounterId: G.encounterId, outcome: G.outcome === "surrender" ? "parley" : G.outcome }); } catch { /* already over */ }
    const pc = t.char(rules.pc)!;
    // A fight's leftovers: dodging and the like end with it; down means out cold but stable (the next scene brings them round).
    const transient = pc.appliedConditions.filter(a => ["dodged", "prone"].includes(a.conditionId));
    if (transient.length) t.apply(transient.map(a => ev("ConditionRemoved", { targetId: pc.id, conditionId: a.conditionId })));
    // The engine lets hit points run below zero; the story reads 0 (heal to 1 and take it again: healing starts from 0).
    if (pc.hp.current < 0) t.apply([ev("Healed", { targetId: pc.id, amount: 1, source: "fight-ended" }), ev("DamageApplied", { targetId: pc.id, components: [{ amount: 1, type: "bludgeoning" }], source: "fight-ended" })]);
    if (t.char(pc.id)!.hp.current <= 0 && !t.char(pc.id)!.deathSaves.stable) t.apply([ev("Stabilized", { targetId: pc.id })]);
    rules.campaign = t.kit.E.serializeCampaign(t.campaign);
    for (const u of Object.values(G.units)) if (u.castId && u.id !== G.pc) rules.npcs[u.castId] = { id: u.engineId, weapon: u.weapons[0] ?? "" };
    rules.status = statusText(t, rules.pc);
    this.session.rollCount++;
    // Whoever is in the scene's world shows how the fight left them.
    const world = this.session.world;
    if (world) for (const u of Object.values(G.units)) {
      const e = world.entities[u.castId ?? (u.id === G.pc ? "player" : u.id)];
      if (!e) continue;
      const now = u.state === "fled" ? "gone" : u.state === "fighting" ? health(u) : u.state;
      e.states = [...e.states.filter(x => !["hurt", "badly hurt", "down", "unhurt", "dead", "surrendered"].includes(x)), ...(now === "unhurt" ? [] : [now]), ...(u.arrested ? ["arrested"] : [])];
    }
    if (world) placeInWorld(G, world);
  }

  /** `at`: after that many of the rules' lines (by default, all of them so far). */
  note(line: Omit<LogLine, "round">, at?: number): void {
    const G = this.state();
    const note = { at: Math.min(at ?? G.log.length, G.log.length), line: { round: G.round, ...line } };
    // In the log's order: after every note already at that place.
    const i = this.notes.findIndex(n => n.at > note.at);
    if (i < 0) this.notes.push(note);
    else this.notes.splice(i, 0, note);
  }

  save(): SavedCombat { return { version: 1, G: this.state(), seed: this.seed, written: this.written, ...(this.notes.length ? { notes: this.notes } : {}) }; }
}

const ordinal = (n: number) => ["cantrip", "1st", "2nd", "3rd"][n] ?? `${n}th`;

/**
 * The fight on the map, written into the scene's world, so the scene picks up where the fight left
 * things: where everyone ended up, the lanterns knocked down, and the fire (the area it's in burns,
 * the dust has gone up, what stood in the flames is alight). Only on a map that lines up with the
 * world (a region of the scene's with a world origin): 5 ft a tile, a tile's middle in feet.
 */
function placeInWorld(G: CombatG, world: SceneWorld): void {
  const region = G.map.regions.find(r => r.sceneId === world.scene && r.worldOrigin);
  if (!region?.worldOrigin) return;
  const o = region.worldOrigin;
  const feet = (t: Tile2) => ({ x: (t.x - o.x) * FEET + FEET / 2, y: (t.y - o.y) * FEET + FEET / 2 });
  const inside = (p: { x: number; y: number }) => { const root = world.entities[world.root]?.rect; return !root || (p.x >= 0 && p.y >= 0 && p.x <= root.w && p.y <= root.h); };
  for (const u of Object.values(G.units)) {
    const e = world.entities[u.castId ?? (u.id === G.pc ? "player" : u.id)];
    if (!e || u.state === "fled" || (e.kind !== "person" && e.kind !== "creature")) continue;
    const at = feet(u.at);
    if (!inside(at)) continue;
    e.at = at;
    e.parent = areaAt(world, at).id;
  }
  for (const p of Object.values(G.props)) {
    const e = world.entities[p.id];
    if (!e || p.state === "standing") continue;
    e.states = [...e.states.filter(s => s !== "hanging" && (p.state !== "broken" || s !== "lit")), p.state === "broken" ? "broken" : "fallen"];
    const at = feet(p.at);
    if (inside(at)) { e.at = at; if (e.parent && world.entities[e.parent]?.kind === "area") e.parent = areaAt(world, at).id; }
  }
  const fire = G.fire.map(fromKey);
  if (!fire.length && !G.flags["dust_exploded"]) return;
  const burning = new Set(fire.map(t => areaAt(world, feet(t)).id));
  for (const id of burning) { const a = world.entities[id]; if (a && !a.states.includes("burning")) a.states.push("burning"); }
  if (G.flags["dust_exploded"]) {
    for (const a of Object.values(world.entities)) if ((a.kind === "area" || a.kind === "place") && a.states.includes("dusty")) a.states = [...a.states.filter(s => s !== "dusty"), "exploded"];
  }
  // What stands where the fire is catches.
  for (const e of Object.values(world.entities)) {
    if (!e.at || e.kind === "person" || e.kind === "creature" || !e.tags.includes("flammable") || e.states.includes("burning") || e.states.includes("destroyed")) continue;
    if (fire.some(t => { const f = feet(t); return Math.abs(f.x - e.at!.x) <= FEET && Math.abs(f.y - e.at!.y) <= FEET; })) e.states.push("burning");
  }
}

/** The AI's steps that the player could take too (not remarks, nerve or surrender). */
function asPlayerAction(step: Step): PlayerAction | undefined {
  switch (step.kind) {
    case "move": case "attack": case "cast": case "use": case "dash": case "dodge": case "disengage": case "leave": case "end": return step;
    default: return undefined;
  }
}

function slotsText(t: Table, id: string): string {
  const c = t.char(id)!;
  const sheet = t.sheet(id);
  return sheet.spellSlots.slotsByLevel.map((max, i) => (max ? `${ordinal(i + 1)} ${max - (c.spellSlotsUsed[String(i + 1)] ?? 0)}/${max}` : "")).filter(Boolean).join(", ");
}

/** The scene runtime's status line: "HP 13/24, spell slots 1st 2/4, 2nd 2/2, poisoned". */
function statusText(t: Table, id: string): string {
  const c = t.char(id)!;
  const sheet = t.sheet(id);
  const slots = slotsText(t, id);
  const conditions = c.appliedConditions.map(a => a.conditionId).filter(x => !x.endsWith("-active"));
  return [`HP ${Math.max(0, c.hp.current)}/${sheet.effectiveHpMax}${c.hp.temp ? ` (+${c.hp.temp} temp)` : ""}`, slots ? `spell slots ${slots}` : "", ...conditions].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------------------------
// The story's version.

const people = (us: Unit[]) => listing(us.map(u => u.called));

export function summarise(G: CombatG): CombatResult {
  const units = Object.values(G.units);
  const pc = G.units[G.pc]!;
  const sentences: string[] = [];
  const villain = units.find(u => u.role === "villain");
  const fate = (u: Unit) => u.state === "surrendered" ? `surrendered${u.arrested ? " and Kell arrested him" : ""}` : u.state === "fled" ? "ran for it and got away" : u.state === "dead" ? "was killed" : u.state === "down" ? `was beaten senseless${u.arrested ? " and Kell put the irons on him" : ""}` : "was still on his feet at the end";
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const place = G.place ?? "the Heron";
  if (G.flags["dust_exploded"]) sentences.push(`The grain dust exploded (set off by ${G.flags["lit_by"] === "player" ? "the player" : String(G.flags["lit_by"] ?? "the fire")}), and ${place} is on fire`);
  else if (G.flags["fire"]) sentences.push(`Fire got into the sacks, and ${place} is burning`);
  if (villain) sentences.push(`${cap(villain.called)} ${fate(villain)}`);
  const hired = units.filter(u => u.side === "enemy" && u !== villain && u.role !== "coward");
  const walked = (u: Unit) => !!G.flags[`walked:${u.id}`];
  const by = (state: Unit["state"]) => hired.filter(u => u.state === state && !walked(u));
  const parts = [
    by("down").length ? `${people(by("down"))} went down` : "", by("dead").length ? `${people(by("dead"))} died` : "",
    by("surrendered").length ? `${people(by("surrendered"))} gave up` : "", by("fled").length ? `${people(by("fled"))} ran` : "",
    hired.some(walked) ? `${people(hired.filter(walked))} walked off once nobody was paying them` : "",
    by("fighting").length ? `${people(by("fighting"))} kept fighting` : "",
  ].filter(Boolean);
  if (parts.length) sentences.push(cap(parts.join("; ")));
  const coward = units.find(u => u.role === "coward");
  if (coward) sentences.push(coward.state === "fled" ? `${cap(coward.called)} ran` : `${cap(coward.called)} ${coward.state === "fighting" ? "hid" : coward.state === "down" ? "was knocked flat" : coward.state}`);
  for (const ally of units.filter(u => u.side === "ally")) sentences.push(`${cap(ally.called)} ${ally.state === "down" ? "went down, and came round after" : !ally.wounded ? "came through unhurt" : ally.hp * 2 <= ally.maxHp ? "was badly hurt" : "was hurt"}${units.some(u => u.arrested) ? "" : ""}`);
  const near = G.flags["pc_dying"];
  sentences.push(pc.state === "down" ? `The player was knocked out${near ? " and very nearly died" : ""}` : pc.state === "fled" ? "The player got out" : `The player ended the fight on ${pc.hp} of ${pc.maxHp} hit points`);
  const casualties = units.filter(u => u.id !== G.pc).map(u => ({ id: u.castId ?? u.id, name: u.name, state: u.state === "fighting" ? "standing" as const : u.state }));
  const flags: Record<string, string | number | boolean> = {};
  for (const k of ["dust_exploded", "fire", "lit_by", "pc_dying"]) if (G.flags[k] !== undefined) flags[k] = G.flags[k]!;
  if (G.flags["fire"]) flags["heron_burned"] = true;
  for (const u of units) if (u.castId && u.id !== G.pc) flags[u.castId] = u.arrested ? "arrested" : walked(u) ? "walked off" : u.state === "fighting" ? "standing" : u.state;
  const rounds = G.round;
  const positions = Object.fromEntries(units.map(u => [u.id === G.pc ? "player" : u.castId ?? u.id, { ...u.at }]));
  return { outcome: G.outcome!, summary: `${sentences.join(". ")}. It took ${rounds} round${rounds === 1 ? "" : "s"}.`, casualties, rounds, flags, positions };
}

