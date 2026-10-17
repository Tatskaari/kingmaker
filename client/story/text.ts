// New, after the prototype's src/cli/qa.ts at 44c6d4a (print and options: MODE:, then the text, ACTIONS: and the hint) and src/game/play.ts:216-239 (observe's combat and end): the story's screens as text for the headless client, from the same views the screens draw (story-design §4.5).
import type { SceneView } from "../scene/view.ts";
import { betweenOf, epilogueOf, fightOf, questLine, wayOnOf, type StoryView, type WayOn } from "./view.ts";

/**
 * The scene's way on, as the agent reads it (MODE: between, fight or end, as the QA console printed
 * them): Kell's talk or the card with the lead to go on to; the fight's stand-in; The End. None while
 * the scene is played, or while the story is still moving on (the scene's own text says so).
 */
export function storyText(view: SceneView): string | undefined {
  const way = wayOnOf(view, view.story);
  if (!way || !view.story) return undefined;
  if (way.to === "between") return betweenText(view, view.story);
  if (way.fight) return fightText(view, way);
  if (way.to === "end") return endText(view, view.story);
  return undefined;
}

/** What the player can do once the scene is over, in a line (phaseLine's, for a scene that's over or whose fight is next). */
export function wayOnPhase(view: SceneView): string | undefined {
  const way = wayOnOf(view, view.story);
  if (!way) return undefined;
  switch (way.to) {
    case "wait": return view.watching && !view.story?.onward ? `PHASE: over (${view.watching} goes on when ready: observe again)` : `PHASE: over (the story is moving on: observe again)${view.story?.note ? ` ${view.story.note}` : ""}`;
    case "carry_on": return `PHASE: over (the story got stuck on the way${view.story?.note ? `: ${view.story.note.replace(/^The story got stuck on the way:?\s*/, "")}` : ""}). Use: go, which tries it again`;
    case "between": return "PHASE: between (Use: go)";
    case "fight": return "PHASE: fight (Use: act --id fight)";
    case "end": return "PHASE: end (the story is over)";
    case "next": return "PHASE: over (the next scene has begun: observe again)";
    case "map": return "PHASE: over (the talk is over. Use: act --id out, back to the map)";
  }
}

/** The way on's actions, as the agent takes them (act --id): stuck, carry_on. */
export function wayOnActions(view: SceneView): string[] {
  const way = wayOnOf(view, view.story);
  return way?.to === "carry_on" ? ["- carry_on: The story got stuck on the way: try again"] : [];
}

/** Between scenes: the time of day, Kell's talk (or the card), and the lead to go on to. */
function betweenText(view: SceneView, story: StoryView): string {
  const between = betweenOf(story, view.sceneId)!;
  const said = between.talk
    ? between.talk.map(l => (l.kind === "dialogue" ? `${l.name ?? l.speaker}: ${l.text}` : l.text)).join("\n\n")
    : between.card.slice(0, -2).join("\n").trim();
  return [
    "MODE: between",
    `[${between.title}]${between.with ? ` With you: ${between.with}.` : ""}`,
    said,
    `ACTIONS:\n- go_to_lead: ${between.go}`,
    view.watching ? `PHASE: between (${view.watching} goes on when ready: observe again)` : "PHASE: between (Use: go)",
  ].join("\n\n");
}

/** The fight's stand-in: what it says of itself, and Fight it out (the one who has the lead's to take). */
function fightText(view: SceneView, way: WayOn): string {
  const fight = fightOf();
  return [
    "MODE: fight",
    `[${view.title}] ${way.title}`,
    ...fight.lines,
    ...(view.watching ? [`PHASE: fight (${view.watching} fights it out: observe again)`] : [`ACTIONS:\n- fight: ${fight.go}`, "PHASE: fight (Use: act --id fight)"]),
  ].join("\n\n");
}

/** The End: the closing, how each scene went with its notebook lines, the GM's bar tab. */
function endText(view: SceneView, story: StoryView): string {
  const end = epilogueOf(view, story);
  return [
    "MODE: end",
    "THE END",
    end.closing,
    ["How it went:", ...end.chapters.flatMap((c, i) => [`${i + 1}. ${c.title}: ${c.ending}`, ...c.lines.map(l => `   ${l}`)])].join("\n"),
    end.tab,
    "PHASE: end (the story is over)",
  ].join("\n\n");
}

/** The notebook, the quests, the flags and the attitudes, as the journal verb prints them. */
export function journalText(story: StoryView): string {
  const notebook = story.notebook.length
    ? story.notebook.map(j => [`${j.title}: ${j.ending}`, ...j.lines.map(l => `· ${l}`), ...(j.stood ? [`How things stood:\n${j.stood}`] : [])].join("\n")).join("\n\n")
    : "Nothing yet. The notebook is new, and smells of it.";
  return [
    "MODE: journal",
    `The investigator's notebook:\n\n${notebook}`,
    `Quests:\n${story.quests.length ? story.quests.map(q => `- ${questLine(q)}`).join("\n") : "(none yet)"}`,
    `Flags: ${story.flags.length ? story.flags.map(f => `${f.name} = ${f.value}`).join("; ") : "(none)"}`,
    `Attitudes: ${story.attitudes.length ? story.attitudes.map(a => `${a.who}: ${a.attitude}${a.reason ? ` (${a.reason})` : ""}`).join("; ") : "(none)"}`,
  ].join("\n\n");
}
