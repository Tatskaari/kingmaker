// New: talk as it's heard (docs/sound-design.md): words as they come on screen (a reply streaming in, a line of a talk) said in blips, Undertale's way: one at the start of each word and every other letter after it (the narrator's every third, softer), a breath at a comma, a pause at a sentence's end, each letter in the voice of whoever's saying it. It keeps up with the words: never more than a moment behind them, it begins what comes all at once and, as words stream in faster than they can be said, says the newest.
import { blip, hush } from "./cues.ts";
import type { Voice } from "./patches.ts";

/** How long a letter takes to say (ms), a gap between words, a breath at a comma, a pause at a sentence's end. */
const LETTER = 32;
const SPACE = 22;
const COMMA = 120;
const STOP = 240;
/** How far behind the words the talk may fall (ms): past it, what's still to say goes, and the newest words are said. */
const LAG = 900;

/** Where blips go (the engine's, by default; a test's own). */
export type Say = (voice: Voice, letter: string, delay: number, group: string) => void;

export class Talker {
  readonly group: string;
  private readonly now: () => number;
  private readonly say: Say;
  /** When what's been given to say will have been said (the clock's ms). */
  private until = 0;

  constructor(group = "talk", now: () => number = () => performance.now(), say: Say = blip) {
    this.group = group;
    this.now = now;
    this.say = say;
  }

  /**
   * Words come on screen: `text` from `from` (what was there before has been given already), each
   * letter in the voice `voiceAt` gives it (none: unsaid). With nothing being said, from their start,
   * as much as the lag allows (a whole reply come at once is begun, not said through); while the last
   * words are still being said, after them, from as far on as leaves room: the newest words, where
   * the eye is as they stream in.
   */
  speak(text: string, voiceAt: (i: number) => Voice | undefined, from = 0): void {
    const now = this.now();
    if (this.until - now > LAG) this.quiet();
    const behind = Math.max(0, this.until - now);
    let start = Math.max(0, from);
    if (behind > 0) {
      while (cost(text, start) > LAG - behind) {
        const next = text.slice(start).search(/\s\S/);
        if (next < 0) { start = text.length; break; }
        start += next + 1;
      }
    }
    let t = now + behind;
    let letter = 0;
    for (let i = start; i < text.length; i++) {
      if (t - now > LAG) break;
      const ch = text[i]!;
      if (isLetter(ch)) {
        const voice = voiceAt(i);
        if (voice && letter % (voice.every ?? 2) === 0) this.say(voice, ch, t - now, this.group);
        letter++;
        t += LETTER;
      } else {
        letter = 0;
        t += pause(ch);
      }
    }
    this.until = t;
  }

  /** Nothing more said: what's still to come doesn't (the player spoke, the scene changed). */
  quiet(): void {
    if (this.until > this.now()) hush(this.group);
    this.until = 0;
  }
}

const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

function pause(ch: string): number {
  if (/[.!?…]/.test(ch)) return STOP;
  if (/[,;:—–]/.test(ch)) return COMMA;
  return /\s/.test(ch) ? SPACE : 0;
}

/** How long `text` from `from` takes to say (ms). */
function cost(text: string, from: number): number {
  let ms = 0;
  for (let i = from; i < text.length; i++) ms += isLetter(text[i]!) ? LETTER : pause(text[i]!);
  return ms;
}
