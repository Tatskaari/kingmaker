import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { respondJson, LUNA, type Effort } from "../llm/openrouter.ts";
import { currentBeat, effectiveScene, leftBehind, presentCast, prompt, sceneBrief, sceneEntries, scriptTranscript, targetTitle } from "./brief.ts";
import { SKILLS, type Beat, type Scene, type Transition } from "./scene.ts";
import { sessionDir, type RepairResult, type ScenePatch, type SessionState } from "./session.ts";

/**
 * The co-GM: a slower, reasoning model that reviews the scene between turns. Its output is
 * steering, not plot: short-lived notes for the GM, whispers to individual characters (their
 * wants this moment), canon to keep true, and additive routes that only lead to existing beats or
 * endings. Notes expire so they can't harden into a plan the scene railroads towards.
 */

export const NOTE_TTL_TURNS = 2;
export const WHISPER_TTL_TURNS = 1;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** Ids are enums built from this scene, so the agent can only point at things that exist. */
function repairSchema(scene: Scene) {
  const beats = scene.beats.map(b => b.id);
  const targets = [...beats, ...scene.exits.map(e => e.id), "new_beat"];
  const cast = scene.cast.map(c => c.id);
  const essentials = (scene.essentials ?? []).map(e => e.id);
  return {
    type: "object", additionalProperties: false,
    required: ["assessment", "status", "notes", "whispers", "relocations", "no_but", "canon", "move_to", "move_to_because", "add_beat", "add_transitions"],
    properties: {
      relocations: {
        type: "array", description: "Things the scene needs that the player is missing because play went elsewhere, and where you're moving them.",
        items: { type: "object", additionalProperties: false, required: ["essential", "technique", "to", "how"], properties: {
          essential: essentials.length ? { type: "string", enum: essentials } : { type: "string" },
          technique: { type: "string", enum: ["move", "soft_nudge", "improvise"], description: "move: give it to another carrier; soft_nudge: a hint, remark or telltale detail; improvise: a new way to the same place." },
          to: { type: "string", enum: [...cast, "world"], description: "Who carries it now (a character) or 'world' (an object, event or detail the GM narrates)." },
          how: { type: "string", description: "Concretely how it reaches the player through what they're doing." },
        } },
      },
      assessment: { type: "string", description: "One or two sentences: what the player is doing or enjoying, and how the scene is going." },
      status: { type: "string", enum: ["on_track", "drifting", "stuck"] },
      notes: { type: "string", description: "Whispered notes to the GM for the next couple of replies. Empty if things are going well." },
      whispers: {
        type: "array", description: "What individual characters want or should try in the next exchange or two (a want, a concession, an offer, a deadline). Not lines of dialogue.",
        items: { type: "object", additionalProperties: false, required: ["to", "note"], properties: { to: { type: "string", enum: cast }, note: { type: "string" } } },
      },
      no_but: {
        type: "array", description: "Player approaches the world can't support: the in-fiction reason and the real alternative they can act on now.",
        items: { type: "object", additionalProperties: false, required: ["approach", "reason_in_fiction", "alternative", "alternative_route"], properties: {
          approach: { type: "string" }, reason_in_fiction: { type: "string" }, alternative: { type: "string" },
          alternative_route: { type: "string", enum: targets.filter(t => t !== "new_beat"), description: "Beat or ending the alternative leads towards." },
        } },
      },
      canon: { type: "array", items: { type: "string" }, description: "New improvised details that must now stay true. Only new ones." },
      move_to: nullable({ type: "string", enum: beats, description: "Beat the story has actually reached, if the tracker is behind. Only ever forward: never a beat the scene has left behind." }),
      move_to_because: nullable({ type: "string", description: "With move_to: what has happened in the story that puts it at that beat, as a short statement of fact that stays true from here on ('Hobb has admitted he held Prout in the loft and held the rope')." }),
      add_beat: nullable({
        type: "object", additionalProperties: false,
        required: ["id", "title", "direction", "pressure", "transitions"],
        properties: {
          id: { type: "string" }, title: { type: "string" }, direction: { type: "string" }, pressure: { type: "string" },
          transitions: { type: "array", items: { type: "object", additionalProperties: false, required: ["when", "to"], properties: { when: { type: "string" }, to: { type: "string", enum: targets.filter(t => t !== "new_beat") } } } },
        },
      }),
      add_transitions: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["beat", "when", "on", "to", "check", "why"],
          properties: {
            beat: { type: "string", enum: [...beats, "new_beat"], description: "Beat this route leaves from." },
            when: { type: "string", description: "What the player does or what happens, in prose. With a check: the act the check tests, as the player attempts it, not what has to happen first." },
            on: { type: "string", enum: ["attempt", "cue", "outcome"] },
            to: { type: "string", enum: targets, description: "Beat or ending (or new_beat). With a check, the success destination." },
            check: nullable({
              type: "object", additionalProperties: false, required: ["skill", "dc", "reason", "success", "failure", "on_failure"],
              properties: {
                skill: { type: "string", enum: [...SKILLS] }, dc: { type: "integer" },
                reason: { type: "string", description: "Why the player is rolling, for the player, e.g. 'to talk Skrag into a trade'." },
                success: { type: "string" }, failure: { type: "string" },
                on_failure: nullable({ type: "string", enum: targets.filter(t => t !== "new_beat") }),
              },
            }),
            why: { type: "string" },
          },
        },
      },
    },
  };
}

interface RepairJson {
  relocations: Array<{ essential: string; technique: "move" | "soft_nudge" | "improvise"; to: string; how: string }>;
  assessment: string;
  status: "on_track" | "drifting" | "stuck";
  notes: string;
  whispers: Array<{ to: string; note: string }>;
  no_but: Array<{ approach: string; reason_in_fiction: string; alternative: string; alternative_route: string }>;
  canon: string[];
  move_to: string | null;
  move_to_because: string | null;
  add_beat: { id: string; title: string; direction: string; pressure: string; transitions: Array<{ when: string; to: string }> } | null;
  add_transitions: Array<{ beat: string; when: string; on: "attempt" | "cue" | "outcome"; to: string; check: null | { skill: typeof SKILLS[number]; dc: number; reason: string; success: string; failure: string; on_failure: string | null }; why: string }>;
}

/**
 * A route with a roll is the act the roll tests. One whose `when` is about getting to that act
 * ("gets him down or otherwise close enough to examine him") matches whatever gets the player there,
 * so the roll comes with the wrong act (a javelin thrown at the rope rolled Medicine). Restated as the
 * act itself, from the check's reason ("to examine Prout for..."); without a reason it can't be.
 */
const GETTING_THERE = /\b(?:enough|in order|so as|in a position) to\b|\bso (?:that )?[\w']+ (?:can|could)\b/i;
export function checkedWhen(when: string, reason: string | undefined): string | undefined {
  if (!GETTING_THERE.test(when)) return when;
  const act = reason?.trim().replace(/\.$/, "");
  return act && /^to\s/i.test(act) ? `The player tries ${act}.` : undefined;
}

function graphOutline(scene: Scene): string {
  return scene.beats.map(b => [
    `### Beat "${b.id}": ${b.title}`,
    b.direction,
    ...b.transitions.map(t => `- [${t.id}${t.check ? `, ${t.check.skill} DC ${t.check.dc}` : ""}] ${t.when} -> ${t.to ?? `${t.check!.onSuccess} on success / ${t.check!.onFailure ?? "stay"} on failure`}`),
  ].join("\n")).join("\n\n") + `\n\n### Endings\n${scene.exits.map(e => `- "${e.id}" (${e.kind}): ${e.title}. ${e.outcome}`).join("\n")}` +
    (scene.anytime?.length ? `\n\n### From anywhere\n${scene.anytime.map(t => `- ${t.when} -> ${t.to}`).join("\n")}` : "");
}

/**
 * What the tracker can't do, for the co-GM's review: go back to a beat the scene left before
 * something was settled, or count a question to the GM as the scene's time passing.
 */
function trackerLimits(scene: Scene, state: SessionState): string {
  const behind = scene.beats.filter(b => leftBehind(state, b.id)).map(b => `"${b.id}"`);
  const ooc = state.oocTurns?.length ? state.oocTurns.join(", ") : "";
  return [
    ...(behind.length ? [`\nBehind it for good, since something has been settled since the scene left them (no move or route goes back there): ${behind.join(", ")}.`] : []),
    ...(ooc ? [`\nTurns ${ooc} were out of character (the player asking the GM about the game): they aren't exchanges, and nothing in the scene moves on for them.`] : []),
  ].join("");
}

export async function runRepair(authored: Scene, state: SessionState, options: { effort?: Effort; model?: string } = {}): Promise<RepairResult> {
  const scene = effectiveScene(authored, state.patches);
  const beat = currentBeat(scene, state);
  const sinceMove = state.turn - Math.max(0, ...state.path.filter(p => p.to !== p.from).map(p => p.turn));
  const input = [
    { role: "developer" as const, content: sceneBrief(scene, state) },
    { role: "developer" as const, content: `## The scene's beats and routes (ids in quotes)\n${graphOutline(scene)}` },
    { role: "user" as const, content: [
      `## Tracker: the scene is at beat "${beat.id}" (${beat.title}); ${state.turnsInBeat} exchanges here, ${sinceMove} since anything moved.${trackerLimits(scene, state)}`,
      `## Your notes still in effect\n${state.notes ?? "(none)"}${state.whispers?.length ? `\n${state.whispers.map(w => `- to ${w.to}: ${w.note}`).join("\n")}` : ""}`,
      `## Established so far\n${[...state.established, ...state.canon].map(x => `- ${x}`).join("\n") || "(nothing yet)"}`,
      ...(scene.essentials?.length ? [`## What the player needs to come across (essentials)\n${scene.essentials.map(e => `- [${e.id}] ${e.what} (placed with: ${e.placedWith.join("; ")}; opens up: ${e.unlocks}) ${state.landed?.includes(e.id) ? "LANDED" : "NOT YET"}`).join("\n")}`] : []),
      `## Transcript\n${scriptTranscript(scene, state)}`,
    ].join("\n\n") },
  ];
  const result = await respondJson<RepairJson>({
    operation: "repair", model: options.model ?? LUNA, effort: options.effort ?? "medium",
    instructions: prompt("repair"), input, json: { name: "co_gm_notes", schema: repairSchema(scene) }, maxOutputTokens: 8000,
  });
  return toRepairResult(scene, state, result, result._meta);
}

function toRepairResult(scene: Scene, state: SessionState, json: RepairJson, meta: { costUsd: number; latencyMs: number }): RepairResult {
  const ids = new Set([...scene.beats.map(b => b.id), ...scene.exits.map(e => e.id)]);
  const patches: ScenePatch[] = [];
  const problems: string[] = [];
  let newBeatId: string | undefined;
  if (json.add_beat) {
    const id = ids.has(json.add_beat.id) ? `${json.add_beat.id}-improv-${state.turn}` : json.add_beat.id;
    const valid = json.add_beat.transitions.filter(t => ids.has(t.to));
    if (valid.length) {
      const beat: Beat = {
        id, title: json.add_beat.title, direction: json.add_beat.direction, pressure: json.add_beat.pressure,
        transitions: valid.map((t, i) => ({ id: `${id}-to-${t.to}-${i}`, when: t.when, to: t.to })),
      };
      patches.push({ turn: state.turn, beat, why: `Bridging beat: ${json.add_beat.title}` });
      newBeatId = id;
      ids.add(id);
    } else problems.push(`add_beat ${json.add_beat.id} had no valid targets`);
  }
  const resolveId = (id: string) => id === "new_beat" ? newBeatId : id;
  for (const [i, t] of json.add_transitions.entries()) {
    const from = resolveId(t.beat), to = resolveId(t.to);
    if (!from || !to || !ids.has(from) || !ids.has(to) || scene.exits.some(e => e.id === from)) { problems.push(`transition ${t.beat} -> ${t.to} rejected`); continue; }
    const when = t.check ? checkedWhen(t.when, t.check.reason) : t.when;
    if (!when) { problems.push(`transition ${t.beat} -> ${t.to} rejected: its roll is about getting there, not the act`); continue; }
    const transition: Transition = {
      id: `improv-${state.turn}-${i}`, when, on: t.on,
      ...(t.check
        ? { check: { skill: t.check.skill, dc: Math.max(5, Math.min(25, t.check.dc)), reason: t.check.reason, success: t.check.success, failure: t.check.failure, onSuccess: to, ...(t.check.on_failure && ids.has(t.check.on_failure) ? { onFailure: t.check.on_failure } : {}) } }
        : { to }),
    };
    patches.push({ turn: state.turn, transition: { beat: from, transition }, why: t.why });
  }
  const noBut = json.no_but.map(n => `"No, but" for ${n.approach}: ${n.reason_in_fiction} Instead: ${n.alternative} (towards ${targetTitle(scene, n.alternative_route)}).`);
  const relocations = (json.relocations ?? []).filter(r => !state.landed?.includes(r.essential));
  const worldMoves = relocations.filter(r => r.to === "world").map(r => `Let this reach the player through the world: ${r.how}`);
  const notes = [json.notes.trim(), ...noBut, ...worldMoves].filter(Boolean).join("\n");
  const relocationWhispers = relocations.filter(r => r.to !== "world").map(r => ({ to: r.to, note: `If it fits the moment, this reaches the player through you: ${r.how}` }));
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const moveTo = json.move_to && ids.has(json.move_to) && json.move_to !== state.beat ? json.move_to : undefined;
  const because = json.move_to_because?.trim();
  return {
    turn: state.turn, assessment: json.assessment + (problems.length ? ` [rejected: ${problems.join("; ")}]` : ""), status: json.status,
    notes, whispers: [...json.whispers, ...relocationWhispers].filter(w => present.has(w.to) || scene.cast.some(c => c.id === w.to)), relocations, canon: json.canon, patches,
    ...(moveTo ? { moveTo, ...(because ? { moveBecause: because } : {}) } : {}), costUsd: meta.costUsd, latencyMs: meta.latencyMs,
  };
}

/**
 * A review's file: the full co-GM's, or a quick co-GM's that came too late for its turn, which has a
 * file of its own (the Rat's T57: a late quick ruling on the safe-house plan was overwritten by the
 * full review of the same turn, which writes to the same name).
 */
export function repairFile(sessionId: string, turn: number, quick = false): string {
  return join(sessionDir(sessionId), `repair-${String(turn).padStart(3, "0")}${quick ? "-quick" : ""}.json`);
}

export function writeRepair(state: SessionState, result: RepairResult): void {
  writeFileSync(repairFile(state.id, result.turn, result.quick === true), JSON.stringify({ sceneId: state.sceneId, ...result }, null, 1));
}

/** Which review a result is, as merged ("57", "57-quick"): a turn can have both, and each is merged once. */
const reviewKey = (r: { turn: number; quick?: boolean }) => `${r.turn}${r.quick ? "-quick" : ""}`;

/** Merge background repair output that has arrived since the last turn. Returns the merged results. */
export function applyPendingRepairs(scene: Scene, state: SessionState): RepairResult[] {
  const dir = sessionDir(state.id);
  if (!existsSync(dir)) return [];
  const applied = new Set(state.repairs.map(reviewKey));
  // (A turn's quick review sorts before its full one, which supersedes its notes.)
  const files = readdirSync(dir).filter(f => /^repair-\d+(?:-quick)?\.json$/.test(f)).sort();
  const merged: RepairResult[] = [];
  for (const file of files) {
    const result = JSON.parse(readFileSync(join(dir, file), "utf8")) as RepairResult & { sceneId: string };
    if (result.sceneId !== state.sceneId || applied.has(reviewKey(result))) continue;
    applyRepair(scene, state, result);
    merged.push(result);
  }
  expireNotes(state);
  return merged;
}

/** Notes and whispers are short-lived steering, not a plan. */
export function expireNotes(state: SessionState): void {
  if (state.notesTurn !== null && state.turn - state.notesTurn >= NOTE_TTL_TURNS) { state.notes = null; state.notesTurn = null; }
  if (state.whispers?.length) state.whispers = state.whispers.filter(w => state.turn - w.turn < WHISPER_TTL_TURNS);
}

export function applyRepair(scene: Scene, state: SessionState, result: RepairResult): void {
  if (state.notesTurn === null || result.turn >= state.notesTurn) {
    state.notes = result.notes || null;
    state.notesTurn = result.notes ? result.turn : null;
    state.whispers = (result.whispers ?? []).map(w => ({ ...w, turn: result.turn }));
  }
  for (const fact of result.canon) if (!state.canon.includes(fact)) state.canon.push(fact);
  state.patches.push(...result.patches);
  const refused = result.moveTo && result.turn === state.turn ? moveTracker(scene, state, result.moveTo, result.moveBecause) : undefined;
  const { patches, canon, whispers, ...rest } = result;
  state.repairs.push({ ...rest, ...(refused ? { assessment: `${rest.assessment} [move_to ${result.moveTo} refused: ${refused}]` } : {}), patches: patches.length, canon: canon.length, whispers: whispers?.length ?? 0 });
  state.lastRepairTurn = result.turn;
}

/**
 * The co-GM's tracker move, made if it may be: it can't take the scene back to a beat it left before
 * something was settled (the Rat's confession, undone by a move back to "Hobb gets up for work"),
 * and a word out of character isn't the scene's time passing (the Rat's bell, rung on one). Made,
 * what put the story there is a fact from then on. Why it wasn't made, if it wasn't.
 */
function moveTracker(scene: Scene, state: SessionState, to: string, because: string | undefined): string | undefined {
  if (!effectiveScene(scene, state.patches).beats.some(b => b.id === to)) return "no such beat";
  if (leftBehind(state, to)) return "the scene has left it, and something has been settled since";
  if (state.oocTurns?.includes(state.turn)) return "the turn was out of character";
  state.path.push({ turn: state.turn, from: state.beat, to, via: "repair", source: "repair", known: state.established.length });
  if (because && !state.established.includes(because)) state.established.push(because);
  state.beat = to;
  state.turnsInBeat = 0;
  return undefined;
}

/** Gate: repair when the scene isn't on track, or periodically as a backstop. */
export function shouldRepair(state: SessionState, every = 3): boolean {
  if (state.ended || state.closing) return false;
  if (state.offGraphTurn === state.turn) return true;
  if (state.sceneStatus && state.sceneStatus !== "on_track") return true;
  return state.turn - (state.lastRepairTurn ?? 0) >= every;
}

export const describeTarget = targetTitle;

/**
 * Quick co-GM: one fast call (no reasoning, tiny enum-constrained output) that decides the
 * smallest move letting the scene follow the player off the graph. Built to fit a 5 s reply
 * budget alongside a holding beat; the full co-GM can still run in the background.
 */
export async function quickRepair(authored: Scene, state: SessionState, options: { effort?: Effort } = {}): Promise<RepairResult> {
  const scene = effectiveScene(authored, state.patches);
  const beat = currentBeat(scene, state);
  const essentials = (scene.essentials ?? []).filter(e => !state.landed?.includes(e.id));
  const targets = [...scene.beats.map(b => b.id), ...scene.exits.filter(e => e.id !== "own-ending").map(e => e.id)];
  const schema = {
    type: "object", additionalProperties: false, required: ["move", "essential", "carrier", "target", "when", "roll_skill", "roll_dc", "roll_reason", "failure", "note"],
    properties: {
      failure: { type: "string", description: "For a route with a roll: the specific consequence if the roll fails (fail forward: the situation changes, the story goes on)." },
      roll_skill: { type: "string", enum: [...SKILLS, "none"], description: "For open_route: if whether the player's plan works should be uncertain, the skill that decides it; otherwise none." },
      roll_dc: { type: "integer", description: "10 easy, 13 moderate, 16 hard." },
      roll_reason: { type: "string", description: "Why the player would be rolling, for the player: 'to lever the cart onto the skids'." },
      move: { type: "string", enum: ["relocate", "open_route", "note_only"], description: "relocate: bring a missed essential to them; open_route: let what they're doing lead to an existing beat or ending; note_only: just steer the GM." },
      essential: { type: "string", enum: [...essentials.map(e => e.id), "none"] },
      carrier: { type: "string", enum: [...presentCast(scene, state).map(c => c.id), "world", "none"] },
      target: { type: "string", enum: [...targets, "none"] },
      when: { type: "string", description: "For open_route: what the player does or what happens, in prose. With a roll: the act the roll tests, not what has to happen first." },
      note: { type: "string", description: "One or two sentences to the GM on how to resolve the player's attempt now." },
    },
  };
  const started = performance.now();
  const result = await respondJson<{ move: string; essential: string; carrier: string; target: string; when: string; roll_skill: string; roll_dc: number; roll_reason: string; failure: string; note: string }>({
    operation: "repair.quick", effort: options.effort ?? "none",
    instructions: "You are the co-GM of a live roleplaying scene. The player has just tried or proposed something the prep didn't plan for, and you have a few seconds to decide. Choose the smallest move that lets the scene follow the player and pay off what they're doing: let their approach lead to an existing beat or ending, bring something the scene needs to them through whatever they're engaging with, or tell the GM how to resolve it honestly. A plausible plan deserves a real chance: don't steer the player back to the routes the prep expected. If whether it works is uncertain, give it a roll (and say what failing costs, so the story moves on either way); only a plan that addresses the real cause of the problem and can't really go wrong may reach an ending without one. Describe a route without a roll by the state of things it brings about, and a route with a roll by the act the roll tests, as the player attempts it ('examines the body up close'), never what has to happen first ('gets him down so he can be examined'). Keep the player's idea theirs (the credit and their conditions stay with them). Never refuse flatly; if the world can't do it, say what it can do instead.",
    input: [{ role: "user", content: [
      `Scene: ${scene.title}. ${scene.premise}`,
      `Current beat: ${beat.title}. ${beat.direction}`,
      `People: ${presentCast(scene, state).map(c => `[${c.id}] ${c.name}: wants ${c.wants}${c.secrets?.length ? `; hiding: ${c.secrets.join(" ")}` : ""}`).join(" | ")}`,
      `Beats and their routes: ${scene.beats.map(b => `[${b.id}] ${b.title}: ${b.transitions.map(t => `${t.when} -> ${t.to ?? t.check?.onSuccess}`).join("; ")}`).join(" || ")}`,
      `Endings: ${scene.exits.map(e => `[${e.id}] ${e.title}: ${e.outcome}`).join(" | ")}`,
      essentials.length ? `Not yet come across: ${essentials.map(e => `[${e.id}] ${e.what} (placed with ${e.placedWith.join("; ")})`).join(" | ")}` : "",
      scene.limits?.length ? `Can't offer: ${scene.limits.join(" | ")}` : "",
      `Recent:\n${scriptTranscript(scene, state, sceneEntries(state).slice(-8))}`,
    ].filter(Boolean).join("\n\n") }],
    json: { name: "quick_fix", schema }, maxOutputTokens: 400,
  });
  const patches: ScenePatch[] = [];
  const whispers: Array<{ to: string; note: string }> = [];
  const relocations: RepairResult["relocations"] = [];
  const notes: string[] = [result.note];
  if (result.move === "relocate" && result.essential !== "none") {
    const e = scene.essentials?.find(x => x.id === result.essential);
    relocations!.push({ essential: result.essential, technique: "move", to: result.carrier === "none" ? "world" : result.carrier, how: result.note });
    if (result.carrier !== "world" && result.carrier !== "none") whispers.push({ to: result.carrier, note: `If it fits the moment, this comes out through you, in your own way and only as far as you'd really say it: ${e?.what ?? result.essential}` });
    else notes.push(`Let this reach the player through the world: ${e?.what ?? result.essential}`);
  }
  const roll = result.roll_skill !== "none" && (SKILLS as readonly string[]).includes(result.roll_skill);
  // (A roll's route is the act it tests: one about getting there is restated, or left to the note.)
  const when = roll ? checkedWhen(result.when, result.roll_reason) : result.when;
  if (result.move === "open_route" && result.target !== "none" && targets.includes(result.target) && when?.trim()) {
    const transition: Transition = roll
      ? { id: `quick-${state.turn}`, when, on: "attempt", check: { skill: result.roll_skill as typeof SKILLS[number], dc: Math.max(8, Math.min(18, result.roll_dc || 13)), reason: result.roll_reason, success: result.note, failure: result.failure?.trim() || "It doesn't work out as hoped: the situation gets harder, but the story goes on.", onSuccess: result.target } }
      : { id: `quick-${state.turn}`, when, on: "outcome", to: result.target };
    patches.push({ turn: state.turn, transition: { beat: "*", transition }, why: result.note });
  }
  return {
    turn: state.turn, quick: true, assessment: `quick: ${result.move}`, status: "drifting", notes: notes.join("\n"), whispers, relocations, canon: [], patches,
    costUsd: result._meta.costUsd, latencyMs: performance.now() - started,
  };
}
