// New, with the prototype's src/app/ui/scene.tsx:230-243 (onward, as wayOnOf over the rows' story; a talk's, game.ts:1673-1675, straight back to the map), src/app/game.ts:1746-1777 (leadCard, as betweenOf: no map, so no way), src/app/ui/overlay.tsx:242-252 (the notebook's entries and how things stood, as notebook) and src/app/story.ts:60-77 (epilogue, as epilogueOf over rows) at 44c6d4a.
import type { Line, SceneView } from "../scene/view.ts";
import { STANDIN, talkBetween, TIME_WORDS } from "./words.ts";

/**
 * The story around a scene, as the client draws it between scenes (story-design §4.5): where the
 * story goes once a scene is over (the way on), the moment between scenes (Kell's talk, or the
 * card), the fight's stand-in, the notebook and the quests, and The End. Pure: the story's view is
 * made from the game's rows (story/rows.ts), and these read it beside the scene on screen.
 */

/** The story as the game's rows have it: the boundary in flight, the lead, who walks with the player, the notebook, the quests, what it's cost. */
export interface StoryView {
  /** The game's time of day now: a boundary moves it on to the next scene's. */
  time: string;
  /** The story is over (the last scene's ending went nowhere): The End. */
  ended: boolean;
  /**
   * A boundary in flight (game.onward): moving; waiting (the AI service lost, and asked again: the
   * note says why); failed (carry_on tries it again: the note says why). None once it has moved on.
   */
  onward?: "moving" | "waiting" | "failed";
  note?: string;
  /** The lead: the scene the story goes to next, waiting to be opened (its key and title), and what the boundary said of it. */
  lead?: { key: string; title: string; text?: string };
  /** Who walks with the scene's lead between scenes (follower rows): Kell, once the yard is done. */
  with: Array<{ key: string; name: string }>;
  /** The investigator's notebook: each scene played, oldest first, then the one being played once it has a line. */
  notebook: NotebookEntry[];
  /** The story's quests, in the order they began. */
  quests: QuestLine[];
  flags: Array<{ name: string; value: string }>;
  /** How the cast stand towards the scene's lead, by name. */
  attitudes: Array<{ who: string; attitude: string; reason: string }>;
  /** What the GM has cost the game so far, in dollars: every turn's model calls, and every boundary's. */
  spentUsd: number;
}

/** A scene in the notebook: its title, how it ended, its lines, and how things stood after it. */
export interface NotebookEntry {
  /** The scene's id (its row's). */
  sceneId: string;
  title: string;
  /** Its exit's title; "A fight" for a scene still being played whose fight is on the record (the prototype's word for it). */
  ending: string;
  lines: string[];
  /** How things stood once the story moved on: the hand-off after its first line, when it has more. */
  stood?: string;
  /** The scene is over: it's a chapter of the story (The End lists them). */
  chapter: boolean;
}

export interface QuestLine { key: string; title: string; status: string; stage?: string; notes: string[] }

/** Where Enter goes from a scene that's over, in words, and whether it can go yet (the prototype's onward). */
export interface WayOn {
  /** The box's title: how the scene ended, or "Roll for initiative!" when a fight is next. */
  title: string;
  go: string;
  /** Enter goes now; before, it waits (queued), and goes as soon as the story has moved on. */
  ready: boolean;
  /**
   * What Enter does: waits (the story still moving on, or someone else has the lead); carries the
   * story on (it got stuck); the moment between scenes; the next scene, on screen (a summons, or
   * the lead taken by whoever has it); the fight; The End; from a talk, back to the map (walk out).
   */
  to: "wait" | "carry_on" | "between" | "next" | "fight" | "end" | "map";
  /** Drawn in the fight's red. */
  fight?: boolean;
}

/** How the scene on screen ended: its last "Scene ends" line's title. */
export function endingOf(view: Pick<SceneView, "entries">): string | undefined {
  for (let i = view.entries.length - 1; i >= 0; i--) {
    const e = view.entries[i]!;
    const ending = e.kind === "system" ? /^Scene ends: (.+)$/.exec(e.text)?.[1] : undefined;
    if (ending) return ending;
  }
  return undefined;
}

/**
 * The way on from the scene on screen, once it's over or its fight is next (the prototype's
 * onward, scene.tsx:231-243): the next scene that has come for the player (`next`: a summons, or
 * the lead taken by whoever has it); the fight; the story still moving on (or waiting on the GM);
 * stuck; The End; whoever walks with them; or, for a spectator, the lead's to take. `queued`: Enter
 * was pressed before the story was ready. None while the scene is being played, or with no story.
 */
export function wayOnOf(shown: SceneView, story: StoryView | undefined, options: { next?: { title: string } | undefined; queued?: boolean } = {}): WayOn | undefined {
  if (!story || (!shown.over && !shown.fighting)) return undefined;
  const title = endingOf(shown) ?? "The scene is over";
  const watching = shown.watching ? `Watching: ${shown.watching} goes on when ready` : undefined;
  // A summons's next scene can be watched coming in before the story has quite finished with the last.
  if (options.next) return { title, go: `On to ${options.next.title}`, ready: true, to: "next" };
  if (shown.fighting) return { title: "Roll for initiative!", go: watching ?? "To the fight", ready: !watching, to: watching ? "wait" : "fight", fight: true };
  // A talk moves nothing on (the lead is still the lead): its way on goes straight back to the map.
  if (shown.talk) { const said = endingOf(shown) ?? "The talk is over"; return watching ? { title: said, go: watching, ready: false, to: "wait" } : { title: said, go: "Back to the map", ready: true, to: "map" }; }
  if (story.onward === "failed") return watching ? { title, go: watching, ready: false, to: "wait" } : { title, go: "The story got stuck on the way: try again", ready: true, to: "carry_on" };
  if (story.onward) return { title, go: options.queued ? "Going on as soon as the story's ready" : "Continue, once the story has moved on", ready: false, to: "wait" };
  if (story.ended) return { title, go: "The End", ready: true, to: "end" };
  if (watching) return { title, go: watching, ready: false, to: "wait" };
  if (!story.lead) return { title, go: options.queued ? "Going on as soon as the story's ready" : "Continue, once the story has moved on", ready: false, to: "wait" };
  const friend = story.with[0]?.name;
  return { title, go: friend ? `On, with ${friend}` : "Go on", ready: true, to: "between" };
}

/** The moment between scenes: Kell's talk (or anyone else's), or with nobody there, the card. */
export interface BetweenView {
  /** The time of day the story has come to, in its words: "Evening, on the eve of the Assembly". */
  title: string;
  /** Whoever walks with the player says it (Kell reads the entry back), a line at a time; none with nobody there. */
  talk?: Line[];
  /** Who that is: "Sergeant Agnes Kell". */
  with?: string;
  /** Who walks with the player, by their key: a word with them (t) opens a talk (town-design §3.6). */
  friend?: { key: string; name: string };
  /** The card: the notebook's new lines, how the time went, the lead. */
  card: string[];
  /** The lead. */
  next: { key: string; title: string };
  /** Where Enter goes, on the button: "On to The Drowned Rat". */
  go: string;
}

/**
 * Between a scene and the next (the prototype's leadCard): the notebook's lines from the scene just
 * over, how the time went (the boundary's lead, when it wrote one), where the story goes next. Whoever
 * walks with the player tells it (talkBetween), Kell reading the entry back in the words of the
 * record; with nobody there, it's a card. There's no map to walk yet, so no way to draw: Kell
 * writes it down, and Enter goes on. None until the story has a lead.
 */
export function betweenOf(story: StoryView, sceneId: string | undefined): BetweenView | undefined {
  const next = story.lead;
  if (!next) return undefined;
  const notebook = story.notebook.find(n => n.sceneId === sceneId)?.lines ?? [];
  const friend = story.with[0];
  const card = [
    ...(notebook.length ? ["Your notebook:", ...notebook, ""] : []),
    ...(next.text ? [next.text, ""] : []),
    `The lead: ${next.title}.`,
    "",
    "Press Enter to go on.",
  ];
  const talk = friend ? talkBetween({ id: friend.key, name: friend.name }, { notebook, lead: next.text, next: { id: next.key, title: next.title }, time: story.time }) : undefined;
  return {
    title: TIME_WORDS[story.time] ?? story.time,
    ...(talk ? { talk, with: friend!.name } : {}),
    ...(friend ? { friend: { key: friend.key, name: friend.name } } : {}),
    card, next: { key: next.key, title: next.title }, go: `On to ${next.title}`,
  };
}

/** The fight's card (the stand-in's): what it says of itself, and its one action. */
export interface FightView {
  title: string;
  /** What the stand-in says. */
  lines: string[];
  /** Where Enter goes: To the fight. */
  go: string;
  hint: string;
}

/**
 * The card of a scene at its fight (docs/combat-gm.md): on to it (fight_it_out) sets it out on the
 * board, and the scene picks up from how it went once the player is out of it ("The fight: …" in its
 * transcript: the simulation writes it).
 */
export function fightOf(): FightView {
  return { title: "Roll for initiative!", lines: [STANDIN.observe], go: STANDIN.action.label, hint: "on to the board, and the scene picks up from how it went" };
}

/** The End: the last scene's closing, how each scene ended with its notebook lines, and the GM's bar tab (the prototype's epilogue). */
export interface EndView {
  /** Whose story it was (the End's frame): the lead's character. */
  who: string;
  closing: string;
  chapters: Array<{ sceneId: string; title: string; ending: string; lines: string[] }>;
  spentUsd: number;
  /** "The GM's bar tab this sitting: $0.12. The King has graciously declined to pay it." */
  tab: string;
}

/**
 * The End (the prototype's epilogue): the closing, the last scene's last narration; each scene's
 * ending, with its notebook lines; and what the GM cost.
 */
export function epilogueOf(shown: SceneView, story: StoryView): EndView {
  const last = [...shown.entries].reverse().find(e => e.kind === "narration");
  const chapters = story.notebook.filter(n => n.chapter).map(({ sceneId, title, ending, lines }) => ({ sceneId, title, ending, lines }));
  // The last scene's ending, unless it's on the record already.
  const ending = endingOf(shown);
  if (ending && shown.sceneId !== undefined && !chapters.some(c => c.sceneId === shown.sceneId)) chapters.push({ sceneId: shown.sceneId, title: shown.title, ending, lines: [] });
  return {
    who: shown.player.name || "The investigator",
    closing: last?.text ?? "And that, as they say in Caerwyn, was that.",
    chapters, spentUsd: story.spentUsd,
    tab: `The GM's bar tab this sitting: $${story.spentUsd.toFixed(2)}. The King has graciously declined to pay it.`,
  };
}

/** A quest as the quests overlay and the headless journal say it: "The Hanged Clerk (active): Prout's death is on the books as murder by persons unknown." */
export function questLine(q: QuestLine): string {
  const latest = q.notes.at(-1);
  return `${q.title} (${q.status})${latest ? `: ${latest}` : ""}`;
}
