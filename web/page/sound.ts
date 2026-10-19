// New: the game's sound in the page (docs/sound-design.md): the client worker says what to play, and this plays it through the sound engine (client/sound/engine.ts) on the browser's audio thread (sound-worklet.ts, bundled as sound-worklet.js). The build bundles this as sound.js, which page.js imports.
import type { SoundMessage } from "../../client/sound/engine.ts";
import type { Mood } from "../../client/sound/music.ts";
import { MOST_MASTER, VOLUMES } from "../../client/sound/volumes.ts";

/**
 * The page's sound (browser-design §5's page, docs/sound-design.md):
 *
 *   - A browser plays nothing until the player has done something on the page, so the audio starts
 *     at the first key or click: until then the effects asked for go unheard, and the music waits.
 *   - The engine runs in an AudioWorklet, off the page's thread: the worker's words (a few dozen
 *     bytes each) go to it as they come, and it makes every sample itself.
 *   - The bar under the game turns the effects, the voices and the music on and off, and sets the
 *     volume (up to half again over the game's own level), each kept in this browser (localStorage,
 *     "kingmaker.sound"); with all three off, or the volume at nothing, the audio stops altogether.
 *   - A tab out of sight is quiet: the audio's suspended until it's back.
 */

const STORAGE = "kingmaker.sound";

/** What the player has on: the effects (and the menus' sounds), the voices, the music; and the volume of all of them (1 the game's own level). */
export interface SoundSettings { sfx: boolean; voice: boolean; music: boolean; volume: number }

const DEFAULTS: SoundSettings = { sfx: true, voice: true, music: true, volume: 1 };

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
  const heard: Heard = { messages: 0, dropped: 0, mood: null, kinds: { sfx: 0, blip: 0, music: 0, 'tune-update': 0, hush: 0, volume: 0 } };
  let music: Extract<SoundMessage, { type: "music" }> = { type: "music", mood: null };
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
        const messages: SoundMessage[] = [volumeMessage(settings), ...(settings.music && heard.mood ? [music] : [])];
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

  /**
   * The settings changed (a switch turned over, the volume moved): kept, and told to the engine with
   * `more` (the music started or stopped with its switch); the audio stopped when nothing's to be heard.
   */
  const changed = (more: SoundMessage[] = []) => {
    saveSettings(settings);
    drawControls();
    if (!anyOn(settings)) { void context?.suspend(); return; }
    if (!starting) { void start(); return; }
    if (context && !document.hidden) void context.resume();
    port?.postMessage([volumeMessage(settings), ...more]);
  };
  const turn = (which: Switch) => {
    settings[which] = !settings[which];
    changed(which === "music" ? [settings.music ? music : { type: "music", mood: null }] : []);
  };
  const setVolume = (volume: number) => {
    settings.volume = Math.max(0, Math.min(MOST_MASTER, volume));
    changed();
  };

  const controls = options.controls;
  const slider = controls?.querySelector<HTMLInputElement>("[data-volume]");
  const drawControls = () => {
    for (const button of controls?.querySelectorAll<HTMLButtonElement>("[data-sound]") ?? []) {
      const which = button.dataset.sound as Switch;
      button.setAttribute("aria-pressed", String(settings[which]));
      button.title = `${settings[which] ? "Turn off" : "Turn on"} ${{ sfx: "the sound effects", voice: "the voices", music: "the music" }[which]}`;
    }
    if (slider) {
      slider.value = String(Math.round(settings.volume * 100));
      slider.title = `Volume: ${Math.round(settings.volume * 100)}%`;
    }
  };
  // A switch clicked turns its setting over, and the keys go back to the game (`turned`), not to the switch.
  for (const button of controls?.querySelectorAll<HTMLButtonElement>("[data-sound]") ?? []) button.addEventListener("click", () => { turn(button.dataset.sound as Switch); options.turned?.(); });
  // The volume, as it's dragged; let go of, the keys go back to the game.
  if (slider) {
    slider.max = String(MOST_MASTER * 100);
    slider.addEventListener("input", () => setVolume(Number(slider.value) / 100));
    slider.addEventListener("change", () => options.turned?.());
  }
  drawControls();

  return {
    play(messages) {
      heard.messages += messages.length;
      for (const m of messages) heard.kinds[m.type]++;
      const kept = messages.filter(m => {
        if (m.type === "music") { heard.mood = m.mood; music = m; return settings.music; }
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

/** The settings that are switches. */
type Switch = "sfx" | "voice" | "music";

const anyOn = (s: SoundSettings) => (s.sfx || s.voice || s.music) && s.volume > 0;

/** The engine's volumes for the settings: each bus on at its own level, or off; all of them at the volume. */
function volumeMessage(s: SoundSettings): SoundMessage {
  return { type: "volume", volumes: { master: VOLUMES.master * s.volume, sfx: s.sfx ? VOLUMES.sfx : 0, voice: s.voice ? VOLUMES.voice : 0, music: s.music ? VOLUMES.music : 0 } };
}

function loadSettings(): SoundSettings {
  try {
    const kept = JSON.parse(localStorage.getItem(STORAGE) ?? "{}") as Partial<SoundSettings>;
    const volume = typeof kept.volume === "number" && Number.isFinite(kept.volume) ? Math.max(0, Math.min(MOST_MASTER, kept.volume)) : DEFAULTS.volume;
    return { sfx: kept.sfx ?? DEFAULTS.sfx, voice: kept.voice ?? DEFAULTS.voice, music: kept.music ?? DEFAULTS.music, volume };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: SoundSettings): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(s)); } catch { /* not kept: it holds for this page */ }
}
