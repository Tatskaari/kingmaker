// Copied from the prototype's src/runtime/engine.ts at 44c6d4a: lines 1296-1327 (leap), 1329 (nameIn), 1331-1357 (violence), 1370-1388 (react) and 1411-1420 (moveToAct). The usual edits (world-bridge-design §2): the host's Rules first and no await (jump's .then is applied to its answer; spellInfo is the Rules' content); a SceneSession for the SessionState where presentCast reads the GM's bookkeeping and react writes absent, brawl and threat on it; presentCast from shared/scene/graph.ts; RulesOutcome for Outcome. Each is exported for the simulation's commits.
import { presentCast } from "../scene/graph.ts";
import type { Scene } from "../scene/types.ts";
import { applyOps, jumpGap, type Entity, type WorldOp } from "../world/scene-world.ts";
import { jump, type JumpOutcome, type RulesOutcome } from "./acts.ts";
import type { Act, ActFrom, Jumping, Mechanic, Reaction, Rules, RulesSession, SceneSession } from "./types.ts";

/**
 * What the rules do around an act in a scene's world: the player moved to where they act from, a
 * jump landed where the world says, whether the act was violence people would react to, and the
 * reactions taking effect (the fleeing leave, the cowering cower; no fight starts in a scene). The
 * simulation's act and reactions commits call them on the world rebuilt from the rows.
 */

/**
 * A jump in a scene: how far from the world when it knows where they're going (or the decider's
 * read), the rules decide whether they make it, and the world puts them where they land: across,
 * or in what they were jumping over (wet, if it was water; prone, after a fall).
 */
export function leap(rules: Rules, state: RulesSession, j: Jumping): RulesOutcome {
  const world = state.world;
  const landing = world && j.to ? (j.to.near ?? j.to.area) : undefined;
  // The gap, as the world has it (the ditch's ten feet, not the walk to its far side): see jumpGap.
  const measured = world && landing && j.how === "long" ? jumpGap(world, landing, j.over) : undefined;
  const feet = j.how === "high" ? j.feet ?? 5 : measured ?? j.feet ?? 10;
  const drop = j.how === "down" ? Math.max(j.drop, 10) : j.drop;
  const result = j.how === "down"
    ? ((r: JumpOutcome) => ({ ...r, lines: [`Jump down: ${drop} ft`, ...r.lines.slice(1)], account: r.account.replace(/^.*?fall short, and /, "") }))(jump(rules, state, { feet: Number.POSITIVE_INFINITY, drop }))
    : jump(rules, state, { feet, high: j.how === "high", runUp: j.runUp, drop });
  const lines = [...result.lines];
  if (world) {
    const blank = { what: "player", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };
    const ops: WorldOp[] = [];
    if (result.made && j.to?.area) ops.push({ ...blank, op: "move", to: j.to.area });
    if (result.made && j.to?.near) ops.push({ ...blank, op: "move", to: j.to.near });
    if (!result.made && j.over && world.entities[j.over]) ops.push({ ...blank, op: "place", to: j.over, how: "on" });
    if (!result.made && j.water) ops.push({ ...blank, op: "state", add: ["wet"] });
    if (ops.length) applyOps(world, ops, state.turn, "rules");
  }
  const where = j.how === "down" ? "down" : `${j.how === "high" ? "up" : "across"}${j.over && world?.entities[j.over] ? ` over ${world.entities[j.over]!.name}` : ""}${landing && world?.entities[landing] ? ` to ${world.entities[landing]!.name}` : ""}`;
  return {
    lines,
    directive: `Rules: the player jumped ${where}: ${result.account}.${!result.made && j.water ? " They go into the water: soaked, and the cold takes their breath." : ""} Narrate exactly that, and let the people present react.`,
    ...(result.status ? { status: result.status } : {}),
  };
}

export const nameIn = (scene: Scene, state: RulesSession, id: string) => state.rules?.aliases?.[id] ?? scene.cast.find(c => c.id === id)?.name ?? state.world?.entities[id]?.name ?? id;

/**
 * Did the player just do violence people would react to? A blow or a grab at a person, a harmful
 * spell at or around people, or one that set something burning or broke it where people are. The
 * rules have already decided what it did; this reads it off the mechanic and the world's states.
 */
export function violence(rules: Rules, scene: Scene, state: SceneSession, m: Mechanic, before: Record<string, string[]> | undefined): Act | undefined {
  const world = state.world;
  const people = new Set([...presentCast(scene, state).map(c => c.id), ...(world ? Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !e.states.includes("gone")).map(e => e.id) : [])]);
  const name = (id: string) => nameIn(scene, state, id);
  const newly = (e: Entity, states: string[]) => !!before && e.states.some(x => states.includes(x)) && !(before[e.id] ?? []).some(x => states.includes(x));
  if (m.kind === "attack" || m.kind === "wrestle") {
    if (people.has(m.target)) return { what: m.kind === "attack" ? `attacked ${name(m.target)}${m.weapon ? ` (${m.weapon.replace(/-/g, " ")})` : ""}` : `laid hands on ${name(m.target)} (${m.how === "grapple" ? "grabbed them" : "shoved them"})`, victims: [m.target], property: [] };
    // Cutting a rope or breaking a crate isn't violence anyone fights over; setting it alight is alarming.
    const lit = world?.entities[m.target];
    return lit && newly(lit, ["burning"]) ? { what: `set ${lit.name} alight`, victims: [], property: [lit.id] } : undefined;
  }
  if (m.kind !== "cast") return undefined;
  const spell = rules.content.spells.get(m.spell);
  const harmful = (spell?.mechanicalEffects ?? []).some(e => e["damageType"] || ["attack", "auto-hit", "hp-pool-knockout", "save"].includes(String(e["kind"])));
  if (!spell || !harmful) return undefined;
  const hurt = world ? Object.values(world.entities).filter(e => people.has(e.id) && newly(e, ["hurt", "badly hurt", "down", "burning", "prone"])).map(e => e.id) : [];
  const victims = [...new Set([...m.targets.filter(t => people.has(t)), ...hurt])];
  const property = world ? Object.values(world.entities).filter(e => (e.kind === "object" || e.kind === "item" || e.kind === "feature") && newly(e, ["burning", "destroyed", "broken"])).map(e => e.id) : [];
  if (!victims.length && !property.length) return undefined;
  const parts = [victims.length ? `at ${victims.map(name).join(", ")}` : "", property.length ? `setting ${property.slice(0, 4).map(name).join(", ")} burning or breaking it` : ""].filter(Boolean);
  return { what: `cast ${spell.name} ${parts.join(", ")}`, victims, property };
}

/**
 * The reactions take effect: the fleeing leave, the cowering cower. Someone who'd fight starts no
 * fight in a scene: starting one is the scene's routes' and its co-GM's (the reply plays them turning
 * on the player, and the co-GM their role from there). With `fights`, the prototype's way, parked for
 * combat: a fight starts if anyone wants one, its first fighter's blow left hanging over the player.
 */
export function react(scene: Scene, state: SceneSession, act: Act, reactions: Record<string, Reaction>, options: { fights?: boolean } = {}): void {
  const world = state.world;
  const fled: string[] = [];
  for (const [id, r] of Object.entries(reactions)) {
    const e = world?.entities[id];
    if (r === "flee" || r === "raise_alarm") {
      fled.push(id);
      if (scene.cast.some(c => c.id === id)) state.absent = [...new Set([...(state.absent ?? []), id])];
      if (e) { e.states = [...e.states.filter(s => s !== "cowering"), "gone"]; e.notes.push({ text: r === "raise_alarm" ? `ran for help after the player ${act.what}` : `fled when the player ${act.what}`, turn: state.turn, by: "rules" }); }
    } else if (r === "cower" && e && !e.states.includes("cowering")) e.states.push("cowering");
  }
  const against = Object.entries(reactions).filter(([, r]) => r === "fight").map(([id]) => id);
  if (!against.length || !options.fights) return;
  const allies = Object.entries(reactions).filter(([, r]) => r === "join_player").map(([id]) => id);
  state.brawl = { turn: state.turn, cause: act.what, against, allies, fled };
  // Without a map to fight it out on, the first of them swings at the player next turn.
  state.threat = { kind: "attack", by: against[0]!, turn: state.turn };
}

/** Put the player where they act from before the rules roll (see ActFrom). */
export function moveToAct(state: RulesSession, from: ActFrom, aim: string | undefined): void {
  const world = state.world!;
  const blank = { what: "player", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };
  const ops: WorldOp[] = [];
  if (from.area) ops.push({ ...blank, op: "move", to: from.area });
  if (from.near) ops.push({ ...blank, op: "move", to: from.near });
  if (from.backOff && aim && world.entities[aim]) ops.push({ ...blank, op: "place", to: aim, how: "away", feet: from.backOff });
  applyOps(world, ops, state.turn, "rules");
}
