import type { ToolCall } from "./tools.ts";

/**
 * A stand-in for OpenRouter, for tests that play real turns with no network (src/report/report.test.ts):
 * the game's own calls, through its own code, answered here.
 *
 * - The Decisions API (the decider): every question gets its quietest choice (none,
 *   not_yet, on_track, in_character...), or its first; or the choice `choices` names for it, or of
 *   a list it names, the first the question offers (`"ending": ["open-case", "hobb-talks"]` ends
 *   each scene at the first of them it has).
 * - The Responses API: JSON made to fit the schema asked for (the stage manager's operations, the
 *   quick co-GM), or one of `byName`'s by the schema's name; the lines a scene or a talk suggests
 *   (asked for in instructions that begin "You suggest what the player might": ai/prompts/suggest.md,
 *   src/runtime/talk.ts) from `suggestions`, in turn, none unless it's given (a talk's from
 *   `talkSuggestions` instead, when it's given: its lines are plain, a scene's have their kinds); the hand-off between
 *   two scenes (instructions that begin "You write the hand-off between two scenes": ai/gm/boundary.ts)
 *   from `handoff`, when it's given; otherwise the GM's next line from `replies`, streamed as
 *   OpenRouter streams it.
 *
 * - `capped`: structured calls that run to their token cap (status incomplete), billed at the cost given.
 * - `phased`: structured calls answered in two phases, as Luna sometimes does: a "commentary" message
 *   of junk, then the answer as a "final_answer".
 * - `streamMs` and `decisionDelayMs`: a GM's reply written a word at a time, and a slow decider.
 * - `byNameDelayMs` and `suggestDelayMs`: slow structured calls (by the schema's name: the notes on
 *   a reply's marks), and slow suggested lines.
 * - `toolCalls`: a tool loop's calls (runTools: the memory reviews' world-facts agent), by the loop's
 *   first tool (`search_lore`). Its first round answers with them; a round that sends their outputs
 *   back answers "Done.". A loop without any answers as a reply does. (The notes review is a
 *   structured call, answered by `byName.gm_notes`.)
 * - The two-part GM (docs/two-part-design.md): its mouthpiece (the structured call named `reply`)
 *   answers the next of `replies` as its narration, with no check, or with `mouthpiece.check`'s on
 *   every reply but an opening or a closing (five outcomes the fake writes), and a lead's name owed
 *   said by whoever its per-turn note says names them now; a closing closes, unless
 *   `mouthpiece.holds` (then it waits, the once it may). Its co-GM (the tool loop with `move_scene`)
 *   walks the scene to its first good ending (or the first of `coGm.endings` the scene has): each turn
 *   the next open route on the shortest way there, the required discoveries first, a dice route taken
 *   as a success; it reads the scene's routes off its prep, where routeLine writes them (ai/gm/two-part.ts),
 *   and what's reached and open off its input. `coGm.still` keeps it from moving; `coGm.roles` are
 *   roles it sets every turn. In a talk (its start the talk template's, [talk]) it walks only to what
 *   `coGm.endings` names, `told` among them: its ending is the player's to choose (their goodbye, or
 *   walking on), and what the companion confides theirs to give.
 *
 * Anything else asked of it is refused, so a test can't reach the real thing by accident. Two ways
 * in: `fakeOpenRouter` puts it in place of the process's fetch (the prototype's tests), and
 * `fakeFetch` hands it over as a fetch of its own, for a request's CallContext (the AI service).
 */

const QUIET = ["none", "not_yet", "on_track", "in_character", "covered", "harmless", "here", "no"];

/**
 * What the stand-in is told to answer. `odds`: how sure the decider is of a question's choice (0.97
 * otherwise), the rest shared among the others. `streamMs`: a streamed reply comes word by word over
 * this long (at once otherwise), as a model's does. `decisionDelayMs`: every decision waits this long
 * before it answers (a slow decider, for a test that needs a think in flight). `byNameDelayMs`: a
 * structured call waits this long, by its schema's name, before it answers; `suggestDelayMs`: so do
 * the suggested lines (for a test that needs the notes or the lines still on their way). `toolCalls`:
 * the calls a tool loop makes, by its first tool's name (each a tool's name and its arguments).
 * `talkSuggestions`: a talk's lines (talk.suggest), apart from a scene's, in turn as `suggestions`.
 */
export interface FakeOptions {
  replies?: string[];
  byName?: Record<string, unknown>;
  choices?: Record<string, string | string[]>;
  odds?: Record<string, number>;
  suggestions?: string | string[];
  talkSuggestions?: string | string[];
  handoff?: string;
  capped?: Record<string, number>;
  phased?: string[];
  streamMs?: number;
  decisionDelayMs?: number;
  byNameDelayMs?: Record<string, number>;
  suggestDelayMs?: number;
  toolCalls?: Record<string, Array<Pick<ToolCall, "name" | "args">>>;
  /** The two-part GM's mouthpiece: a check it calls on every reply but an opening or a closing (its five outcomes the fake's), and a closing that waits. */
  mouthpiece?: { check?: { skill: string; dc: number }; holds?: boolean; fight?: { on: string; foes: string[]; allies?: string[]; flee?: string[] } };
  /** The GM's picks (pick_sides) for whoever a fight breaking out left with no side: by id, else they run. */
  sides?: Record<string, "with_player" | "against_player" | "flee">;
  /** The two-part GM's co-GM: still (no moves), the endings it walks to (the first the scene has, or a discovery: a talk's `told`; else its first good one, but in a talk none), and roles it sets every turn. */
  coGm?: { still?: boolean; endings?: string[]; roles?: Record<string, { status: string; mental_state: string; conversation_role: string }> };
}

/** The stand-in as a fetch of its own, with what it was asked and sent, in order. */
export interface FakeFetch {
  fetch: typeof fetch;
  /** What was asked of it, by endpoint, in order. */
  asked: string[];
  /** What was sent, in order (the requests' bodies). */
  sent: Request[];
}

export interface FakeOpenRouter {
  /** What was asked of it, by endpoint, in order. */
  asked: string[];
  /** What was sent, in order (the requests' bodies). */
  sent: Request[];
  /** Put the real fetch back. */
  restore(): void;
}

/**
 * The stand-in as a fetch to hand to the model client (a CallContext's), with nothing global: the
 * process's own fetch still reaches everything else (the AI service's posts to SpacetimeDB).
 */
export function fakeFetch(options: FakeOptions = {}): FakeFetch {
  const replies = options.replies ?? ["The GM nods. “Go on.”"];
  const suggestions = [options.suggestions ?? ""].flat();
  const talkSuggestions = options.talkSuggestions === undefined ? undefined : [options.talkSuggestions].flat();
  let next = 0, suggested = 0, talked = 0;
  const asked: string[] = [];
  const sent: Request[] = [];
  const answerFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Request;
    asked.push(new URL(url).pathname);
    sent.push(body);
    if (url === "https://openrouter.ai/api/alpha/decisions") {
      if (options.decisionDelayMs) await waited(options.decisionDelayMs, init?.signal);
      return json({ answers: answer(body.questions ?? {}, options.choices, options.odds), usage: { cost: 0.0001 } });
    }
    if (url !== "https://openrouter.ai/api/v1/responses") return json({ error: { message: `the fake OpenRouter doesn't answer ${url}` } }, 404);
    if (body.tools?.some(t => t.name === "move_scene")) return json(coGmRound(body, options.coGm ?? {}));
    if (body.tools?.some(t => t.name === "pick_sides")) return json(sidesRound(body, options.sides ?? {}));
    const looped = body.tools?.[0] && options.toolCalls?.[body.tools[0].name];
    if (looped) return json(toolRound(looped, body.input ?? []));
    const format = body.text?.format;
    const suggesting = !!body.instructions?.startsWith("You suggest what the player might");
    const talking = !!talkSuggestions && !!body.instructions?.startsWith("You suggest what the player might say next in a conversation with");
    const handing = options.handoff !== undefined && !!body.instructions?.startsWith("You write the hand-off between two scenes");
    const delay = format ? options.byNameDelayMs?.[format.name] : suggesting ? options.suggestDelayMs : undefined;
    if (delay) await waited(delay, init?.signal);
    if (format && options.capped?.[format.name] !== undefined) return capped(options.capped[format.name]!);
    const mouthpiece = format?.name === "reply" && !!format.schema.properties?.narration && options.byName?.reply === undefined;
    const text = mouthpiece ? JSON.stringify(spoken(replies[next++ % replies.length]!, format.schema, body.input ?? [], options.mouthpiece ?? {}))
      : format?.type === "json_schema" ? JSON.stringify(options.byName?.[format.name] ?? fit(format.schema))
      : talking ? talkSuggestions![talked++ % talkSuggestions!.length]!
      : suggesting ? suggestions[suggested++ % suggestions.length]!
      : handing ? options.handoff!
      : replies[next++ % replies.length]!;
    if (format && options.phased?.includes(format.name)) return phased(`${text.slice(0, 40)}"} \n\n the response is not valid json`, text);
    if (!body.stream) return json(completed(text));
    return options.streamMs ? sseSlowly(text, options.streamMs, init?.signal) : sse(text);
  };
  return { fetch: answerFetch, asked, sent };
}

/** The stand-in in place of the process's fetch, for tests that play the prototype's turns through its own code. */
export function fakeOpenRouter(options: FakeOptions = {}): FakeOpenRouter {
  const real = globalThis.fetch;
  const fake = fakeFetch(options);
  globalThis.fetch = fake.fetch;
  return { asked: fake.asked, sent: fake.sent, restore: () => { globalThis.fetch = real; } };
}

export interface Request {
  questions?: Record<string, { criteria: Record<string, string> }>;
  text?: { format?: { type: string; name: string; schema: Schema } };
  instructions?: string;
  stream?: boolean;
  max_output_tokens?: number;
  input?: Array<{ role: string; content: string }>;
  /** A tool loop's tools (runTools). */
  tools?: Array<{ name: string }>;
}

/**
 * A tool loop's round: its calls, each with a call id, the first time; once their outputs have come
 * back (an input item of type function_call_output), the agent's last word.
 */
function toolRound(calls: Array<Pick<ToolCall, "name" | "args">>, input: NonNullable<Request["input"]>): unknown {
  if (input.some(item => (item as { type?: string }).type === "function_call_output")) return completed("Done.");
  const output = calls.map((c, i) => ({ type: "function_call", call_id: `call_${i + 1}`, name: c.name, arguments: JSON.stringify(c.args ?? {}) }));
  return { status: "completed", output, usage: { input_tokens: 120, output_tokens: 30, cost: 0.0002 } };
}

/**
 * The two-part GM's mouthpiece: the reply as its narration, with a lead's name said by whoever its
 * per-turn note says names them now (ai/gm/two-part.ts owedDirective: "Sergeant Agnes Kell names him
 * now: Big Hobb Mallory."), as a model following it would; a check on a reply that isn't the
 * opening (whose only player turn is "(The player is ready. Begin.)") or a closing (asked whether it
 * closes), when the recipe has one; a closing closes, unless the recipe holds it.
 */
function spoken(narration: string, schema: Schema, input: NonNullable<Request["input"]>, recipe: NonNullable<FakeOptions["mouthpiece"]>): unknown {
  const closing = !!schema.properties?.closes;
  const opening = input.filter(m => m.role === "user").at(-1)?.content === "(The player is ready. Begin.)";
  const dice = recipe.check && !closing && !opening && !!schema.properties?.outcomes ? recipe.check : undefined;
  const outcomes = {
    major_failure: "It goes badly wrong, and Kell's pencil stops.", minor_failure: "Not this time: something else will have to tell it.",
    barely_passed: "Just: a part of it, and a catch.", minor_success: "Cleanly: the next of it comes out.", major_success: "Better than hoped: the next of it, and a little more.",
  };
  const owed = /(?:^|\n)([^\n]+?) names (?:him|her|them) now: ([^\n]+?)\. /.exec(input.filter(m => m.role === "system").at(-1)?.content ?? "");
  const said = owed ? `${narration} [${owed[1]}] “${owed[2]}.”` : narration;
  // In the schema's order: the check decided first, then the narration, then its outcomes (a talk's has no check: its narration, then null).
  if (!schema.properties?.outcomes) return { narration: said, check: null, ...(closing ? { closes: !recipe.holds } : {}) };
  // A fight breaking out (docs/combat-gm.md) when the player's line has the recipe's cue in it.
  const line = input.filter(m => m.role === "user").at(-1)?.content.toLowerCase() ?? "";
  const fight = recipe.fight && !closing && !opening && !!schema.properties?.roll_for_initiative && line.includes(recipe.fight.on.toLowerCase())
    ? { foes: recipe.fight.foes, allies: recipe.fight.allies ?? [], flee: recipe.fight.flee ?? [], why: "a fight breaks out", on: [] } : null;
  if (fight) return { check: null, roll_for_initiative: fight, narration: `${said} Roll for initiative!`, outcomes: null, ...(closing ? { closes: !recipe.holds } : {}) };
  return { check: dice ? { skill: dice.skill, dc: dice.dc } : null, ...(schema.properties?.roll_for_initiative ? { roll_for_initiative: null } : {}), narration: said, outcomes: dice ? outcomes : null, ...(closing ? { closes: !recipe.holds } : {}) };
}

/**
 * The sides a fight's people take (ai/gm/sides.ts), read off its note: each one listed gets the
 * options' `sides` for them, else they run. One call, which the loop stops on.
 */
function sidesRound(body: Request, sides: NonNullable<FakeOptions["sides"]>): unknown {
  const note = body.input?.filter(m => m.role === "system").at(-1)?.content ?? "";
  const listed = /## A fight is breaking out[\s\S]*?\n((?:- .*(?:\n|$))+)/.exec(note);
  const ids = [...(listed?.[1] ?? "").matchAll(/^- .*? \[([^\]]+)\]/gm)].map(m => m[1]!);
  const args = { sides: ids.map(id => ({ id, side: sides[id] ?? "flee" })), narration: "Everyone else takes a side, or a door." };
  return { status: "completed", output: [{ type: "function_call", call_id: "call_1", name: "pick_sides", arguments: JSON.stringify(args) }], usage: { input_tokens: 400, output_tokens: 40, cost: 0.0003 } };
}

/** A route as the co-GM's prep has it (routeLine's): its id, where it goes from and to, what it needs reached first, and whether the dice decide it. */
export interface PrepRoute { id: string; source: string; target: string; requires: string[]; dice: boolean }

/** The scene as the co-GM's prep writes it: every route (each once), its endings in order with how they went, and the discoveries it can't end well without. */
export function readPrep(instructions: string): { routes: PrepRoute[]; endings: Array<{ id: string; result: string }>; required: string[] } {
  const routes = new Map<string, PrepRoute>();
  for (const [, head] of instructions.matchAll(/^- (\[[a-z0-9-]+\] from .*?)\. When: /gm)) {
    const ids = [...head!.matchAll(/\[([a-z0-9-]+)\]/g)].map(m => m[1]!);
    const once = /, once (.*?) (?:is|are) reached/.exec(head!)?.[1] ?? "";
    if (ids.length >= 3 && !routes.has(ids[0]!)) routes.set(ids[0]!, { id: ids[0]!, source: ids[1]!, target: ids[2]!, requires: [...once.matchAll(/\[([a-z0-9-]+)\]/g)].map(m => m[1]!), dice: head!.includes("; the dice decide (") });
  }
  const endings = [...instructions.matchAll(/^### .* \[([a-z0-9-]+)\]: an? (good|mixed|bad) ending$/gm)].map(m => ({ id: m[1]!, result: m[2]! }));
  const required = [...instructions.matchAll(/^### .* \[([a-z0-9-]+)\] \(required/gm)].map(m => m[1]!);
  return { routes: [...routes.values()], endings, required };
}

/**
 * The fake co-GM's walk: the routes to take, in order, to reach `target` from what's `reached`, the
 * required discoveries first. Each node by the route into it that needs the fewest routes taken
 * before it (its source and what it requires, reached the same way), ties to the prep's order.
 */
export function walkTo(prep: ReturnType<typeof readPrep>, reached: string[], target: string): string[] {
  const have = new Set(reached);
  const memo = new Map<string, string[] | undefined>();
  const into = (node: string, visiting: Set<string>): string[] | undefined => {
    if (have.has(node)) return [];
    if (memo.has(node)) return memo.get(node);
    if (visiting.has(node)) return undefined;
    visiting.add(node);
    let best: string[] | undefined;
    for (const r of prep.routes.filter(x => x.target === node)) {
      const before: string[] = [];
      let possible = true;
      // What it requires first (the discoveries an ending needs), then where it leaves from (an event): the story's order.
      for (const need of [...r.requires, r.source]) {
        const way = into(need, visiting);
        if (!way) { possible = false; break; }
        for (const id of way) if (!before.includes(id)) before.push(id);
      }
      if (possible && (!best || before.length + 1 < best.length)) best = [...before, r.id];
    }
    visiting.delete(node);
    memo.set(node, best);
    return best;
  };
  const path: string[] = [];
  for (const node of [...prep.required, target]) for (const id of into(node, new Set()) ?? []) if (!path.includes(id)) path.push(id);
  return path;
}

/**
 * The fake co-GM's round: its roles (the recipe's), and the next open route on its walk to the
 * scene's first good ending (or the first of the recipe's the scene has whose walk is open: a fight
 * fought, the walk goes on to the next; in a talk, only the recipe's), a dice route as a success;
 * once their outputs come back, "done", but for a move held for a second look (ai/gm/two-part.ts
 * coGm: a cue into a bad ending, a discovery naming someone nobody has said yet), which it takes
 * again once, as a co-GM that had looked and still judged it so would.
 */
function coGmRound(body: Request, recipe: NonNullable<FakeOptions["coGm"]>): unknown {
  const input = body.input ?? [];
  const items = input as Array<{ type?: string; name?: string; call_id?: string; arguments?: string; output?: string }>;
  if (items.some(item => item.type === "function_call_output")) {
    const moves = items.filter(item => item.type === "function_call" && item.name === "move_scene");
    const again = moves.find(m => /^"Not taken yet/.test(items.find(o => o.type === "function_call_output" && o.call_id === m.call_id)?.output ?? "") && moves.filter(x => x.arguments === m.arguments).length === 1);
    if (again) return { status: "completed", output: [{ type: "function_call", call_id: `${again.call_id}_again`, name: "move_scene", arguments: again.arguments }], usage: { input_tokens: 120, output_tokens: 30, cost: 0.0002 } };
    return completed("done");
  }
  const said = input.map(m => (typeof m.content === "string" ? m.content : "")).join("\n");
  const calls: Array<Pick<ToolCall, "name" | "args">> = Object.entries(recipe.roles ?? {}).map(([id, role]) => ({ name: "update_character_role", args: { char_id: id, ...role } }));
  if (!recipe.still) {
    const prep = readPrep(body.instructions ?? "");
    const reached = [.../Reached so far: (.*)\./.exec(said)?.[1]?.matchAll(/\[([a-z0-9-]+)\]/g) ?? []].map(m => m[1]!);
    const open = [...(/# Open routes\n([\s\S]*?)(?:\n\n|$)/.exec(said)?.[1] ?? "").matchAll(/^- \[([a-z0-9-]+)\]/gm)].map(m => m[1]!);
    // A talk's ending is the player's to choose (their goodbye, or walking on), and what the companion confides theirs to give: a talk is walked only to what the recipe names.
    const talk = /^## Where it starts: .*\[talk\]$/m.test(body.instructions ?? "");
    const targets = recipe.endings ? recipe.endings.filter(e => prep.routes.some(r => r.target === e)) : talk ? [] : prep.endings.filter(e => e.result === "good").slice(0, 1).map(e => e.id);
    let target: string | undefined, next: string | undefined;
    for (const t of targets) {
      next = walkTo(prep, reached, t).find(id => open.includes(id));
      if (next) { target = t; break; }
    }
    const route = prep.routes.find(r => r.id === next);
    if (route) calls.push({ name: "move_scene", args: { route_id: route.id, outcome: route.dice ? "success" : "none", why: `The fake co-GM's walk to ${target}.` } });
  }
  if (!calls.length) return completed("done");
  return { status: "completed", output: calls.map((c, i) => ({ type: "function_call", call_id: `call_${i + 1}`, name: c.name, arguments: JSON.stringify(c.args ?? {}) })), usage: { input_tokens: 120, output_tokens: 30, cost: 0.0002 } };
}

/** A reply that ran to its token cap: junk, then incomplete, billed all the same. */
function capped(cost: number): Response {
  const response = { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", content: [{ type: "output_text", text: "{\"act\":\"..." }] }], usage: { input_tokens: 12000, output_tokens: 1000, cost } };
  const events = [{ type: "response.output_text.delta", delta: "{\"act\":\"..." }, { type: "response.incomplete", response }];
  return new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}
interface Schema { type?: string | string[]; enum?: unknown[]; const?: unknown; properties?: Record<string, Schema>; required?: string[]; anyOf?: Schema[] }

function answer(questions: NonNullable<Request["questions"]>, choices: Record<string, string | string[]> = {}, odds: Record<string, number> = {}): Record<string, { choice: string; probabilities: Record<string, number>; confidence: number }> {
  return Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    const keys = Object.keys(q.criteria);
    const choice = [choices[id] ?? []].flat().find(c => keys.includes(c)) ?? QUIET.find(k => keys.includes(k)) ?? keys[0]!;
    const sure = odds[id] ?? 0.97;
    const probabilities = Object.fromEntries(keys.map(k => [k, k === choice ? sure : (1 - sure) / Math.max(1, keys.length - 1)]));
    return [id, { choice, probabilities, confidence: 0.95 }];
  }));
}

/** The least JSON that fits a schema: each required field, empty. */
function fit(schema: Schema): unknown {
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.anyOf) return fit(schema.anyOf[0]!);
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== "null") ?? schema.type[0] : schema.type;
  switch (type) {
    case "object": return Object.fromEntries((schema.required ?? Object.keys(schema.properties ?? {})).map(k => [k, fit(schema.properties?.[k] ?? {})]));
    case "array": return [];
    case "string": return "";
    case "integer": case "number": return 0;
    case "boolean": return false;
    default: return null;
  }
}

const completed = (text: string) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 120, output_tokens: 30, cost: 0.0002 } });

/** A reply in two phases: junk as commentary, then the answer as the final answer, both streamed. */
function phased(junk: string, text: string): Response {
  const response = { status: "completed", output: [
    { type: "message", phase: "commentary", content: [{ type: "output_text", text: junk }] },
    { type: "message", phase: "final_answer", content: [{ type: "output_text", text }] },
  ], usage: { input_tokens: 120, output_tokens: 60, cost: 0.0003 } };
  const events = [{ type: "response.output_text.delta", delta: junk }, { type: "response.output_text.delta", delta: text }, { type: "response.completed", response }];
  return new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function sse(text: string): Response {
  const events = [{ type: "response.output_text.delta", delta: text }, { type: "response.completed", response: completed(text) }];
  return new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A streamed reply a word at a time, `ms` over the whole of it, as a model writes; the caller giving up ends it. */
function sseSlowly(text: string, ms: number, signal: AbortSignal | null | undefined): Response {
  const words = text.match(/\S+\s*/g) ?? [text];
  const frame = (e: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let sentWords = 0;
      const step = () => {
        if (signal?.aborted) return controller.error(signal.reason);
        if (sentWords < words.length) {
          controller.enqueue(frame({ type: "response.output_text.delta", delta: words[sentWords++] }));
          timer = setTimeout(step, ms / words.length);
          return;
        }
        controller.enqueue(frame({ type: "response.completed", response: completed(text) }));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      };
      step();
    },
    cancel() { clearTimeout(timer); },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A wait the caller can give up on (its signal). */
function waited(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
