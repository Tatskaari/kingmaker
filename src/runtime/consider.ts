import { respondJson, LUNA, type Effort } from "../llm/openrouter.ts";
import { currentBeat, IMPROVISED_EXIT_ID, presentCast, prompt, sceneBrief, sceneEntries, scriptTranscript, spentHere, targetTitle, unnamed } from "./brief.ts";
import { describeRoll, titleCase } from "./dice.ts";
import { moveDirective, resolve, SOCIAL, type Move, type PreDecision } from "./director.ts";
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
 * establishes, the authored route it amounts to, ways of trying it closes), so the rules roll it like
 * any route, the move applies like any move, and the decider and the GM keep to it afterwards.
 */

/** Steps of a considered turn, as they start: the app's status line moves on at each. */
export type ConsiderStep = "consider" | "weigh" | "success" | "failure" | "roll";

/** What an outcome changes, as the review wrote it. */
export interface RulingOutcome {
  /** What happens, decided, for the GM to narrate. */
  happens: string;
  /** A beat or ending it leads to (undefined: the scene stays where it is). */
  to?: string;
  /** An outcome route of the scene's that this amounts to: its facts come with it, and it leads where it leads. */
  countsAs?: string;
  establishes: string[];
  /** Essentials (ids) that come out. */
  reveals: string[];
  /** Ways of trying (routes with a roll, available now) that this rules out for the rest of the scene. */
  closes: string[];
}

/** The review's judgements, as dc-guidance.md has them. */
export interface Judged {
  stakes: "trivial" | "guarded" | "dangerous" | "ruinous";
  approach: "free" | "no_chance" | "weak" | "plausible" | "strong" | "excellent";
  disposition: "hostile" | "wary" | "friendly";
  sameAgain: boolean;
  difficulty: "trivial" | "easy" | "moderate" | "hard" | "impossible";
}

/** The GM's ruling on a considered act. */
export interface Ruling {
  act: string;
  /** A cast id, or "world" (a feat). */
  target: string;
  skill: Skill;
  judged: Judged;
  /** The dice line's reason: the goal, as the player sees it. */
  reason: string;
  success: RulingOutcome;
  failure: RulingOutcome;
  costUsd: number;
  latencyMs: number;
}

/** Roll or not, and at what. */
export interface Verdict { kind: "roll" | "yes" | "no"; dc?: number; why: string }

const FEAT_DC: Record<string, number> = { easy: 10, moderate: 13, hard: 16 };
const RESIST: Record<string, number> = { trivial: 0, guarded: 1, dangerous: 2, ruinous: 3 };
const LEVER: Record<string, number> = { weak: -1, plausible: 0, strong: 1, excellent: 2 };
const WARMTH: Record<string, number> = { hostile: -1, wary: 0, friendly: 1 };

/** Whether the act is someone being worked on (the guidance's grid), or a feat (its difficulty). */
export function workedOn(scene: Scene, ruling: Pick<Ruling, "target" | "skill">): boolean {
  return (SOCIAL.includes(ruling.skill) || ruling.skill === "insight") && scene.cast.some(c => c.id === ruling.target);
}

/**
 * The verdict from the review's judgements. Working on someone, it's the guidance's grid
 * (docs/research/dc-guidance.md §3.2: what giving in costs them, less the player's leverage and their
 * warmth, 3 points a step from DC 12), leaning towards the dice: the decider has already judged the
 * act uncertain, so it's "yes" without a roll only when they'd do it anyway or it's overwhelming
 * (and never for a lie, which can always be seen through), "no" only for a lever that can't move them
 * or the same push again, and a long shot rolls at 18 rather than failing on the GM's say-so. A feat
 * is DC 10, 13 or 16, or plainly done, or plainly can't be.
 */
export function verdict(scene: Scene, ruling: Pick<Ruling, "target" | "skill" | "judged">): Verdict {
  const j = ruling.judged;
  if (workedOn(scene, ruling)) {
    const said = `${j.stakes}, ${j.approach.replace("_", " ")}, ${j.disposition}`;
    const lie = ruling.skill === "deception";
    if (j.approach === "free") return { kind: "yes", why: `they'd do it anyway (${said})` };
    if (j.stakes === "trivial" && !lie) return { kind: "yes", why: `it costs them nothing (${said})` };
    if (j.approach === "no_chance") return { kind: "no", why: `it pulls a lever that can't move them (${said})` };
    if (j.sameAgain) return { kind: "no", why: `the same push again (${said})` };
    const gap = (RESIST[j.stakes] ?? 1) - (LEVER[j.approach] ?? 0) - (WARMTH[j.disposition] ?? 0);
    if (gap <= -1 && !lie) return { kind: "yes", why: `overwhelming (${said})` };
    return { kind: "roll", dc: Math.min(18, Math.max(10, 9 + 3 * gap)), why: said };
  }
  if (j.difficulty === "trivial") return { kind: "yes", why: "nothing stands in the way" };
  if (j.difficulty === "impossible") return { kind: "no", why: "it can't be done like this" };
  return { kind: "roll", dc: FEAT_DC[j.difficulty] ?? 13, why: j.difficulty };
}

/** The routes a ruling can name: rolled as written and closed (ways of trying), or counted as (what simply happens). */
function routesNow(scene: Scene, state: SessionState): { checks: Transition[]; outcomes: Transition[] } {
  const beat = currentBeat(scene, state);
  const spent = spentHere(state);
  const all = [...beat.transitions, ...(scene.anytime ?? [])].filter(t => !spent.has(t.id) && !state.fought?.includes(t.to ?? ""));
  const phase = (t: Transition) => t.on ?? (t.check ? "attempt" : "outcome");
  return {
    checks: all.filter(t => t.check && phase(t) === "attempt"),
    outcomes: all.filter(t => !t.check && phase(t) === "outcome" && t.to !== IMPROVISED_EXIT_ID),
  };
}

/** An enum that can't be empty (strict schemas refuse one): "none" stands in, and is dropped after. */
const ids = (list: string[]) => (list.length ? list : ["none"]);

function rulingSchema(scene: Scene, state: SessionState) {
  const { checks, outcomes } = routesNow(scene, state);
  const places = [...scene.beats.map(b => b.id), ...scene.exits.filter(e => e.id !== IMPROVISED_EXIT_ID).map(e => e.id)];
  const essentials = (scene.essentials ?? []).filter(e => !state.landed?.includes(e.id)).map(e => e.id);
  const outcome = {
    type: "object", additionalProperties: false,
    required: ["happens", "to", "counts_as", "establishes", "reveals", "closes"],
    properties: {
      happens: { type: "string", description: "What happens, decided, for the GM to narrate: who does what, what comes out, what it costs. One to three concrete sentences." },
      to: { type: "string", enum: ["stay", ...places], description: "A beat or ending the scene moves to, only when what happens is what it's about; stay otherwise." },
      counts_as: { type: "string", enum: ["none", ...outcomes.map(t => t.id)], description: "If what happens is what one of the scene's routes that simply happen describes (something found, said or settled), that route: its facts come with it and it leads where it leads." },
      establishes: { type: "array", items: { type: "string" }, description: "Facts now true that the story must keep, as short statements: who gave what up or now holds it, who has gone where or won't talk, what was promised, agreed or lost." },
      reveals: { type: "array", items: { type: "string", enum: ids(essentials) }, description: "Things the player needs to come across that come out in this outcome (none, often)." },
      closes: { type: "array", items: { type: "string", enum: ids(checks.map(t => t.id)) }, description: "Ways of trying (routes with a roll) that this outcome rules out for the rest of the scene: the person has bolted, the bridge is burnt. None, usually." },
    },
  };
  const present = presentCast(scene, state).map(c => c.id);
  return {
    type: "object", additionalProperties: false,
    required: ["act", "target", "skill", "stakes", "approach", "disposition", "same_again", "difficulty", "reason", "success", "failure"],
    properties: {
      act: { type: "string", description: "What the player is attempting, in a few words." },
      target: { type: "string", enum: [...present, "world"], description: "Who they're working on, or world for a feat." },
      skill: { type: "string", enum: [...SKILLS], description: "The skill that decides it, by the player's method." },
      stakes: { type: "string", enum: ["trivial", "guarded", "dangerous", "ruinous"], description: "Working on someone: what giving in would cost them, as they see it." },
      approach: { type: "string", enum: ["free", "no_chance", "weak", "plausible", "strong", "excellent"], description: "Working on someone: what the player says, offers or shows, against who this person is. free: they'd do it anyway, or it follows up on what they've already given, agreed to or been paid for; no_chance: a lever that can't move them; weak: no real reason; plausible: some reason, not aimed at them; strong: real leverage on them; excellent: aimed squarely at what they want or fear." },
      disposition: { type: "string", enum: ["hostile", "wary", "friendly"], description: "Working on someone: how they feel about the player right now." },
      same_again: { type: "boolean", description: "The same push that already failed in this scene, with nothing new on the table." },
      difficulty: { type: "string", enum: ["trivial", "easy", "moderate", "hard", "impossible"], description: "A feat (no one being worked on): how hard, here and now." },
      reason: { type: "string", description: "For the dice line, the goal as the player sees it, never the answer: 'to talk the ferryman into crossing tonight'." },
      success: outcome,
      failure: outcome,
    },
  };
}

interface RulingJson {
  act: string; target: string; skill: string;
  stakes: Judged["stakes"]; approach: Judged["approach"]; disposition: Judged["disposition"]; same_again: boolean; difficulty: Judged["difficulty"];
  reason: string;
  success: OutcomeJson; failure: OutcomeJson;
}
interface OutcomeJson { happens: string; to: string; counts_as: string; establishes: string[]; reveals: string[]; closes: string[] }

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

/**
 * The GM's review: the whole prep (every fact), where the scene stands, the routes, the earlier
 * rulings, the world, the scene so far and the player's turn; one structured answer. `onStep` hears
 * each step start (the call, then each section of the answer as it streams).
 */
export async function considerAct(scene: Scene, state: SessionState, playerTurn: string, read: PreDecision["considered"], onStep?: (step: ConsiderStep) => void): Promise<Ruling> {
  const beat = currentBeat(scene, state);
  const { checks, outcomes } = routesNow(scene, state);
  const line = (t: Transition) => t.check
    ? `- [${t.id}] ${t.when} (${titleCase(t.check.skill)} DC ${t.check.dc}${t.check.reason ? `, ${t.check.reason.trim().replace(/\.$/, "")}` : ""}; success: ${t.check.success} -> ${targetTitle(scene, t.check.onSuccess)}; failure: ${t.check.failure}${t.check.onFailure ? ` -> ${targetTitle(scene, t.check.onFailure)}` : ""})`
    : `- [${t.id}] ${t.when} -> ${targetTitle(scene, t.to!)}`;
  const beats = scene.beats.map(b => `- [${b.id}] ${b.title}: ${b.direction.split(/(?<=\.)\s/).slice(0, 2).join(" ")}`);
  const endings = scene.exits.filter(e => e.id !== IMPROVISED_EXIT_ID).map(e => `- [${e.id}] ${e.title}: ${e.outcome}`);
  const essentials = (scene.essentials ?? []).map(e => `- [${e.id}] ${e.what} (placed with: ${e.placedWith.join("; ")}) ${state.landed?.includes(e.id) ? "ALREADY COME ACROSS" : "NOT YET"}`);
  const rulings = (state.rulings ?? []).map(r => `- turn ${r.turn}: ${r.act} (${r.target}; ${r.kind === "roll" ? `${titleCase(r.skill)} DC ${r.dc}, ${r.roll ? describeRoll(r.roll) : "rolled"}` : r.kind === "yes" ? "no roll: it worked" : "no roll: it couldn't work like that"}): ${r.changed}`);
  const strangers = Object.entries(unnamed(scene, state)).map(([id, called]) => `${scene.cast.find(c => c.id === id)?.name} ("${called}")`);
  const read_ = leaning(read);
  const input = [
    { role: "developer" as const, content: sceneBrief(scene, state) },
    { role: "user" as const, content: [
      `## Where the scene is: [${beat.id}] ${beat.title}\n${beat.direction}\n(${state.turnsInBeat} exchange${state.turnsInBeat === 1 ? "" : "s"} at this point.)`,
      `## The scene's beats\n${beats.join("\n")}\n\n## Its endings\n${endings.join("\n")}`,
      `## Routes from here with a roll (ways of trying)\n${checks.map(line).join("\n") || "(none)"}`,
      `## Routes from here that simply happen\n${outcomes.map(line).join("\n") || "(none)"}`,
      ...(essentials.length ? [`## What the player needs to come across\n${essentials.join("\n")}`] : []),
      `## Established so far\n${[...state.established, ...state.canon].map(f => `- ${f}`).join("\n") || "(nothing yet)"}`,
      ...(rulings.length ? [`## Your earlier rulings in this scene\n${rulings.join("\n")}`] : []),
      ...(state.pendingExit ? [`## On the brink\nUnless this turn changes things, the scene ends next: ${scene.exits.find(e => e.id === state.pendingExit!.exitId)?.title ?? state.pendingExit.exitId}. A success can stop it; a failure lets it happen (lead there).`] : []),
      ...(state.world ? [`## The world right now (who and what is where)\n${worldView(state.world)}`] : []),
      ...(strangers.length ? [`## Names the player hasn't heard yet (don't use them in the reason)\n${strangers.join("; ")}`] : []),
      `## The scene so far\n${scriptTranscript(scene, state, sceneEntries(state).slice(-24))}`,
      `## Rule on this: the player's latest turn\n${playerTurn}${read_ ? `\n\n${read_}` : ""}`,
    ].join("\n\n") },
  ];
  onStep?.("consider");
  const seen = new Set<ConsiderStep>();
  const onText = (text: string) => {
    for (const [key, step] of SECTIONS) if (!seen.has(step) && text.includes(key)) { seen.add(step); onStep?.(step); }
  };
  const json = await respondJson<RulingJson>({
    operation: "consider", model: LUNA, effort: considerEffort(),
    instructions: prompt("consider"), input, json: { name: "ruling", schema: rulingSchema(scene, state) }, maxOutputTokens: 6000, onText,
  });
  return toRuling(scene, state, json, json._meta);
}

function toOutcome(scene: Scene, state: SessionState, o: OutcomeJson): RulingOutcome {
  const { checks, outcomes } = routesNow(scene, state);
  const places = new Set([...scene.beats.map(b => b.id), ...scene.exits.map(e => e.id)]);
  const counts = outcomes.find(t => t.id === o.counts_as);
  const target = counts?.to ?? (o.to !== "stay" && places.has(o.to) ? o.to : undefined);
  const to = target && target !== state.beat ? target : undefined;
  const facts = [...(counts?.establishes ?? []), ...o.establishes.map(f => f.trim()).filter(Boolean)];
  return {
    happens: o.happens.trim(),
    ...(to ? { to } : {}),
    ...(counts ? { countsAs: counts.id } : {}),
    establishes: [...new Set(facts)],
    reveals: o.reveals.filter(id => id !== "none" && (scene.essentials ?? []).some(e => e.id === id) && !state.landed?.includes(id)),
    closes: o.closes.filter(id => checks.some(t => t.id === id)),
  };
}

/** Does the outcome change the scene: a move, a fact, something out, a way of trying shut? */
export function changes(o: RulingOutcome): boolean {
  return !!o.to || !!o.countsAs || o.establishes.length > 0 || o.reveals.length > 0 || o.closes.length > 0;
}

/** The review's answer as a ruling: ids checked against the scene, and every outcome changing something. */
export function toRuling(scene: Scene, state: SessionState, json: RulingJson, meta: { costUsd: number; latencyMs: number }): Ruling {
  const skill = (SKILLS as readonly string[]).includes(json.skill) ? json.skill as Skill : "persuasion";
  const act = json.act.trim() || "what the player attempted";
  const fix = (o: OutcomeJson, went: "success" | "failure"): RulingOutcome => {
    const outcome = toOutcome(scene, state, o);
    const happens = outcome.happens || (went === "success" ? "It works: they get what they were after." : "It doesn't work, and it costs them: the person they were working on digs in, and this way is shut for now.");
    // An outcome that changes nothing is no outcome: what happens stays on the record at least.
    return changes(outcome) ? { ...outcome, happens } : { ...outcome, happens, establishes: [`When the player tried this (${act.replace(/\.$/, "")}), ${went === "success" ? "it worked" : "it failed"}: ${happens}`] };
  };
  return {
    act, target: json.target, skill,
    judged: { stakes: json.stakes, approach: json.approach, disposition: json.disposition, sameAgain: json.same_again === true, difficulty: json.difficulty },
    reason: json.reason.trim(),
    success: fix(json.success, "success"), failure: fix(json.failure, "failure"),
    costUsd: meta.costUsd, latencyMs: meta.latencyMs,
  };
}

/** What a played outcome says in a line, for the record (and the next ruling). */
function changed(scene: Scene, o: RulingOutcome): string {
  const bits = [o.happens.replace(/\.$/, "")];
  if (o.to) bits.push(`the scene went to ${targetTitle(scene, o.to)}`);
  if (o.reveals.length) bits.push(`came out: ${o.reveals.join(", ")}`);
  if (o.closes.length) bits.push(`closed: ${o.closes.join(", ")}`);
  return bits.join("; ");
}

/** A ruling decides one thing: the rest of what people know or hide waits for the player to get to it. */
const ONLY_THIS = "Only what's decided here: whatever else people know or hide stays theirs until the player gets to it.";

/** The outcome stands as decided: people react to it, but nothing in the reply turns it round (no one spots what went unnoticed). */
const DECIDED = "Decided, and it stands (people react to it, but nothing in this reply undoes, reverses or spoils it)";

/** What comes out in an outcome, for the GM: the thing itself, in so many words; and nothing else does. */
function revealed(scene: Scene, o: RulingOutcome): string {
  const what = o.reveals.map(id => scene.essentials?.find(e => e.id === id)?.what).filter(Boolean);
  return `${what.length ? ` This comes out now: ${what.join(" ")}` : ""} ${ONLY_THIS}`;
}

/** The ruling's own route: a check from here with each outcome's target and facts, or what happens without one. */
export function rulingRoute(scene: Scene, state: SessionState, ruling: Ruling, v: Verdict): Transition {
  const id = `considered-${state.turn}`;
  const when = `The player's attempt: ${ruling.act.replace(/\.$/, "")}.`;
  const text = (o: RulingOutcome) => `${DECIDED}: ${o.happens}${revealed(scene, o)}`;
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
  const o = v.kind === "yes" ? ruling.success : ruling.failure;
  return { id, on: "attempt", when, to: o.to ?? state.beat, ...(o.establishes.length ? { establishes: o.establishes } : {}) };
}

/** A settled considered turn: the move to make (like any route's), the GM's direction, and the record. */
export interface Settled { move: Move; directive: string[]; record: RulingRecord; dice?: string }

/**
 * Settle the ruling: roll (the rules), choose the outcome, and set its changes in the scene's own
 * machinery (patches for the ways of trying it closes; the move carries the beat and the facts). The
 * caller applies the move as it applies any route's, and tells the GM `directive`.
 */
export async function settleRuling(scene: Scene, state: SessionState, ruling: Ruling, onStep?: (step: ConsiderStep) => void): Promise<Settled> {
  const v = verdict(scene, ruling);
  const name = (id: string) => state.rules?.aliases?.[id] ?? unnamed(scene, state)[id] ?? scene.cast.find(c => c.id === id)?.name ?? id;
  const route = rulingRoute(scene, state, ruling, v);
  let move: Move;
  if (v.kind === "roll") {
    onStep?.("roll");
    move = await resolve(scene, state, route, "attempt");
  } else {
    move = { transition: route, phase: "attempt", to: route.to!, chosen: v.kind === "yes", ...exitOf(scene, route.to!) };
  }
  const went = v.kind === "yes" || move.roll?.success ? "success" : "failure";
  const o = went === "success" ? ruling.success : ruling.failure;
  for (const patch of patchesFor(scene, state, ruling, o)) state.patches.push(patch);
  const method = went === "success" && workedOn(scene, ruling) && (ruling.skill === "intimidation" || ruling.skill === "deception")
    ? ` ${name(ruling.target)} gives way, but will remember how: ${ruling.skill === "deception" ? "the lie is believed, for now" : "they're frightened, and resentful"}.` : "";
  const lines: string[] = [];
  if (v.kind === "roll") {
    // The check's text is the decided outcome (moveDirective says so with the dice); the method on top.
    lines.push(...moveDirective(scene, state, move));
    if (method) lines[0] = `${lines[0]}${method}`;
  } else if (v.kind === "yes") {
    lines.push(`No dice needed (${v.why}): what the player is attempting works, in the people's own way and voice. ${DECIDED}: ${o.happens}${revealed(scene, o)}${method}`, ...moveDirective(scene, state, move));
  } else {
    lines.push(`No dice: this can't work like this (${v.why}). ${DECIDED}: ${o.happens}${revealed(scene, o)} Their reaction shows their own concerns (what they want, what they fear), in their own words; nobody tells the player what would work. Nothing already said is taken back.`, ...moveDirective(scene, state, move));
  }
  if (o.closes.length) lines.push(`From here on this way of trying is shut, for the rest of the scene: ${o.closes.map(id => routesNow(scene, state).checks.find(t => t.id === id)?.when.replace(/\.$/, "") ?? id).join("; ")}.`);
  const record: RulingRecord = {
    turn: state.turn, act: ruling.act, target: ruling.target, skill: ruling.skill, kind: v.kind, ...(v.dc ? { dc: v.dc } : {}), why: v.why,
    ...(move.roll ? { roll: move.roll } : {}), went, changed: changed(scene, o), costUsd: ruling.costUsd, latencyMs: ruling.latencyMs,
  };
  return { move, directive: lines, record, ...(move.roll ? { dice: describeRoll(move.roll, ruling.reason) } : {}) };
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
