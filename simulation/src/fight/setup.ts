// After the prototype's src/game/combat/setup.ts at bc2ab1f: calledName and defaultRole as they are, and initialState as boardOf, at its seams: it's handed the move's Table over the player's own campaign (rules_state's) and their engine id, everyone the setup names is made afresh from their statblock, but a scene's people the rules have made already, who fight as themselves (CombatantSetup.engine: hurt as they are), the player can start rested (fresh: a long rest on the fight's copy), looks come from the campaign's looks.json where the cast has one (GLYPHS and COLOURS for the rest), and the start's dice and lines are the fight's first moment (fight/start.ts).
import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { key, solid, toFeet } from "../../../shared/fight/grid.ts";
import type { FightBoard, FightSetup, Prop, Role, Unit } from "../../../shared/fight/types.ts";
import type { CombatantSetup, TileMap } from "../../../shared/map/types.ts";
import { createNpc, statblockFor, type Table } from "./rules.ts";

/**
 * Setting up a fight: the player's character as their campaign has them, the setup's people as
 * engine characters, an engine encounter with everyone placed on the grid, and initiative rolled by
 * the engine.
 */

const GLYPHS: Record<string, string> = { player: "@", kell: "K", sallow: "S", "crake-1": "C", "crake-2": "c", "lantern-boy": "b", hep: "H" };
const COLOURS: Record<string, string> = { player: "#ffffff", ally: "#6fa8dc", enemy: "#e06666", neutral: "#b7b7b7", sallow: "#c27ba0", "lantern-boy": "#f1c232" };

/** "Master Josiah Sallow" → "Master Sallow"; "Sergeant Agnes Kell" → "Sergeant Kell"; "the talking Crake" stays. */
export function calledName(name: string): string {
  if (/^(the|a|an) /i.test(name)) return name.charAt(0).toLowerCase() + name.slice(1);
  const words = name.split(/\s+/);
  const titles = /^(master|mister|mr|mrs|sergeant|corporal|captain|king|queen|sir|lady|lord|dame|old|big|young)$/i;
  return words.length >= 3 && titles.test(words[0]!) ? `${words[0]} ${words[words.length - 1]}` : name;
}

function defaultRole(c: CombatantSetup): Role {
  if (c.role) return c.role as Role;
  if (c.side === "player") return "player";
  if (c.side === "ally") return "ally";
  if (c.side === "neutral") return "bystander";
  return c.statblock === "commoner" ? "coward" : "bruiser";
}

/** The cast's looks (the campaign's looks.json): their letter and colour, as on the town's map. */
export type Looks = Record<string, { glyph: string; fg: string }>;

/** What the engine rolled for initiative, in the order they'll go. */
export interface Rolled { unit: string; d20: number; modifier: number; total: number }

/**
 * The board a fight starts on, and the initiative rolls: the setup's people made in the engine,
 * the encounter created with everyone on the grid (5 ft a tile), initiative rolled, the encounter
 * started and its first turn begun. `pc` is the player's engine id in the campaign `t` is open on;
 * `gone`, their gear the story has parted them from.
 */
export function boardOf(t: Table, setup: FightSetup, map: TileMap, pc: { engineId: string; gone: string[] }, looks: Looks = {}): { board: FightBoard; rolled: Rolled[] } {
  const content = t.kit.engine.content;
  // An encounter the story never closed shouldn't hold the turn.
  const active = t.state["activeEncounterId"] as string | undefined;
  if (active) try { t.plan("endEncounter", { encounterId: active, outcome: "parley" }); } catch { /* already over */ }
  if (setup.fresh) rested(t, pc.engineId);
  const units: Record<string, Unit> = {};
  let player = "";
  for (const c of setup.combatants) {
    let engineId: string;
    let weapons: string[];
    let weaponName: string | undefined;
    let parry: number | undefined;
    let speed: number | undefined;
    if (c.side === "player" && !player) {
      player = c.id;
      engineId = pc.engineId;
      const me = t.char(pc.engineId);
      if (!me) throw new Error("The player has no character in the rules engine to fight with.");
      const gone = new Set(pc.gone);
      const owned = me.inventory.filter(i => !gone.has(i) && content.items.get(t.state.itemInstances[i]?.definitionId ?? "")?.itemKind === "weapon");
      const real = owned.filter(i => t.state.itemInstances[i]?.definitionId !== "unarmed-strike");
      weapons = (real.length ? real : owned).sort((a, b) => Number(b === me.equipped.mainHand) - Number(a === me.equipped.mainHand));
    } else if (c.engine && t.char(c.engine.id)) {
      // One of the scene's people the rules have made already (docs/combat-gm.md): the same person, as hurt as they are.
      const me = t.char(c.engine.id)!;
      engineId = c.engine.id;
      weapons = [me.inventory.includes(c.engine.weapon) ? c.engine.weapon : me.equipped.mainHand ?? c.engine.weapon].filter((w): w is string => !!w);
    } else {
      const sb = statblockFor(c.statblock, c.weapon, content);
      const made = createNpc(t, c.name, sb);
      engineId = made.id;
      weapons = [made.weapon];
      weaponName = sb.weaponName;
      parry = sb.parry;
      speed = sb.speed;
    }
    const sheet = t.sheet(engineId);
    const ch = t.char(engineId)!;
    const look = looks[c.castId ?? ""];
    units[c.id] = {
      id: c.id, name: c.name, called: c.side === "player" ? "you" : calledName(c.name), side: c.side, role: defaultRole(c), engineId, weapons,
      ...(weaponName ? { weaponName } : {}), at: { ...c.at }, hp: Math.max(0, ch.hp.current), maxHp: ch.hp.max, ac: sheet.ac.total, speed: speed ?? sheet.speeds["walk"] ?? 30,
      initiative: 0, state: c.due ? "coming" : ch.hp.current > 0 ? "fighting" : "down", conditions: ch.appliedConditions.map(a => a.conditionId),
      ...(c.due ? { due: c.due, ...(c.why ? { why: c.why } : {}) } : {}),
      ...(parry ? { parry: { bonus: parry, ready: true } } : {}),
      glyph: c.glyph ?? look?.glyph ?? GLYPHS[c.castId ?? c.id] ?? (c.side === "player" ? "@" : letter(c)),
      color: look?.fg ?? COLOURS[c.castId ?? c.id] ?? COLOURS[c.side]!, ...(c.castId ? { castId: c.castId } : {}),
    };
  }
  if (!player) throw new Error("A fight needs the player in it.");
  // The encounter: everyone on the grid (5 ft a tile), initiative by the engine.
  // Who's coming (the scene's reinforcements) is in the encounter from the start, off the board until their round.
  const created = (t.kit.plan["createEncounter"] as unknown as (s: Dnd.CampaignState, i: Record<string, unknown>) => { events: Dnd.EngineEvent[]; encounterId: string })(t.state, {
    name: setup.title, combatants: Object.values(units).map((u, i) => ({ characterId: u.engineId, position: u.state === "coming" ? { x: -9000 - i * 10, y: -9000 } : toFeet(u.at) })),
  });
  t.apply(created.events);
  const encounterId = created.encounterId;
  const rolls = t.plan("rollInitiative", { encounterId });
  t.plan("startEncounter", { encounterId });
  t.plan("beginFirstTurn", { encounterId });
  const enc = t.encounter(encounterId)!;
  const byEngine = (id: string) => Object.values(units).find(u => u.engineId === id)!;
  for (const c of enc.combatants) byEngine(c.combatantId).initiative = c.initiative;
  const order = enc.combatants.map(c => byEngine(c.combatantId).id);
  const props: Record<string, Prop> = {};
  for (const a of setup.props ?? []) {
    const kind = /brazier/i.test(a.id + a.name) ? "brazier" : /lantern|lamp/i.test(a.id + a.name) ? "lantern" : "object";
    const carrier = a.ref ? Object.values(units).find(u => u.id === a.ref || u.castId === a.ref) : undefined;
    if (a.ref && !carrier) continue;
    props[a.id] = {
      id: a.id, name: a.name, kind, at: { ...(carrier?.at ?? a.at) }, ac: kind === "brazier" ? 19 : 12, hp: kind === "brazier" ? 10 : 1,
      lit: kind !== "object" && !(a.states ?? []).includes("out"), state: "standing", glyph: a.glyph, ...(carrier ? { carriedBy: carrier.id } : {}),
    };
  }
  const raw = (rolls[0]?.["rolls"] ?? []) as Array<{ combatantId: string; d20: number; modifier: number; total: number }>;
  const rolled = [...raw].sort((a, b) => order.indexOf(byEngine(a.combatantId).id) - order.indexOf(byEngine(b.combatantId).id))
    .map(r => ({ unit: byEngine(r.combatantId).id, d20: r.d20, modifier: r.modifier, total: r.total }));
  const exits = (setup.exits ?? map.exits).filter(e => !solid(map, e.at)).map(e => ({ at: { ...e.at }, label: e.label }));
  const board: FightBoard = {
    encounterId, units, order, active: enc.activeIndex, round: enc.round || 1,
    dust: (setup.dust ?? []).map(key), fire: [], fuel: (setup.fuel ?? []).map(key), props, exits, pc: player, flags: {}, place: setup.place,
    ...(setup.keep ? { keep: true } : {}), ...(setup.fast ? { fast: true } : {}), ...(setup.zoo ? { zoo: { ...setup.zoo } } : {}), ...(setup.time ? { time: setup.time } : {}),
    ...(setup.scene ? { scene: setup.scene } : {}), ...(setup.town ? { town: true } : {}),
  };
  return { board, rolled };
}

/** The player rested before a practice fight (a long rest on the fight's own copy of them): hit points and slots back, up off the floor. */
function rested(t: Table, pc: string): void {
  t.plan("longRest", { participantIds: [pc] });
  const me = t.char(pc)!;
  for (const a of me.appliedConditions.filter(a => a.conditionId === "prone" || a.conditionId === "unconscious")) t.apply([t.event("ConditionRemoved", { targetId: pc, conditionId: a.conditionId })]);
}

/** Someone's letter from their name: the other side's in capitals, the rest small. */
const letter = (c: CombatantSetup) => c.name.replace(/^(the|a|an) /i, "").charAt(0)[c.side === "enemy" ? "toUpperCase" : "toLowerCase"]();

/** The initiative line, as the prototype's log had it: "Initiative: you 14 +2 = 16; the wolf 12 +2 = 14". */
export function initiativeLine(rolled: Rolled[], board: FightBoard): string {
  return `Initiative: ${rolled.map(r => { const u = board.units[r.unit]!; return `${u.id === board.pc ? "you" : u.called} ${r.d20} ${r.modifier >= 0 ? "+" : "-"}${Math.abs(r.modifier)} = ${r.total}`; }).join("; ")}`;
}
