import { deciderFor } from "../llm/decide.ts";
import { respondJson } from "../llm/openrouter.ts";
import { recordingWorld } from "../world/dsl.ts";
import { ASSETS } from "../world/assets.ts";
import { sceneById } from "../../scenes/index.ts";
import { approachById } from "./approaches.ts";
import { effectiveScene, sceneEntries } from "./brief.ts";
import { decideAfter, decideBefore, decideNextSpeaker, freeformDirective, moveDirective, type Move } from "./director.ts";
import { describeRoll } from "./dice.ts";
import { applyPendingRepairs } from "./repair.ts";
import { SKILLS, type Exit, type Scene, type Skill } from "./scene.ts";
import { newSessionId, saveSession, snapshotSession, type Entry, type EntryKind, type PlayerCharacter, type SessionState, type TurnMetric } from "./session.ts";
import { actorReply, gmReply, narratorReply, type Spoken } from "./voices.ts";

export interface TurnHooks {
  /** A new speaker starts; text follows via onText. */
  onSpeaker?(speaker: string, kind: EntryKind): void;
  /** Accumulated text of the current speaker. */
  onText?(text: string): void;
  /** A finished visible entry (rolls, system lines, completed speech). */
  onEntry?(entry: Entry): void;
}

export interface TurnResult {
  entries: Entry[];
  ended?: Exit;
  metric: TurnMetric;
}

const DEFAULT_PLAYER = "Wren Ashdown: a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs";

async function rollUpModifiers(concept: string): Promise<Partial<Record<Skill, number>>> {
  try {
    const result = await respondJson<Record<Skill, number>>({
      operation: "player.modifiers", effort: "none",
      instructions: "You assign tabletop RPG skill modifiers (5e style, a capable level 3 adventurer) that fit a character concept. Strong skills +4 to +6, average +1 to +2, weak -1 to 0.",
      input: [{ role: "user", content: `Character: ${concept}` }],
      json: { name: "modifiers", schema: { type: "object", additionalProperties: false, required: [...SKILLS], properties: Object.fromEntries(SKILLS.map(s => [s, { type: "integer" }])) } },
    });
    return Object.fromEntries(SKILLS.map(s => [s, Math.max(-2, Math.min(8, Number(result[s]) || 0))]));
  } catch {
    return Object.fromEntries(SKILLS.map(s => [s, 2]));
  }
}

/** Character creation scenes end by writing the player's sheet from the conversation. */
async function extractCharacter(scene: Scene, state: SessionState): Promise<void> {
  const transcript = sceneEntries(state).map(e => `${e.kind === "player" ? "Player" : e.speaker}: ${e.text}`).join("\n\n");
  try {
    const sheet = await respondJson<{ name: string; concept: string; modifiers: Record<Skill, number> }>({
      operation: "player.sheet", effort: "low",
      instructions: "You write a tabletop RPG character sheet from a character-creation conversation. Use only what the player established or accepted. The concept is one or two sentences: who they are, where they're from, what they're good at, a flaw, and how they'll get into court. Skill modifiers are 5e style for a capable level 3 adventurer: strong skills +4 to +6, average +1 to +2, weak -1 to 0.",
      input: [{ role: "user", content: transcript }],
      json: { name: "sheet", schema: { type: "object", additionalProperties: false, required: ["name", "concept", "modifiers"], properties: {
        name: { type: "string" }, concept: { type: "string" },
        modifiers: { type: "object", additionalProperties: false, required: [...SKILLS], properties: Object.fromEntries(SKILLS.map(k => [k, { type: "integer" }])) },
      } } },
    });
    state.player = { name: sheet.name.trim() || state.player.name, concept: sheet.concept.trim(), modifiers: Object.fromEntries(SKILLS.map(k => [k, Math.max(-2, Math.min(8, Number(sheet.modifiers[k]) || 0))])) };
  } catch (error) {
    state.transcript.push({ turn: state.turn, scene: scene.id, speaker: "system", kind: "system", text: `(character sheet extraction failed: ${error instanceof Error ? error.message : String(error)})` });
  }
}

export async function createSession(options: { sceneId: string; approach: string; player?: string; seed?: number; id?: string }): Promise<SessionState> {
  approachById(options.approach);
  const scene = sceneById(options.sceneId);
  const playerText = options.player ?? DEFAULT_PLAYER;
  const [name, ...rest] = playerText.split(":");
  const player: PlayerCharacter = { name: name!.trim(), concept: rest.join(":").trim() || playerText, modifiers: await rollUpModifiers(playerText) };
  return {
    id: options.id ?? newSessionId(scene.id), sceneId: scene.id, approach: options.approach,
    seed: options.seed ?? Math.floor(Math.random() * 1e9), rollCount: 0, player,
    turn: 0, beat: scene.start, turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
}

function push(state: SessionState, hooks: TurnHooks, entry: Omit<Entry, "turn" | "scene">): Entry {
  const full: Entry = { turn: state.turn, scene: state.sceneId, ...entry };
  state.transcript.push(full);
  hooks.onEntry?.(full);
  return full;
}

function speakHooks(hooks: TurnHooks, speaker: string, kind: EntryKind) {
  let started = false;
  return (text: string) => {
    if (!started) { started = true; hooks.onSpeaker?.(speaker, kind); }
    hooks.onText?.(text);
  };
}

/** Opening narration for the current scene (turn 0 of the scene). */
export async function openScene(state: SessionState, hooks: TurnHooks = {}): Promise<Entry[]> {
  const scene = sceneById(state.sceneId);
  const approach = approachById(state.approach);
  const before = state.transcript.length;
  const directive = [`Open the scene. ${scene.opening} Keep it to a short paragraph or two and end on something the player can respond to.`];
  const spoken = approach.voice === "gm"
    ? await gmReply(scene, state, directive, speakHooks(hooks, "gm", "narration"), "gm.opening")
    : await narratorReply(scene, state, directive, speakHooks(hooks, "gm", "narration"));
  push(state, hooks, { speaker: "gm", kind: "narration", text: spoken.text });
  saveSession(state);
  snapshotSession(state);
  return state.transcript.slice(before);
}

function applyMove(state: SessionState, scene: Scene, move: Move, source: "pre" | "post"): void {
  if (move.transition.establishes) for (const fact of move.transition.establishes) if (!state.established.includes(fact)) state.established.push(fact);
  if (move.to !== state.beat) {
    state.path.push({ turn: state.turn, from: state.beat, to: move.to, via: move.transition.id, source, ...(move.roll ? { roll: move.roll } : {}) });
    if (!move.exit) { state.beat = move.to; state.turnsInBeat = 0; }
  } else if (move.roll) {
    state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: move.transition.id, source, roll: move.roll });
  }
  void scene;
}

/** One player turn: decide, (roll), reply, track the beat, maybe end the scene. */
export async function playerTurn(state: SessionState, input: string, hooks: TurnHooks = {}): Promise<TurnResult> {
  if (state.ended) throw new Error(`Scene ${state.sceneId} has already ended (${state.ended.exitId}).`);
  const authored = sceneById(state.sceneId);
  applyPendingRepairs(authored, state);
  const scene = effectiveScene(authored, state.patches);
  const approach = approachById(state.approach);
  const decider = deciderFor(approach.decider);
  const before = state.transcript.length;
  const started = performance.now();
  let costUsd = 0, calls = 0, firstTextMs: number | null = null;
  const markText = () => { if (firstTextMs === null) firstTextMs = performance.now() - started; };
  const textHooks: TurnHooks = { ...hooks, onText: text => { markText(); hooks.onText?.(text); } };

  state.turn++;
  push(state, hooks, { speaker: "player", kind: "player", text: input });

  // Wind-down turn: the story already reached an ending; answer the player and close.
  if (state.closing) {
    const exit = scene.exits.find(e => e.id === state.closing!.exitId)!;
    const closing = [`The scene is ending: ${exit.outcome} Answer the player's last turn and bring the scene to a close. ${exit.closing} Keep it short.`];
    const replyStarted = performance.now();
    const close = approach.voice === "gm"
      ? await gmReply(scene, state, closing, speakHooks(textHooks, "gm", "narration"), "gm.closing")
      : await narratorReply(scene, state, [...closing, "You may give a character a brief last word if it fits."], speakHooks(textHooks, "gm", "narration"));
    push(state, hooks, { speaker: "gm", kind: "narration", text: close.text });
    delete state.closing;
    if (authored.createsCharacter) await extractCharacter(authored, state);
    finishScene(state, authored, exit);
    const metric: TurnMetric = { turn: state.turn, preDecisionMs: 0, firstTextMs, replyMs: performance.now() - replyStarted, postDecisionMs: 0, costUsd: close.result.costUsd, calls: 1 };
    state.metrics.push(metric);
    saveSession(state);
    snapshotSession(state);
    return { entries: state.transcript.slice(before), ended: exit, metric };
  }

  const pre = await decideBefore(decider, scene, state, input, { speaker: approach.voice === "actors" });
  const preDecisionMs = performance.now() - started;
  if (pre.decision) { costUsd += pre.decision.costUsd; calls++; }
  let ended: Exit | undefined;
  let directive: string[] = [];
  const pending = state.pendingExit;
  if (pending) delete state.pendingExit;
  if (pre.move) {
    directive = moveDirective(scene, state, pre.move);
    if (pre.move.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(pre.move.roll) });
    applyMove(state, scene, pre.move, "pre");
    if (pre.move.exit && (pre.move.chosen || pending?.exitId === pre.move.exit.id)) ended = pre.move.exit;
    else if (pre.move.exit) state.pendingExit = { exitId: pre.move.exit.id, turn: state.turn, via: pre.move.transition.id, extended: false };
  } else if (pre.freeform) {
    push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(pre.freeform.roll) });
    state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: "freeform", source: "pre", roll: pre.freeform.roll });
    directive = [freeformDirective(pre.freeform)];
  }
  if (pending && !pre.move) {
    const exit = scene.exits.find(e => e.id === pending.exitId)!;
    if ((pre.plain || pre.freeform) && !pending.extended) {
      // The player is doing something that might change things: hold the ending one more turn.
      state.pendingExit = { ...pending, extended: true };
      directive.push(`The scene is on the brink of: ${exit.title} (${exit.outcome}). The player's response may change that; play it honestly.`);
    } else {
      ended = exit;
      directive.push(`This reply closes the scene. ${exit.outcome} ${exit.closing}`);
    }
  }

  const spoken: Spoken[] = [];
  const replyStarted = performance.now();
  if (approach.voice === "gm") {
    spoken.push(await gmReply(scene, state, directive, speakHooks(textHooks, "gm", "narration")));
    push(state, hooks, { speaker: "gm", kind: "narration", text: spoken[0]!.text });
  } else {
    // Narration first when something happened that only the GM can describe.
    let next = directive.length || !pre.speaker ? "gm" : pre.speaker;
    const responded: string[] = [];
    for (let i = 0; i < 4 && next !== "player"; i++) {
      const line = next === "gm"
        ? await narratorReply(scene, state, i === 0 ? directive : [], speakHooks(textHooks, "gm", "narration"))
        : await actorReply(scene, state, next, [], speakHooks(textHooks, next, "dialogue"));
      spoken.push(line);
      push(state, hooks, { speaker: line.speaker, kind: line.kind, text: line.text });
      responded.push(next === "gm" ? "GM" : scene.cast.find(c => c.id === next)?.name ?? next);
      if (ended) break; // closing narration only
      if (i === 0 && next === "gm" && pre.speaker && pre.speaker !== "gm") { next = pre.speaker; continue; }
      const decision = await decideNextSpeaker(decider, scene, state, input, responded);
      calls++;
      // The narrator never follows itself: a second passage just repeats the first.
      next = decision === "gm" && line.speaker === "gm" ? "player" : decision;
    }
  }
  const replyMs = performance.now() - replyStarted;
  for (const s of spoken) { costUsd += s.result.costUsd; calls++; }

  let postDecisionMs = 0;
  if (!ended) {
    const postStarted = performance.now();
    const replyText = spoken.map(s => s.speaker === "gm" ? s.text : `${scene.cast.find(c => c.id === s.speaker)?.name}: ${s.text}`).join("\n\n");
    const hold = state.pendingExit?.turn === state.turn ? state.pendingExit.exitId : undefined;
    const post = await decideAfter(decider, scene, state, input, replyText, hold ? { hold } : {});
    postDecisionMs = performance.now() - postStarted;
    if (post.decision) { costUsd += post.decision.costUsd; calls++; }
    if (post.move) {
      if (post.move.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(post.move.roll) });
      applyMove(state, scene, post.move, "post");
      if (post.move.exit) {
        delete state.pendingExit;
        // A fight has already broken out in the reply; anything else gets one wind-down turn.
        if (post.move.exit.kind === "combat") ended = post.move.exit;
        else state.closing = { exitId: post.move.exit.id, turn: state.turn };
      }
    }
  }
  if (!state.path.some(p => p.turn === state.turn && p.to !== p.from)) state.turnsInBeat++;

  if (ended && authored.createsCharacter) await extractCharacter(authored, state);
  if (ended) finishScene(state, authored, ended);
  const metric: TurnMetric = { turn: state.turn, preDecisionMs, firstTextMs, replyMs, postDecisionMs, costUsd, calls };
  state.metrics.push(metric);
  saveSession(state);
  snapshotSession(state);
  return { entries: state.transcript.slice(before), ...(ended ? { ended } : {}), metric };
}

function finishScene(state: SessionState, scene: Scene, exit: Exit): void {
  const { world, operations, warnings } = recordingWorld({ assets: ASSETS, characters: scene.cast.map(c => c.id), anchors: scene.anchors ?? [] });
  try {
    exit.script?.(world, { sceneId: scene.id, exitId: exit.id, established: [...state.established, ...state.canon] });
  } catch (error) {
    warnings.push(`script failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  state.ended = { exitId: exit.id, turn: state.turn, operations, warnings };
  state.transcript.push({ turn: state.turn, scene: state.sceneId, speaker: "system", kind: "system", text: `Scene ends: ${exit.title}` });
}

/** Continue into the exit's next scene in the same session (the map would sit in between). */
export function chainScene(state: SessionState, combatResult = "the party won"): SessionState | undefined {
  if (!state.ended) return undefined;
  const scene = sceneById(state.sceneId);
  const exit = scene.exits.find(e => e.id === state.ended!.exitId)!;
  if (!exit.next) return undefined;
  const facts = [...state.established, ...state.canon];
  const summary = `Previous scene, "${scene.title}", ended: ${exit.title}. ${exit.outcome}${exit.kind === "combat" ? ` The fight was played out on the map: ${combatResult}.` : ""}${facts.length ? ` Established: ${facts.join(" ")}` : ""}`;
  state.history.push({ sceneId: scene.id, exitId: exit.id, summary });
  const next = sceneById(exit.next);
  Object.assign(state, {
    sceneId: next.id, beat: next.start, turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], ended: undefined,
  });
  delete state.ended;
  saveSession(state);
  return state;
}

export function transcriptMarkdown(state: SessionState): string {
  const scene = sceneById(state.sceneId);
  return sceneEntries(state).map(e => e.kind === "player" ? `> **${state.player.name}:** ${e.text}` : e.kind === "roll" ? `🎲 *${e.text}*` : e.kind === "system" ? `*— ${e.text} —*` : e.kind === "dialogue" ? `**${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}:** ${e.text}` : e.text).join("\n\n");
}
