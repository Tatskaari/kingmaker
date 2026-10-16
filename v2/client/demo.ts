import { Timestamp } from "spacetimedb";
import type { Markup } from "../shared/markup.ts";
import { applyFix, tooLong } from "../shared/creation/story.ts";
import type { Backstory, LoreIssue, OwnBuild, Proposal } from "../shared/creation/types.ts";
import { MAX_CONCEPT, MAX_NAME, MAX_STORY, refusal, type RefusalCode } from "../shared/protocol/refusals.ts";
import type { BuildOption, Offer, OwnPicks, SheetData } from "../shared/rules/types.ts";
import type { Backend, CreationRow, GameRow, HomeRows, MoveName, Moves, NewGame, PlayerRow, Rejection, SheetRow } from "./backend.ts";
import { YARD } from "./check/fixture.ts";
import { DRAFT, FIGHTER, gameRow, LISTS, NEPHEW_ISSUE, OFFER, OWN, sheetRow, WIZARD, WORKED } from "./check/rows.ts";
import { withSubclass } from "./creation/model.ts";
import type { Entry, SceneView } from "./scene/view.ts";

/**
 * The game with no server (--demo): the title with two games to carry on, a character made from a
 * sentence on canned rows (the builds, their own, a draft, the lore check and its fix, the sheet,
 * as the simulation's moves would leave them, a beat apart), and the granary yard, where each line
 * said plays a canned turn through the phases the rows would give it (deciding, the reply growing
 * in its draft a word at a time, settling, done). A move the simulation would refuse is refused in
 * its words. `ms` paces it; the player starts seated in Pell Marrow's game, a few turns in.
 */
export function demoBackend(options: { ms?: number } = {}): Backend {
  return new Demo(options.ms ?? 40);
}

/** One of the demo's games: its title line, its character, and its scene once it has begun. */
interface DemoGame { row: GameRow; player: PlayerRow; sheet: SheetRow; view?: SceneView }

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
    this.games = [
      { row: gameRow(1n, "Pell Marrow", "in The Hanged Clerk", 5), player: { name: "Pell Marrow", concept: WIZARD.concept }, sheet: sheetRow(WIZARD), view: { ...YARD, entries: [...YARD.entries] } },
      { row: gameRow(2n, "Wren Ashdown", "heading for The Hanged Clerk", 60 * 50, Date.now(), false), player: { name: "Wren Ashdown", concept: FIGHTER.concept }, sheet: sheetRow(FIGHTER) },
    ];
    this.seat = 1n;
  }

  view(): SceneView | undefined {
    return this.seated()?.view;
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
    game.view = this.opening(args.name, game.row.gameId);
    game.row = { ...game.row, where: "in The Hanged Clerk", begun: true };
    return this.done();
  }

  /** Watching a game: any begun one is Pell Marrow's yard, seen from the side. */
  joinGame(game: bigint): Promise<Rejection | undefined> {
    const theirs = this.games.find(g => g.row.gameId === game);
    if (theirs && !theirs.view) return this.refuse("not_begun");
    const view: SceneView = { ...YARD, game: String(game), watching: YARD.player.name, mayType: false };
    this.watched = { row: { ...gameRow(game, YARD.player.name, "in The Hanged Clerk", 0) }, player: { name: "", concept: "" }, sheet: { data: "", pockets: "", build: "", statusLine: "" }, view };
    return this.done();
  }

  say(text: string): Promise<Rejection | undefined> {
    const view = this.view();
    if (!view) return this.refuse("not_in_game");
    if (view.watching) return this.refuse("not_controller", { name: view.watching });
    if (!text.trim()) return this.refuse("empty_line");
    if (!view.mayType) return this.refuse("turn_in_flight");
    void this.play(text.trim());
    return this.done();
  }

  retry(): Promise<Rejection | undefined> {
    return this.refuse("not_failed");
  }

  // -------------------------------------------------------------------------------------------
  // V1's moves: character creation, setting off, the title's games.

  act<K extends MoveName>(move: K, args: Moves[K]): Promise<Rejection | undefined> {
    const moves = this as unknown as Record<MoveName, (args: unknown) => RefusalCode | undefined>;
    this.refused = undefined;
    const code = moves[move].call(this, args);
    return code ? this.refuse(code, code === "story_too_long" ? { words: String((args as { text: string }).text.match(/\S+/g)?.length ?? 0) } : {}) : this.done();
  }

  startCreation({ name, concept, how }: Moves["startCreation"]): RefusalCode | undefined {
    if (!name.trim() || name.length > MAX_NAME) return "bad_name";
    if (concept.length > MAX_CONCEPT) return "bad_concept";
    const own = /^own:([\w-]+),([\w-]+),([\w-]*),([\w-]+)$/.exec(how);
    if (how !== "three" && how !== "model" && !own) return "bad_how";
    const was = this.creation;
    if (was?.offer && was.name === name && was.concept === concept && how === "three") { this.change({ step: "choose", busy: undefined, note: undefined }); return undefined; }
    this.creation = {
      campaign: "caerwyn", name, concept, how: own ? "own" : how, step: "choose", busy: "builds", rev: 1, offer: undefined, own: undefined, chosen: undefined,
      story: was?.story ?? "", version: (was?.version ?? 0) + 1, proposal: undefined, issues: undefined, issue: 0, rewriting: undefined, again: false,
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
    if (game.view) return "already_begun";
    game.view = this.opening(game.player.name, game.row.gameId);
    game.row = { ...game.row, where: "in The Hanged Clerk", begun: true, lastPlayedAt: Timestamp.now() };
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

  /** The yard's opening, for a game just begun. */
  private opening(name: string, game: bigint): SceneView {
    return { ...YARD, game: String(game), player: { name, status: "HP 28/28" }, entries: YARD.entries.slice(0, 1), phase: "done", turn: 0, mayType: true };
  }

  /** A turn as the rows would play it, from the line said to the world settled. */
  private async play(text: string): Promise<void> {
    const game = this.seated()!;
    const set = (patch: Partial<SceneView>, drop: Array<"refusal" | "draft"> = []) => {
      const view: SceneView = { ...game.view!, ...patch };
      for (const key of drop) delete view[key];
      game.view = view;
      this.tell();
    };
    const sleep = (n: number) => new Promise<void>(resolve => this.later(n, resolve));
    const turn = (game.view!.entries.at(-1)?.turn ?? 0) + 1;
    const said: Entry = { turn, speaker: "player:1", kind: "player", name: game.view!.player.name, text };
    set({ entries: [...game.view!.entries, said], phase: "deciding", turn, mayType: false }, ["refusal"]);
    await sleep(15);

    const words = REPLY.split(/(?<= )/);
    for (let seq = 1; seq <= words.length; seq++) {
      const sofar = words.slice(0, seq).join("");
      set({ phase: "replying", draft: { speaker: "gm", kind: "narration", text: sofar, markup: kellIn(sofar), attempt: 1, seq } });
      await sleep(1);
    }

    set({ entries: [...game.view!.entries, { turn, speaker: "gm", kind: "narration", text: REPLY, markup: kellIn(REPLY) }], phase: "settling", mayType: true }, ["draft"]);
    await sleep(25);
    set({ phase: "done" });
  }
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

/** The markup of the reply so far: Kell's line, as much of it as has come. */
function kellIn(text: string): Markup {
  const start = text.indexOf("“");
  if (start < 0) return { speech: [], marks: [] };
  const close = text.indexOf("”", start);
  return { speech: [{ start, end: close < 0 ? text.length : close + 1, speaker: "kell" }], marks: [] };
}
