// After the prototype's src/game/combat/controller.ts at bc2ab1f: summarise (the story's version of how a fight went) as it is, with "yielded" for the player's own hands up, and writeBack's two halves at their seams: the engine's (the encounter closed, a fight's leftovers off the player, their hit points 0 at the least and stable) on the move's Table as the fight ends, and the rows' (rules_state's campaign and npcs, the sheet) only for a fight that keeps them (FightSetup.keep: the story's, later); the scene's world (placeInWorld) waits for the story's fights.
import { listing } from "../../../shared/fight/flavour.ts";
import type { FightBoard, FightResult, Unit } from "../../../shared/fight/types.ts";
import type { TxCtx } from "../context.ts";
import { playerRow, type RowOf } from "../rows.ts";
import { engineCall, sessionOf, writeSheet } from "../rules/session.ts";
import type { Skirmish } from "./skirmish.ts";

/**
 * A fight's end on the engine, as the move that ended it closes (the prototype's writeBack, its
 * engine half): the encounter closed; dodging and lying down end with the fight; the engine lets hit
 * points run below zero, and the story reads 0 (healed to 1 and the 1 taken again: healing starts
 * from 0); down means out cold but stable, for whatever comes next to bring round.
 */
export function closeEncounter(s: Skirmish): void {
  const t = s.t;
  const G = s.G;
  try { t.plan("endEncounter", { encounterId: G.encounterId, outcome: G.outcome === "surrender" || G.outcome === "yielded" ? "parley" : G.outcome }); } catch { /* already over */ }
  const pc = t.char(s.pc().engineId);
  if (!pc) return;
  const transient = pc.appliedConditions.filter(a => ["dodged", "prone"].includes(a.conditionId));
  if (transient.length) t.apply(transient.map(a => t.event("ConditionRemoved", { targetId: pc.id, conditionId: a.conditionId })));
  if (pc.hp.current < 0) t.apply([t.event("Healed", { targetId: pc.id, amount: 1, source: "fight-ended" }), t.event("DamageApplied", { targetId: pc.id, components: [{ amount: 1, type: "bludgeoning" }], source: "fight-ended" })]);
  const now = t.char(pc.id)!;
  if (now.hp.current <= 0 && !now.deathSaves.stable) t.apply([t.event("Stabilized", { targetId: pc.id })]);
}

/**
 * How it went, for the rows as the fight ends: the result (summarise), and for a fight that keeps
 * the player (the story's, later), their character as the fight left them: rules_state's campaign
 * (the fight's, its encounter closed), the cast it made kept by their cast ids, and the sheet.
 */
export function ended(tx: TxCtx, fight: RowOf<"fight">, G: FightBoard, campaign: string): FightResult {
  const result = summarise(G);
  if (!G.keep) return result;
  const host = playerRow(tx, fight.playerId);
  const state = tx.db.rulesState.playerId.find(host.id);
  if (!state) return result;
  const npcs = JSON.parse(state.npcs || "{}") as Record<string, { id: string; weapon: string }>;
  for (const u of Object.values(G.units)) if (u.castId && u.id !== G.pc) npcs[u.castId] = { id: u.engineId, weapon: u.weapons[0] ?? "" };
  tx.db.rulesState.playerId.update({ ...state, campaign, npcs: JSON.stringify(npcs) });
  const session = sessionOf(tx, host);
  engineCall(tx, fight.gameId, rules => writeSheet(tx, host, session, rules));
  return result;
}

const people = (us: Unit[]) => listing(us.map(u => u.called));

/** The story's version of how it went (the prototype's summarise), and the same told to the player. */
export function summarise(G: FightBoard): FightResult {
  const story = howItWent(G, false);
  const told = howItWent(G, true);
  const units = Object.values(G.units);
  const walked = (u: Unit) => !!G.flags[`walked:${u.id}`];
  const casualties = units.filter(u => u.id !== G.pc).map(u => ({ id: u.castId ?? u.id, name: u.name, state: u.state === "fighting" ? "standing" as const : u.state }));
  const flags: Record<string, string | number | boolean> = {};
  for (const k of ["dust_exploded", "fire", "lit_by", "pc_dying"]) if (G.flags[k] !== undefined) flags[k] = G.flags[k]!;
  if (G.flags["fire"]) flags["heron_burned"] = true;
  for (const u of units) if (u.castId && u.id !== G.pc) flags[u.castId] = u.arrested ? "arrested" : walked(u) ? "walked off" : u.state === "fighting" ? "standing" : u.state;
  const rounds = G.round;
  const positions = Object.fromEntries(units.map(u => [u.id === G.pc ? "player" : u.castId ?? u.id, { ...u.at }]));
  return { outcome: G.outcome!, summary: story, told, casualties, rounds, flags, positions };
}

/** How it went in sentences: for the story ("The player was knocked out"), or told to the player (`you`: "You were knocked out"). */
function howItWent(G: FightBoard, you: boolean): string {
  const units = Object.values(G.units);
  const pc = G.units[G.pc]!;
  const sentences: string[] = [];
  const villain = units.find(u => u.role === "villain");
  const fate = (u: Unit) => u.state === "surrendered" ? `surrendered${u.arrested ? " and Kell arrested him" : ""}` : u.state === "fled" ? "ran for it and got away" : u.state === "dead" ? "was killed" : u.state === "down" ? `was beaten senseless${u.arrested ? " and Kell put the irons on him" : ""}` : "was still on his feet at the end";
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const place = G.place;
  if (G.flags["dust_exploded"]) sentences.push(`The grain dust exploded (set off by ${G.flags["lit_by"] === "player" ? (you ? "you" : "the player") : String(G.flags["lit_by"] ?? "the fire")}), and ${place} is on fire`);
  else if (G.flags["fire"]) sentences.push(`Fire got into the sacks, and ${place} is burning`);
  if (villain) sentences.push(`${cap(villain.called)} ${fate(villain)}`);
  const hired = units.filter(u => u.side === "enemy" && u !== villain && u.role !== "coward");
  const walked = (u: Unit) => !!G.flags[`walked:${u.id}`];
  const by = (state: Unit["state"]) => hired.filter(u => u.state === state && !walked(u));
  const asleep = by("fighting").filter(u => u.conditions.includes("unconscious")), awake = by("fighting").filter(u => !asleep.includes(u));
  const parts = [
    by("down").length ? `${people(by("down"))} went down` : "", by("dead").length ? `${people(by("dead"))} died` : "",
    by("surrendered").length ? `${people(by("surrendered"))} gave up` : "", by("fled").length ? `${people(by("fled"))} ran` : "",
    hired.some(walked) ? `${people(hired.filter(walked))} walked off once nobody was paying them` : "",
    awake.length ? `${people(awake)} kept fighting` : "",
    asleep.length ? `${people(asleep)} slept through the end of it` : "",
  ].filter(Boolean);
  if (parts.length) sentences.push(cap(parts.join("; ")));
  const coward = units.find(u => u.role === "coward");
  if (coward) sentences.push(coward.state === "fled" ? `${cap(coward.called)} ran` : `${cap(coward.called)} ${coward.state === "fighting" ? "hid" : coward.state === "down" ? "was knocked flat" : coward.state}`);
  for (const ally of units.filter(u => u.side === "ally")) sentences.push(`${cap(ally.called)} ${ally.state === "down" ? "went down, and came round after" : !ally.wounded ? "came through unhurt" : ally.hp * 2 <= ally.maxHp ? "was badly hurt" : "was hurt"}`);
  const near = G.flags["pc_dying"];
  const they = you ? { were: "You were", put: "You put your hands up", got: "You got out", ended: "You ended the fight" } : { were: "The player was", put: "The player put their hands up", got: "The player got out", ended: "The player ended the fight" };
  sentences.push(G.outcome === "yielded" ? `${they.put}, on ${pc.hp} of ${pc.maxHp} hit points` : pc.state === "down" ? `${they.were} knocked out${near ? " and very nearly died" : ""}` : pc.state === "fled" ? they.got : `${they.ended} on ${pc.hp} of ${pc.maxHp} hit points`);
  const rounds = G.round;
  return `${sentences.join(". ")}. It took ${rounds} round${rounds === 1 ? "" : "s"}.`;
}
