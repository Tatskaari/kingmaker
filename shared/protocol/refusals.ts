import { MOST_WORDS } from "../creation/story.ts";

/**
 * Refusals: a move the simulation won't make, in the game's words (v0-design §3.4, v1-design §3.4,
 * story-design §4.2: the way on between scenes, the testing end, the fight's stand-in; town-design
 * §3.2: the map's action menu, whose words are the prototype's own sentence for what it won't do).
 * A reducer throws one as a SenderError whose message is the refusal as JSON; the client parses it
 * back and shows `text` in its status line, or, on the creation screens, in their note line (the two
 * that are the prototype's notes keep its words, with no brackets).
 */

export type RefusalCode =
  | "not_in_game" | "unknown" | "no_campaign" | "no_build" | "bad_name" | "bad_concept" | "not_ready" | "scene_over"
  | "not_controller" | "turn_in_flight" | "turn_failed" | "empty_line" | "too_long" | "not_failed"
  | "not_service" | "not_admin" | "bad_pack" | "not_built"
  | "not_creating" | "creation_busy" | "not_offered" | "still_making" | "not_now" | "bad_how"
  | "nothing_to_work_in" | "story_too_long" | "story_too_big" | "already_begun" | "not_yours" | "not_begun"
  | "scene_on" | "no_way" | "unavailable" | "not_in_scene" | "no_lead" | "story_over" | "not_stuck" | "no_scene" | "no_exit" | "no_fight"
  | "no_line" | "out_of_reach" | "too_far" | "no_slot" | "shut"
  | "not_your_turn" | "no_exhibit" | "no_line_up"
  | "bad_report";

export interface Refusal { code: RefusalCode; text: string }

/**
 * The longest line a player may say, and the longest name and concept a character may have (the
 * words below quote them). The concept is in every request the game sends the AI service, and in
 * several of the GM's prompts: a long one costs at every model call, and past 2 MB none is answered.
 */
export const MAX_LINE = 2000;
export const MAX_NAME = 60;
export const MAX_CONCEPT = 300;
/** The most the backstory's box keeps, in characters (its words are MOST_WORDS at most). */
export const MAX_STORY = 40_000;

/** 2000 as "2,000" (no Intl: the module's runtime is lean). */
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The words for each refusal. The ones that name something take it from `vars`. */
const WORDS: Record<RefusalCode, (v: Record<string, string>) => string> = {
  not_in_game: () => "(You're not in a game: start one, or watch someone's.)",
  unknown: v => (v.what === "turn" ? "(There's no such turn.)" : "(There's no such game here.)"),
  no_campaign: v => `(There's no campaign called ${v.campaign ?? "that"} here.)`,
  no_build: v => `(There's no ready-made build called ${v.build ?? "that"}: there's ${v.builds ?? "none"}.)`,
  bad_name: () => `(Your character needs a name of ${MAX_NAME} characters or fewer.)`,
  bad_concept: () => `(Your character's concept needs to be ${MAX_CONCEPT} characters or fewer.)`,
  not_ready: v => v.text ?? "(The scene is still opening.)",
  scene_over: () => "(The scene is over.)",
  not_controller: v => `(${v.name ?? "Someone else"} has the lead here: you're watching.)`,
  turn_in_flight: () => "(The GM is still answering.)",
  turn_failed: () => "(The GM lost the thread: /retry to carry on.)",
  empty_line: () => "(Say something, or do something in *asterisks*.)",
  too_long: () => `(That's too much for one turn: ${thousands(MAX_LINE)} characters at most.)`,
  not_failed: () => "(That turn hasn't failed: there's nothing to retry.)",
  not_service: () => "Only the AI service may do that.",
  not_admin: v => `Only the database's owner may ${v.what ?? "install a campaign"}.`,
  bad_pack: v => `The campaign pack doesn't load: ${v.why ?? "it's malformed"}.`,
  not_built: () => "(That isn't built yet.)",
  not_creating: () => "(You're not making a character: New game starts one.)",
  creation_busy: () => "(The GM is still working on it.)",
  not_offered: () => "(That isn't one of the builds on offer.)",
  still_making: () => "(The rules engine is still making it.)",
  not_now: v => v.text ?? "(That doesn't apply just now.)",
  bad_how: () => "(That isn't a way to make a character: three, model, or own:<species>,<class>,<subclass>,<background>.)",
  nothing_to_work_in: () => "There's nothing in the box to work in yet: write a few notes first, or Draft one.",
  story_too_long: v => `It's ${v.words ? thousands(Number(v.words)) : `over ${thousands(MOST_WORDS)}`} words, and the GM reads all of it every turn: cut it to ${thousands(MOST_WORDS)} or fewer.`,
  story_too_big: () => "(That's more than the box can keep.)",
  already_begun: () => "(The story has already begun.)",
  not_yours: () => "(That isn't one of your games.)",
  not_begun: () => "(That game hasn't begun: its player is still making their character.)",
  scene_on: () => "(You're in the middle of a scene: see it through first.)",
  no_way: () => "(There's no map to walk here yet: go on to the lead.)",
  unavailable: () => "(That isn't there to do from here: look again at what's in sight.)",
  not_in_scene: () => "(You're not in a scene: pick an action instead.)",
  no_lead: () => "(The story hasn't said where it goes next yet.)",
  story_over: () => "(The story is over.)",
  not_stuck: () => "(The story isn't stuck: there's nothing to carry on.)",
  no_scene: () => "(There's no scene being played.)",
  no_exit: v => (v.exit ? `(There's no ending called ${v.exit} here: there's ${v.exits ?? "none"}.)` : `(The endings here: ${v.exits ?? "none"}.)`),
  no_fight: () => "(There's no fight to be had here.)",
  // The map's action menu (town-design §3.2): each takes the prototype's sentence for it as `text`,
  // "(<what it is>: <why not>.)", as menu.ts says it; these words stand in when none is given.
  no_line: v => v.text ?? "(There's no clear line to there.)",
  out_of_reach: v => v.text ?? "(That's out of reach from here.)",
  too_far: v => v.text ?? "(That's too far to get to from here.)",
  no_slot: v => v.text ?? "(No spell slots left for that: a rest brings them back.)",
  shut: v => v.text ?? "(That's shut at this hour.)",
  // A fight (M6, docs/combat-design.md): the player's moves wait for their turn.
  not_your_turn: () => "(It isn't your turn: wait for it.)",
  // The zoo (M6): its exhibits, and a fight exhibit's line-ups of foes.
  no_exhibit: v => `(There's no exhibit called ${v.exhibit || "that"} ${v.where ?? "in the zoo"}: there's ${v.exhibits || "none"}.)`,
  no_line_up: v => `(${v.exhibit ?? "That exhibit"} has no line-up called ${v.foes || "that"}: there's ${v.lineUps || "none"}.)`,
  // A report of a problem (V16, M5): its game restored here, by the database's owner (npm run report -- restore).
  bad_report: v => `(That report's game can't be restored here: ${v.why ?? "its rows don't read"}.)`,
};

/**
 * A refusal in the game's words. `vars` by code: unknown `what` ("game" or "turn"); no_campaign
 * `campaign`; no_build `build` and `builds` (andList of the ids); not_controller `name`; not_admin
 * `what` ("install a campaign" when absent); bad_pack `why`; story_too_long `words` (the story's
 * wordCount, as shared/creation/story.ts tooLong says it); no_exit `exit` (what was asked for: none
 * lists them) and `exits` (andList of "<id> (<title>)"); the map's action menu's (no_line,
 * out_of_reach, too_far, no_slot, shut, and not_ready and not_now when a menu act gives them) `text`,
 * the prototype's sentence whole: "(Fire Bolt (cantrip): out of reach: 130 ft (it reaches 120 ft).)";
 * no_exhibit `exhibit`, `exhibits` (andList of their ids) and `where` ("in the zoo" when absent);
 * no_line_up `exhibit` (its title), `foes` and `lineUps` (andList of their ids); bad_report `why`.
 */
export function refusal(code: RefusalCode, vars: Record<string, string> = {}): Refusal {
  return { code, text: WORDS[code](vars) };
}

/** A refusal from an error's message (a SenderError's, or HTTP's 530 body), or undefined when it isn't one. */
export function refusalIn(message: string): Refusal | undefined {
  try {
    const parsed = JSON.parse(message) as Partial<Refusal>;
    return typeof parsed?.code === "string" && typeof parsed.text === "string" && parsed.code in WORDS ? { code: parsed.code, text: parsed.text } : undefined;
  } catch {
    return undefined;
  }
}

/** "ranger, rogue and wizard". */
export function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
