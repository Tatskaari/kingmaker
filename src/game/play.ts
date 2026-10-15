import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sceneById } from "../../scenes/index.ts";
import { FAREWELL } from "../../scenes/talk.ts";
import { chainScene, closeHubScene, createSession, forceEnding, journalOf, openHubScene, openScene, playerTurn, resumeAfterFight, type TurnHooks } from "../runtime/engine.ts";
import { afterTurn } from "../runtime/background.ts";
import { endTalk, leaveTalk, openTalk, startTalk, talkTurn } from "../runtime/talk.ts";
import { comeTo } from "../rules/dnd.ts";
import { loadSession, saveSession, sessionDir, snapshotSession, type Entry, type SessionState } from "../runtime/session.ts";
import type { Mechanic } from "../runtime/director.ts";
import { nameAsKnown } from "../runtime/knowledge.ts";
import { markupLines } from "../runtime/markup.ts";
import type { Scene } from "../runtime/scene.ts";
import type { CombatResult, CombatSetup, StoryState, Tile2 } from "./types.ts";
import type { Build } from "../rules/dnd.ts";
import type { LeadTarget, TileActions } from "./town.ts";

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
  /** What it does; for "say", the line itself. */
  label: string;
  /**
   * "say": a line the player can say in a scene (a talk's dialogue choices): its label is the line,
   * and choosing it is the same as saying it.
   */
  kind: "move" | "talk" | "enter" | "travel" | "examine" | "use" | "fight" | "wait" | "say";
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
  /**
   * The fight in progress started on the map, with no scene's ending to ask for it (the people about
   * came at the player, or a hub's ring bell was rung): when it's over, it's back to the map.
   */
  fightOnMap?: boolean;
  /** What just happened, for the next observation. */
  recent: string[];
  /** A hub's game rather than the story's ("zoo": src/game/zoo): kept apart from the story's saves. */
  hub?: string;
  /** A hub's own hour, kept while one of its scenes plays at the scene's: it comes back when the scene's over. */
  hubTime?: StoryState["time"];
}

/** What an explore action came to: what the player sees, and what it opens. */
export interface ExploreDone {
  text: string;
  /** It opens the story's lead scene. */
  scene?: boolean;
  /** A hub's scene opens: this one (any of its scenes, not only a lead), played afresh. */
  open?: string;
  /** It stops the player for a word with someone walking with them (who, and where and when, as the map has it). */
  talk?: { with: string; where: string };
  /** The player's first turn in the scene or talk it opens: what they do, and what the rules resolve (the action menu's act). */
  act?: { text: string; mechanic: Mechanic };
  /**
   * A fight breaks out on the map: set out as it stands (the people about came at the player: the
   * fights factory's startWith), or `true` for the explorer's own fights to say which (a hub's ring).
   */
  fight?: CombatSetup | true;
}

export interface Explorer {
  /** Where a new game starts (with the game's new session: a hub fits the player out from it). */
  start(game: GameState, session?: SessionState): void;
  observe(game: GameState, session: SessionState): string;
  actions(game: GameState, session: SessionState): Action[];
  /** Do it (see ExploreDone). The rules' acts (the action menu's) and a hub's actions take a moment: a promise. */
  act(game: GameState, session: SessionState, id: string): ExploreDone | Promise<ExploreDone>;
  /** A scene is opening (walked into, or a summons that came to the player): go into its place. */
  enterScene?(game: GameState, session: SessionState): void;
  /**
   * A scene has ended, before the story moves on: its world is still there (who went where, what
   * burned), and chainScene is about to drop it.
   */
  leaveScene?(game: GameState, session: SessionState): void;
  /** The story has moved on (the next lead, the time of day, or the end): bring the explorer up to date. */
  afterScene?(game: GameState, session: SessionState): void;
  /**
   * A hub (the zoo, src/game/zoo) rather than the story's town: it opens any of its scenes (`open`),
   * each scene ends back on its map with nothing chained on, and fights can start from the map.
   */
  hub?: boolean;
  /**
   * A fight from the map is over (`fightOnMap`): put the player back on the map, keep what it did to
   * the people there, and say how it went (the result's summary is the player's own: "you"). When it
   * says nothing, the core says "The fight: …".
   */
  afterFight?(game: GameState, session: SessionState, result: CombatResult): string | undefined;
  // For a screen that draws the map (the app), where the explorer has its own answers (the zoo's
  // levers, its next exhibit); the town's are src/game/town.ts's actionsAt, interactLabel, leadTarget.
  /** What a tile offers (the right-click menu, the pointer's hint). */
  actionsAt?(game: GameState, session: SessionState | undefined, at: Tile2): TileActions;
  /** What interact (e) would do now, in words. */
  interactLabel?(game: GameState, session?: SessionState): { label: string; scene: boolean } | undefined;
  /** Where g walks to, and what it's called: the story's lead, or a hub's own. */
  lead?(game: GameState): LeadTarget | undefined;
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
  /** A fight that broke out on the map, set out as it stands (who, where). */
  startWith?(setup: CombatSetup, session: SessionState): Promise<Fight>;
}

/** Where the story starts (a new game opens on its lead). */
export const FIRST_SCENE = "hanged-clerk";
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

  static async create(options: { player: string; level?: number; id?: string; seed?: number; firstScene?: string; build?: Partial<Build>; explorer: Explorer; fights: FightFactory; hub?: string }): Promise<Game> {
    const firstScene = options.firstScene ?? FIRST_SCENE;
    const session = await createSession({ sceneId: firstScene, approach: "v2", player: options.player, level: options.level ?? 3, ...(options.id ? { id: options.id } : {}), ...(options.seed !== undefined ? { seed: options.seed } : {}), ...(options.build ? { build: options.build } : {}) });
    const first = sceneById(firstScene);
    const state: GameState = { version: 1, id: session.id, mode: "explore", story: { time: first.time ?? "morning", played: [], lead: firstScene, flags: {} }, explore: {}, recent: [], ...(options.hub ? { hub: options.hub } : {}) };
    const game = new Game(state, session, options.explorer, options.fights);
    // A hub's explorer sets out its own start (its story, its first words): it has no lead to give the hook of.
    if (!options.explorer.hub) state.recent.push(`${first.hook}`);
    options.explorer.start(state, session);
    game.save();
    return game;
  }

  static exists(id: string): boolean { return existsSync(gameFile(id)); }

  /** Whose game a save is: the story's (undefined), or a hub's ("zoo"), to load it with the right explorer. */
  static hubOf(id: string): string | undefined {
    try { return (JSON.parse(readFileSync(gameFile(id), "utf8")) as GameState).hub; } catch { return undefined; }
  }

  /** The fight in progress, for a UI that draws it (the QA console reads it through observe()). */
  get currentFight(): Fight | undefined { return this.fight; }

  static load(id: string, explorer: Explorer, fights: FightFactory): Game {
    const session = loadSession(id);
    const state = JSON.parse(readFileSync(gameFile(id), "utf8")) as GameState & { fromMap?: boolean };
    // The zoo's own builds called a fight from the map fromMap: one saved mid-fight still ends back on the map.
    if (state.fromMap) { state.fightOnMap = true; delete state.fromMap; }
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
        const talk = this.session.talk;
        return {
          mode: "scene", text: `${recent}[${scene.title}, ${this.state.story.time.replace("-", " ")}]\n\n${sceneView(this.session)}`, actions: this.choices(),
          hint: talk ? `You're talking with ${scene.cast.find(c => c.id === talk.with)?.name ?? talk.with}: say anything, or choose a line.` : "You're in a scene: say what your character says or does.",
        };
      }
      case "combat": {
        const over = this.fight?.result();
        return { mode: "combat", text: `${recent}${this.fight?.observe() ?? ""}${over ? `\n\nHow it went: ${over.summary}` : ""}`,
          actions: over ? [{ id: "continue", label: this.state.fightOnMap ? "Back to the map" : "See what comes of it (the scene picks up from the fight)", kind: "fight" }] : this.fight?.actions() ?? [] };
      }
      case "end":
        return { mode: "end", text: `${recent}The End.`, actions: [] };
    }
  }

  /** An explore or combat action, or a talk's dialogue choice, by id. */
  async act(id: string, hooks: TurnHooks = {}): Promise<string> {
    this.state.recent = [];
    if (this.state.mode === "explore") {
      // Walking and talking are done at once (a scene that opens shows straight away); the rules' acts
      // (the action menu's) and a hub's actions take a moment, and a scene they open is said as it
      // opens (TurnHooks.onScene), for the app to show it as it streams.
      const acted = this.explorer.act(this.state, this.session, id);
      const done = acted instanceof Promise ? await acted : acted;
      let text = done.text;
      if (done.fight && (done.fight === true || this.fights.startWith)) text = `${text}\n\n${await this.beginFight(done.fight)}`;
      else if (done.open || done.scene || done.talk) {
        text = `${text}\n\n${done.talk ? await this.beginTalk(done.talk, hooks) : await this.beginScene(hooks, done.open)}`;
        // The act that opened it is the player's first turn there: the scene's rules resolve it.
        if (done.act && (this.state.mode as Mode) === "scene") text = `${text}\n\n${await this.say(done.act.text, hooks, { mechanic: done.act.mechanic })}`;
      }
      this.save();
      return text;
    }
    if (this.state.mode === "scene") {
      // A dialogue choice is the same as saying its line; walking on ends the talk without a word.
      const choice = this.choices().find(a => a.id === id);
      if (choice?.kind === "say") return this.say(choice.label, hooks);
      if (choice) {
        const text = this.afterTalk(true);
        this.save();
        return text;
      }
      const talk = this.session.talk;
      throw new Error(talk ? `You're in a talk: say something, or choose one of ${this.choices().map(a => a.id).join(", ")}.` : "You're in a scene: say something instead.");
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
    throw new Error("The story is over.");
  }

  /**
   * Something the player says or does in a scene (or in a talk). `mechanic`: what the rules resolve
   * this turn, already chosen (the action menu's act), rather than read from the words.
   */
  async say(text: string, hooks: TurnHooks = {}, options: { mechanic?: Mechanic } = {}): Promise<string> {
    if (this.state.mode !== "scene") throw new Error("You're not in a scene: pick an action instead.");
    this.state.recent = [];
    const talk = this.session.talk;
    const turn = talk ? await talkTurn(this.session, text, hooks, options) : await playerTurn(this.session, text, hooks, options);
    // The co-GM and the memory reviews run in the background, as in the scene CLI.
    afterTurn(this.session);
    const shown = render(this.session, turn.entries.filter(e => e.kind !== "player"));
    const over = turn.ended || this.session.ended;
    const after = over ? `\n\n${talk ? this.afterTalk() : await this.afterScene(hooks)}` : "";
    this.save();
    return `${shown}${after}`;
  }

  /** For QA and testing: end the current scene through one of its exits now, and go on as the story would. */
  async endScene(exitId: string, hooks: TurnHooks = {}): Promise<string> {
    if (this.state.mode !== "scene") throw new Error("Not in a scene.");
    forceEnding(this.session, exitId);
    // As a scene that ends in play is: its last snapshot is the one with its ending (the notebook reads it).
    snapshotSession(this.session);
    const text = this.session.talk ? this.afterTalk() : await this.afterScene(hooks);
    this.save();
    return text;
  }

  /**
   * A scene that has ended but whose story hasn't moved on yet (a game quit in between, or a turn
   * that failed after the ending): carry on from there. Nothing to do otherwise.
   */
  async carryOn(hooks: TurnHooks = {}): Promise<string> {
    if (this.state.mode !== "scene" || !this.session.ended) return "";
    const text = this.session.talk ? this.afterTalk() : await this.afterScene(hooks);
    this.save();
    return text;
  }

  /**
   * In a talk, its dialogue choices: the suggested lines (choosing one is the same as saying it),
   * a goodbye, and walking on. Nothing otherwise.
   */
  private choices(): Action[] {
    const talk = this.session.talk;
    if (!talk || this.session.ended) return [];
    return [
      ...talk.suggestions.map((line, i): Action => ({ id: `say_${i + 1}`, label: line, kind: "say" })),
      { id: "say_goodbye", label: FAREWELL, kind: "say" },
      { id: "walk_on", label: "Walk on without a word (back to the map)", kind: "move" },
    ];
  }

  /** A word with someone walking with the player: the story's scene waits until it's over. */
  private async beginTalk(talk: { with: string; where: string }, hooks: TurnHooks): Promise<string> {
    // The talk is the scene from now (the app shows it at once, as the greeting streams in).
    startTalk(this.session, talk.with, talk.where);
    this.state.mode = "scene";
    hooks.onScene?.();
    const entries = await openTalk(this.session, hooks);
    return `— ${sceneById(this.session.sceneId).title} —\n\n${render(this.session, entries)}`;
  }

  /** The talk is over (said, or `walking` on without a word): back to the map where the player was. */
  private afterTalk(walking = false): string {
    const text = walking ? leaveTalk(this.session) : endTalk(this.session);
    this.state.mode = "explore";
    return text;
  }

  /** The lead scene opens (or, for a hub, `open`: the session plays that one afresh). */
  private async beginScene(hooks: TurnHooks, open?: string): Promise<string> {
    if (open) openHubScene(this.session, open);
    const scene = sceneById(this.session.sceneId);
    this.state.mode = "scene";
    // A hub's clock is its own (the zoo's clock): the scene plays at its hour, and the hub's comes back after.
    if (this.explorer.hub) this.state.hubTime ??= this.state.story.time;
    this.state.story.time = scene.time ?? this.state.story.time;
    this.explorer.enterScene?.(this.state, this.session);
    hooks.onScene?.();
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
    if (this.explorer.hub) return this.backToHub(scene);
    return this.onward("", hooks);
  }

  /**
   * A hub's scene is over: back on its map, as it was before the scene but for what the scene did to
   * its place. Nothing chains on and the story is untouched; the scene can be played again.
   */
  private backToHub(scene: Scene): string {
    // Its ending goes on the session's record (the notebook reads it), with nothing handed on.
    const exitId = this.session.ended?.exitId;
    const journal = journalOf(this.session);
    if (exitId) this.session.history.push({ sceneId: scene.id, exitId, summary: "", ...(journal.length ? { journal } : {}) });
    closeHubScene(this.session);
    this.state.mode = "explore";
    if (this.state.hubTime) { this.state.story.time = this.state.hubTime; delete this.state.hubTime; }
    this.explorer.afterScene?.(this.state, this.session);
    return `(${scene.title} is over: back on the map.)`;
  }

  /**
   * A fight on the map that no scene's ending asked for: set out as it stands (the town's people came
   * at the player), or by the explorer's own fights (`true`: a hub's ring, which its factory reads off
   * the game). Either way it ends back on the map.
   */
  private async beginFight(setup: CombatSetup | true): Promise<string> {
    // Set first: a factory asks whether a fight is from the map.
    this.state.mode = "combat";
    this.state.fightOnMap = true;
    try {
      this.fight = setup === true ? await this.fights.start(this.state, this.session) : await this.fights.startWith!(setup, this.session);
    } catch (error) {
      // No fight to be had: it's still the map.
      this.state.mode = "explore";
      delete this.state.fightOnMap;
      return `(The fight couldn't be set out: ${error instanceof Error ? error.message : String(error)}.)`;
    }
    return "Roll for initiative!";
  }

  /** The fight is over: back to the scene for its aftermath (take the ledger, question the villain), which ends as the story decides. */
  private async afterFight(result: CombatResult, hooks: TurnHooks = {}): Promise<string> {
    delete this.state.combat;
    this.fight = undefined;
    // A fight from the map goes back to the map: the explorer puts the player back, keeps what the
    // fight did to the people there (who went down lies where they fell), and says how it went; the
    // player comes round if they were knocked out.
    if (this.state.fightOnMap) {
      delete this.state.fightOnMap;
      this.state.mode = "explore";
      const woke = await comeTo(this.session).catch(() => undefined);
      // The story's hand-off says "the player"; the news on the map says "you".
      const told = { ...result, summary: result.summary.replace(/\bThe player was\b/g, "You were").replace(/\bThe player\b/g, "You").replace(/\bthe player\b/g, "you") };
      return [this.explorer.afterFight?.(this.state, this.session, told) ?? `The fight: ${told.summary}`, woke].filter(Boolean).join("\n\n");
    }
    this.state.mode = "scene";
    // A fight's flags are the story's (who's arrested, the Heron burned); a hub has no story to tell them to.
    if (!this.explorer.hub) for (const [k, v] of Object.entries(result.flags ?? {})) this.state.story.flags[k] = v;
    // Knocked out in the fight, the player comes round as the scene picks up (the aftermath tells it
    // that way), rather than acting on 0 hit points until the next scene brings them round.
    const woke = await comeTo(this.session).catch(() => undefined);
    const came: Entry[] = [];
    if (woke) {
      const entry: Entry = { turn: this.session.turn, scene: this.session.sceneId, speaker: "dice", kind: "roll", text: woke };
      this.session.transcript.push(entry);
      hooks.onEntry?.(entry);
      came.push(entry);
    }
    const entries = await resumeAfterFight(this.session, result.summary, hooks);
    return render(this.session, [...came, ...entries]);
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

/**
 * Entries as text (the QA console's view of a scene, and what a turn says): a GM reply's markup
 * under it, who says what and each marked phrase's note, as the screen would show them.
 */
export function render(session: SessionState, entries: Entry[]): string {
  const scene = sceneById(session.sceneId);
  const name = (id: string) => nameAsKnown(scene, session, id);
  return entries.map(e => e.kind === "player" ? `> ${e.text}` : e.kind === "roll" ? `🎲 ${e.text}` : e.kind === "system" ? `— ${e.text} —`
    : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}`
    : e.marked ? [e.text, ...markupLines(e.text, e.marked, name)].join("\n") : e.text).join("\n\n");
}
