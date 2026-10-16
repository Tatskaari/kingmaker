import { Timestamp } from "spacetimedb";
import { enterScene, leaveScene } from "../shared/map/explore.ts";
import { actionId, OUT, type InteractArgs, type MapMove, type TravelArgs, type WalkArgs } from "../shared/map/moves.ts";
import { exploreOf, exploreRowOf, type ExploreRow, type MapRows } from "../shared/map/rows.ts";
import { act as actOnMap, Unavailable, type Done } from "../shared/map/town.ts";
import type { Mark, Markup } from "../shared/markup.ts";
import { applyFix, tooLong } from "../shared/creation/story.ts";
import type { Backstory, LoreIssue, OwnBuild, Proposal } from "../shared/creation/types.ts";
import { MAX_CONCEPT, MAX_NAME, MAX_STORY, refusal, type RefusalCode } from "../shared/protocol/refusals.ts";
import type { BuildOption, Offer, OwnPicks, SheetData } from "../shared/rules/types.ts";
import { rowsToWorld, type PlaceRows } from "../shared/world/rows.ts";
import { damageThing, type SceneWorld } from "../shared/world/scene-world.ts";
import type { Backend, CreationRow, GameRow, HomeRows, MoveName, Moves, NewGame, PlayerRow, Rejection, SheetRow } from "./backend.ts";
import { YARD } from "./check/fixture.ts";
import { CAERWYN_MAPS, exploreRow, UNHEARD, useCaerwyn, waitingYard, yardOnMap } from "./check/map.ts";
import { WIZARD_SPELLS, yardKeys, yardNames, yardTables, yardWorld, YARD_SCENE } from "./check/place.ts";
import type { ExploreView } from "./explore/rows.ts";
import { DRAFT, FIGHTER, gameRow, LISTS, NEPHEW_ISSUE, OFFER, OWN, sheetRow, WIZARD, WORKED } from "./check/rows.ts";
import { withSubclass } from "./creation/model.ts";
import { placeViewOf } from "./scene/place-rows.ts";
import type { Entry, PlaceView, SceneView, Suggestion } from "./scene/view.ts";

/**
 * The game with no server (--demo): the title with two games to carry on, a character made from a
 * sentence on canned rows (the builds, their own, a draft, the lore check and its fix, the sheet,
 * as the simulation's moves would leave them, a beat apart), and the granary yard, where each line
 * said plays a canned turn through the phases the rows would give it (deciding, the reply growing
 * in its draft a word at a time with Kell's line in her colour, settling, noting while the GM writes
 * the notes, done once they're in, a mark with its card on the reply), and four lines suggested a
 * moment after. A line said before the last turn is done waits, queued, as the simulation holds it;
 * /suggestions turns the lines off, and on (asked for at once). A move the simulation would refuse
 * is refused in its words. `ms` paces it; the player starts seated in Pell Marrow's game, a few
 * turns in. The yard is drawn beside the talk from its place's rows (the world bridge's client), and
 * one line plays the rules' part as the world bridge does: Magic Missile at the hoist rope breaks it
 * (the world's own damageThing), Prout falls, and the dice lines come before the reply. A game set
 * off (a new one, or one just made) begins on the town's map in the lane (map-design §3.3): the demo
 * plays the simulation's part of a move with the same shared map code (exploreOf, act), the yard
 * built on the map and its scene waiting; walking or talking into it opens its canned scene.
 */
export function demoBackend(options: { ms?: number } = {}): Backend {
  return new Demo(options.ms ?? 40);
}

/**
 * One of the demo's games: its title line, its character, and its scene once it has begun; its
 * latest turn's n (a turn's late news, its notes and its lines, is only the view's while it's still
 * the latest), and the turn being played, until it's done (a line said meanwhile waits for it).
 */
interface DemoGame { row: GameRow; player: PlayerRow; sheet: SheetRow; view?: SceneView; latest?: number; playing?: Promise<void>; place?: PlaceRows; map?: DemoMap }

/** A game on the town's map: the walker's explore row, the yard's world and its scene's status, and the view last made of them (made again after a move). */
interface DemoMap { row: ExploreRow; yard: SceneWorld; status: "waiting" | "live" | "ended"; view?: ExploreView }

class Demo implements Backend {
  private readonly ms: number;
  private readonly games: DemoGame[];
  private seat?: bigint;
  /** Someone else's game, being watched: the seat's, while it lasts (it isn't one of the player's games). */
  private watched?: DemoGame;
  private creation?: CreationRow;
  private refused?: string;
  private nextId = 3n;
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(ms: number) {
    this.ms = ms;
    const pell: DemoGame = { row: gameRow(1n, "Pell Marrow", "in The Hanged Clerk", 5), player: { name: "Pell Marrow", concept: WIZARD.concept }, sheet: sheetRow(WIZARD), latest: YARD.turn ?? 0 };
    pell.view = { ...YARD, entries: [...YARD.entries], suggestions: [...LINES], place: placed(pell, pell.player.name, true) };
    this.games = [
      pell,
      { row: gameRow(2n, "Wren Ashdown", "heading for The Hanged Clerk", 60 * 50, Date.now(), false), player: { name: "Wren Ashdown", concept: FIGHTER.concept }, sheet: sheetRow(FIGHTER) },
    ];
    this.seat = 1n;
  }

  view(): SceneView | undefined {
    return this.seated()?.view;
  }

  /** The map between scenes: the seat's game's, once it has set off on it (made again only after a move). */
  explore(): ExploreView | undefined {
    const game = this.seated();
    const map = game?.map;
    if (!game || !map) return undefined;
    if (!map.view) {
      const rows = this.mapRows(map);
      map.view = {
        game: String(game.row.gameId), ex: exploreOf(rows), unheard: rows.unheard,
        player: { name: game.player.name, ...(game.sheet.statusLine ? { status: game.sheet.statusLine } : {}), ...(game.sheet.build ? { build: game.sheet.build } : {}), concept: game.player.concept },
        ...(map.status === "waiting" ? { lead: { key: YARD_SCENE, title: YARD.title, hook: YARD.hook! } } : {}),
        acts: map.row.acts, said: map.row.said, log: [...map.row.log],
      };
    }
    return map.view;
  }

  home(): HomeRows {
    const game = this.seated();
    return {
      games: this.games.map(g => g.row),
      ...(this.creation ? { creation: this.creation } : {}),
      campaigns: [{ key: "caerwyn", version: "0.1.0", title: "Caerwyn", json: JSON.stringify({ id: "caerwyn", level: 3 }) }],
      ...(game ? { seat: { playerId: game.row.gameId, gameId: game.row.gameId, sceneId: game.view ? 1n : undefined }, player: game.player, sheet: game.sheet } : {}),
      ...(this.refused ? { refusal: this.refused } : {}),
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // -------------------------------------------------------------------------------------------
  // V0's moves: a ready-made character's game, watching one, a line said.

  newGame(args: NewGame): Promise<Rejection | undefined> {
    const sheet = { ...(args.build === "wizard" ? WIZARD : FIGHTER), name: args.name, concept: args.concept };
    const game = this.addGame(args.name, args.concept, sheet);
    this.setOff(game);
    return this.done();
  }

  /** Watching a game: any begun one is Pell Marrow's yard, seen from the side. */
  joinGame(game: bigint): Promise<Rejection | undefined> {
    const theirs = this.games.find(g => g.row.gameId === game);
    if (theirs && !theirs.view) return this.refuse("not_begun");
    this.watched = { row: { ...gameRow(game, YARD.player.name, "in The Hanged Clerk", 0) }, player: { name: "", concept: "" }, sheet: { data: "", pockets: "", build: "", statusLine: "" } };
    this.watched.view = { ...YARD, game: String(game), watching: YARD.player.name, mayType: false, place: placed(this.watched, YARD.player.name, true) };
    return this.done();
  }

  say(text: string): Promise<Rejection | undefined> {
    const view = this.view();
    if (!view) return this.refuse("not_in_game");
    if (view.watching) return this.refuse("not_controller", { name: view.watching });
    if (!text.trim()) return this.refuse("empty_line");
    if (!view.mayType) return this.refuse("turn_in_flight");
    // While the last turn settles or its notes are written, the line waits for it.
    const game = this.seated()!;
    game.playing = this.play(game, text.trim(), view.phase === "done" ? undefined : game.playing);
    return this.done();
  }

  retry(): Promise<Rejection | undefined> {
    return this.refuse("not_failed");
  }

  /** The player's own setting: off, the lines go; on, this moment's are asked for at once once its reply is in (a reply on its way brings its own). */
  setSuggestions(on: boolean): Promise<Rejection | undefined> {
    const game = this.seated(), view = game?.view;
    if (!game || !view) return this.refuse("not_in_game");
    const set = (patch: Partial<SceneView>) => { game.view = { ...game.view!, ...patch }; };
    if (!on) set({ suggestionsOn: false, suggestions: [], suggestionsComing: false });
    else if (view.suggestionsOn || view.watching) set({ suggestionsOn: true });
    else {
      set({ suggestionsOn: true, suggestionsComing: true });
      if (["settling", "noting", "done"].includes(view.phase)) this.ask(game, game.latest ?? 0, 20);
    }
    return this.done();
  }

  // -------------------------------------------------------------------------------------------
  // V1's moves: character creation, setting off, the title's games.

  act<K extends MoveName>(move: K, args: Moves[K]): Promise<Rejection | undefined> {
    const moves = this as unknown as Record<MoveName, (args: unknown) => RefusalCode | undefined>;
    this.refused = undefined;
    const code = moves[move].call(this, args);
    return code ? this.refuse(code, code === "story_too_long" ? { words: String((args as { text: string }).text.match(/\S+/g)?.length ?? 0) } : {}) : this.done();
  }

  startCreation({ name, concept, how, afresh }: Moves["startCreation"]): RefusalCode | undefined {
    if (!name.trim() || name.length > MAX_NAME) return "bad_name";
    if (concept.length > MAX_CONCEPT) return "bad_concept";
    const own = /^own:([\w-]+),([\w-]+),([\w-]*),([\w-]+)$/.exec(how);
    if (how !== "three" && how !== "model" && !own) return "bad_how";
    const was = this.creation, kept = afresh ? undefined : was;
    if (kept?.offer && kept.name === name && kept.concept === concept && how === "three") { this.change({ step: "choose", busy: undefined, note: undefined }); return undefined; }
    this.creation = {
      campaign: "caerwyn", name, concept, how: own ? "own" : how, step: "choose", busy: "builds", rev: 1, offer: undefined, own: undefined, chosen: undefined,
      story: kept?.story ?? "", version: (was?.version ?? 0) + 1, proposal: undefined, issues: undefined, issue: 0, rewriting: undefined, again: false,
      note: undefined, unchecked: undefined, backstory: undefined, gameId: undefined,
    };
    if (how === "three") this.later(40, () => this.change({ offer: JSON.stringify(OFFER), busy: undefined }));
    else if (how === "model") { this.change({ step: "backstory", busy: "pick" }); this.later(40, () => this.change({ chosen: JSON.stringify(OFFER.options[0]), busy: undefined })); }
    else this.makeOwnFrom({ speciesId: own![1]!, classId: own![2]!, backgroundId: own![4]!, ...(own![3] ? { subclassId: own![3] } : {}) });
    return undefined;
  }

  creationBack({ story }: Moves["creationBack"]): RefusalCode | undefined {
    const c = this.creation;
    if (!c || c.step === "made") return "not_creating";
    const step = c.step === "choose" || !c.offer ? "concept" : "choose";
    this.change({ step, busy: undefined, proposal: undefined, issues: undefined, note: undefined, rewriting: undefined, ...(story !== undefined ? { story } : {}) });
    return undefined;
  }

  chooseBuild({ index }: Moves["chooseBuild"]): RefusalCode | undefined {
    const c = this.creation;
    if (!c || c.step === "made") return "not_creating";
    if (c.busy) return "creation_busy";
    const option = this.parsed<Offer>(c.offer)?.options[index];
    if (!option) return "not_offered";
    this.change({ chosen: JSON.stringify(option), step: "backstory", proposal: undefined, issues: undefined, note: undefined, rewriting: undefined });
    return undefined;
  }

  makeOwn({ from }: Moves["makeOwn"]): RefusalCode | undefined {
    const c = this.creation;
    if (!c || c.step === "made") return "not_creating";
    if (c.busy) return "creation_busy";
    const card = this.parsed<Offer>(c.offer)?.options[from];
    if (!card) return "not_offered";
    const picks = this.parsed<OwnBuild>(c.own)?.picks ?? { speciesId: card.build.speciesId, classId: card.build.classId, subclassId: card.build.subclassId, backgroundId: card.build.backgroundId };
    this.makeOwnFrom(picks);
    return undefined;
  }

  pickOwn(picks: Moves["pickOwn"]): RefusalCode | undefined {
    const c = this.creation;
    if (!c || c.step === "made") return "not_creating";
    if (c.busy && c.busy !== "own") return "creation_busy";
    this.makeOwnFrom(withSubclass(picks, LISTS, 3));
    return undefined;
  }

  takeOwn(): RefusalCode | undefined {
    const c = this.creation, option = this.parsed<OwnBuild>(c?.own)?.option;
    if (!c || c.step === "made") return "not_creating";
    if (c.busy === "own" || !option) return "still_making";
    this.change({ chosen: JSON.stringify(option), step: "backstory", note: undefined });
    return undefined;
  }

  setBackstory({ text }: Moves["setBackstory"]): RefusalCode | undefined {
    if (!this.creation) return "not_creating";
    if (text.length > MAX_STORY) return "story_too_big";
    this.change({ story: text }, false);
    return undefined;
  }

  draftBackstory({ text }: Moves["draftBackstory"]): RefusalCode | undefined {
    return this.propose("draft", text, () => DRAFT);
  }

  workInBackstory({ text }: Moves["workInBackstory"]): RefusalCode | undefined {
    if (this.creation && !this.creation.busy && !text.trim()) return "nothing_to_work_in";
    if (tooLong(text)) return "story_too_long";
    return this.propose("work", text, () => WORKED);
  }

  takeProposal(): RefusalCode | undefined {
    const c = this.creation, proposal = this.parsed<Proposal>(c?.proposal);
    if (!c) return "not_creating";
    if (!proposal) return "not_now";
    this.change({ story: proposal.text, version: c.version + 1, proposal: undefined, note: "It's yours now: change anything you like." });
    return undefined;
  }

  leaveProposal(): RefusalCode | undefined {
    if (!this.creation) return "not_creating";
    if (!this.creation.proposal) return "not_now";
    this.change({ proposal: undefined });
    return undefined;
  }

  finishBackstory({ text }: Moves["finishBackstory"]): RefusalCode | undefined {
    const c = this.creation;
    if (!c || c.step === "made") return "not_creating";
    if (c.busy) return "creation_busy";
    if (tooLong(text)) return "story_too_long";
    this.change({ story: text, rewriting: undefined, again: false, note: undefined });
    if (!text.trim()) this.make();
    else this.check();
    return undefined;
  }

  acceptFix(): RefusalCode | undefined {
    const c = this.creation, issues = this.parsed<LoreIssue[]>(c?.issues), issue = issues?.[c?.issue ?? 0];
    if (!c || c.step === "made") return "not_creating";
    if (c.busy) return "creation_busy";
    if (!issues || !issue) return "not_now";
    const fixed = applyFix(c.story, issue);
    if (fixed === undefined) return this.rewriteIssue();
    if (c.issue + 1 < issues.length) { this.change({ story: fixed, version: c.version + 1, issue: c.issue + 1 }); return undefined; }
    this.change({ story: fixed, version: c.version + 1, issues: undefined, issue: 0 });
    if (c.again) this.traits();
    else { this.change({ again: true }); this.check(); }
    return undefined;
  }

  rewriteIssue(): RefusalCode | undefined {
    const c = this.creation, issue = this.parsed<LoreIssue[]>(c?.issues)?.[c?.issue ?? 0];
    if (!c) return "not_creating";
    if (!issue) return "not_now";
    this.change({ rewriting: JSON.stringify(issue), issues: undefined, issue: 0 });
    return undefined;
  }

  skipBackstory(): RefusalCode | undefined {
    const c = this.creation;
    if (!c || c.step === "made") return "not_creating";
    if (c.busy) return "creation_busy";
    this.change({ story: "", version: c.version + 1, unchecked: undefined });
    this.make();
    return undefined;
  }

  chooseAgain(): RefusalCode | undefined {
    const c = this.creation;
    if (!c) return "not_creating";
    if (c.gameId === undefined) return "not_now";
    this.forget(c.gameId);
    this.change({ gameId: undefined, step: c.offer ? "choose" : "concept", backstory: undefined });
    return undefined;
  }

  begin(): RefusalCode | undefined {
    const game = this.seated();
    if (!game) return "not_in_game";
    if (game.view || game.map) return "already_begun";
    this.setOff(game);
    game.row = { ...game.row, lastPlayedAt: Timestamp.now() };
    if (this.creation?.gameId === game.row.gameId) this.creation = undefined;
    return undefined;
  }

  continueGame({ game }: Moves["continueGame"]): RefusalCode | undefined {
    const theirs = this.games.find(g => g.row.gameId === game);
    if (!theirs) return "unknown";
    theirs.row = { ...theirs.row, lastPlayedAt: Timestamp.now() };
    this.sit(game);
    return undefined;
  }

  deleteGame({ game }: Moves["deleteGame"]): RefusalCode | undefined {
    if (!this.games.some(g => g.row.gameId === game)) return "unknown";
    this.forget(game);
    if (this.creation?.gameId === game) this.change({ gameId: undefined });
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // The map between scenes (map-design §3.2, §3.3): the simulation's part, on the same shared code.

  walk(args: WalkArgs): Promise<Rejection | undefined> { return this.mapMove({ move: "walk", args }); }
  interact(args: InteractArgs): Promise<Rejection | undefined> { return this.mapMove({ move: "interact", args }); }
  travel(args: TravelArgs): Promise<Rejection | undefined> { return this.mapMove({ move: "travel", args }); }

  /** A game set off on the town's map (start.map): in the lane by the granary gate, facing south; the yard built and its scene waiting. */
  private setOff(game: DemoGame): void {
    useCaerwyn();
    game.map = { row: exploreRow(), yard: waitingYard(game.player.name), status: "waiting" };
    game.row = { ...game.row, where: "heading for The Hanged Clerk", begun: true };
  }

  /** What the map is read from (MapRows), as the simulation reads it: the maps, the walker's row, the story, the yard on its map. */
  private mapRows(map: DemoMap): MapRows {
    return { maps: CAERWYN_MAPS, explore: map.row, story: { time: "morning", lead: YARD_SCENE, played: map.status === "ended" ? [YARD_SCENE] : [] }, places: [yardOnMap(map.yard, map.status)], unheard: UNHEARD };
  }

  /**
   * A move on the map, as the simulation makes it (simulation/src/map/moves.ts): the state from the
   * rows, the prototype's act by the move's action id, the explore row written back with what it said;
   * one that opens the lead opens its canned scene, the walker where its world starts them. Back to the
   * map from a scene that's over (walk out) puts them where the scene left them.
   */
  private mapMove(m: MapMove): Promise<Rejection | undefined> {
    const game = this.seated();
    if (!game) return this.refuse("not_in_game");
    if (this.watched) return this.refuse("not_controller", { name: YARD.player.name });
    const map = game.map;
    if (!map) return this.refuse("no_way");
    const out = m.move === "walk" && m.args.toward === OUT;
    if (game.view && !game.view.over) return this.refuse("scene_on");
    const rows = this.mapRows(map);
    const ex = exploreOf(rows);
    if (out) {
      if (!game.view) return this.refuse("unavailable");
      leaveScene(ex, map.yard);
      map.status = "ended";
      delete game.view;
      map.row = exploreRowOf(ex, map.row, "");
      map.view = undefined;
      return this.done();
    }
    const id = actionId(m);
    if (!id) return this.refuse("unavailable");
    let done: Done;
    try {
      done = actOnMap(ex, rows.unheard, id);
    } catch (error) {
      if (error instanceof Unavailable) return this.refuse("unavailable");
      throw error;
    }
    if (done.scene) enterScene(ex, YARD_SCENE);
    map.row = exploreRowOf(ex, map.row, done.text);
    map.view = undefined;
    if (done.scene) {
      this.open(game);
      map.status = "live";
      map.yard = yardWorld(game.player.name);
      game.row = { ...game.row, where: "in The Hanged Clerk" };
    }
    return this.done();
  }

  // -------------------------------------------------------------------------------------------
  // The GM's part, canned: a beat later, as a job's commit would land.

  /** Their own picks, made into what they come to: an orc rogue is the fixture's; anything else is drawn from the nearest card the fixtures have, named for the picks. */
  private makeOwnFrom(picks: OwnPicks): void {
    const was = this.parsed<OwnBuild>(this.creation?.own);
    this.change({ step: "custom", busy: "own", own: JSON.stringify({ ...was, picks }) });
    const rev = this.creation!.rev;
    this.later(10, () => {
      if (this.creation?.rev !== rev) return;
      this.change({ busy: undefined, own: JSON.stringify({ picks, option: ownOption(picks), lists: LISTS }) });
    });
  }

  /** A draft, or their notes worked in, shown to take or leave. */
  private propose(kind: Proposal["kind"], text: string, words: () => string): RefusalCode | undefined {
    const c = this.creation;
    if (!c || c.step === "made") return "not_creating";
    if (c.busy) return "creation_busy";
    this.change({ story: text, busy: kind, note: undefined });
    this.later(40, () => this.change({ busy: undefined, proposal: JSON.stringify({ kind, text: words() }) }));
    return undefined;
  }

  /** The lore check: the King's nephew doesn't fit (the prototype's screen check's case); anything else does, and goes on to its traits. */
  private check(): void {
    this.change({ busy: "check" });
    this.later(40, () => {
      const story = this.creation?.story ?? "";
      if (/King's nephew/.test(story)) this.change({ busy: undefined, issues: JSON.stringify([NEPHEW_ISSUE]), issue: 0 });
      else this.traits();
    });
  }

  /** What the backstory says of them, then the character made. */
  private traits(): void {
    this.change({ busy: "traits", unchecked: undefined });
    this.later(40, () => {
      const c = this.creation!;
      const backstory: Backstory = { text: c.story, summary: `${c.name}, ${c.concept}.`, personality: ["Sharp-tongued"], ideals: ["The books should balance"], bonds: ["Fat Jory, owed three crowns"], flaws: ["Can't leave a sum alone"] };
      this.change({ backstory: JSON.stringify(backstory) });
      this.make(backstory);
    });
  }

  /** The character made, as makeCharacter makes it: a game the seat moves to, its sheet (the wizard's or the fighter's), the creation made. */
  private make(backstory?: Backstory): void {
    const c = this.creation!;
    const build = this.parsed<BuildOption>(c.chosen);
    const made = build?.card.casting ? WIZARD : FIGHTER;
    const story = backstory ? { story: { backstory: backstory.text, personality: backstory.personality, ideals: backstory.ideals, bonds: backstory.bonds, flaws: backstory.flaws } } : {};
    const game = this.addGame(c.name, c.concept, { ...made, name: c.name, concept: c.concept, ...story });
    // The sheet is the nearest the fixtures have (the wizard's for a caster, else the fighter's); its build line is the one chosen.
    if (build) game.sheet = { ...game.sheet, build: build.line };
    this.change({ step: "made", busy: undefined, gameId: game.row.gameId });
  }

  // -------------------------------------------------------------------------------------------
  // The rows.

  private addGame(name: string, concept: string, sheet: SheetData): DemoGame {
    const id = this.nextId++;
    const game: DemoGame = { row: gameRow(id, name, "heading for The Hanged Clerk", 0, Date.now(), false), player: { name, concept }, sheet: sheetRow(sheet) };
    this.games.push(game);
    this.sit(id);
    return game;
  }

  /** The seat moves to one of the player's games (watching another's ends). */
  private sit(id: bigint | undefined): void {
    this.seat = id;
    this.watched = undefined;
  }

  private forget(id: bigint): void {
    const at = this.games.findIndex(g => g.row.gameId === id);
    if (at >= 0) this.games.splice(at, 1);
    if (this.seat === id) this.sit(undefined);
  }

  private seated(): DemoGame | undefined {
    return this.watched ?? this.games.find(g => g.row.gameId === this.seat);
  }

  /** The creation row changed, rev bumped (but for the story saved), and word of it. */
  private change(patch: Partial<CreationRow>, bump = true): void {
    if (!this.creation) return;
    this.creation = { ...this.creation, ...patch, rev: this.creation.rev + (bump ? 1 : 0) };
    this.tell();
  }

  private parsed<T>(json: string | undefined): T | undefined {
    return json ? JSON.parse(json) as T : undefined;
  }

  private later(beats: number, fn: () => void): void {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, this.ms * beats);
    this.timers.add(t);
  }

  private tell(): void {
    for (const listener of this.listeners) listener();
  }

  private done(): Promise<undefined> {
    this.refused = undefined;
    this.tell();
    return Promise.resolve(undefined);
  }

  /** The simulation's word on a move it won't make, kept for the status line (or the creation's note line). */
  private refuse(code: RefusalCode, vars: Record<string, string> = {}): Promise<Rejection> {
    const why = refusal(code, vars);
    this.refused = why.text;
    const view = this.view();
    if (view) this.seated()!.view = { ...view, refusal: why.text };
    this.tell();
    return Promise.resolve(why);
  }

  // -------------------------------------------------------------------------------------------
  // The scene: the yard's opening, and a canned turn.

  /** The yard's opening, for a game just begun, and its lines: a new game's player has them on, as the simulation's does. */
  private open(game: DemoGame): void {
    game.latest = 0;
    game.view = {
      ...YARD, game: String(game.row.gameId), player: { name: game.player.name, status: "HP 28/28" }, entries: YARD.entries.slice(0, 1), phase: "done", turn: 0, mayType: true,
      place: placed(game, game.player.name, /wizard/i.test(game.sheet.build)),
      suggestionsOn: true, suggestions: [...LINES], suggestionsComing: false, notesComing: false,
    };
  }

  /** A turn as the rows would play it, from the line said to its notes in; its lines come after, on their own. */
  private async play(game: DemoGame, text: string, behind: Promise<void> | undefined): Promise<void> {
    const set = (patch: Partial<SceneView>, drop: Array<"refusal" | "draft"> = []) => {
      const view: SceneView = { ...game.view!, ...patch };
      for (const key of drop) delete view[key];
      game.view = view;
      this.tell();
    };
    const sleep = (n: number) => new Promise<void>(resolve => this.later(n, resolve));
    const turn = game.latest = (game.latest ?? 0) + 1;
    const said: Entry = { turn, speaker: "player:1", kind: "player", name: game.view!.player.name, text };
    // The last set goes at once; its rows are kept for the next while it comes.
    set({ entries: [...game.view!.entries, said], phase: behind ? "queued" : "deciding", turn, mayType: false, suggestions: [], suggestionsComing: game.view!.suggestionsOn, notesComing: false }, ["refusal"]);
    if (behind) { await behind; set({ phase: "deciding" }); }
    await sleep(15);
    // The rules' part, before a word from the GM: the dice lines and the world they changed, together, as the decide commit writes them.
    const ruled = rulesFor(game, text, turn);
    if (ruled) { set({ entries: [...game.view!.entries, ...ruled.entries], place: ruled.place, player: { ...game.view!.player, status: ruled.status } }); await sleep(20); }

    const words = REPLY.split(/(?<= )/);
    for (let seq = 1; seq <= words.length; seq++) {
      const sofar = words.slice(0, seq).join("");
      set({ phase: "replying", draft: { speaker: "gm", kind: "narration", text: sofar, markup: kellIn(sofar), attempt: 1, seq } });
      await sleep(1);
    }

    // The reply final: the box opens, the world settles and the notes are written behind it, and the lines are asked for.
    const reply: Entry = { turn, speaker: "gm", kind: "narration", text: REPLY, markup: kellIn(REPLY) };
    set({ entries: [...game.view!.entries, reply], phase: "settling", mayType: true, notesComing: true }, ["draft"]);
    if (game.view!.suggestionsOn) this.ask(game, turn, 70);
    await sleep(25);
    if (game.latest === turn) set({ phase: "noting" });
    await sleep(25);
    // The notes: the reply's marks, each with its card; the turn done.
    set({ entries: game.view!.entries.map(e => (e === reply ? { ...e, markup: notedIn(REPLY, turn) } : e)), ...(game.latest === turn ? { phase: "done" as const, notesComing: false } : {}) });
  }

  /** The lines for a turn, `beats` from now: dropped when the player has moved on, or turned them off, meanwhile. */
  private ask(game: DemoGame, turn: number, beats: number): void {
    this.later(beats, () => {
      if (game.latest !== turn || !game.view) return;
      game.view = { ...game.view, suggestions: game.view.suggestionsOn ? [...LINES] : [], suggestionsComing: false };
      this.tell();
    });
  }
}

/**
 * The yard's place for a game (check/place.ts: the world openPlace builds, as its rows), its lead
 * the game's character; a wizard's sheet has the rules' word on its spells for the place's menu.
 * The rows are kept on the game, for the rules' part to change.
 */
function placed(game: DemoGame, lead: string, wizard: boolean): PlaceView | undefined {
  const { tables, rows } = yardTables(yardWorld(lead));
  game.place = rows;
  return placeViewOf({ tables, time: "morning", lead: 1n, names: yardNames(tables), sheet: wizard ? { spellFacts: JSON.stringify(WIZARD_SPELLS) } : {} });
}

/**
 * The rules' part of a turn, canned as the world bridge plays it: Magic Missile at the hoist rope
 * (three darts, 9 force) breaks it with the world's own damageThing, and what hung from it falls; the
 * slot goes from the status line. Anything else rolls nothing.
 */
function rulesFor(game: DemoGame, text: string, turn: number): { entries: Entry[]; place: PlaceView; status: string } | undefined {
  const view = game.view;
  if (!game.place || !view?.place || !/magic missile/i.test(text) || !/rope/i.test(text)) return undefined;
  const world = rowsToWorld(game.place, yardKeys());
  const rope = world.entities["hoist-rope"];
  if (!rope || rope.states.includes("destroyed")) return undefined;
  const broke = damageThing(world, rope, 9, "force", turn);
  const { tables, rows } = yardTables(world, game.place);
  game.place = rows;
  const status = (view.player.status ?? "").replace(/1st (\d+)\//, (_, n: string) => `1st ${Math.max(0, Number(n) - 1)}/`);
  const lines = ["Cast Magic Missile (1st-level slot) on the hoist rope", "3 darts at the hoist rope: 9 force", ...broke, `${view.player.name}: ${status}`];
  const place = placeViewOf({ tables, time: "morning", lead: 1n, names: yardNames(tables), sheet: { spellFacts: JSON.stringify(WIZARD_SPELLS) } });
  return place ? { entries: lines.map(line => ({ turn, speaker: "dice", kind: "roll" as const, text: line })), place, status } : undefined;
}

/** What their own picks come to, canned: the fixture's orc rogue, or the card of the class nearest the picks, named for them. */
function ownOption(picks: OwnPicks): BuildOption {
  const like = [OWN, ...OFFER.options].find(o => o.build.classId === picks.classId) ?? OWN;
  const name = (list: Array<{ id: string; name: string }>, id: string | undefined) => list.find(x => x.id === id)?.name ?? id ?? "";
  const subclass = name(LISTS.subclasses[picks.classId] ?? [], picks.subclassId);
  return {
    ...like,
    from: "own",
    build: { ...like.build, ...picks, subclassId: picks.subclassId ?? "" },
    line: `${name(LISTS.species, picks.speciesId).toLowerCase()} ${name(LISTS.classes, picks.classId).toLowerCase()} 3${subclass ? ` (${subclass})` : ""}, ${name(LISTS.backgrounds, picks.backgroundId).toLowerCase()} background`,
    card: { ...like.card, species: name(LISTS.species, picks.speciesId), className: name(LISTS.classes, picks.classId), background: name(LISTS.backgrounds, picks.backgroundId), ...(subclass ? { subclass } : {}) },
  };
}

/** What the GM says to every line in the demo: Kell answers, in her colour. */
const REPLY = "Sergeant Kell glances up at the body, then back to her notebook. “The porters. First light. They came to open the yard, saw him, and ran for the watch.” Her pencil taps once against the page.";

/** The lines suggested after every reply (and the opening): two to say, a deed and a risky try, as the AI service's canned set has them. */
const LINES: Suggestion[] = [
  { kind: "say", text: "Sergeant, who found him, and when exactly did the porters raise the alarm?" },
  { kind: "say", text: "Nice boots, lad. Yours?" },
  { kind: "do", text: "(I look up at the body, then along the hoist rope to the loft door)" },
  { kind: "try", text: "(I try to coax the boy down from his stones with a pie)" },
];

/** The markup of the reply so far: Kell's line, as much of it as has come. */
function kellIn(text: string): Markup {
  const start = text.indexOf("“");
  if (start < 0) return { speech: [], marks: [] };
  const close = text.indexOf("”", start);
  return { speech: [{ start, end: close < 0 ? text.length : close + 1, speaker: "kell" }], marks: [] };
}

/**
 * The reply once its notes are in: Kell's line, a know on the watch with what anyone in Caerwyn
 * could tell you of it (the lore's first sentences, as the AI service writes a place's card), and
 * a why on her pencil with her card as of this turn.
 */
function notedIn(text: string, turn: number): Markup {
  const markup = kellIn(text);
  const at = (phrase: string) => ({ start: text.indexOf(phrase), end: text.indexOf(phrase) + phrase.length });
  const said = markup.speech[0]!;
  const marks: Mark[] = [
    {
      ...at("ran for the watch"), kind: "know", note: "The watch keeps a house on the corner of the granary lane: the porters hadn't far to run.",
      link: { kind: "lore", path: "World/City Watch.md" },
      card: { title: "The City Watch", lines: ["The watch keeps the King's peace in Caerwyn's streets: a Captain who likes a parade, a handful of sergeants, corporals and constables, and never enough of any of them. Rain capes and truncheons, and notebooks for the sergeants.", "What anyone in Caerwyn could tell you."] },
    },
    {
      ...at("Her pencil taps once against the page"), kind: "why", note: "She wrote the porters' story down before you came, and she's checking what she just told you against it.",
      link: { kind: "person", id: "kell" },
      card: { title: "Sergeant Agnes Kell", lines: ["A sergeant of the Caerwyn city watch, out of the watch house by the granary quarter.", "You met them in this scene.", `Last said to you (turn ${turn}): ${text.slice(said.start, said.end)}`] },
    },
  ];
  return { ...markup, marks };
}
