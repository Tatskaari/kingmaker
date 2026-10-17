import { respond, type Message } from "../llm/openrouter.ts";
import { runTools, type ToolDef } from "../llm/tools.ts";
import { rollFor } from "../rules/dnd.ts";
import { stageManage } from "../world/stage.ts";
import { joinWorld } from "../world/scene-world.ts";
import { sceneById } from "../../scenes/index.ts";
import { castBlock, currentBeat, nowNote, openRoutes, presentCast, prompt, sceneBrief, scriptTranscript, targetTitle } from "./brief.ts";
import { describeRoll, titleCase, type RollResult } from "./dice.ts";
import { finishScene, openingDirective, push, type TurnHooks, type TurnResult } from "./engine.ts";
import { SKILLS, type Scene, type Skill, type Transition } from "./scene.ts";
import { saveSession, snapshotSession, type SessionState, type TurnMetric } from "./session.ts";

/**
 * Approach "two-part": the GM in two parts.
 * - The mouthpiece (prompts/two-part-gm.md) voices the scene. Its instructions are the scene's prep as
 *   authored, and stay put for the scene; before each player turn a note from the co-GM gives every
 *   character's situation now and the role they play this turn, beside the per-turn note the v2 GM
 *   gets (where the scene is, what's established, the world, names not yet heard).
 * - It asks for a check when a roll should settle something, writing all five outcomes; the rules
 *   roll it, and the outcome that came up is what the player reads.
 * - The co-GM (prompts/two-part-co-gm.md) runs after each reply, beside the stage manager. It keeps
 *   each character's role (the beat's `cast` notes are its suggestions; what a character remembers,
 *   wants or owes can override them) and moves the scene on along the scene's own routes, which the
 *   runtime checks against the current beat before taking.
 */

export interface Role { status: string; mental_state: string; conversation_role: string }

export const BANDS = ["major_failure", "minor_failure", "barely_passed", "minor_success", "major_success"] as const;
export type Band = typeof BANDS[number];
const BAND_NAME: Record<Band, string> = { major_failure: "badly", minor_failure: "narrowly", barely_passed: "only just", minor_success: "cleanly", major_success: "with room to spare" };

/** How far a roll made or missed it, as one of the five outcomes the mouthpiece wrote. */
export function bandOf(roll: Pick<RollResult, "total" | "dc" | "critical">): Band {
  if (roll.critical === "failure") return "major_failure";
  if (roll.critical === "success") return "major_success";
  const by = roll.total - roll.dc;
  return by <= -5 ? "major_failure" : by < 0 ? "minor_failure" : by <= 2 ? "barely_passed" : by <= 6 ? "minor_success" : "major_success";
}

const FORMAT = `## How to reply
Reply as JSON with two fields.
- \`narration\`: what you say to the player this turn, with a blank line between paragraphs as usual.
- \`check\`: null on most turns. When the player attempts something whose outcome is uncertain and matters (seeing through a lie, winning someone over, a climb, a close look at something that hides a clue), and the roll would move the scene towards a beat, call for a skill check instead of deciding it yourself. Where your prep's routes say the dice decide something the player is trying, use that route's skill and DC. Then \`narration\` sets up the attempt and stops before the result, and \`check\` gives the skill, a DC (10 easy, 13 moderate, 15 hard, 18 very hard) and five outcomes. The game rolls the dice with the player's own modifiers, and the player sees your narration, the roll, and the one outcome that came up.
  Write each outcome as the next words of the reply, carrying straight on from the narration, in the same voice and length as any reply (the characters react, then stop for the player):
  - major_failure (missed by 5 or more): it goes wrong, with a cost: offence taken, a door shut for now, a wrong impression.
  - minor_failure (missed by 1 to 4): no progress, a small complication, and a hint of another way in.
  - barely_passed (made it, by 0 to 2): the next step, with a catch or only part of it.
  - minor_success (beat it by 3 to 6): the next step, cleanly.
  - major_success (beat it by 7 or more): the next step and a little more: the character warms, or a further hook opens.
  Even a major success gives only what the attempt could earn now: the next step for that character, never the whole of a secret.
- Don't roll or report numbers yourself, and don't ask the player to roll: the check is how you ask.`;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["narration", "check"],
  properties: {
    narration: { type: "string" },
    check: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false, required: ["skill", "dc", "outcomes"],
      properties: {
        skill: { type: "string", enum: [...SKILLS] }, dc: { type: "integer" },
        outcomes: { type: "object", additionalProperties: false, required: [...BANDS], properties: Object.fromEntries(BANDS.map(b => [b, { type: "string" }])) },
      },
    }] },
  },
};

/** A route as the prep puts it, with its id (the co-GM's handle on it). */
function routeLine(scene: Scene, t: Transition): string {
  const how = t.check
    ? `the dice decide (${titleCase(t.check.skill)}, DC ${t.check.dc}): success leads to ${targetTitle(scene, t.check.onSuccess)}; failure ${t.check.onFailure ? `to ${targetTitle(scene, t.check.onFailure)}` : "leaves the scene where it is"}`
    : `leads to ${targetTitle(scene, t.to!)}`;
  return `- [${t.id}] ${t.when} (${how}; ${t.on ?? (t.check ? "attempt" : "outcome")})`;
}

/** Every beat, how to play it and the routes out of it: the scene's spine. */
function beatsBlock(scene: Scene, options: { cast?: boolean } = {}): string {
  return `## The beats\nThe scene starts at "${targetTitle(scene, scene.start)}". It moves on along these routes only.\n\n${scene.beats.map(b => [
    `### ${b.title} [${b.id}]`, b.direction,
    ...(options.cast && b.cast && Object.keys(b.cast).length ? [`Suggested roles while the scene is here:\n${Object.entries(b.cast).map(([id, note]) => `- ${scene.cast.find(c => c.id === id)?.name ?? id} [${id}]: ${note}`).join("\n")}`] : []),
    ...(b.pressure ? [`If it stalls here: ${b.pressure}`] : []),
    `Routes:\n${b.transitions.map(t => routeLine(scene, t)).join("\n")}`,
  ].join("\n")).join("\n\n")}${scene.anytime?.length ? `\n\n### From anywhere\n${scene.anytime.map(t => routeLine(scene, t)).join("\n")}` : ""}`;
}

/** The prep, as the v2 GM has it, without the people (they're the characters) or the table rules (the check is how this GM asks for dice). */
function premise(scene: Scene, state: SessionState, options: { cast?: boolean } = {}): string {
  const sections = sceneBrief(scene, state).split(/\n\n(?=## )/).filter(s => !s.startsWith("## The people here") && !s.startsWith("## Table rules"));
  return `${sections.join("\n\n")}\n\n${beatsBlock(scene, options)}`;
}

function characters(scene: Scene, state: SessionState): string {
  const present = new Set(presentCast(scene, state).map(c => c.id));
  return scene.cast.map(c => castBlock(scene, c, present.has(c.id))).join("\n\n");
}

const tone = () => prompt("tone-comic");

export function mouthpieceInstructions(scene: Scene, state: SessionState): string {
  return `${prompt("two-part-gm", { tone: tone(), beats: premise(scene, state), characters: characters(scene, state) })}\n\n${FORMAT}`;
}

export function rolesNote(scene: Scene, roles: Record<string, Role>, turn: number): string {
  return [`Co-GM note, before turn ${turn + 1}`, ...Object.entries(roles).map(([id, r]) => [
    `Character role for ${scene.cast.find(c => c.id === id)?.name ?? id}:`,
    ...(r.status ? [`Status: ${r.status}`] : []), ...(r.mental_state ? [`Mental state: ${r.mental_state}`] : []),
    `Conversation role: ${r.conversation_role}`,
  ].join("\n"))].join("\n\n");
}

/** A GM turn as the player read it: the narration, and for a check its dice line and the outcome that came up. */
function gmText(entries: SessionState["transcript"]): string {
  return entries.filter(e => e.kind !== "player").map(e => e.kind === "roll" ? `🎲 ${e.text}` : e.text).join("\n\n");
}

/**
 * The mouthpiece's history: the co-GM's notes (as system messages, each before the player turn it
 * was written for), the player's turns and its own replies. The latest note goes last with the
 * per-turn note beside it, so the reply has the world as it stands.
 */
export function mouthpieceInput(scene: Scene, state: SessionState, directive: string[]): Message[] {
  const notes = state.twoPart!.notes;
  const here = state.transcript.filter(e => (e.scene ?? state.sceneId) === state.sceneId);
  const input: Message[] = [];
  // Turn t's note was written after the reply to turn t-1 (the opening's, -1, before the scene began).
  for (let t = 0; t <= state.turn; t++) {
    const note = notes.find(n => n.turn === t - 1)?.text;
    const now = t === state.turn ? nowNote(scene, state, directive, { castNotes: false }) : undefined;
    if (note || now) input.push({ role: "system", content: [note, now].filter(Boolean).join("\n\n") });
    input.push({ role: "user", content: t === 0 ? "(The player is ready. Begin.)" : here.find(e => e.turn === t && e.kind === "player")?.text ?? "(The player waits.)" });
    if (t < state.turn) input.push({ role: "assistant", content: gmText(here.filter(e => e.turn === t && e.kind !== "system")) });
  }
  return input;
}

/** The mouthpiece's reply, onto the transcript: its narration, and for a check the roll and the outcome that came up. */
async function speak(scene: Scene, state: SessionState, hooks: TurnHooks, directive: string[], operation: string, options: { mayHold?: boolean } = {}): Promise<{ costUsd: number; firstTextMs: number; replyMs: number; text: string; closes: boolean }> {
  const started = performance.now();
  // A closing that may wait once says whether it closed: { closes } beside the reply.
  const schema = options.mayHold ? { ...SCHEMA, required: [...SCHEMA.required, "closes"], properties: { ...SCHEMA.properties, closes: { type: "boolean" } } } : SCHEMA;
  const result = await respond({ operation, instructions: mouthpieceInstructions(scene, state), input: mouthpieceInput(scene, state, directive), effort: "none", maxOutputTokens: 2500, json: { name: "reply", schema } });
  const out = JSON.parse(result.text) as { narration: string; check: { skill: Skill; dc: number; outcomes: Record<Band, string> } | null; closes?: boolean };
  const replyMs = performance.now() - started;
  const narrate = (text: string) => {
    hooks.onSpeaker?.("gm", "narration");
    hooks.onText?.(text);
    push(state, hooks, { speaker: "gm", kind: "narration", text });
  };
  let text = out.narration.trim();
  narrate(text);
  if (out.check && SKILLS.includes(out.check.skill)) {
    const roll = await rollFor(state, out.check.skill, out.check.dc);
    const band = bandOf(roll);
    push(state, hooks, { speaker: "dice", kind: "roll", text: `${describeRoll(roll)} (${BAND_NAME[band]}).` });
    narrate(out.check.outcomes[band].trim());
    text = `${text}\n\n${out.check.outcomes[band].trim()}`;
  }
  return { costUsd: result.costUsd, firstTextMs: replyMs, replyMs, text, closes: out.closes !== false };
}

/**
 * The scene moved on after the last reply (the co-GM took a route), so this reply shows it: the beat
 * it's at now, and whoever that brings on, seen arriving. Moved on silently, the corporal and his
 * cart were simply in the lane, never seen coming.
 */
export function movedDirective(scene: Scene, state: SessionState): string | undefined {
  const moved = state.twoPart?.moved;
  if (!moved || moved !== state.beat) return undefined;
  const beat = currentBeat(scene, state);
  const arriving = scene.cast.filter(c => c.enters === beat.id).map(c => c.called ?? c.name);
  return `The scene has just moved on to "${beat.title}": ${beat.direction} Answer the player's turn first; then let it show in this reply${arriving.length ? `: ${arriving.join(" and ")} arrive${arriving.length === 1 ? "s" : ""} now, seen arriving` : ""}.`;
}

/** The opening roles: each present character's note for the first beat (the co-GM takes over after the opening). */
function openingRoles(scene: Scene, state: SessionState): Record<string, Role> {
  const beat = currentBeat(scene, state);
  return Object.fromEntries(presentCast(scene, state).map(c => [c.id, { status: "", mental_state: "", conversation_role: beat.cast?.[c.id] ?? c.attitude }]));
}

export async function twoPartOpening(scene: Scene, state: SessionState, hooks: TurnHooks): Promise<void> {
  state.twoPart = { roles: openingRoles(scene, state), notes: [] };
  state.twoPart.notes.push({ turn: -1, text: rolesNote(scene, state.twoPart.roles, -1) });
  await speak(scene, state, hooks, [openingDirective(scene, state)], "two-part.opening");
}

// --- The co-GM ----------------------------------------------------------------------------------

const UPDATE_ROLE: ToolDef = {
  name: "update_character_role",
  description: "Set a character's role for the GM's next reply. The GM sees every character's latest role before each player turn. Call it for each character whose role should change after the latest exchange; a character you don't update keeps their last role.",
  parameters: {
    type: "object", additionalProperties: false, required: ["char_id", "status", "mental_state", "conversation_role"],
    properties: {
      char_id: { type: "string", description: "The character's id, in square brackets in your prep." },
      status: { type: "string", description: "What the character is doing and where, right now. E.g. 'Sitting on the wall above the yard, fist shut.'" },
      mental_state: { type: "string", description: "How they feel right now, towards the player and the situation. E.g. 'Cob is overly fearful of the newcomer, and hiding it with cheek.'" },
      conversation_role: { type: "string", description: "What they could do or reveal next to move the scene towards a beat, and what they hold back for now. E.g. 'Cob could let slip that he sleeps in the loft and was hiding there when the men came; he won't say who.'" },
    },
  },
};

const MOVE_SCENE: ToolDef = {
  name: "move_scene",
  description: "Move the scene on along one of its routes from where it is now, once what the route describes has happened in the story (or, for a cue, when its moment has come). A route the dice decide takes the outcome of the check the GM called on it. Leading to an ending, the scene closes on the GM's next reply.",
  parameters: {
    type: "object", additionalProperties: false, required: ["route_id", "outcome", "why"],
    properties: {
      route_id: { type: "string", description: "The route's id, in square brackets in your prep." },
      outcome: { type: "string", enum: ["success", "failure", "none"], description: "For a route the dice decide: how the GM's check on it went. Otherwise 'none'." },
      why: { type: "string", description: "What happened in the story that takes this route, in a sentence." },
    },
  },
};

const CO_GM_TOOLS = `## Your tools
- update_character_role: each character's role for the GM's next reply. While the scene is at a beat, that beat's suggested roles are your default for each character; what a character remembers, wants, has been promised or owes, and what just happened, can give them a better reason, and then that wins. Keep each role to what they do or could reveal next, and what they hold back for now.
- move_scene: when what one of the open routes describes has happened in the story (or a cue's moment has come), take it. Only the routes listed as open can be taken. When the scene moves to a new beat, update the roles for it. Don't hold the scene at a beat the story has already moved past; don't take a route for something that hasn't happened yet.
Then reply "done".`;

function routesNow(scene: Scene, state: SessionState): Transition[] {
  return openRoutes([...currentBeat(scene, state).transitions, ...(scene.anytime ?? [])], state);
}

/** Take a route the co-GM chose: checked against the routes open now, as the engine takes a move. */
export function takeRoute(scene: Scene, state: SessionState, routeId: string, outcome: "success" | "failure" | "none"): string {
  const t = routesNow(scene, state).find(r => r.id === routeId);
  if (!t) return `error: "${routeId}" isn't open from here. Open routes: ${routesNow(scene, state).map(r => r.id).join(", ")}.`;
  if (t.check && outcome === "none") return `error: the dice decide "${routeId}": give the outcome of the GM's check on it, or wait for one.`;
  const to = t.check ? (outcome === "success" ? t.check.onSuccess : t.check.onFailure ?? state.beat) : t.to!;
  const facts = [...(t.establishes ?? []), ...(t.check?.establishes ? (outcome === "success" ? t.check.establishes.success : t.check.establishes.failure) ?? [] : [])];
  for (const fact of facts) if (!state.established.includes(fact)) state.established.push(fact);
  const exit = scene.exits.find(e => e.id === to);
  state.path.push({ turn: state.turn, from: state.beat, to, via: t.id, source: "post", known: state.established.length });
  if (exit) {
    state.closing = { exitId: exit.id, turn: state.turn };
    return `The scene is ending: ${exit.title}. The GM closes it on the next reply.`;
  }
  if (to !== state.beat) {
    state.beat = to;
    state.turnsInBeat = 0;
    const beat = currentBeat(scene, state);
    return `Moved to "${beat.title}". Its suggested roles: ${Object.entries(beat.cast ?? {}).map(([id, n]) => `${id}: ${n}`).join("; ") || "(none)"}. Update the characters' roles for it. Open routes now: ${routesNow(scene, state).map(r => r.id).join(", ")}.`;
  }
  return `Taken; the scene stays at "${currentBeat(scene, state).title}".`;
}

function coGmInput(scene: Scene, state: SessionState): Message[] {
  const tp = state.twoPart!;
  const beat = currentBeat(scene, state);
  const present = presentCast(scene, state);
  return [{ role: "user", content: [
    `# The scene so far\n\n${scriptTranscript(scene, state)}`,
    `# Where the scene is: ${beat.title} [${beat.id}]\nIt has been here for ${state.turnsInBeat} exchange${state.turnsInBeat === 1 ? "" : "s"}.${beat.cast ? `\nSuggested roles while it's here:\n${Object.entries(beat.cast).filter(([id]) => present.some(c => c.id === id)).map(([id, n]) => `- ${id}: ${n}`).join("\n")}` : ""}\nOpen routes:\n${routesNow(scene, state).map(t => routeLine(scene, t)).join("\n")}`,
    ...(state.established.length ? [`# Established in play\n${state.established.map(f => `- ${f}`).join("\n")}`] : []),
    `# Current character roles\n\n${rolesNote(scene, tp.roles, state.turn).split("\n\n").slice(1).join("\n\n")}`,
    `# Who's on stage now\n${present.map(c => `- ${c.name} [${c.id}]`).join("\n")}`,
    `The GM's reply to turn ${state.turn} is the latest exchange. Update the roles that need it, and move the scene on if a route's moment has come.`,
  ].join("\n\n") }];
}

async function coGm(scene: Scene, state: SessionState): Promise<{ costUsd: number }> {
  const tp = state.twoPart!;
  const instructions = `${prompt("two-part-co-gm", { tone: tone(), beats: premise(scene, state, { cast: true }), characters: characters(scene, state) })}\n\n${CO_GM_TOOLS}`;
  const result = await runTools({ operation: "two-part.co-gm", instructions, input: coGmInput(scene, state), tools: [UPDATE_ROLE, MOVE_SCENE], effort: "low", maxTurns: 16 }, async (name, args) => {
    if (name === "move_scene") return takeRoute(scene, state, String(args.route_id), (args.outcome as "success" | "failure" | "none") ?? "none");
    const id = String(args.char_id);
    if (!scene.cast.some(c => c.id === id)) return `error: no character "${id}" (ids: ${scene.cast.map(c => c.id).join(", ")})`;
    tp.roles[id] = { status: String(args.status ?? ""), mental_state: String(args.mental_state ?? ""), conversation_role: String(args.conversation_role ?? "") };
    return "ok";
  });
  tp.log = [...(tp.log ?? []), { turn: state.turn, calls: result.calls.map(c => ({ name: c.name, args: c.args, result: c.result })) }];
  return { costUsd: result.costUsd };
}

// --- A turn -------------------------------------------------------------------------------------

export async function twoPartTurn(state: SessionState, input: string, hooks: TurnHooks = {}): Promise<TurnResult> {
  if (state.ended) throw new Error(`Scene ${state.sceneId} has already ended (${state.ended.exitId}).`);
  const scene = sceneById(state.sceneId);
  const before = state.transcript.length;
  let costUsd = 0, calls = 0;
  state.turn++;
  push(state, hooks, { speaker: "player", kind: "player", text: input });

  // The wind-down: the co-GM took a route to an ending; this reply answers the player and closes.
  // Once, it may wait: when the player has just started something the ending has to answer (calling
  // the killer down from the loft), that plays first and the scene closes on the next reply.
  if (state.closing) {
    const exit = scene.exits.find(e => e.id === state.closing!.exitId)!;
    const tp = state.twoPart!;
    const mayHold = !tp.held;
    const close = `bring the scene to a close in a few sentences, landing on a moment that belongs to the player. What this ending should feel like: ${exit.closing} Don't narrate beyond the ending into what comes next.`;
    const directive = mayHold
      ? `The scene is ending: ${exit.outcome} First answer what the player just said or did. If they've just started something this ending has to answer first (a challenge, a confrontation, a new move that would change how it ends), play that and set \`closes\` to false: the scene closes on your next reply. Otherwise ${close} and set \`closes\` to true.`
      : `This reply closes the scene: ${exit.outcome} First answer what the player just said or did. Then ${close}`;
    const spoken = await speak(scene, state, hooks, [directive], "two-part.closing", { mayHold });
    const held = mayHold && !spoken.closes;
    if (held) tp.held = true;
    else { delete state.closing; finishScene(state, scene, exit); }
    const metric: TurnMetric = { turn: state.turn, preDecisionMs: 0, firstTextMs: spoken.firstTextMs, replyMs: spoken.replyMs, postDecisionMs: 0, costUsd: spoken.costUsd, calls: 1 };
    state.metrics.push(metric);
    saveSession(state);
    snapshotSession(state);
    return { entries: state.transcript.slice(before), ...(held ? {} : { ended: exit }), metric };
  }

  const moved = movedDirective(scene, state);
  delete state.twoPart!.moved;
  const spoken = await speak(scene, state, hooks, moved ? [moved] : [], "two-part.reply");
  costUsd += spoken.costUsd; calls++;
  const beatBefore = state.beat;

  // After the reply, side by side: the stage manager keeps the world in step, the co-GM keeps the roles and the scene's place.
  const postStarted = performance.now();
  if (state.world) joinWorld(state.world, presentCast(scene, state).map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), state.turn);
  const staging = state.world ? stageManage(state.world, state.player, input, spoken.text, state.turn, {
    rules: state.transcript.filter(e => e.turn === state.turn && e.kind === "roll").map(e => e.text),
    cast: presentCast(scene, state).map(c => ({ id: c.id, name: c.name, look: c.look })),
    settled: [...state.established],
  }).catch(() => undefined) : undefined;
  const coGming = coGm(scene, state).catch(error => { state.twoPart!.log = [...(state.twoPart!.log ?? []), { turn: state.turn, error: String(error) }]; return { costUsd: 0 }; });
  const [staged, co] = await Promise.all([staging, coGming]);
  if (staged) { costUsd += staged.costUsd; calls++; for (const p of staged.problems) state.world?.log.push({ turn: state.turn, text: `(not done) ${p}`, by: "stage" }); }
  costUsd += co.costUsd; calls++;
  // Whoever the scene's move brought on (the dead-cart's corporal) is in the world, and in the roles.
  if (state.world) joinWorld(state.world, presentCast(scene, state).map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), state.turn);
  const tp = state.twoPart!;
  for (const c of presentCast(scene, state)) tp.roles[c.id] ??= { status: "", mental_state: "", conversation_role: currentBeat(scene, state).cast?.[c.id] ?? c.attitude };
  tp.notes.push({ turn: state.turn, text: rolesNote(scene, tp.roles, state.turn) });
  if (state.beat === beatBefore && !state.closing) state.turnsInBeat++;
  else if (state.beat !== beatBefore) tp.moved = state.beat;

  const metric: TurnMetric = { turn: state.turn, preDecisionMs: 0, firstTextMs: spoken.firstTextMs, replyMs: spoken.replyMs, postDecisionMs: performance.now() - postStarted, costUsd, calls };
  state.metrics.push(metric);
  saveSession(state);
  snapshotSession(state);
  return { entries: state.transcript.slice(before), metric };
}
