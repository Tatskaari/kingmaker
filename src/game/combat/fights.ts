import { sceneById } from "../../../scenes/index.ts";
import type { Decider } from "../../llm/decide.ts";
import type { SessionState } from "../../runtime/session.ts";
import { standinFights } from "../fight-standin.ts";
import type { Action, Fight, FightFactory, GameState, SayHooks } from "../play.ts";
import type { CombatantSetup, CombatSetup, MapActor, TileMap, Tile2 } from "../types.ts";
import { engineReady, resumeCombat, startCombat, type CombatController, type SavedCombat } from "./controller.ts";
import { explore, FEET, key, same, solid, steps } from "./grid.ts";
import { moveChoices, type NamedMove } from "./moves.ts";
import { heronMap } from "./heron-grid.ts";
import { heronEncounter, type HeronOptions } from "./heron.ts";
import { show, type ActResult, type CheckSkill, type CombatG, type InfluenceSkill, type LogLine, type Mood, type PlayerAction, type Urge } from "./model.ts";
import { gridText, KEY, legend } from "./render.ts";
import { deciderOf, readLine, type Reading } from "./typed.ts";
import { speak, type Voice } from "./voice.ts";

/** What a typed line is read and answered with: the decider (null: no model, the plain commands only) and the voice (null: none). */
export interface SayTools { decider?: Decider | null; voice?: Voice | null }

/**
 * Tactical combat behind the play loop's Fight interface (src/game/play.ts): the text the QA API
 * and the app show, actions with readable ids ("attack_crake-1", "cast_fire-bolt_sallow",
 * "use_brazier", "close_sallow", "move_12_6", "end_turn"), and save/load. Drop-in for the stand-in:
 *
 *   new Game(..., fights: tacticalFights())   // instead of standinFights
 *
 * The rules engine loads when this module does (load() must be synchronous).
 */

const loaded = await engineReady();

/** The scene's place as a battlefield (the map module's battlefield(): its map, where everyone stands, its lights, dust and fuel). */
export interface Field {
  map: TileMap;
  /** Where people stand, by cast id and "player". */
  at: Record<string, Tile2>;
  /** Lit flames a fight can knock over (lanterns, braziers), with the world's ids. */
  props?: MapActor[];
  dust?: Tile2[];
  fuel?: Tile2[];
}

export interface TacticalOptions {
  /** The Heron's map (the map module's, when it has one); our own grid otherwise. */
  map?: (session: SessionState) => TileMap;
  /** The scene's place with everyone where its world has them: preferred over `map` when it gives one. */
  field?: (session: SessionState) => Field | undefined;
  heron?: HeronOptions;
}

export interface TacticalFights extends FightFactory {
  /** Called after each of the other side's turns while the player waits (a UI redraws and lets it land). */
  pace?: (lines: LogLine[]) => Promise<void>;
}

export function tacticalFights(options: TacticalOptions = {}): TacticalFights {
  const factory: TacticalFights = {
    async start(_game: GameState, session: SessionState): Promise<Fight> {
      const setup = encounterFor(session, options);
      const combat = await startCombat(setup, session);
      const fight = new TacticalFight(combat, [], () => factory.pace);
      fight.begin();
      return fight;
    },
    load(saved: unknown, session: SessionState): Fight {
      const s = saved as { combat?: SavedCombat; unseen?: LogLine[]; warned?: string } | undefined;
      // A game saved mid-fight by the stand-in carries on as one.
      if (!s?.combat) return standinFights.load(saved, session);
      return new TacticalFight(resumeCombat(s.combat, session, loaded), s.unseen ?? [], () => factory.pace, s.warned);
    },
    // A fight that broke out on the map (the town's people came at the player): as it stands, where everyone is.
    async startWith(setup: CombatSetup, session: SessionState): Promise<Fight> {
      const combat = await startCombat(setup, session);
      const fight = new TacticalFight(combat, [], () => factory.pace);
      fight.begin();
      return fight;
    },
  };
  return factory;
}

/** The fight the story's ending asked for: the Heron's own, or any scene's from its startCombat (a plain room). */
export function encounterFor(session: SessionState, options: TacticalOptions = {}): CombatSetup {
  if (session.sceneId === "heron-warehouse") {
    const field = options.field?.(session);
    if (!field) return heronEncounter(options.map?.(session) ?? heronMap(), session, options.heron ?? {});
    const setup = heronEncounter(field.map, session, { ...options.heron, at: field.at, ...(field.props ? { actors: field.props } : {}), ...(field.dust ? { dust: field.dust } : {}), ...(field.fuel ? { fuel: field.fuel } : {}) });
    return { ...setup, map: withinReach(setup) };
  }
  return arenaEncounter(session);
}

/**
 * A fight whose sides can't reach each other (the player on the wharf, Sallow inside behind the
 * barred land door) isn't a fight: in the scramble the doors get thrown open.
 */
function withinReach(setup: CombatSetup): TileMap {
  const player = setup.combatants.find(c => c.side === "player");
  if (!player) return setup.map;
  const apart = (map: TileMap) => {
    const seen = explore(map, player.at);
    return setup.combatants.some(c => c !== player && c.side !== "neutral" && !seen.has(key(c.at)));
  };
  if (!apart(setup.map)) return setup.map;
  const tiles = setup.map.tiles.map(row => row.map(t => (t.terrain === "door" && t.blocks ? { ...t, blocks: false } : t)));
  return { ...setup.map, tiles };
}

export class TacticalFight implements Fight {
  /** The fight itself, for a UI that draws it (view(), options(), area()); act through act() so the story sees it. */
  readonly controller: CombatController;
  private get combat(): CombatController { return this.controller; }
  /** Lines the player hasn't been shown yet (the other side's turns before theirs). */
  private unseen: LogLine[];
  /** The plan last warned about (an area that catches a friend): the same plan said again is done. */
  private warned?: string;
  private readonly pace: () => TacticalFights["pace"];
  constructor(combat: CombatController, unseen: LogLine[], pace: () => TacticalFights["pace"] = () => undefined, warned?: string) {
    this.controller = combat;
    this.unseen = unseen;
    this.pace = pace;
    this.warned = warned;
  }

  /** Whoever beat the player's initiative goes first. */
  begin(): void {
    this.unseen.push(...this.combat.state().log);
    this.unseen.push(...this.combat.advance());
  }

  observe(): string {
    const G = this.combat.state();
    const view = this.combat.view();
    const p = view.player;
    const head = view.over
      ? `The fight is over: ${view.outcome}.`
      : this.combat.playerTurn()
        ? `Round ${view.round}, your turn. HP ${p.hp}/${p.maxHp} · AC ${p.ac} · ${p.movementLeft} ft of movement left · ${p.actionUsed ? "action used" : "action ready"}${p.slots ? ` · slots ${p.slots}` : ""}`
        : `Round ${view.round}. HP ${p.hp}/${p.maxHp}${p.deathSaves ? ` · death saves ${p.deathSaves.successes} up, ${p.deathSaves.failures} down` : ""}`;
    const recent = this.unseen.length ? this.unseen : view.log.slice(-6);
    this.unseen = [];
    return [
      recent.map(show).join("\n"),
      "",
      head,
      gridText(G, { rulers: true }),
      legend(G).join("\n"),
      KEY,
    ].join("\n");
  }

  actions(): Action[] {
    if (this.combat.over() || !this.combat.playerTurn()) return [];
    const G = this.combat.state();
    const o = this.combat.options();
    const pc = G.units[G.pc]!;
    const out: Action[] = [];
    const named = (id: string) => G.units[id]?.name ?? (G.props[id] ? `the ${G.props[id]!.name}` : id);
    const seen = new Set<string>();
    for (const a of o.attacks) {
      if (seen.has(a.target)) continue;
      seen.add(a.target);
      out.push({ id: `attack_${a.target}`, label: `Attack ${named(a.target)} (${a.weaponName} ${a.bonus >= 0 ? "+" : ""}${a.bonus}${a.advantage ? `, ${a.advantage}` : ""}${a.note ? `, ${a.note}` : ""})`, kind: "fight" });
      const other = o.attacks.find(b => b.target === a.target && b.weapon !== a.weapon);
      if (other) out.push({ id: `attack_${a.target}_with_${slug(other.weaponName)}`, label: `Attack ${named(a.target)} with ${other.weaponName}`, kind: "fight" });
    }
    for (const s of o.spells) {
      const fire = s.fire && G.dust.length ? " (fire: mind the dust)" : "";
      if (s.targeting === "self") out.push({ id: `cast_${s.id}`, label: `Cast ${s.name}${s.slot ? ` (${ordinal(s.slot)} slot)` : ""}`, kind: "fight" });
      else if (s.targeting === "area") {
        for (const t of s.targets) out.push({ id: `cast_${s.id}_at_${t.id}`, label: `Cast ${s.name} at ${t.name}${s.slot ? ` (${ordinal(s.slot)} slot)` : ""}${fire}`, kind: "fight" });
      } else for (const t of s.targets) out.push({ id: `cast_${s.id}_${t.id}`, label: `Cast ${s.name} on ${t.name}${s.slot ? ` (${ordinal(s.slot)} slot)` : ""}${fire}`, kind: "fight" });
    }
    for (const p of o.props) out.push({ id: `use_${p.id}`, label: `${p.how === "kick it over" ? "Kick over" : "Bring down"} the ${p.name}${G.dust.length ? " (into the dust!)" : ""}`, kind: "use" });
    // A grab or a shove for whoever's beside you (they save against your Strength).
    for (const w of o.wrestle) {
      out.push({ id: `shove_${w.id}`, label: `Shove ${w.name} over (a save, or they're down)`, kind: "fight" });
      out.push({ id: `push_${w.id}`, label: `Shove ${w.name} away (a save, or 5 ft back)`, kind: "fight" });
      out.push({ id: `grapple_${w.id}`, label: `Grab hold of ${w.name} (a save, or they're held)`, kind: "fight" });
    }
    if (o.movementLeft >= FEET) {
      for (const v of Object.values(G.units).filter(v => v.state === "fighting" && v.side === "enemy" && steps(v.at, pc.at) > 1)) out.push({ id: `close_${v.id}`, label: `Close in on ${v.name}`, kind: "move" });
      for (const p of Object.values(G.props).filter(p => p.state === "standing" && p.lit && !p.carriedBy && steps(p.at, pc.at) > 1)) out.push({ id: `close_${p.id}`, label: `Get next to the ${p.name}`, kind: "move" });
      if (Object.values(G.units).some(v => v.state === "fighting" && v.side === "enemy" && steps(v.at, pc.at) <= 1)) out.push({ id: "back_off", label: "Back away (as far from them as this turn takes you)", kind: "move" });
      // Standing in a way out, it's leave (below), not making for one.
      const exit = o.leave ? undefined : [...G.exits].sort((a, b) => steps(a.at, pc.at) - steps(b.at, pc.at))[0];
      if (exit) out.push({ id: "make_for_the_door", label: `Make for ${exit.label.charAt(0).toLowerCase()}${exit.label.slice(1)}`, kind: "move" });
      for (const [dir, d] of Object.entries(DIRS)) {
        const to = { x: pc.at.x + d.x, y: pc.at.y + d.y };
        if (o.moves.some(m => same(m, to))) out.push({ id: `step_${dir}`, label: `Step ${dir} (5 ft)`, kind: "move" });
      }
    }
    if (o.leave) out.push({ id: "leave", label: `Go out through ${o.leave}`, kind: "travel" });
    if (o.dash) out.push({ id: "dash", label: "Dash (double movement this turn)", kind: "move" });
    if (o.dodge) out.push({ id: "dodge", label: "Dodge (attacks on you have disadvantage)", kind: "wait" });
    if (o.disengage) out.push({ id: "disengage", label: "Disengage (move away safely)", kind: "wait" });
    out.push({ id: "auto", label: "Fight on (let the dice decide this turn)", kind: "fight" });
    out.push({ id: "end_turn", label: "End your turn", kind: "wait" });
    return out;
  }

  async act(id: string): Promise<string> {
    if (this.combat.over()) return "The fight is over.";
    const lines: LogLine[] = [];
    if (id === "auto") lines.push(...this.combat.autoTurn());
    else {
      const done = this.perform(id);
      lines.push(...done.lines);
      if (!done.ok) return `(${done.error ?? "That didn't work."})`;
    }
    lines.push(...await this.afterwards(id === "end_turn" || id === "auto"));
    return lines.map(show).join("\n");
  }

  /** One of the player's acts by its id, as the rules take it: only that, and nobody else moves. */
  perform(id: string): ActResult {
    if (this.combat.over()) return { ok: false, error: "The fight is over.", lines: [] };
    const action = this.parse(id);
    if (!action) return { ok: false, error: `There's no action "${id}" just now.`, lines: [] };
    return this.combat.act(action);
  }

  /**
   * After the player's act: with nothing left worth doing this turn, the turn passes by itself;
   * then everyone else's turns, one at a time, each given its moment when something is watching.
   * `ended`: the turn has passed already (an end, the dice deciding).
   */
  private async afterwards(ended = false): Promise<LogLine[]> {
    const lines: LogLine[] = [];
    const o = this.combat.options();
    if (!ended && this.combat.playerTurn() && o.actionUsed && o.movementLeft < FEET) lines.push(...this.combat.act({ kind: "end" }).lines);
    for (let guard = 0; guard < 400 && !this.combat.over() && !this.combat.playerTurn(); guard++) {
      const turn = this.combat.advance(undefined, 1);
      lines.push(...turn);
      const pace = this.pace();
      if (pace && turn.length && !this.combat.over() && !this.combat.playerTurn()) await pace(turn);
    }
    // Over: result() writes the story back (the play loop shows its summary as "The fight: ...").
    if (this.combat.over()) this.combat.result();
    return lines;
  }

  /**
   * A line typed in the fight (src/game/combat/typed.ts reads it: the plain commands, or the
   * decider choosing among this turn's own actions), done as a click or a key does it, by id, the
   * rules first. Then the GM's line on what the rules did, or an answer to what was said
   * (voice.ts), streamed in; then the turn passes if there's nothing left worth doing, and the
   * others go. What can't be done is refused with the rules' reason, and nothing is spent.
   */
  async say(line: string, hooks: SayHooks = {}, tools: SayTools = {}): Promise<string> {
    if (this.combat.over()) return "The fight is over.";
    if (!this.combat.playerTurn()) return "(It isn't your turn: wait for it.)";
    hooks.onReading?.();
    const reading = await readLine(line, this, tools.decider === undefined ? deciderOf(this.combat.session) : tools.decider);
    if (reading.refusal) return `(${reading.refusal})`;
    if (this.secondThought(reading)) return `(${reading.warn} ${AGAIN})`;
    // The typed line goes in the log before what the rules make of it.
    const at = this.combat.state().log.length;
    const before = this.combat.view().log.length;
    const done = this.performAll(reading.steps);
    if (done.refused && !done.any) return `(${done.refused})`;
    this.combat.note({ kind: "said", who: this.combat.state().pc, text: line.trim() }, at);
    if (done.refused) this.combat.note({ kind: "system", text: `The rest didn't happen: ${done.refused}` });
    if (reading.note) this.combat.note({ kind: "system", text: reading.note });
    hooks.onRules?.();
    await this.voice(reading, before, hooks, tools.voice === undefined ? speak : tools.voice);
    const shown = this.combat.view().log.slice(before);
    const after = await this.afterwards(reading.steps.includes("end_turn"));
    return [...shown, ...after].map(show).join("\n");
  }

  /** Worth a second thought (reading.warn), and not said again since the warning: hold it this once. */
  private secondThought(reading: Reading): boolean {
    const plan = reading.steps.join(" ");
    const held = !!reading.warn && this.warned !== plan;
    this.warned = held ? plan : undefined;
    return held;
  }

  /**
   * The reading's acts in turn, until one can't be done (what came before it stands, as the rules
   * had it): refused by the rules, or overtaken by the dice (whoever the next blow was for went down
   * to the last one).
   */
  private performAll(steps: string[]): { any: boolean; refused?: string } {
    let any = false;
    for (const id of steps) {
      const gone = this.overtaken(id);
      if (gone) return { any, refused: gone };
      const done = this.perform(id);
      if (!done.ok) return { any, refused: inWords(done.error ?? "That didn't work.", id, this.combat.state()) };
      any = true;
    }
    return { any };
  }

  /** An act at someone on the other side who's no longer in it (the dice got there first): why it isn't made. */
  private overtaken(id: string): string | undefined {
    const G = this.combat.state();
    const m = /^(?:attack|shove|push|grapple)_(.+?)(?:_with_.+)?$/.exec(id) ?? /^urge_.+_(?:(?:willing|wavering|hostile)_)?(.+)$/.exec(id)
      ?? /^cast_.+?_(?:at_)?([a-z][a-z0-9-]*)(?:_slot\d)?$/.exec(id);
    const u = m ? G.units[m[1]!] : undefined;
    if (!u || u.side !== "enemy" || u.state === "fighting") return undefined;
    return `${u.called.charAt(0).toUpperCase()}${u.called.slice(1)} ${u.state === "down" || u.state === "dead" ? "is down already" : u.state === "surrendered" ? "has given up" : "is gone"}.`;
  }

  /**
   * The GM's line on it (a model call: the voice), streamed through the hooks and kept as table
   * talk: an answer from whoever was spoken to, or the GM dressing what the rules did. Offline (or
   * if the model fails) the rules' lines stand on their own.
   */
  private async voice(reading: Reading, from: number, hooks: SayHooks, voice: Voice | null): Promise<void> {
    // Words, or something done (ending the turn is nothing to dress).
    const done = reading.steps.filter(id => id !== "end_turn");
    if (!voice || !(reading.speech || done.length) || reading.offline) return;
    const rules = this.combat.view().log.slice(from);
    // The rules' lines are up already: the GM gets a few seconds, and the player can wave it on.
    const signal = hooks.skip ? AbortSignal.any([AbortSignal.timeout(VOICE_MS), hooks.skip]) : AbortSignal.timeout(VOICE_MS);
    let who = "gm";
    let heard = "";
    // Cut short whatever the voice does with the signal.
    const cut = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    // The timeout still runs out after a line that came in time: nothing's listening for it then.
    cut.catch(() => undefined);
    try {
      const spoken = await Promise.race([voice({ fight: this.combat, reading, rules, signal, onSpeaker: w => { who = w; hooks.onSpeaker?.(w, w === "gm" ? "narration" : "dialogue"); }, onText: text => { heard = text; hooks.onText?.(text); } }), cut]);
      if (spoken?.text) this.combat.note({ kind: spoken.who === "gm" ? "narration" : "said", who: spoken.who, text: spoken.text });
    } catch {
      // Cut short (waved on, or too slow), or the GM couldn't speak: what was said stands, and the rules' lines say the rest.
      if (heard.trim()) this.combat.note({ kind: who === "gm" ? "narration" : "said", who, text: `${heard.trim().replace(/[.,;:]?$/, "")}…` });
    }
  }

  private parse(id: string): PlayerAction | undefined {
    const G = this.combat.state();
    const pc = G.units[G.pc]!;
    if (id === "end_turn") return { kind: "end" };
    if (id === "dash" || id === "dodge" || id === "disengage" || id === "leave") return { kind: id };
    if (id === "back_off") return this.named({ kind: "back" });
    // A spell from a higher slot than its lowest: the same cast, upcast.
    let m = /^(cast_.+)_slot(\d)$/.exec(id);
    if (m) { const cast = this.parse(m[1]!); return cast?.kind === "cast" ? { ...cast, slot: Number(m[2]) } : undefined; }
    m = /^move_(\d+)_(\d+)$/.exec(id);
    if (m) return { kind: "move", to: { x: Number(m[1]), y: Number(m[2]) } };
    m = /^step_(\w+)$/.exec(id);
    if (m && DIRS[m[1]!]) { const d = DIRS[m[1]!]!; return { kind: "move", to: { x: pc.at.x + d.x, y: pc.at.y + d.y } }; }
    m = /^attack_(.+?)(?:_with_(.+))?$/.exec(id);
    if (m) {
      if (m[2] === "improvised") return { kind: "attack", target: m[1]!, weapon: "improvised" };
      // Plain attack_<target> is the attack it was listed as: the first weapon that reaches them (a bow across the room).
      const attacks = this.combat.options().attacks.filter(a => a.target === m![1]);
      const weapon = m[2] ? pc.weapons.find(w => slug(attacks.find(a => a.weapon === w)?.weaponName ?? "") === m![2]) : attacks[0]?.weapon;
      return { kind: "attack", target: m[1]!, ...(weapon ? { weapon } : {}) };
    }
    m = /^(shove|push|grapple)_(.+)$/.exec(id);
    if (m) return { kind: "wrestle", target: m[2]!, how: m[1] === "shove" ? "prone" : m[1] === "push" ? "push" : "grapple" };
    // Words with an action behind them: urge_<skill>_<what>[_<mood>]_<who> (a mood unsaid is the fight's: Skirmish.moodOf).
    m = /^urge_(intimidation|persuasion|deception|performance)_(yield|go|hold)_(?:(willing|wavering|hostile)_)?(.+)$/.exec(id);
    if (m) return { kind: "influence", skill: m[1] as InfluenceSkill, urge: m[2] as Urge, ...(m[3] ? { mood: m[3] as Mood } : {}), target: m[4]! };
    m = /^check_([a-z]+)_(\d+)$/.exec(id);
    if (m) return { kind: "check", skill: m[1] as CheckSkill, dc: Number(m[2]) };
    m = /^use_(.+)$/.exec(id);
    if (m) return { kind: "use", prop: m[1]! };
    m = /^cast_(.+?)_at_(\d+)_(\d+)$/.exec(id);
    if (m) return { kind: "cast", spell: m[1]!, at: { x: Number(m[2]), y: Number(m[3]) } };
    m = /^cast_(.+?)_at_(.+)$/.exec(id);
    if (m) { const t = G.units[m[2]!] ?? G.props[m[2]!]; return t ? { kind: "cast", spell: m[1]!, at: t.at } : undefined; }
    const spells = this.combat.options().spells;
    for (const s of spells) {
      if (id === `cast_${s.id}`) return { kind: "cast", spell: s.id, target: G.pc };
      if (id.startsWith(`cast_${s.id}_`)) return { kind: "cast", spell: s.id, target: id.slice(`cast_${s.id}_`.length) };
    }
    m = /^close_(.+)$/.exec(id);
    if (m) {
      const at = G.units[m[1]!]?.at ?? G.props[m[1]!]?.at;
      return at ? this.named({ kind: "close", at }) : undefined;
    }
    if (id === "make_for_the_door") return this.named({ kind: "door" });
    return undefined;
  }

  /**
   * A move by name, from where you stand with the movement you have (moves.ts): as close as it gets
   * you (no move if you're there already), or as far from the other side as it takes you.
   */
  private named(move: NamedMove): PlayerAction | undefined {
    const s = this.combat.look();
    const pc = s.pc();
    const best = moveChoices(s, pc, { at: pc.at, left: s.movementLeft(pc) }, move)[0];
    return best ? { kind: "move", to: best.at } : undefined;
  }

  result() { return this.combat.over() ? this.combat.result() : undefined; }
  /** The fight, what the player hasn't been shown yet, and a plan warned about and not yet said again (the QA console says it again in a process of its own). */
  save(): unknown { return { combat: this.combat.save(), unseen: this.unseen, ...(this.warned ? { warned: this.warned } : {}) }; }
}

/** The GM's line on a typed turn gets this long (the rules' lines are up already): a cosmetic call doesn't hold the fight up. */
const VOICE_MS = 10_000;
const AGAIN = "Say it again to do it anyway: nothing's spent yet.";

/** A step the rules wouldn't take, in words rather than its id ("There's no action \"back_off\" just now"). */
function inWords(error: string, id: string, G: CombatG): string {
  if (!/^There's no action "/.test(error)) return error;
  const name = (x: string) => G.units[x]?.called ?? (G.props[x] ? `the ${G.props[x]!.name}` : x);
  if (id === "back_off") return "By then there was nowhere further from them to back off to.";
  if (id === "make_for_the_door") return "By then there was no way out to make for.";
  const m = /^close_(.+)$/.exec(id);
  if (m) return `By then there was no getting next to ${name(m[1]!)}.`;
  return "By then that couldn't be done.";
}

const DIRS: Record<string, Tile2> = { north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 }, northeast: { x: 1, y: -1 }, northwest: { x: -1, y: -1 }, southeast: { x: 1, y: 1 }, southwest: { x: -1, y: 1 } };
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ordinal = (n: number) => ["cantrip", "1st", "2nd", "3rd"][n] ?? `${n}th`;

export { show };

// ---------------------------------------------------------------------------------------------
// Any other scene's fight: a plain room, its leader and their people against the player and allies.

const ARENA = [
  "####################",
  "#..................#",
  "#..................#",
  "#..................#",
  "+..................+",
  "#..................#",
  "#..................#",
  "#..................#",
  "####################",
];

export function arenaMap(name: string): TileMap {
  return {
    id: "arena", name, width: ARENA[0]!.length, height: ARENA.length,
    tiles: ARENA.map(row => [...row].map(ch => (ch === "#" ? { terrain: "wall" as const, blocks: true, opaque: true, height: 3 } : ch === "+" ? { terrain: "door" as const } : { terrain: "floor" as const }))),
    regions: [], exits: [{ at: { x: 0, y: 4 }, to: { map: "town", at: { x: 0, y: 0 } }, label: "the door" }, { at: { x: 19, y: 4 }, to: { map: "town", at: { x: 0, y: 0 } }, label: "the far door" }],
  };
}

/** World assets (src/world/assets.ts) as SRD statblocks, with what they fight with and how. */
const ASSET_STATBLOCK: Record<string, { statblock: string; weapon?: string; role: string }> = {
  "goblin-archer": { statblock: "goblin-warrior", weapon: "shortbow", role: "archer" },
  "goblin-boss": { statblock: "goblin-boss", weapon: "scimitar", role: "bruiser" },
  goblin: { statblock: "goblin-warrior", weapon: "scimitar", role: "brawler" },
  wolf: { statblock: "wolf", role: "bruiser" },
  bandit: { statblock: "bandit", role: "brawler" },
  "town-guard": { statblock: "guard", role: "ally" },
};

function arenaEncounter(session: SessionState): CombatSetup {
  const scene = sceneById(session.sceneId);
  const op = session.ended?.operations.find(o => o.op === "startCombat")?.args as { enemies?: Array<{ asset?: string; count?: number; leader?: string }>; allies?: string[] } | undefined;
  const map = arenaMap(scene.title);
  const combatants: CombatantSetup[] = [{ id: "player", name: session.player.name, side: "player", role: "player", at: { x: 15, y: 4 } }];
  let y = 3;
  for (const id of op?.allies ?? []) {
    const c = scene.cast.find(x => x.id === id);
    if (c && !session.absent?.includes(id)) combatants.push({ id, castId: id, name: c.name, side: "ally", role: "ally", statblock: c.statblock ?? "guard", ...(c.weapon ? { weapon: c.weapon } : {}), at: { x: 16, y: y++ } });
  }
  let row = 2;
  for (const e of op?.enemies ?? [{ count: 1 }]) {
    const kind = ASSET_STATBLOCK[e.asset ?? ""] ?? { statblock: e.asset ?? "bandit", role: "brawler" };
    const leader = e.leader ? scene.cast.find(x => x.id === e.leader) : undefined;
    if (leader) combatants.push({ id: leader.id, castId: leader.id, name: leader.name, side: "enemy", role: "bruiser", statblock: leader.statblock ?? kind.statblock, ...(leader.weapon ?? kind.weapon ? { weapon: (leader.weapon ?? kind.weapon)! } : {}), at: { x: 4, y: 4 } });
    // The leader counts among the number; the rest are their people.
    const rest = Math.min(4, Math.max(0, (e.count ?? 0) - (leader ? 1 : 0)));
    const label = (e.asset ?? "ruffian").replace(/-/g, " ");
    for (let i = 0; i < rest; i++) combatants.push({ id: `${e.asset ?? "foe"}-${i + 1}`, name: `a ${label}${rest > 1 ? ` (${i + 1})` : ""}`, side: "enemy", role: kind.role, statblock: kind.statblock, ...(kind.weapon ? { weapon: kind.weapon } : {}), at: { x: kind.role === "archer" ? 2 : 5, y: row++ % 7 + 1 } });
  }
  return { map, combatants: combatants.filter(c => !solid(map, c.at)), sceneId: session.sceneId, seed: (session.seed + 7 * (session.rollCount + 1)) >>> 0, place: "the room" };
}
