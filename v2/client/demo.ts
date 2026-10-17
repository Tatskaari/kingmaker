import type { Mark, Markup } from "../shared/markup.ts";
import { refusal } from "../shared/protocol/refusals.ts";
import type { Backend, Rejection } from "./backend.ts";
import { YARD } from "./check/fixture.ts";
import type { Entry, SceneView, Suggestion } from "./scene/view.ts";

/**
 * The game with no server (--demo): the granary yard a few turns in, where each line said plays a
 * canned turn through the phases the rows would give it (deciding, the reply growing in its draft
 * a word at a time with Kell's line in her colour, settling, noting while the GM writes the notes,
 * done once they're in, a mark with its card on the reply), and four lines suggested a moment
 * after, so the screen and the headless client can be tried offline. A line said before the last
 * turn is done waits, queued, as the simulation holds it; a line while the GM has the floor is
 * refused as the simulation would refuse it. /suggestions turns the lines off, and on (asked for at
 * once). A new game is the yard's opening under the new name; joining one watches Pell Marrow's.
 * `ms` paces it.
 */
export function demoBackend(options: { ms?: number } = {}): Backend {
  const ms = options.ms ?? 40;
  let view: SceneView = { ...YARD, entries: [...YARD.entries], suggestions: [...LINES] };
  /** The latest turn's n: a turn's late news (its notes, its lines) is only the view's while it's still the latest. */
  let latest = view.turn ?? 0;
  /** The turn being played, until it's done: a line said meanwhile waits for it. */
  let playing: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const set = (patch: Partial<SceneView>, drop: Array<"refusal" | "draft" | "watching"> = []) => {
    view = { ...view, ...patch };
    for (const key of drop) delete view[key];
    for (const listener of listeners) listener();
  };
  const sleep = (n: number) => new Promise<void>(resolve => { const t = setTimeout(() => { timers.delete(t); resolve(); }, n); timers.add(t); });

  /** A turn as the rows would play it, from the line said to its notes in; its lines come after, on their own. */
  async function play(text: string, behind: Promise<void> | undefined): Promise<void> {
    const turn = ++latest;
    const said: Entry = { turn, speaker: "player:1", kind: "player", name: view.player.name, text };
    // The last set goes at once; its rows are kept for the next while it comes.
    set({ entries: [...view.entries, said], phase: behind ? "queued" : "deciding", turn, mayType: false, suggestions: [], suggestionsComing: view.suggestionsOn, notesComing: false }, ["refusal"]);
    if (behind) { await behind; set({ phase: "deciding" }); }
    await sleep(ms * 15);

    const words = REPLY.split(/(?<= )/);
    for (let seq = 1; seq <= words.length; seq++) {
      const sofar = words.slice(0, seq).join("");
      set({ phase: "replying", draft: { speaker: "gm", kind: "narration", text: sofar, markup: kellIn(sofar), attempt: 1, seq } });
      await sleep(ms);
    }

    // The reply final: the box opens, the world settles and the notes are written behind it, and the lines are asked for.
    const reply: Entry = { turn, speaker: "gm", kind: "narration", text: REPLY, markup: kellIn(REPLY) };
    set({ entries: [...view.entries, reply], phase: "settling", mayType: true, notesComing: true }, ["draft"]);
    if (view.suggestionsOn) ask(turn, ms * 70);
    await sleep(ms * 25);
    if (latest === turn) set({ phase: "noting" });
    await sleep(ms * 25);
    // The notes: the reply's marks, each with its card; the turn done.
    set({ entries: view.entries.map(e => (e === reply ? { ...e, markup: notedIn(REPLY, turn) } : e)), ...(latest === turn ? { phase: "done" as const, notesComing: false } : {}) });
  }

  /** The lines for a turn, `after` ms from now: dropped when the player has moved on, or turned them off, meanwhile. */
  function ask(turn: number, after: number): void {
    const t = setTimeout(() => {
      timers.delete(t);
      if (latest === turn) set({ suggestions: view.suggestionsOn ? [...LINES] : [], suggestionsComing: false });
    }, after);
    timers.add(t);
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
      latest = 0;
      set({ game: String(Number(view.game) + 1), player: { name: args.name }, entries: YARD.entries.slice(0, 1), phase: "done", turn: 0, mayType: true, suggestions: view.suggestionsOn ? [...LINES] : [], suggestionsComing: false, notesComing: false }, ["refusal", "watching"]);
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
      // While the last turn settles or its notes are written, the line waits for it.
      playing = play(text.trim(), view.phase === "done" ? undefined : playing);
      return Promise.resolve(undefined);
    },
    retry: () => refuse(refusal("not_failed")),
    setSuggestions(on) {
      if (!on) set({ suggestionsOn: false, suggestions: [], suggestionsComing: false });
      else if (view.suggestionsOn || view.watching) set({ suggestionsOn: true });
      else {
        // Turned on: this moment's lines, asked for at once once its reply is in (a reply on its way brings its own).
        set({ suggestionsOn: true, suggestionsComing: true });
        if (["settling", "noting", "done"].includes(view.phase)) ask(latest, ms * 20);
      }
      return Promise.resolve(undefined);
    },
    close() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
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
