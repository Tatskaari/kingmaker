// The prototype's src/runtime/markup.ts:623-635 (markupLines, with each mark's card under it) and src/game/play.ts:547-553 (render) at 44c6d4a, reading names from the view; src/cli/qa.ts:94-97 (the actions, as actionLines, with the way back to the map once a scene on one is over: map-design §3.3); viewText and phaseLine are new.
import type { Mark, MarkLink, Markup } from "../../shared/markup.ts";
import { isPlayer, type Entry, type SceneView } from "./view.ts";

/**
 * The scene as text, for the headless client (an agent plays through it) and the logs: the last few
 * entries, a GM reply's markup under it (who says what, each marked phrase's note and card), the
 * lines suggested for this moment (say_1…, as the agent picks them), the phase and whether the
 * player may speak. The prototype's QA console printed the same way (src/game/play.ts
 * render, src/runtime/markup.ts markupLines), from the core; this prints from the same view model the
 * screen draws, so the agent sees what the player sees.
 */

/**
 * A reply's markup in words: who says each line, then each marked phrase with its note and what
 * it's linked to, and under it the card its popover shows (what the player knows of that), when it
 * has one to show.
 */
export function markupLines(text: string, markup: Markup, name: (id: string) => string | undefined): string[] {
  const clip = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…”` : s);
  // A tag that's no one here is someone the GM brought in ("the porter"), not someone away.
  const who = markup.speech.map(s => `${s.speaker === "you" ? "you" : (s.speaker ? name(s.speaker) : undefined) ?? (s.tag ? `${s.tag} (not in the cast)` : "nobody can tell")} ${clip(text.slice(s.start, s.end))}`);
  const link = (l: MarkLink) => (l.kind === "deed" ? `what you did, turn ${l.turn}` : l.kind === "person" ? `who: ${name(l.id) ?? l.id}` : `lore: ${l.path.replace(/^.*\//, "").replace(/\.md$/, "")}`);
  return [
    ...(who.length ? [`  ⟨who says what: ${who.join("; ")}⟩`] : []),
    ...markup.marks.flatMap((m: Mark) => [
      `  ⟨${m.kind} on “${text.slice(m.start, m.end)}”: ${m.note}${m.link ? ` (${link(m.link)})` : ""}⟩`,
      ...(m.card?.lines.length ? [`    ⟨card: ${[m.card.title, ...m.card.lines].join(" · ")}⟩`] : []),
    ]),
  ];
}

/** Entries as text: the player's lines quoted, the dice marked, dialogue by name, a reply with its markup under it. */
export function render(view: SceneView, entries: Entry[]): string {
  const name = (id: string) => view.present.find(p => p.key === id)?.name;
  return entries.map(e => isPlayer(e.speaker) && e.kind === "player" ? `> ${e.text}` : e.kind === "roll" ? `🎲 ${e.text}` : e.kind === "system" ? `— ${e.text} —`
    : e.kind === "dialogue" ? `${e.name ?? name(e.speaker) ?? e.speaker}: ${e.text}`
    : e.markup ? [e.text, ...markupLines(e.text, e.markup, name)].join("\n") : e.text).join("\n\n");
}

/**
 * The lines suggested for this moment, as the agent picks them (act --id say_2), and once a scene
 * played on a map is over, the way back to it (act --id out): nothing when there are none.
 */
export function actionLines(view: SceneView): string[] {
  const lines = view.suggestions.map((s, i) => `- say_${i + 1}: ${s.text}`);
  if (view.over && view.onMap && !view.watching) lines.push("- out: Back to the map, where the scene left you");
  return lines.length ? ["ACTIONS:", ...lines] : [];
}

/** What the player can do now, in a line, for the agent. */
export function phaseLine(view: SceneView): string {
  if (view.over) return "PHASE: over (the scene has ended: there's nothing more to say in it)";
  if (view.failed !== undefined) return view.watching ? `PHASE: failed (${view.failed}). ${view.watching} can retry it` : `PHASE: failed (${view.failed}). Use: retry`;
  if (view.ending) return `PHASE: ${view.phase} (the scene is ending: there's nothing more to say in it)`;
  if (view.watching) return `PHASE: ${view.phase} (you're watching: ${view.watching} has the lead)`;
  if (view.mayType) return `PHASE: ${view.phase} (your turn: say what your character says or does)`;
  return `PHASE: ${view.phase} (the GM has the floor)`;
}

/**
 * The scene as the player sees it: where and when, who's here, the scene's hook (the screen heads
 * its transcript with it, and the prototype's QA console printed it first), the last `last` entries,
 * the draft, a refusal or what the turn waits on, the lines suggested, the phase.
 */
export function viewText(view: SceneView, last = 8): string {
  const here = view.present.length ? `Here: ${view.present.map(p => p.name).join(", ")}.` : "Nobody else is here.";
  const actions = actionLines(view);
  const blocks = [
    `MODE: scene`,
    `[${view.title}${view.time ? `, ${view.time.toLowerCase()}` : ""}] ${here}`,
    view.hook,
    render(view, view.entries.slice(-last)),
    view.draft ? `(${view.draft.name ?? "The GM"} is still speaking: ${view.draft.text}…)` : undefined,
    view.refusal ?? view.note,
    actions.length ? actions.join("\n") : undefined,
    phaseLine(view),
  ];
  // A block a paragraph; one with nothing in it (no entries yet: an opening that failed) leaves no gap.
  return blocks.filter(block => block).join("\n\n");
}
