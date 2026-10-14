import { join } from "node:path";
import { Game as Core } from "../game/play.ts";
import type { CombatSetup, MapActor, StoryState } from "../game/types.ts";
import { setCallLog } from "../llm/openrouter.ts";
import { sheetText } from "../rules/dnd.ts";
import { sceneEntries } from "../runtime/brief.ts";
import { forceEnding, type TurnHooks } from "../runtime/engine.ts";
import { sessionDir, snapshotSession, type Entry, type EntryKind, type SessionState } from "../runtime/session.ts";
import { sceneById } from "../../scenes/index.ts";
import { combat, maps, type CombatAction, type CombatController, type Dir, type Position } from "./adapters.ts";
import { afterTurn } from "../runtime/background.ts";
import { actionIdOf, mapExplorer, MOVE_ID } from "./explorer.ts";
import { fightActionId, tacticalFights } from "./fights.ts";
import { repairCampaign } from "./rules-repair.ts";
import { loadExtras, resumable, saveExtras, type JournalEntry, type Resumable } from "./save.ts";
import { DEFAULT_CONCEPT, DEFAULT_NAME, epilogue, LEVEL, notebookLines, TIME_WORDS, type Epilogue } from "./story.ts";

/**
 * The game as the terminal UI sees it. The story flow is the game core's (src/game/play.ts: explore,
 * scene, combat, the end, and what links them); this holds what the screens need on top: which
 * screen is up, the transcript with the GM's reply streaming in, the cards between scenes, the
 * notebook, overlays. Exploration and fights plug into the core as an Explorer and a FightFactory
 * over the map and combat adapters. It holds no React; screens subscribe and redraw when it changes.
 */

export type Screen = "title" | "create" | "creating" | "created" | "explore" | "scene" | "between" | "combat" | "end";

export interface Line {
  kind: EntryKind | "header" | "error";
  /** Speaker id (a cast id, "gm", "player", "dice", "system"). */
  speaker: string;
  /** Display name for dialogue and the player. */
  name?: string;
  text: string;
}

export interface Card {
  title: string;
  lines: string[];
  /** Still working: show the spinner, ignore Enter. */
  working?: string;
  /** Where Enter goes from here. */
  next?: "explore" | "combat" | "scene" | "end";
}

export type Overlay =
  | { kind: "sheet"; text: string }
  | { kind: "help" }
  | { kind: "journal" }
  | { kind: "scene-map" }
  | { kind: "menu"; index: number }
  | { kind: "spells"; spells: Array<{ id: string; name: string; level: number }>; index: number };

const GM_BUSY = ["The GM is thinking…", "The GM consults their notes…", "The GM rolls something behind the screen and won't say what…", "The GM is doing the voices…", "The GM looks up the rules, then decides against them…"];
const DELAY = () => Number(process.env.KM_APP_COMBAT_DELAY_MS ?? 450);

/** For testing (#end): the core's own "this scene has ended" step, which isn't public (proposal: a Game.endScene for QA). */
const coreAfterScene = (core: Core, hooks: TurnHooks) => (core as unknown as { afterScene(h: TurnHooks): Promise<string> }).afterScene(hooks);

export class Game {
  screen: Screen = "title";
  saves: Resumable[] = [];
  core?: Core;
  readonly explorer = mapExplorer(maps);
  readonly fights = tacticalFights(combat, maps);
  messages: string[] = [];
  journal: JournalEntry[] = [];
  lines: Line[] = [];
  live?: Line;
  busy?: string;
  status?: string;
  card?: Card;
  /** The player's chosen target in a fight (index into the fight's targets, and its id). */
  targetIndex = 0;
  targetId?: string;
  overlay?: Overlay;
  sheet?: string;
  creating?: { name: string; concept: string };
  ending?: Epilogue;
  error?: string;
  /** Set when the app should exit (main.tsx tears the renderer down). */
  quitting = false;

  /** The scene the transcript shows (a summons can open the next scene inside a turn). */
  private shown?: string;
  private listeners = new Set<() => void>();
  private pending?: ReturnType<typeof setTimeout>;
  private busyTurn = 0;

  constructor() {
    // Other combatants' turns: redraw after each, and give the player a beat to see it land.
    this.fights.pace = async () => {
      if (this.screen !== "combat") return;
      this.busy = "The others act…";
      this.emit();
      await sleep(DELAY());
    };
  }

  get session(): SessionState | undefined { return this.core?.session; }
  get story(): StoryState { return this.core?.state.story ?? { time: "morning", played: [], flags: {} }; }
  get pos(): Position { return this.core ? this.explorer.position(this.core.state) : maps.start(); }
  get actors(): MapActor[] { return this.core ? this.explorer.actors(this.core.state) : []; }
  get fight(): CombatController | undefined { return this.core?.state.mode === "combat" ? this.fights.current?.controller : undefined; }
  get setup(): CombatSetup | undefined { return this.core?.state.mode === "combat" ? this.fights.current?.setup : undefined; }
  get playerActor(): MapActor {
    return { id: "player", name: this.session?.player.name ?? "you", kind: "player", glyph: "@", map: this.pos.map, at: this.pos.at };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(): void {
    if (this.pending) { clearTimeout(this.pending); this.pending = undefined; }
    for (const l of this.listeners) l();
  }

  /** Streaming text arrives a token at a time: redraw at most ~30 times a second. */
  private emitSoon(): void {
    this.pending ??= setTimeout(() => this.emit(), 33);
  }

  // -------------------------------------------------------------------------------------------
  // Title and character creation

  loadSaves(): void {
    this.saves = resumable();
    this.emit();
  }

  newCharacter(): void {
    this.screen = "create";
    this.emit();
  }

  async create(name: string, concept: string): Promise<void> {
    this.creating = { name, concept };
    this.screen = "creating";
    this.error = undefined;
    this.emit();
    try {
      const who = `${(name.trim() || DEFAULT_NAME).replace(/:/g, " ")}: ${concept.trim() || DEFAULT_CONCEPT}`;
      const core = await Core.create({ player: who, level: LEVEL, explorer: this.explorer, fights: this.fights });
      this.core = core;
      setCallLog(join(sessionDir(core.state.id), "calls.jsonl"));
      this.sheet = await sheetText(core.session);
      this.journal = [];
      this.messages = [`${TIME_WORDS[core.state.story.time]}. ${sceneById(core.session.sceneId).hook}`];
      this.screen = "created";
      this.saveExtras();
    } catch (error) {
      this.error = `Character creation failed: ${message(error)}`;
      this.screen = "create";
    }
    this.emit();
  }

  async resume(r: Resumable): Promise<void> {
    const core = Core.load(r.id, this.explorer, this.fights);
    if (repairCampaign(core.session)) core.save();
    this.core = core;
    setCallLog(join(sessionDir(r.id), "calls.jsonl"));
    const extras = loadExtras(r.id);
    this.messages = extras?.messages ?? [];
    this.journal = extras?.journal ?? [];
    this.overlay = undefined;
    switch (core.state.mode) {
      case "combat":
        this.screen = "combat";
        this.say("You pick yourself up where you left off: mid-brawl.");
        this.emit();
        await this.fights.current?.ready;
        this.busy = undefined;
        break;
      case "scene":
        this.screen = "scene";
        this.showSceneSoFar();
        this.emit();
        // The scene ended but the story hadn't moved on (quit mid-way): carry on from there.
        if (core.session.ended) await this.afterSceneNow();
        break;
      case "end":
        this.toEnd();
        break;
      default:
        this.screen = "explore";
    }
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Explore

  begin(): void {
    this.screen = "explore";
    this.emit();
  }

  say(text: string): void {
    this.messages = [...this.messages, text].slice(-20);
  }

  walk(dir: Dir): void {
    if (!this.core || this.busy) return;
    void this.explore(MOVE_ID[dir]);
  }

  interact(): void {
    if (!this.core || this.busy) return;
    const target = maps.reachable(this.pos, this.actors)[0];
    const lead = this.story.lead;
    if (target?.interaction) { void this.explore(actionIdOf(target)); return; }
    if (lead && !maps.sceneLocation(lead)) { void this.explore("go_lead"); return; }
    const near = maps.nearby(this.pos, this.actors, 4).find(n => n.actor.interaction);
    this.say(near ? `Nothing within reach. (${capital(near.actor.name)} is ${near.distance} paces away.)` : "There's nothing here to interact with but the weather.");
    this.emit();
  }

  /** An explore action through the core; stepping into the lead's place opens its scene. */
  private async explore(id: string): Promise<void> {
    const core = this.core!;
    const run = core.act(id, this.hooks());
    // The core switches to the scene before the opening streams in: show it as it comes.
    const opening = core.state.mode === "scene";
    if (opening) this.sceneView("The GM sets the scene…");
    this.emit();
    try {
      const text = await run;
      if (!opening && text) this.say(text);
    } catch (error) {
      if (opening) this.lines.push({ kind: "error", speaker: "system", text: `The GM couldn't open the scene: ${message(error)}. (#end <exit> skips ahead for testing.)` });
      else this.say(message(error));
    }
    this.busy = undefined;
    this.live = undefined;
    this.saveExtras();
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Scene

  private nameOf(speaker: string): string {
    if (speaker === "player") return this.session?.player.name ?? "You";
    if (!this.session) return speaker;
    return sceneById(this.session.sceneId).cast.find(c => c.id === speaker)?.name ?? speaker;
  }

  private lineOf(e: Entry): Line {
    return { kind: e.kind, speaker: e.speaker, ...(e.kind === "dialogue" || e.kind === "player" ? { name: this.nameOf(e.speaker) } : {}), text: e.text };
  }

  private header(): Line {
    const scene = sceneById(this.session!.sceneId);
    return { kind: "header", speaker: "system", name: scene.title, text: this.session!.lead ?? scene.hook };
  }

  private sceneView(busy?: string): void {
    this.screen = "scene";
    this.shown = this.session!.sceneId;
    this.lines = [this.header()];
    this.live = undefined;
    this.status = undefined;
    this.busy = busy;
  }

  private showSceneSoFar(): void {
    this.shown = this.session!.sceneId;
    this.lines = [this.header(), ...sceneEntries(this.session!).map(e => this.lineOf(e))];
    this.live = undefined;
  }

  /** A summons can open the next scene inside a turn: the transcript follows it. */
  private follow(): void {
    const id = this.session?.sceneId;
    if (id && id !== this.shown && this.screen === "scene") { this.shown = id; this.lines = [this.header()]; }
  }

  private hooks(): TurnHooks {
    return {
      // The turn stays busy until the core has finished with it (and saved it): the reply streams
      // first, then the after-reply decision, the stage manager, and maybe the next scene.
      onSpeaker: (speaker, kind) => {
        this.follow();
        this.live = { kind, speaker, ...(kind === "dialogue" ? { name: this.nameOf(speaker) } : {}), text: "" };
        this.busy = kind === "dialogue" ? `${this.nameOf(speaker)} is speaking…` : "The GM is speaking…";
        this.emit();
      },
      onText: text => {
        if (!this.live) return;
        this.live.text = text;
        this.emitSoon();
      },
      onEntry: entry => {
        this.follow();
        if (entry.kind === "narration" || entry.kind === "dialogue") {
          this.live = undefined;
          if (this.busy) this.busy = "The GM makes a note…";
        }
        this.lines.push(this.lineOf(entry));
        this.emit();
      },
    };
  }

  /** The player's turn in a scene: a #command, or what they say and do. */
  async input(raw: string): Promise<void> {
    const text = raw.trim();
    const core = this.core;
    if (!text || !core || this.busy) return;
    if (text.startsWith("#") || text.startsWith("/")) { await this.command(text.slice(1)); return; }
    this.busy = GM_BUSY[this.busyTurn++ % GM_BUSY.length]!;
    this.status = undefined;
    this.emit();
    const before = core.session.sceneId;
    try {
      await core.say(text, this.hooks());
      // A spell attack can leave the rules campaign unloadable (see rules-repair.ts).
      if (repairCampaign(core.session)) core.save();
      afterTurn(core.session);
    } catch (error) {
      // A turn that fails part-way leaves things half-changed: go back to the last save.
      this.core = Core.load(core.state.id, this.explorer, this.fights);
      this.showSceneSoFar();
      this.lines.push({ kind: "error", speaker: "system", text: `The GM lost the thread (${message(error)}). Your last turn didn't happen; try it again.` });
    }
    this.busy = undefined;
    this.live = undefined;
    await this.settle(before);
  }

  private async command(command: string): Promise<void> {
    const [verb = "", ...rest] = command.trim().split(/\s+/);
    const core = this.core!;
    const session = core.session;
    switch (verb.toLowerCase()) {
      case "sheet": case "c": await this.showSheet(); return;
      case "map": this.overlay = { kind: "scene-map" }; break;
      case "help": case "?": this.overlay = { kind: "help" }; break;
      case "journal": case "notebook": case "j": this.overlay = { kind: "journal" }; break;
      case "save": core.save(); this.saveExtras(); this.status = "Saved."; break;
      case "quit": this.quitToTitle(); return;
      case "exits": {
        const scene = sceneById(session.sceneId);
        this.lines.push({ kind: "system", speaker: "system", text: `Exits (for testing, #end <id>): ${scene.exits.filter(e => !session.fought?.includes(e.id)).map(e => `${e.id} (${e.title})`).join(", ")}` });
        break;
      }
      case "end": {
        // For testing: end the scene through an exit now, as if play had reached it.
        const exit = sceneById(session.sceneId).exits.find(e => e.id === rest[0]);
        if (!exit) { await this.command("exits"); this.status = rest[0] ? `No exit "${rest[0]}" here.` : "Which ending? #end <id>"; this.emit(); return; }
        const before = session.sceneId;
        forceEnding(session, exit.id);
        // A scene that ends in play is snapshotted as it ends; the notebook reads its ending from there.
        snapshotSession(session);
        await this.afterSceneNow(before);
        return;
      }
      default: this.status = `Unknown command #${verb}. Try #sheet, #map, #journal, #help, #save or #quit.`;
    }
    this.emit();
  }

  /** The scene has ended outside a turn (#end, or a resume mid-way): the core takes the story on. */
  private async afterSceneNow(before = this.session!.sceneId): Promise<void> {
    const core = this.core!;
    this.busy = "The story moves on…";
    this.emit();
    try {
      await coreAfterScene(core, this.hooks());
      core.save();
    } catch (error) {
      this.lines.push({ kind: "error", speaker: "system", text: `The story couldn't move on cleanly: ${message(error)}` });
    }
    this.busy = undefined;
    this.live = undefined;
    await this.settle(before);
  }

  /** After the core has moved: the notebook catches up, and the screen follows the mode. */
  private async settle(before: string): Promise<void> {
    const core = this.core!;
    const session = core.session;
    for (const h of session.history) {
      const scene = sceneById(h.sceneId);
      if (scene.interlude || this.journal.some(j => j.sceneId === h.sceneId)) continue;
      this.note({ sceneId: h.sceneId, title: scene.title, ending: scene.exits.find(e => e.id === h.exitId)?.title ?? h.exitId, lines: notebookLines(session, h.sceneId) });
    }
    const mode = core.state.mode;
    if (mode === "end") { this.toEnd(); this.emit(); return; }
    if (mode === "combat" && this.screen !== "combat") {
      const exit = sceneById(session.sceneId).exits.find(e => e.id === session.ended?.exitId);
      this.card = { title: "Roll for initiative!", lines: [...(exit ? [exit.outcome, ""] : []), "Press Enter to fight."], next: "combat" };
      this.screen = "between";
    } else if (mode === "explore" && this.screen !== "explore") {
      const next = sceneById(session.sceneId);
      const where = maps.sceneLocation(next.id);
      const notebook = this.journal.find(j => j.sceneId === before)?.lines ?? [];
      this.card = {
        title: TIME_WORDS[core.state.story.time],
        lines: [
          ...(notebook.length ? ["Your notebook:", ...notebook, ""] : []),
          ...(session.lead ? [session.lead, ""] : []),
          `The lead: ${next.title}.${where ? ` Where: ${where.name}.` : ""}`,
          "",
          "Press Enter to walk there.",
        ],
        next: "explore",
      };
      this.messages = [...this.messages, `${TIME_WORDS[core.state.story.time]}. The lead: ${next.title}.`].slice(-20);
      this.screen = "between";
    } else if (mode === "scene" && (this.screen !== "scene" || this.shown !== session.sceneId)) {
      // A summons opened the next scene straight away (the King's morning).
      this.showSceneSoFar();
      this.screen = "scene";
    }
    this.saveExtras();
    this.emit();
  }

  private note(entry: JournalEntry): void {
    const i = this.journal.findIndex(j => j.sceneId === entry.sceneId);
    if (i >= 0) this.journal[i] = { ...entry, lines: [...new Set([...this.journal[i]!.lines, ...entry.lines])] };
    else this.journal.push(entry);
  }

  continueFromCard(): void {
    const card = this.card;
    if (!card || card.working) return;
    this.card = undefined;
    this.screen = card.next === "combat" ? "combat" : card.next === "end" ? "end" : card.next === "scene" ? "scene" : "explore";
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Combat

  async combatAct(action: CombatAction): Promise<void> {
    const fight = this.fights.current;
    const c = fight?.controller;
    if (!fight || !c || this.busy || c.result() || c.view().current !== "player") return;
    this.busy = action.kind === "move" ? undefined : "…";
    this.emit();
    try {
      await fight.act(fightActionId(action));
      this.core?.save();
    } catch (error) {
      this.status = `That didn't work: ${message(error)}`;
    }
    this.busy = undefined;
    this.emit();
  }

  async castAtTarget(spell: string, target?: string): Promise<void> {
    await this.combatAct({ kind: "cast", spell, ...(target ?? this.targetId ? { target: target ?? this.targetId! } : {}) });
  }

  /** The fight is over (Enter): the scene picks up from its outcome, as the core has it. */
  async afterCombat(): Promise<void> {
    const core = this.core;
    const result = this.fights.current?.result();
    if (!core || !result || this.busy) return;
    const session = core.session;
    const said = { victory: "We won the fight.", surrender: "We won: they gave up.", defeat: "We lost the fight, and I woke up on the floor.", fled: "They ran for it." }[result.outcome];
    const enemies = new Set((this.fights.current?.setup.combatants ?? []).filter(c => c.side === "enemy").map(c => c.id));
    const fell = result.casualties.filter(c => enemies.has(c.id) && c.state !== "standing").map(c => `${c.name} ${c.state === "down" ? "went down" : c.state}`);
    this.note({ sceneId: session.sceneId, title: sceneById(session.sceneId).title, ending: "A fight", lines: [`${said}${fell.length ? ` ${capital(fell.join("; "))}.` : ""}`] });
    const before = session.sceneId;
    this.screen = "between";
    this.card = { title: "After the fight", lines: [], working: "The dust settles…" };
    this.emit();
    try {
      await core.act("continue", this.hooks());
    } catch (error) {
      this.card = undefined;
      this.screen = "scene";
      this.showSceneSoFar();
      this.lines.push({ kind: "error", speaker: "system", text: `The GM couldn't tell the aftermath: ${message(error)}. (Say what you do next; #end <exit> skips ahead for testing.)` });
      this.emit();
      return;
    }
    this.card = undefined;
    this.screen = "scene";
    this.showSceneSoFar();
    await this.settle(before);
  }

  // -------------------------------------------------------------------------------------------
  // The End, overlays, saving

  private toEnd(): void {
    const session = this.session!;
    this.ending = epilogue(session);
    this.card = undefined;
    this.screen = "end";
    this.saveExtras();
  }

  async showSheet(): Promise<void> {
    if (!this.session) return;
    this.overlay = { kind: "sheet", text: await sheetText(this.session).catch(error => `The sheet couldn't be read: ${message(error)}`) };
    this.emit();
  }

  closeOverlay(): void {
    this.overlay = undefined;
    this.emit();
  }

  saveExtras(): void {
    if (!this.core) return;
    try { saveExtras({ sessionId: this.core.state.id, messages: this.messages.slice(-12), journal: this.journal }); } catch { /* best effort */ }
  }

  toTitle(): void {
    this.screen = "title";
    this.overlay = undefined;
    this.card = undefined;
    this.core = undefined;
    this.lines = [];
    this.loadSaves();
  }

  quitToTitle(): void {
    this.saveAll();
    this.toTitle();
  }

  quit(): void {
    this.saveAll();
    this.quitting = true;
    this.emit();
  }

  private saveAll(): void {
    if (!this.core || this.screen === "title") return;
    try { this.core.save(); } catch { /* the runtime saved the session after the last turn */ }
    this.saveExtras();
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
