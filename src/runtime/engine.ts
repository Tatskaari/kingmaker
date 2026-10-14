import { deciderFor } from "../llm/decide.ts";
import { respond, respondJson } from "../llm/openrouter.ts";
import { recordingWorld } from "../world/dsl.ts";
import { ASSETS } from "../world/assets.ts";
import { sceneById } from "../../scenes/index.ts";
import { approachById } from "./approaches.ts";
import { currentBeat, effectiveScene, presentCast, sceneEntries } from "./brief.ts";
import { CONSEQUENCE_DIRECTIVE, decideAfter, decideBefore, decideNextSpeaker, FOLLOW_UP_DIRECTIVE, freeformDirective, limitDirective, moveDirective, OOC_DIRECTIVE, plainDirective, pressureDirective, pressureReason, relocateDirective, STALL_DIRECTIVE, type Move } from "./director.ts";
import { describeRoll } from "./dice.ts";
import { applyPendingRepairs, applyRepair, quickRepair, runRepair, writeRepair } from "./repair.ts";
import { SKILLS, type Exit, type Scene, type Skill } from "./scene.ts";
import { newSessionId, saveSession, snapshotSession, type Entry, type EntryKind, type PlayerCharacter, type SessionState, type TurnMetric } from "./session.ts";
import { actorReply, gmReply, narratorReply, type Spoken } from "./voices.ts";
import { disclose, keepOpened, URGENT } from "../lore/disclosure.ts";
import { savePlayedScene } from "../lore/docs.ts";
import { rememberScene } from "../lore/remember.ts";
import { broadcastEnding } from "../lore/reviews.ts";

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
  const directive = state.history.length
    ? [`Open the scene, picking up exactly from how the last one ended (see what happened just before this scene: it outranks the prep). The author's idea for the opening, to adapt to what actually happened: ${scene.opening} Keep it to a short paragraph or two and end on something the player can respond to.`]
    : [`Open the scene. ${scene.opening} Keep it to a short paragraph or two and end on something the player can respond to.`];
  await settlePresence(scene, state, deciderFor(approach.decider)).catch(() => undefined);
  if (approach.memory) {
    // Recurring people walk in remembering: open what bears on this scene before the first line.
    const opening = await disclose(scene, state, "").catch(() => undefined);
    if (opening?.opened.length) keepOpened(state, opening.opened);
  }
  const spoken = approach.voice === "gm"
    ? await gmReply(scene, state, directive, speakHooks(hooks, "gm", "narration"), "gm.opening")
    : await narratorReply(scene, state, directive, speakHooks(hooks, "gm", "narration"));
  push(state, hooks, { speaker: "gm", kind: "narration", text: spoken.text });
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
  let scene = effectiveScene(authored, state.patches);
  const approach = approachById(state.approach);
  const decider = deciderFor(approach.decider);
  const before = state.transcript.length;
  const started = performance.now();
  let costUsd = 0, calls = 0, firstTextMs: number | null = null;
  const markText = () => { if (firstTextMs === null) firstTextMs = performance.now() - started; };
  const textHooks: TurnHooks = { ...hooks, onText: text => { markText(); hooks.onText?.(text); } };

  state.turn++;
  push(state, hooks, { speaker: "player", kind: "player", text: input });

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

  // Speculative reply: start the GM before the decision returns; hold its text until we know it's valid.
  let speculation: { promise: Promise<Spoken | undefined>; controller: AbortController; buffer: string; release?: (text: string) => void } | undefined;
  if (approach.speculative && approach.voice === "gm" && !state.endingLead && !state.sceneStatus?.startsWith("stuck")) {
    const controller = new AbortController();
    const spec = { controller, buffer: "", promise: Promise.resolve(undefined as Spoken | undefined) } as NonNullable<typeof speculation>;
    const onText = (text: string) => { spec.buffer = text; spec.release?.(text); };
    spec.promise = gmReply(scene, state, [], onText, "gm.speculative", controller.signal).catch(() => undefined);
    speculation = spec;
  }
  // Quick-block: start the quick co-GM alongside the decision, so on an off-graph turn its answer
  // is (nearly) ready when we need it; on other turns it's simply ignored.
  const quickStarted = performance.now();
  const quickEarly = approach.repair === "quick-block" && approach.voice === "gm" && !state.closing
    ? quickRepair(authored, state, approach.repairEffort ? { effort: approach.repairEffort } : {}).catch(() => undefined)
    : undefined;
  const disclosing = approach.memory ? disclose(scene, state, input).catch(() => undefined) : undefined;
  const pre = await decideBefore(decider, scene, state, input, { speaker: approach.voice === "actors", freeform: approach.freeformChecks === true, offGraph: approach.repair !== "off", relocate: approach.deciderRelocation === true, pressure: approach.pressureRolls === true, consequences: approach.consequences === true });
  if (pre.offGraph) state.offGraphTurn = state.turn;
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
    directive = moveDirective(scene, state, pre.move);
    if (pre.move.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(pre.move.roll, pre.move.transition.check?.reason) });
    applyMove(state, scene, pre.move, "pre");
    if (pre.move.exit && pre.move.chosen && pre.move.roll && pre.move.exit.kind !== "combat") {
      // The dice decided it: play the decisive moment and the reactions now, close on the next reply.
      directive = directive.filter(d => !d.startsWith("This reply closes the scene"));
      directive.push(`The dice have decided it: this is heading to ${pre.move.exit.title} (${pre.move.exit.outcome}). Play the decisive moment and people's immediate reactions, including anyone who saw it; the scene closes on your next reply, so don't wrap everything up yet.`);
      state.closing = { exitId: pre.move.exit.id, turn: state.turn };
    } else if (pre.move.exit && (pre.move.chosen || pending?.exitId === pre.move.exit.id)) ended = pre.move.exit;
    else if (pre.move.exit) state.pendingExit = { exitId: pre.move.exit.id, turn: state.turn, via: pre.move.transition.id, extended: false };
  } else if (pre.freeform) {
    push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(pre.freeform.roll) });
    state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: "freeform", source: "pre", roll: pre.freeform.roll });
    directive = [freeformDirective(pre.freeform)];
  }
  if (state.endingLead && !pre.move && !state.closing) {
    const exit = scene.exits.find(e => e.id === state.endingLead!.exitId);
    if (exit) directive.push(`The scene may be reaching its end (${exit.title}). Stay at the threshold: don't narrate journeys or arrivals somewhere else; if the player is leaving or the matter is settled, let it close here.`);
  }
  if (pre.daft && !pre.ooc) directive.push(CONSEQUENCE_DIRECTIVE);
  if (pre.pressure && !pre.ooc && !pre.move) {
    if (pre.pressure.roll) push(state, hooks, { speaker: "dice", kind: "roll", text: describeRoll(pre.pressure.roll, pressureReason(scene, pre.pressure)) });
    state.path.push({ turn: state.turn, from: state.beat, to: state.beat, via: `pressure:${pre.pressure.target}:${pre.pressure.band}`, source: "pre", ...(pre.pressure.roll ? { roll: pre.pressure.roll } : {}) });
    directive.push(pressureDirective(scene, pre.pressure));
  }
  if (pre.relocate?.length && !pre.ooc) {
    for (const r of pre.relocate) directive.push(relocateDirective(scene, r));
    state.decidedRelocations = [...(state.decidedRelocations ?? []), ...pre.relocate.map(r => ({ ...r, turn: state.turn }))];
  }
  if (pre.ooc) directive.push(OOC_DIRECTIVE);
  else if (pre.plainTransition && !pre.limit && !pre.move) directive.push(plainDirective(pre.plainTransition));
  if (pre.limit) directive.push(limitDirective(pre.limit));
  if (wasStuck && !pre.move) directive.push("The scene has been going in circles. Break the loop in this reply with something new: someone acts on what they want or gives ground, a consequence lands, or something is revealed that opens a way forward. Don't replay an earlier push or repeat the last exchange.");
  if (pending && !pre.move) {
    const exit = scene.exits.find(e => e.id === pending.exitId)!;
    if ((pre.plain || pre.freeform) && !pending.extended) {
      // The player is doing something that might change things: hold the ending one more turn.
      state.pendingExit = { ...pending, extended: true };
      directive.push(`The scene is on the brink of: ${exit.title} (${exit.outcome}). The player's response may change that; play it honestly.`);
    } else {
      ended = exit;
      directive.push(`This reply closes the scene: ${exit.outcome} Land it on a moment that belongs to the player. What this ending should feel like: ${exit.closing} Don't narrate beyond the ending into what comes next.`);
    }
  }

  const spoken: Spoken[] = [];
  const replyStarted = performance.now();
  let followUpMs: number | null = null;
  // Stall mode: off the graph, with nothing else decided this turn. Hold the moment, let the co-GM
  // work in parallel, then resolve it with whatever it adds.
  // Only a genuinely off-graph turn earns a hold (a stale "stuck" from last turn made holds misfire).
  const offGraphTurn = approach.voice === "gm" && !pre.move && !pre.limit && !pre.ooc && !ended && pre.offGraph === true;
  const stall = approach.repair === "stall" && offGraphTurn && !pre.relocate?.length;
  if (approach.repair === "quick-block" && offGraphTurn && quickEarly) {
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
    const beat = await gmReply(scene, state, [STALL_DIRECTIVE], speakHooks(textHooks, "gm", "narration"), "gm.stall", undefined, 140);
    spoken.push(beat);
    push(state, hooks, { speaker: "gm", kind: "narration", text: beat.text });
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
    const resolve = await gmReply(scene, state, follow, text => {
      if (followUpMs === null) followUpMs = performance.now() - started;
      hooks.onText?.(text);
    }, "gm.followup");
    spoken.push(resolve);
    push(state, hooks, { speaker: "gm", kind: "narration", text: resolve.text });
  } else if (approach.voice === "gm") {
    let reply: Spoken | undefined;
    if (speculation && !directive.length && !pre.move && !pre.freeform && !ended) {
      // The decision changed nothing: keep the speculative reply, releasing any text held so far.
      const show = speakHooks(textHooks, "gm", "narration");
      if (speculation.buffer) show(speculation.buffer);
      speculation.release = show;
      reply = await speculation.promise;
      state.speculation = { used: (state.speculation?.used ?? 0) + (reply ? 1 : 0), discarded: state.speculation?.discarded ?? 0 };
    } else if (speculation) {
      speculation.controller.abort();
      state.speculation = { used: state.speculation?.used ?? 0, discarded: (state.speculation?.discarded ?? 0) + 1 };
    }
    reply ??= await gmReply(scene, state, directive, speakHooks(textHooks, "gm", "narration"));
    spoken.push(reply);
    push(state, hooks, { speaker: "gm", kind: "narration", text: reply.text });
  } else {
    // Narration first when something happened that only the GM can describe.
    let next = directive.length || !pre.speaker ? "gm" : pre.speaker;
    const responded: string[] = [];
    for (let i = 0; i < 4 && next !== "player"; i++) {
      const line = next === "gm"
        ? await narratorReply(scene, state, i === 0 ? directive : [], speakHooks(textHooks, "gm", "narration"))
        : await actorReply(scene, state, next, [
          ...(i === 0 && pre.limit ? [limitDirective(pre.limit)] : []),
          ...(state.whispers ?? []).filter(w => w.to === next).map(w => w.note),
        ], speakHooks(textHooks, next, "dialogue"));
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
  { const b = currentBeat(scene, state); if (b.pressure && state.turnsInBeat >= 2 && !state.pressureOffered?.includes(b.id)) state.pressureOffered = [...(state.pressureOffered ?? []), b.id]; }
  for (const s of spoken) { costUsd += s.result.costUsd; calls++; }

  let postDecisionMs = 0;
  if (!ended) {
    const postStarted = performance.now();
    const replyText = spoken.map(s => s.speaker === "gm" ? s.text : `${scene.cast.find(c => c.id === s.speaker)?.name}: ${s.text}`).join("\n\n");
    const hold = state.pendingExit?.turn === state.turn ? state.pendingExit.exitId : undefined;
    const post = await decideAfter(decider, scene, state, input, replyText, hold ? { hold } : {});
    postDecisionMs = performance.now() - postStarted;
    if (post.decision) { costUsd += post.decision.costUsd; calls++; }
    if (post.status) state.sceneStatus = post.status;
    if (post.landed?.length) state.landed = [...new Set([...(state.landed ?? []), ...post.landed])];
    if (post.hinted?.length) state.hinted = [...new Set([...(state.hinted ?? []), ...post.hinted])];
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
  if (!state.path.some(p => p.turn === state.turn && p.to !== p.from)) state.turnsInBeat++;

  if (ended && authored.createsCharacter) await extractCharacter(authored, state);
  if (ended) finishScene(state, authored, ended);
  // When did text that actually answers the player start? (the follow-up, after a holding beat)
  const resolvingTextMs = followUpMs ?? firstTextMs;
  const metric: TurnMetric = { turn: state.turn, repairMs, preDecisionMs, firstTextMs, followUpMs, resolvingTextMs, replyMs, postDecisionMs, costUsd, calls };
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

/** Test harness: end the scene through a given exit now (as if play had reached it). */
export function forceEnding(state: SessionState, exitId: string): void {
  const scene = sceneById(state.sceneId);
  const exit = scene.exits.find(e => e.id === exitId);
  if (!exit) throw new Error(`Scene ${scene.id} has no exit ${exitId}`);
  finishScene(state, scene, exit);
  saveSession(state);
}

/** Continue into the exit's next scene in the same session (the map would sit in between). */
export async function chainScene(state: SessionState, combatResult = "the party won"): Promise<SessionState | undefined> {
  if (!state.ended) return undefined;
  const scene = sceneById(state.sceneId);
  const exit = scene.exits.find(e => e.id === state.ended!.exitId)!;
  if (!exit.next) return undefined;
  const handoff = await writeHandoff(scene, state, exit, combatResult);
  const memory = approachById(state.approach).memory;
  if (memory === "docs") broadcastEnding(scene, state, exit);
  if (memory === "lite") await rememberScene(scene, state, `${exit.title}: ${exit.outcome}`).catch(() => undefined);
  if (memory) savePlayedScene(state.id, scene, exit.title, handoff);
  const lastMoments = sceneEntries(state).filter(e => e.kind !== "system").slice(-4)
    .map(e => e.kind === "player" ? `${state.player.name} (player): ${e.text}` : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.text);
  state.history.push({ sceneId: scene.id, exitId: exit.id, summary: handoff, lastMoments });
  const next = sceneById(exit.next);
  Object.assign(state, {
    sceneId: next.id, beat: next.start, turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null,
    whispers: [], patches: [], repairs: [], entered: [], absent: [], sceneStatus: undefined, memory: { opened: [] }, landed: [], hinted: [],
  });
  delete state.ended;
  saveSession(state);
  return state;
}

/** The hand-off: the state of things at the moment the scene ended, as established in play. */
async function writeHandoff(scene: Scene, state: SessionState, exit: Exit, combatResult: string): Promise<string> {
  const transcript = sceneEntries(state).map(e => e.kind === "player" ? `${state.player.name} (player): ${e.text}` : e.kind === "dialogue" ? `${scene.cast.find(c => c.id === e.speaker)?.name ?? e.speaker}: ${e.text}` : e.kind === "narration" ? `GM: ${e.text}` : `[${e.text}]`).join("\n\n");
  const fallback = `Previous scene, "${scene.title}", ended: ${exit.title}. ${exit.outcome}${exit.kind === "combat" ? ` The fight was played out on the map: ${combatResult}.` : ""}`;
  try {
    const result = await respond({
      operation: "handoff", effort: "low",
      instructions: "You write the hand-off between two scenes of a roleplaying game, for the GM of the next scene. Describe the state of things in the story at the moment the last scene ended, exactly as it was established in play (not as anyone planned it): who is where and in what state, who holds what, what was promised or agreed, what the player character learned, and how people feel. Things that were offered but refused, or threatened but not done, didn't happen. Leave out anything said out of character (questions or agreements about the game itself). Be concrete and brief: a short paragraph, then up to eight bullet points.",
      input: [{ role: "user", content: `Scene: ${scene.title}\nHow it ended: ${exit.title}. ${exit.outcome}${exit.kind === "combat" ? `\nThe fight was then played out on the map: ${combatResult}.` : ""}\nThe player character: ${state.player.name}, ${state.player.concept} (the only player character).\n\n## The scene as played\n${transcript}` }],
    });
    return `Previous scene, "${scene.title}", ended: ${exit.title}.\n${result.text.trim()}`;
  } catch {
    return fallback;
  }
}

export function transcriptMarkdown(state: SessionState, options: { allScenes?: boolean } = {}): string {
  const scene = sceneById(state.sceneId);
  const entries = options.allScenes ? state.transcript : sceneEntries(state);
  return entries.map(e => e.kind === "player" ? `> **${state.player.name}:** ${e.text}` : e.kind === "roll" ? `🎲 *${e.text}*` : e.kind === "system" ? `*— ${e.text} —*` : e.kind === "dialogue" ? `**${(e.scene ? sceneById(e.scene) : scene).cast.find(c => c.id === e.speaker)?.name ?? e.speaker}:** ${e.text}` : e.text).join("\n\n");
}
