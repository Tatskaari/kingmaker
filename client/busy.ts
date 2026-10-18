// Copied from the prototype's src/app/game.ts:257-297 at 44c6d4a (GM_BUSY, BusyLines), unchanged; its CONSIDERING went with considered rolls (docs/migration-log.md, M2's "The old pipeline's salvage").
/**
 * What the GM says it's doing while it has the floor (the prototype's src/app/game.ts GM_BUSY and
 * BusyLines): the spinner's lines, dealt like cards, a new one each turn.
 */

/** What the GM is up to while they have the floor: the spinner's lines, dry and varied (each fits 80 columns). */
export const GM_BUSY = [
  "The GM is thinking…", "The GM consults their notes…", "The GM rolls something behind the screen and won't say what…", "The GM is doing the voices…",
  "The GM looks up the rules, then decides against them…", "The GM pretends this was the plan all along…", "The GM consults a table that may not exist…",
  "The GM weighs what it would cost them to say yes…", "The GM imagines several ways this goes wrong…", "The GM imagines one way this goes right…",
  "The GM drafts the consequences in pencil…", "The GM sharpens a DC…", "The GM asks what everyone here actually wants…",
  "The GM counts the exits, and who's nearest them…", "The GM has a quiet word with the dice…", "The GM rereads your character sheet, suspiciously…",
  "The GM hums, which is rarely good news…", "The GM stacks the dice into a small, thoughtful tower…", "The GM decides how much trouble you're in…",
  "The GM works out who'd be first to run…", "The GM leafs through the prep for a page that isn't there…", "The GM consults the book of consequences…",
  "The GM asks the world what it would do about that…", "The GM writes something down and underlines it twice…", "The GM looks at you over the screen for a long moment…",
];
/**
 * The spinner's lines, dealt like cards: each line once, in a shuffled order, then a fresh deal;
 * never the same line twice running (a deal doesn't start with the line on screen).
 */
export class BusyLines {
  private deck: string[] = [];
  private readonly lines: readonly string[];
  private readonly random: () => number;
  constructor(lines: readonly string[] = GM_BUSY, random: () => number = Math.random) {
    this.lines = lines;
    this.random = random;
  }
  /** The next line, other than `showing` (the line on screen now). */
  next(showing?: string): string {
    for (let deal = 0; deal < 2; deal++) {
      if (!this.deck.length) {
        this.deck = [...this.lines];
        for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [this.deck[i], this.deck[j]] = [this.deck[j]!, this.deck[i]!]; }
      }
      const at = this.deck.findIndex(l => l !== showing);
      if (at >= 0) return this.deck.splice(at, 1)[0]!;
      // Only the line on screen is left in this deal: deal afresh.
      this.deck = [];
    }
    return showing ?? this.lines[0] ?? "…";
  }
}
