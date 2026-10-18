// New: the game's sound in the page (docs/sound-design.md): the client worker says what to play, and this plays it through the sound engine (client/sound/engine.ts) on the browser's audio thread (sound-worklet.ts, bundled as sound-worklet.js). The build bundles this as sound.js, which page.js imports.
import type { SoundMessage, Volumes } from "../../client/sound/engine.ts";
import type { Mood } from "../../client/sound/music.ts";

/**
 * The page's sound (browser-design §5's page, docs/sound-design.md):
 *
 *   - A browser plays nothing until the player has done something on the page, so the audio starts
 *     at the first key or click: until then the effects asked for go unheard, and the music waits.
 *   - The engine runs in an AudioWorklet, off the page's thread: the worker's words (a few dozen
 *     bytes each) go to it as they come, and it makes every sample itself.
 *   - The bar under the game turns the effects, the voices and the music on and off, each kept in
 *     this browser (localStorage, "kingmaker.sound"); with all three off the audio stops altogether.
 *   - A tab out of sight is quiet: the audio's suspended until it's back.
 */

const STORAGE = "kingmaker.sound";

/** What the player has on: the effects (and the menus' sounds), the voices, the music. */
export interface SoundSettings { sfx: boolean; voice: boolean; music: boolean }

const DEFAULTS: SoundSettings = { sfx: true, voice: true, music: true };

/** Each bus's volume when it's on (the engine's own balance), and off. */
const ON: Volumes = { master: 0.9, sfx: 0.8, voice: 0.75, music: 0.5 };

export interface PageSound {
  /** The client worker's words to the engine. */
  play(messages: SoundMessage[]): void;
  /** For the browser check and the curious: what's on, whether the audio runs, what it was told. */
  readonly settings: SoundSettings;
  readonly state: string;
  readonly heard: Heard;
}

/** What the client worker has asked for: how many of its words, by kind; how many went unplayed (turned off, or before the audio started); the mood it last asked for. */
interface Heard { messages: number; dropped: number; mood: Mood | null; kinds: Record<SoundMessage["type"], number> }

/** The worklet node's port, as far as this needs it. */
interface Port { postMessage(message: unknown): void }

export function pageSound(options: { version: string; controls?: HTMLElement | null; turned?: () => void }): PageSound {
  const settings = loadSettings();
  const heard: Heard = { messages: 0, dropped: 0, mood: null, kinds: { sfx: 0, blip: 0, music: 0, hush: 0, volume: 0 } };
  let context: AudioContext | undefined;
  let port: Port | undefined;
  let starting: Promise<void> | undefined;

  /** The audio, started (once, at the player's first key or click). */
  const start = () => {
    if (starting || !anyOn(settings) || typeof AudioContext !== "function") return starting;
    starting = (async () => {
      try {
        const ctx = new AudioContext({ latencyHint: "interactive" });
        await ctx.audioWorklet.addModule(new URL(`./sound-worklet.js${options.version}`, import.meta.url));
        // The volumes and the mood so far are the engine's from its first block.
        const messages: SoundMessage[] = [volumeMessage(settings), ...(settings.music && heard.mood ? [{ type: "music" as const, mood: heard.mood }] : [])];
        const node = new AudioWorkletNode(ctx, "kingmaker-sound", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { messages } });
        node.connect(ctx.destination);
        context = ctx;
        port = node.port;
        if (document.hidden) void ctx.suspend();
      } catch (error) {
        console.warn("No sound: the page's audio couldn't start.", error);
      }
    })();
    return starting;
  };
  for (const event of ["pointerdown", "keydown"]) window.addEventListener(event, () => void start(), { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (!context) return;
    if (document.hidden) void context.suspend();
    else if (anyOn(settings)) void context.resume();
  });

  /** A setting turned over: kept, told to the engine (the music started or stopped with it), the audio stopped when there's nothing on. */
  const turn = (which: keyof SoundSettings) => {
    settings[which] = !settings[which];
    saveSettings(settings);
    drawControls();
    if (!anyOn(settings)) { void context?.suspend(); return; }
    if (!starting) { void start(); return; }
    if (context && !document.hidden) void context.resume();
    port?.postMessage([volumeMessage(settings), ...(which === "music" ? [{ type: "music", mood: settings.music ? heard.mood : null }] : [])]);
  };

  const controls = options.controls;
  const drawControls = () => {
    for (const button of controls?.querySelectorAll<HTMLButtonElement>("[data-sound]") ?? []) {
      const which = button.dataset.sound as keyof SoundSettings;
      button.setAttribute("aria-pressed", String(settings[which]));
      button.title = `${settings[which] ? "Turn off" : "Turn on"} ${{ sfx: "the sound effects", voice: "the voices", music: "the music" }[which]}`;
    }
  };
  // A switch clicked turns its setting over, and the keys go back to the game (`turned`), not to the switch.
  for (const button of controls?.querySelectorAll<HTMLButtonElement>("[data-sound]") ?? []) button.addEventListener("click", () => { turn(button.dataset.sound as keyof SoundSettings); options.turned?.(); });
  drawControls();

  return {
    play(messages) {
      heard.messages += messages.length;
      for (const m of messages) heard.kinds[m.type]++;
      const kept = messages.filter(m => {
        if (m.type === "music") { heard.mood = m.mood; return settings.music; }
        if (m.type === "sfx") return settings.sfx;
        if (m.type === "blip") return settings.voice;
        return true;
      });
      heard.dropped += messages.length - kept.length;
      if (kept.length && port) port.postMessage(kept);
      else if (!port) heard.dropped += kept.filter(m => m.type !== "music").length;
    },
    settings,
    get state() { return context?.state ?? (starting ? "starting" : "waiting for a key or a click"); },
    heard,
  };
}

const anyOn = (s: SoundSettings) => s.sfx || s.voice || s.music;

/** The engine's volumes for the settings: each bus on at its own level, or off. */
function volumeMessage(s: SoundSettings): SoundMessage {
  return { type: "volume", volumes: { master: ON.master, sfx: s.sfx ? ON.sfx : 0, voice: s.voice ? ON.voice : 0, music: s.music ? ON.music : 0 } };
}

function loadSettings(): SoundSettings {
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE) ?? "{}") as Partial<SoundSettings>;
    return { sfx: kept.sfx ?? DEFAULTS.sfx, voice: kept.voice ?? DEFAULTS.voice, music: kept.music ?? DEFAULTS.music };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: SoundSettings): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(s)); } catch { /* not kept: it holds for this page */ }
}
