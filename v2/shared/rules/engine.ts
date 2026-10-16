// Copied from the prototype's src/rules/dnd.ts:19-138 at 44c6d4a: dnd() and srdContent() are the Rules a host hands over (rulesFrom); engineFor is one engine per isolate, reseeded per use; open() and its read-only twins take the campaign from a per-isolate cache (loaded); event()'s time is its id's (the shim pins both). The pin itself is pin.ts's. rulesNow and missesMiss wait for V7 with their callers; refresh and close are character.ts's.
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import type { Skill } from "../scene/types.ts";
import type { Rules, RulesSession, SrdFile } from "./types.ts";

/**
 * D&D 5.5e mechanics (SRD 5.2.1) from the vendored dnd-srd-engine, as the rules code reaches it
 * (v1-design §3.6): the engine its host loaded, one per isolate, reseeded for each use so it rolls
 * as a fresh one would; the session's campaign, loaded from its string once per isolate; and the
 * events the rules code makes by hand. Nothing here loads the bundle or touches the clock: the host
 * loads the engine (after shared/rules/shim.ts), and pin.ts pins its ids and clock for a call.
 */

interface Isolate { engine: Dnd.Engine; campaigns: Map<string, Dnd.Campaign> }
/** What rulesFrom made for each Rules: the engine (for loading, which draws nothing from it) and the loaded campaigns. */
const isolates = new WeakMap<Rules, Isolate>();
/** How many loaded campaigns an isolate keeps (a game's player has one, changed by each check). */
const CAMPAIGNS = 64;

/**
 * The Rules a host hands the rules code, from what it loaded after the shim: the bundle, the pack
 * and the SRD's spells. Once per isolate: making the engine validates the pack (most of a cold
 * character's 280 ms).
 */
export function rulesFrom(E: typeof Dnd, pack: unknown, srd: SrdFile): Rules {
  const rng = E.seededRNG(0);
  const engine = E.createEngine({ contentPacks: [pack], rng });
  const rules: Rules = {
    E, pack, srd, content: engine.content,
    // As createEngine({ rng: seededRNG(seed) }) rolls: the engine keeps nothing else between uses.
    engine(seed) { rng.state = E.seededRNG(seed).state; return engine; },
  };
  isolates.set(rules, { engine, campaigns: new Map() });
  return rules;
}

/**
 * The campaign loaded from its exact string, cached per isolate (the last 64, least recently used
 * first out). Loading replays every event, so a check on a campaign already loaded skips it. Never
 * mutated: committing makes a new campaign.
 */
export function loaded(rules: Rules, serialized: string): Dnd.Campaign {
  const isolate = isolateOf(rules);
  const { campaigns } = isolate;
  const hit = campaigns.get(serialized);
  if (hit) {
    campaigns.delete(serialized);
    campaigns.set(serialized, hit);
    return hit;
  }
  const campaign = loadWellFormed(rules.E, serialized, isolate.engine);
  campaigns.set(serialized, campaign);
  if (campaigns.size > CAMPAIGNS) campaigns.delete(campaigns.keys().next().value!);
  return campaign;
}

function isolateOf(rules: Rules): Isolate {
  const isolate = isolates.get(rules);
  if (!isolate) throw new Error("shared/rules: a Rules not made by rulesFrom");
  return isolate;
}

// ---------------------------------------------------------------------------------------------
// The session's campaign, as the rules code works on it.

/** The engine and the campaign being worked on; apply commits events to it (or, read-only, does nothing). */
export interface Ctx { E: typeof Dnd; engine: Dnd.Engine; campaign: Dnd.Campaign; apply(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] }

/** The session's campaign to read: nothing is rolled (so the engine isn't reseeded) or committed. */
export function reading(rules: Rules, session: RulesSession): Ctx {
  if (!session.rules) throw new Error("This session has no rules-engine character.");
  return { E: rules.E, engine: isolateOf(rules).engine, campaign: loaded(rules, session.rules.campaign), apply: e => e };
}

/**
 * The session's campaign to change, with the dice for one roll: the engine seeded from the game's
 * seed and its next roll (session.rollCount one more), so a session's dice can be replayed.
 */
export function opened(rules: Rules, session: RulesSession): Ctx {
  if (!session.rules) throw new Error("This session has no rules-engine character.");
  const engine = rules.engine(session.seed + 7919 * ++session.rollCount);
  return changing(rules.E, engine, loaded(rules, session.rules.campaign));
}

/** A campaign to change: apply commits each event to it, made well-formed first. */
export function changing(E: typeof Dnd, engine: Dnd.Engine, campaign: Dnd.Campaign): Ctx {
  const ctx: Ctx = { E, engine, campaign, apply(events) { ctx.campaign = E.commit(ctx.campaign, wellFormed(events)); return events; } };
  return ctx;
}

/**
 * The engine records a spell attack with the spell's id ("fire-bolt") where an item instance id
 * belongs, then refuses to load its own campaign ("Expected a ULID"). Nothing reads the field back,
 * so the log keeps a placeholder (the events returned to callers still name the spell).
 */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
function wellFormed(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] {
  return events.map(e => typeof e["weaponInstanceId"] === "string" && !ULID.test(e["weaponInstanceId"] as string) ? { ...e, weaponInstanceId: "0".repeat(26) } : e);
}

/** Campaigns saved with the bad events still load, repaired. */
export function loadWellFormed(E: typeof Dnd, serialized: string, engine: Dnd.Engine): Dnd.Campaign {
  try { return E.loadCampaign(serialized, engine); }
  catch {
    const raw = JSON.parse(serialized) as { events?: Dnd.EngineEvent[] };
    raw.events = wellFormed(raw.events ?? []);
    return E.loadCampaign(JSON.stringify(raw), engine);
  }
}

/** An event the rules code makes itself (the engine's planners make the rest), stamped as the engine stamps its own: when its id was made. */
export const event = (E: typeof Dnd, type: string, rest: Record<string, unknown>): Dnd.EngineEvent => {
  const id = E.newEventId();
  return { id, at: isoTime(idTime(id)), type, ...rest };
};

// ---------------------------------------------------------------------------------------------
// The time an event is stamped with. The prototype's is `new Date()`; shared code reads no clock
// (shared/imports.test.ts), but the engine's ids carry one: ulid's, which the shim pins in a pinned
// call (the transaction's time) and leaves real elsewhere (the AI service). So an event made by
// hand is stamped with its own id's time, written as Date's toISOString writes it.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DAY_MS = 86_400_000;

/** A ULID's time: its first ten characters, Crockford's base 32, in milliseconds since 1970. */
export const idTime = (ulid: string): number => [...ulid.slice(0, 10).toUpperCase()].reduce((ms, c) => ms * 32 + CROCKFORD.indexOf(c), 0);

/** Milliseconds since 1970 as an ISO time, "2026-10-16T09:30:00.000Z" (the civil date from the day count: Howard Hinnant's days_from_civil, inverted). */
export function isoTime(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  const z = days + 719_468, era = Math.floor(z / 146_097), doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1, month = mp < 10 ? mp + 3 : mp - 9, year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  const t = ms - days * DAY_MS;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}Z`;
}

// ---------------------------------------------------------------------------------------------
// Words the rules code shares.

export const ABILITIES: Dnd.Ability[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
export const ABILITY_NAME: Record<Dnd.Ability, string> = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
export const SKILL_ABILITY: Record<Skill, Dnd.Ability> = {
  athletics: "STR", acrobatics: "DEX", sleight_of_hand: "DEX", stealth: "DEX", arcana: "INT", history: "INT", investigation: "INT",
  nature: "INT", religion: "INT", animal_handling: "WIS", insight: "WIS", medicine: "WIS", perception: "WIS", survival: "WIS",
  deception: "CHA", intimidation: "CHA", performance: "CHA", persuasion: "CHA",
};
export const engineSkill = (skill: Skill) => skill.replace(/_/g, "-");
export const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
export const ordinal = (n: number) => ["cantrip", "1st", "2nd", "3rd"][n] ?? `${n}th`;
