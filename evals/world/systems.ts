import { JevDecider, LunaDecider, LUNA_DECISIONS_MODEL, type ChoiceQuestion, type Decider } from "../../src/llm/decide.ts";
import { respondJson, type Effort, type Message } from "../../src/llm/openrouter.ts";
import type { ToolDef } from "../../src/llm/tools.ts";
import { runToolsCounted } from "./tool-loop.ts";
import { areaOf, distance, positionOf, type Entity, type SceneWorld } from "../../src/world/scene-world.ts";
import { stageManage } from "../../src/world/stage.ts";
import { applyOpsV2, opSchemaV2, stageView, WORLD_LANGUAGE_V2, type WorldOpV2 } from "./language.ts";
import type { SystemRun, WorldCase } from "./types.ts";

/**
 * The ways of keeping the world in step with the story that the eval compares. Each takes a case
 * (the world as it stood, the exchange) and returns the world after, with cost and latency.
 */
export interface System { name: string; about: string; run(c: WorldCase): Promise<SystemRun> }

const clone = (w: SceneWorld) => structuredClone(w);
const exchange = (c: WorldCase) => [
  `Player: ${c.playerTurn}`,
  ...(c.rules.length ? [`Rules (dice already rolled and applied to the world): ${c.rules.join("; ")}`] : []),
  `GM: ${c.reply}`,
].join("\n\n");

// ---------------------------------------------------------------------------------------------
// 1. Today's stage manager (src/world/stage.ts), unchanged.

export const current: System = {
  name: "current",
  about: "src/world/stage.ts as it is: Luna (reasoning none) writes JSON operations with free-text selectors after the reply.",
  async run(c) {
    const world = clone(c.world);
    const started = performance.now();
    const r = await stageManage(world, c.player, c.playerTurn, c.reply, c.turn);
    return { world, trace: r.changes, problems: r.problems, costUsd: r.costUsd, latencyMs: performance.now() - started, calls: 1 };
  },
};

// ---------------------------------------------------------------------------------------------
// 2. JSON operations, with the proposed language (ids enforced by the schema, distances, forget)
//    and a prompt that says what the record is for.

export const STAGE_V2 = [
  "You keep the world model of a roleplaying scene in step with the story. After each exchange, write the operations that make the model show what the GM's reply has established. The GM reads the model before every reply, and the rules resolve spells and blows from it (who a Fireball catches depends on where everyone stands), so above all it has to be right about where people are, who holds what, what's open, shut, burning or broken, and who has come or gone.",
  "- The reply is what happened. Where the model disagrees with it (it may be out of date), the reply wins: put people where the reply has them. Only what has happened, though: not plans, offers, threats, glances or where people's attention goes.",
  "- The rules have already applied their dice (listed, if any): don't repeat or undo them, but do record knock-on effects the reply narrates (someone fleeing the flames, a fire put out with a bucket).",
  "- People are often described rather than named (\"the pot-boy\", \"the big man\"): see who's who, and never create someone who is already in the world.",
  "- Create only someone who could act, or something someone could pick up, use, hide behind or be hurt by, that the story has just brought in. Never scenery: birds, leaves, smells, crowds or windows outside the place.",
  "- Prefer a move or a state to a note. A note is for something the model can't otherwise show that will matter later (who is hiding where, what is under what), written about one entity. When something someone was doing has stopped (they stopped throwing stones, got down off the wall), forget the note that says they're doing it.",
  "- Often nothing changes: an empty list is fine.",
  WORLD_LANGUAGE_V2,
].join("\n\n");

const stageInput = (c: WorldCase, world: SceneWorld) =>
  `## The world before this exchange\n${stageView(world)}\n\nThe player character is ${c.player.name} (id "player").\n\n## The latest exchange\n${exchange(c)}`;

export function opsV2(options: { name: string; effort?: Effort; check?: boolean; model?: string; about?: string; freeIds?: boolean }): System {
  return {
    name: options.name,
    about: options.about ?? `JSON operations in the proposed language (ids enforced by the schema, distances, forget), reasoning ${options.effort ?? "none"}${options.check ? ", one correction round when an operation fails" : ""}.`,
    async run(c) {
      const started = performance.now();
      const input: Message[] = [{ role: "user", content: stageInput(c, c.world) }];
      const ask = (messages: Message[]) => respondJson<{ ops: WorldOpV2[] }>({ operation: "eval.world.ops", effort: options.effort ?? "none", ...(options.model ? { model: options.model } : {}), instructions: STAGE_V2, input: messages, json: { name: "world_ops", schema: opSchemaV2(c.world, { freeIds: options.freeIds === true }) } });
      let result = await ask(input);
      let costUsd = result._meta.costUsd, calls = 1, inputTokens = result._meta.inputTokens, outputTokens = result._meta.outputTokens;
      let world = clone(c.world);
      const resolve = { resolve: options.freeIds === true };
      let applied = applyOpsV2(world, (result.ops ?? []).slice(0, 16), c.turn, "stage", resolve);
      const trace: unknown[] = [result.ops];
      if (options.check && applied.problems.length) {
        // One correction round, only when something didn't apply: the model sees what failed.
        result = await ask([...input, { role: "assistant", content: JSON.stringify({ ops: result.ops }) }, { role: "user", content: `These operations couldn't be applied: ${applied.problems.join("; ")}. Write the full corrected list.` }]);
        costUsd += result._meta.costUsd; calls++; inputTokens += result._meta.inputTokens; outputTokens += result._meta.outputTokens;
        world = clone(c.world);
        applied = applyOpsV2(world, (result.ops ?? []).slice(0, 16), c.turn, "stage", resolve);
        trace.push(result.ops);
      }
      return { world, trace, problems: applied.problems, costUsd, latencyMs: performance.now() - started, calls, inputTokens, outputTokens };
    },
  };
}

/** The current prompt and selectors with nothing changed but the view (player shown, who's who): isolates the view's effect. */
export const currentPromptNewView: System = {
  name: "current+view",
  about: "Today's prompt and free-text selectors, but reading the proposed view (the player's spot and states, who's who).",
  async run(c) {
    const { WORLD_LANGUAGE } = await import("../../src/world/stage.ts");
    const { applyOps } = await import("../../src/world/scene-world.ts");
    const started = performance.now();
    const result = await respondJson<{ ops: Array<Omit<WorldOpV2, "feet">> }>({
      operation: "eval.world.current-view", effort: "none",
      instructions: [
        "You keep a roleplaying scene's world model in step with the story. Read the latest exchange and write the operations that make the model match what the GM's reply has established as having happened: people moving, things picked up, handed over, put down, hidden, opened or closed, broken, lit or put out, someone or something new arriving or leaving, and notes worth keeping for continuity (who is hiding where, what is under what, who is holding whom).",
        "Only what has happened, not plans, threats, offers or things merely mentioned. Damage and fire from spells and blows are already applied by the rules: don't repeat them, but do record knock-on effects the reply narrates (a table overturned, someone fleeing the flames, a fire put out with a bucket). Reuse ids from the model. Create only someone who could act, or something someone could pick up, use, hide behind or be hurt by, that the story has just brought into the scene; never scenery, sounds, weather or passing details. Often nothing changes: an empty list is fine.",
        WORLD_LANGUAGE,
      ].join("\n\n"),
      input: [{ role: "user", content: `## The world before this exchange\n${stageView(c.world)}\n\nThe player character is ${c.player.name} (id "player").\n\n## The latest exchange\nPlayer: ${c.playerTurn}\n\nGM: ${c.reply}` }],
      json: { name: "world_ops", schema: { type: "object", additionalProperties: false, required: ["ops"], properties: { ops: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["op", "what", "to", "how", "name", "kind", "text", "add", "remove"],
        properties: { op: { type: "string", enum: ["move", "place", "give", "drop", "create", "state", "note", "remove", "destroy"] }, what: { type: "string" }, to: { type: "string" }, how: { type: "string" }, name: { type: "string" }, kind: { type: "string" }, text: { type: "string" }, add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } },
      } } } } },
    });
    const world = clone(c.world);
    const applied = applyOps(world, (result.ops ?? []).slice(0, 12) as never, c.turn, "stage");
    return { world, trace: result.ops, problems: applied.problems, costUsd: result._meta.costUsd, latencyMs: performance.now() - started, calls: 1, inputTokens: result._meta.inputTokens, outputTokens: result._meta.outputTokens };
  },
};

// ---------------------------------------------------------------------------------------------
// 3. A tool-calling loop: the stage manager looks things up and makes changes one call at a time,
//    seeing each result (a failed id comes straight back).

const ID = { type: "string", description: "An id from the world (in brackets)." };
const TOOLS: ToolDef[] = [
  { name: "look", description: "Where someone or something is and what state it's in: area, feet from the player, who holds it, states, notes, what it holds.", parameters: { type: "object", properties: { id: ID }, required: ["id"] } },
  { name: "move", description: "Put someone or something somewhere: in an area (to = area id), or near/behind/beside/under/on/in something (to = its id, how), or 'away' from / 'toward' something by so many feet.", parameters: { type: "object", properties: { id: ID, to: ID, how: { type: "string", enum: ["near", "behind", "beside", "under", "on", "in", "away", "toward"] }, feet: { type: "integer" } }, required: ["id", "to"] } },
  { name: "give", description: "A thing is now held by someone, or put in a container.", parameters: { type: "object", properties: { id: ID, to: ID }, required: ["id", "to"] } },
  { name: "drop", description: "A held thing is put down, near something or where its holder stands.", parameters: { type: "object", properties: { id: ID, near: ID }, required: ["id"] } },
  { name: "create", description: "Someone or something the story has just brought in that could act, or be picked up, used, hidden behind or hurt. For an item, to = a person puts it in their hands.", parameters: { type: "object", properties: { name: { type: "string" }, kind: { type: "string", enum: ["person", "creature", "object", "item"] }, to: ID, text: { type: "string" }, states: { type: "array", items: { type: "string" } } }, required: ["name", "kind", "to"] } },
  { name: "set_state", description: "Add or remove states: burning, wet, broken, open, closed, locked, barred, overturned, hidden, prone, unconscious, asleep, lit, sitting, crouching...", parameters: { type: "object", properties: { id: ID, add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } }, required: ["id"] } },
  { name: "note", description: "Something worth remembering about one entity that the model can't otherwise show.", parameters: { type: "object", properties: { id: ID, text: { type: "string" } }, required: ["id", "text"] } },
  { name: "forget", description: "Notes on an entity that have stopped being true: those containing text, or all if text is empty.", parameters: { type: "object", properties: { id: ID, text: { type: "string" } }, required: ["id"] } },
  { name: "leave", description: "Someone or something leaves the scene.", parameters: { type: "object", properties: { id: ID, text: { type: "string" } }, required: ["id"] } },
  { name: "destroy", description: "Something is wrecked.", parameters: { type: "object", properties: { id: ID, text: { type: "string" } }, required: ["id"] } },
];

function look(world: SceneWorld, id: string): unknown {
  const e = world.entities[id];
  if (!e) return { error: `No "${id}" in the world. Ids: ${Object.keys(world.entities).filter(k => k !== world.root).join(", ")}` };
  const p = positionOf(world, id), me = positionOf(world, "player");
  const holder = e.parent && world.entities[e.parent] && !["area", "place"].includes(world.entities[e.parent]!.kind) ? world.entities[e.parent]!.name : undefined;
  return {
    id, name: e.name, kind: e.kind, area: areaOf(world, id)?.name, feetFromPlayer: p && me ? Math.round(distance(p, me)) : undefined, heldBy: holder,
    states: e.states, notes: e.notes.map(n => n.text), holds: Object.values(world.entities).filter(x => x.parent === id).map(x => `${x.name} [${x.id}]`),
  };
}

/** A write tool's call as an operation in the extended language. */
export function toolOp(name: string, args: Record<string, unknown>): WorldOpV2 {
  const op: WorldOpV2 = { op: "note", what: "", to: "", how: "", feet: 0, name: "", kind: "", text: "", add: [], remove: [] };
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (name === "move") Object.assign(op, { op: args.how ? "place" : "move", what: s(args.id), to: s(args.to), how: s(args.how), feet: Number(args.feet) || 0 });
  else if (name === "give") Object.assign(op, { op: "give", what: s(args.id), to: s(args.to) });
  else if (name === "drop") Object.assign(op, { op: "drop", what: s(args.id), to: s(args.near) });
  else if (name === "create") Object.assign(op, { op: "create", name: s(args.name), kind: s(args.kind), to: s(args.to), text: s(args.text), add: strings(args.states) });
  else if (name === "set_state") Object.assign(op, { op: "state", what: s(args.id), add: strings(args.add), remove: strings(args.remove) });
  else if (name === "note") Object.assign(op, { op: "note", what: s(args.id), text: s(args.text) });
  else if (name === "forget") Object.assign(op, { op: "forget", what: s(args.id), text: s(args.text) });
  else if (name === "leave") Object.assign(op, { op: "remove", what: s(args.id), text: s(args.text) });
  else if (name === "destroy") Object.assign(op, { op: "destroy", what: s(args.id), text: s(args.text) });
  return op;
}

/**
 * Re-derive a run's world from its recorded operations with the current language code (so a fix
 * to the language is measured without new model calls). Undefined for systems that don't record
 * operations in the extended language.
 */
export function reapply(system: string, c: WorldCase, trace: unknown): { world: SceneWorld; problems: string[] } | undefined {
  const world = clone(c.world);
  if (system.startsWith("tools")) {
    // Call by call, as the loop applied them; it refused unknown ids outright.
    const calls = (trace as { calls?: Array<Record<string, Record<string, unknown>>> }).calls ?? [];
    for (const [name, args] of calls.flatMap(call => Object.entries(call)).filter(([name]) => name !== "look")) {
      const op = toolOp(name, args);
      if ((op.what && !world.entities[op.what]) || (op.to && !world.entities[op.to])) continue;
      applyOpsV2(world, [op], c.turn);
    }
    return { world, problems: [] };
  }
  if (!system.startsWith("ops") && !system.startsWith("decider") && system !== "gm-block") return undefined;
  const t = trace as unknown[];
  const ops = (Array.isArray(t[0]) ? t.at(-1) : t) as WorldOpV2[];
  const applied = applyOpsV2(world, ops.slice(0, 16), c.turn, "stage", { resolve: system.startsWith("ops-free") });
  return { world, problems: applied.problems };
}

export function toolLoop(options: { name: string; effort?: Effort }): System {
  return {
    name: options.name,
    about: `A tool-calling loop (look, move, give, drop, create, set_state, note, forget, leave, destroy), reasoning ${options.effort ?? "none"}: each call applies at once and returns the result.`,
    async run(c) {
      const world = clone(c.world);
      const problems: string[] = [];
      const started = performance.now();
      const call = async (name: string, args: Record<string, unknown>) => {
        if (name === "look") return look(world, String(args.id ?? ""));
        const op = toolOp(name, args);
        // Ids only: a name or a phrase comes straight back as an error the model can fix.
        for (const ref of [op.what, op.to]) if (ref && !world.entities[ref]) { problems.push(`${name}: unknown id "${ref}"`); return { ok: false, error: `No "${ref}" in the world: use an id in brackets.` }; }
        const r = applyOpsV2(world, [op], c.turn);
        problems.push(...r.problems);
        return { ok: !r.problems.length, changes: r.changes, problems: r.problems, ...(op.what ? { now: look(world, op.what) } : {}) };
      };
      const r = await runToolsCounted({
        operation: "eval.world.tools", effort: options.effort ?? "none", maxTurns: 8,
        instructions: `${STAGE_V2.replace(WORLD_LANGUAGE_V2, "")}\n\nMake the changes with the tools (several at once is fine), then answer "done". Use ids from the world (in brackets).`,
        input: [{ role: "user", content: stageInput(c, c.world) }], tools: TOOLS,
      }, call);
      // A failed call the model then fixed isn't a failure of the outcome (what it never put right
      // shows up as a missed change); the failed calls are kept in the trace for reading.
      return { world, trace: { calls: r.calls.map(x => ({ [x.name]: x.args })), failed: problems, roundMs: r.roundMs.map(Math.round) }, problems: [], costUsd: r.costUsd, latencyMs: performance.now() - started, calls: r.rounds, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 4. The GM writes the operations itself. Measured here as a continuation of the GM's own call:
//    its prompt (with its view of the world) and its reply, then a request for the operations.
//    In play this would be a hidden block at the end of the same streamed reply.

export function gmBlock(options: { name: string }): System {
  return {
    name: options.name,
    about: "The GM writes the operations: its own call (prompt, world view, reply) continued with a request for the world block. A proxy for a hidden block at the end of the streamed reply.",
    async run(c) {
      if (!c.gm) throw new Error(`${c.id}: no GM call recorded`);
      const started = performance.now();
      const result = await respondJson<{ ops: WorldOpV2[] }>({
        operation: "eval.world.gm-block", effort: "none", instructions: c.gm.instructions,
        input: [...c.gm.input, { role: "assistant", content: c.reply }, { role: "developer", content: `${STAGE_V2.replace("You keep the world model", "Now, for the game's world model (the player never sees this): you keep it").replace("After each exchange, write", "Write")}\n\n${c.rules.length ? `The rules' dice this turn: ${c.rules.join("; ")}` : ""}` }],
        json: { name: "world_ops", schema: opSchemaV2(c.world) },
      });
      const world = clone(c.world);
      const applied = applyOpsV2(world, (result.ops ?? []).slice(0, 16), c.turn);
      return { world, trace: result.ops, problems: applied.problems, costUsd: result._meta.costUsd, latencyMs: performance.now() - started, calls: 1, inputTokens: result._meta.inputTokens, outputTokens: result._meta.outputTokens };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 5. The decider: where is everyone, and who has what, as choice questions (no free text, so no
//    creations, states or notes). Fast and bounded; it can only say what its options say.

const live = (e: Entity) => !e.states.includes("gone");
export function deciderSystem(options: { name: string; decider: Decider }): System {
  return {
    name: options.name,
    about: `Choice questions to ${options.decider.name}: where each person is now (where they were, an area, by something, gone) and who holds each item. Positions and hand-overs only.`,
    async run(c) {
      const world = clone(c.world);
      const started = performance.now();
      const all = Object.values(world.entities).filter(e => live(e) && e.kind !== "place");
      const areas = all.filter(e => e.kind === "area");
      const people = all.filter(e => e.kind === "person" || e.kind === "creature");
      const landmarks = all.filter(e => e.kind === "feature" || e.kind === "object" || e.kind === "person" || e.kind === "creature");
      const items = all.filter(e => e.kind === "item" && !(e.parent && world.entities[e.parent]?.kind === "item"));
      const questions: Record<string, ChoiceQuestion> = {};
      for (const p of people) {
        questions[`where_${p.id}`] = {
          instructions: `After the latest exchange (latest_player_turn, then latest_gm_reply), where is ${p.name}${p.player ? " (the player character)" : ""} now? The world shows where they were before it; the reply wins where they disagree.`,
          criteria: {
            same: "Where the world already has them: they haven't moved anywhere new (shifting on the spot, looking or talking doesn't count).",
            left: "They have left the scene.",
            ...Object.fromEntries(areas.map(a => [`area:${a.id}`, `Moved to ${a.name}, not by anything in particular.`])),
            ...Object.fromEntries(landmarks.filter(l => l.id !== p.id).map(l => [`near:${l.id}`, `Moved to ${l.name}${l.player ? " (the player)" : ""}.`])),
          },
        };
      }
      for (const it of items) {
        questions[`holder_${it.id}`] = {
          instructions: `After the latest exchange, who or what has ${it.name}?`,
          criteria: {
            same: "No change: still as the world shows it.",
            ...Object.fromEntries(people.map(p => [`held:${p.id}`, `${p.name}${p.player ? " (the player)" : ""} has it now.`])),
            down: "Put down or dropped: nobody holds it now.",
          },
        };
      }
      const decision = await options.decider.decide({ world: stageView(world), latest_player_turn: c.playerTurn, ...(c.rules.length ? { rules: c.rules.join("; ") } : {}), latest_gm_reply: c.reply }, questions, "eval.world.decider");
      const ops: WorldOpV2[] = [];
      const blank = { to: "", how: "", feet: 0, name: "", kind: "", text: "", add: [], remove: [] };
      for (const p of people) {
        const a = decision.answers[`where_${p.id}`]?.choice ?? "same";
        if (a === "left") ops.push({ ...blank, op: "remove", what: p.id });
        else if (a.startsWith("area:") && areaOf(world, p.id)?.id !== a.slice(5)) ops.push({ ...blank, op: "move", what: p.id, to: a.slice(5) });
        else if (a.startsWith("near:")) {
          const target = a.slice(5);
          const pa = positionOf(world, p.id), pt = positionOf(world, target);
          if (!pa || !pt || distance(pa, pt) > 6) ops.push({ ...blank, op: "move", what: p.id, to: target });
        }
      }
      for (const it of items) {
        const a = decision.answers[`holder_${it.id}`]?.choice ?? "same";
        if (a.startsWith("held:") && it.parent !== a.slice(5)) ops.push({ ...blank, op: "give", what: it.id, to: a.slice(5) });
        else if (a === "down" && it.parent && ["person", "creature"].includes(world.entities[it.parent]?.kind ?? "")) ops.push({ ...blank, op: "drop", what: it.id });
      }
      const applied = applyOpsV2(world, ops, c.turn);
      return { world, trace: ops, problems: applied.problems, costUsd: decision.costUsd, latencyMs: performance.now() - started, calls: 1 };
    },
  };
}

export const SYSTEMS: Record<string, () => System> = {
  current: () => current,
  "current+view": () => currentPromptNewView,
  ops: () => opsV2({ name: "ops" }),
  "ops-check": () => opsV2({ name: "ops-check", check: true }),
  "ops-low": () => opsV2({ name: "ops-low", effort: "low" }),
  "ops-free": () => opsV2({ name: "ops-free", freeIds: true, about: "The proposed prompt and language with free-text ids, read by the forgiving resolver (no enum in the schema)." }),
  "ops-free-low": () => opsV2({ name: "ops-free-low", freeIds: true, effort: "low" }),
  tools: () => toolLoop({ name: "tools" }),
  "tools-low": () => toolLoop({ name: "tools-low", effort: "low" }),
  "gm-block": () => gmBlock({ name: "gm-block" }),
  "decider-luna": () => deciderSystem({ name: "decider-luna", decider: new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions") }),
  "decider-jev": () => deciderSystem({ name: "decider-jev", decider: new JevDecider() }),
  "decider-luna-json": () => deciderSystem({ name: "decider-luna-json", decider: new LunaDecider("none") }),
};
