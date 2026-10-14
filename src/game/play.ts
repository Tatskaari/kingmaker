import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sceneById } from "../../scenes/index.ts";
import { chainScene, createSession, forceEnding, openScene, playerTurn, resumeAfterFight, type TurnHooks } from "../runtime/engine.ts";
import { afterTurn } from "../runtime/background.ts";
import { loadSession, saveSession, sessionDir, snapshotSession, type Entry, type SessionState } from "../runtime/session.ts";
import type { CombatResult, StoryState } from "./types.ts";

/**
 * The playable game, without a UI: exploring the town between scenes, playing a scene, fighting,
 * and the story flow that links them (docs/design/playable.md). The OpenTUI app and the headless QA
 * API are both views over this: they observe, act on an action id, or say something in a scene.
 * Exploration and combat are pluggable (an iso map or a text stand-in; tactical combat or a
 * stand-in), behind Explorer and Fight.
 */

export type Mode = "explore" | "scene" | "combat" | "end";

export interface Action {
  /** Stable, readable id the QA agent passes back: "talk_kell", "go_river_stairs", "attack_crake_1". */
  id: string;
  label: string;
  kind: "move" | "talk" | "enter" | "travel" | "examine" | "use" | "fight" | "wait";
}

export interface Observation { mode: Mode; text: string; actions: Action[]; hint?: string }

/** What the game keeps between commands (beside the scene runtime's own session). */
export interface GameState {
  version: 1;
  id: string;
  mode: Mode;
  story: StoryState;
  /** The explorer's own state: where the player is. */
  explore: Record<string, unknown>;
  /** The fight in progress, as its module saves it. */
  combat?: unknown;
  /** What just happened, for the next observation. */
  recent: string[];
}

export interface Explorer {
  /** Where a new game starts. */
  start(game: GameState): void;
  observe(game: GameState, session: SessionState): string;
  actions(game: GameState, session: SessionState): Action[];
  /** Do it; `scene: true` when it opens the story's lead scene. */
  act(game: GameState, session: SessionState, id: string): { text: string; scene?: boolean };
  /** A scene is opening (walked into, or a summons that came to the player): go into its place. */
  enterScene?(game: GameState, session: SessionState): void;
  /**
   * A scene has ended, before the story moves on: its world is still there (who went where, what
   * burned), and chainScene is about to drop it.
   */
  leaveScene?(game: GameState, session: SessionState): void;
  /** The story has moved on (the next lead, the time of day, or the end): bring the explorer up to date. */
  afterScene?(game: GameState, session: SessionState): void;
}

export interface Fight {
  observe(): string;
  actions(): Action[];
  act(id: string): Promise<string>;
  result(): CombatResult | undefined;
  save(): unknown;
}

export interface FightFactory {
  start(game: GameState, session: SessionState): Promise<Fight>;
  load(saved: unknown, session: SessionState): Fight;
}

const FIRST_SCENE = "hanged-clerk";
const gameFile = (id: string) => join(sessionDir(id), "game.json");

export class Game {
  state: GameState;
  session: SessionState;
  private explorer: Explorer;
  private fights: FightFactory;
  private fight: Fight | undefined;

  private constructor(state: GameState, session: SessionState, explorer: Explorer, fights: FightFactory, fight?: Fight) {
    this.state = state;
    this.session = session;
    this.explorer = explorer;
    this.fights = fights;
    this.fight = fight;
  }

  static async create(options: { player: string; level?: number; id?: string; seed?: number; firstScene?: string; explorer: Explorer; fights: FightFactory }): Promise<Game> {
    const firstScene = options.firstScene ?? FIRST_SCENE;
    const session = await createSession({ sceneId: firstScene, approach: "v2", player: options.player, level: options.level ?? 3, ...(options.id ? { id: options.id } : {}), ...(options.seed !== undefined ? { seed: options.seed } : {}) });
    const first = sceneById(firstScene);
    const state: GameState = { version: 1, id: session.id, mode: "explore", story: { time: first.time ?? "morning", played: [], lead: firstScene, flags: {} }, explore: {}, recent: [] };
    const game = new Game(state, session, options.explorer, options.fights);
    options.explorer.start(state);
    state.recent.push(`${first.hook}`);
    game.save();
    return game;
  }

  static exists(id: string): boolean { return existsSync(gameFile(id)); }

  /** The fight in progress, for a UI that draws it (the QA console reads it through observe()). */
  get currentFight(): Fight | undefined { return this.fight; }

  static load(id: string, explorer: Explorer, fights: FightFactory): Game {
    const session = loadSession(id);
    const state = JSON.parse(readFileSync(gameFile(id), "utf8")) as GameState;
    const fight = state.mode === "combat" && state.combat !== undefined ? fights.load(state.combat, session) : undefined;
    return new Game(state, session, explorer, fights, fight);
  }

  save(): void {
    if (this.fight) this.state.combat = this.fight.save();
    saveSession(this.session);
    writeFileSync(gameFile(this.state.id), JSON.stringify(this.state, null, 1));
  }

  observe(): Observation {
    const recent = this.state.recent.length ? `${this.state.recent.join("\n\n")}\n\n` : "";
    switch (this.state.mode) {
      case "explore":
        return { mode: "explore", text: `${recent}${this.explorer.observe(this.state, this.session)}${carrying(this.session)}`, actions: this.explorer.actions(this.state, this.session) };
      case "scene": {
        const scene = sceneById(this.session.sceneId);
        return { mode: "scene", text: `${recent}[${scene.title}, ${this.state.story.time.replace("-", " ")}]\n\n${sceneView(this.session)}`, actions: [], hint: "You're in a scene: say what your character says or does." };
      }
      case "combat": {
        const over = this.fight?.result();
        return { mode: "combat", text: `${recent}${this.fight?.observe() ?? ""}${over ? `\n\nHow it went: ${over.summary}` : ""}`,
          actions: over ? [{ id: "continue", label: "See what comes of it (the scene picks up from the fight)", kind: "fight" }] : this.fight?.actions() ?? [] };
      }
      case "end":
        return { mode: "end", text: `${recent}The End.`, actions: [] };
    }
  }

  /** An explore or combat action, by id. */
  async act(id: string, hooks: TurnHooks = {}): Promise<string> {
    this.state.recent = [];
    if (this.state.mode === "explore") {
      const done = this.explorer.act(this.state, this.session, id);
      const text = done.scene ? `${done.text}\n\n${await this.beginScene(hooks)}` : done.text;
      this.save();
      return text;
    }
    if (this.state.mode === "combat" && this.fight) {
      // The fight is over and the player has seen how: the scene picks up from it.
      const over = this.fight.result();
      if (over) {
        if (id !== "continue") throw new Error(`The fight is over: "continue" to see what comes of it.`);
        const text = await this.afterFight(over, hooks);
        this.save();
        return text;
      }
      const text = await this.fight.act(id);
      const result = this.fight.result();
      this.save();
      return result ? `${text}\n\nThe fight is over: ${result.summary}` : text;
    }
    throw new Error(this.state.mode === "scene" ? "You're in a scene: say something instead." : "The story is over.");
  }

  /** Something the player says or does in a scene. */
  async say(text: string, hooks: TurnHooks = {}): Promise<string> {
    if (this.state.mode !== "scene") throw new Error("You're not in a scene: pick an action instead.");
    this.state.recent = [];
    const turn = await playerTurn(this.session, text, hooks);
    // The co-GM and the memory reviews run in the background, as in the scene CLI.
    afterTurn(this.session);
    const shown = render(this.session, turn.entries.filter(e => e.kind !== "player"));
    const after = turn.ended || this.session.ended ? `\n\n${await this.afterScene(hooks)}` : "";
    this.save();
    return `${shown}${after}`;
  }

  /** For QA and testing: end the current scene through one of its exits now, and go on as the story would. */
  async endScene(exitId: string, hooks: TurnHooks = {}): Promise<string> {
    if (this.state.mode !== "scene") throw new Error("Not in a scene.");
    forceEnding(this.session, exitId);
    // As a scene that ends in play is: its last snapshot is the one with its ending (the notebook reads it).
    snapshotSession(this.session);
    const text = await this.afterScene(hooks);
    this.save();
    return text;
  }

  /**
   * A scene that has ended but whose story hasn't moved on yet (a game quit in between, or a turn
   * that failed after the ending): carry on from there. Nothing to do otherwise.
   */
  async carryOn(hooks: TurnHooks = {}): Promise<string> {
    if (this.state.mode !== "scene" || !this.session.ended) return "";
    const text = await this.afterScene(hooks);
    this.save();
    return text;
  }

  private async beginScene(hooks: TurnHooks): Promise<string> {
    const scene = sceneById(this.session.sceneId);
    this.state.mode = "scene";
    this.state.story.time = scene.time ?? this.state.story.time;
    this.explorer.enterScene?.(this.state, this.session);
    const entries = await openScene(this.session, hooks);
    return `— ${scene.title} —\n\n${render(this.session, entries)}`;
  }

  /** A scene ended: fight, or on to the next scene (walk there, or straight in if it summons you), or the end. */
  private async afterScene(hooks: TurnHooks): Promise<string> {
    const scene = sceneById(this.session.sceneId);
    const exit = scene.exits.find(e => e.id === this.session.ended?.exitId);
    // A fight is part of its scene: the scene picks up again afterwards, in the same place.
    if (exit?.kind === "combat") {
      this.state.mode = "combat";
      this.fight = await this.fights.start(this.state, this.session);
      // The fight itself is the next observation (the board, the initiative, whose turn).
      return "Roll for initiative!";
    }
    if (!this.state.story.played.includes(scene.id)) this.state.story.played.push(scene.id);
    // The explorer keeps what the scene did to its place before chainScene drops the world.
    this.explorer.leaveScene?.(this.state, this.session);
    return this.onward("", hooks);
  }

  /** The fight is over: back to the scene for its aftermath (take the ledger, question the villain), which ends as the story decides. */
  private async afterFight(result: CombatResult, hooks: TurnHooks = {}): Promise<string> {
    delete this.state.combat;
    this.fight = undefined;
    this.state.mode = "scene";
    for (const [k, v] of Object.entries(result.flags ?? {})) this.state.story.flags[k] = v;
    const entries = await resumeAfterFight(this.session, result.summary, hooks);
    return render(this.session, entries);
  }

  private async onward(combatResult: string, hooks: TurnHooks): Promise<string> {
    const chained = await chainScene(this.session, combatResult || "the party won", { skipInterludes: true });
    if (!chained) {
      this.state.mode = "end";
      delete this.state.story.lead;
      this.explorer.afterScene?.(this.state, this.session);
      return "The End.";
    }
    const next = sceneById(this.session.sceneId);
    this.state.story.lead = next.id;
    this.state.story.time = next.time ?? this.state.story.time;
    // The time of day, the lead and who walks with the player move on with the story.
    this.explorer.afterScene?.(this.state, this.session);
    // A scene that comes to the player (a summons the next morning) opens straight away.
    if (next.time === "next-morning") return this.beginScene(hooks);
    this.state.mode = "explore";
    // The lead comes in the fiction (a word from Kell, a message), then where it points.
    return `${this.session.lead ?? ""}${this.session.lead ? "\n\n" : ""}(${next.title}: that's where the story goes next.)`;
  }
}

/** What the player has on them between scenes (their purse, their gear, what they picked up). */
function carrying(session: SessionState): string {
  const items = session.world ? Object.values(session.world.entities).filter(e => e.parent === "player" && !e.states.includes("gone")) : session.carried?.filter(e => e.parent === "player") ?? [];
  return items.length ? `\n\nYou carry: ${items.map(e => `${(e.quantity ?? 1) > 1 ? `${e.quantity} ` : ""}${e.name}`).join(", ")}.` : "";
}

/** The current scene so far, as the player sees it (the last few exchanges). */
function sceneView(session: SessionState): string {
  const entries = session.transcript.filter(e => (e.scene ?? session.sceneId) === session.sceneId);
  return render(session, entries.slice(-8));
}

export function render(session: SessionState, entries: Entry[]): string {
  const scene = sceneById(session.sceneId);
  return entries.map(e => e.kind === "player" ? `> ${e.text}` : e.kind === "roll" ? `🎲 ${e.text}` : e.kind === "system" ? `— ${e.text} —`
    : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.text).join("\n\n");
}
