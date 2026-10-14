import type { CombatSetup, Interaction, MapActor, StoryState } from "../game/types.ts";
import { sheetText } from "../rules/dnd.ts";
import { sceneEntries } from "../runtime/brief.ts";
import { forceEnding, type TurnHooks } from "../runtime/engine.ts";
import type { Exit } from "../runtime/scene.ts";
import { loadSession, saveSession, type Entry, type EntryKind, type SessionState } from "../runtime/session.ts";
import { sceneById } from "../../scenes/index.ts";
import { combat, maps, type CombatAction, type CombatController, type Dir, type Position } from "./adapters.ts";
import { repairCampaign } from "./rules-repair.ts";
import { resumable, saveApp, type JournalEntry, type Mode, type Resumable } from "./save.ts";
import { beginScene, combatSetup, endedExit, epilogue, isInterlude, moveOn, newGame, storyOf, takeTurn, TIME_WORDS, type Epilogue } from "./story.ts";

/**
 * The game as the terminal UI sees it: which screen is up, the session, where the player stands,
 * the scene transcript (with the GM's reply streaming in), the fight, and the cards between scenes.
 * It holds no React; screens subscribe and redraw when it changes.
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
  /** Still working (chaining the story on): show the spinner, ignore Enter. */
  working?: string;
  /** Where Enter goes from here. */
  next?: "explore" | "combat" | "end";
}

export type Overlay =
  | { kind: "sheet"; text: string }
  | { kind: "help" }
  | { kind: "journal" }
  | { kind: "scene-map" }
  | { kind: "menu"; index: number }
  | { kind: "spells"; spells: Array<{ id: string; name: string; level: number }>; index: number };

const GM_BUSY = ["The GM is thinking…", "The GM consults their notes…", "The GM rolls something behind the screen and won't say what…", "The GM is doing the voices…", "The GM looks up the rules, then decides against them…"];
const CHAIN_BUSY = ["The story moves on…", "Time passes in Caerwyn, as is its habit…", "The bells ring the hours…", "Somewhere, a clerk files a report…"];

export class Game {
  screen: Screen = "title";
  saves: Resumable[] = [];
  session?: SessionState;
  pos: Position = maps.start();
  /** Where the player stood when the open scene began (they're put back outside after it). */
  before?: Position;
  story: StoryState = { time: "morning", played: [], flags: {} };
  messages: string[] = [];
  journal: JournalEntry[] = [];
  lines: Line[] = [];
  live?: Line;
  busy?: string;
  status?: string;
  card?: Card;
  fight?: CombatController;
  setup?: CombatSetup;
  /** The player's chosen target in a fight (index into the fight's targets, and its id). */
  targetIndex = 0;
  targetId?: string;
  /** The mode last saved: what Continue resumes into. */
  mode: Mode = "explore";
  overlay?: Overlay;
  sheet?: string;
  creating?: { name: string; concept: string };
  ending?: Epilogue;
  error?: string;
  /** Set when the app should exit (main.tsx tears the renderer down). */
  quitting = false;

  private listeners = new Set<() => void>();
  private pending?: ReturnType<typeof setTimeout>;
  private busyTurn = 0;

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
      const session = await newGame(name, concept);
      this.session = session;
      this.sheet = await sheetText(session);
      this.story = storyOf(session);
      this.pos = maps.start();
      this.journal = [];
      this.messages = [`${TIME_WORDS[this.story.time]}. ${sceneById(session.sceneId).hook}`];
      this.screen = "created";
      this.save("explore");
    } catch (error) {
      this.error = `Character creation failed: ${message(error)}`;
      this.screen = "create";
    }
    this.emit();
  }

  async resume(r: Resumable): Promise<void> {
    const session = loadSession(r.session.id);
    if (repairCampaign(session)) saveSession(session);
    this.session = session;
    this.pos = r.save.pos;
    this.before = r.save.before;
    this.story = storyOf(session);
    this.messages = r.save.messages ?? [];
    this.journal = r.save.journal ?? [];
    this.overlay = undefined;
    this.mode = r.save.mode;
    if (r.save.mode === "combat" && r.save.combat) {
      this.messages.push("You pick yourself up where you left off: mid-brawl.");
      await this.beginCombat(r.save.combat);
      return;
    }
    // The scene ended but the story hadn't moved on yet (quit on the card, or mid-chain): carry on.
    if (session.ended && endedExit(session)) {
      this.screen = "scene";
      this.showSceneSoFar();
      this.emit();
      await this.sceneOver(endedExit(session)!);
      return;
    }
    if (r.save.mode === "scene") {
      this.screen = "scene";
      this.showSceneSoFar();
      this.emit();
      if (!sceneEntries(session).some(e => e.kind === "narration")) await this.openLead();
      return;
    }
    this.screen = "explore";
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Explore

  begin(): void {
    this.screen = "explore";
    this.save("explore");
    this.emit();
  }

  get actors(): MapActor[] {
    return maps.actors(this.pos.map, this.story);
  }

  get playerActor(): MapActor {
    return { id: "player", name: this.session?.player.name ?? "you", kind: "player", glyph: "@", map: this.pos.map, at: this.pos.at };
  }

  say(text: string): void {
    this.messages = [...this.messages, text].slice(-20);
  }

  walk(dir: Dir): void {
    const result = maps.step(this.pos, dir, this.actors, this.story);
    this.pos = result.pos;
    if (result.message) this.say(result.message);
    this.save("explore");
    this.emit();
    if (result.trigger) void this.trigger(result.trigger);
  }

  interact(): void {
    const target = maps.reachable(this.pos, this.actors)[0];
    // A lead the map has no place for (a scene the map module doesn't know): it opens from anywhere.
    if (!target?.interaction && this.story.lead && !maps.sceneLocation(this.story.lead)) {
      void this.openLead();
      return;
    }
    if (!target?.interaction) {
      const near = maps.nearby(this.pos, this.actors, 4).find(n => n.actor.interaction);
      this.say(near ? `Nothing within reach. (${capital(near.actor.name)} is ${near.distance} paces away.)` : "There's nothing here to interact with but the weather.");
      this.emit();
      return;
    }
    void this.trigger(target.interaction, target);
  }

  private async trigger(interaction: Interaction, actor?: MapActor): Promise<void> {
    if (interaction.kind === "examine") { this.say(interaction.text); this.emit(); return; }
    if (interaction.kind === "travel") { this.pos = { map: interaction.to.map, at: interaction.to.at, facing: this.pos.facing }; this.say(interaction.label); this.save("explore"); this.emit(); return; }
    if (interaction.sceneId !== this.story.lead) {
      this.say(`${actor ? capital(actor.name) : "That"} will keep. The trail leads elsewhere for now.`);
      this.emit();
      return;
    }
    await this.openLead();
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
    return { kind: "header", speaker: "system", name: scene.title, text: scene.hook };
  }

  private showSceneSoFar(): void {
    this.lines = [this.header(), ...sceneEntries(this.session!).map(e => this.lineOf(e))];
    this.live = undefined;
  }

  private hooks(): TurnHooks {
    return {
      // The turn stays busy until the runtime has finished with it (and saved it): the reply
      // streams first, then the after-reply decision and the stage manager run.
      onSpeaker: (speaker, kind) => {
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
        if (entry.kind === "narration" || entry.kind === "dialogue") {
          this.live = undefined;
          if (this.busy) this.busy = "The GM makes a note…";
        }
        this.lines.push(this.lineOf(entry));
        this.emit();
      },
    };
  }

  private gmBusy(): string {
    return GM_BUSY[this.busyTurn++ % GM_BUSY.length]!;
  }

  async openLead(): Promise<void> {
    const session = this.session!;
    this.before = this.pos;
    this.screen = "scene";
    this.lines = [this.header()];
    this.live = undefined;
    this.status = undefined;
    this.busy = "The GM sets the scene…";
    this.save("scene");
    this.emit();
    try {
      await beginScene(session, this.hooks());
    } catch (error) {
      this.lines.push({ kind: "error", speaker: "system", text: `The GM couldn't open the scene: ${message(error)}. (Type anything to try again; #end <exit> skips ahead for testing.)` });
    }
    this.busy = undefined;
    this.live = undefined;
    this.save("scene");
    this.emit();
  }

  /** The player's turn in a scene: a #command, or what they say and do. */
  async input(raw: string): Promise<void> {
    const text = raw.trim();
    const session = this.session;
    if (!text || !session || this.busy) return;
    if (text.startsWith("#") || text.startsWith("/")) { await this.command(text.slice(1)); return; }
    // The scene never opened (the GM was unreachable): try again.
    if (!sceneEntries(session).some(e => e.kind === "narration")) { await this.openLead(); return; }
    this.busy = this.gmBusy();
    this.status = undefined;
    this.emit();
    let ended: Exit | undefined;
    try {
      const result = await takeTurn(session, text, this.hooks());
      ended = result.ended;
    } catch (error) {
      // A turn that fails part-way leaves the session half-changed: go back to the last save.
      this.session = loadSession(session.id);
      this.showSceneSoFar();
      this.lines.push({ kind: "error", speaker: "system", text: `The GM lost the thread (${message(error)}). Your last turn didn't happen; try it again.` });
    }
    this.busy = undefined;
    this.live = undefined;
    this.save("scene");
    this.emit();
    if (ended) await this.sceneOver(ended);
  }

  private async command(command: string): Promise<void> {
    const [verb = "", ...rest] = command.trim().split(/\s+/);
    const session = this.session!;
    switch (verb.toLowerCase()) {
      case "sheet": case "c": await this.showSheet(); return;
      case "map": this.overlay = { kind: "scene-map" }; break;
      case "help": case "?": this.overlay = { kind: "help" }; break;
      case "journal": case "notebook": case "j": this.overlay = { kind: "journal" }; break;
      case "save": this.save("scene"); this.status = "Saved."; break;
      case "quit": this.save("scene"); this.toTitle(); return;
      case "exits": {
        const scene = sceneById(session.sceneId);
        this.lines.push({ kind: "system", speaker: "system", text: `Exits (for testing, #end <id>): ${scene.exits.map(e => `${e.id} (${e.title})`).join(", ")}` });
        break;
      }
      case "end": {
        // For testing: end the scene through an exit now, as if play had reached it.
        const exit = sceneById(session.sceneId).exits.find(e => e.id === rest[0]);
        if (!exit) { await this.command("exits"); this.status = rest[0] ? `No exit "${rest[0]}" here.` : "Which ending? #end <id>"; this.emit(); return; }
        forceEnding(session, exit.id);
        this.emit();
        await this.sceneOver(exit);
        return;
      }
      default: this.status = `Unknown command #${verb}. Try #sheet, #map, #help, #save or #quit.`;
    }
    this.emit();
  }

  /** The scene has ended: a fight goes to the map; otherwise the story moves on to the next lead. */
  async sceneOver(exit: Exit): Promise<void> {
    const session = this.session!;
    this.lines.push({ kind: "system", speaker: "system", text: `Scene ends: ${exit.title}` });
    // The exit's world script writes the notebook line ("Big Hobb talked..."): keep it, as the
    // session forgets the script's operations once the story moves on.
    const notes = (session.ended?.operations ?? []).filter(o => o.op === "journal").map(o => String(o.args["entry"] ?? "")).filter(Boolean);
    this.note({ sceneId: session.sceneId, title: sceneById(session.sceneId).title, ending: exit.title, lines: notes });
    if (exit.kind === "combat") {
      this.card = { title: "Roll for initiative!", lines: [exit.outcome, "", "Press Enter to fight."], next: "combat" };
      this.screen = "between";
      this.save("scene");
      this.emit();
      return;
    }
    await this.chain(`${sceneById(session.sceneId).title}: ${exit.title}`);
  }

  private note(entry: JournalEntry): void {
    const i = this.journal.findIndex(j => j.sceneId === entry.sceneId);
    if (i >= 0) this.journal[i] = { ...entry, lines: [...new Set([...this.journal[i]!.lines, ...entry.lines])] };
    else this.journal.push(entry);
  }

  /** Chain on to the next scene that still holds (interludes skipped) and return to the map. */
  private async chain(title: string, combatSummary?: string): Promise<void> {
    const session = this.session!;
    const played = session.sceneId;
    const notebook = this.journal.find(j => j.sceneId === played)?.lines ?? [];
    this.screen = "between";
    this.card = { title, lines: [], working: CHAIN_BUSY[this.busyTurn++ % CHAIN_BUSY.length]! };
    this.emit();
    try {
      const onward = await moveOn(session, combatSummary);
      if (onward.kind === "combat") { await this.beginCombat(); return; }
      if (onward.kind === "end") { this.toEnd(); return; }
      this.story = storyOf(session);
      this.pos = maps.afterScene(played, this.before ?? this.pos);
      const next = sceneById(onward.sceneId);
      const where = maps.sceneLocation(onward.sceneId);
      const skipped = onward.skipped.map(id => sceneById(id)).filter(s => !isInterlude(s)).map(s => s.title);
      this.card = {
        title: `${TIME_WORDS[this.story.time]}`,
        lines: [
          ...(notebook.length ? ["Your notebook:", ...notebook.map(l => `  ${l}`), ""] : []),
          ...(skipped.length ? [`(The story has already overtaken ${skipped.join(" and ")}.)`, ""] : []),
          `The lead: ${next.title}.${where ? ` Where: ${where.name}.` : ""}`,
          next.hook,
          "",
          "Press Enter to walk there.",
        ],
        next: "explore",
      };
      this.messages = [...this.messages, `${TIME_WORDS[this.story.time]}. The lead: ${next.title}.`].slice(-20);
      this.save("explore");
    } catch (error) {
      this.card = { title, lines: [`The story couldn't move on: ${message(error)}`, "", "Press Enter to try again."], next: undefined };
      this.retry = () => this.chain(title, combatSummary);
    }
    this.emit();
  }

  /** What Enter does on a card that failed: try the step again. */
  retry?: () => Promise<void>;

  continueFromCard(): void {
    const card = this.card;
    if (!card || card.working) return;
    if (!card.next && this.retry) { const again = this.retry; this.retry = undefined; void again(); return; }
    this.card = undefined;
    if (card.next === "combat") { void this.beginCombat(); return; }
    if (card.next === "end") { this.screen = "end"; this.emit(); return; }
    this.screen = "explore";
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Combat

  async beginCombat(saved?: CombatSetup): Promise<void> {
    const session = this.session!;
    this.setup = saved ?? combatSetup(session, maps.combatField(session.sceneId));
    this.screen = "between";
    this.card = { title: "Roll for initiative!", lines: [], working: "Everyone reaches for something heavy…" };
    this.emit();
    try {
      this.fight = await combat.start(this.setup, session);
      this.targetIndex = 0;
      this.card = undefined;
      this.screen = "combat";
      this.save("combat");
      this.emit();
      await this.othersAct();
    } catch (error) {
      this.card = { title: "Roll for initiative!", lines: [`The fight couldn't start: ${message(error)}`, "", "Press Enter to skip it (the story will assume you won)."], next: undefined };
      this.retry = async () => { this.card = undefined; await this.chain("After the fight", "The fight couldn't be played out on the map; take it that the player's side won."); };
      this.emit();
    }
  }

  /** Everyone else's turns, one at a time, so the log shows each blow land. */
  async othersAct(): Promise<void> {
    const fight = this.fight;
    if (!fight) return;
    this.busy = "The others act…";
    this.emit();
    for (let i = 0; i < 50 && !fight.result() && fight.view().current !== "player"; i++) {
      await fight.advance();
      // The moment it's the player's turn, hand it over: no pause with the keys still locked.
      if (fight.result() || fight.view().current === "player") break;
      this.emit();
      await sleep(Number(process.env.KM_APP_COMBAT_DELAY_MS ?? 450));
    }
    this.busy = undefined;
    this.emit();
  }

  async combatAct(action: CombatAction): Promise<void> {
    const fight = this.fight;
    if (!fight || this.busy || fight.result()) return;
    if (fight.view().current !== "player") return;
    this.busy = action.kind === "move" ? undefined : "…";
    this.emit();
    try {
      await fight.act(action);
    } catch (error) {
      this.status = `That didn't work: ${message(error)}`;
    }
    this.busy = undefined;
    this.emit();
    if (!fight.result() && fight.view().current !== "player") await this.othersAct();
  }

  async castAtTarget(spell: string, target?: string): Promise<void> {
    await this.combatAct({ kind: "cast", spell, ...(target ?? this.targetId ? { target: target ?? this.targetId! } : {}) });
  }

  /** The fight is over: its summary goes into the story's hand-off. */
  async afterCombat(): Promise<void> {
    const result = this.fight?.result();
    if (!result) return;
    this.fight = undefined;
    const session = this.session!;
    const said = { victory: "We won the fight.", surrender: "We won: they gave up.", defeat: "We lost the fight, and I woke up on the floor.", fled: "They ran for it." }[result.outcome];
    const enemies = new Set((this.setup?.combatants ?? []).filter(c => c.side === "enemy").map(c => c.id));
    const fell = result.casualties.filter(c => enemies.has(c.id) && c.state !== "standing").map(c => `${c.name} ${c.state === "down" ? "went down" : c.state}`);
    this.note({ sceneId: session.sceneId, title: sceneById(session.sceneId).title, ending: endedExit(session)?.title ?? "A fight", lines: [`${said}${fell.length ? ` ${capital(fell.join("; "))}.` : ""}`] });
    await this.chain("After the fight", result.summary);
  }

  // -------------------------------------------------------------------------------------------
  // The End, overlays, saving

  private toEnd(): void {
    const session = this.session!;
    this.ending = epilogue(session);
    this.story = storyOf(session, true);
    this.card = undefined;
    this.screen = "end";
    this.save("end");
    saveSession(session);
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

  save(mode: Mode): void {
    if (!this.session) return;
    this.mode = mode;
    try {
      saveApp({
        sessionId: this.session.id, mode, pos: this.pos, story: this.story, messages: this.messages.slice(-12), journal: this.journal,
        ...(this.before ? { before: this.before } : {}), ...(mode === "combat" && this.setup ? { combat: this.setup } : {}),
      });
    } catch { /* saving is best effort; the session itself is saved by the runtime */ }
  }

  toTitle(): void {
    this.screen = "title";
    this.overlay = undefined;
    this.card = undefined;
    this.fight = undefined;
    this.session = undefined;
    this.loadSaves();
  }

  quitToTitle(): void {
    if (this.session && this.screen !== "end") this.save(this.mode);
    this.toTitle();
  }

  quit(): void {
    if (this.session && this.screen !== "end" && this.screen !== "title") this.save(this.mode);
    this.quitting = true;
    this.emit();
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
