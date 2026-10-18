// New: how each person sounds when they talk (docs/sound-design.md): Undertale's way, a blip a syllable in a voice of their own. A voice is worked out from what the client knows of them (what they are, their size, what's said of them) and their key, so anyone the story brings in has one without anyone choosing it; and a person keeps the voice they were first heard in for the rest of the game.
import { hashOf } from "./dsp.ts";
import type { Voice } from "./patches.ts";

/** The GM's narration: soft, low and quick, a typewriter's tick under the words. */
export const NARRATOR: Voice = { pitch: 330, wave: "triangle", range: 1.5, length: 26, bright: 0.25, gain: 0.11, every: 3 };

/** The player's character, when the GM has them say something. */
export const PLAYER: Voice = { pitch: 262, wave: "pulse", duty: 0.25, range: 4, length: 36, bright: 0.45, gain: 0.06 };

/** People's voices, low to high: a person's is one of these, moved a little by their key. */
const REGISTERS: Voice[] = [
  { pitch: 110, wave: "square", range: 3, length: 52, bright: 0.25, gain: 0.08 },
  { pitch: 124, wave: "pulse", duty: 0.3, range: 3, length: 48, bright: 0.3, gain: 0.08 },
  { pitch: 139, wave: "square", range: 4, length: 44, bright: 0.35, gain: 0.075 },
  { pitch: 165, wave: "pulse", duty: 0.25, range: 4, length: 42, bright: 0.4, gain: 0.07 },
  { pitch: 196, wave: "saw", range: 4, length: 40, bright: 0.3, gain: 0.06 },
  { pitch: 233, wave: "square", range: 5, length: 38, bright: 0.4, gain: 0.065 },
  { pitch: 277, wave: "pulse", duty: 0.25, range: 5, length: 36, bright: 0.45, gain: 0.065 },
  { pitch: 330, wave: "triangle", range: 6, length: 36, bright: 0.6, gain: 0.1 },
  { pitch: 392, wave: "pulse", duty: 0.125, range: 6, length: 34, bright: 0.5, gain: 0.06 },
  { pitch: 466, wave: "triangle", range: 7, length: 32, bright: 0.6, gain: 0.1 },
];

/** What a voice is worked out from: the speaker's key, and whatever the client knows of them. */
export interface Speaker {
  key: string;
  name?: string | undefined;
  /** What the world says they are (a person, a creature), their size, their tags, and its description of them. */
  kind?: string | undefined;
  size?: string | undefined;
  tags?: string[] | undefined;
  description?: string | undefined;
  /** What the player calls them, before they've heard a name ("the boy in the too-big boots"). */
  called?: string | undefined;
}

const has = (words: string, pattern: RegExp) => pattern.test(words);

/**
 * A speaker's voice. A creature sounds like one (a dog's growl, a bird's chirp); a person is given a
 * register by what's said of them (a child's is higher, a big one's lower, and the words for a
 * woman or a man lean it up or down), then their own pitch within it by their key.
 */
export function voiceOf(who: Speaker): Voice {
  const words = ` ${[who.description, who.called, who.name, ...(who.tags ?? [])].filter(Boolean).join(" ").toLowerCase()} `;
  const h = hashOf(who.key);
  const wobble = ((h >>> 8) % 100) / 100 - 0.5;
  if (has(words, /\b(dog|hound|wolf|mastiff|cur|jackal)s?\b/)) return { pitch: 180 + (h % 60), wave: "saw", range: 3, length: 70, bright: 0.3, gain: 0.05, rough: 0.6 };
  if (has(words, /\b(bird|crow|raven|gull|magpie|rook|pigeon|owl)s?\b/)) return { pitch: 1300 + (h % 400), wave: "sine", range: 7, length: 28, bright: 0.8, gain: 0.07 };
  if (has(words, /\b(rat|mouse|mice)s?\b/)) return { pitch: 1600 + (h % 300), wave: "pulse", duty: 0.125, range: 5, length: 22, bright: 0.7, gain: 0.045 };
  if (has(words, /\b(horse|ox|bull|cow|mule|bear)s?\b/)) return { pitch: 100 + (h % 30), wave: "saw", range: 4, length: 90, bright: 0.25, gain: 0.05, rough: 0.4 };
  if (has(words, /\b(cat|cats)\b/)) return { pitch: 600 + (h % 200), wave: "triangle", range: 8, length: 60, bright: 0.6, gain: 0.08 };
  const she = has(words, /\b(she|her|hers|woman|women|girl|lady|mother|widow|wife|daughter|sister|madam|dame|mistress|goodwife|queen|matron|lass)\b/);
  const he = has(words, /\b(he|him|his|man|men|boy|lord|father|husband|son|brother|mister|sir|goodman|king|lad)\b/);
  const [low, high] = she && !he ? [4, 9] : he && !she ? [0, 5] : [1, 8];
  const base = REGISTERS[low + (h % (high - low + 1))]!;
  const young = has(words, /\b(boy|girl|child|children|kid|lad|lass|urchin|youngster|young|small boy|little)\b/);
  const old = has(words, /\b(old|elderly|aged|grey-haired|white-haired|ancient|wizened|seventies|eighties)\b/);
  const size = who.size ?? "";
  const shift = (young ? 5 : 0) + (old ? -1.5 : 0) + ({ tiny: 7, small: 3, large: -3, huge: -6, gargantuan: -9 }[size] ?? 0) + wobble;
  return {
    ...base,
    pitch: base.pitch * 2 ** (shift / 12),
    length: Math.round(base.length * (young ? 0.85 : old ? 1.15 : 1)),
    range: base.range * (old ? 0.7 : 1),
  };
}

/**
 * The voices people have been heard in, by key: someone keeps theirs all game, though what the client
 * knows of them changes from scene to scene (a talk between scenes knows less than a scene's place).
 */
export class Voices {
  private readonly heard = new Map<string, Voice>();

  /** Their voice: the one they were first heard in, else worked out now from `who`. */
  of(who: Speaker): Voice {
    let voice = this.heard.get(who.key);
    if (!voice) {
      voice = voiceOf(who);
      this.heard.set(who.key, voice);
    }
    return voice;
  }

  forget(): void { this.heard.clear(); }
}

/** The game's voices: the scene's, its talks' and the moments between scenes' alike, so each person sounds the same in all of them. */
export const VOICES = new Voices();
