import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import type { SessionState } from "../../runtime/session.ts";
import type { CombatantSetup, CombatSetup } from "../types.ts";
import { flavour, hash } from "./flavour.ts";
import { key, solid, toFeet } from "./grid.ts";
import type { CombatG, LogLine, Prop, Role, Unit } from "./model.ts";
import { createNpc, statblockFor, STATBLOCKS, Table, type Kit } from "./rules.ts";

/**
 * Setting up a fight: the session's campaign (the player's character as the story left them), the
 * story people as engine characters (the same ones the scene runtime made for a blow, when it
 * did), an engine encounter with everyone placed on the grid, and initiative rolled by the engine.
 */

const GLYPHS: Record<string, string> = { player: "@", kell: "K", sallow: "S", "crake-1": "C", "crake-2": "c", "lantern-boy": "b", hep: "H" };
const COLOURS: Record<string, string> = { player: "#ffffff", ally: "#6fa8dc", enemy: "#e06666", neutral: "#b7b7b7", sallow: "#c27ba0", "lantern-boy": "#f1c232" };

/** "Master Josiah Sallow" → "Master Sallow"; "Sergeant Agnes Kell" → "Sergeant Kell"; "the talking Crake" stays. */
export function calledName(name: string): string {
  if (/^(the|a|an) /i.test(name)) return name.charAt(0).toLowerCase() + name.slice(1);
  const words = name.split(/\s+/);
  const titles = /^(master|mister|mr|mrs|sergeant|corporal|captain|king|queen|sir|lady|lord|dame|old|big|young)$/i;
  return words.length >= 3 && titles.test(words[0]!) ? `${words[0]} ${words.at(-1)}` : name;
}

function defaultRole(c: CombatantSetup): Role {
  if (c.role) return c.role as Role;
  if (c.side === "player") return "player";
  if (c.side === "ally") return "ally";
  if (c.side === "neutral") return "bystander";
  return c.statblock === "commoner" ? "coward" : "bruiser";
}

export function initialState(kit: Kit, setup: CombatSetup, session: SessionState): { G: CombatG; table: Table } {
  if (!session.rules) throw new Error("This session has no rules-engine character to fight with.");
  const { E, engine } = kit;
  const table = new Table(kit, E.loadCampaign(session.rules.campaign, engine));
  // A fight the story never closed (a crash mid-fight) shouldn't hold the turn.
  const active = table.state["activeEncounterId"] as string | undefined;
  if (active) try { table.plan("endEncounter", { encounterId: active, outcome: "parley" }); } catch { /* already over */ }
  const content = engine.content;
  const units: Record<string, Unit> = {};
  const pcId = session.rules.pc;
  let pc = "";
  for (const c of setup.combatants) {
    let engineId: string;
    let weapons: string[];
    let weaponName: string | undefined;
    let parry: number | undefined;
    let speed: number | undefined;
    if (c.side === "player" && !pc) {
      pc = c.id;
      engineId = pcId;
      const me = table.char(pcId)!;
      const gone = new Set(session.rules.gone ?? []);
      const owned = me.inventory.filter(i => !gone.has(i) && content.items.get(table.state.itemInstances[i]?.definitionId ?? "")?.itemKind === "weapon");
      const real = owned.filter(i => table.state.itemInstances[i]?.definitionId !== "unarmed-strike");
      weapons = (real.length ? real : owned).sort((a, b) => Number(b === me.equipped.mainHand) - Number(a === me.equipped.mainHand));
    } else {
      const sb = statblockFor(c.statblock, c.weapon, content);
      const known = c.castId ? session.rules.npcs[c.castId] : undefined;
      const existing = known ? table.char(known.id) : undefined;
      // The scene runtime may already have made them (a blow in the scene): the same person, if the same build.
      if (existing && known && existing.statblockId === sb.base && !STATBLOCKS[c.statblock ?? ""]) {
        engineId = known.id;
        weapons = [known.weapon];
      } else {
        const made = createNpc(table, c.name, sb);
        // Carry over any hurt from the scene into the new build.
        if (existing && existing.hp.current < existing.hp.max) {
          const lost = Math.min(existing.hp.max - existing.hp.current, (sb.hp ?? existing.hp.max) - 1);
          if (lost > 0) table.apply([table.event("DamageApplied", { targetId: made.id, components: [{ amount: lost, type: "bludgeoning" }], source: "earlier" })]);
        }
        engineId = made.id;
        weapons = [made.weapon];
      }
      weaponName = sb.weaponName;
      parry = sb.parry;
      speed = sb.speed;
    }
    const sheet = table.sheet(engineId);
    const ch = table.char(engineId)!;
    units[c.id] = {
      id: c.id, name: c.name, called: c.side === "player" ? "you" : calledName(c.name), side: c.side, role: defaultRole(c), engineId, weapons,
      ...(weaponName ? { weaponName } : {}), at: c.at, hp: Math.max(0, ch.hp.current), maxHp: ch.hp.max, ac: sheet.ac.total, speed: speed ?? sheet.speeds["walk"] ?? 30,
      initiative: 0, state: ch.hp.current > 0 ? "fighting" : "down", conditions: ch.appliedConditions.map(a => a.conditionId),
      ...(parry ? { parry: { bonus: parry, ready: true } } : {}),
      glyph: GLYPHS[c.castId ?? c.id] ?? (c.side === "player" ? "@" : c.name.replace(/^(the|a|an) /i, "").charAt(0)[c.side === "enemy" ? "toUpperCase" : "toLowerCase"]()),
      color: COLOURS[c.castId ?? c.id] ?? COLOURS[c.side]!, ...(c.castId ? { castId: c.castId } : {}),
    };
  }
  if (!pc) throw new Error("A fight needs the player in it.");
  // The encounter: everyone on the grid (5 ft a tile), initiative by the engine.
  const created = (kit.plan["createEncounter"] as unknown as (s: Dnd.CampaignState, i: Record<string, unknown>) => { events: Dnd.EngineEvent[]; encounterId: string })(table.state, {
    name: setup.map.name, combatants: Object.values(units).map(u => ({ characterId: u.engineId, position: toFeet(u.at) })),
  });
  table.apply(created.events);
  const encounterId = created.encounterId;
  const rolled = table.plan("rollInitiative", { encounterId });
  table.plan("startEncounter", { encounterId });
  table.plan("beginFirstTurn", { encounterId });
  const enc = table.encounter(encounterId)!;
  const byEngine = (id: string) => Object.values(units).find(u => u.engineId === id)!;
  for (const c of enc.combatants) byEngine(c.combatantId).initiative = c.initiative;
  const order = enc.combatants.map(c => byEngine(c.combatantId).id);
  const props: Record<string, Prop> = {};
  for (const a of setup.props ?? []) {
    const kind = /brazier/i.test(a.id + a.name) ? "brazier" : /lantern|lamp/i.test(a.id + a.name) ? "lantern" : "object";
    const carrier = a.ref ? Object.values(units).find(u => u.id === a.ref || u.castId === a.ref) : undefined;
    if (a.ref && !carrier) continue;
    props[a.id] = {
      id: a.id, name: a.name, kind, at: carrier?.at ?? a.at, ac: kind === "brazier" ? 19 : 12, hp: kind === "brazier" ? 10 : 1,
      lit: kind !== "object" && !(a.states ?? []).includes("out"), state: "standing", glyph: a.glyph, ...(carrier ? { carriedBy: carrier.id } : {}),
    };
  }
  const log: LogLine[] = [{ round: 1, kind: "system", text: "Roll for initiative!" }];
  const rolls = (rolled[0]?.["rolls"] ?? []) as Array<{ combatantId: string; d20: number; modifier: number; total: number }>;
  const shown = [...rolls].sort((a, b) => order.indexOf(byEngine(a.combatantId).id) - order.indexOf(byEngine(b.combatantId).id));
  log.push({ round: 1, kind: "dice", text: `Initiative: ${shown.map(r => { const u = byEngine(r.combatantId); return `${u.id === pc ? "you" : u.called} ${r.d20} ${r.modifier >= 0 ? "+" : "-"}${Math.abs(r.modifier)} = ${r.total}`; }).join("; ")}` });
  if (units["sallow"]) log.push({ round: 1, kind: "narration", text: flavour("draw:sallow", hash(setup.seed))!, who: "sallow" });
  if (setup.dust?.length) log.push({ round: 1, kind: "narration", text: `The grain dust hangs in the lantern light between the stacks like a golden fog, and everyone in ${setup.place ?? "the Heron"} is suddenly very aware of the lanterns.` });
  const map = setup.map;
  const exits = map.exits.filter(e => !solid(map, e.at)).map(e => ({ at: e.at, label: e.label }));
  const G: CombatG = {
    campaign: "", rev: 0, rng: kit.rng.state, encounterId, map, units, order, active: enc.activeIndex, round: enc.round || 1,
    dust: (setup.dust ?? []).map(key), fire: [], fuel: (setup.fuel ?? fuelFrom(setup)).map(key), props, log, exits, pc, flags: {}, seq: log.length,
    ...(setup.place ? { place: setup.place } : {}),
  };
  return { G, table };
}

/** What burns when the setup doesn't say: solid floor tiles that aren't walls (stacked sacks, crates). */
function fuelFrom(setup: CombatSetup): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < setup.map.height; y++) for (let x = 0; x < setup.map.width; x++) {
    const tile = setup.map.tiles[y]?.[x];
    if (tile && tile.terrain === "floor" && tile.blocks && (tile.height ?? 0) >= 1) out.push({ x, y });
  }
  return out;
}
