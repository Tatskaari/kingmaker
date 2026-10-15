import { sceneById } from "../../../scenes/index.ts";
import type { SessionState } from "../../runtime/session.ts";
import { standinFights } from "../fight-standin.ts";
import type { Action, Fight, FightFactory, GameState } from "../play.ts";
import type { CombatantSetup, CombatSetup, MapActor, TileMap, Tile2 } from "../types.ts";
import { engineReady, resumeCombat, startCombat, type CombatController, type SavedCombat } from "./controller.ts";
import { explore, FEET, key, same, solid, steps } from "./grid.ts";
import { heronMap } from "./heron-grid.ts";
import { heronEncounter, type HeronOptions } from "./heron.ts";
import type { LogLine, PlayerAction } from "./model.ts";
import { gridText, KEY, legend } from "./render.ts";

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
      const s = saved as { combat?: SavedCombat; unseen?: LogLine[] } | undefined;
      // A game saved mid-fight by the stand-in carries on as one.
      if (!s?.combat) return standinFights.load(saved, session);
      return new TacticalFight(resumeCombat(s.combat, session, loaded), s.unseen ?? [], () => factory.pace);
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
  private readonly pace: () => TacticalFights["pace"];
  constructor(combat: CombatController, unseen: LogLine[], pace: () => TacticalFights["pace"] = () => undefined) {
    this.controller = combat;
    this.unseen = unseen;
    this.pace = pace;
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
    const recent = this.unseen.length ? this.unseen : G.log.slice(-6);
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
    if (o.movementLeft >= FEET) {
      for (const v of Object.values(G.units).filter(v => v.state === "fighting" && v.side === "enemy" && steps(v.at, pc.at) > 1)) out.push({ id: `close_${v.id}`, label: `Close in on ${v.name}`, kind: "move" });
      for (const p of Object.values(G.props).filter(p => p.state === "standing" && p.lit && !p.carriedBy && steps(p.at, pc.at) > 1)) out.push({ id: `close_${p.id}`, label: `Get next to the ${p.name}`, kind: "move" });
      const exit = G.exits.filter(e => !same(e.at, pc.at)).sort((a, b) => steps(a.at, pc.at) - steps(b.at, pc.at))[0];
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
      const action = this.parse(id);
      if (!action) return `(There's no action "${id}" just now.)`;
      const done = this.combat.act(action);
      lines.push(...done.lines);
      if (!done.ok) return `(${done.error ?? "That didn't work."})`;
      // Nothing left worth doing this turn: the turn passes by itself.
      const o = this.combat.options();
      if (action.kind !== "end" && this.combat.playerTurn() && o.actionUsed && o.movementLeft < FEET) lines.push(...this.combat.act({ kind: "end" }).lines);
    }
    // Everyone else's turns, one at a time, each given its moment when something is watching.
    for (let guard = 0; guard < 400 && !this.combat.over() && !this.combat.playerTurn(); guard++) {
      const turn = this.combat.advance(undefined, 1);
      lines.push(...turn);
      const pace = this.pace();
      if (pace && turn.length && !this.combat.over() && !this.combat.playerTurn()) await pace(turn);
    }
    // Over: result() writes the story back (the play loop shows its summary as "The fight: ...").
    if (this.combat.over()) this.combat.result();
    return lines.map(show).join("\n");
  }

  private parse(id: string): PlayerAction | undefined {
    const G = this.combat.state();
    const pc = G.units[G.pc]!;
    if (id === "end_turn") return { kind: "end" };
    if (id === "dash" || id === "dodge" || id === "disengage" || id === "leave") return { kind: id };
    let m = /^move_(\d+)_(\d+)$/.exec(id);
    if (m) return { kind: "move", to: { x: Number(m[1]), y: Number(m[2]) } };
    m = /^step_(\w+)$/.exec(id);
    if (m && DIRS[m[1]!]) { const d = DIRS[m[1]!]!; return { kind: "move", to: { x: pc.at.x + d.x, y: pc.at.y + d.y } }; }
    m = /^attack_(.+?)(?:_with_(.+))?$/.exec(id);
    if (m) {
      // Plain attack_<target> is the attack it was listed as: the first weapon that reaches them (a bow across the room).
      const attacks = this.combat.options().attacks.filter(a => a.target === m![1]);
      const weapon = m[2] ? pc.weapons.find(w => slug(attacks.find(a => a.weapon === w)?.weaponName ?? "") === m![2]) : attacks[0]?.weapon;
      return { kind: "attack", target: m[1]!, ...(weapon ? { weapon } : {}) };
    }
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
      return at ? this.closeTo(at) : undefined;
    }
    if (id === "make_for_the_door") {
      const exit = G.exits.filter(e => !G.units[G.pc] || !same(e.at, pc.at)).sort((a, b) => steps(a.at, pc.at) - steps(b.at, pc.at))[0];
      return exit ? this.closeTo(exit.at, true) : undefined;
    }
    return undefined;
  }

  /** As close as this turn's movement gets you (next to it, or onto it for a door). */
  private closeTo(at: Tile2, onto = false): PlayerAction | undefined {
    const o = this.combat.options();
    const G = this.combat.state();
    const best = [...o.moves].sort((a, b) => (onto ? steps(a, at) - steps(b, at) : Math.abs(steps(a, at) - 1) - Math.abs(steps(b, at) - 1)) || steps(a, G.units[G.pc]!.at) - steps(b, G.units[G.pc]!.at))[0];
    return best ? { kind: "move", to: best } : undefined;
  }

  result() { return this.combat.over() ? this.combat.result() : undefined; }
  save(): unknown { return { combat: this.combat.save(), unseen: this.unseen }; }
}

const DIRS: Record<string, Tile2> = { north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 }, northeast: { x: 1, y: -1 }, northwest: { x: -1, y: -1 }, southeast: { x: 1, y: 1 }, southwest: { x: -1, y: 1 } };
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ordinal = (n: number) => ["cantrip", "1st", "2nd", "3rd"][n] ?? `${n}th`;

export function show(l: LogLine): string {
  switch (l.kind) {
    case "turn": return `— ${l.text} —`;
    case "dice": return `🎲 ${l.text}`;
    case "system": return `(${l.text})`;
    default: return l.text;
  }
}

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
