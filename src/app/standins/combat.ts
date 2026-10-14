import type * as Dnd from "../../../vendor/dnd-srd-engine/dnd-srd-engine.js";
import type { CombatantSetup, CombatResult, CombatSetup, MapActor, Tile2, TileMap } from "../../game/types.ts";
import { attack as playerAttack, castable, castSpell, dnd, statusLine } from "../../rules/dnd.ts";
import { rng } from "../../runtime/dice.ts";
import type { Character } from "../../runtime/scene.ts";
import type { SessionState } from "../../runtime/session.ts";
import type { CombatAction, CombatAdapter, CombatController, CombatOptions, CombatView, CombatantView, Dir } from "../adapters.ts";
import { add, chebyshev, same, STEP } from "../geometry.ts";
import { C, PEOPLE } from "../theme.ts";

/**
 * Stand-in for src/game/combat: a plain turn loop with initiative, walking on the grid and blows
 * resolved by the rules engine (the player's attacks and spells through src/rules/dnd.ts, everyone
 * else's blows through the same engine), so hit points carry on into the story. No opportunity
 * attacks, cover or hazards: the real module (boardgame.io) brings those.
 */

type Ctx = { E: typeof Dnd; engine: Dnd.Engine; campaign: Dnd.Campaign; apply(events: Dnd.EngineEvent[]): Dnd.EngineEvent[] };

async function open(session: SessionState): Promise<Ctx> {
  const { E, pack } = await dnd();
  const engine = E.createEngine({ contentPacks: [pack], rng: E.seededRNG(session.seed + 7919 * ++session.rollCount) });
  const ctx: Ctx = { E, engine, campaign: E.loadCampaign(session.rules!.campaign, engine), apply(events) { ctx.campaign = E.commit(ctx.campaign, events); return events; } };
  return ctx;
}

function close(session: SessionState, ctx: Ctx): void {
  session.rules!.campaign = ctx.E.serializeCampaign(ctx.campaign);
}

/** Read the campaign without rolling anything (so the session's dice sequence is untouched). */
async function peek(session: SessionState): Promise<Ctx> {
  const { E, pack } = await dnd();
  const engine = E.createEngine({ contentPacks: [pack], rng: E.seededRNG(session.seed) });
  return { E, engine, campaign: E.loadCampaign(session.rules!.campaign, engine), apply: events => events };
}

const event = (E: typeof Dnd, type: string, rest: Record<string, unknown>): Dnd.EngineEvent => ({ id: E.newEventId(), at: new Date().toISOString(), type, ...rest });
const DEFAULT_WEAPON: Record<string, string> = { commoner: "club", guard: "spear", tough: "mace", bandit: "scimitar", noble: "rapier", spy: "shortsword" };

/** Stats for someone the rules haven't met yet (as src/rules/dnd.ts does it: an SRD statblock and a weapon). */
function enlist(ctx: Ctx, session: SessionState, who: Character): string {
  const known = session.rules!.npcs[who.id];
  if (known && ctx.campaign.state.characters[known.id]) return known.id;
  const { E } = ctx;
  const content = ctx.engine.content;
  const statblockId = who.statblock && content.monsters.has(who.statblock) ? who.statblock : "commoner";
  const sb = content.monsters.get(statblockId)!;
  const weaponId = [who.weapon, DEFAULT_WEAPON[statblockId], "club"].find((w): w is string => !!w && content.items.has(w))!;
  const npc = E.CharacterSchema.parse({
    id: E.newCharacterId(), kind: "creature", statblockId, name: who.name, speciesId: "human", backgroundId: "soldier",
    classes: [{ classId: "fighter", level: 1, hitDiceRemaining: 1 }],
    abilityScores: sb.abilityScores, hp: { current: sb.hp.average, max: sb.hp.average, temp: 0 }, armorClass: sb.ac,
  });
  const weapon = { id: E.newItemInstanceId(), definitionId: weaponId, quantity: 1, attuned: false, identifiedByCharacterIds: [] };
  ctx.apply([event(E, "CharacterCreated", { snapshot: npc }), event(E, "ItemAcquired", { instance: weapon, characterId: npc.id })]);
  try { ctx.apply(ctx.engine.plan.equip(ctx.campaign.state, { characterId: npc.id, instanceId: weapon.id, slot: "mainHand" }).events); } catch { /* natural weapons aren't held */ }
  session.rules!.npcs[who.id] = { id: npc.id, weapon: weapon.id };
  return npc.id;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function hurt(c: Dnd.EngineCharacter): string {
  if (c.hp.current <= 0) return "down";
  if (c.hp.current >= c.hp.max) return "unhurt";
  return c.hp.current * 2 <= c.hp.max ? "badly hurt" : "hurt";
}

interface Fighter {
  setup: CombatantSetup;
  character: Character;
  player: boolean;
  at: Tile2;
  initiative: number;
  speed: number;
  out?: "down" | "dead" | "fled" | "surrendered";
  dodging?: boolean;
  /** Never fights; gives up when everyone on his side is down (Master Sallow). */
  coward?: boolean;
  glyph: string;
}

const COWARDS = new Set(["sallow"]);

function asCharacter(c: CombatantSetup): Character {
  return { id: c.id, name: c.name, look: "", voice: "", wants: "", knows: [], attitude: "", ...(c.statblock ? { statblock: c.statblock } : {}), ...(c.weapon ? { weapon: c.weapon } : {}) };
}

/** How people are known on the map: Kell is K, the Master is S; everyone else by their last name's initial. */
const GLYPHS: Record<string, string> = { kell: "K", sallow: "S", hep: "H", hobb: "B", saul: "W", scrope: "L", "crake-1": "C", "crake-2": "C" };

function glyphFor(c: CombatantSetup): string {
  if (c.side === "player") return "@";
  const word = c.name.replace(/\(.*?\)/g, "").trim().split(/\s+/).at(-1) ?? "?";
  const letter = (GLYPHS[c.castId ?? c.id] ?? word[0] ?? "?").toUpperCase();
  return c.side === "neutral" ? letter.toLowerCase() : letter;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

class StandInFight implements CombatController {
  private fighters: Fighter[];
  private order: Fighter[] = [];
  private turn = 0;
  private round = 1;
  private movementLeft = 0;
  private actionUsed = false;
  private log: string[] = [];
  private over?: CombatResult;
  private random: () => number;
  private setup: CombatSetup;
  private session: SessionState;

  constructor(setup: CombatSetup, session: SessionState) {
    this.setup = setup;
    this.session = session;
    this.random = rng(setup.seed);
    this.fighters = setup.combatants.map(c => ({
      setup: c, character: asCharacter(c), player: c.side === "player", at: { ...c.at }, initiative: 0, speed: 30,
      ...(c.castId && COWARDS.has(c.castId) ? { coward: true } : {}), glyph: glyphFor(c),
    }));
  }

  get map(): TileMap { return this.setup.map; }
  private get me(): Fighter { return this.fighters.find(f => f.player)!; }
  private get current(): Fighter { return this.order[this.turn]!; }
  private roll(sides: number) { return 1 + Math.floor(this.random() * sides); }

  /** Initiative: d20 plus Dexterity (the player's initiative modifier from their sheet). */
  async begin(): Promise<void> {
    const ctx = await open(this.session);
    const content = ctx.engine.content;
    for (const f of this.fighters) {
      if (f.player) {
        const s = ctx.campaign.state;
        const sheet = ctx.E.buildCharacterSheet({ character: s.characters[this.session.rules!.pc]!, itemInstances: s.itemInstances, content, characters: s.characters, pendingChoices: s.pendingChoices });
        f.speed = sheet.speeds["walk"] ?? 30;
        f.initiative = this.roll(20) + sheet.initiative.modifier;
      } else {
        enlist(ctx, this.session, f.character);
        const dex = content.monsters.get(f.setup.statblock ?? "commoner")?.abilityScores.DEX ?? 10;
        f.initiative = this.roll(20) + Math.floor((dex - 10) / 2);
      }
    }
    close(this.session, ctx);
    // Ties go to the player, then to whoever is quicker on their feet.
    this.order = this.fighters.filter(f => f.setup.side !== "neutral").sort((a, b) => b.initiative - a.initiative || Number(b.player) - Number(a.player));
    this.log.push(`Roll for initiative! ${this.order.map(f => `${f.player ? "You" : f.setup.name} ${f.initiative}`).join(" · ")}`);
    this.startTurn();
  }

  private startTurn(): void {
    const f = this.current;
    f.dodging = false;
    if (f.player) {
      this.movementLeft = f.speed;
      this.actionUsed = false;
      this.log.push(`— Round ${this.round}: your turn. —`);
    }
  }

  private nextTurn(): void {
    if (this.over) return;
    for (let guard = 0; guard < this.order.length * 2; guard++) {
      this.turn++;
      if (this.turn >= this.order.length) { this.turn = 0; this.round++; }
      if (!this.current.out) break;
    }
    if (this.round > 20) { this.finish("fled"); return; }
    this.startTurn();
  }

  private occupied(at: Tile2, except?: Fighter): Fighter | undefined {
    return this.fighters.find(f => f !== except && !f.out && same(f.at, at));
  }

  private walkable(at: Tile2, who: Fighter): boolean {
    const t = this.map.tiles[at.y]?.[at.x];
    return !!t && !t.blocks && !this.occupied(at, who);
  }

  private hostile(a: Fighter, b: Fighter): boolean {
    const team = (f: Fighter) => (f.setup.side === "player" || f.setup.side === "ally" ? "us" : f.setup.side === "enemy" ? "them" : "nobody");
    return team(a) !== "nobody" && team(b) !== "nobody" && team(a) !== team(b);
  }

  /** Re-read who is still standing from the rules (hit points live in the engine), then see if it's over. */
  private async refresh(): Promise<void> {
    const ctx = await open(this.session);
    for (const f of this.fighters) {
      if (f.out) continue;
      const id = f.player ? this.session.rules!.pc : this.session.rules!.npcs[f.character.id]?.id;
      const c = id ? ctx.campaign.state.characters[id] : undefined;
      if (c && c.hp.current <= 0) {
        f.out = "down";
        this.log.push(f.player ? "You go down in the grain dust." : `${f.setup.name} goes down.`);
        if (f.player) ctx.apply([event(ctx.E, "Stabilized", { targetId: c.id })]);
      }
    }
    close(this.session, ctx);
    this.session.rules!.status = await statusLine(this.session);
    this.checkEnd();
  }

  private checkEnd(): void {
    if (this.over) return;
    // A coward gives up once nobody on his side is left standing.
    for (const f of this.fighters.filter(x => x.coward && !x.out)) {
      if (!this.fighters.some(o => o !== f && !o.out && o.setup.side === f.setup.side)) {
        f.out = "surrendered";
        this.log.push(`${f.setup.name} lowers his cane, raises both soft hands and says, "Regrettably, I find I must surrender. In the King's interest."`);
      }
    }
    if (this.me.out) this.finish("defeat");
    else if (!this.fighters.some(f => f.setup.side === "enemy" && !f.out)) this.finish(this.fighters.some(f => f.out === "surrendered") ? "surrender" : "victory");
  }

  private finish(outcome: CombatResult["outcome"]): void {
    if (this.over) return;
    const state = (f: Fighter): CombatResult["casualties"][number]["state"] => f.out ?? (outcome === "fled" && f.setup.side === "enemy" ? "fled" : "standing");
    const casualties = this.fighters.map(f => ({ id: f.setup.id, name: f.setup.name, state: state(f) }));
    const words = (f: Fighter) => ({ down: "went down", dead: "died", fled: "fled", surrendered: "surrendered", standing: "was left standing" })[state(f)];
    const enemies = this.fighters.filter(f => f.setup.side === "enemy").map(f => `${f.setup.name} ${words(f)}`);
    const friends = this.fighters.filter(f => f.setup.side === "ally").map(f => `${f.setup.name} ${words(f)}`);
    const me = this.me.out ? `${this.session.player.name} was knocked senseless (unconscious but stable)` : `${this.session.player.name} came through it (${this.session.rules?.status ?? "on their feet"})`;
    const how = { victory: "The player's side won", defeat: "The player's side lost", fled: "The fight broke up and the enemy fled", surrender: "The enemy surrendered" }[outcome];
    this.over = {
      outcome, rounds: this.round, casualties,
      summary: `${how} after ${this.round} round${this.round === 1 ? "" : "s"}: ${[...enemies, ...friends].join("; ")}. ${me}.`,
    };
    this.log.push({ victory: "Victory! The dust settles.", defeat: "Defeat. The lanterns swing; the floor comes up to meet you.", fled: "Your foes have had enough and flee into the night.", surrender: "Surrender! Nobody else seems keen to carry on." }[outcome]);
  }

  view(): CombatView {
    const ctxless = (f: Fighter): CombatantView => ({
      id: f.setup.id, name: f.player ? `${this.session.player.name} (you)` : f.setup.name, side: f.setup.side, at: f.at, initiative: f.initiative,
      health: f.out ?? (f.player ? (this.session.rules?.status?.split(",")[0] ?? "") : this.health.get(f.setup.id) ?? "unhurt"),
      out: !!f.out, states: [...(f.dodging ? ["dodging"] : []), ...(f.out ? [f.out] : [])], glyph: f.glyph,
      color: f.player ? "#ffffff" : f.setup.side === "ally" ? (PEOPLE[f.setup.castId ?? ""] ?? C.ally) : f.setup.side === "enemy" ? C.enemy : C.neutral,
    });
    return {
      round: this.round,
      order: [...this.order, ...this.fighters.filter(f => !this.order.includes(f))].map(ctxless),
      current: this.current?.setup.id ?? "",
      movementLeft: this.movementLeft,
      actionUsed: this.actionUsed,
      // "a porter with a knife closes on you" starts a sentence.
      log: this.log.map(l => (l.startsWith("🎲 ") ? `🎲 ${capital(l.slice(3))}` : capital(l))),
      ...(this.over ? { over: this.over } : {}),
    };
  }

  result(): CombatResult | undefined {
    return this.over;
  }

  /** How everyone else looks, in words (refreshed after every blow). */
  private health = new Map<string, string>();
  private async readHealth(): Promise<void> {
    const ctx = await peek(this.session);
    for (const f of this.fighters) {
      const id = this.session.rules!.npcs[f.character.id]?.id;
      const c = id ? ctx.campaign.state.characters[id] : undefined;
      if (c && !f.player) this.health.set(f.setup.id, hurt(c));
    }
  }

  actors(): MapActor[] {
    return this.fighters.map(f => ({
      id: f.setup.id, name: f.setup.name, kind: f.player ? "player" : "person", glyph: f.glyph, map: this.map.id, at: f.at, blocks: !f.out,
      color: f.player ? "#ffffff" : f.setup.side === "ally" ? (PEOPLE[f.setup.castId ?? ""] ?? C.ally) : f.setup.side === "enemy" ? C.enemy : C.neutral,
      ...(f.setup.castId ? { ref: f.setup.castId } : {}),
      states: [...(f.dodging ? ["dodging"] : []), ...(f.out ? [f.out] : [])],
    }));
  }

  /** The player's weapons: what reaches how far (melee one square; bows and thrown weapons by their range). */
  private async arsenal(): Promise<Array<{ id: string; name: string; reach: number; ranged: boolean }>> {
    const ctx = await peek(this.session);
    const s = ctx.campaign.state;
    const me = s.characters[this.session.rules!.pc]!;
    const items = me.inventory.map(i => s.itemInstances[i]).filter((i): i is Dnd.ItemInstance => !!i)
      .map(i => ({ instance: i, def: ctx.engine.content.items.get(i.definitionId) })).filter(x => x.def?.itemKind === "weapon");
    const main = me.equipped.mainHand;
    return items.sort((a, b) => Number(b.instance.id === main) - Number(a.instance.id === main)).map(({ instance, def }) => {
      const range = Number(def!["rangeNormal"] ?? 0);
      const ranged = def!.attackKind === "ranged";
      const reach = def!.properties?.includes("reach") ? 2 : 1;
      return { id: instance.id, name: def!.name, ranged, reach: ranged ? Math.max(1, Math.floor(range / 5)) : def!.properties?.includes("thrown") && range ? Math.floor(range / 5) : reach };
    });
  }

  async options(): Promise<CombatOptions> {
    const weapons = await this.arsenal();
    const best = Math.max(1, ...weapons.map(w => w.reach));
    const targets = this.fighters.filter(f => !f.player && !f.out)
      .map(f => ({ id: f.setup.id, name: f.setup.name, side: f.setup.side, distance: chebyshev(f.at, this.me.at), inReach: chebyshev(f.at, this.me.at) <= best }))
      .sort((a, b) => Number(b.side === "enemy") - Number(a.side === "enemy") || a.distance - b.distance);
    const spells = (await castable(this.session)).map(s => ({ id: s.id, name: s.name, level: s.level }));
    return { spells, targets };
  }

  async act(action: CombatAction): Promise<string[]> {
    if (this.over) return [];
    const me = this.me;
    if (this.current !== me) return ["It isn't your turn yet."];
    const before = this.log.length;
    const say = (line: string) => { this.log.push(line); };
    switch (action.kind) {
      case "move": {
        if (this.movementLeft < 5) { say("You're out of movement this turn. (D to dash, E to end your turn.)"); break; }
        const to = add(me.at, STEP[action.dir]);
        if (!this.walkable(to, me)) { say(this.occupied(to, me) ? `${this.occupied(to, me)!.setup.name} is in the way.` : "Something solid is in the way."); break; }
        me.at = to;
        this.movementLeft -= 5;
        break;
      }
      case "dash":
        if (this.actionUsed) { say("You've already used your action this turn."); break; }
        this.actionUsed = true;
        this.movementLeft += me.speed;
        say(`You dash: ${this.movementLeft} ft of movement left.`);
        break;
      case "dodge":
        if (this.actionUsed) { say("You've already used your action this turn."); break; }
        this.actionUsed = true;
        me.dodging = true;
        say("You dodge: until your next turn, attacks against you have disadvantage.");
        break;
      case "disengage":
        if (this.actionUsed) { say("You've already used your action this turn."); break; }
        this.actionUsed = true;
        say("You disengage, with dignity. (Nobody here takes opportunity attacks anyway: they're all far too busy.)");
        break;
      case "attack": {
        if (this.actionUsed) { say("You've already used your action this turn. (E to end your turn.)"); break; }
        const target = this.fighters.find(f => f.setup.id === action.target && !f.out);
        if (!target) { say("There's nobody there to hit."); break; }
        const distance = chebyshev(target.at, me.at);
        const weapons = await this.arsenal();
        const weapon = (action.weapon ? weapons.find(w => w.id === action.weapon && w.reach >= distance) : undefined)
          ?? (distance <= 1 ? weapons.find(w => !w.ranged) ?? weapons[0] : weapons.find(w => w.reach >= distance));
        if (!weapon) { say(`${target.setup.name} is ${distance * 5} ft away: out of reach. Walk closer (arrows), or cast something.`); break; }
        this.actionUsed = true;
        const outcome = await playerAttack(this.session, this.fighters.filter(f => !f.player).map(f => f.character), target.character.id, weapon.id);
        for (const line of outcome.lines) say(`🎲 ${line}`);
        break;
      }
      case "cast": {
        if (this.actionUsed) { say("You've already used your action this turn."); break; }
        const target = action.target === "self" || action.target === "player" ? "self" : this.fighters.find(f => f.setup.id === action.target && !f.out)?.character.id;
        this.actionUsed = true;
        const outcome = await castSpell(this.session, this.fighters.filter(f => !f.player).map(f => f.character), action.spell, target ? [target] : []);
        for (const line of outcome.lines) say(line.startsWith("(") ? line : `🎲 ${line}`);
        break;
      }
      case "end":
        this.nextTurn();
        return this.log.slice(before);
    }
    if (action.kind === "attack" || action.kind === "cast") {
      await this.refresh();
      await this.readHealth();
    }
    // Nothing left to do this turn: move on.
    if (!this.over && this.actionUsed && this.movementLeft < 5) this.nextTurn();
    return this.log.slice(before);
  }

  async advance(): Promise<string[]> {
    if (this.over || !this.order.length) return [];
    const f = this.current;
    if (f.player && !f.out) return [];
    const before = this.log.length;
    if (!f.out) await this.npcTurn(f);
    await this.refresh();
    await this.readHealth();
    this.nextTurn();
    return this.log.slice(before);
  }

  private async npcTurn(f: Fighter): Promise<void> {
    const foes = this.fighters.filter(o => !o.out && this.hostile(f, o));
    if (!foes.length) return;
    if (f.coward) {
      const lines = [
        `${f.setup.name} keeps a sack stack between himself and the unpleasantness, and says, "Crakes. Do be quick."`,
        `${f.setup.name} observes from a safe distance, making a note of everybody's name for later.`,
        `${f.setup.name} reminds everyone present that he is an officer of the Royal Purveyor. Nobody stops hitting anybody.`,
      ];
      this.log.push(lines[(this.round - 1) % lines.length]!);
      return;
    }
    const target = foes.sort((a, b) => chebyshev(a.at, f.at) - chebyshev(b.at, f.at) || Number(b.player) - Number(a.player))[0]!;
    // Close in: the shortest walk to a square next to the target, as far as their speed allows.
    if (chebyshev(target.at, f.at) > 1) {
      const path = this.pathTo(f, target.at, f.speed / 5);
      if (path.length) {
        f.at = path.at(-1)!;
        this.log.push(`${f.setup.name} ${path.length > 3 ? "charges" : "closes"} on ${target.player ? "you" : target.setup.name}.`);
      }
    }
    if (chebyshev(target.at, f.at) <= 1) this.log.push(...await this.strike(f, target));
    else this.log.push(`${f.setup.name} can't reach ${target.player ? "you" : target.setup.name} this turn.`);
  }

  /** Breadth-first: a walk to any free square next to `goal`, cut to `steps` squares. */
  private pathTo(f: Fighter, goal: Tile2, steps: number): Tile2[] {
    const key = (p: Tile2) => `${p.x},${p.y}`;
    const prev = new Map<string, Tile2 | null>([[key(f.at), null]]);
    const queue: Tile2[] = [f.at];
    let end: Tile2 | undefined;
    while (queue.length) {
      const p = queue.shift()!;
      if (chebyshev(p, goal) <= 1 && !same(p, f.at)) { end = p; break; }
      for (const d of Object.values(STEP)) {
        const n = add(p, d);
        if (prev.has(key(n)) || !this.walkable(n, f)) continue;
        prev.set(key(n), p);
        queue.push(n);
      }
    }
    if (!end) return [];
    const path: Tile2[] = [];
    for (let p: Tile2 | null | undefined = end; p && !same(p, f.at); p = prev.get(key(p))) path.unshift(p);
    return path.slice(0, Math.max(0, Math.floor(steps)));
  }

  /** One blow by someone other than the player, resolved by the engine. */
  private async strike(attacker: Fighter, target: Fighter): Promise<string[]> {
    const ctx = await open(this.session);
    const aId = enlist(ctx, this.session, attacker.character);
    const tId = target.player ? this.session.rules!.pc : enlist(ctx, this.session, target.character);
    const weapon = this.session.rules!.npcs[attacker.character.id]!.weapon;
    const weaponName = ctx.engine.content.items.get(ctx.campaign.state.itemInstances[weapon]?.definitionId ?? "")?.name ?? "fists";
    const lines: string[] = [];
    try {
      const events = ctx.apply(ctx.engine.plan.attack(ctx.campaign.state, { attackerId: aId, targetId: tId, weaponInstanceId: weapon, ...(target.dodging ? { advantage: "disadvantage" as const } : {}) }).events);
      const who = target.player ? "you" : target.setup.name;
      for (const e of events) {
        if (e.type === "AttackRolled") {
          const d20 = (e["d20"] as number[]).join("/");
          const verdict = e["critical"] ? "critical hit!" : e["hit"] ? "hit" : "miss";
          lines.push(`🎲 ${attacker.setup.name}'s ${weaponName.toLowerCase()} at ${who}: ${d20}${target.dodging ? " (disadvantage)" : ""} ${signed(Number(e["attackBonus"]))} = ${e["total"]} vs AC ${e["targetAC"]}: ${verdict}`);
        } else if (e.type === "DamageApplied") {
          const amount = (e["components"] as Array<{ amount: number; type: string }>).map(c => `${c.amount} ${c.type}`).join(" and ");
          const c = ctx.campaign.state.characters[tId]!;
          lines.push(`🎲 ${target.player ? "You take" : `${target.setup.name} takes`} ${amount} damage${target.player ? ` (HP ${Math.max(0, c.hp.current)}/${c.hp.max})` : ` (${hurt(c)})`}`);
        }
      }
    } catch (error) {
      lines.push(`(${attacker.setup.name} fumbles: ${error instanceof Error ? error.message : String(error)})`);
    }
    close(this.session, ctx);
    return lines;
  }
}

export const standInCombat: CombatAdapter = {
  async start(setup: CombatSetup, session: SessionState) {
    if (!session.rules) throw new Error("This session has no rules-engine character, so there's nobody to fight with.");
    const fight = new StandInFight(setup, session);
    await fight.begin();
    return fight;
  },
};
