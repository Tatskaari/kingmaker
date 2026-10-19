// New: what the client says to the sound engine (docs/sound-design.md): a sound effect, a blip of someone's voice, the music's mood, a hush. The host says where it goes (setSoundOut: the page's client worker sends it to the page's audio thread); until it does, nothing is made of it, so the terminal client, the headless one, the checks and the tests are as quiet as they were.
import type { SoundMessage } from "./engine.ts";
import type { Mood } from "./music.ts";
import type { Cue, Sfx, Voice } from "./patches.ts";

/** Where the client's sounds go. */
export interface SoundOut {
  send(messages: SoundMessage[]): void;
}

let out: SoundOut | undefined;
let queue: SoundMessage[] = [];
let queued = false;
/** The screen's music request, including context that may change without a change of mood. */
export type MusicContext = Pick<Extract<SoundMessage, { type: "music" }>, "track" | "scene" | "map" | "slot">;
let screenMusic: ({ mood: Mood | null } & MusicContext) | undefined;
/** A mood the sound board is playing, over whatever the screen would have (undefined: none). */
let held: Mood | null | undefined;
/** When the menus last moved and chose (performance.now()'s ms): a move a few ms after another is one tick, and a menu closing as it chooses is the choice's. */
let moved = -Infinity;
let chose = -Infinity;

/** Where the client's sounds go from now on (none: they go nowhere). */
export function setSoundOut(next: SoundOut | undefined): void {
  out = next;
  screenMusic = undefined;
  held = undefined;
}

/** Whether anything hears them. */
export const soundOn = (): boolean => !!out;

/** A message to the engine: sent with the others of this turn of the event loop, as one. */
function send(message: SoundMessage): void {
  if (!out) return;
  queue.push(message);
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const messages = queue;
    queue = [];
    out?.send(messages);
  });
}

/** When, and which sounds it's with: `delay` ms from now, `group` for a hush to stop. */
export interface When { delay?: number; group?: string }

/** A sound effect. */
export function sfx(name: Sfx, more: Omit<Cue, "sfx"> = {}, when: When = {}): void {
  send({ type: "sfx", cue: { sfx: name, ...more }, ...(when.delay ? { delay: Math.max(0, when.delay) } : {}), ...(when.group ? { group: when.group } : {}) });
}

/** The menus' sounds: a tick as the pick moves, a chime as one's chosen, a step back, a menu opening or closing, a refusal, a line sent, a page turned; and walking into a wall. */
export type Ui = "move" | "choose" | "back" | "open" | "close" | "denied" | "send" | "page" | "bump";

/** A menu's sound: moves within 30 ms of each other are one tick, and a menu closing as something's chosen in it says only the choice. */
export function ui(what: Ui): void {
  if (!out) return;
  const now = performance.now();
  if (what === "move") {
    if (now - moved < 30) return;
    moved = now;
  }
  if (what === "choose") chose = now;
  if ((what === "close" || what === "back") && now - chose < 150) return;
  sfx(`ui.${what}`);
}

/** One blip of someone's talk, `delay` ms from now. */
export function blip(voice: Voice, letter: string, delay: number, group?: string): void {
  send({ type: "blip", voice, letter, ...(delay > 0 ? { delay } : {}), ...(group ? { group } : {}) });
}

/** The screen's music (none: quiet). Context changes can choose another tune with the same mood. */
export function music(next: Mood | null, context: MusicContext = {}): void {
  if (!out) return;
  const request = { mood: next, ...context };
  if (screenMusic && screenMusic.mood === request.mood && screenMusic.track === request.track
    && screenMusic.scene === request.scene && screenMusic.map === request.map && screenMusic.slot === request.slot) return;
  screenMusic = request;
  if (held === undefined) send({ type: "music", ...request });
}

/** The sound board plays a mood (none: quiet) whatever the screen's; undefined lets go, back to the screen's. */
export function audition(next: Mood | null | undefined): void {
  if (!out || next === held) return;
  held = next;
  send({ type: "music", ...(next === undefined ? screenMusic ?? { mood: null } : { mood: next }) });
}

/** A group's sounds stopped: what's playing fades, what's still to come doesn't. */
export function hush(group: string): void {
  send({ type: "hush", group });
}
