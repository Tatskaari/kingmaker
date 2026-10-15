import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sceneById } from "../../../scenes/index.ts";
import type { SceneWorld } from "../../world/scene-world.ts";
import { TacticalFight, type CombatController } from "../combat/index.ts";
import { dressingFor } from "../look/dressings.ts";
import { renderStage } from "../look/stage.ts";
import { actorsAt, getMap, inRect } from "../map/index.ts";
import { isStructure, tileAt } from "../map/tiles.ts";
import type { Game as Core } from "../play.ts";
import { exploreState } from "../town.ts";
import type { Tile2 } from "../types.ts";
import { fightEffects, fightView } from "../views.ts";
import { available, EXHIBITS, placePlayer, triggerById, wingWorld } from "./explorer.ts";
import { loadZoo, newZoo } from "./game.ts";
import { lookFor, playNews, RecordingEffects } from "./look.ts";
import { zooOf, type Exhibit, type Plan, type Wing } from "./model.ts";
import { mapPicture, savePicture, stagePicture } from "./pictures.ts";
import { ROOMS, WINGS } from "./wings/index.ts";

/**
 * The zoo's tour (tour.ts runs it): a visitor goes round every wing, reads every sign, sets off
 * every exhibit's triggers in turn, plays each scene and fights each fight to its end, saves what
 * the screen showed at each (text, ANSI, PNG), and reports what each exhibit played against what
 * it should. Offline the scenes open on their places with the GM silent and take their endings at
 * once; --live says the exhibits' lines to the real GM first.
 */

export interface TourOptions {
  /** Where the pictures and the report go. */
  out: string;
  live?: boolean;
  /** Only these wings (ids, or a word of their names). */
  only?: string[];
  png?: boolean;
  seed?: number;
  log?: (line: string) => void;
}

export interface StepReport {
  /** A trigger's id, "sign", "scene:<id>", "talk:<who>". */
  id: string;
  label: string;
  /** What the game said. */
  said: string;
  /** What the view played (effect kinds, float kinds, barks, "moves", "fight", "scene"). */
  played: string[];
  expected: string[];
  missing: string[];
  skipped?: string;
  error?: string;
  /** Pictures saved, by file. */
  shots: string[];
  ok: boolean;
}

export interface ExhibitReport { wing: string; id: string; title: string; needsModel: boolean; steps: StepReport[]; ok: boolean }

export interface TourReport { live: boolean; seed: number; out: string; exhibits: ExhibitReport[]; failures: string[]; seen: number; total: number; ms: number }

const MAP = { w: 100, h: 32 };
const STAGE = { w: 96, h: 32 };
const FIGHT = { w: 90, h: 30 };
/** The clock for the pictures: effects are mid-flight half a second in. */
const T0 = 10_000, MID = 520;

export async function runTour(options: TourOptions): Promise<TourReport> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const live = !!options.live;
  const seed = options.seed ?? 1;
  const out = resolve(options.out);
  mkdirSync(out, { recursive: true });
  const wings = options.only?.length ? WINGS.filter(w => options.only!.some(o => named(o).includes(w))) : WINGS;
  const tour = new Tour(await newZoo({ seed }), out, live, options.png !== false, log);
  const exhibits: ExhibitReport[] = [];
  for (const wing of wings) {
    log(`\n${wing.name.toUpperCase()} (${wing.id})`);
    placePlayer(tour.core.state, wing.id, wing.entry);
    tour.shoot(`${wing.id}/00-${wing.id}`, "map");
    for (const exhibit of wing.exhibits) exhibits.push(await tour.exhibit(wing, exhibit));
    tour.shoot(`${wing.id}/99-after`, "map", "stage");
  }
  const seen = new Set(zooOf(tour.core.state).seen);
  const toured = EXHIBITS.filter(e => wings.includes(e.wing));
  const unseen = toured.filter(e => !seen.has(e.id)).map(e => `${e.wing.id}/${e.id}: never marked seen`);
  const failures = [...exhibits.flatMap(x => x.steps.filter(s => !s.ok).map(s => `${x.wing}/${x.id} ${s.id}: ${s.error ?? (s.missing.length ? `didn't play ${s.missing.join(", ")}` : s.skipped ?? "failed")}`)), ...unseen];
  const report: TourReport = { live, seed, out, exhibits, failures, seen: toured.length - unseen.length, total: toured.length, ms: Date.now() - started };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
  writeFileSync(join(out, "report.txt"), reportText(report));
  return report;
}

/** The wings a word names: by id ("zoo-fire", or just "fire"), else by a word of their name ("looks"). */
function named(word: string): Wing[] {
  const w = word.toLowerCase();
  const byId = WINGS.filter(x => x.id === w || x.id === `zoo-${w}`);
  return byId.length ? byId : WINGS.filter(x => x.name.toLowerCase().includes(w));
}

/** The report as text: every exhibit, what each step said and played, and the failures. */
export function reportText(r: TourReport): string {
  const lines = [`The zoo's tour (${r.live ? "live, with the GM" : "offline"}, seed ${r.seed}): ${r.exhibits.length} exhibits, ${r.seen} of ${r.total} seen, ${r.failures.length} failures, ${Math.round(r.ms / 1000)} s.`, ""];
  let wing = "";
  for (const x of r.exhibits) {
    if (x.wing !== wing) { wing = x.wing; lines.push(`== ${wing}`); }
    lines.push(`${x.ok ? "ok  " : "FAIL"} ${x.title}${x.needsModel ? " (needs the GM)" : ""}`);
    for (const s of x.steps) {
      const mark = s.error ? "!!" : s.skipped ? "--" : s.ok ? "  " : "!!";
      lines.push(`  ${mark} ${s.label}${s.played.length ? ` [${[...new Set(s.played)].join(" ")}]` : ""}${s.missing.length ? ` MISSING ${s.missing.join(" ")}` : ""}${s.skipped ? ` (${s.skipped})` : ""}${s.error ? ` ERROR ${s.error}` : ""}`);
      if (s.said) lines.push(`       ${s.said.replace(/\s+/g, " ").slice(0, 220)}`);
    }
  }
  if (r.failures.length) lines.push("", "Failures:", ...r.failures.map(f => `  ${f}`));
  return `${lines.join("\n")}\n`;
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

class Tour {
  core: Core;
  private n = 0;
  readonly out: string;
  readonly live: boolean;
  readonly png: boolean;
  readonly log: (line: string) => void;
  constructor(core: Core, out: string, live: boolean, png: boolean, log: (line: string) => void) { this.core = core; this.out = out; this.live = live; this.png = png; this.log = log; }

  private get game() { return this.core.state; }
  private get session() { return this.core.session; }
  /** The game's mode now (a method, so a check after an await isn't narrowed by one before it). */
  private mode(): string { return this.core.state.mode; }

  /** Save the map, and the wing's world from above, as they are at T0 (with a look's effects playing). */
  shoot(name: string, ...what: Array<"map" | "stage">): string[] {
    return this.shootWith(name, undefined, what);
  }

  private shootWith(name: string, look: ReturnType<typeof lookFor> | undefined, what: Array<"map" | "stage">): string[] {
    const files: string[] = [];
    const dir = join(this.out, name.split("/")[0]!);
    const base = name.split("/").slice(1).join("-");
    if (what.includes("map")) files.push(...savePicture(dir, `${base}-map`, mapPicture(this.game, this.session, MAP, T0 + MID, look), { png: this.png }));
    if (what.includes("stage")) {
      const stage = stagePicture(this.game, STAGE, T0 + MID, look);
      if (stage) files.push(...savePicture(dir, `${base}-stage`, stage, { png: this.png }));
    }
    return files.filter(f => f.endsWith(".png") || (!this.png && f.endsWith(".txt")));
  }

  async exhibit(wing: Wing, exhibit: Exhibit): Promise<ExhibitReport> {
    const steps: StepReport[] = [];
    this.log(`  ${exhibit.title}`);
    steps.push(await this.sign(wing, exhibit));
    const ids = exhibit.tour ?? exhibit.triggers.map(t => t.id);
    for (const id of ids) steps.push(await this.trigger(wing, exhibit, id, !!exhibit.tour));
    if (exhibit.scene) steps.push(await this.room(wing, exhibit, exhibit.scene));
    if (exhibit.talk) steps.push(await this.talk(wing, exhibit, exhibit.talk));
    for (const s of steps) this.log(`    ${s.ok ? (s.skipped ? "--" : "ok") : "!!"} ${s.label}${s.played.length ? ` [${[...new Set(s.played)].join(" ")}]` : ""}${s.missing.length ? ` MISSING ${s.missing.join(" ")}` : ""}${s.error ? ` ERROR ${s.error}` : ""}`);
    return { wing: wing.id, id: exhibit.id, title: exhibit.title, needsModel: !!exhibit.needsModel, steps, ok: steps.every(s => s.ok) };
  }

  /** Read the sign: stand by it (so the picture shows the exhibit), and look at it. */
  private async sign(wing: Wing, exhibit: Exhibit): Promise<StepReport> {
    const step = this.step("sign", `Read the sign: ${exhibit.title}`, []);
    const by = besideSign(this.core, wing, exhibit.sign);
    if (by) placePlayer(this.game, wing.id, by);
    try {
      step.said = await this.core.act(`look@${exhibit.sign.x},${exhibit.sign.y}`);
      if (!step.said.includes(exhibit.title.toUpperCase())) step.error = `looking at the sign at ${exhibit.sign.x},${exhibit.sign.y} didn't read it`;
    } catch (error) { step.error = message(error); }
    step.shots = this.shootWith(`${wing.id}/${String(++this.n).padStart(3, "0")}-${exhibit.id}-sign`, undefined, ["map"]);
    return this.done(step);
  }

  /** Set a trigger off, as use_<id> does: walk over, do it, play what it did, and fight or play whatever it started. */
  private async trigger(wing: Wing, exhibit: Exhibit, id: string, listed: boolean): Promise<StepReport> {
    const found = triggerById(id);
    const step = this.step(id, found?.trigger.label ?? id, found?.trigger.expect ?? []);
    if (!found) { step.error = `no trigger ${id}`; return this.done(step); }
    if (exploreState(this.game).map !== wing.id) placePlayer(this.game, wing.id, wing.entry);
    if (!available(this.game, this.session, id)) {
      step.skipped = "not on offer just now";
      if (listed) step.error = "the tour's plan has it, but it isn't on offer";
      return this.done(step);
    }
    const world = wingWorld(this.game, wing.id);
    const fx = new RecordingEffects();
    const look = world ? lookFor(world, fx) : undefined;
    const seq = zooOf(this.game).seq;
    try {
      step.said = await this.core.act(`use_${id}`);
    } catch (error) {
      if (this.mode() !== "scene") { step.error = message(error); return this.done(step); }
      step.said = `(offline: ${message(error).slice(0, 100)})`;
    }
    const z = zooOf(this.game);
    const now = wingWorld(this.game, wing.id);
    if (z.news && z.news.seq !== seq && look && now === world) {
      const did = playNews(look, z.news, T0);
      if (did.some(d => / moves$/.test(d) && !d.startsWith(this.session.player.name))) step.played.push("moves");
    }
    step.played.push(...fx.played.map(p => p.kind));
    const name = `${wing.id}/${String(++this.n).padStart(3, "0")}-${exhibit.id}-${slug(id)}`;
    step.shots.push(...this.shootWith(name, look && now === world ? look : undefined, ["map", "stage"]));
    if (this.mode() === "combat") await this.fight(step, name, found.trigger.plan ?? {});
    else if (this.mode() === "scene") await this.scene(step, name, found.trigger.plan ?? {});
    return this.done(step);
  }

  /** Walk into a scene's room: it opens, and is played to an ending. */
  private async room(wing: Wing, exhibit: Exhibit, plan: Plan & { id: string }): Promise<StepReport> {
    const step = this.step(`scene:${plan.id}`, `Step into ${sceneById(plan.id).title}`, ["scene"]);
    const room = ROOMS.find(r => r.sceneId === plan.id);
    if (!room) { step.error = `no room opens ${plan.id}`; return this.done(step); }
    placePlayer(this.game, room.map, outsideOf(room.rooms[0]!, room.door));
    const inside = insideOf(room.rooms[0]!, room.door);
    try {
      step.said = await this.core.act(`walk@${inside.x},${inside.y}`);
    } catch (error) {
      if (this.mode() !== "scene") { step.error = message(error); return this.done(step); }
      step.said = `(offline: ${message(error).slice(0, 100)})`;
    }
    if (this.mode() !== "scene" || this.session.sceneId !== plan.id) { step.error = `walking into ${room.name} didn't open ${plan.id} (mode ${this.mode()})`; return this.done(step); }
    await this.scene(step, `${wing.id}/${String(++this.n).padStart(3, "0")}-${exhibit.id}-scene`, plan);
    placePlayer(this.game, wing.id, exploreState(this.game).map === wing.id ? exploreState(this.game).at : wing.entry);
    return this.done(step);
  }

  /** A word with someone walking with you: the talk opens (offline its greeting fails), then you walk on. */
  private async talk(wing: Wing, exhibit: Exhibit, talk: { with: string; say?: string[] }): Promise<StepReport> {
    const step = this.step(`talk:${talk.with}`, `A word with ${talk.with}`, []);
    const ex = exploreState(this.game);
    const friend = ex.followers.find(f => f.id === talk.with);
    if (!friend) { step.skipped = `${talk.with} isn't walking with you`; return this.done(step); }
    try {
      step.said = await this.core.act(`talk_${talk.with}`);
    } catch (error) {
      if (this.mode() !== "scene") { step.error = message(error); return this.done(step); }
      step.said = `(offline: ${message(error).slice(0, 100)})`;
    }
    if (this.mode() !== "scene" || !this.session.talk) { step.error = `talking to ${talk.with} didn't start a talk (mode ${this.mode()})`; return this.done(step); }
    step.played.push("talk");
    if (this.live) for (const line of talk.say ?? []) { if (this.mode() !== "scene" || !this.session.talk) break; step.said += `\n> ${line}\n${await this.core.say(line).catch(e => `(${message(e)})`)}`; }
    if (this.mode() === "scene") step.said += `\n${await this.core.act("walk_on").catch(e => `(${message(e)})`)}`;
    if (this.mode() !== "explore") step.error = `the talk didn't end back on the map (mode ${this.mode()})`;
    step.shots.push(...this.shootWith(`${wing.id}/${String(++this.n).padStart(3, "0")}-${exhibit.id}-talk`, undefined, ["map"]));
    return this.done(step);
  }

  /** A scene is open: (live) say its lines; take its ending; a fight from it is fought, and its aftermath ended too. */
  private async scene(step: StepReport, name: string, plan: Plan): Promise<void> {
    const sceneId = this.session.sceneId;
    const scene = sceneById(sceneId);
    step.played.push("scene");
    step.shots.push(...this.stageShot(`${name}-open`));
    if (this.live) {
      for (const line of plan.say ?? []) {
        if (this.mode() !== "scene" || this.session.ended) break;
        const said = await this.core.say(line).catch(e => `(${message(e)})`);
        step.said += `\n> ${line}\n${said.slice(0, 600)}`;
      }
    }
    const exit = plan.exit ?? scene.exits.find(e => e.kind !== "combat")?.id ?? scene.exits[0]!.id;
    if (this.mode() === "scene" && this.session.sceneId === sceneId && !this.session.ended) step.said += `\n/end ${exit}: ${await this.end(exit)}`;
    else if (this.mode() === "scene" && this.session.ended) step.said += `\n${await this.core.carryOn().catch(e => `(${message(e)})`)}`;
    step.shots.push(...this.stageShot(`${name}-ended`));
    if (this.mode() === "combat") {
      await this.fight(step, `${name}-fight`, plan, false);
      if (this.mode() === "scene") {
        const after = plan.after ?? scene.exits.find(e => e.kind !== "combat" && !this.session.fought?.includes(e.id))?.id;
        if (after && !this.session.ended) step.said += `\n/end ${after}: ${await this.end(after)}`;
        else if (this.session.ended) step.said += `\n${await this.core.carryOn().catch(e => `(${message(e)})`)}`;
      }
    }
    if (this.mode() !== "explore") step.error = `${scene.title} didn't end back on the map (mode ${this.mode()})`;
    else if (!zooOf(this.game) || exploreState(this.game).scene) step.error = `${scene.title} left the map in the scene`;
  }

  private async end(exit: string): Promise<string> {
    try { return (await this.core.endScene(exit)).replace(/\s+/g, " ").slice(0, 300); } catch (error) { return `(offline: ${message(error).slice(0, 100)})`; }
  }

  /** The scene's place from above, as the scene screen draws it beside the transcript. */
  private stageShot(name: string): string[] {
    const world: SceneWorld | undefined = this.session.world;
    if (!world) return [];
    const canvas = renderStage(world, dressingFor(world.scene), { w: STAGE.w, h: STAGE.h, t: T0, time: this.game.story.time });
    const dir = join(this.out, name.split("/")[0]!);
    return savePicture(dir, name.split("/").slice(1).join("-"), canvas, { png: this.png }).filter(f => f.endsWith(".png") || (!this.png && f.endsWith(".txt")));
  }

  /**
   * A fight: its first moves as planned, then (after saving and loading the game, as Continue
   * would) the dice decide the rest; what the battlefield showed is recorded; then back.
   */
  private async fight(step: StepReport, name: string, plan: Plan, fromMap = true): Promise<void> {
    step.played.push("fight");
    const fx = new RecordingEffects();
    const shots = (what: string) => {
      const c = this.controller();
      if (!c) return;
      const lines = fightView(c, this.session, FIGHT, { effects: fx, t: T0 + MID });
      step.shots.push(...savePicture(join(this.out, name.split("/")[0]!), `${name.split("/").slice(1).join("-")}-${what}`, lines, { png: this.png }).filter(f => f.endsWith(".png") || (!this.png && f.endsWith(".txt"))));
    };
    let c = this.controller();
    let seen = c?.state().log.length ?? 0;
    let dust: Tile2[] = c?.state().dust.map(k => { const [x, y] = k.split(",").map(Number); return { x: x!, y: y! }; }) ?? [];
    const play = () => {
      const now = this.controller();
      if (!now) return;
      const G = now.state();
      fightEffects(fx, now, G.log.slice(seen), T0, dust);
      seen = G.log.length;
      dust = G.dust.map(k => { const [x, y] = k.split(",").map(Number); return { x: x!, y: y! }; });
    };
    shots("start");
    for (const id of plan.fight ?? []) {
      const said = await this.core.act(id).catch(e => `(${message(e)})`);
      step.said += `\n> ${id}: ${said.split("\n").slice(0, 3).join(" ").slice(0, 200)}`;
      play();
    }
    if (plan.fight?.length) shots("first");
    // Saved and carried on, as a game quit mid-fight and continued.
    if (fromMap && this.core.currentFight && !this.core.currentFight.result()) {
      this.core.save();
      this.core = loadZoo(this.core.state.id);
      c = this.controller();
      seen = c?.state().log.length ?? seen;
      step.played.push("resumed");
    }
    for (let i = 0; i < 120 && this.mode() === "combat" && !this.core.currentFight?.result(); i++) {
      await this.core.act("auto").catch(e => { step.error = `auto: ${message(e)}`; });
      play();
      if (step.error) break;
    }
    shots("end");
    step.played.push(...fx.played.map(p => p.kind));
    const result = this.core.currentFight?.result();
    if (!result) { step.error ??= "the fight didn't end"; return; }
    step.said += `\nThe fight: ${result.summary}`;
    try {
      step.said += `\n${(await this.core.act("continue")).replace(/\s+/g, " ").slice(0, 300)}`;
    } catch (error) {
      step.said += `\n(offline: ${message(error).slice(0, 100)})`;
    }
    if (fromMap && this.mode() !== "explore") step.error = `the fight didn't end back on the map (mode ${this.mode()})`;
  }

  private controller(): CombatController | undefined {
    const f = this.core.currentFight;
    return f instanceof TacticalFight ? f.controller : undefined;
  }

  private step(id: string, label: string, expected: string[]): StepReport {
    return { id, label, said: "", played: [], expected, missing: [], shots: [], ok: true };
  }

  private done(step: StepReport): StepReport {
    const played = new Set(step.played);
    step.missing = step.skipped ? [] : step.expected.filter(k => !played.has(k));
    step.ok = !step.error && !step.missing.length;
    return step;
  }
}

/** A free tile beside a sign to stand on (in front of it first), outside the zoo's scenes' rooms. */
function besideSign(core: Core, wing: Wing, sign: Tile2): Tile2 | undefined {
  const map = getMap(wing.id);
  const ex = exploreState(core.state);
  const around = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => ({ x: sign.x + dx!, y: sign.y + dy! }));
  return around.find(t => {
    const tile = tileAt(map, t);
    if (!tile || tile.blocks || isStructure(tile) || tile.terrain === "water" || tile.terrain === "deep-water" || tile.terrain === "door") return false;
    if (ROOMS.some(r => r.map === wing.id && r.rooms.some(rect => inRect(rect, t)))) return false;
    if (map.exits.some(e => e.at.x === t.x && e.at.y === t.y)) return false;
    return !actorsAt(ex, t).some(a => a.blocks);
  });
}

/** The tile just inside a room's door, and just outside it. */
function insideOf(rect: { x: number; y: number; w: number; h: number }, door: Tile2): Tile2 {
  const around = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => ({ x: door.x + dx!, y: door.y + dy! }));
  return around.find(t => inRect(rect, t)) ?? { x: rect.x + Math.floor(rect.w / 2), y: rect.y + Math.floor(rect.h / 2) };
}
function outsideOf(rect: { x: number; y: number; w: number; h: number }, door: Tile2): Tile2 {
  const inside = insideOf(rect, door);
  return { x: door.x + (door.x - inside.x), y: door.y + (door.y - inside.y) };
}
