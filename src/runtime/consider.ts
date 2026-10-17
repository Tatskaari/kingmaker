import { costOf, logCall, respondJson, LUNA, type Effort } from "../llm/openrouter.ts";
import { asHeard, currentBeat, heardIn, IMPROVISED_EXIT_ID, leftBehind, openRoutes, presentCast, prompt, sceneBrief, sceneEntries, scriptTranscript, targetTitle, unnamed } from "./brief.ts";
import { describeRoll, titleCase } from "./dice.ts";
import { failedTries, moveDirective, resolve, SOCIAL, type Move, type PreDecision } from "./director.ts";
import { SKILLS, type Scene, type Skill, type Transition } from "./scene.ts";
import type { RulingRecord, ScenePatch, SessionState } from "./session.ts";
import { worldView } from "../world/scene-world.ts";

/**
 * Considered rolls: the GM's review of an act the decider flagged (a roll should settle it, and no
 * route of the scene's does, or it's a plan off the graph), made before the reply, on those turns
 * only. One call that can take its time: who the player is working on and by what means, whether to
 * roll at all and at what DC (the judgements of docs/research/dc-guidance.md, turned into a verdict
 * by code), and what success and failure each change in the scene. The outcomes are expressed in the
 * scene's own machinery (a route with a check, the beat or ending it leads to, the facts each outcome
 * establishes, the authored route it amounts to, what comes out, ways of trying it closes), so the
 * rules roll it like any route, the move applies like any move, and the decider and the GM keep to it
 * afterwards.
 *
 * Code holds the review to what it's for: the same push again gets the same answer; a lie is
 * Deception; a lift from someone is a contest with them; a success gives what was asked, or there's
 * nothing to roll for; a no without dice is an honest refusal, never the failure's cost; only a roll
 * that went against the player shuts a way of trying, and only one they tried; a ruling never takes
 * the scene back past a beat it has reached; what lands is what the reply showed; the dice line says
 * nothing the player hasn't heard; and the review is given about 12 s, after which the turn rolls
 * without it.
 */

/** Steps of a considered turn, as they start: the app's status line moves on at each. */
export type ConsiderStep = "consider" | "weigh" | "success" | "failure" | "roll";

/** How much of what the player was after an outcome gives them. */
export type Gets = "all" | "some" | "none";
const GETS: readonly string[] = ["all", "some", "none"] satisfies Gets[];

/** What an outcome changes, as the review wrote it. */
export interface RulingOutcome {
  /** What happens, decided, for the GM to narrate (and all of what comes out, in its own terms). */
  happens: string;
  /** How much of what the player was after it gives them: a success that gives none is a refusal. */
  gets: Gets;
  /** A beat or ending it leads to (undefined: the scene stays where it is). */
  to?: string;
  /** An outcome route of the scene's that this amounts to: its facts come with it, and it leads where it leads. */
  countsAs?: string;
  establishes: string[];
  /** Essentials (ids) that come out, as this outcome says (what lands is what the reply showed: landRuling). */
  reveals: string[];
  /** Ways of trying (routes with a roll, available now) that this rules out for the rest of the scene: a failure's, for a way really tried. */
  closes: string[];
}

/** The review's judgements, as dc-guidance.md has them. */
export interface Judged {
  stakes: "trivial" | "guarded" | "dangerous" | "ruinous";
  approach: "free" | "no_chance" | "weak" | "plausible" | "strong" | "excellent";
  disposition: "hostile" | "wary" | "friendly";
  /** They give this when asked (the beat, their card, or what they've agreed to says so): free, whatever the stakes. */
  freely?: boolean;
  sameAgain: boolean;
  difficulty: "trivial" | "easy" | "moderate" | "hard" | "impossible";
}

/** The GM's ruling on a considered act. */
export interface Ruling {
  act: string;
  /** A cast id, or "world" (a feat). */
  target: string;
  skill: Skill;
  /** The player's turn rests on something they know isn't so (a lie, a bluff, a forgery): Deception. */
  lie: boolean;
  judged: Judged;
  /** The dice line's reason: the goal, as the player sees it (and nothing they haven't heard). */
  reason: string;
  success: RulingOutcome;
  failure: RulingOutcome;
  /** Why its success is no success (a refusal, as the review wrote it): then nothing is rolled, and that refusal is the answer. */
  hollow?: string;
  /** Why the dice don't matter (either way it comes to the same, and it gets them what they were after): then it's a yes. */
  foregone?: string;
  costUsd: number;
  latencyMs: number;
}

/**
 * Roll or not, and at what. A no says which kind (`no`): the same push again (the answer it got
 * before), the review's own refusal (`hollow`: its success gets them nothing), or a plain no from
 * the person or the world (a lever that can't move them, too far, can't be done like this).
 */
export interface Verdict { kind: "roll" | "yes" | "no"; dc?: number; why: string; no?: "same_again" | "hollow" | "refused" }

/** What the review is told beyond the scene, and how it's run. */
export interface ReviewContext {
  /** The ending held for the player's answer, if there is one (the turn takes it off the state as it starts). */
  pending?: SessionState["pendingExit"];
  /** People across the story whose names the player hasn't heard (brief.ts's `strangers`): the dice line calls them what the player would. */
  unheard?: Array<{ name: string; called: string }>;
  onStep?: (step: ConsiderStep) => void;
  signal?: AbortSignal;
}

const FEAT_DC: Record<string, number> = { easy: 10, moderate: 13, hard: 16 };
const RESIST: Record<string, number> = { trivial: 0, guarded: 1, dangerous: 2, ruinous: 3 };
const LEVER: Record<string, number> = { weak: -1, plausible: 0, strong: 1, excellent: 2 };
const WARMTH: Record<string, number> = { hostile: -1, wary: 0, friendly: 1 };

/** How far the decider must have leant towards a way of trying for this attempt to count as trying it (so a failure can shut it). */
const TRIED = 0.25;

/** The review writes 250 to 330 tokens: a runaway (one wrote junk to 6,000 and took 43 s) is cut off near 1,000. */
const MAX_OUTPUT_TOKENS = 1000;

/**
 * How long a considered turn waits for the review before rolling without it (KM_CONSIDER_DEADLINE_MS):
 * it usually takes 3 to 5 s, and 8 to 9 s when OpenRouter is slow.
 */
export const considerDeadlineMs = (): number => Number(process.env.KM_CONSIDER_DEADLINE_MS ?? 12_000);

/** Taking something from under someone's nose, a grab, or slipping past them: a contest with whoever could notice. */
const CONTEST: readonly Skill[] = ["sleight_of_hand", "stealth", "athletics"];

/**
 * A lift, a snatch or a slip past someone in the cast: their attention and what they stand to lose
 * against the player's cover, so it's rolled like working on them (Cob's boot, Sallow's purse in
 * front of the King), not ruled a feat. Taking a thing nobody's watching is a feat.
 */
export function contest(scene: Scene, ruling: Pick<Ruling, "target" | "skill">): boolean {
  return CONTEST.includes(ruling.skill) && scene.cast.some(c => c.id === ruling.target);
}

/** Whether the act is someone being worked on (the guidance's grid), a contest with them included, or a feat (its difficulty). */
export function workedOn(scene: Scene, ruling: Pick<Ruling, "target" | "skill">): boolean {
  return ((SOCIAL.includes(ruling.skill) || ruling.skill === "insight") && scene.cast.some(c => c.id === ruling.target)) || contest(scene, ruling);
}

/**
 * The verdict from the review's judgements. The same push that already failed here gets the same
 * answer, whatever else was judged. Working on someone, it's the guidance's grid as designed
 * (docs/research/dc-guidance.md §3.2 and §3.4: what giving in costs them, less the player's leverage
 * and their warmth, 3 points a step from DC 12): yes without a roll when they'd do it anyway, it
 * costs them nothing, or the gap is 0 or less (never for a lie, which can always be seen through: it
 * rolls at 10); a roll at DC 12, 15 or 18 for a gap of 1 to 3; and no at 4 or more, or for a lever
 * that can't move them, the reply showing what would reach them. Fewer, meaningful rolls, as the
 * table's rules have it. A lift, a snatch or a slip past someone is a contest with them: rolled at
 * 10 to 18 on the same steps (their attention, what they stand to lose, against the player's cover),
 * unless they'd let them anyway or it plainly can't be done under their eyes. A feat is DC 10, 13 or
 * 16, or plainly done, or plainly can't be. A success that gets them nothing (a refusal) leaves
 * nothing to roll for: it's a no, and that refusal is the answer; one that comes to the same as its
 * failure, and gets them what they were after, is a yes.
 */
export function verdict(scene: Scene, ruling: Pick<Ruling, "target" | "skill" | "judged"> & { hollow?: string; foregone?: string }): Verdict {
  const j = ruling.judged;
  // The same push that already failed here gets the same answer, whatever else the review says.
  if (j.sameAgain) return { kind: "no", no: "same_again", why: "the same push again, with nothing new" };
  if (ruling.hollow) return { kind: "no", no: "hollow", why: ruling.hollow };
  if (ruling.foregone) return { kind: "yes", why: ruling.foregone };
  if (contest(scene, ruling)) {
    // Rolled: they could notice. A yes only if they'd let them anyway, and a no only when both of the
    // review's reads say it can't be done (no chance under their eyes, and impossible as a feat); when
    // they disagree (no chance, but nothing stands in the way), it's tried.
    const approach = j.approach === "no_chance" && j.difficulty !== "impossible" ? "weak" : j.approach;
    const said = `${j.stakes} to lose, ${approach.replace("_", " ")} cover, ${j.disposition}`;
    if (approach === "free") return { kind: "yes", why: `they'd let them anyway (${said})` };
    if (approach === "no_chance") return { kind: "no", no: "refused", why: `it can't be done under their eyes like this (${said})` };
    const gap = (RESIST[j.stakes] ?? 1) - (LEVER[approach] ?? 0) - (WARMTH[j.disposition] ?? 0);
    return { kind: "roll", dc: Math.min(18, Math.max(10, 9 + 3 * gap)), why: `${said}: they could notice` };
  }
  if (workedOn(scene, ruling)) {
    const said = `${j.stakes}, ${j.approach.replace("_", " ")}, ${j.disposition}`;
    const lie = ruling.skill === "deception";
    if (j.approach === "free") return { kind: "yes", why: `they'd do it anyway (${said})` };
    // What the beat, their card or their own word says they give when asked comes freely, whatever the stakes.
    if (j.freely) return { kind: "yes", why: `it comes freely when asked (${said})` };
    if (j.stakes === "trivial" && !lie) return { kind: "yes", why: `it costs them nothing (${said})` };
    if (j.approach === "no_chance") return { kind: "no", no: "refused", why: `it pulls a lever that can't move them (${said})` };
    const gap = (RESIST[j.stakes] ?? 1) - (LEVER[j.approach] ?? 0) - (WARMTH[j.disposition] ?? 0);
    if (gap <= 0 && !lie) return { kind: "yes", why: `that's enough to move them (${said})` };
    if (gap >= 4) return { kind: "no", no: "refused", why: `not like this: it's too far from what would move them (${said})` };
    return { kind: "roll", dc: Math.max(10, 9 + 3 * gap), why: said };
  }
  if (j.difficulty === "trivial") return { kind: "yes", why: "nothing stands in the way" };
  if (j.difficulty === "impossible") return { kind: "no", no: "refused", why: "it can't be done like this" };
  return { kind: "roll", dc: FEAT_DC[j.difficulty] ?? 13, why: j.difficulty };
}

/**
 * The routes a ruling can name: rolled as written and closed (ways of trying), or counted as (what
 * simply happens). As the decider has them: not one already won here, nor one that brings what the
 * player has already come across, nor a fight already fought.
 */
function routesNow(scene: Scene, state: SessionState): { checks: Transition[]; outcomes: Transition[] } {
  const beat = currentBeat(scene, state);
  const all = openRoutes([...beat.transitions, ...(scene.anytime ?? [])], state).filter(t => !state.fought?.includes(t.to ?? ""));
  const phase = (t: Transition) => t.on ?? (t.check ? "attempt" : "outcome");
  return {
    checks: all.filter(t => t.check && phase(t) === "attempt"),
    outcomes: all.filter(t => !t.check && phase(t) === "outcome" && t.to !== IMPROVISED_EXIT_ID),
  };
}

/** An enum that can't be empty (strict schemas refuse one): "none" stands in, and is dropped after. */
const ids = (list: string[]) => (list.length ? list : ["none"]);

/** An outcome's schema: success and failure are told apart, as the GM must tell them apart. */
function outcomeSchema(went: "success" | "failure", places: string[], outcomes: string[], essentials: string[], checks: string[]) {
  return {
    type: "object", additionalProperties: false,
    required: ["happens", "gets", "to", "counts_as", "establishes", "reveals", "closes"],
    properties: {
      happens: { type: "string", description: went === "success"
        ? "What happens if it works, decided, for the GM to narrate: they get what they were after, as they asked for it (never a refusal, never caught or found out), and the method shows. What comes out, in its own terms, as it comes out. One to three concrete sentences naming who does what. (If nothing could get them that here, write instead the honest no they'd get, in the person's own words and showing what would reach them, with gets none: then there's no roll, and that no costs them nothing.)"
        : "What happens if it's rolled and fails, decided, for the GM to narrate: it doesn't work, and it costs the player something they can feel or makes someone act (they bolt, call for help, warn someone, name a price, turn on the player; a way shut for good; time or something lost). A refusal, or a refusal written down, isn't enough; but it never puts what the scene needs out of reach for good (no 'won't let you near the boots again'): the other ways to it stay open. One to three concrete sentences naming who does what." },
      gets: { type: "string", enum: [...GETS], description: "How much of what the player was after this outcome gives them: all, some, or none." },
      to: { type: "string", enum: ["stay", ...places], description: "A beat or ending the scene moves to, only when what happens is what it's about; stay otherwise." },
      counts_as: { type: "string", enum: ["none", ...outcomes], description: "If what happens is what one of the scene's routes that simply happen describes (something found, said or settled), that route: its facts come with it and it leads where it leads." },
      establishes: { type: "array", items: { type: "string" }, description: "Facts now true because of this outcome (not ones true either way), as short statements: who gave what up or now holds it, who has gone where or won't talk, what was promised, agreed, paid or lost." },
      reveals: { type: "array", items: { type: "string", enum: ids(essentials) }, description: "Things the player needs to come across that come out in this outcome, as it says (none, often)." },
      closes: { type: "array", items: { type: "string", enum: ids(checks) }, description: went === "success"
        ? "None: a success shuts no way of trying."
        : "Ways of trying (routes with a roll) this failure rules out for the rest of the scene: only one the player has really tried (this attempt was that way), or one the fiction now rules out for good (the person has left the scene, the thing is destroyed). Never because someone is cross or refuses: a better approach can still open it. None, usually." },
    },
  };
}

/** The review's answer's schema, with the scene's own ids. */
export function rulingSchema(scene: Scene, state: SessionState) {
  const { checks, outcomes } = routesNow(scene, state);
  const places = [...scene.beats.map(b => b.id), ...scene.exits.filter(e => e.id !== IMPROVISED_EXIT_ID).map(e => e.id)];
  const essentials = (scene.essentials ?? []).filter(e => !state.landed?.includes(e.id)).map(e => e.id);
  const outcome = (went: "success" | "failure") => outcomeSchema(went, places, outcomes.map(t => t.id), essentials, checks.map(t => t.id));
  const present = presentCast(scene, state).map(c => c.id);
  return {
    type: "object", additionalProperties: false,
    required: ["act", "target", "lie", "skill", "stakes", "approach", "disposition", "freely", "same_again", "difficulty", "reason", "success", "failure"],
    properties: {
      act: { type: "string", description: "What the player is attempting, in a few words." },
      target: { type: "string", enum: [...present, "world"], description: "Who the player's act is up against: the one they're persuading, threatening, fooling or reading, or the one who could catch a lift, a snatch or a slip past them. Never an ally or companion for a choice that's theirs to make (they make it in the reply): the roll is against whoever or whatever stands in the way. world for a feat that nobody present could notice or stop." },
      lie: { type: "boolean", description: "Do the player's own words this turn assert something they know is false: a false name or claim, a bluff, a forgery or a fake, a promise they don't mean to keep? Then the skill is Deception, however friendly the words. Not a lie: a sincere promise or offer (even a bold one, or one that will be hard to keep), an honest appeal, haggling, a reassurance they mean, a guess or a theory, or keeping quiet about something. Judge this turn's words alone: lies told in earlier turns don't make this one a lie." },
      skill: { type: "string", enum: [...SKILLS], description: "The skill that decides it, by the player's method (a lift or a snatch from someone is Sleight of Hand, slipping past them Stealth)." },
      stakes: { type: "string", enum: ["trivial", "guarded", "dangerous", "ruinous"], description: "Working on someone (a lift, a snatch or a slip past them included): what giving in, or losing it, would cost them, as they see it." },
      approach: { type: "string", enum: ["free", "no_chance", "weak", "plausible", "strong", "excellent"], description: "Working on someone: what the player says, offers or shows, against who this person is. A lie is judged as if it were true (whether it's believed is the roll's to decide, so it isn't marked down for being a lie). free: they'd do it anyway: they've already agreed to it or offered it, it follows up on what they've already given up, agreed to or been paid for, their card says they'd give it if asked (straight), or the beat says it comes out as the player asks; no_chance: a lever that can't move them, or something nothing would get from them (or a lie they'd know at once is false); weak: no real reason; plausible: some reason, not aimed at them; strong: real leverage on them; excellent: aimed squarely at what they want or fear. For a lift, a snatch or a slip past someone, it's how well the method and the cover beat their attention: weak, clumsy or in plain view; plausible, a fair try; strong, good cover or a real distraction; excellent, their eyes are elsewhere at just the moment; no_chance only if it truly can't be done under their eyes." },
      disposition: { type: "string", enum: ["hostile", "wary", "friendly"], description: "Working on someone: how they feel about the player right now (for a lift: a friendly or distracted mark is off guard, a wary or hostile one watches)." },
      freely: { type: "boolean", description: "Working on someone: is this something they give when asked? True when the beat's direction or what they're doing at this point says it comes out as the player asks (someone who has started talking answers the follow-ups, one thing at a time), their card says they'd give it if asked (straight), or they've already agreed to it or offered it. Then there's no roll, whatever the stakes. False for what they're still holding out on." },
      same_again: { type: "boolean", description: "True only when this is the same push as a try that failed in this scene (your earlier rulings, and the routes rolled that failed, each with the player's own words): the same ask of the same person by the same means, reworded, repeated or louder, or more of the same (a bigger bribe, a harder threat), with nothing new on the table. New evidence or an argument not made before, a different lever (another kind of offer, a promise that answers what they fear), a different ask or person, or a changed situation is a new try: false. False when nothing has failed here." },
      difficulty: { type: "string", enum: ["trivial", "easy", "moderate", "hard", "impossible"], description: "A feat (no one being worked on, and nobody present who could notice or stop it): how hard, here and now." },
      reason: { type: "string", description: "For the dice line, which the player reads: what they're after, as they put it this turn ('to talk the ferryman into crossing tonight'). Never the answer, and nothing only you know: no name they haven't heard, nothing from your prep they haven't come across (where someone was, what they saw or hide). They're 'you'." },
      success: outcome("success"),
      failure: outcome("failure"),
    },
  };
}

interface RulingJson {
  act: string; target: string; lie: boolean; skill: string;
  stakes: Judged["stakes"]; approach: Judged["approach"]; disposition: Judged["disposition"]; freely?: boolean; same_again: boolean; difficulty: Judged["difficulty"];
  reason: string;
  success: OutcomeJson; failure: OutcomeJson;
}
interface OutcomeJson { happens: string; gets: string; to: string; counts_as: string; establishes: string[]; reveals: string[]; closes: string[] }

/** The streamed review's sections, in the schema's order: each one starting is a step. */
const SECTIONS: Array<[string, ConsiderStep]> = [["\"stakes\"", "weigh"], ["\"success\"", "success"], ["\"failure\"", "failure"]];

/** How long the review may think: none (KM_CONSIDER_EFFORT for experiments; low took about twice as long for the same rulings). */
export const considerEffort = (): Effort => (process.env.KM_CONSIDER_EFFORT as Effort | undefined) ?? "none";

/** The decider's read, for the review: the routes it leant towards, the method, and whether it thought the payoff earned. */
function leaning(read: PreDecision["considered"]): string {
  if (!read) return "";
  const bits = [
    ...(read.routes.length ? [`it leant towards ${read.routes.map(r => `${r.id} (${r.p.toFixed(2)})`).join(", ")}`] : []),
    ...(read.means ? [`the method looked like ${read.means}`] : []),
    ...(read.earned !== undefined ? [`it half thought the player had already done what it takes (${read.earned.toFixed(2)})`] : []),
  ];
  return bits.length ? `(The decider's read: ${bits.join("; ")}.)` : "";
}

/** What the player said and did on a turn of this scene, in their own words (clipped), for the record of what was tried. */
function theirWords(state: SessionState, turn: number): string {
  const words = sceneEntries(state).filter(e => e.turn === turn && e.speaker === "player").map(e => e.text.trim()).join(" ");
  return words ? ` The player: "${words.length > 300 ? `${words.slice(0, 300).trimEnd()}…` : words}"` : "";
}

/**
 * The review's input: where the scene stands, its routes, what's been tried (each try with the
 * player's own words, so the same push again can be told from a new one) and established, and the
 * turn to rule on.
 */
export function reviewInput(scene: Scene, state: SessionState, playerTurn: string, read: PreDecision["considered"], context: ReviewContext = {}): string {
  const beat = currentBeat(scene, state);
  const { checks, outcomes } = routesNow(scene, state);
  const line = (t: Transition) => t.check
    ? `- [${t.id}] ${t.when} (${titleCase(t.check.skill)} DC ${t.check.dc}${t.check.reason ? `, ${t.check.reason.trim().replace(/\.$/, "")}` : ""}; success: ${t.check.success} -> ${targetTitle(scene, t.check.onSuccess)}; failure: ${t.check.failure}${t.check.onFailure ? ` -> ${targetTitle(scene, t.check.onFailure)}` : ""})`
    : `- [${t.id}] ${t.when} -> ${targetTitle(scene, t.to!)}`;
  const beats = scene.beats.map(b => `- [${b.id}] ${b.title}: ${b.direction.split(/(?<=\.)\s/).slice(0, 2).join(" ")}`);
  const endings = scene.exits.filter(e => e.id !== IMPROVISED_EXIT_ID).map(e => `- [${e.id}] ${e.title}: ${e.outcome}`);
  const essentials = (scene.essentials ?? []).map(e => `- [${e.id}] ${e.what} (placed with: ${e.placedWith.join("; ")}) ${state.landed?.includes(e.id) ? "ALREADY COME ACROSS" : "NOT YET"}`);
  const rulings = (state.rulings ?? []).map(r => `- turn ${r.turn}: ${r.act} (${r.target}; ${r.kind === "roll" ? `${titleCase(r.skill)} DC ${r.dc}, ${r.roll ? describeRoll(r.roll) : "rolled"}` : r.kind === "yes" ? "no roll: it worked" : "no roll: it couldn't work like that"}): ${r.changed}.${theirWords(state, r.turn)}`);
  // The routes' own rolls that failed: the same push again gets the same answer there too.
  const failed = failedTries(scene, state, { rulings: false }).map(f => `${f}${theirWords(state, Number(/^turn (\d+):/.exec(f)?.[1] ?? NaN))}`);
  const strangers = Object.entries(unnamed(scene, state)).map(([id, called]) => `${scene.cast.find(c => c.id === id)?.name} ("${called}")`);
  const pending = context.pending ?? state.pendingExit;
  const read_ = leaning(read);
  // What the people here are doing at this point, as the beat has it ("The token's only brass: give it up if asked").
  const present = presentCast(scene, state);
  const doing = Object.entries(beat.cast ?? {}).flatMap(([id, note]) => {
    const c = present.find(p => p.id === id);
    return c ? [`- ${c.name}: ${note}`] : [];
  });
  return [
    `## Where the scene is: [${beat.id}] ${beat.title}\n${beat.direction}\n(${state.turnsInBeat} exchange${state.turnsInBeat === 1 ? "" : "s"} at this point.)${doing.length ? `\n\nWhat the people here are doing at this point (what this says they give freely, or when asked, is free):\n${doing.join("\n")}` : ""}`,
    `## The scene's beats\n${beats.join("\n")}\n\n## Its endings\n${endings.join("\n")}`,
    `## Routes from here with a roll (ways of trying)\n${checks.map(line).join("\n") || "(none)"}`,
    `## Routes from here that simply happen\n${outcomes.map(line).join("\n") || "(none)"}`,
    ...(essentials.length ? [`## What the player needs to come across\n${essentials.join("\n")}`] : []),
    `## Established so far\n${[...state.established, ...state.canon].map(f => `- ${f}`).join("\n") || "(nothing yet)"}`,
    ...(rulings.length ? [`## Your earlier rulings in this scene (each with what the player said and did)\n${rulings.join("\n")}`] : []),
    ...(failed.length ? [`## Routes you wrote that were rolled in this scene and failed\n${failed.map(f => `- ${f}`).join("\n")}`] : []),
    ...(pending ? [`## On the brink\nUnless this turn changes things, the scene ends next: ${scene.exits.find(e => e.id === pending.exitId)?.title ?? pending.exitId}. A success can stop it; a failure lets it happen (lead there).`] : []),
    ...(state.world ? [`## The world right now (who and what is where)\n${worldView(state.world)}`] : []),
    ...(strangers.length ? [`## Names the player hasn't heard yet (don't use them in the reason)\n${strangers.join("; ")}`] : []),
    `## The scene so far\n${scriptTranscript(scene, state, sceneEntries(state).slice(-24))}`,
    `## Rule on this: the player's latest turn\n${playerTurn}${read_ ? `\n\n${read_}` : ""}`,
  ].join("\n\n");
}

/**
 * The GM's review: the whole prep (every fact), where the scene stands, the routes, the earlier
 * rulings and failed tries, the world, the scene so far and the player's turn; one structured answer.
 * `onStep` hears each step start (the call, then each section of the answer as it streams).
 */
export async function considerAct(scene: Scene, state: SessionState, playerTurn: string, read: PreDecision["considered"], context: ReviewContext = {}): Promise<Ruling> {
  const input = [
    { role: "developer" as const, content: sceneBrief(scene, state) },
    { role: "user" as const, content: reviewInput(scene, state, playerTurn, read, context) },
  ];
  context.onStep?.("consider");
  const seen = new Set<ConsiderStep>();
  const onText = (text: string) => {
    for (const [key, step] of SECTIONS) if (!seen.has(step) && text.includes(key)) { seen.add(step); context.onStep?.(step); }
  };
  const json = await respondJson<RulingJson>({
    operation: "consider", model: LUNA, effort: considerEffort(),
    // A ruling in two phases is taken by its final answer when that reads: a retry rarely beats the deadline.
    instructions: prompt("consider"), input, json: { name: "ruling", schema: rulingSchema(scene, state) }, maxOutputTokens: MAX_OUTPUT_TOKENS, onText, finalAnswer: true,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  return toRuling(scene, state, json, json._meta, { read, ...(context.unheard ? { unheard: context.unheard } : {}) });
}

/** A review that came back, or why it didn't, and what it cost either way. */
export interface Reviewed { ruling?: Ruling; error?: string; costUsd: number; ms: number }

/**
 * The review with a watchdog: past `considerDeadlineMs` its call is cut off, and the turn goes on
 * without it (the engine rolls a freeform check). Never throws: a review that failed says why, with
 * what it had cost (a reply that ran to its token cap is billed all the same; one cut off mid-stream
 * reports no cost, so none is counted).
 */
export async function reviewWithin(scene: Scene, state: SessionState, playerTurn: string, read: PreDecision["considered"], context: Omit<ReviewContext, "signal"> = {}): Promise<Reviewed> {
  const started = performance.now();
  const deadline = considerDeadlineMs();
  const watchdog = new AbortController();
  const timer = setTimeout(() => watchdog.abort(new Error(`the review took longer than ${deadline} ms`)), deadline);
  try {
    const ruling = await considerAct(scene, state, playerTurn, read, { ...context, signal: watchdog.signal });
    return { ruling, costUsd: ruling.costUsd, ms: performance.now() - started };
  } catch (error) {
    const why = watchdog.signal.aborted ? String((watchdog.signal.reason as Error | undefined)?.message ?? "the review was cut off") : error instanceof Error ? error.message : String(error);
    logCall({ provider: "openrouter", operation: "consider", error: `no ruling: ${why}`, latencyMs: Math.round(performance.now() - started), costUsd: costOf(error) });
    return { error: why, costUsd: costOf(error), ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The facts every authored way into a beat or ending from here establishes: what a ruling that takes
 * the scene there has settled too, so whatever checks them (an ending's script, the routes after)
 * finds them (the Rat's "Big Hobb has broken and begun to tell", entering the confession). The ways
 * that simply happen, if any lead there; else the rolls that do, by how this went.
 */
function entryFacts(scene: Scene, state: SessionState, to: string, went: "success" | "failure"): string[] {
  const here = [...currentBeat(scene, state).transitions, ...(scene.anytime ?? [])];
  const plain = here.filter(t => !t.check && t.to === to).map(t => t.establishes ?? []);
  const rolled = here.filter(t => t.check && (went === "success" ? t.check.onSuccess : t.check.onFailure) === to)
    .map(t => (went === "success" ? t.check!.establishes?.success : t.check!.establishes?.failure) ?? []);
  const ways = plain.length ? plain : rolled;
  return ways.length ? ways[0]!.filter(fact => ways.every(w => w.includes(fact))) : [];
}

function toOutcome(scene: Scene, state: SessionState, o: OutcomeJson, went: "success" | "failure"): RulingOutcome {
  const { checks, outcomes } = routesNow(scene, state);
  const places = new Set([...scene.beats.map(b => b.id), ...scene.exits.map(e => e.id)]);
  const counts = outcomes.find(t => t.id === o.counts_as);
  const target = counts?.to ?? (o.to !== "stay" && places.has(o.to) ? o.to : undefined);
  // Never back to a beat the scene has left with something settled since (the Rat's confession, left
  // for "on his feet" by a failed lie about the Master: the name the beat gives freely was lost).
  const to = target && target !== state.beat && !leftBehind(state, target) ? target : undefined;
  // Taken somewhere without counting as a route, it settles what the ways in there settle.
  const entering = to && !counts ? entryFacts(scene, state, to, went) : [];
  const facts = [...(counts?.establishes ?? []), ...entering, ...o.establishes.map(f => f.trim()).filter(Boolean)];
  const open = (id: string) => (scene.essentials ?? []).some(e => e.id === id) && !state.landed?.includes(id);
  const gets: Gets = GETS.includes(o.gets) ? o.gets as Gets : "some";
  // A route tagged with an essential brings it out when it goes the player's way, all the way (Cob
  // trusting them with the page); not on a failure or a refusal (a bribe that gets haggling is tagged
  // too, so it's there only while the page is: it never brings the page).
  const brings = went === "success" && gets === "all" && counts?.essential ? [counts.essential] : [];
  const reveals = [...new Set([...o.reveals, ...brings])].filter(id => id !== "none" && open(id));
  return {
    happens: o.happens.trim(),
    gets,
    ...(to ? { to } : {}),
    ...(counts ? { countsAs: counts.id } : {}),
    establishes: [...new Set(facts)],
    reveals,
    closes: o.closes.filter(id => checks.some(t => t.id === id)),
  };
}

/** Does the outcome change the scene: a move, a fact, something out, a way of trying shut? */
export function changes(o: RulingOutcome): boolean {
  return !!o.to || !!o.countsAs || o.establishes.length > 0 || o.reveals.length > 0 || o.closes.length > 0;
}

/** Does the success lead to, bring out, establish or give anything its failure doesn't? */
export function differs(success: RulingOutcome, failure: RulingOutcome): boolean {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
  return success.to !== failure.to || success.countsAs !== failure.countsAs || success.gets !== failure.gets
    || !same(success.reveals, failure.reveals) || !same(success.closes, failure.closes) || !same(success.establishes, failure.establishes);
}

/**
 * The skill, by the method: a lie is Deception, however friendly its words, by the review's own read
 * or the decider's (sure) one. (A threat that's a bluff stays Intimidation.)
 */
function skillFor(json: RulingJson, read: PreDecision["considered"]): Skill {
  const named = (SKILLS as readonly string[]).includes(json.skill) ? json.skill as Skill : "persuasion";
  const lying = json.lie === true || read?.means === "deception";
  return lying && (named === "persuasion" || named === "performance") ? "deception" : named;
}

/**
 * The review's answer as a ruling: ids checked against the scene, every outcome changing something,
 * a lie rolled as one, the dice line's reason as the player knows things, a failure shutting only a
 * way really tried, a success that's no success (a refusal, or one that shuts a way of trying)
 * marked hollow, so nothing is rolled for it, and one no different from its failure that gets them
 * what they were after marked foregone (a yes).
 */
export function toRuling(scene: Scene, state: SessionState, json: RulingJson, meta: { costUsd: number; latencyMs: number }, context: { read?: PreDecision["considered"]; unheard?: Array<{ name: string; called: string }> } = {}): Ruling {
  const skill = skillFor(json, context.read);
  const act = json.act.trim() || "what the player attempted";
  // A failed roll shuts only a way of trying the player has really tried: one the decider read this
  // attempt as (the thief's lie about a blade shut win-cob, read at .02). Never an authored way without
  // dice (they aren't ways of trying), never on a success, and a no without dice shuts nothing.
  const tried = new Set((context.read?.routes ?? []).filter(r => r.p >= TRIED).map(r => r.id));
  const fix = (o: OutcomeJson, went: "success" | "failure"): RulingOutcome => {
    const read = toOutcome(scene, state, o, went);
    const outcome = went === "failure" ? { ...read, closes: read.closes.filter(id => tried.has(id)) } : read;
    const happens = outcome.happens || (went === "success" ? "It works: they get what they were after." : "It doesn't work, and it costs them: the person they were working on digs in, and this way is shut for now.");
    // An outcome that changes nothing is no outcome: what happens stays on the record at least.
    const how = went === "failure" ? "it failed" : outcome.gets === "none" ? "it didn't work" : "it worked";
    return changes(outcome) ? { ...outcome, happens } : { ...outcome, happens, establishes: [`When the player tried this (${act.replace(/\.$/, "")}), ${how}: ${happens}`] };
  };
  const success = fix(json.success, "success"), failure = fix(json.failure, "failure");
  // A success that gets them nothing is a refusal: no roll could get them that here, and the refusal is
  // the answer. So is one that shuts a way of trying (a lift written as being caught, its wrist seized).
  // One that comes to the same as its failure, and gets them what they were after, needs no dice either: it's a yes.
  const hollow = success.gets === "none" || success.closes.length ? "no roll could get them that here" : undefined;
  const foregone = !hollow && !differs(success, failure) ? "either way it comes to the same" : undefined;
  // The same push again only when something has failed here to be the same as.
  const sameAgain = json.same_again === true && failedTries(scene, state).length > 0;
  return {
    act, target: json.target, skill, lie: json.lie === true,
    judged: { stakes: json.stakes, approach: json.approach, disposition: json.disposition, ...(json.freely === true ? { freely: true } : {}), sameAgain, difficulty: json.difficulty },
    reason: diceReason(scene, state, json.reason, { target: json.target, skill }, context.unheard),
    success, failure, ...(hollow ? { hollow } : {}), ...(foregone ? { foregone } : {}),
    costUsd: meta.costUsd, latencyMs: meta.latencyMs,
  };
}

/** The goal in plain words, by the method, when the review's own would tell the player something they haven't come across. */
const PLAIN_GOAL: Partial<Record<Skill, (who: string) => string>> = {
  persuasion: who => `to win ${who} over`,
  deception: who => `to make ${who} believe you`,
  intimidation: who => `to frighten ${who} into it`,
  insight: who => `to read ${who}`,
  performance: who => `to win ${who} over`,
};

/** Words in the names of things that say nothing of what's there ("the", "left"). */
const PLAIN_WORDS = new Set(["the", "with", "from", "into", "onto", "behind", "inside", "above", "below", "under", "over", "near", "beside", "their", "your", "left", "right", "little", "small", "large", "great", "good", "black", "white", "some", "full", "fistful", "piece", "pair", "side", "back", "front", "door", "wall", "floor"]);

/**
 * Places and things of the scene's world that a text names and the player hasn't heard of (in the
 * hook, any reply, or their own turns): "the tally desk", "the page", before anyone has said so.
 */
export function unheardPlaces(scene: Scene, state: SessionState, text: string): string[] {
  if (!state.world) return [];
  const heard = heardIn(state, [scene.hook]).toLowerCase();
  const said = text.toLowerCase();
  const words = new Set(Object.values(state.world.entities)
    .filter(e => !e.player && e.kind !== "person" && e.kind !== "creature" && e.id !== state.world!.root)
    .flatMap(e => e.name.replace(/\(.*?\)/g, "").toLowerCase().replace(/'s\b/g, "").match(/[a-z]{4,}/g) ?? [])
    .filter(w => !PLAIN_WORDS.has(w)));
  const stem = (w: string) => w.replace(/(?:es|s)$/, "");
  return [...words].filter(w => new RegExp(`\\b${stem(w)}(?:s|es)?\\b`).test(said) && !new RegExp(`\\b${stem(w)}`).test(heard));
}

/**
 * The dice line's reason, which the player reads: the goal as they put it, with nothing in it they
 * haven't heard. Anyone whose name they haven't heard goes by what they'd call them, the player is
 * "you", and a reason that names a place or a thing of the scene they haven't come across gives way
 * to the plain goal ("to win the girl in the shawl over").
 */
export function diceReason(scene: Scene, state: SessionState, reason: string, ruling: { target: string; skill: Skill }, unheard: Array<{ name: string; called: string }> = []): string {
  const strangers = [...unheard, ...Object.entries(unnamed(scene, state)).flatMap(([id, called]) => {
    const c = scene.cast.find(x => x.id === id);
    return c ? [{ name: c.name, called, ...(c.aka ? { aka: c.aka } : {}) }] : [];
  })];
  // (The places are looked for in the review's own words, not in what the player would call people.)
  const own = reason.trim().replace(/\.$/, "");
  if (own && !unheardPlaces(scene, state, own).length) return asYou(asHeard(own, strangers), state.player.name);
  const person = scene.cast.find(c => c.id === ruling.target);
  return (person && PLAIN_GOAL[ruling.skill]?.(asHeard(person.name, strangers))) || "to pull it off";
}

/** Words in people's names that say nothing of who's meant ("Master Sallow", "Big Hobb", "Sergeant Kell"). */
const TITLES = new Set(["big", "little", "old", "young", "master", "mister", "missus", "mistress", "sergeant", "corporal", "captain", "marshal", "king", "queen", "lord", "lady", "sir", "dame", "brother", "sister", "mother", "father", "the"]);

/**
 * The dice line's reason for the roll made without a ruling (the review failed, or ran past its
 * deadline): the plain goal by the method, at whoever present the player's turn names, as the player
 * would call them ("to win the big man with the bandaged hand over"), or "to pull it off".
 */
export function plainReason(scene: Scene, state: SessionState, skill: Skill, playerTurn: string, unheard: Array<{ name: string; called: string }> = []): string {
  const said = playerTurn.toLowerCase();
  const at = (c: { name: string }) => Math.min(...c.name.toLowerCase().split(/[^a-z']+/).filter(w => w.length >= 3 && !TITLES.has(w))
    .map(w => said.search(new RegExp(`\\b${w}\\b`))).filter(i => i >= 0));
  const named = presentCast(scene, state).map(c => ({ id: c.id, at: at(c) })).filter(c => Number.isFinite(c.at)).sort((a, b) => a.at - b.at)[0];
  return diceReason(scene, state, "", { target: named?.id ?? "world", skill }, unheard);
}

/** The player character, in a line they read, is "you" ("so Maud can hear" is "so you can hear"). */
function asYou(text: string, name: string): string {
  const parts = [name, name.split(" ")[0]!].filter(p => p.length >= 3).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text.replace(new RegExp(`\\b(?:${parts.join("|")})('s)?\\b`, "g"), (_, own?: string) => (own ? "your" : "you"));
}

/** What a played outcome says in a line, for the record (and the next ruling). */
function changed(scene: Scene, o: RulingOutcome): string {
  const bits = [o.happens.replace(/\.$/, "")];
  if (o.to) bits.push(`the scene went to ${targetTitle(scene, o.to)}`);
  if (o.reveals.length) bits.push(`came out: ${o.reveals.join(", ")}`);
  if (o.closes.length) bits.push(`closed: ${o.closes.join(", ")}`);
  return bits.join("; ");
}

/**
 * A ruling decides one thing, and what comes out comes out as it says: not what the prep says lies
 * behind it (Moll's paid lie, not the cord mark on a body nobody has looked at), and nothing else
 * people know or hide.
 */
const onlyThis = (): string => prompt("directive-ruling-only-this");

/** The outcome stands as decided: people react to it, but nothing in the reply turns it round (no one spots what went unnoticed). */
const decided = (): string => prompt("directive-ruling-decided");

/** The ruling's own route: a check from here with each outcome's target and facts, or what happens without one (`played`: a no's refusal). */
export function rulingRoute(scene: Scene, state: SessionState, ruling: Ruling, v: Verdict, played?: RulingOutcome): Transition {
  const id = `considered-${state.turn}`;
  const when = `The player's attempt: ${ruling.act.replace(/\.$/, "")}.`;
  const text = (o: RulingOutcome) => `${decided()}: ${o.happens} ${onlyThis()}`;
  if (v.kind === "roll") {
    return {
      id, on: "attempt", when,
      check: {
        skill: ruling.skill, dc: v.dc!, reason: ruling.reason, success: text(ruling.success), failure: text(ruling.failure),
        onSuccess: ruling.success.to ?? state.beat, ...(ruling.failure.to ? { onFailure: ruling.failure.to } : {}),
        establishes: { success: ruling.success.establishes, failure: ruling.failure.establishes },
      },
    };
  }
  const o = played ?? (v.kind === "yes" ? ruling.success : refusalOf(ruling, v));
  return { id, on: "attempt", when, to: o.to ?? state.beat, ...(o.establishes.length ? { establishes: o.establishes } : {}) };
}

/** A plain no: nothing moves, nothing comes out, nothing is shut, nothing is lost. */
const NO_CHANGE: RulingOutcome = { happens: "", gets: "none", establishes: [], reveals: [], closes: [] };

/**
 * What a no without dice plays: an honest refusal, never the failure's cost (that's for a roll that
 * went against them). The review's own, when the success it wrote gets them nothing (Hobb pressing
 * the coin back: "Coin won't keep her safe"), shutting nothing; otherwise the person's (or the
 * world's) plain no, which moves nothing and costs nothing. The same push again keeps the answer it
 * got before.
 */
export function refusalOf(ruling: Ruling, v: Verdict): RulingOutcome {
  return v.no === "hollow" ? { ...ruling.success, closes: [] } : NO_CHANGE;
}

/**
 * The GM's direction for a no without dice: the same answer as before for the same push, the
 * review's own refusal, or a plain no; each an honest one that shows what would reach them and costs
 * nothing more, unless the attempt itself sets something off.
 */
function noDirective(v: Verdict, o: RulingOutcome, who: string | undefined): string {
  const honest = "It's an honest no: it costs the player nothing more than the no (nobody bolts, calls for help or turns on them for it), unless the attempt itself sets something off (a grab that's felt, a shout that's heard).";
  if (v.no === "same_again") {
    return who
      ? `No dice: this is the same push that already failed in this scene, with nothing new on the table, so it gets the same answer it got before. ${who} holds, as before, in their own words, and a little impatience shows. Nothing new comes out, nothing is given or lost, and nothing already said is taken back.`
      : "No dice: this is the same try that already failed in this scene, with nothing changed, so it goes as it went before. Nothing new comes of it, nothing is lost, and nothing already said is taken back.";
  }
  if (v.no === "hollow") return `No dice: this can't get them what they're after (${v.why}). ${decided()}: ${o.happens} ${onlyThis()} ${honest} Their reaction shows what would reach them (what they want, what they fear), in their own words, without spelling it out. Nothing already said is taken back.`;
  return who
    ? `No dice: ${who} won't, not like this (${v.why}). They say no in their own words and character, and their reaction shows what kind of thing would reach them (what they want, what they fear), without spelling it out. ${honest} Nothing comes out, and nothing already said is taken back.`
    : `No dice: not like this (${v.why}). Show plainly what stops it, and let what's around hint at what might work instead, without spelling it out. ${honest} Nothing already said is taken back.`;
}

/**
 * A settled considered turn: the move to make (like any route's), the GM's direction, the record,
 * and what came out (`found`, as the ruling says) or was kept back by how it went (`withheld`: what
 * the outcome not played would have brought out, which no reply can let slip this turn).
 */
export interface Settled { move: Move; directive: string[]; record: RulingRecord; dice?: string; found: string[]; withheld: string[] }

/**
 * Settle the ruling: roll (the rules), choose the outcome (a no without dice plays its refusal), and
 * set its changes in the scene's own machinery (patches for the ways of trying it closes; the move
 * carries the beat and the facts). The caller applies the move as it applies any route's, tells the
 * GM `directive`, and lands what came out.
 */
export async function settleRuling(scene: Scene, state: SessionState, ruling: Ruling, onStep?: (step: ConsiderStep) => void): Promise<Settled> {
  const v = verdict(scene, ruling);
  const name = (id: string) => state.rules?.aliases?.[id] ?? unnamed(scene, state)[id] ?? scene.cast.find(c => c.id === id)?.name ?? id;
  const refusal = v.kind === "no" ? refusalOf(ruling, v) : undefined;
  const route = rulingRoute(scene, state, ruling, v, refusal);
  let move: Move;
  if (v.kind === "roll") {
    onStep?.("roll");
    move = await resolve(scene, state, route, "attempt");
  } else {
    move = { transition: route, phase: "attempt", to: route.to!, chosen: v.kind === "yes", ...exitOf(scene, route.to!) };
  }
  const went = v.kind === "yes" || move.roll?.success ? "success" : "failure";
  const o = refusal ?? (went === "success" ? ruling.success : ruling.failure);
  // What the outcome not played would have brought out is kept back (for a no, what either would have).
  const others = refusal ? [ruling.success, ruling.failure] : [went === "success" ? ruling.failure : ruling.success];
  for (const patch of patchesFor(scene, state, ruling, o)) state.patches.push(patch);
  const method = went === "success" && workedOn(scene, ruling) && (ruling.skill === "intimidation" || ruling.skill === "deception")
    ? ` ${name(ruling.target)} gives way, but will remember how: ${ruling.skill === "deception" ? "the lie is believed, for now" : "they're frightened, and resentful"}.` : "";
  // (Whose no it is: the person worked on, not the one a lift was tried on, who never got to say.)
  const person = scene.cast.some(c => c.id === ruling.target) && !contest(scene, ruling) ? name(ruling.target) : undefined;
  const who = person && `${person[0]!.toUpperCase()}${person.slice(1)}`;
  const lines: string[] = [];
  if (v.kind === "roll") {
    // The check's text is the decided outcome (moveDirective says so with the dice); the method on top.
    lines.push(...moveDirective(scene, state, move));
    if (method) lines[0] = `${lines[0]}${method}`;
  } else if (v.kind === "yes") {
    lines.push(`No dice needed (${v.why}): what the player is attempting works, in the people's own way and voice. ${decided()}: ${o.happens} ${onlyThis()}${method}`, ...moveDirective(scene, state, move));
  } else {
    lines.push(noDirective(v, o, who), ...moveDirective(scene, state, move));
  }
  if (o.closes.length) lines.push(`From here on this way of trying is shut, for the rest of the scene: ${o.closes.map(id => routesNow(scene, state).checks.find(t => t.id === id)?.when.replace(/\.$/, "") ?? id).join("; ")}.`);
  const plainNo = refusal === NO_CHANGE ? (v.no === "same_again" ? "the same answer as before: nothing changed" : `${who ? `${who} said no` : "it couldn't be done like that"}, and nothing else changed`) : undefined;
  const record: RulingRecord = {
    turn: state.turn, act: ruling.act, target: ruling.target, skill: ruling.skill, kind: v.kind, ...(v.dc ? { dc: v.dc } : {}), why: v.why,
    ...(move.roll ? { roll: move.roll } : {}), went, changed: plainNo ?? changed(scene, o), costUsd: ruling.costUsd, latencyMs: ruling.latencyMs,
  };
  return {
    move, directive: lines, record, ...(move.roll ? { dice: describeRoll(move.roll, ruling.reason) } : {}),
    found: o.reveals, withheld: [...new Set(others.flatMap(x => x.reveals))].filter(id => !o.reveals.includes(id)),
  };
}

function exitOf(scene: Scene, to: string): { exit?: Move["exit"] } {
  const exit = scene.exits.find(e => e.id === to);
  return exit ? { exit } : {};
}

/** The ways of trying an outcome shuts, as patches on the scene's prep: closed where they are (the beat's own, or from anywhere). */
export function patchesFor(scene: Scene, state: SessionState, ruling: Ruling, o: RulingOutcome): ScenePatch[] {
  const here = new Set(currentBeat(scene, state).transitions.map(t => t.id));
  return o.closes.map(id => ({ turn: state.turn, close: { beat: here.has(id) ? state.beat : "*", id }, why: `Closed by the ruling on: ${ruling.act}` }));
}

/**
 * What lands on a ruled turn is what the reply showed, as the after-reply decider read it (`judged`),
 * which settles what the story owes the player (an owed essential come across here is owed no more:
 * owed.ts); not what the ruling's list said comes out (the gill of gossip that listed the Heron, its
 * text only "drinking for two"). What the outcome not played would have brought out doesn't land this
 * turn, whatever the reply let slip: the dice kept it back.
 */
export function landRuling(state: SessionState, settled: Pick<Settled, "withheld">, judged: string[] = []): string[] {
  const landed = judged.filter(id => !settled.withheld.includes(id));
  if (landed.length) state.landed = [...new Set([...(state.landed ?? []), ...landed])];
  return landed;
}
