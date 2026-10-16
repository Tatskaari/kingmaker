// The prototype's src/app/game.ts:494-823 at 44c6d4a (character creation) and :949-953 (begin), as a model over the creation row: each method the move it was (v1-design §3.3), or the screen's own state; the flow, the model's calls and the engine are the simulation's and the AI service's now. aiOffline is gone: the answer says when the GM is offline.
import { tooLong } from "../../shared/creation/story.ts";
import { refusal } from "../../shared/protocol/refusals.ts";
import type { OwnPicks, SheetData, SrdLists } from "../../shared/rules/types.ts";
import type { AppPart } from "../app/model.ts";
import type { MoveName, Moves } from "../backend.ts";
import { sheetOf, type SheetRow } from "../sheet/rows.ts";
import { creationOf, memoParse, type Creation, type CreationLocal } from "./rows.ts";
import { DEFAULT_CONCEPT, DEFAULT_NAME, levelOf, timeWords } from "./words.ts";

/**
 * Character creation's model (v1-design §3.10), for the create, creating, choose, custom, backstory
 * and created screens: `creation`, the prototype's Creation made from the caller's creation row and
 * what's the screen's own; and the prototype's methods, each a move or the screen's own state. A
 * move's refusal is `error`, for the screen's note line. The box's text is kept here as it's typed,
 * and saved a second after typing stops; the moves that need it carry it.
 */
export class CreationModel {
  private readonly app: AppPart;
  /** How long typing has to stop before the box's text is saved. */
  private readonly saveMs: number;
  private local: CreationLocal = { index: 0, column: 0 };
  /** A word of the model's own (a story too long, nothing to work in), until the next move. */
  private said?: string;
  private saving?: ReturnType<typeof setTimeout>;
  /** Bumped by each keystroke in the box and each pick of their own: a save or a pick that's overtaken leaves what came after it. */
  private typed = 0;
  private picked = 0;
  /** The sheet as last read from its row, by the row's own text (a wizard's is 19 KB of JSON: it's read once). */
  private sheetRead?: { row: SheetRow; data: SheetData | undefined };
  /** The row's JSON columns, each read once while its text stays the same. */
  private readonly parse = memoParse();

  constructor(app: AppPart, options: { saveMs?: number } = {}) {
    this.app = app;
    this.saveMs = options.saveMs ?? 1000;
  }

  subscribe(listener: () => void): () => void {
    return this.app.subscribe(listener);
  }

  get screen(): string { return this.app.screen; }

  /** The character being made, as the screens read it; none for a new one until its concept goes in (New game starts afresh: one made, or half made, before isn't this one). */
  get creation(): Creation | undefined {
    const row = this.app.rows.creation;
    if (!row || this.app.intent === "new") return undefined;
    return creationOf(row, this.local, this.parse);
  }

  /** Who's being made, for the creating screen: the creation's name and concept, else the seat's character's. */
  get creating(): { name: string; concept: string } | undefined {
    return this.creation ?? this.app.rows.player;
  }

  /** The level characters are made at: the creation's campaign's, else the one this client starts games in. */
  get level(): number {
    const key = this.app.rows.creation?.campaign ?? this.app.campaign;
    return levelOf(this.app.rows.campaigns.find(c => c.key === key));
  }

  /** The last word on a move: the model's own, else the simulation's refusal, in the game's words; or what went wrong in the client. */
  get error(): string | undefined { return this.said ?? this.app.refusal ?? this.app.problem; }

  // -------------------------------------------------------------------------------------------
  // The created screen: the sheet the engine made, where the story starts, and whether choosing again applies.

  /** The seat's character sheet: what the engine made, with what they carry laid over it. */
  get sheet(): SheetData | undefined {
    const row = this.app.rows.sheet;
    if (!row) return undefined;
    if (this.sheetRead?.row.data !== row.data || this.sheetRead.row.pockets !== row.pockets) this.sheetRead = { row, data: sheetOf(row) };
    return this.sheetRead.data;
  }

  /** Who they are: the seat's character (the sheet's words when the player row hasn't come). */
  get who(): { name: string; concept: string } {
    const sheet = this.sheet;
    return this.app.rows.player ?? { name: sheet?.name ?? "", concept: sheet?.concept ?? "" };
  }

  /** Where the story starts, over the sheet: "Morning, on the eve of the Assembly." and the first scene's hook. */
  get intro(): string | undefined {
    const seat = this.app.rows.seat;
    const game = seat && this.app.rows.games.find(g => g.gameId === seat.gameId);
    return game ? `${timeWords(game.time)}. ${game.hook}` : undefined;
  }

  /** The game on the sheet: a new character's starts on the sheet's first page. */
  get gameId(): bigint | undefined { return this.app.rows.seat?.gameId; }

  /** The character being made is the one on the sheet: choosing again (r) puts the game away. */
  get madeHere(): boolean {
    const made = this.app.rows.creation?.gameId;
    return made !== undefined && made === this.app.rows.seat?.gameId;
  }

  // -------------------------------------------------------------------------------------------
  // The name and the concept, and three builds.

  /**
   * The name and concept are in: three builds that fit, as cards (the GM's, made legal by the
   * engine). The same name and concept again (back from the cards, nothing changed) offer the same
   * three, and the card picked out stays. From New game it's afresh: nothing of a creation before
   * (its story, its builds) comes with it, as the prototype's newCharacter dropped its creation.
   */
  async offerBuilds(name: string, concept: string): Promise<void> {
    name = (name.trim() || DEFAULT_NAME).replace(/:/g, " ");
    concept = concept.trim() || DEFAULT_CONCEPT;
    const afresh = this.app.intent === "new";
    const was = afresh ? undefined : this.app.rows.creation;
    if (!was?.offer || was.name !== name || was.concept !== concept) this.local = { index: 0, column: 0 };
    if (await this.move("startCreation", { campaign: this.app.campaign, name, concept, how: "three", ...(afresh ? { afresh } : {}) })) this.app.go("creation");
  }

  /** Back to the name and concept (from the cards): as they were typed. */
  backToConcept(): void {
    void this.move("creationBack", {});
  }

  /** Pick out a card (the keys, or the pointer moving over it): 0-2 the builds, 3 "Make my own". */
  pickCard(index: number): void {
    const c = this.creation;
    if (!c || c.index === index) return;
    this.local.index = Math.max(0, Math.min(3, index));
    this.app.emit();
  }

  /** One of the three builds: on to the backstory. */
  chooseBuild(index: number): void {
    const c = this.creation, option = c?.offer?.options[index];
    if (!c || !option) return;
    this.local.index = index;
    void this.move("chooseBuild", { index });
  }

  /** Back to the three builds (from making one's own, or from the backstory, the box's text kept). */
  backToBuilds(): void {
    const story = this.local.typed?.text;
    this.stopSaving();
    void this.move("creationBack", story !== undefined ? { story } : {});
  }

  // -------------------------------------------------------------------------------------------
  // A build of their own.

  /** "Make my own": the SRD's lists to pick from, starting from the build picked out (or the first). */
  makeOwn(): void {
    const c = this.creation;
    if (!c?.offer?.options.length) return;
    const from = c.index < 3 && c.offer.options[c.index] ? c.index : 0;
    this.local.index = 3;
    void this.move("makeOwn", { from });
  }

  /**
   * A pick of the player's own (species, class, subclass, background): drawn at once, the card it
   * comes to as the engine makes it (the latest pick wins: an older answer is dropped).
   */
  async pickOwn(picks: OwnPicks): Promise<void> {
    const own = this.creation?.own;
    if (!own) return;
    const asked = withSubclass(picks, own.lists, this.level);
    const n = ++this.picked;
    this.local.picks = asked;
    this.app.emit();
    await this.move("pickOwn", { speciesId: asked.speciesId, classId: asked.classId, backgroundId: asked.backgroundId, ...(asked.subclassId ? { subclassId: asked.subclassId } : {}) });
    // The row has it now (its rows come before the move's answer), or the move was refused: the row says what's picked either way.
    if (n === this.picked) { this.local.picks = undefined; this.app.emit(); }
  }

  /** Which of the four lists has the keys (making one's own): species, class, subclass, background. */
  ownColumn(column: number): void {
    if (!this.creation?.own) return;
    this.local.column = (column + 4) % 4;
    this.app.emit();
  }

  /** Take the build of the player's own making: on to the backstory. */
  takeOwn(): void {
    const c = this.creation, option = c?.own?.option;
    if (!c || !option || c.own?.making) return;
    void this.move("takeOwn", {});
  }

  // -------------------------------------------------------------------------------------------
  // Their backstory.

  /** The box's text, as it changes (the box is the backstory screen's own): kept, and saved once typing stops for a second. */
  storyTyped(text: string): void {
    const row = this.app.rows.creation;
    if (!row || text === this.creation?.story) return;
    this.local.typed = { text, version: row.version };
    const n = ++this.typed;
    this.stopSaving();
    this.saving = setTimeout(() => void this.save(n), this.saveMs);
  }

  /** "Draft one": a backstory from the concept and the build, shown to take or leave. */
  draftStory(): void {
    const c = this.creation;
    if (!c || c.busy) return;
    void this.withStory("draftBackstory", c.story);
  }

  /** "Work it in": what's in the box as a story in the player's voice, keeping everything they wrote; shown to take or leave. */
  workInStory(text = this.creation?.story ?? ""): void {
    const c = this.creation;
    if (!c || c.busy) return;
    if (!text.trim()) { this.say(refusal("nothing_to_work_in").text); return; }
    const long = tooLong(text);
    if (long) { this.say(long); return; }
    void this.withStory("workInBackstory", text);
  }

  /** The draft (or the notes worked in) taken: it's what the box has now. */
  takeProposal(): void {
    if (!this.creation?.proposal) return;
    void this.move("takeProposal", {});
  }

  /** The draft left: the box as it was. */
  leaveProposal(): void {
    if (!this.creation?.proposal) return;
    void this.move("leaveProposal", {});
  }

  /**
   * Done with the backstory: it's checked against the world's lore. What contradicts canon comes up
   * a fix at a time, to accept or rewrite; if it fits (or there's no GM to check it), into the game.
   * Nothing written is the same as skipping. Longer than the GM can be given every turn, it stays in
   * the box, with how long it is.
   */
  finishStory(text = this.creation?.story ?? ""): void {
    const c = this.creation;
    if (!c || c.busy) return;
    const long = tooLong(text);
    if (long) { this.say(long); return; }
    void this.withStory("finishBackstory", text);
  }

  /**
   * The issue on show, fixed as the check suggests (the player saw the words it changes): the next
   * one; after the last, the story with the fixes in is checked once more, then into the game.
   */
  acceptFix(): void {
    const c = this.creation, issue = c?.issues?.[c.issue];
    if (!c || !issue || c.busy) return;
    void this.move("acceptFix", {});
  }

  /** The issue on show, to rewrite themselves: back to the box with it shown over it (Done checks it again). */
  rewriteIssue(): void {
    const c = this.creation;
    if (!c?.issues?.[c.issue]) return;
    void this.move("rewriteIssue", {});
  }

  /** No backstory: straight into the game. */
  skipStory(): void {
    const c = this.creation;
    if (!c || c.busy) return;
    this.stopSaving();
    this.local.typed = undefined;
    void this.move("skipBackstory", {});
  }

  // -------------------------------------------------------------------------------------------
  // The sheet, and on.

  /** Not who they meant, from the sheet: back to the three builds (the backstory comes too), the game made from the one turned down put away. */
  async chooseAgain(): Promise<void> {
    if (await this.move("chooseAgain", {})) this.app.go("creation");
  }

  /** Set off: the game's first scene opens. */
  begin(): void {
    void this.move("begin", {});
  }

  /** To the title: a word of the model's own goes with the screen it was said on. */
  toTitle(): void {
    this.stopSaving();
    this.said = undefined;
    this.app.go("title");
  }

  // -------------------------------------------------------------------------------------------

  /** A move: true when it was made; its refusal is the simulation's word, on the note line (the model's own goes). */
  private async move<K extends MoveName>(name: K, args: Moves[K]): Promise<boolean> {
    this.said = undefined;
    return !(await this.app.act(name, args));
  }

  /** A move that carries the box's text (the module keeps it as the story): the save waiting for typing to stop isn't needed. */
  private async withStory(name: "draftBackstory" | "workInBackstory" | "finishBackstory", text: string): Promise<void> {
    this.stopSaving();
    const n = this.typed;
    if (await this.move(name, { text }) && n === this.typed) this.local.typed = undefined;
  }

  /**
   * The box's text saved (set_backstory); kept here until it is, or when it's refused (too big to
   * keep: the refusal says so). A word of the model's own stays: typing isn't a move.
   */
  private async save(n: number): Promise<void> {
    const typed = this.local.typed;
    if (!typed) return;
    if (!(await this.app.act("setBackstory", { text: typed.text })) && n === this.typed) this.local.typed = undefined;
  }

  private stopSaving(): void {
    if (this.saving) clearTimeout(this.saving);
    this.saving = undefined;
  }

  /** A word of the model's own on the note line, until the next move. */
  private say(words: string): void {
    this.said = words;
    this.app.emit();
  }
}

/**
 * The prototype's rule for a pick's subclass (src/app/game.ts:573-576): a class with a subclass at
 * this level keeps the one it had if it's the class's, else takes its first; below it, none. Without
 * the lists yet, the picks go as they are (the simulation applies the same rule).
 */
export function withSubclass(picks: OwnPicks, lists: SrdLists | undefined, level: number): OwnPicks {
  if (!lists) return picks;
  const subs = lists.subclasses[picks.classId] ?? [];
  const subclassId = level >= (lists.subclassLevel[picks.classId] ?? 3) ? (subs.some(s => s.id === picks.subclassId) ? picks.subclassId : subs[0]?.id) : undefined;
  return { speciesId: picks.speciesId, classId: picks.classId, backgroundId: picks.backgroundId, ...(subclassId ? { subclassId } : {}) };
}
