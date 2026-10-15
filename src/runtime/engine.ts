import { deciderFor } from "../llm/decide.ts";
import { respond, respondJson } from "../llm/openrouter.ts";
import { recordingWorld } from "../world/dsl.ts";
import { ASSETS } from "../world/assets.ts";
import { sceneById } from "../../scenes/index.ts";
import { approachById, sceneApproach } from "./approaches.ts";
import { currentBeat, effectiveScene, IMPROVISED_EXIT_ID, presentCast, sceneEntries, strangers, unnamed } from "./brief.ts";
import { CONSEQUENCE_DIRECTIVE, EARNED_DIRECTIVE, GUARD_STAGES, decideAfter, decideBefore, decideNextSpeaker, decideReactions, FOLLOW_UP_DIRECTIVE, freeformCheck, freeformDirective, limitDirective, moveDirective, OOC_DIRECTIVE, plainDirective, pressureDirective, pressureReason, reactionDirective, relocateDirective, STALL_DIRECTIVE, type Act, type ActFrom, type Jumping, type Mechanic, type Move, type Reaction, type Witness } from "./director.ts";
import { considerAct, settleRuling, type ConsiderStep, type Settled } from "./consider.ts";
import { describeRoll } from "./dice.ts";
import { applyOps, areaOf, buildWorld, heldBy, joinWorld, jumpGap, tick, within, type Entity, type WorldOp } from "../world/scene-world.ts";
import { inventory, startingPurse } from "../world/inventory.ts";
import { stageManage } from "../world/stage.ts";
import { attack as rulesAttack, attackOnPlayer, bystander, carryGear, castSpell, comeTo, createCharacter, hazard, jump, levelUp, passTime, rest, spellInfo, useFeature, wrestle, type Build, type Outcome } from "../rules/dnd.ts";
import { applyPendingRepairs, applyRepair, quickRepair, runRepair, writeRepair } from "./repair.ts";
import { startSuggesting, stopSuggesting } from "./suggest.ts";
import { bringOver, carryLines, OWED_INSTRUCTION, owedAtEnd, owedKey, owedPrep, owedSchema, owedText, placeOwedThings, type OwedVerdict } from "./owed.ts";
import { SKILLS, type Exit, type Scene, type Skill } from "./scene.ts";
import { newSessionId, saveSession, snapshotSession, type Backstory, type Entry, type EntryKind, type Owed, type PlayerCharacter, type SessionState, type TurnMetric } from "./session.ts";
import { actorReply, entryOf, gmReply, narratorReply, type Spoken } from "./voices.ts";
import { markupLines, sumStats, type Markup } from "./markup.ts";
import { nameAsKnown } from "./knowledge.ts";
import { annotate, type NotesUsage } from "./notes.ts";
import { disclose, keepOpened, URGENT } from "../lore/disclosure.ts";
import { errandsOf, savePlayedScene, writePlayerBackstory } from "../lore/docs.ts";
import { frontsText, moveFronts, type FrontChanges } from "../lore/fronts.ts";
import { rememberScene } from "../lore/remember.ts";
import { broadcastEnding } from "../lore/reviews.ts";

export interface TurnHooks {
  /** A new speaker starts; text follows via onText. */
  onSpeaker?(speaker: string, kind: EntryKind): void;
  /**
   * Accumulated text of the current speaker, as the player reads it (the GM's markup taken out),
   * and the markup so far: who says each line, and the notes on phrases (src/runtime/markup.ts).
   */
  onText?(text: string, markup?: Markup): void;
  /** A finished visible entry (rolls, system lines, completed speech). */
  onEntry?(entry: Entry): void;
  /**
   * The notes on a GM reply's marks have been written (src/runtime/notes.ts), a moment after the
   * reply: they're on `entry.marked`, which is the object its onEntry entry carried.
   */
  onMarks?(entry: Entry): void;
  /** The game core has just gone into a scene (or a talk), before its opening streams in: show it now. */
  onScene?(): void;
  /**
   * A considered turn (approach `considered`): a step of the GM's ruling starts (the review, each
   * part of its answer as it streams, the roll). Such a turn takes a while: a UI can move its
   * status line on at each, to show the GM getting somewhere.
   */
  onStep?(step: ConsiderStep): void;
  /** What the player might say or do next has come, a moment after the reply (src/runtime/suggest.ts): the session has it. */
  onSuggestions?(): void;
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

/**
 * A new session for a scene: the player (from "Name: concept"), their D&D character (from the build
 * given, else one the model chooses for the concept) and, from character creation, their backstory:
 * on the player, and written into the session's own lore as their doc, for the GM.
 */
export async function createSession(options: { sceneId: string; approach: string; player?: string; seed?: number; id?: string; rules?: boolean; level?: number; build?: Partial<Build>; backstory?: Backstory }): Promise<SessionState> {
  approachById(options.approach);
  const scene = sceneById(options.sceneId);
  const playerText = options.player ?? DEFAULT_PLAYER;
  const [name, ...rest] = playerText.split(":");
  const player: PlayerCharacter = { name: name!.trim(), concept: rest.join(":").trim() || playerText, modifiers: {}, ...(options.backstory?.text.trim() ? { backstory: options.backstory } : {}) };
  const state: SessionState = {
    id: options.id ?? newSessionId(scene.id), sceneId: scene.id, approach: options.approach,
    seed: options.seed ?? Math.floor(Math.random() * 1e9), rollCount: 0, player,
    turn: 0, beat: scene.start, turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    patches: [], repairs: [], transcript: [], metrics: [], history: [],
  };
  // A D&D character sheet from the concept (the rules engine); without it, modifiers from the concept.
  if (options.rules !== false) {
    try { await createCharacter(state, options.level ?? 3, options.build); } catch { delete state.rules; }
  }
  if (!state.rules) state.player.modifiers = await rollUpModifiers(playerText);
  if (state.player.backstory) writePlayerBackstory(state.id, state.player);
  return state;
}

function push(state: SessionState, hooks: TurnHooks, entry: Omit<Entry, "turn" | "scene">): Entry {
  const full: Entry = { turn: state.turn, scene: state.sceneId, ...entry };
  state.transcript.push(full);
  hooks.onEntry?.(full);
  return full;
}

/**
 * A reply onto the transcript, with its notes to come: a GM reply's are written from what the player
 * knows (src/runtime/notes.ts) while the turn goes on, and put on the entry (onMarks) when they're
 * ready. What it returns is what the turn waits on before it saves.
 */
export function pushReply(scene: Scene, state: SessionState, hooks: TurnHooks, spoken: Spoken, pushed = (e: Omit<Entry, "turn" | "scene">) => push(state, hooks, e)): Promise<NotesUsage | undefined> {
  const entry = pushed(entryOf(spoken));
  return annotate(scene, state, entry, spoken.drafted ?? [], hooks.onMarks);
}

/** What a turn's notes came to, together: for its metric. */
function notesOf(all: Array<NotesUsage | undefined>): NotesUsage | undefined {
  const some = all.filter((n): n is NotesUsage => !!n);
  if (!some.length) return undefined;
  return some.reduce((a, n) => ({ drafted: a.drafted + n.drafted, written: a.written + n.written, added: a.added + n.added, costUsd: a.costUsd + n.costUsd, ms: Math.max(a.ms, n.ms) }));
}

function speakHooks(hooks: TurnHooks, speaker: string, kind: EntryKind) {
  let started = false;
  return (text: string, markup?: Markup) => {
    if (!started) { started = true; hooks.onSpeaker?.(speaker, kind); }
    hooks.onText?.(text, markup);
  };
}

/**
 * Opening narration for the current scene (turn 0 of the scene). `suggest`: then what the player
 * might say or do first (src/runtime/suggest.ts), never waited for.
 */
export async function openScene(state: SessionState, hooks: TurnHooks = {}, options: { suggest?: boolean } = {}): Promise<Entry[]> {
  const scene = sceneById(state.sceneId);
  const approach = approachById(state.approach);
  const before = state.transcript.length;
  const directive = state.history.length
    ? [`Open the scene, picking up exactly from how the last one ended (see what happened just before this scene, and where the prep is out of date: they outrank the prep). The opening, as it stands after what actually happened: ${state.opening ?? scene.opening} Pick up after the last scene's closing lines rather than repeating them. Keep it to a short paragraph or two and end on something the player can respond to.`]
    : [`Open the scene. ${scene.opening} Keep it to a short paragraph or two and end on something the player can respond to.`];
  await settlePresence(scene, state, deciderFor(approach.decider)).catch(() => undefined);
  if (approach.staging) state.guard ??= {};
  // The place as a world: where everyone and everything starts, with what the player carried in.
  if (scene.world) {
    state.world = buildWorld(scene.id, scene.world, presentCast(scene, state).map(c => ({ id: c.id, name: c.name })), state.player);
    joinWorld(state.world, presentCast(scene, state).map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
    for (const e of state.carried ?? []) state.world.entities[e.id] = { ...e, parent: e.parent && state.carried!.some(c => c.id === e.parent) ? e.parent : "player" };
    // What the story still owes the player is where it was left, with whoever has it (the page in Cob's boot).
    placeOwedThings(state);
    // A purse at the start of the story (and from then on, whatever they carry).
    if (!state.history.length && !Object.values(state.world.entities).some(e => e.parent === "player" && /pennies|shillings|crowns/.test(e.name))) {
      for (const coin of startingPurse()) inventory(state.world, 0).add("player", coin);
    }
    // The player's own gear is in the world too, so the story can part them from it.
    const first = state.player.name.split(" ")[0]!;
    for (const g of state.rules?.gear ?? []) {
      if (state.rules?.gone?.includes(g.id) || Object.values(state.world.entities).some(e => e.gear === g.id)) continue;
      let id = `${first}-${g.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      for (let n = 2; state.world.entities[id]; n++) id = `${id}-${n}`;
      state.world.entities[id] = { id, name: `${first}'s ${g.name.toLowerCase()}`, kind: "item", parent: "player", tags: [g.kind], states: g.slot ? [g.slot === "mainHand" || g.slot === "offHand" ? "in hand" : "worn"] : [], notes: [], gear: g.id };
    }
  } else delete state.world;
  delete state.carried;
  // Between scenes: coming to after being knocked down, the rest the gap allows, a milestone level-up.
  if (state.rules) {
    await passTime(state, 60).catch(() => [] as string[]); // between scenes, spells run out quietly
    const woke = await comeTo(state).catch(() => undefined);
    if (woke) push(state, hooks, { speaker: "dice", kind: "roll", text: woke });
    // Level up first, so the night's rest fills the new hit points too.
    const levelled = scene.milestone ? await levelUp(state).catch(() => [] as string[]) : [];
    const rested = scene.rest ? await rest(state, scene.rest).catch(() => undefined) : undefined;
    for (const text of rested?.lines ?? []) push(state, hooks, { speaker: "dice", kind: "roll", text });
    for (const text of levelled) push(state, hooks, { speaker: "system", kind: "system", text });
  }
  if (approach.memory) {
    // Recurring people walk in remembering: open what bears on this scene before the first line.
    const opening = await disclose(scene, state, "").catch(() => undefined);
    if (opening?.opened.length) keepOpened(state, opening.opened);
  }
  const spoken = approach.voice === "gm"
    ? await gmReply(scene, state, directive, speakHooks(hooks, "gm", "narration"), "gm.opening")
    : await narratorReply(scene, state, directive, speakHooks(hooks, "gm", "narration"));
  // The reply's notes and the lines to suggest are made side by side: neither waits for the other.
  const noting = pushReply(scene, state, hooks, spoken);
  if (options.suggest) startSuggesting(state, hooks);
  await noting;
  saveSession(state);
  snapshotSession(state);
  return state.transcript.slice(before);
}

/**
 * Who from earlier scenes is actually here? A recurring character's card can't know whether the
 * last scene ended with them taken in or fled; the hand-off does. Only confident "not here" counts.
 */
async function settlePresence(scene: Scene, state: SessionState, decider: ReturnType<typeof deciderFor>): Promise<void> {
  const handoff = state.history.at(-1)?.summary;
  if (!handoff) return;
  const recurring = scene.cast.filter(c => handoff.includes(c.name.split(" ").at(-1)!) || handoff.includes(c.name.split(" ")[0]!));
  if (!recurring.length) return;
  const decision = await decider.decide({ previous_scene: handoff, new_scene: `${scene.title}: ${scene.setting}` }, Object.fromEntries(recurring.map(c => [c.id, {
    instructions: `A new scene is starting right after the previous one ended as described. Going by what happened (not by what this scene's prep assumes), can ${c.name} be here at the start of the new scene, or does what happened rule it out (taken into custody, fled, left far behind, dead)?`,
    criteria: { here: `${c.name} can be here (or nothing rules it out).`, not_here: `What happened rules out ${c.name} being here.` },
  }])), "director.presence");
  state.absent = recurring.filter(c => decision.answers[c.id]?.choice === "not_here" && (decision.answers[c.id]?.probabilities?.not_here ?? 1) >= 0.8).map(c => c.id);
}

/**
 * Where a move before the reply leaves the scene (a route's, or a considered ruling's): an ending the
 * dice decided plays its moment now and closes on the next reply; one the player chose closes now;
 * one they didn't is held for their answer. The GM's lines, with the closing line fitted to it.
 */
function moveTaken(state: SessionState, move: Move, lines: string[], pending: SessionState["pendingExit"]): { lines: string[]; ended?: Exit; closing?: SessionState["closing"]; pendingExit?: SessionState["pendingExit"] } {
  if (move.exit && move.chosen && move.roll && move.exit.kind !== "combat") {
    return {
      lines: [...lines.filter(d => !d.startsWith("This reply closes the scene")), `The dice have decided it: this is heading to ${move.exit.title} (${move.exit.outcome}). Play the decisive moment and people's immediate reactions, including anyone who saw it; the scene closes on your next reply, so don't wrap everything up yet.`],
      closing: { exitId: move.exit.id, turn: state.turn },
    };
  }
  if (move.exit && (move.chosen || pending?.exitId === move.exit.id)) return { lines, ended: move.exit };
  if (move.exit) return { lines, pendingExit: { exitId: move.exit.id, turn: state.turn, via: move.transition.id, extended: false } };
  return { lines };
}

function applyMove(state: SessionState, scene: Scene, move: Move, source: "pre" | "post"): void {
  // The route's own facts, then those of how its check went (a considered ruling's outcome).
  const byOutcome = move.roll && move.transition.check?.establishes ? (move.roll.success ? move.transition.check.establishes.success : move.transition.check.establishes.failure) ?? [] : [];
  for (const fact of [...(move.transition.establishes ?? []), ...byOutcome]) if (!state.established.includes(fact)) state.established.push(fact);
  if (move.to !== state.beat) {
    state.path.push({ turn: state.turn, from: state.beat, to: move.to, via: move.transition.id, source, ...(move.roll ? { roll: move.roll } : {}) });
    if (!move.exit) { state.beat = move.to; state.turnsInBeat = 0; }
  } else if (move.roll) {
    state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: move.transition.id, source, roll: move.roll });
  }
  void scene;
}

/**
 * One player turn: decide, (roll), reply, track the beat, maybe end the scene. `mechanic`: what the
 * rules resolve this turn, chosen already (the map's action menu: a spell at someone, a shove), so
 * the decider isn't asked what the player is doing with the rules, only everything else. `suggest`:
 * once the reply is in, what the player might say or do next (src/runtime/suggest.ts), alongside the
 * after-reply work and never waited for.
 */
export async function playerTurn(state: SessionState, input: string, hooks: TurnHooks = {}, options: { mechanic?: Mechanic; suggest?: boolean } = {}): Promise<TurnResult> {
  if (state.ended) throw new Error(`Scene ${state.sceneId} has already ended (${state.ended.exitId}).`);
  const authored = sceneById(state.sceneId);
  applyPendingRepairs(authored, state);
  let scene = effectiveScene(authored, state.patches);
  const approach = sceneApproach(state, authored);
  const decider = deciderFor(approach.decider);
  if (approach.staging) state.guard ??= {};
  const before = state.transcript.length;
  const started = performance.now();
  let costUsd = 0, calls = 0, firstTextMs: number | null = null;
  const markText = () => { if (firstTextMs === null) firstTextMs = performance.now() - started; };
  const textHooks: TurnHooks = { ...hooks, onText: (text, markup) => { markText(); hooks.onText?.(text, markup); } };
  // The notes on the turn's GM replies, being written while the turn goes on.
  const noting: Array<Promise<NotesUsage | undefined>> = [];

  state.turn++;
  push(state, hooks, { speaker: "player", kind: "player", text: input });
  // People whose names the player hasn't heard go by what they'd call them, in the dice too.
  if (state.rules) state.rules.aliases = unnamed(scene, state);

  // Blocking co-GM: review the player's input before deciding, so a new route can fire this turn.
  let repairMs = 0;
  if (approach.repair === "blocking" && !state.closing) {
    const repairStarted = performance.now();
    try {
      const repair = await runRepair(authored, state, { effort: approach.repairEffort ?? "medium" });
      applyRepair(authored, state, repair);
      costUsd += repair.costUsd; calls++;
      scene = effectiveScene(authored, state.patches);
    } catch { /* the turn goes ahead without it */ }
    repairMs = performance.now() - repairStarted;
  }

  // Wind-down turn: the story already reached an ending; answer the player and close.
  if (state.closing) {
    const exit = scene.exits.find(e => e.id === state.closing!.exitId)!;
    const closing = [`The scene is ending: ${exit.outcome} Answer the player's last turn and bring the scene to a close in a few sentences, landing on a moment that belongs to the player. What this ending should feel like: ${exit.closing} Don't add new events, don't narrate beyond the ending into what comes next, and don't contradict anything already narrated.`];
    const replyStarted = performance.now();
    const close = approach.voice === "gm"
      ? await gmReply(scene, state, closing, speakHooks(textHooks, "gm", "narration"), "gm.closing")
      : await narratorReply(scene, state, [...closing, "You may give a character a brief last word if it fits."], speakHooks(textHooks, "gm", "narration"));
    const noting = pushReply(scene, state, hooks, close);
    delete state.closing;
    if (authored.createsCharacter) await extractCharacter(authored, state);
    finishScene(state, authored, exit);
    const markup = sumStats([close.stats]);
    const notes = await noting;
    const metric: TurnMetric = { turn: state.turn, preDecisionMs: 0, firstTextMs, replyMs: performance.now() - replyStarted, postDecisionMs: 0, costUsd: close.result.costUsd + (notes?.costUsd ?? 0), calls: notes ? 2 : 1, ...(markup ? { markup } : {}), ...(notes ? { notes } : {}) };
    state.metrics.push(metric);
    saveSession(state);
    snapshotSession(state);
    return { entries: state.transcript.slice(before), ended: exit, metric };
  }

  // The rules: a blow or a danger the last reply left hanging over the player lands now, before
  // they act, as at the table. Its outcome leads this turn's reply.
  const ruled: string[] = [];
  if (state.rules?.timed) {
    const ran = await passTime(state, 1).catch(() => [] as string[]);
    for (const text of ran) push(state, hooks, { speaker: "dice", kind: "roll", text });
    if (ran.length) ruled.push(`Rules: ${ran.join("; ")} (the spell's time is up).`);
  }
  // The world moves on its own between replies: what's burning burns, and spreads.
  if (state.world && Object.values(state.world.entities).some(e => e.states.includes("burning"))) {
    const burned = tick(state.world, state.turn, state.seed + 31337 * state.turn);
    for (const text of burned) push(state, hooks, { speaker: "dice", kind: "roll", text });
    if (burned.length) ruled.push(`Rules, since the last reply: ${burned.join("; ")}. The world shows what's burning now; let the fire be felt (smoke, heat, people's reactions).`);
    // An explosion catches everyone in it, the player included.
    const here = state.world.entities.player ? areaOf(state.world, "player") : undefined;
    if (state.rules && here?.states.includes("exploded") && burned.some(l => /explosion/i.test(l))) {
      const blast = await hazard(state, "fire", "serious").catch(() => undefined);
      if (blast) { for (const text of blast.lines) push(state, hooks, { speaker: "dice", kind: "roll", text }); ruled.push(blast.directive); }
    }
  }
  if (state.threat && state.rules) {
    const threat = state.threat;
    delete state.threat;
    const bystanding = threat.kind === "attack" ? state.world?.entities[threat.by] : undefined;
    const attacker = threat.kind === "attack" ? presentCast(scene, state).find(c => c.id === threat.by) ?? (bystanding && !bystanding.states.includes("gone") ? bystander(bystanding) : undefined) : undefined;
    const outcome = threat.kind === "attack"
      ? attacker ? await attackOnPlayer(state, attacker).catch(() => undefined) : undefined
      : await hazard(state, threat.hazard, threat.severity).catch(() => undefined);
    if (outcome) {
      for (const text of outcome.lines) push(state, hooks, { speaker: "dice", kind: "roll", text });
      ruled.push(outcome.directive);
    }
  }
  // Speculative reply: start the GM before the decision returns; hold its text until we know it's valid.
  let speculation: { promise: Promise<Spoken | undefined>; controller: AbortController; buffer: string; markup?: Markup; release?: (text: string, markup?: Markup) => void } | undefined;
  if (approach.speculative && approach.voice === "gm" && !state.endingLead && !state.sceneStatus?.startsWith("stuck")) {
    const controller = new AbortController();
    const spec = { controller, buffer: "", promise: Promise.resolve(undefined as Spoken | undefined) } as NonNullable<typeof speculation>;
    const onText = (text: string, markup?: Markup) => { spec.buffer = text; if (markup) spec.markup = markup; spec.release?.(text, markup); };
    spec.promise = gmReply(scene, state, ruled, onText, "gm.speculative", controller.signal).catch(() => undefined);
    speculation = spec;
  }
  // Quick-block: start the quick co-GM alongside the decision, so on an off-graph turn its answer
  // is (nearly) ready when we need it; on other turns it's simply ignored.
  const quickStarted = performance.now();
  const quickEarly = approach.repair === "quick-block" && approach.voice === "gm" && !state.closing
    ? quickRepair(authored, state, approach.repairEffort ? { effort: approach.repairEffort } : {}).catch(() => undefined)
    : undefined;
  const disclosing = approach.memory ? disclose(scene, state, input).catch(() => undefined) : undefined;
  const rules = state.rules ? { spells: state.rules.spells ?? [], weapons: state.rules.weapons ?? [], features: state.rules.features ?? [], ...(state.world ? aimable(state) : {}) } : undefined;
  // (Considered rolls ask whether a roll is wanted in this same call: no extra latency on ordinary turns.)
  const considers = approach.considered === true && approach.voice === "gm";
  const pre = await decideBefore(decider, scene, state, input, { speaker: approach.voice === "actors", freeform: approach.freeformChecks === true, offGraph: approach.repair !== "off" || considers, relocate: approach.deciderRelocation === true, pressure: approach.pressureRolls === true, consequences: approach.consequences === true, considered: considers, ...(rules ? { rules } : {}), ...(rules && options.mechanic ? { forced: options.mechanic } : {}) });
  // A failed roll stands: don't have something else hand over what the dice just withheld.
  if (pre.move?.roll && !pre.move.roll.success && pre.relocate) delete pre.relocate;
  const preDecisionMs = performance.now() - started;
  if (pre.decision) { costUsd += pre.decision.costUsd; calls++; }
  let ended: Exit | undefined;
  let directive: string[] = [];
  const disclosed = disclosing ? await disclosing : undefined;
  if (disclosed) { costUsd += disclosed.costUsd; calls++; }
  if (disclosed?.opened.length) {
    keepOpened(state, disclosed.opened);
    // Only a note clearly about this moment is worth a fresh reply (the speculative one, written
    // without it, is set aside); the rest simply join the prep for the replies that follow.
    const urgent = disclosed.opened.filter(n => (n.p ?? 0) >= URGENT);
    const owners = [...new Set(urgent.map(n => scene.cast.find(c => `character:${c.id}` === n.scope)?.name).filter(Boolean))];
    if (urgent.length) directive.push(`Something from before bears on this moment${owners.length ? `: ${owners.join(" and ")} remember${owners.length === 1 ? "s" : ""} it` : ""} (see the notes just opened under "What people remember"). Let it show in how they respond, in their own words.`);
  }
  // Someone not yet on stage was called into the scene by the player's turn.
  if (pre.speaker && scene.cast.some(c => c.id === pre.speaker) && !presentCast(scene, state).some(c => c.id === pre.speaker)) {
    state.entered = [...(state.entered ?? []), pre.speaker];
  }
  // Momentum: the last exchange was judged stuck, so this reply has to break the loop.
  const wasStuck = state.sceneStatus === "stuck";
  const pending = state.pendingExit;
  if (pending) delete state.pendingExit;
  if (pre.move) {
    // (Told before it's applied: the directive says where the scene has moved from.)
    const lines = moveDirective(scene, state, pre.move);
    if (pre.move.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(pre.move.roll, pre.move.transition.check?.reason) });
    applyMove(state, scene, pre.move, "pre");
    const taken = moveTaken(state, pre.move, lines, pending);
    directive = taken.lines;
    if (taken.ended) ended = taken.ended;
    if (taken.closing) state.closing = taken.closing;
    if (taken.pendingExit) state.pendingExit = taken.pendingExit;
  } else if (pre.freeform) {
    push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(pre.freeform.roll) });
    state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: "freeform", source: "pre", roll: pre.freeform.roll });
    directive = [freeformDirective(pre.freeform)];
  }
  // The rules resolve a spell, a blow or a rest; the GM narrates what they decided.
  if (pre.mechanic && state.rules) {
    const m = pre.mechanic;
    const present = presentCast(scene, state);
    // Moved first, in the same turn: the spell or blow comes from where they ended up.
    if (state.world && (m.kind === "cast" || m.kind === "attack" || m.kind === "wrestle") && m.from) moveToAct(state, m.from, m.kind === "cast" ? m.targets.find(t => t !== "self") : m.target);
    const before = state.world ? Object.fromEntries(Object.values(state.world.entities).map(e => [e.id, [...e.states]])) : undefined;
    const outcome: Outcome = await (m.kind === "cast" ? castSpell(state, present, m.spell, m.targets, { ritual: /\britual\b/i.test(input) && !/\b(not|no|without|rather than)\b[^.!?]{0,20}\britual/i.test(input) && !/\bspend(ing)? a\b[^.!?]{0,12}\bslot\b/i.test(input), said: input }) : m.kind === "attack" ? rulesAttack(state, present, m.target, m.weapon) : m.kind === "wrestle" ? wrestle(state, present, m.target, m.how) : m.kind === "jump" ? leap(state, m) : m.kind === "feature" ? useFeature(state, present, m.feature, m.target) : rest(state, m.length))
      .catch(error => ({ lines: [`(The rules couldn't resolve that: ${error instanceof Error ? error.message : String(error)})`], directive: "" }));
    for (const text of outcome.lines) push(state, hooks, { speaker: "dice", kind: "roll", text });
    if (outcome.directive) directive.push(outcome.directive);
    state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: `rules:${m.kind}${m.kind === "cast" ? `:${m.spell}` : m.kind === "attack" || m.kind === "wrestle" ? `:${m.target}` : m.kind === "jump" ? `:${m.how}` : m.kind === "feature" ? `:${m.feature}` : `:${m.length}`}`, source: "pre" });
    // Violence draws a reaction from everyone present: some fight, some flee, some run for help.
    // An authored fight answers it on its own; an authored ending waits if a fight breaks out first.
    const act = pre.move?.exit?.kind !== "combat" && !state.brawl ? await violence(scene, state, m, before) : undefined;
    if (act) {
      const witnesses = witnessesOf(scene, state, act);
      if (witnesses.length) {
        const { reactions, decision } = await decideReactions(decider, scene, state, input, act, witnesses, id => nameIn(scene, state, id));
        if (decision) { costUsd += decision.costUsd; calls++; }
        react(scene, state, act, reactions);
        if (state.brawl && (ended || state.closing?.turn === state.turn || state.pendingExit?.turn === state.turn)) {
          ended = undefined;
          if (state.closing?.turn === state.turn) delete state.closing;
          if (state.pendingExit?.turn === state.turn) delete state.pendingExit;
          directive = directive.filter(d => !/closes the scene|The dice have decided it|The scene is on the brink/.test(d));
        }
        directive.push(reactionDirective(reactions, id => nameIn(scene, state, id)));
        state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: `reactions:${Object.entries(reactions).map(([id, r]) => `${id}=${r}`).join(",")}`, source: "pre" });
      }
    }
  }
  // Considered rolls: an act a roll should settle that no route does (or a plan off the graph). The
  // GM rules on it before replying: a roll or not, the DC, and what each outcome changes. The rules
  // roll it, the outcome's changes apply like any route's, and the reply plays what was decided.
  let considered: Settled | undefined;
  let considerMs: number | undefined;
  if (considers && !state.closing && !ended && !pre.move && !pre.mechanic && !pre.freeform && !pre.pressure && !pre.limit && !pre.ooc && (pre.considered || pre.offGraph)) {
    const reviewStarted = performance.now();
    const step = (s: ConsiderStep) => hooks.onStep?.(s);
    try {
      const ruling = await considerAct(scene, state, input, pre.considered, step);
      costUsd += ruling.costUsd; calls++;
      considered = await settleRuling(scene, state, ruling, step);
      state.rulings = [...(state.rulings ?? []), considered.record];
      if (considered.dice) push(state, hooks, { speaker: "dice", kind: "roll", text: considered.dice });
      const from = state.beat;
      applyMove(state, scene, considered.move, "pre");
      // (A ruling with no roll that keeps the scene here is on the path too, as a freeform roll is.)
      if (!considered.move.roll && considered.move.to === from) state.path.push({ turn: state.turn, from, to: from, via: considered.move.transition.id, source: "pre" });
      const taken = moveTaken(state, considered.move, considered.directive, pending);
      directive.push(...taken.lines);
      if (taken.ended) ended = taken.ended;
      if (taken.closing) state.closing = taken.closing;
      if (taken.pendingExit) state.pendingExit = taken.pendingExit;
      // A failure stands: nothing else hands over what the dice just withheld.
      if (considered.record.went === "failure") delete pre.relocate;
      // The ways of trying it shut are gone from here on, for the decider and the GM.
      scene = effectiveScene(authored, state.patches);
    } catch {
      // No ruling (the review failed): the dice still decide a roll that was wanted, as a plain check.
      if (pre.considered) {
        const extra = await freeformCheck(decider, scene, state, input).catch(() => undefined);
        if (extra) {
          costUsd += extra.decision.costUsd; calls++;
          push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(extra.check.roll) });
          state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: "freeform", source: "pre", roll: extra.check.roll });
          directive.push(freeformDirective(extra.check));
        }
      }
    }
    considerMs = performance.now() - reviewStarted;
  }
  // The background co-GM is for the scene's direction: a plan off the graph the GM has ruled on doesn't need it now.
  if (pre.offGraph && !considered) state.offGraphTurn = state.turn;
  if (state.endingLead && !pre.move && !considered && !state.closing) {
    const exit = scene.exits.find(e => e.id === state.endingLead!.exitId);
    if (exit) directive.push(`The scene may be reaching its end (${exit.title}). Stay at the threshold: don't narrate journeys or arrivals somewhere else; if the player is leaving or the matter is settled, let it close here.`);
  }
  // A ruling decided this turn's consequences, and its payoff: no bill or payoff on top of it.
  if (pre.daft && !pre.ooc && !considered) directive.push(CONSEQUENCE_DIRECTIVE);
  if (pre.earned && !pre.ooc && !pre.move?.roll && !considered) directive.push(EARNED_DIRECTIVE);
  if (pre.pressure && !pre.ooc && !pre.move) {
    // The dice line names them as the player knows them (the woman with the silver dice, until she's Sal).
    if (pre.pressure.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(pre.pressure.roll, pressureReason(scene, pre.pressure, state.rules?.aliases ?? unnamed(scene, state))) });
    state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: `pressure:${pre.pressure.target}:${pre.pressure.band}`, source: "pre", ...(pre.pressure.roll ? { roll: pre.pressure.roll } : {}) });
    directive.push(pressureDirective(scene, pre.pressure));
  }
  if (pre.relocate?.length && !pre.ooc) {
    for (const r of pre.relocate) directive.push(relocateDirective(scene, r));
    state.decidedRelocations = [...(state.decidedRelocations ?? []), ...pre.relocate.map(r => ({ ...r, turn: state.turn }))];
  }
  if (pre.ooc) directive.push(OOC_DIRECTIVE);
  else if (pre.plainTransition && !pre.limit && !pre.move && !considered) directive.push(plainDirective(pre.plainTransition));
  if (pre.limit) directive.push(limitDirective(pre.limit));
  if (wasStuck && !pre.move && !considered) directive.push("The scene has been going in circles. Break the loop in this reply with something new: someone acts on what they want or gives ground, a consequence lands, or something is revealed that opens a way forward. Don't replay an earlier push or repeat the last exchange.");
  // An ending held for the player's answer: a move answers it (a ruling's success, or its own ending);
  // a ruling that failed without one is like any try that might change things.
  if (pending && !pre.move && !(considered && (considered.record.went === "success" || considered.move.exit))) {
    const exit = scene.exits.find(e => e.id === pending.exitId)!;
    if ((pre.plain || pre.freeform || considered) && !pending.extended) {
      // The player is doing something that might change things: hold the ending one more turn.
      state.pendingExit = { ...pending, extended: true };
      directive.push(`The scene is on the brink of: ${exit.title} (${exit.outcome}). The player's response may change that; play it honestly.`);
    } else {
      ended = exit;
      directive.push(`This reply closes the scene: ${exit.outcome} Land it on a moment that belongs to the player. What this ending should feel like: ${exit.closing} Don't narrate beyond the ending into what comes next.${exit.kind === "combat" ? " A fight starts here and is played out blow by blow on the map: end on the moment it breaks out, before any blow lands, any shot hits or any spell takes hold." : ""}`);
    }
  }

  const spoken: Spoken[] = [];
  const replyStarted = performance.now();
  let followUpMs: number | null = null;
  // Stall mode: off the graph, with nothing else decided this turn. Hold the moment, let the co-GM
  // work in parallel, then resolve it with whatever it adds.
  // Only a genuinely off-graph turn earns a hold (a stale "stuck" from last turn made holds misfire).
  // A turn the rules resolve (a spell, a blow, a rest) is already answered: a route the co-GM opens
  // for it waits for the next turn rather than rolling on top of the act.
  const offGraphTurn = approach.voice === "gm" && !pre.move && !pre.mechanic && !pre.limit && !pre.ooc && !ended && pre.offGraph === true;
  // A freeform roll has already decided this turn's attempt: a route the co-GM opens for it lands
  // next turn, rather than rolling again on top of it (one climb, one roll).
  if (approach.repair === "quick-block" && offGraphTurn && quickEarly && pre.freeform) {
    const turn = state.turn;
    void quickEarly.then(r => { if (r) { try { writeRepair(state, { ...r, turn }); } catch { /* best effort */ } } });
  }
  const stall = approach.repair === "stall" && offGraphTurn && !pre.relocate?.length && !pre.freeform;
  if (approach.repair === "quick-block" && offGraphTurn && quickEarly && !pre.freeform) {
    // One coherent reply: wait for the quick co-GM until the deadline (from the start of the turn),
    // re-decide, then answer. A late result lands next turn; the speculative reply stays usable.
    const repairing = quickEarly;
    let late = false;
    const deadline = Math.max(0, (approach.repairDeadlineMs ?? 3000) - (performance.now() - quickStarted));
    const repair = await Promise.race([repairing, new Promise<undefined>(r => setTimeout(() => { late = true; r(undefined); }, deadline))]);
    repairMs = performance.now() - quickStarted;
    if (late) {
      const turn = state.turn;
      void repairing.then(r => { if (r) { try { writeRepair(state, { ...r, turn }); } catch { /* best effort */ } } });
      state.lateRepairs = (state.lateRepairs ?? 0) + 1;
    }
    if (repair) {
      applyRepair(authored, state, repair);
      costUsd += repair.costUsd; calls++;
      scene = effectiveScene(authored, state.patches);
      // The co-GM's move supersedes this turn's decider relocation.
      directive = directive.filter(d => !d.startsWith("Something the scene needs is within reach"));
      const again = await decideBefore(decider, scene, state, input, { speaker: false });
      if (again.decision) { costUsd += again.decision.costUsd; calls++; }
      if (again.move) {
        directive.push(...moveDirective(scene, state, again.move));
        if (again.move.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(again.move.roll, again.move.transition.check?.reason) });
        applyMove(state, scene, again.move, "pre");
        if (again.move.exit && again.move.chosen) ended = again.move.exit;
        else if (again.move.exit) state.pendingExit = { exitId: again.move.exit.id, turn: state.turn, via: again.move.transition.id, extended: false };
      } else if (again.plainTransition) directive.push(plainDirective(again.plainTransition));
      // The co-GM changed something, so the speculative reply (written without it) is stale.
      if (speculation) { speculation.controller.abort(); speculation = undefined; }
    }
  }
  if (stall) {
    const repairStarted = performance.now();
    const repairing = (approach.repairKind === "quick"
      ? quickRepair(authored, state, approach.repairEffort ? { effort: approach.repairEffort } : {})
      : runRepair(authored, state, { effort: approach.repairEffort ?? "medium" })).catch(() => undefined);
    const beat = await gmReply(scene, state, [...ruled, STALL_DIRECTIVE], speakHooks(textHooks, "gm", "narration"), "gm.stall", undefined, 140);
    spoken.push(beat);
    noting.push(pushReply(scene, state, hooks, beat));
    // Budget: wait for the co-GM only until its deadline; a late result lands next turn instead.
    let late = false;
    const remaining = approach.repairDeadlineMs ? approach.repairDeadlineMs - (performance.now() - repairStarted) : Infinity;
    const repair = Number.isFinite(remaining)
      ? await Promise.race([repairing, new Promise<undefined>(r => setTimeout(() => { late = true; r(undefined); }, Math.max(0, remaining)))])
      : await repairing;
    if (late) {
      const turn = state.turn;
      void repairing.then(r => { if (r) { try { writeRepair(state, { ...r, turn }); } catch { /* best effort */ } } });
      state.lateRepairs = (state.lateRepairs ?? 0) + 1;
    }
    if (repair) {
      applyRepair(authored, state, repair);
      costUsd += repair.costUsd; calls++;
      scene = effectiveScene(authored, state.patches);
    }
    void repairStarted;
    const again = await decideBefore(decider, scene, state, input, { speaker: false });
    if (again.decision) { costUsd += again.decision.costUsd; calls++; }
    const follow = [FOLLOW_UP_DIRECTIVE, ...directive];
    if (again.move) {
      follow.push(...moveDirective(scene, state, again.move));
      if (again.move.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(again.move.roll, again.move.transition.check?.reason) });
      applyMove(state, scene, again.move, "pre");
      if (again.move.exit && again.move.chosen) ended = again.move.exit;
      else if (again.move.exit) state.pendingExit = { exitId: again.move.exit.id, turn: state.turn, via: again.move.transition.id, extended: false };
    } else if (again.plainTransition) follow.push(plainDirective(again.plainTransition));
    const resolve = await gmReply(scene, state, follow, (text, markup) => {
      if (followUpMs === null) followUpMs = performance.now() - started;
      hooks.onText?.(text, markup);
    }, "gm.followup");
    spoken.push(resolve);
    noting.push(pushReply(scene, state, hooks, resolve));
  } else if (approach.voice === "gm") {
    let reply: Spoken | undefined;
    if (speculation && !directive.length && !pre.move && !pre.freeform && !ended) {
      // The decision changed nothing: keep the speculative reply, releasing any text held so far.
      const show = speakHooks(textHooks, "gm", "narration");
      if (speculation.buffer) show(speculation.buffer, speculation.markup);
      speculation.release = show;
      reply = await speculation.promise;
      state.speculation = { used: (state.speculation?.used ?? 0) + (reply ? 1 : 0), discarded: state.speculation?.discarded ?? 0 };
    } else if (speculation) {
      speculation.controller.abort();
      state.speculation = { used: state.speculation?.used ?? 0, discarded: (state.speculation?.discarded ?? 0) + 1 };
    }
    reply ??= await gmReply(scene, state, [...ruled, ...directive], speakHooks(textHooks, "gm", "narration"));
    spoken.push(reply);
    noting.push(pushReply(scene, state, hooks, reply));
  } else {
    // Narration first when something happened that only the GM can describe.
    let next = directive.length || ruled.length || !pre.speaker ? "gm" : pre.speaker;
    const responded: string[] = [];
    for (let i = 0; i < 4 && next !== "player"; i++) {
      const line = next === "gm"
        ? await narratorReply(scene, state, i === 0 ? [...ruled, ...directive] : [], speakHooks(textHooks, "gm", "narration"))
        : await actorReply(scene, state, next, [
          ...(i === 0 && pre.limit ? [limitDirective(pre.limit)] : []),
          ...(state.whispers ?? []).filter(w => w.to === next).map(w => w.note),
        ], speakHooks(textHooks, next, "dialogue"));
      spoken.push(line);
      noting.push(pushReply(scene, state, hooks, line));
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
  // What the player might say or do next: from the reply, alongside the after-reply work, never waited for.
  if (options.suggest && !ended) startSuggesting(state, hooks);
  { const b = currentBeat(scene, state); if (b.pressure && state.turnsInBeat >= 2 && !state.pressureOffered?.includes(b.id)) state.pressureOffered = [...(state.pressureOffered ?? []), b.id]; }
  for (const s of spoken) { costUsd += s.result.costUsd; calls++; }

  let postDecisionMs = 0;
  let leftPlace = false;
  const replyText = spoken.map(s => s.speaker === "gm" ? s.text : `${scene.cast.find(c => c.id === s.speaker)?.name}: ${s.text}`).join("\n\n");
  // Whoever came on this turn (a cue's entrance, someone called in) is in the world before the stage
  // manager reads it: otherwise it makes them again from the reply ("a young man in livery") beside
  // the cast's own, who joins the world at the end of the turn. (What they have of what's owed comes with them.)
  if (state.world) { joinWorld(state.world, presentCast(scene, state).map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), state.turn); placeOwedThings(state); }
  // The stage manager keeps the world in step with what the reply established, alongside the decision.
  const staging = state.world ? stageManage(state.world, state.player, input, replyText, state.turn, {
    rules: state.transcript.filter(e => e.turn === state.turn && e.kind === "roll" && (e.scene ?? state.sceneId) === state.sceneId).map(e => e.text),
    cast: presentCast(scene, state).map(c => ({ id: c.id, name: c.name, look: c.look })),
  }).catch(() => undefined) : undefined;
  if (!ended) {
    const postStarted = performance.now();
    const hold = state.pendingExit?.turn === state.turn ? state.pendingExit.exitId : undefined;
    const post = await decideAfter(decider, scene, state, input, replyText, { ...(hold ? { hold } : {}), staging: approach.staging === true, rules: !!state.rules });
    postDecisionMs = performance.now() - postStarted;
    if (post.decision) { costUsd += post.decision.costUsd; calls++; }
    if (post.status) state.sceneStatus = post.status;
    if (post.threat && !state.closing) state.threat = { ...post.threat, turn: state.turn };
    if (post.left && !state.closing && !post.move?.exit) leftPlace = true;
    if (post.landed?.length) state.landed = [...new Set([...(state.landed ?? []), ...post.landed])];
    if (post.hinted?.length) state.hinted = [...new Set([...(state.hinted ?? []), ...post.hinted])];
    // Staged secrets never go back: what's out stays out.
    for (const [id, stage] of Object.entries(post.guard ?? {})) {
      const was = state.guard?.[id]?.stage ?? "surface";
      if (GUARD_STAGES.indexOf(stage) > GUARD_STAGES.indexOf(was)) state.guard = { ...(state.guard ?? {}), [id]: { stage, turn: state.turn } };
    }
    // Where the story stands: an ending that leads twice running (or clearly) closes the scene.
    if (post.ending && !post.move && !state.closing && !state.pendingExit) {
      const lead = state.endingLead?.exitId === post.ending.exitId ? state.endingLead.count + 1 : 1;
      state.endingLead = { exitId: post.ending.exitId, count: lead, probability: post.ending.probability };
      const exit = scene.exits.find(e => e.id === post.ending!.exitId);
      if (exit && (post.ending.probability >= 0.6 || (lead >= 2 && post.ending.probability >= 0.35))) {
        state.path.push({ turn: state.turn, from: state.beat, to: exit.id, via: "ending-reached", source: "post" });
        if (exit.kind === "combat") ended = exit;
        else state.closing = { exitId: exit.id, turn: state.turn };
        delete state.endingLead;
      }
    } else if (!post.ending) delete state.endingLead;
    if (post.move) {
      if (post.move.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(post.move.roll, post.move.transition.check?.reason) });
      applyMove(state, scene, post.move, "post");
      if (post.move.exit) {
        delete state.pendingExit;
        // A fight has already broken out in the reply; anything else gets one wind-down turn.
        if (post.move.exit.kind === "combat") ended = post.move.exit;
        else state.closing = { exitId: post.move.exit.id, turn: state.turn };
      }
    }
  }
  const staged = staging ? await staging : undefined;
  if (staged) { costUsd += staged.costUsd; calls++; }
  // What the stage manager asked for and the world refused stays on record (a hand-over that failed).
  for (const problem of staged?.problems ?? []) state.world?.log.push({ turn: state.turn, text: `(not done) ${problem}`, by: "stage" });
  // The player has walked out of this place altogether: the scene ends here, and the boundary decides
  // what comes next (rather than the scene's own endings chasing them across town).
  // Only the player walking out takes them out of the place (the decider's read): a stage-manager op
  // that removes them (meant for someone else) is undone, and noted.
  const me = state.world?.entities.player;
  if (me?.states.includes("gone") && !leftPlace) {
    me.states = me.states.filter(s => s !== "gone");
    state.world!.log.push({ turn: state.turn, text: "(not done) remove: the player leaves only by walking out", by: "stage" });
  }
  if (!ended && !state.closing && (leftPlace || me?.states.includes("gone"))) {
    ended = scene.exits.find(e => e.id === IMPROVISED_EXIT_ID);
    if (ended) state.path.push({ turn: state.turn, from: state.beat, to: ended.id, via: "left-the-place", source: "post" });
  }
  // Gear the story moved away from the player (or back) changes their sheet.
  if (state.world && state.rules) {
    for (const e of Object.values(state.world.entities).filter(x => x.gear)) {
      let holder = e.parent ? state.world.entities[e.parent] : undefined;
      for (let n = 0; n < 20 && holder && holder.kind !== "person" && holder.kind !== "area" && holder.kind !== "place" && holder.parent; n++) holder = state.world.entities[holder.parent];
      const carried = holder?.player === true && !e.states.includes("destroyed") && !e.states.includes("gone");
      const line = await carryGear(state, e.gear!, carried).catch(() => undefined);
      if (line) push(state, hooks, { speaker: "dice", kind: "roll", text: line });
    }
  }
  // Whoever is on stage now (an entrance, someone called in) is in the world too.
  if (state.world) { joinWorld(state.world, presentCast(scene, state).map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), state.turn); placeOwedThings(state); }
  if (!state.path.some(p => p.turn === state.turn && p.to !== p.from)) state.turnsInBeat++;

  if (ended && authored.createsCharacter) await extractCharacter(authored, state);
  if (ended) { finishScene(state, authored, ended); stopSuggesting(state); }
  // When did text that actually answers the player start? (the follow-up, after a holding beat)
  const resolvingTextMs = followUpMs ?? firstTextMs;
  const markup = sumStats(spoken.map(s => s.stats));
  const written = await Promise.all(noting);
  const notes = notesOf(written);
  if (notes) { costUsd += notes.costUsd; calls += written.filter(Boolean).length; }
  const metric: TurnMetric = { turn: state.turn, repairMs, preDecisionMs, firstTextMs, followUpMs, resolvingTextMs, replyMs, postDecisionMs, costUsd, calls, ...(considerMs !== undefined ? { considerMs } : {}), ...(markup ? { markup } : {}), ...(notes ? { notes } : {}) };
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
  // What happens to the place offstage once it's over (not yet, if a fight comes first).
  if (state.world && scene.afterwards?.length && exit.kind !== "combat") {
    applyOps(state.world, scene.afterwards.map(o => ({ to: "", how: "", name: "", kind: "", text: "", add: [], remove: [], ...o })), state.turn, "rules");
  }
  state.transcript.push({ turn: state.turn, scene: state.sceneId, speaker: "system", kind: "system", text: `Scene ends: ${exit.title}` });
}

/**
 * After a fight played out on the map, the scene picks up from its outcome: the GM narrates the
 * aftermath, and the scene goes on to whichever ending the story reaches (the fight's exit is spent).
 * `suggest`: then what the player might say or do next, never waited for.
 */
export async function resumeAfterFight(state: SessionState, summary: string, hooks: TurnHooks = {}, options: { suggest?: boolean } = {}): Promise<Entry[]> {
  const exitId = state.ended?.exitId;
  delete state.ended; delete state.closing; delete state.pendingExit; delete state.endingLead; delete state.brawl; delete state.threat;
  if (exitId) state.fought = [...(state.fought ?? []), exitId];
  state.established.push(`The fight is over: ${summary}`);
  const before = state.transcript.length;
  push(state, hooks, { speaker: "system", kind: "system", text: `The fight: ${summary}` });
  const scene = effectiveScene(sceneById(state.sceneId), state.patches);
  const spoken = await gmReply(scene, state, [`The fight is over, and this is how it went: ${summary}. Narrate the immediate aftermath in a short paragraph: who is down, who is held, who has run, what is burning or broken, and how people are taking it. Don't replay the fight blow by blow. The fight's result stands as it went: if the player's side lost, they lost, and the winners do what they'd do with a beaten foe; nothing in the aftermath turns it round. Then hand the moment back to the player: the scene isn't over until the story says so.`], speakHooks(hooks, "gm", "narration"), "gm.aftermath");
  // The reply's notes and the lines to suggest are made side by side: neither waits for the other.
  const noting = pushReply(scene, state, hooks, spoken);
  if (options.suggest) startSuggesting(state, hooks);
  await noting;
  saveSession(state);
  return state.transcript.slice(before);
}

/** Test harness: end the scene through a given exit now (as if play had reached it). */
export function forceEnding(state: SessionState, exitId: string): void {
  const scene = sceneById(state.sceneId);
  const exit = scene.exits.find(e => e.id === exitId);
  if (!exit) throw new Error(`Scene ${scene.id} has no exit ${exitId}`);
  finishScene(state, scene, exit);
  saveSession(state);
}

/** Continue into the exit's next scene in the same session (the map would sit in between). */
export async function chainScene(state: SessionState, combatResult = "the party won", options: { skipInterludes?: boolean } = {}): Promise<SessionState | undefined> {
  if (!state.ended) return undefined;
  const scene = sceneById(state.sceneId);
  const exit = scene.exits.find(e => e.id === state.ended!.exitId)!;
  if (!exit.next) return undefined;
  // The scenes the story could go to, in order: the next one, then wherever it goes if overtaken.
  const candidates: Scene[] = [];
  for (let id: string | undefined = exit.next; id && candidates.length < 6 && !candidates.some(c => c.id === id); ) {
    const candidate = sceneById(id);
    // With a map to walk, downtime between scenes is the map: go straight on to where it leads.
    if (options.skipInterludes && candidate.interlude) { id = candidate.exits.find(e => e.next)?.next; continue; }
    candidates.push(candidate);
    id = candidate.assumes?.length ? candidate.overtaken : undefined;
  }
  if (!candidates.length) return undefined;
  // What the story still owes the player (missed here or before), from the world as this scene leaves it.
  const owed = owedAtEnd(scene, state);
  const { handoff, sceneId, adjustments, skipped, opening, lead, fronts, owed: verdict } = await crossBoundary(scene, state, exit, combatResult, candidates, undefined, owed);
  const memory = approachById(state.approach).memory;
  if (memory === "docs") broadcastEnding(scene, state, exit);
  if (memory === "lite") await rememberScene(scene, state, `${exit.title}: ${exit.outcome}`).catch(() => undefined);
  if (memory) savePlayedScene(state.id, scene, exit.title, handoff);
  const lastMoments = sceneEntries(state).filter(e => e.kind !== "system").slice(-4)
    .map(e => e.kind === "player" ? `${state.player.name} (player): ${e.text}` : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.text);
  const journal = journalOf(state);
  state.history.push({ sceneId: scene.id, exitId: exit.id, summary: handoff, lastMoments, ...(skipped.length ? { skipped } : {}), ...(fronts.length ? { fronts } : {}), ...(journal.length ? { journal } : {}) });
  const next = sceneById(sceneId);
  // What the player carries goes with them into the next scene's world.
  if (state.world) state.carried = carriedBy(state.world.entities, "player");
  delete state.world;
  freshScene(state, next);
  Object.assign(state, { adjustments, opening, lead });
  // What's still owed goes on, and what can come up in the next scene is one of its essentials.
  bringOver(state, next, owed, verdict);
  saveSession(state);
  return state;
}

/** The notebook's lines the ending of the scene just played wrote (its exit script's journal). */
export function journalOf(state: SessionState): string[] {
  return (state.ended?.operations ?? []).filter(o => o.op === "journal").map(o => String(o.args["entry"] ?? "")).filter(Boolean);
}

/**
 * The session starts a scene afresh: nothing of the last scene's own state carries on (its beat and
 * path, its prep's patches, the co-GM's notes, what was pending). A wind-down or ending pending when
 * the scene ended (a /end) belongs to that scene, not the next.
 */
function freshScene(state: SessionState, next: Scene): void {
  Object.assign(state, {
    sceneId: next.id, beat: next.start, turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    whispers: [], patches: [], repairs: [], entered: [], absent: [], sceneStatus: undefined, memory: { opened: [] }, landed: [], hinted: [], guard: {},
    fought: [], rulings: [],
  });
  delete state.ended;
  delete state.threat;
  delete state.brawl;
  delete state.closing; delete state.pendingExit; delete state.endingLead;
  delete state.suggestions;
}

/**
 * A hub's scenes (the zoo's: src/game/zoo): the session plays another scene from its start, as it's
 * written. Nothing of the last carries on but the player, what they carry, their sheet, the dice and
 * the record of how scenes ended: no hand-off and no lead, because a hub's scenes are exhibits, not a
 * story. The scene can be one it has played before.
 */
export function openHubScene(state: SessionState, sceneId: string): void {
  const next = sceneById(sceneId);
  closeHubScene(state);
  freshScene(state, next);
  delete state.adjustments; delete state.opening; delete state.lead;
}

/**
 * A hub's scene is over and its map takes over (the explorer has kept what the scene did to its
 * place): what the player carries comes out of its world, and the world goes.
 */
export function closeHubScene(state: SessionState): void {
  if (state.world) state.carried = carriedBy(state.world.entities, "player");
  delete state.world;
}

/**
 * The scene boundary: the hand-off (the state of things as established in play), and, in parallel,
 * which upcoming scene still holds (a scene whose premise play has already settled or bypassed is
 * skipped) and where that scene's prep is out of date. Prep is written before play; this is where
 * it catches up. What the story still owes the player (`owed`) is judged in the same call: found
 * after all, or whether it can come up in that scene, and where (src/runtime/owed.ts).
 */
async function crossBoundary(scene: Scene, state: SessionState, exit: Exit, combatResult: string, candidates: Scene[], frontsDoc?: string, owed: Owed[] = []): Promise<{ handoff: string; sceneId: string; adjustments: string[]; skipped: Array<{ sceneId: string; why: string }>; opening?: string; lead?: string; fronts: string[]; owed?: OwedVerdict[] }> {
  const transcript = sceneEntries(state).map(e => e.kind === "player" ? `${state.player.name} (player): ${e.text}` : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.kind === "narration" ? `GM: ${e.text}` : `[${e.text}]`).join("\n\n");
  const ended = `${exit.title} (${scene.id}: ${exit.id}). ${exit.outcome}${exit.kind === "combat" ? ` The fight was then played out on the map: ${combatResult}.` : ""}`;
  const story = [
    ...(state.history.length ? [`## The story before the last scene\n${state.history.map(h => h.summary).join("\n\n")}`] : []),
    `## The last scene: ${scene.title}\nHow it ended: ${ended}\nThe player character: ${state.player.name}, ${state.player.concept} (the only player character).\n\n${transcript}`,
  ].join("\n\n");
  const prep = (c: Scene) => [
    `### ${c.id}: ${c.title}`,
    `What it's about (the GM's question, not the player's): ${c.premise}`,
    c.assumes?.length ? `It takes for granted:\n${c.assumes.map(a => `- ${a}`).join("\n")}` : "It takes nothing for granted: it always holds.",
    `Its opening (its time and place): ${c.opening}`,
    ...(c.background?.length ? [`Its background: ${c.background.join(" ")}`] : []),
    // (With something owed, their ids: the verdict names who there could bring it out.)
    `Its people: ${c.cast.map(p => `${p.name}${owed.length ? ` [${p.id}]` : ""} (${p.look.slice(0, 220)}${p.look.length > 220 ? "..." : ""})`).join("; ")}`,
    ...(owed.length && owedPrep(c, owed) ? [owedPrep(c, owed)!] : []),
  ].join("\n");
  // The time between: what the people the story carries on with (the last scene's, who are in the
  // scenes to come) do on their own, from their lore, which is as true as play; and the names the
  // player hasn't heard, which mean nothing to them yet. The way on is told from those and from play.
  const onward = new Set(candidates.flatMap(c => c.cast.map(p => p.id)));
  const errands = scene.cast.filter(c => onward.has(c.id)).flatMap(c => { const text = errandsOf(state.id, c.id); return text ? [`### ${c.name}\n${text}`] : []; });
  const hookOf = (id: string) => { try { return sceneById(id).hook; } catch { return ""; } };
  const unheard = strangers([scene, ...candidates], state, [...state.history.map(h => hookOf(h.sceneId)), scene.hook]);
  const between = [
    ...(errands.length ? [`## What people do between scenes (their lore, GM only)\nWhat each of the people the story goes on with does on their own if nobody stops them. In the time before the next scene it happens as written, unless what happened in play rules it out (they were taken in, hurt or sent elsewhere, or the reason for it is gone). They know only what they did and saw, and the player only what they're told of it or were there for.\n\n${errands.join("\n\n")}`] : []),
    ...(unheard.length ? [`## Names the player hasn't heard\nNobody has said these names where the player could hear: to the player, each is only what's in quotes until someone does.\n${unheard.map(s => `- ${s.name}: "${s.called}"`).join("\n")}`] : []),
  ];
  const handoff = respond({
    operation: "handoff", effort: "low",
    instructions: "You write the hand-off between two scenes of a roleplaying game, for the GM of the next scene. Describe the state of things in the story at the moment the last scene ended, exactly as it was established in play (not as anyone planned it): who is where and in what state, who holds what, what was promised or agreed, what the player character learned, and how people feel. Things that were offered but refused, or threatened but not done, didn't happen. Leave out anything said out of character (questions or agreements about the game itself). Be concrete and brief: a short paragraph, then up to eight bullet points.",
    input: [{ role: "user", content: story }],
  }).then(r => `Previous scene, "${scene.title}", ended: ${exit.title} (${scene.id}: ${exit.id}).\n${r.text.trim()}`).catch(() => `Previous scene, "${scene.title}", ended: ${ended}`);
  const verdict = respondJson<{ scenes: Array<{ id: string; holds: boolean; why: string }>; adjustments: string[]; opening: string; lead: string; owed?: Array<Omit<OwedVerdict, "here"> & { here: boolean }> }>({
    operation: "boundary", effort: "low",
    instructions: [
      "The upcoming scenes of a roleplaying game were written before play. Check them against what has actually happened in the story, and bring the player on to the next one.",
      "Everything you write must already be true: what happened in play, or what people did on their own in the time between scenes, as their lore below says. Make up no fact and no source for one: no record, message, witness, order or find that neither of those has. The player knows only what they saw and heard in play and what someone tells them, and knows nobody by name until they've heard the name: the list below has the people of these scenes whose names they haven't, and the same goes for anyone else.",
      "1. scenes: for each upcoming scene, in order, judge whether what it takes for granted still holds. A scene is overtaken when play has already done, prevented or bypassed what it is about (its central matter is settled, the people it needs are gone, the thing it's built around has already happened).",
      "2. adjustments: for the first upcoming scene that still holds, list each point where its prep (what it's about, its opening, its background, its people) no longer matches the story: where someone is or what state they're in, who holds what, what people know, what has already happened. The scene's own time and place stand (it may start after a gap, such as the next morning): say what's true by then. Write each as a short statement of what is true instead, so its GM can adapt (\"Hobb is in the watch-house cells, not on the hoist.\"). Leave out everything that still fits. An empty list is fine.",
      "3. opening: that scene's opening direction, rewritten so it starts where the story actually is. Keep the author's intent (the place, the mood, what a first glance shows, what to end on) and drop or change whatever the adjustments make untrue; never replay something that has already happened (an arrival, a first meeting, a discovery). It's told to the player, so anyone whose name they haven't heard goes by what they'd call them. If nothing needs changing, return the author's opening as it is.",
      "4. lead: one or two sentences of second-person fiction that the player reads as the time passes. Having read it, they know where the story goes next (that first scene that holds: its place), why they're going and what they hope to find out there, in their own terms (what they've seen and been told, never what the scene is about), and how the time between passed for them. Its reasons are what they learned in play and what someone tells them of what they did in the time between (in that person's own reasoning, as their lore has it), joined up the way the player would join them; never the coming scenes' prep or the GM's truth, not even as a hope. Anyone whose name they haven't heard goes by what they'd call them, and anyone they've never met or heard of comes in as they were seen (\"a woman in a grey hood\"). No game talk.",
      ...(owed.length ? [OWED_INSTRUCTION] : []),
    ].join("\n"),
    input: [{ role: "user", content: [story, ...between, ...(owed.length ? [owedText(owed)] : []), `## Upcoming scenes, in order (the GM's prep, written before play: the player knows none of it)\n${candidates.map(prep).join("\n\n")}`].join("\n\n") }],
    json: { name: "boundary", schema: { type: "object", additionalProperties: false, required: ["scenes", "adjustments", "opening", "lead", ...(owed.length ? ["owed"] : [])], properties: {
      scenes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "holds", "why"], properties: { id: { type: "string" }, holds: { type: "boolean" }, why: { type: "string" } } } },
      adjustments: { type: "array", items: { type: "string" } },
      opening: { type: "string" },
      lead: { type: "string" },
      ...(owed.length ? { owed: owedSchema([...new Set(candidates.flatMap(c => c.cast.map(p => p.id)))]) } : {}),
    } } },
  }).catch(() => undefined);
  // What's in motion in the world (the GM's fronts), as it stands in this session, moves on here too.
  const frontsPath = frontsDoc ?? scene.fronts ?? candidates.find(c => c.fronts)?.fronts;
  const fronts = frontsPath ? frontsText(state.id, frontsPath) : undefined;
  const moving = fronts ? moveOn(story, candidates[0]!, fronts) : Promise.resolve(undefined);
  const [text, result, motion] = await Promise.all([handoff, verdict, moving]);
  const moved = frontsPath && motion ? moveFronts(state.id, frontsPath, motion, scene.title) : [];
  // The first scene that holds: one that takes nothing for granted always does.
  const holds = (c: Scene) => !c.assumes?.length || result?.scenes.find(v => v.id === c.id)?.holds !== false;
  const chosen = candidates.find(holds) ?? candidates.at(-1)!;
  const skipped = candidates.slice(0, candidates.indexOf(chosen)).map(c => ({ sceneId: c.id, why: result?.scenes.find(v => v.id === c.id)?.why ?? "" }));
  // The rewritten opening is for the scene the verdict was about: the first that holds.
  const firstHolding = result ? candidates.find(c => !c.assumes?.length || result.scenes.find(v => v.id === c.id)?.holds !== false) : undefined;
  const opening = firstHolding?.id === chosen.id && result?.opening?.trim() ? result.opening.trim() : undefined;
  const lead = firstHolding?.id === chosen.id && result?.lead?.trim() ? result.lead.trim() : undefined;
  const shows = chosen.id === candidates[0]!.id ? motion?.shows ?? [] : [];
  const adjustments = [...(result?.adjustments ?? []).slice(0, 10), ...shows.slice(0, 2)].map(a => a.trim()).filter(Boolean);
  // What's owed: found after all (that's about the last scene), and whether and where it comes up
  // next (only when the verdict was about the scene the story goes to).
  const judged = result?.owed?.filter(v => owed.some(o => owedKey(o) === v.id))
    .map((v): OwedVerdict => firstHolding?.id === chosen.id ? v : { id: v.id, found: v.found, placedWith: [], carriers: [], why: v.why });
  return { handoff: text, sceneId: chosen.id, adjustments, skipped, ...(opening ? { opening } : {}), ...(lead ? { lead } : {}), fronts: moved, ...(judged ? { owed: judged } : {}) };
}

/**
 * The scene boundary, crossed without moving on (the zoo's boundary desk): the hand-off of the scene
 * the session last played, a next scene's prep checked against what happened (what's out of date,
 * its opening rewritten, how the player hears of it, and what the story still owes the player), and
 * the fronts moved on in the session's copy of their doc, all exactly as chainScene does them; but
 * the session stays where it is.
 */
export async function boundaryPreview(state: SessionState, nextId: string, frontsDoc?: string): Promise<{ handoff: string; adjustments: string[]; opening?: string; lead?: string; fronts: string[]; owed: string[] }> {
  const scene = sceneById(state.sceneId);
  const exitId = state.ended?.exitId ?? state.history.findLast(h => h.sceneId === scene.id)?.exitId;
  const exit = scene.exits.find(e => e.id === exitId);
  if (!exit) throw new Error(`${scene.title} hasn't ended: there's nothing to hand on yet.`);
  const next = sceneById(nextId);
  const owed = owedAtEnd(scene, state);
  const crossed = await crossBoundary(scene, state, exit, "the party won", [next], frontsDoc, owed);
  return { handoff: crossed.handoff, adjustments: crossed.adjustments, ...(crossed.opening ? { opening: crossed.opening } : {}), ...(crossed.lead ? { lead: crossed.lead } : {}), fronts: crossed.fronts, owed: carryLines(owed, next, crossed.owed) };
}

/**
 * The world's turn at a scene boundary: which steps of what's in motion (the fronts doc) play or
 * the time passing has made true or meaningless, any new bills to come due, and how what's newly
 * true shows in the next scene. Runs alongside the boundary verdict.
 */
async function moveOn(story: string, next: Scene, fronts: string): Promise<(FrontChanges & { shows: string[] }) | undefined> {
  const step = { type: "object", additionalProperties: false, required: ["front", "step"], properties: { front: { type: "string" }, step: { type: "string" } } };
  return respondJson<FrontChanges & { shows: string[] }>({
    operation: "fronts", effort: "low",
    instructions: [
      "You keep a roleplaying game's world moving between scenes, whether or not the player is looking. Below are the story so far, the next scene (its time and place), and what's in motion: fronts, each with a clock of steps.",
      "- ticked: the unticked steps (\"- [ ]\") that what happened, or the time passing until the next scene opens, has now made true. Give each by its front (the ## heading) and the step's bold opening words. A step ticks because its condition is met or its hour has come, never because it would be dramatic, and nobody acts on what they couldn't have learned (each step says who learns what, and from whom).",
      "- struck: unticked steps that play has made impossible or meaningless (the person is arrested, dead or gone, the thing destroyed, the matter settled), with why in a few words.",
      "- bills: usually none. When the player did something reckless, violent or daft in the last scene that the world would answer later, a line for each such consequence: \"If <what happened>: <who answers it, how, and where it will show>\". The bills already listed are on their way: never add one again, and add only what none of them covers. At most two.",
      "- shows: what's newly true that the player could meet in the next scene, by how it shows there (something seen, or someone who'd say it), as short statements of fact for its GM. Only what fits the next scene's time and place, at most one per front and from no more than two fronts. Often none.",
    ].join("\n"),
    input: [{ role: "user", content: `${story}\n\n## The next scene: ${next.title}\nWhen and where: ${next.setting}\nIts opening: ${next.opening}\n\n## What's in motion (GM only)\n${fronts}` }],
    json: { name: "fronts", schema: { type: "object", additionalProperties: false, required: ["ticked", "struck", "bills", "shows"], properties: {
      ticked: { type: "array", items: step },
      struck: { type: "array", items: { ...step, required: ["front", "step", "why"], properties: { ...step.properties, why: { type: "string" } } } },
      bills: { type: "array", items: { type: "string" } },
      shows: { type: "array", items: { type: "string" } },
    } } },
  }).catch(() => undefined);
}

export function transcriptMarkdown(state: SessionState, options: { allScenes?: boolean } = {}): string {
  const scene = sceneById(state.sceneId);
  const entries = options.allScenes ? state.transcript : sceneEntries(state);
  // A GM reply's markup goes under it: who says what, and each marked phrase's note.
  const marked = (e: Entry) => { const at = e.scene ? sceneById(e.scene) : scene; return [e.text, ...markupLines(e.text, e.marked!, id => nameAsKnown(at, state, id))].join("\n"); };
  return entries.map(e => e.kind === "player" ? `> **${state.player.name}:** ${e.text}` : e.kind === "roll" ? `🎲 *${e.text}*` : e.kind === "system" ? `*— ${e.text} —*` : e.kind === "dialogue" ? `**${(e.scene ? sceneById(e.scene) : scene).cast.find(c => c.id === e.speaker)?.name ?? e.speaker}:** ${e.text}` : e.marked ? marked(e) : e.text).join("\n\n");
}

/**
 * A jump in a scene: how far from the world when it knows where they're going (or the decider's
 * read), the rules decide whether they make it, and the world puts them where they land: across,
 * or in what they were jumping over (wet, if it was water; prone, after a fall).
 */
async function leap(state: SessionState, j: Jumping): Promise<Outcome> {
  const world = state.world;
  const landing = world && j.to ? (j.to.near ?? j.to.area) : undefined;
  // The gap, as the world has it (the ditch's ten feet, not the walk to its far side): see jumpGap.
  const measured = world && landing && j.how === "long" ? jumpGap(world, landing, j.over) : undefined;
  const feet = j.how === "high" ? j.feet ?? 5 : measured ?? j.feet ?? 10;
  const drop = j.how === "down" ? Math.max(j.drop, 10) : j.drop;
  const result = j.how === "down"
    ? await jump(state, { feet: Number.POSITIVE_INFINITY, drop }).then(r => ({ ...r, lines: [`Jump down: ${drop} ft`, ...r.lines.slice(1)], account: r.account.replace(/^.*?fall short, and /, "") }))
    : await jump(state, { feet, high: j.how === "high", runUp: j.runUp, drop });
  const lines = [...result.lines];
  if (world) {
    const blank = { what: "player", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };
    const ops: WorldOp[] = [];
    if (result.made && j.to?.area) ops.push({ ...blank, op: "move", to: j.to.area });
    if (result.made && j.to?.near) ops.push({ ...blank, op: "move", to: j.to.near });
    if (!result.made && j.over && world.entities[j.over]) ops.push({ ...blank, op: "place", to: j.over, how: "on" });
    if (!result.made && j.water) ops.push({ ...blank, op: "state", add: ["wet"] });
    if (ops.length) applyOps(world, ops, state.turn, "rules");
  }
  const where = j.how === "down" ? "down" : `${j.how === "high" ? "up" : "across"}${j.over && world?.entities[j.over] ? ` over ${world.entities[j.over]!.name}` : ""}${landing && world?.entities[landing] ? ` to ${world.entities[landing]!.name}` : ""}`;
  return {
    lines,
    directive: `Rules: the player jumped ${where}: ${result.account}.${!result.made && j.water ? " They go into the water: soaked, and the cold takes their breath." : ""} Narrate exactly that, and let the people present react.`,
    ...(result.status ? { status: result.status } : {}),
  };
}

const nameIn = (scene: Scene, state: SessionState, id: string) => state.rules?.aliases?.[id] ?? scene.cast.find(c => c.id === id)?.name ?? state.world?.entities[id]?.name ?? id;

/**
 * Did the player just do violence people would react to? A blow or a grab at a person, a harmful
 * spell at or around people, or one that set something burning or broke it where people are. The
 * rules have already decided what it did; this reads it off the mechanic and the world's states.
 */
async function violence(scene: Scene, state: SessionState, m: Mechanic, before: Record<string, string[]> | undefined): Promise<Act | undefined> {
  const world = state.world;
  const people = new Set([...presentCast(scene, state).map(c => c.id), ...(world ? Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !e.states.includes("gone")).map(e => e.id) : [])]);
  const name = (id: string) => nameIn(scene, state, id);
  const newly = (e: Entity, states: string[]) => !!before && e.states.some(x => states.includes(x)) && !(before[e.id] ?? []).some(x => states.includes(x));
  if (m.kind === "attack" || m.kind === "wrestle") {
    if (people.has(m.target)) return { what: m.kind === "attack" ? `attacked ${name(m.target)}${m.weapon ? ` (${m.weapon.replace(/-/g, " ")})` : ""}` : `laid hands on ${name(m.target)} (${m.how === "grapple" ? "grabbed them" : "shoved them"})`, victims: [m.target], property: [] };
    // Cutting a rope or breaking a crate isn't violence anyone fights over; setting it alight is alarming.
    const lit = world?.entities[m.target];
    return lit && newly(lit, ["burning"]) ? { what: `set ${lit.name} alight`, victims: [], property: [lit.id] } : undefined;
  }
  if (m.kind !== "cast") return undefined;
  const spell = await spellInfo(m.spell);
  const harmful = (spell?.mechanicalEffects ?? []).some(e => e["damageType"] || ["attack", "auto-hit", "hp-pool-knockout", "save"].includes(String(e["kind"])));
  if (!spell || !harmful) return undefined;
  const hurt = world ? Object.values(world.entities).filter(e => people.has(e.id) && newly(e, ["hurt", "badly hurt", "down", "burning", "prone"])).map(e => e.id) : [];
  const victims = [...new Set([...m.targets.filter(t => people.has(t)), ...hurt])];
  const property = world ? Object.values(world.entities).filter(e => (e.kind === "object" || e.kind === "item" || e.kind === "feature") && newly(e, ["burning", "destroyed", "broken"])).map(e => e.id) : [];
  if (!victims.length && !property.length) return undefined;
  const parts = [victims.length ? `at ${victims.map(name).join(", ")}` : "", property.length ? `setting ${property.slice(0, 4).map(name).join(", ")} burning or breaking it` : ""].filter(Boolean);
  return { what: `cast ${spell.name} ${parts.join(", ")}`, victims, property };
}

/** Who saw it: everyone present who isn't out of it (down, gone), the hurt first. */
function witnessesOf(scene: Scene, state: SessionState, act: Act): Witness[] {
  const world = state.world;
  const out = (id: string) => !!world?.entities[id] && ["down", "gone", "dead"].some(s => world.entities[id]!.states.includes(s));
  const cast = presentCast(scene, state).filter(c => !out(c.id)).map(c => ({ id: c.id, name: c.name, about: `${c.statblock ?? "commoner"}${c.group ? `, ${c.group}` : ""}. ${c.attitude.slice(0, 280)}${c.fears ? ` Fears: ${c.fears.slice(0, 160)}` : ""}` }));
  const cast_ = new Set(scene.cast.map(c => c.id));
  const others = world ? Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !cast_.has(e.id) && !out(e.id))
    .map(e => ({ id: e.id, name: e.name, about: `${e.stats?.statblock ?? (e.kind === "creature" ? "beast" : "commoner")}. ${e.description ?? ""}`.trim() })) : [];
  return [...cast, ...others].sort((a, b) => Number(act.victims.includes(b.id)) - Number(act.victims.includes(a.id))).slice(0, 10);
}

/** The reactions take effect: the fleeing leave, the cowering cower, and a fight starts if anyone wants one. */
function react(scene: Scene, state: SessionState, act: Act, reactions: Record<string, Reaction>): void {
  const world = state.world;
  const fled: string[] = [];
  for (const [id, r] of Object.entries(reactions)) {
    const e = world?.entities[id];
    if (r === "flee" || r === "raise_alarm") {
      fled.push(id);
      if (scene.cast.some(c => c.id === id)) state.absent = [...new Set([...(state.absent ?? []), id])];
      if (e) { e.states = [...e.states.filter(s => s !== "cowering"), "gone"]; e.notes.push({ text: r === "raise_alarm" ? `ran for help after the player ${act.what}` : `fled when the player ${act.what}`, turn: state.turn, by: "rules" }); }
    } else if (r === "cower" && e && !e.states.includes("cowering")) e.states.push("cowering");
  }
  const against = Object.entries(reactions).filter(([, r]) => r === "fight").map(([id]) => id);
  if (!against.length) return;
  const allies = Object.entries(reactions).filter(([, r]) => r === "join_player").map(([id]) => id);
  state.brawl = { turn: state.turn, cause: act.what, against, allies, fled };
  // Without a map to fight it out on, the first of them swings at the player next turn.
  state.threat = { kind: "attack", by: against[0]!, turn: state.turn };
}

/** What the player could aim a spell or a blow at in the world: things near them, and people outside the cast. */
function aimable(state: SessionState): { things: Array<{ id: string; name: string }>; bystanders: Array<{ id: string; name: string }>; places: Array<{ id: string; name: string }>; landmarks: Array<{ id: string; name: string }> } {
  const world = state.world!;
  const cast = new Set(sceneById(state.sceneId).cast.map(c => c.id));
  // Anything in reach of a spell or a blow, except what other people are holding.
  const inOthersHands = (e: Entity) => { const h = heldBy(world, e); return !!h && (h.kind === "person" || h.kind === "creature") && !h.player; };
  // Not what the player carries (their coins took the slots), nor what nobody can see yet.
  const ownOrHidden = (e: Entity) => !!heldBy(world, e)?.player || e.states.includes("hidden") || e.tags.includes("hidden");
  const things = within(world, "player", 60, e => (e.kind === "object" || e.kind === "item" || e.kind === "feature" || e.kind === "surface") && !e.states.includes("destroyed") && !inOthersHands(e) && !ownOrHidden(e))
    .slice(0, 16).map(e => ({ id: e.id, name: e.name }));
  const bystanders = Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !cast.has(e.id) && !e.states.includes("gone"))
    .map(e => ({ id: e.id, name: e.name }));
  // Where they might act from: an area, or anything in the place someone could walk over to.
  const live = Object.values(world.entities).filter(e => !e.states.includes("gone") && !e.player);
  const places = live.filter(e => e.kind === "area").map(e => ({ id: e.id, name: e.name }));
  const landmarks = live.filter(e => (e.kind === "feature" || e.kind === "object" || e.kind === "person" || e.kind === "creature") && !heldBy(world, e)).map(e => ({ id: e.id, name: e.name }));
  return { things, bystanders, places, landmarks };
}

/** Put the player where they act from before the rules roll (see ActFrom). */
function moveToAct(state: SessionState, from: ActFrom, aim: string | undefined): void {
  const world = state.world!;
  const blank = { what: "player", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };
  const ops: WorldOp[] = [];
  if (from.area) ops.push({ ...blank, op: "move", to: from.area });
  if (from.near) ops.push({ ...blank, op: "move", to: from.near });
  if (from.backOff && aim && world.entities[aim]) ops.push({ ...blank, op: "place", to: aim, how: "away", feet: from.backOff });
  applyOps(world, ops, state.turn, "rules");
}

/** Everything someone holds, and what those things hold. */
export function carriedBy(entities: Record<string, Entity>, holder: string): Entity[] {
  const out: Entity[] = [];
  // Each once: a loop in the tree (something inside what it holds) mustn't go round for ever.
  const seen = new Set<string>([holder]);
  const walk = (id: string) => { for (const e of Object.values(entities).filter(x => x.parent === id && !x.states.includes("gone") && !seen.has(x.id))) { seen.add(e.id); out.push({ ...e, notes: e.notes.slice(-2) }); walk(e.id); } };
  walk(holder);
  return out;
}
