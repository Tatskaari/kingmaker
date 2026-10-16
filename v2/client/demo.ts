import type { Markup } from "../shared/markup.ts";
import { refusal } from "../shared/protocol/refusals.ts";
import type { Backend, Rejection } from "./backend.ts";
import { YARD } from "./check/fixture.ts";
import type { Entry, SceneView } from "./scene/view.ts";

/**
 * The game with no server (--demo): the granary yard a few turns in, where each line said plays a
 * canned turn through the phases the rows would give it (deciding, the reply growing in its draft
 * a word at a time, settling, done), so the screen and the headless client can be tried offline.
 * A line while the GM has the floor is refused as the simulation would refuse it. A new game is
 * the yard's opening under the new name; joining one watches Pell Marrow's. `ms` paces it.
 */
export function demoBackend(options: { ms?: number } = {}): Backend {
  const ms = options.ms ?? 40;
  let view: SceneView = { ...YARD, entries: [...YARD.entries] };
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const set = (patch: Partial<SceneView>, drop: Array<"refusal" | "draft" | "watching"> = []) => {
    view = { ...view, ...patch };
    for (const key of drop) delete view[key];
    for (const listener of listeners) listener();
  };
  const sleep = (n: number) => new Promise<void>(resolve => { const t = setTimeout(() => { timers.delete(t); resolve(); }, n); timers.add(t); });

  /** A turn as the rows would play it, from the line said to the world settled. */
  async function play(text: string): Promise<void> {
    const turn = (view.entries.at(-1)?.turn ?? 0) + 1;
    const said: Entry = { turn, speaker: "player:1", kind: "player", name: view.player.name, text };
    set({ entries: [...view.entries, said], phase: "deciding", turn, mayType: false }, ["refusal"]);
    await sleep(ms * 15);

    const words = REPLY.split(/(?<= )/);
    for (let seq = 1; seq <= words.length; seq++) {
      const sofar = words.slice(0, seq).join("");
      set({ phase: "replying", draft: { speaker: "gm", kind: "narration", text: sofar, markup: kellIn(sofar), attempt: 1, seq } });
      await sleep(ms);
    }

    set({ entries: [...view.entries, { turn, speaker: "gm", kind: "narration", text: REPLY, markup: kellIn(REPLY) }], phase: "settling", mayType: true }, ["draft"]);
    await sleep(ms * 25);
    set({ phase: "done" });
  }

  /** The simulation's word on a move it won't make, kept for the status line. */
  const refuse = (why: Rejection) => { set({ refusal: why.text }); return Promise.resolve(why); };

  return {
    view: () => view,
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    newGame(args) {
      set({ game: String(Number(view.game) + 1), player: { name: args.name }, entries: YARD.entries.slice(0, 1), phase: "done", turn: 0, mayType: true }, ["refusal", "watching"]);
      return Promise.resolve(undefined);
    },
    joinGame(game) {
      set({ ...YARD, game: String(game), watching: YARD.player.name, mayType: false });
      return Promise.resolve(undefined);
    },
    say(text) {
      if (view.watching) return refuse(refusal("not_controller", { name: view.watching }));
      if (!text.trim()) return refuse(refusal("empty_line"));
      if (!view.mayType) return refuse(refusal("turn_in_flight"));
      void play(text.trim());
      return Promise.resolve(undefined);
    },
    retry: () => refuse(refusal("not_failed")),
    close() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
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
