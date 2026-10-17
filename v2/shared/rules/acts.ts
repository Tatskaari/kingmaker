// Copied from the prototype's src/rules/dnd.ts at 44c6d4a: lines 102-108 (missesMiss), 911-1059, 1061-1106 but castable, 1191-1452, 1454-1459, 1520-1763, 1774-1863, 1885-1946 and 1994-2027. The usual edits (world-bridge-design §2): SessionState is RulesSession; each act takes the Rules its host loaded first and none awaits (await open(state) is opened(rules, state), close takes the Rules, and jumpReach reads the sheet with reading(rules, state)); Outcome is RulesOutcome (the protocol has an Outcome); SpellChoice and WeaponChoice are types.ts's SpellRef and WeaponRef. The helpers dnd.ts shares with the character's code (close, refresh, sheetOf, status, readySpells, endRage, resolveChoices, grantResources, moreSpells, CASTING, cantripsAt, rollFor, FEATURES) are character.ts's, and spellFactsOf (src/app/game.ts:1840-1851) is too, so sheetRows can call it without the two modules importing each other: it's re-exported here. areaPlacement (1357-1366) is shared/rules/aim.ts's (the town unit's: the map's aim runs it on the client, which never loads this file), re-exported here.
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { describeRoll, rng, type RollResult } from "../dice.ts";
import type { Character } from "../scene/types.ts";
import { caughtIn, damageThing, positionOf, within, type Entity, type SceneWorld } from "../world/scene-world.ts";
import { bleed, elemental, spill } from "../world/systems.ts";
import { CASTING, cantripsAt, close, endRage, FEATURES, grantResources, moreSpells, readySpells, refresh, resolveChoices, rollFor, sheetOf, status } from "./character.ts";
import { ABILITY_NAME, event, opened, ordinal, reading, signed, type Ctx } from "./engine.ts";
import { areaPlacement } from "./aim.ts";
import { RAYS } from "./spells.ts";
import type { Rules, RulesSession, SpellRef, WeaponRef } from "./types.ts";

export { spellFactsOf } from "./character.ts";
export { areaPlacement } from "./aim.ts";

/**
 * The D&D rules' acts in a scene (world-bridge-design §2.1): a spell, a blow, a grab or a shove, a
 * jump, a class feature, a rest; a blow or a danger landing on the player; story time passing (a
 * spell running out, a Rage burning down); a level gained; and what the rules say of the spells
 * ready, for the scene's menu. Each works on a RulesSession whose world is the scene's place,
 * changes the world and the character in place as the prototype's do, and says what the dice
 * decided: its lines for the transcript, and the GM's directive. The simulation runs each in a
 * commit, pinned (pin.ts withEngine), and writes back what changed. Not re-exported by index.ts, so
 * the client never loads it.
 */

/** What an act came to (dnd.ts's Outcome). */
export interface RulesOutcome {
  /** Dice lines for the player: the transcript's roll entries. */
  lines: string[];
  /** What happened, for the GM to narrate. */
  directive: string;
  /** The player's status after it, when it changed. */
  status?: string;
  /** A danger's saving throw: whether the player saved. */
  saved?: boolean;
  /** It put the player down (0 hit points): what they meant to do this turn doesn't happen. */
  down?: boolean;
  /** The player's Shield went up against it (a reaction: their turn doesn't cast it again). */
  shielded?: boolean;
}

/** The engine deals half damage on a spell attack that missed (a missed Fire Bolt still burns): a miss is a miss. */
function missesMiss(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
  const missed = new Set(events.filter(e => e.type === "AttackRolled" && e["hit"] === false).map(e => String(e["targetId"])));
  if (!missed.size) return events;
  const dropped = new Set(events.filter(e => e.type === "DamageRolled" && missed.has(String(e["targetId"])) && events.some(a => a.type === "AttackRolled" && a.id === e["causedByEventId"] && a["hit"] === false)).map(e => e.id));
  return events.filter(e => !dropped.has(e.id) && !(e.type === "DamageApplied" && dropped.has(String(e["causedByEventId"]))));
}

// ---------------------------------------------------------------------------------------------
// Story characters in the rules: stats from an SRD statblock, made the first time they're needed.

/** Default weapons for statblocks whose SRD actions the starter pack doesn't carry as items. */
const STATBLOCK_WEAPON: Record<string, string> = {
  commoner: "club", guard: "spear", "guard-captain": "longsword", tough: "mace", "tough-boss": "warhammer", noble: "rapier",
  spy: "shortsword", bandit: "scimitar", "bandit-captain": "scimitar", "warrior-infantry": "spear", "warrior-veteran": "longsword",
  knight: "greatsword", priest: "mace", "priest-acolyte": "club", mage: "dagger", scout: "shortsword", pirate: "dagger",
  "pirate-captain": "rapier", cultist: "ritual-sickle", "cultist-fanatic": "dagger", mastiff: "mastiff-bite", wolf: "wolf-bite",
};

function ensureNpc(ctx: Ctx, state: RulesSession, who: Character): string {
  const known = state.rules!.npcs[who.id];
  if (known && ctx.campaign.state.characters[known.id]) return known.id;
  const content = ctx.engine.content;
  const statblockId = who.statblock && content.monsters.has(who.statblock) ? who.statblock : "commoner";
  const sb = content.monsters.get(statblockId)!;
  const weaponId = who.weapon && content.items.has(who.weapon) ? who.weapon : STATBLOCK_WEAPON[statblockId] && content.items.has(STATBLOCK_WEAPON[statblockId]!) ? STATBLOCK_WEAPON[statblockId]! : "club";
  const { E } = ctx;
  const npc = E.CharacterSchema.parse({
    id: E.newCharacterId(), kind: "creature", statblockId, name: who.name, speciesId: "human", backgroundId: "soldier",
    // A level-1 fighter enrolment gives humanoid NPCs the +2 proficiency their statblock attacks assume.
    classes: [{ classId: "fighter", level: 1, hitDiceRemaining: 1 }],
    abilityScores: sb.abilityScores, hp: { current: sb.hp.average, max: sb.hp.average, temp: 0 }, armorClass: sb.ac,
  });
  const weapon = { id: E.newItemInstanceId(), definitionId: weaponId, quantity: 1, attuned: false, identifiedByCharacterIds: [] };
  ctx.apply([event(E, "CharacterCreated", { snapshot: npc }), event(E, "ItemAcquired", { instance: weapon, characterId: npc.id })]);
  try { ctx.apply(ctx.engine.plan.equip(ctx.campaign.state, { characterId: npc.id, instanceId: weapon.id, slot: "mainHand" }).events); } catch { /* natural weapons aren't held */ }
  state.rules!.npcs[who.id] = { id: npc.id, weapon: weapon.id };
  return npc.id;
}

/** The SRD's conditions, which someone is (prone, grappled), as against what a feature gives them (Bardic Inspiration). */
const SRD_CONDITIONS = new Set(["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "dodged", "dodging", "raging", "concentrating"]);

/** How someone looks after a hit, in words: the GM narrates it, the player never sees NPC hit points. */
function hurt(c: Dnd.EngineCharacter): string {
  if (c.hp.current <= 0) return "down";
  if (c.hp.current >= c.hp.max) return "unhurt";
  return c.hp.current * 2 <= c.hp.max ? "badly hurt" : "hurt";
}

const possessive = (name: string) => /s$/.test(name) ? `${name}'` : `${name}'s`;

/** A story character as the player knows them: by name once they've heard it, else what they call them. */
const calledBy = (state: RulesSession, c: Character) => state.rules?.aliases?.[c.id] ?? c.name;

function nameOf(ctx: Ctx, state: RulesSession, id: string): string {
  if (id === state.rules!.pc) return "you";
  // Someone whose name the player hasn't heard goes by what they call them.
  const castId = Object.entries(state.rules!.npcs).find(([, v]) => v.id === id)?.[0];
  return (castId && state.rules!.aliases?.[castId]) || (ctx.campaign.state.characters[id]?.name ?? "someone");
}

/** A damage roll in the engine's DamageRolled: its expression is the base dice ("2d6"), its rolls every die rolled. */
export interface DamageRoll { expression: string; rolls: number[]; modifier: number; type: string }

/**
 * "Damage: 4d6 (3+1+1+6) fire": the dice as many as were rolled, which is more than the expression
 * says on a critical hit (doubled) and for a cantrip that's grown with the caster's level.
 */
export function damageLine(rolls: DamageRoll[]): string {
  const dice = (r: DamageRoll) => {
    const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(r.expression.replace(/\s/g, ""));
    return m && r.rolls.length > Number(m[1]) ? `${r.rolls.length}d${m[2]}${m[3] ?? ""}` : r.expression;
  };
  return `Damage: ${rolls.map(r => `${dice(r)}${r.modifier ? signed(r.modifier) : ""} (${r.rolls.join("+")}${r.modifier ? signed(r.modifier) : ""}) ${r.type}`).join(" + ")}`;
}

/** Dice lines and a plain account of a planner's events. */
function describe(ctx: Ctx, state: RulesSession, events: Dnd.EngineEvent[], weaponName: (id: string) => string): { lines: string[]; account: string[] } {
  const lines: string[] = [];
  const account: string[] = [];
  const chars = () => ctx.campaign.state.characters;
  for (const e of events) {
    const who = (k: string) => nameOf(ctx, state, String(e[k]));
    switch (e.type) {
      case "AttackRolled": {
        const d20 = (e["d20"] as number[]).join("/");
        const adv = e["used"] && e["used"] !== "none" ? ` (${e["used"]})` : "";
        const verdict = e["critical"] ? "critical hit!" : e["hit"] ? "hit" : "miss";
        lines.push(`${weaponName(String(e["weaponInstanceId"]))}: ${who("attackerId") === "you" ? "your attack on" : `${possessive(who("attackerId"))} attack on`} ${who("targetId")}: ${d20}${adv} ${signed(Number(e["attackBonus"]))} = ${e["total"]} vs AC ${e["targetAC"]}: ${verdict}`);
        account.push(`${who("attackerId")} ${e["hit"] ? (e["critical"] ? "landed a critical hit on" : "hit") : "missed"} ${who("targetId")} (${weaponName(String(e["weaponInstanceId"]))})`);
        break;
      }
      case "DamageRolled": {
        lines.push(damageLine(e["rolls"] as DamageRoll[]));
        break;
      }
      case "DamageApplied": {
        const amount = (e["components"] as Array<{ amount: number; type: string }>).map(c => `${c.amount} ${c.type}`).join(" and ");
        const target = chars()[String(e["targetId"])];
        const isPc = String(e["targetId"]) === state.rules!.pc;
        // The engine lets hit points run below zero; the story reads 0.
        lines.push(`${isPc ? "You take" : `${target ? who("targetId") : "They"} takes`} ${amount} damage${isPc && target ? ` (HP ${Math.max(0, target.hp.current)}/${target.hp.max})` : target ? ` (${hurt(target)})` : ""}`);
        account.push(`${isPc ? "the player" : target ? who("targetId") : "the target"} took ${amount} damage${target ? `, now ${isPc ? `${Math.max(0, target.hp.current)}/${target.hp.max} HP` : hurt(target)}` : ""}`);
        break;
      }
      case "SaveRolled": {
        const d20 = (e["d20"] as number[]).join("/");
        const target = String(e["targetId"]) === state.rules!.pc ? "Your" : chars()[String(e["targetId"])] ? possessive(who("targetId")) : "Their";
        const ability = ABILITY_NAME[e["ability"] as Dnd.Ability] ?? String(e["ability"]);
        lines.push(`${target} ${ability} save: ${d20} ${signed(Number(e["bonus"]))} = ${e["total"]} vs DC ${e["dc"]}: ${e["success"] ? "saved" : "failed"}`);
        account.push(`${target === "Your" ? "the player's" : target} ${ability} save ${e["success"] ? "succeeded" : "failed"}`);
        break;
      }
      case "ConditionApplied": {
        const condition = ctx.engine.content.conditions.get(String(e["conditionId"]))?.name ?? String(e["conditionId"]);
        if (/active$/i.test(condition)) break;
        const you = who("targetId") === "you";
        // The SRD's conditions are states (prone, grappled), and so are the likes of Blessed and Hasted;
        // the rest are what a feature or a spell gives (Bardic Inspiration, Innate Sorcery, Hunter's Mark).
        if (SRD_CONDITIONS.has(String(e["conditionId"])) || /^\w+(ed|ing)\b|^heroic$/i.test(condition)) {
          lines.push(`${you ? "You are" : `${who("targetId")} is`} ${condition.toLowerCase()}`);
          account.push(`${you ? "the player" : who("targetId")} is now ${condition.toLowerCase()}`);
        } else {
          lines.push(`${you ? "You have" : `${who("targetId")} has`} ${condition}`);
          account.push(`${you ? "the player" : who("targetId")} now has ${condition}`);
        }
        break;
      }
      case "Healed": {
        const target = chars()[String(e["targetId"])];
        lines.push(`${who("targetId") === "you" ? "You regain" : `${who("targetId")} regains`} ${e["amount"]} HP${target && who("targetId") === "you" ? ` (HP ${target.hp.current}/${target.hp.max})` : ""}`);
        account.push(`${who("targetId")} regained ${e["amount"]} HP`);
        break;
      }
      case "ConcentrationStarted":
        account.push("the caster is concentrating on the spell");
        break;
    }
  }
  return { lines: lines.map(l => l.charAt(0).toUpperCase() + l.slice(1)), account };
}

// ---------------------------------------------------------------------------------------------
// Spells.

/** A spell ready to cast (types.ts SpellRef). */
export type SpellChoice = SpellRef;

/** A warlock's pact slots (all of one level, back on a short rest), when the sheet has them. */
export function pactOf(sheet: Dnd.CharacterSheet): { level: number; count: number } | undefined {
  const pact = (sheet.spellSlots as { pactSlots?: { level: number; count: number } }).pactSlots;
  return pact?.count ? pact : undefined;
}

/**
 * The slot a spell of this level would be cast from: the lowest free slot at its level or above,
 * else a warlock's pact slot (cast at the pact's level). 0 when there's none left.
 */
export function slotFor(sheet: Dnd.CharacterSheet, me: Dnd.EngineCharacter, level: number): number {
  const free = (l: number) => (sheet.spellSlots.slotsByLevel[l - 1] ?? 0) - (me.spellSlotsUsed[String(l)] ?? 0);
  const slot = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(l => l >= level && free(l) > 0);
  if (slot) return slot;
  const pact = pactOf(sheet);
  return pact && pact.level >= level && pact.count - Number(me["pactSlotsUsed"] ?? 0) > 0 ? pact.level : 0;
}

const SLOT_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };

/**
 * The slot level the player's words ask a spell to be cast from: "at second level", "a 3rd-level
 * slot", "upcast to 2nd"; "my strongest (highest, biggest, best) slot" is the highest they have free.
 */
export function askedSlot(sheet: Dnd.CharacterSheet, me: Dnd.EngineCharacter, said: string | undefined): number | undefined {
  const text = (said ?? "").toLowerCase();
  const m = /\b(1st|2nd|3rd|[4-9]th|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)[- ](?:level|circle)\b/.exec(text);
  if (m) return SLOT_WORDS[m[1]!] ?? Number.parseInt(m[1]!, 10);
  if (!/\b(?:strongest|highest|biggest|best|most powerful|top)\s+(?:remaining\s+|spell\s+)?slot\b/.test(text)) return undefined;
  const free = (l: number) => (sheet.spellSlots.slotsByLevel[l - 1] ?? 0) - (me.spellSlotsUsed[String(l)] ?? 0);
  return [9, 8, 7, 6, 5, 4, 3, 2, 1].find(l => free(l) > 0);
}

/**
 * What a spell asks its caster to choose, which the engine won't cast it without: the element
 * (Chromatic Orb, Sorcerous Burst) or the way it works (Command's word, Hex's ability). The one the
 * player's words name (`said`), when they name one; else an element is fire where fire's allowed
 * (it's what the world's things feel), else the first on offer. A way isn't guessed: that would
 * cast it a way the player didn't say (see spellVariants).
 */
export function casterChoice(spell: Dnd.SpellDef, said = ""): { kind: "damageType" | "variant"; value: string } | undefined {
  const named = (keys: string[]) => keys.find(k => [k, ABILITY_NAME[k as Dnd.Ability]].some(w => w && new RegExp(`\\b${w.replace(/-/g, "[- ]").replace(/s\b/g, "'?s")}\\b`, "i").test(said)));
  for (const m of spell.mechanicalEffects ?? []) {
    const allowed = ((m["casterChoosesDamageType"] ?? m["damageTypeChoice"]) as { allowed?: string[] } | undefined)?.allowed;
    if (allowed?.length) return { kind: "damageType", value: named(allowed) ?? (allowed.includes("fire") ? "fire" : allowed[0]!) };
    const way = named(spellVariants(spell) ?? []);
    if (way) return { kind: "variant", value: way };
  }
  return undefined;
}

/** The ways a spell can be cast that its caster must choose between (Command's word, Hex's ability), when it has them. */
export function spellVariants(spell: Dnd.SpellDef): string[] | undefined {
  for (const m of spell.mechanicalEffects ?? []) {
    const variants = (m["casterChoosesVariant"] as { variants?: Array<{ key: string }> } | undefined)?.variants;
    if (variants?.length) return variants.map(v => v.key);
  }
  return undefined;
}

/**
 * Cast one of the player's spells at story characters (or themselves, or nobody in particular).
 * `said`: the player's words, for what the spell asks them to choose (an element, which way).
 */
export function castSpell(rules: Rules, state: RulesSession, cast: Character[], spellId: string, targetIds: string[], options: { ritual?: boolean; said?: string; unclear?: boolean } = {}): RulesOutcome {
  const ctx = opened(rules, state);
  const pcId = state.rules!.pc;
  const spell = ctx.engine.content.spells.get(spellId);
  const me = ctx.campaign.state.characters[pcId]!;
  const ready = spell && readySpells(sheetOf(ctx, pcId)).some(sp => sp.id === spellId);
  if (!spell || !ready) {
    close(rules, state, ctx);
    const what = spell?.name ?? "that spell";
    return { lines: [`(${what === "that spell" ? "That isn't a spell" : `${what} isn't a spell`} ${state.player.name} has ready: /sheet shows what they have.)`], directive: `The player reached for magic their character doesn't have ready (${what}). It doesn't come: nothing happens beyond a gesture, maybe a fizzle. Say so in a few words, in the fiction, without inventing any effect, and let them choose something else.` };
  }
  // Aimed at something, but at what wasn't clear: say which, and nothing's spent.
  if (options.unclear && !targetIds.length && !/^self\b/i.test(spell.range)) {
    close(rules, state, ctx);
    return { lines: [`(${spell.name}: at what? Say what it's aimed at.)`], directive: `The player cast ${spell.name}, but what at wasn't clear. Nothing happens yet and nothing is spent: ask them what they're aiming it at, in a few words.` };
  }
  // A ritual takes ten minutes longer and no slot (if the spell is one).
  const ritual = options.ritual === true && spell.ritual;
  // What the spell asks its caster to choose (an element, which way), when it asks.
  const choice = casterChoice(spell, options.said);
  const ways = spellVariants(spell);
  if (ways && !choice) {
    close(rules, state, ctx);
    const list = ways.map(w => ABILITY_NAME[w as Dnd.Ability] ?? w.replace(/-/g, " ")).join(", ");
    return { lines: [`(${spell.name} is cast one of ${ways.length} ways: ${list}. Say which.)`], directive: `The player cast ${spell.name} without saying which way it works (${list}). Nothing happens yet and nothing is spent: ask them which, in a few words.` };
  }
  let slotLevel = ritual ? spell.level : 0;
  if (spell.level > 0 && !ritual) {
    // From a higher slot when the player's words ask for one ("at second level", "my strongest slot").
    slotLevel = slotFor(sheetOf(ctx, pcId), me, Math.max(spell.level, askedSlot(sheetOf(ctx, pcId), me, options.said) ?? 0));
    if (!slotLevel) slotLevel = slotFor(sheetOf(ctx, pcId), me, spell.level);
    if (!slotLevel) {
      close(rules, state, ctx);
      const pact = !!pactOf(sheetOf(ctx, pcId));
      return { lines: [`(No spell slots left for ${spell.name}: ${pact ? "a short rest restores pact slots" : "a long rest restores them"}.)`], directive: `The player tried to cast ${spell.name}, but their character has no spell slots left for it. The magic doesn't come; show that in a few words and let them do something else.` };
    }
  }
  // Who and what it reaches: an area spell catches everything in its shape (the world knows where
  // things are); otherwise its targets. People go to the engine; things take the rules here.
  const world = state.world;
  let beings = targetIds.filter(t => t === "self" || t === "player" || cast.some(c => c.id === t) || isBeingEntity(world?.entities[t]));
  let things: Entity[] = world ? targetIds.map(t => world.entities[t]).filter((e): e is Entity => !!e && isThingEntity(e)) : [];
  let surfaces: Entity[] = world ? targetIds.map(t => world.entities[t]).filter((e): e is Entity => !!e && e.kind === "surface") : [];
  let area: string | undefined;
  const shape = spell["targeting"] as { shape: string; size: number } | undefined;
  if (world && shape) {
    const aimId = targetIds.find(t => t !== "self" && t !== "player" && world.entities[t]);
    const fromCaster = /^self/i.test(spell.range);
    const { origin, centre } = areaPlacement(world, shape, fromCaster, aimId ? positionOf(world, aimId) : undefined);
    const caught = caughtIn(world, shape.shape, shape.size, origin, centre);
    beings = caught.filter(e => e.kind === "person" || e.kind === "creature").map(e => e.player ? "player" : e.id);
    if (fromCaster) beings = beings.filter(b => b !== "player");
    things = caught.filter(isThingEntity);
    surfaces = caught.filter(e => e.kind === "surface");
    area = `a ${shape.size}-foot ${shape.shape}${aimId ? ` ${fromCaster ? "towards" : "on"} ${state.rules!.aliases?.[aimId] ?? world.entities[aimId]!.name}` : ""}`;
  }
  const people = beings.map(b => b === "self" || b === "player" ? { id: "player", engine: pcId } : (() => {
    const c = cast.find(x => x.id === b) ?? (world?.entities[b] ? bystander(world.entities[b]!) : undefined);
    return c ? { id: b, engine: ensureNpc(ctx, state, c) } : undefined;
  })()).filter((x): x is { id: string; engine: string } => !!x);
  let events: Dnd.EngineEvent[] = [];
  // A zone (Zone of Truth, Silence...) sits somewhere: where it's aimed, or where the caster stands (in 5-foot squares).
  const aimAt = world ? positionOf(world, targetIds.find(t => world.entities[t]) ?? "player") : undefined;
  const targetPosition = aimAt ? { x: Math.round(aimAt.x / 5), y: Math.round(aimAt.y / 5) } : { x: 0, y: 0 };
  // Rays and beams (Scorching Ray, Eldritch Blast) are an attack each, shared out among whoever's aimed at.
  const rays = RAYS[spell.id]?.(slotLevel, sheetOf(ctx, pcId).totalLevel);
  const aimed = rays && people.length ? Array.from({ length: rays }, (_, i) => people[i % people.length]!.engine) : people.map(p => p.engine);
  try {
    events = ctx.apply(missesMiss(ctx.engine.plan.castSpell(ctx.campaign.state, { characterId: pcId, spellId, slotLevel, targetIds: aimed, ...(ritual ? { asRitual: true } : {}), ...((spell.mechanicalEffects ?? []).some(m => /zone/i.test(String(m["kind"]))) || /zone|silence|darkness|fog/i.test(spell.id) ? { targetPosition } : {}), ...(choice ? { casterChoice: choice } : {}) }).events));
  } catch (error) {
    // Aimed only at things: the engine wants a creature, so spend the slot ourselves.
    if (!things.length) {
      close(rules, state, ctx);
      const why = error instanceof Error ? error.message : String(error);
      return { lines: [`(${spell.name} can't be cast like that: ${why})`], directive: `The player tried to cast ${spell.name}, but it can't work that way (${why}). Nothing happens; say so briefly in the fiction.` };
    }
    if (slotLevel) ctx.apply([event(ctx.E, "SpellSlotConsumed", { characterId: pcId, slotLevel })]);
  }
  const { lines, account } = describe(ctx, state, events, () => spell.name);
  // Things: they don't dodge or save; an attack spell still has to hit.
  if (world && things.length) {
    const hit = objectDamage(ctx, state, world, spell, slotLevel, things, choice?.kind === "damageType" ? choice.value : undefined);
    lines.push(...hit.lines);
    account.push(...hit.account);
  }
  // The world's physics: the spell's element meets the surfaces it reached, and some spells make one.
  if (world) {
    const element = String((spell.mechanicalEffects ?? []).find(m => m["damageType"])?.["damageType"] ?? (choice?.kind === "damageType" ? choice.value : ""));
    const physics = [...(element ? elemental(world, surfaces, element, state.turn) : []), ...spellSurface(world, spell.id, targetIds, state.turn)];
    lines.push(...physics);
    account.push(...physics.map(p => p.toLowerCase()));
  }
  if (world) syncBeings(ctx, state, world, people);
  // What a sensing spell senses is the world's: on the map there's no GM to say it.
  const sensed = world ? sensing(world, spell.id) : undefined;
  if (sensed) { lines.push(sensed); account.push(sensed.toLowerCase()); }
  if (events.some(e => /^(ConcentrationStarted|SpellEffectStarted|ConditionApplied)$/.test(e.type))) state.rules!.timed = true;
  const statusText = status(ctx, pcId);
  close(rules, state, ctx);
  const named = [...people.map(p => nameOf(ctx, state, p.engine)), ...things.map(t => t.name)];
  const head = `${spell.name}${ritual ? " (as a ritual: ten minutes, no slot)" : slotLevel ? ` (${ordinal(slotLevel)}-level slot)` : " (cantrip)"}${area ? `: ${area}` : named.length ? ` on ${named.join(", ")}` : ""}`;
  const facts = `${spell.name}: ${spell.level ? `${ordinal(spell.level)}-level` : "cantrip"} ${spell.school}; casting time ${spell.castingTime}; range ${spell.range}; duration ${spell.duration}${spell.concentration ? " (concentration)" : ""}`;
  return {
    lines: [`Cast ${head}${area && named.length ? `, catching ${named.join(", ")}` : ""}`, ...lines, ...(slotLevel && !ritual ? [`${state.player.name}: ${statusText}`] : [])],
    directive: `Rules: the player cast ${head}${area ? `, which caught ${named.join(", ") || "nobody and nothing"}` : ""}. ${account.length ? `${capitalise(account.join("; "))}.` : "It has no roll: it simply takes effect as the spell describes."} Narrate exactly this, in the fiction: what working the spell looks and sounds like here, its effect as the rules describe it (${facts}), and how the people present react to someone casting a spell at all. The world already shows what it burned or broke. Don't add effects the spell doesn't have.`,
    status: statusText,
  };
}

/** What Detect Magic finds within its 30 feet: what the world tags magic (nothing in Caerwyn is, yet). */
function sensing(world: SceneWorld, spellId: string): string | undefined {
  if (spellId !== "detect-magic") return undefined;
  const found = within(world, "player", 30, e => e.tags.includes("magic") || e.tags.includes("magical")).map(e => e.name);
  return found.length ? `You sense magic within 30 feet: ${found.join(", ")}` : "You sense no magic within 30 feet";
}

const isThingEntity = (e: Entity) => e.kind === "object" || e.kind === "item" || e.kind === "feature";
/** Someone in the world who isn't the player: a person, or a creature (a goose has hit points too). */
const isBeingEntity = (e: Entity | undefined): e is Entity => !!e && (e.kind === "person" || e.kind === "creature") && !e.player;

/** Spells that make a surface: water from nowhere, a patch of grease. */
function spellSurface(world: SceneWorld, spellId: string, targetIds: string[], turn: number): string[] {
  const aim = targetIds.find(t => world.entities[t]) ?? "player";
  const at = positionOf(world, aim);
  if (!at) return [];
  if (spellId === "create-or-destroy-water") return ["Water pours out of the air", ...spill(world, "water", at, 6, turn).lines];
  if (spellId === "grease") return ["A slick of grease spreads over the floor", ...spill(world, "grease", at, 5, turn).lines];
  return [];
}

/** Someone the story brought in who isn't in the cast (a crowd, a passer-by): a commoner, for the rules. */
export function bystander(e: Entity): Character {
  return { id: e.id, name: e.name, look: e.description ?? "", voice: "", wants: "", knows: [], attitude: "", statblock: e.stats?.statblock ?? (e.kind === "creature" ? "mastiff" : "commoner"), ...(e.stats?.weapon ? { weapon: e.stats.weapon } : {}) };
}

/** People's state in the world follows the rules: hurt, badly hurt, down. */
function syncBeings(ctx: Ctx, state: RulesSession, world: SceneWorld, people: Array<{ id: string; engine: string }>): void {
  for (const p of people) {
    const e = world.entities[p.id];
    const c = ctx.campaign.state.characters[p.engine];
    if (!e || !c) continue;
    const now = hurt(c);
    const wasDown = e.states.includes("down");
    e.states = [...e.states.filter(s => !["hurt", "badly hurt", "down", "unhurt"].includes(s)), ...(now === "unhurt" ? [] : [now])];
    // Going down leaves blood on the floor; a bad wound bloodies them.
    if (now === "down" && !wasDown) bleed(world, e, state.turn, true);
    else if (now === "badly hurt" && !e.states.includes("bloodied")) bleed(world, e, state.turn, false);
  }
}

function rollDice(expr: string, random: () => number): { total: number; text: string } {
  const m = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/.exec(expr.trim());
  if (!m) return { total: 0, text: expr };
  const rolls = Array.from({ length: Number(m[1]) }, () => 1 + Math.floor(random() * Number(m[2])));
  const mod = m[3] ? Number(m[3].replace(/\s/g, "")) : 0;
  return { total: Math.max(0, rolls.reduce((a, b) => a + b, 0) + mod), text: `${expr} (${rolls.join("+")}${mod ? signed(mod) : ""})` };
}

/** Spells whose damage adds the caster's spellcasting modifier. */
const ADDS_MODIFIER = new Set(["spiritual-weapon"]);

/** A spell's damage to things: they fail their saves; an attack still rolls against the thing's AC. */
function objectDamage(ctx: Ctx, state: RulesSession, world: SceneWorld, spell: Dnd.SpellDef, slotLevel: number, things: Entity[], chosen?: string): { lines: string[]; account: string[] } {
  const lines: string[] = [];
  const account: string[] = [];
  const random = rng(state.seed + 9973 * state.rollCount);
  const effect = (spell.mechanicalEffects ?? []).find(m => m["damageDice"] || m["damageDicePerDart"]);
  if (!effect) return { lines, account };
  const type = String(effect["damageType"] ?? chosen ?? "force");
  const sheet = sheetOf(ctx, state.rules!.pc);
  const level = sheet.totalLevel;
  let dice = String(effect["damageDice"] ?? effect["damageDicePerDart"]);
  const extra = Number(effect["extraDicePerSlotLevel"] ?? 0) * Math.max(0, slotLevel - spell.level);
  const cantripTier = spell.level === 0 && effect["cantripScalingDice"] ? (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0) : 0;
  const m = /^(\d+)d(\d+)(.*)$/.exec(dice);
  if (m && (extra || cantripTier)) dice = `${Number(m[1]) + extra + cantripTier}d${m[2]}${m[3]}`;
  // A spell that adds its caster's modifier to the damage (Spiritual Weapon: 1d8 + it).
  const sc = sheet.spellcasting?.classes[0];
  if (ADDS_MODIFIER.has(spell.id) && sc) { const mod = sheet.abilityModifiers[sc.ability]; if (mod) dice = `${dice}${signed(mod)}`; }
  // One roll for an area (as the rules have it); darts and single targets roll per thing.
  const shared = rollDice(dice, random);
  const attackBonus = sc?.attackBonus ?? 0;
  // Rays and beams are an attack each (Scorching Ray's three, one more a slot above 2nd; Eldritch Blast's by level).
  const rays = RAYS[spell.id]?.(slotLevel, level) ?? 1;
  for (const t of things) {
    if (effect["kind"] === "attack") {
      for (let ray = 1; ray <= rays; ray++) {
        const d20 = 1 + Math.floor(random() * 20);
        const total = d20 + attackBonus;
        const hits = d20 === 20 || (d20 !== 1 && total >= (t.ac ?? 10));
        lines.push(`${spell.name}${rays > 1 ? ` (${ray} of ${rays})` : ""} at ${t.name}: ${d20} ${signed(attackBonus)} = ${total} vs AC ${t.ac ?? 10}: ${hits ? "hit" : "miss"}`);
        if (!hits) { account.push(`${rays > 1 ? `ray ${ray} ` : "it "}missed ${t.name}`); continue; }
        const dmg = rollDice(dice, random);
        lines.push(`Damage: ${dmg.text} ${type}`);
        const out = damageThing(world, t, dmg.total, type, state.turn);
        lines.push(...out);
        account.push(...out.map(o => o.toLowerCase()));
        if (t.states.includes("destroyed")) break;
      }
    } else if (effect["kind"] === "auto-hit") {
      const darts = Number(effect["dartsAtBaseSlot"] ?? 3) + Number(effect["extraDartsPerSlotLevel"] ?? 0) * Math.max(0, slotLevel - spell.level);
      const total = Array.from({ length: darts }, () => rollDice(dice, random).total).reduce((a, b) => a + b, 0);
      lines.push(`${darts} darts at ${t.name}: ${total} ${type}`);
      const out = damageThing(world, t, total, type, state.turn);
      lines.push(...out);
      account.push(...out.map(o => o.toLowerCase()));
    } else {
      const out = damageThing(world, t, shared.total, type, state.turn);
      lines.push(...out);
      account.push(...out.map(o => o.toLowerCase()));
    }
  }
  if (effect["kind"] !== "attack" && effect["kind"] !== "auto-hit") lines.unshift(`Damage to things in it: ${shared.text} ${type} (things don't dodge)`);
  return { lines, account };
}
const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------------------------------------
// Blows: one attack at a time outside a fight on the map.

/** A weapon they carry (types.ts WeaponRef). */
export type WeaponChoice = WeaponRef;

/** The player attacks a story character with a weapon (instance id; their main weapon when omitted). */
export function attack(rules: Rules, state: RulesSession, cast: Character[], targetId: string, weaponId?: string): RulesOutcome {
  const ctx = opened(rules, state);
  const pcId = state.rules!.pc;
  const me = ctx.campaign.state.characters[pcId]!;
  // An improvised weapon (a thrown stone, a bottle) isn't their main one: SRD, 1d4 and no proficiency.
  const improvised = weaponId === "improvised";
  const unarmed = me.inventory.find(i => ctx.campaign.state.itemInstances[i]?.definitionId === "unarmed-strike");
  const weapon = improvised ? unarmed : weaponId && me.inventory.includes(weaponId) ? weaponId : me.equipped.mainHand ?? unarmed;
  const thing = state.world?.entities[targetId];
  if (thing && isThingEntity(thing)) {
    // A blow at a thing: the weapon's attack against its armour class, damage to its hit points.
    const name = improvised ? "Improvised weapon" : ctx.engine.content.items.get(ctx.campaign.state.itemInstances[weapon ?? ""]?.definitionId ?? "")?.name ?? "Unarmed Strike";
    const sheet = sheetOf(ctx, pcId);
    const str = sheet.abilityModifiers.STR;
    const atk = improvised ? { attackBonus: str, damage: { dice: "1d4", modifier: str, type: "bludgeoning" } } : sheet.attacks.find(a => a.name === name) ?? sheet.attacks[0]!;
    const random = rng(state.seed + 9973 * state.rollCount);
    const d20 = 1 + Math.floor(random() * 20);
    const total = d20 + atk.attackBonus;
    const hits = d20 === 20 || (d20 !== 1 && total >= (thing.ac ?? 10));
    const lines = [`${name}: your attack on ${thing.name}: ${d20} ${signed(atk.attackBonus)} = ${total} vs AC ${thing.ac ?? 10}: ${hits ? "hit" : "miss"}`];
    const account = [hits ? `the blow lands on ${thing.name}` : `the blow misses ${thing.name}`];
    if (hits) {
      const dmg = rollDice(`${atk.damage.dice}${atk.damage.modifier ? signed(atk.damage.modifier) : ""}`, random);
      lines.push(`Damage: ${dmg.text} ${atk.damage.type}`);
      const out = damageThing(state.world!, thing, dmg.total, atk.damage.type, state.turn);
      lines.push(...out);
      account.push(...out.map(o => o.toLowerCase()));
    }
    close(rules, state, ctx);
    return { lines, directive: `Rules: the player struck at ${thing.name} with ${name.toLowerCase()}. ${capitalise(account.join("; "))}. Narrate exactly that, and let the people present react.` };
  }
  const target = cast.find(c => c.id === targetId) ?? (isBeingEntity(state.world?.entities[targetId]) ? bystander(state.world!.entities[targetId]!) : undefined);
  if (!target) { close(rules, state, ctx); return { lines: [], directive: "" }; }
  const npc = ensureNpc(ctx, state, target);
  const events = ctx.apply(ctx.engine.plan.attack(ctx.campaign.state, { attackerId: pcId, targetId: npc, weaponInstanceId: weapon! }).events);
  const weaponName = (id: string) => improvised ? "Improvised weapon" : ctx.engine.content.items.get(ctx.campaign.state.itemInstances[id]?.definitionId ?? id)?.name ?? "Attack";
  const { lines, account } = describe(ctx, state, events, weaponName);
  const after = ctx.campaign.state.characters[npc]!;
  if (state.world) syncBeings(ctx, state, state.world, [{ id: target.id, engine: npc }]);
  close(rules, state, ctx);
  const down = after.hp.current <= 0 ? ` ${calledBy(state, target)} drops: at 0 hit points they fall, unconscious or dying. If the player plainly meant to kill, they may die; most people here would be knocked senseless. Nobody else in the scene shrugs that off.` : "";
  return {
    lines,
    directive: `Rules: the player attacked ${calledBy(state, target)}. ${capitalise(account.join("; "))}.${down} Narrate exactly this blow and its effect, then let the world answer it: whoever it touches reacts as they truly would. A single blow, not a whole fight: if this becomes a real fight, it will move to the map.`,
  };
}

/** A grab or a shove (2024 rules: the target saves against the player's Strength DC, or is grappled, knocked prone or pushed away). */
export function wrestle(rules: Rules, state: RulesSession, cast: Character[], targetId: string, how: "grapple" | "prone" | "push"): RulesOutcome {
  const ctx = opened(rules, state);
  const pcId = state.rules!.pc;
  const target = cast.find(c => c.id === targetId) ?? (isBeingEntity(state.world?.entities[targetId]) ? bystander(state.world!.entities[targetId]!) : undefined);
  if (!target) { close(rules, state, ctx); return { lines: [], directive: "" }; }
  const npc = ensureNpc(ctx, state, target);
  let events: Dnd.EngineEvent[];
  try {
    events = ctx.apply(how === "grapple"
      ? ctx.engine.plan.grapple(ctx.campaign.state, { type: "Grapple", attackerId: pcId, targetId: npc }).events
      : ctx.engine.plan.shove(ctx.campaign.state, { type: "Shove", attackerId: pcId, targetId: npc, mode: how }).events);
  } catch (error) {
    close(rules, state, ctx);
    return { lines: [`(${how === "grapple" ? "A grapple" : "A shove"} can't be done like that: ${error instanceof Error ? error.message : String(error)})`], directive: "" };
  }
  const { lines, account } = describe(ctx, state, events, () => "");
  const held = events.some(e => e.type === "ConditionApplied") || events.some(e => e.type === "CreaturePushed");
  if (state.world?.entities[target.id]) {
    const e = state.world.entities[target.id]!;
    if (held && how === "grapple") e.states = [...e.states.filter(s => s !== "grappled"), "grappled"];
    if (held && how === "prone") e.states = [...e.states.filter(s => s !== "prone"), "prone"];
  }
  close(rules, state, ctx);
  const verb = how === "grapple" ? "grab hold of" : how === "prone" ? "shove to the ground" : "shove away";
  return {
    lines: [`${how === "grapple" ? "Grapple" : "Shove"}: you try to ${verb} ${calledBy(state, target)}`, ...lines],
    directive: `Rules: the player tried to ${verb} ${calledBy(state, target)}. ${account.length ? `${capitalise(account.join("; "))}.` : ""} ${held ? (how === "grapple" ? `${calledBy(state, target)} is held fast (grappled) until they break free.` : how === "prone" ? `${calledBy(state, target)} goes down.` : `${calledBy(state, target)} is pushed back five feet.`) : `${calledBy(state, target)} resists it.`} Narrate exactly that, and let the people present react.`,
  };
}

/**
 * Someone the last reply left swinging at the player gets their attack (start of the player's next
 * turn). `shield`: the player answers it with the Shield spell, which goes up before the blow lands
 * (a reaction comes before what it answers): +5 AC against it, for a 1st-level slot.
 */
export function attackOnPlayer(rules: Rules, state: RulesSession, attacker: Character, options: { shield?: boolean } = {}): RulesOutcome {
  const ctx = opened(rules, state);
  const pcId = state.rules!.pc;
  const npc = ensureNpc(ctx, state, attacker);
  const weapon = state.rules!.npcs[attacker.id]!.weapon;
  const shield = options.shield ? raiseShield(ctx, pcId) : undefined;
  const planned = ctx.engine.plan.attack(ctx.campaign.state, { attackerId: npc, targetId: pcId, weaponInstanceId: weapon }).events;
  const events = ctx.apply(shield ? shielded(planned, pcId) : planned);
  const weaponName = (id: string) => ctx.engine.content.items.get(ctx.campaign.state.itemInstances[id]?.definitionId ?? id)?.name ?? "Attack";
  const { lines, account } = describe(ctx, state, events, weaponName);
  const down = knockedDown(ctx, state);
  const statusText = status(ctx, pcId);
  close(rules, state, ctx);
  const raised = shield ? ` The player's Shield went up first (${shield}): +5 AC against the blow, until their next turn.` : "";
  return {
    lines: [...(shield ? [`Cast Shield (${shield}): +5 AC against the blow`] : []), ...lines, ...(events.some(e => e.type === "DamageApplied") || shield ? [`${state.player.name}: ${statusText}`] : [])],
    directive: `Rules, before the player's turn: ${calledBy(state, attacker)}'s attack resolved.${raised} ${capitalise(account.join("; "))}.${down} Narrate that first, briefly, then what the player does.`,
    status: statusText,
    ...(down ? { down: true } : {}),
    ...(shield ? { shielded: true } : {}),
  };
}

/** The Shield spell as a reaction: spends the slot and says which, if the player has it ready, a slot for it, and their wits about them. */
function raiseShield(ctx: Ctx, pcId: string): string | undefined {
  const me = ctx.campaign.state.characters[pcId]!;
  const sheet = sheetOf(ctx, pcId);
  if (me.hp.current <= 0 || me.appliedConditions.some(a => a.conditionId === "unconscious") || !readySpells(sheet).some(sp => sp.id === "shield")) return undefined;
  const slotLevel = slotFor(sheet, me, 1);
  if (!slotLevel) return undefined;
  ctx.apply([event(ctx.E, "SpellSlotConsumed", { characterId: pcId, slotLevel })]);
  return `${ordinal(slotLevel)}-level slot`;
}

/** An attack on the player with Shield up: against AC 5 higher, so a hit that doesn't beat it misses, and its damage never comes. */
function shielded(events: Dnd.EngineEvent[], pcId: string): Dnd.EngineEvent[] {
  const blocked = new Set<string>();
  const out = events.map(e => {
    if (e.type !== "AttackRolled" || String(e["targetId"]) !== pcId) return e;
    const ac = Number(e["targetAC"]) + 5;
    const stillHits = e["critical"] === true || (e["hit"] === true && Number(e["total"]) >= ac);
    if (e["hit"] === true && !stillHits) blocked.add(e.id);
    return { ...e, targetAC: ac, hit: stillHits };
  });
  // What the blocked blow caused (its damage, and what the damage did) goes with it.
  let spread = true;
  while (spread) {
    spread = false;
    for (const e of out) if (!blocked.has(e.id) && blocked.has(String(e["causedByEventId"]))) { blocked.add(e.id); spread = true; }
  }
  return out.filter(e => e.type === "AttackRolled" || !blocked.has(e.id));
}

/** Outside a fight on the map, dropping to 0 HP knocks the player out; it doesn't kill them. */
function knockedDown(ctx: Ctx, state: RulesSession): string {
  const me = ctx.campaign.state.characters[state.rules!.pc]!;
  if (me.hp.current > 0) return "";
  ctx.apply([event(ctx.E, "Stabilized", { targetId: me.id })]);
  // Out cold, nobody rages.
  endRage(ctx, state);
  return " The player drops to 0 hit points: they're knocked senseless (unconscious, but stable), and whatever they meant to do this turn doesn't happen. The story goes on around them for a moment: someone drags them clear, takes them, or leaves them. Then they come to, with 1 hit point (the rules bring them round as their next turn begins): conscious, able to talk, act and cast again, but one more wound puts them down.";
}

const HAZARDS: Record<string, { ability: Dnd.Ability; damage?: string; text: string }> = {
  fall_or_blow: { ability: "DEX", damage: "bludgeoning", text: "a fall, a falling weight or a crushing blow" },
  fire: { ability: "DEX", damage: "fire", text: "fire, scalding or burning" },
  poison: { ability: "CON", damage: "poison", text: "poison, rot or bad air" },
  cold_or_drowning: { ability: "CON", damage: "cold", text: "cold water, drowning or freezing" },
  grab_or_shove: { ability: "STR", text: "being grabbed, pinned, dragged or shoved" },
  mind: { ability: "WIS", text: "fear, a charm, an illusion or something working on the mind" },
};
export const HAZARD_KINDS = Object.fromEntries(Object.entries(HAZARDS).map(([k, v]) => [k, v.text]));

/** A danger the last reply left hanging over the player: a saving throw, with damage on a failure. */
export function hazard(rules: Rules, state: RulesSession, kind: string, severity: "glancing" | "serious"): RulesOutcome {
  const h = HAZARDS[kind] ?? HAZARDS.fall_or_blow!;
  const dc = severity === "serious" ? 15 : 12;
  const ctx = opened(rules, state);
  const pcId = state.rules!.pc;
  const saved = ctx.apply(ctx.engine.plan.save(ctx.campaign.state, { type: "Save", characterId: pcId, ability: h.ability, dc }).events);
  const { lines, account } = describe(ctx, state, saved, () => "");
  const success = saved.some(e => e.type === "SaveRolled" && e["success"] === true);
  if (!success && h.damage) {
    const dice = severity === "serious" ? 3 : 1;
    const random = rng(state.seed + 104729 * state.rollCount);
    const rolls = Array.from({ length: dice }, () => 1 + Math.floor(random() * 6));
    const amount = rolls.reduce((a, b) => a + b, 0);
    const applied = ctx.apply([event(ctx.E, "DamageApplied", { targetId: pcId, components: [{ amount, type: h.damage }], source: kind })]);
    lines.push(`Damage: ${dice}d6 (${rolls.join("+")}) ${h.damage}`);
    const more = describe(ctx, state, applied, () => "");
    lines.push(...more.lines);
    account.push(...more.account);
  }
  const down = knockedDown(ctx, state);
  const statusText = status(ctx, pcId);
  close(rules, state, ctx);
  return {
    lines,
    directive: `Rules, before the player's turn: the danger hanging over them (${h.text}) resolved with a saving throw: ${account.join("; ")}.${success ? " They avoid the worst of it." : " It catches them."}${down} Narrate that first, briefly, then what the player does.`,
    status: statusText,
    saved: success,
    ...(down ? { down: true } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Story time: spells run out.

type EffectInstance = { spellId?: string; durationMinutes?: number };

/** Time passes in the story (about a minute an exchange, longer between scenes): spells with a listed duration end. */
export function passTime(rules: Rules, state: RulesSession, minutes: number): string[] {
  if (!state.rules?.timed) return [];
  const ctx = opened(rules, state);
  ctx.apply([event(ctx.E, "InGameTimeAdvanced", { minutes, reason: "story time" })]);
  const effects = () => (ctx.campaign.state["effectInstances"] ?? {}) as Record<string, EffectInstance>;
  const before = effects();
  const planned = ctx.engine.plan.expireSpellDurations(ctx.campaign.state, { type: "ExpireSpellDurations" });
  const ended = ctx.apply(Array.isArray(planned) ? planned : planned.events);
  const endedIds = ended.map(e => before[String(e["effectInstanceId"])]?.spellId).filter((id): id is string => !!id);
  const names = endedIds.map(id => ctx.engine.content.spells.get(id)?.name ?? id);
  // What the spells conjured goes with them (the lights wink out, the hand is gone).
  if (state.world) dispelConjured(state.world, endedIds, state.turn);
  // A Rage lasts ten minutes.
  const rage = state.rules.rage !== undefined ? state.rules.rage - minutes : undefined;
  const calmed = rage !== undefined && rage <= 0 && endRage(ctx, state);
  if (rage !== undefined && rage > 0) state.rules.rage = rage;
  state.rules!.timed = Object.values(effects()).some(e => e.durationMinutes !== undefined) || state.rules.rage !== undefined;
  close(rules, state, ctx);
  return [...(names.length ? [`${[...new Set(names)].join(", ")} ${names.length === 1 ? "has" : "have"} run out`] : []), ...(calmed ? ["Your rage burns out"] : [])];
}

/**
 * What a spell conjures into the world, by what the story calls it (the stage manager writes it in,
 * from the GM's reply): tagged as the spell's, it goes when the spell does, and with the scene.
 */
const CONJURED: Record<string, RegExp> = {
  "dancing-lights": /\b(lights?|globes?|orbs?|wisps?|pigeons?|lanterns?)\b/i, "mage-hand": /\bhands?\b/i,
  "unseen-servant": /\bservant\b/i, "floating-disk": /\bdis[ck]\b/i, "spiritual-weapon": /\bweapon\b/i,
};

/** Tag what this turn's spell conjured (created this turn, called what it conjures). */
export function markConjured(world: SceneWorld, spellId: string, turn: number): void {
  const called = CONJURED[spellId];
  if (!called) return;
  for (const e of Object.values(world.entities)) if (e.created === turn && e.kind !== "person" && called.test(e.name) && !e.tags.includes(`conjured:${spellId}`)) e.tags.push("conjured", `conjured:${spellId}`);
}

/** What these spells conjured (or every spell's, when none are named: the scene is over) is gone. */
export function dispelConjured(world: SceneWorld, spellIds: string[] | undefined, turn: number): void {
  for (const e of Object.values(world.entities)) {
    if (!e.tags.includes("conjured") || e.states.includes("gone")) continue;
    if (spellIds && !spellIds.some(id => e.tags.includes(`conjured:${id}`))) continue;
    e.states = [...e.states, "gone"];
    world.log.push({ turn, text: `${e.name} ${/s$/.test(e.name) ? "fade" : "fades"} away`, by: "rules" });
  }
}

/** How long a Rage lasts, in minutes of story time (2024 rules: up to ten minutes). */
const RAGE_MINUTES = 10;

// ---------------------------------------------------------------------------------------------
// Rests and levels.

export function rest(rules: Rules, state: RulesSession, kind: "short" | "long"): RulesOutcome {
  const ctx = opened(rules, state);
  const pcId = state.rules!.pc;
  const lines: string[] = [];
  if (kind === "short") {
    // Spend Hit Dice while they'd still heal most of a die.
    const random = rng(state.seed + 15485863 * state.rollCount);
    for (let i = 0; i < 20; i++) {
      const me = ctx.campaign.state.characters[pcId]!;
      const enrolment = me.classes.find(c => c.hitDiceRemaining > 0);
      const die = Number(ctx.engine.content.classes.get(enrolment?.classId ?? "")?.hitDie ?? 8);
      if (!enrolment || me.hp.max - me.hp.current < die / 2) break;
      const rolled = 1 + Math.floor(random() * die);
      const conMod = Math.floor((me.abilityScores.CON - 10) / 2);
      const healed = Math.max(0, rolled + conMod);
      ctx.apply([event(ctx.E, "HitDieSpent", { characterId: pcId, die, rolled, conMod, healed })]);
      lines.push(`Hit Die: d${die} (${rolled}) ${signed(conMod)} = ${healed} HP`);
    }
    ctx.apply(ctx.engine.plan.shortRest(ctx.campaign.state, { participantIds: [pcId] }).events);
  } else {
    ctx.apply(ctx.engine.plan.longRest(ctx.campaign.state, { participantIds: [pcId] }).events);
  }
  // After a rest you're up and about: nobody rests an hour, or sleeps the night, and stays where they fell (or still raging).
  const me = ctx.campaign.state.characters[pcId]!;
  for (const a of me.appliedConditions.filter(a => a.conditionId === "prone" || (a.conditionId === "unconscious" && me.hp.current > 0))) ctx.apply([event(ctx.E, "ConditionRemoved", { targetId: pcId, conditionId: a.conditionId })]);
  endRage(ctx, state);
  // The rest takes time: spells with a listed duration run out (Aid doesn't outlast a night).
  ctx.apply([event(ctx.E, "InGameTimeAdvanced", { minutes: kind === "short" ? 60 : 480, reason: `${kind} rest` })]);
  const planned = ctx.engine.plan.expireSpellDurations(ctx.campaign.state, { type: "ExpireSpellDurations" });
  ctx.apply(Array.isArray(planned) ? planned : planned.events);
  state.rules!.timed = Object.values((ctx.campaign.state["effectInstances"] ?? {}) as Record<string, EffectInstance>).some(e => e.durationMinutes !== undefined);
  const statusText = status(ctx, pcId);
  close(rules, state, ctx);
  lines.unshift(`${kind === "short" ? "Short rest (an hour)" : "Long rest (a night)"}: ${statusText}`);
  return {
    lines,
    directive: `Rules: the player takes a ${kind} rest (${kind === "short" ? "an hour or so" : "a night's sleep"}). Afterwards: ${statusText}. Let the time pass in the fiction, briefly, and show what the world did meanwhile.`,
    status: statusText,
  };
}

/** A milestone: one level in the player's main class, choices made by the engine's defaults. */
export function levelUp(rules: Rules, state: RulesSession): string[] {
  if (!state.rules) return [];
  const ctx = opened(rules, state);
  const pcId = state.rules.pc;
  const before = ctx.campaign.state.characters[pcId]!;
  const main = [...before.classes].sort((a, b) => b.level - a.level)[0]!;
  const maxBefore = sheetOf(ctx, pcId).effectiveHpMax;
  try {
    ctx.apply(ctx.engine.plan.levelUp(ctx.campaign.state, { characterId: pcId, classId: main.classId, hpStrategy: "average" }).events);
    const picked = [...resolveChoices(ctx, pcId, state.rules.prefer ?? []), ...learnSpells(ctx, pcId, main, state.rules.prefer ?? [])];
    grantResources(ctx, pcId);
    const sheet = sheetOf(ctx, pcId);
    refresh(ctx, state);
    close(rules, state, ctx);
    return [`Level up! ${state.player.name} is now ${state.player.build}. HP max ${maxBefore} → ${sheet.effectiveHpMax}.${picked.length ? ` Choices: ${picked.join("; ")}.` : ""}`];
  } catch (error) {
    close(rules, state, ctx);
    return [`(Level up failed: ${error instanceof Error ? error.message : String(error)})`];
  }
}

/**
 * A caster's new spells at a level: the cantrips and prepared spells the level brings (a wizard's
 * fourth cantrip and seventh spell at 4th), the build's own choices first, and a spell of the new
 * highest level when they've none. Returns what they learned, in words.
 */
function learnSpells(ctx: Ctx, pcId: string, before: { classId: string; subclassId?: string; level: number }, prefer: string[]): string[] {
  const { classId, subclassId = "" } = before;
  const level = before.level + 1;
  const casting = CASTING[classId];
  if (!casting) return [];
  const content = ctx.engine.content;
  const me = ctx.campaign.state.characters[pcId]!;
  const mine = [...new Set([...me.knownSpells, ...me.preparedSpells])].filter(id => content.spells.get(id)?.classes.includes(classId));
  const cantrips = mine.filter(id => content.spells.get(id)!.level === 0);
  const prepared = me.preparedSpells.filter(id => (content.spells.get(id)?.level ?? 0) >= 1);
  const top = casting.maxSpell(level);
  const newCantrips = moreSpells(content, classId, cantrips, prefer, l => l === 0, Math.max(0, cantripsAt(classId, level) - cantrips.length), subclassId);
  const missing = Math.max(0, casting.prepared(level) - prepared.length);
  const highest = prepared.some(id => content.spells.get(id)?.level === top) ? [] : moreSpells(content, classId, prepared, prefer, l => l === top, Math.min(1, missing), subclassId);
  const newSpells = [...highest, ...moreSpells(content, classId, [...prepared, ...highest], prefer, l => l >= 1 && l <= top, missing - highest.length, subclassId)];
  const added = [...newCantrips, ...newSpells];
  for (const id of added) ctx.apply([event(ctx.E, "PreparedSpellsChanged", { characterId: pcId, removed: "", added: id, source: "level-up" })]);
  return added.length ? [`learned ${added.map(id => content.spells.get(id)?.name ?? id).join(", ")}`] : [];
}

// ---------------------------------------------------------------------------------------------
// Moving: one jump, the same in a scene, on the map and in a fight.

export interface JumpReach { long: number; standingLong: number; high: number; standingHigh: number }

/** SRD jumping: a long jump covers your Strength score in feet after a 10-foot run-up, half that standing; a high jump 3 + your Strength modifier, half standing. */
export function jumpReachFor(strength: number): JumpReach {
  const high = Math.max(0, 3 + Math.floor((strength - 10) / 2));
  return { long: strength, standingLong: Math.floor(strength / 2), high, standingHigh: Math.floor(high / 2) };
}

export function jumpReach(rules: Rules, state: RulesSession): JumpReach {
  if (!state.rules) return jumpReachFor(10);
  const ctx = reading(rules, state);
  return jumpReachFor(sheetOf(ctx, state.rules.pc).abilityScores.STR);
}

export interface Jump {
  feet: number;
  high?: boolean;
  /** At least 10 feet on foot first. */
  runUp?: boolean;
  /** What falling short means: the drop into whatever is between, in feet (0 for a puddle, a table). */
  drop?: number;
}
export interface JumpOutcome { made: boolean; reach: number; roll?: RollResult; lines: string[]; account: string; status?: string }

/**
 * A jump: within reach it simply happens (no dice); up to half as far again takes Strength
 * (Athletics) at DC 10 plus a point for every foot over; farther than that falls short. Falling
 * short with a drop beneath is a fall (1d6 bludgeoning per 10 feet, prone).
 */
export function jump(rules: Rules, state: RulesSession, j: Jump): JumpOutcome {
  const reachOf = jumpReach(rules, state);
  const reach = j.high ? (j.runUp ? reachOf.high : reachOf.standingHigh) : (j.runUp ? reachOf.long : reachOf.standingLong);
  const what = `${j.high ? "a high jump" : "a long jump"} of ${j.feet} ft (${j.runUp ? "with a run-up" : "standing"}: ${reach} ft is easy)`;
  if (j.feet <= reach) return { made: true, reach, lines: [`Jump: ${what}: made`], account: `the jump was within their reach (${reach} ft), so they make it` };
  const over = j.feet - reach;
  let roll: RollResult | undefined;
  let made = false;
  if (over * 2 <= reach) {
    roll = rollFor(rules, state, "athletics", 10 + over);
    made = roll.success;
  }
  const lines = [`Jump: ${what}${roll ? "" : ": too far"}`, ...(roll ? [describeRoll(roll)] : [])];
  if (made) return { made, reach, ...(roll ? { roll } : {}), lines, account: `they make it, just (Athletics ${roll!.total} against DC ${roll!.dc})` };
  const short = roll ? `they fall short (Athletics ${roll.total} against DC ${roll.dc})` : `it was beyond them (${j.feet} ft against a reach of ${reach} ft), and they fall short`;
  if (!state.rules || !j.drop) return { made, reach, ...(roll ? { roll } : {}), lines, account: short };
  const ctx = opened(rules, state);
  const pcId = state.rules.pc;
  // The engine's own fall: 1d6 bludgeoning per 10 feet (at most 20d6), landing prone.
  const events = ctx.apply((ctx.engine.plan["falling"] as (s: Dnd.CampaignState, i: unknown) => Dnd.PlanResult)(ctx.campaign.state, { type: "Falling", characterId: pcId, distanceFeet: j.drop }).events);
  // A fall that hurts lands you prone (the engine's fall leaves that to us).
  if (events.some(e => e.type === "DamageApplied") && !events.some(e => e.type === "ConditionApplied" && e["conditionId"] === "prone"))
    events.push(...ctx.apply([event(ctx.E, "ConditionApplied", { targetId: pcId, conditionId: "prone", appliedConditionId: ctx.E.newEventId() })]));
  const { lines: more, account } = describe(ctx, state, events, () => "");
  const statusText = status(ctx, pcId);
  const down = knockedDown(ctx, state);
  close(rules, state, ctx);
  return { made, reach, ...(roll ? { roll } : {}), lines: [...lines, `Fall: ${j.drop} ft`, ...more], account: `${short}, and fall ${j.drop} ft${account.length ? `: ${account.join("; ")}` : " unhurt"}${down}`, status: statusText };
}

/** The class features with uses that the rules can resolve, in the order a menu lists them. */
export const FEATURE_IDS = FEATURES.map(f => f.id);

/** A class feature, through the engine's own intent for it (uses, rests and all). */
export function useFeature(rules: Rules, state: RulesSession, cast: Character[], featureId: string, targetId?: string): RulesOutcome {
  const feature = FEATURES.find(f => f.id === featureId);
  if (!feature) return { lines: [], directive: "" };
  const ctx = opened(rules, state);
  const pcId = state.rules!.pc;
  const onSelf = !targetId || targetId === "self" || targetId === "player";
  const who = feature.target === "creature" && !onSelf ? cast.find(c => c.id === targetId) ?? (isBeingEntity(state.world?.entities[targetId!]) ? bystander(state.world!.entities[targetId!]!) : undefined) : undefined;
  if (feature.target === "creature" && !who && !feature.self) { close(rules, state, ctx); return { lines: [`(${feature.name} needs someone to give it to.)`], directive: "" }; }
  let events: Dnd.EngineEvent[];
  try {
    const intent = feature.intent(ctx.E, pcId, who ? ensureNpc(ctx, state, who) : undefined, ctx.campaign.state);
    const method = intent.type.charAt(0).toLowerCase() + intent.type.slice(1);
    events = ctx.apply((ctx.engine.plan[method] as (s: Dnd.CampaignState, i: unknown) => Dnd.PlanResult)(ctx.campaign.state, intent).events);
  } catch (error) {
    close(rules, state, ctx);
    const why = error instanceof Error ? error.message : String(error);
    return { lines: [`(${feature.name}: ${why})`], directive: `The player reached for ${feature.name}, but it isn't there to use (${why}). Nothing comes of it; say so in a few words, in the fiction.` };
  }
  const { lines, account } = describe(ctx, state, events, () => feature.name);
  const statusText = status(ctx, pcId);
  if (events.some(e => /^(ConditionApplied|EffectStarted)$/.test(e.type))) state.rules!.timed = true;
  if (events.some(e => e.type === "ConditionApplied" && e["conditionId"] === "raging")) state.rules!.rage = RAGE_MINUTES;
  if (who && state.world && state.rules!.npcs[who.id]) syncBeings(ctx, state, state.world, [{ id: who.id, engine: state.rules!.npcs[who.id]!.id }]);
  close(rules, state, ctx);
  return {
    lines: [`${feature.name}${who ? ` for ${calledBy(state, who)}` : ""}`, ...lines, `${state.player.name}: ${statusText}`],
    directive: `Rules: the player used ${feature.name}${who ? ` on ${calledBy(state, who)}` : ""}. ${account.length ? `${capitalise(account.join("; "))}.` : "It takes effect as the feature describes."} Narrate exactly that, in the fiction, briefly.`,
    status: statusText,
  };
}
