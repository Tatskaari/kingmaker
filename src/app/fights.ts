import type { Action, Fight, FightFactory } from "../game/play.ts";
import type { CombatResult, CombatSetup } from "../game/types.ts";
import type { SessionState } from "../runtime/session.ts";
import type { CombatAction, CombatAdapter, CombatController, CombatOptions, Dir, MapAdapter } from "./adapters.ts";
import { chebyshev } from "./geometry.ts";
import { combatSetup } from "./story.ts";

/**
 * Fights on the map, as the game core (src/game/play.ts) sees a fight: a Fight over a
 * CombatController (the stand-in, or src/game/combat when it lands). Everyone else's turns run
 * inside each action, paced by the app so the log shows each blow land; the QA console plays the
 * same fight through observe() and the action ids ("attack_crake_1", "cast_fire-bolt@crake-1").
 */

const DIRS: Record<string, Dir> = { go_n: "n", go_s: "s", go_e: "e", go_w: "w", go_ne: "ne", go_nw: "nw", go_se: "se", go_sw: "sw" };
const WORDS: Record<Dir, string> = { n: "north", s: "south", e: "east", w: "west", ne: "north-east", nw: "north-west", se: "south-east", sw: "south-west" };

/** The action id for a combat action, so the app and the QA console speak the same language. */
export function fightActionId(action: CombatAction): string {
  switch (action.kind) {
    case "move": return `go_${action.dir}`;
    case "attack": return `attack_${action.target}`;
    case "cast": return `cast_${action.spell}${action.target ? `@${action.target}` : ""}`;
    case "end": return "end_turn";
    default: return action.kind;
  }
}

function parse(id: string): CombatAction | "continue" | undefined {
  if (id === "continue") return "continue";
  if (DIRS[id]) return { kind: "move", dir: DIRS[id]! };
  if (id.startsWith("attack_")) return { kind: "attack", target: id.slice(7) };
  if (id.startsWith("cast_")) {
    const [spell, target] = id.slice(5).split("@");
    return { kind: "cast", spell: spell!, ...(target ? { target } : {}) };
  }
  if (id === "end_turn") return { kind: "end" };
  if (id === "dash" || id === "dodge" || id === "disengage") return { kind: id };
  return undefined;
}

export class TacticalFight implements Fight {
  setup: CombatSetup;
  controller?: CombatController;
  /** Set up (initiative rolled, everyone ahead of the player has acted). */
  ready: Promise<void>;
  private pace: () => Promise<void>;
  private options: CombatOptions = { spells: [], targets: [] };

  constructor(setup: CombatSetup, session: SessionState, combat: CombatAdapter, pace: () => Promise<void>) {
    this.setup = setup;
    this.pace = pace;
    this.ready = (async () => {
      this.controller = await combat.start(setup, session);
      await this.others();
    })();
  }

  /** Everyone else's turns until it's the player's (or it's over), with a beat between them. */
  private async others(): Promise<string[]> {
    const c = this.controller!;
    const lines: string[] = [];
    for (let i = 0; i < 60 && !c.result() && c.view().current !== "player"; i++) {
      lines.push(...await c.advance());
      if (!c.result() && c.view().current !== "player") await this.pace();
    }
    this.options = await c.options();
    return lines;
  }

  observe(): string {
    const c = this.controller;
    if (!c) return "Everyone reaches for something heavy…";
    const v = c.view();
    const me = v.order.find(o => o.id === "player");
    const where = (at: { x: number; y: number }) => {
      if (!me) return "";
      const d = chebyshev(me.at, at);
      if (!d) return "";
      const dir = (at.y < me.at.y ? "n" : at.y > me.at.y ? "s" : "") + (at.x < me.at.x ? "w" : at.x > me.at.x ? "e" : "");
      return `, ${d * 5} ft ${WORDS[dir as Dir]}`;
    };
    const order = v.order.filter(o => o.side !== "neutral").map(o => `${o.id === "player" ? "you" : o.name} ${o.initiative} (${o.health}${o.id === "player" ? "" : where(o.at)})`).join("; ");
    const status = v.over ? `It's over: ${v.over.summary}` : v.current === "player" ? `Round ${v.round}, your turn: ${v.movementLeft} ft of movement, action ${v.actionUsed ? "used" : "ready"}.` : `Round ${v.round}.`;
    return [`${this.setup.map.name}. Initiative: ${order}.`, ...v.log.slice(-8), status].join("\n");
  }

  actions(): Action[] {
    const c = this.controller;
    if (!c) return [];
    const v = c.view();
    if (v.over) return [{ id: "continue", label: "See what comes of it", kind: "fight" }];
    if (v.current !== "player") return [];
    const enemies = this.options.targets.filter(t => t.side === "enemy");
    const ready = !v.actionUsed;
    return [
      ...(ready ? enemies.filter(t => t.inReach).map(t => ({ id: `attack_${t.id}`, label: `Attack ${t.name}`, kind: "fight" as const })) : []),
      ...(ready && enemies[0] ? this.options.spells.map(s => ({ id: `cast_${s.id}@${enemies[0]!.id}`, label: `Cast ${s.name} at ${enemies[0]!.name}`, kind: "fight" as const })) : []),
      ...(v.movementLeft >= 5 ? Object.entries(DIRS).map(([id, d]) => ({ id, label: `Move 5 ft ${WORDS[d]}`, kind: "move" as const })) : []),
      ...(!v.actionUsed ? [{ id: "dash", label: "Dash", kind: "fight" as const }, { id: "dodge", label: "Dodge", kind: "fight" as const }, { id: "disengage", label: "Disengage", kind: "fight" as const }] : []),
      { id: "end_turn", label: "End your turn", kind: "fight" },
    ];
  }

  async act(id: string): Promise<string> {
    await this.ready;
    const c = this.controller!;
    const action = parse(id);
    if (!action) throw new Error(`Unavailable action: ${id}`);
    if (action === "continue") return "";
    const lines = await c.act(action);
    lines.push(...await this.others());
    return lines.join("\n");
  }

  result(): CombatResult | undefined {
    return this.controller?.result();
  }

  save(): unknown {
    // The stand-in restarts a fight from its setup; hit points carry over in the rules campaign.
    return { setup: this.setup };
  }
}

export interface TacticalFights extends FightFactory {
  /** The fight in progress, for the app to draw. */
  current?: TacticalFight;
  /** Called between other combatants' turns (the app redraws and waits a beat). */
  pace: () => Promise<void>;
}

export function tacticalFights(combat: CombatAdapter, maps: MapAdapter): TacticalFights {
  const factory: TacticalFights = {
    pace: async () => undefined,
    async start(_game, session) {
      const fight = new TacticalFight(combatSetup(session, maps.combatField(session.sceneId)), session, combat, () => factory.pace());
      factory.current = fight;
      await fight.ready;
      return fight;
    },
    load(saved, session) {
      const setup = (saved as { setup?: CombatSetup } | undefined)?.setup ?? combatSetup(session, maps.combatField(session.sceneId));
      const fight = new TacticalFight(setup, session, combat, () => factory.pace());
      factory.current = fight;
      return fight;
    },
  };
  return factory;
}
