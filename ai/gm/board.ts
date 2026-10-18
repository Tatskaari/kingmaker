// New (docs/combat-gm.md): the GM on the board. A scene's fight is fought on the board, as the zoo's
// combat ring fights one, and the GM is still the voice at the table (the user: "make it so the GM
// still narrates what happens in the log, and if I click on it, I can still narrate what I do"):
// each turn the board plays is told in the fight's log in the scene's voice (narrateTurn), and the
// player's turn in their own words is played on the board through three tools, one call at a time
// (boardTurn: act with one of the board's options by its id, move_towards, end_turn), the loop
// stopping on each so the simulation can do it and ask again with what came of it. The GM is the
// mouthpiece's (the user's two-part prompt, the scene's prep and its people, who says each line),
// with the fight's own instructions (ai/prompts/fight-gm.md) and the fight as it stands.

import type { Markup } from "../../shared/markup.ts";
import type { BoardDone, BoardFighter, BoardMoment, BoardMove, BoardTurnRequest, BoardView, NarrateRequest, Reply } from "../../shared/protocol/ai.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { respond, type CallContext, type Message } from "../llm/openrouter.ts";
import { InvalidToolArguments, runTools, type ToolDef } from "../llm/tools.ts";
import { prompt } from "../prompts/index.ts";
import { sceneEntries } from "./brief.ts";
import { charactersOf, gmText, mouthpieceInput, prepOf, SPOKEN_RULES } from "./two-part.ts";
import { asKnown, unheardOf } from "./unheard.ts";
import { readReply } from "./voice.ts";
import type { TurnView } from "./view.ts";

const NARRATION = { type: "string" };

export const ACT: ToolDef = {
  name: "act",
  description: "The player does one of the things the board lists for them now, by its id: the board does it at once and answers with what came of it (the dice), or why it can't be done. Then go on: another act, a move, or end_turn. One call at a time.",
  parameters: {
    type: "object", additionalProperties: false, required: ["id", "narration"],
    properties: {
      id: { type: "string", description: "One of the ids the board lists, exactly as listed (attack@4,3, cast_fire-bolt@4,3, feature_second-wind, dash, yield…)." },
      narration: { ...NARRATION, description: "What the table hears as they make the attempt, up to the moment the dice decide it ('you swing at his gut', never 'you punch him in the gut'). One sentence; never whether it works, and never the player's own words quoted back." },
    },
  },
};

export const MOVE_TOWARDS: ToolDef = {
  name: "move_towards",
  description: "The player moves this turn, as far as their move goes: towards someone or something (they stop beside them, if they can get there), or with away: true, back from them. The board moves them, a tile at a time, and answers with where they've got to.",
  parameters: {
    type: "object", additionalProperties: false, required: ["target", "narration"],
    properties: {
      target: { type: "string", description: "Whom or what they move towards (or away from): an id from the fight, or a way out's (exit)." },
      away: { type: "boolean", description: "true: backing off from them instead." },
      narration: { ...NARRATION, description: "How they move, in one short sentence with who does it ('You vault the trestle.')." },
    },
  },
};

export const END_TURN: ToolDef = {
  name: "end_turn",
  description: "The player's turn is over: they've done what they said. The next in the initiative order goes next.",
  parameters: {
    type: "object", additionalProperties: false, required: ["narration"],
    properties: { narration: { ...NARRATION, description: "What came of their turn, as the board's results say (each hit, miss, wound and fall told in the fiction, once), and the answer to anything they said, as whoever they spoke to would, mid-fight. A sentence or two; nothing of the next person's turn." } },
  },
};

/** The fight's instructions: the mouthpiece's prompt with the scene's prep and people, the fight's, then who says each line and what the player sees. */
export function boardInstructions(scene: Scene, view: TurnView): string {
  return [prompt("two-part-gm", { tone: prompt("tone-comic"), beats: prepOf(scene, view), characters: charactersOf(scene, view) }), prompt("fight-gm"), SPOKEN_RULES()].join("\n\n");
}

/** The fight's input: the scene's history as the mouthpiece reads it (its replies up to the one that rolled for initiative), then the fight as it stands, and what's asked. */
export function boardInput(scene: Scene, view: TurnView, note: string): Message[] {
  const input = mouthpieceInput(scene, view, [], { fight: true });
  const now = sceneEntries(view).filter(e => e.turn === view.turn && e.kind !== "player" && e.kind !== "system");
  if (view.turn > 0 && now.length) input.push({ role: "assistant", content: gmText(scene, view, now) });
  input.push({ role: "system", content: note });
  return input;
}

/** The fight as it stands, for the GM: the round, everyone in initiative order (how they stand, where, how far from the others), and whose turn it is. */
export function boardNote(fight: BoardView): string {
  return `## The fight: round ${fight.round}${fight.why ? ` (${fight.why})` : ""}
On the board, in initiative order:
${fight.fighters.map(f => fighterLine(f, f.id === fight.whose, fight.fighters)).join("\n")}`;
}

function fighterLine(f: BoardFighter, now: boolean, all: BoardFighter[]): string {
  const name = f.id === "player" ? "You, the player character (\"you\" in your narration, never their name)" : f.called ? `${f.called} (${f.name}: the player hasn't heard the name, so they're ${f.called} in your narration until someone says it)` : f.name;
  const side = f.side === "player" ? "" : f.side === "ally" ? ", with the player" : f.side === "enemy" ? ", against the player" : ", out of it (running or keeping clear)";
  const state = f.state === "fighting" ? `${hurt(f)}${f.conditions.length ? `, ${f.conditions.join(", ")}` : ""}` : STATES[f.state] ?? f.state;
  const apart = f.state === "fighting" ? Object.entries(f.feet).filter(([id]) => all.some(o => o.id === id && o.state === "fighting")).map(([id, ft]) => `${nameIn(all, id)} ${ft <= 5 ? "beside them" : `${ft} ft`}`).join(", ") : "";
  return `- ${name} [${f.id}]${side}: ${state}${apart ? `. From: ${apart}` : ""}${now ? "  ◀ their turn" : ""}`;
}

/** How someone's hurt, in words (the numbers are for you: never in the narration). */
function hurt(f: BoardFighter): string {
  const word = f.hp >= f.max ? "unhurt" : f.hp * 2 <= f.max ? "badly hurt" : "hurt";
  return `${word}, HP ${f.hp}/${f.max}`;
}

const STATES: Record<string, string> = { down: "down: out cold", dead: "dead", fled: "gone: ran off the board", surrendered: "gave up: hands up, out of it", coming: "not here yet" };

const nameIn = (all: BoardFighter[], id: string) => (id === "player" ? "you" : all.find(f => f.id === id)?.called ?? all.find(f => f.id === id)?.name ?? id);

/** A moment the board played, for the GM: its caption, and its dice under it. */
const momentLine = (m: BoardMoment) => `- ${m.caption}${m.lines.length ? `\n${m.lines.map(l => `    ${l}`).join("\n")}` : ""}`;

/** How the GM is asked: the request's calls, and the game's keys for who says each line. */
export interface BoardHow { calls: CallContext; byKey(markup: Markup): Markup }

/**
 * A turn the board played, told in the fight's log (one call on the mouthpiece's model, no
 * reasoning): what they did and what came of it, as the dice decided, in the scene's voice.
 */
export async function narrateTurn(scene: Scene, view: TurnView, req: Pick<NarrateRequest, "fight" | "whose" | "moments">, how: BoardHow): Promise<{ entries: Reply[]; costUsd: number }> {
  const whose = req.fight.fighters.find(f => f.id === req.whose);
  const who = req.whose === "player" ? "your (the player's)" : `${whose?.called ?? whose?.name ?? req.whose}'s`;
  const note = `${boardNote(req.fight)}

## Tell this turn: ${who}
What the board played, moment by moment (its dice under each):
${req.moments.map(momentLine).join("\n")}
Tell it in the fight's log: what they did and what came of it, exactly as the dice decided, in a sentence or two (a minor fighter's, one). Reply with the narration alone.`;
  const result = await respond({ operation: "fight.narrate", instructions: boardInstructions(scene, view), input: boardInput(scene, view, note), effort: "none", maxOutputTokens: 400, calls: how.calls });
  const text = result.text.trim();
  return { entries: text ? [spoken(scene, view, text, how.byKey)] : [], costUsd: result.costUsd };
}

/**
 * The GM's next move on the player's typed turn: one tool call, held to the board (an act by one of
 * the ids it lists, a move with a target, at most five things a turn), each wrong call answered in
 * the loop so the GM can put it right. Words alone end the turn on them.
 */
export async function boardTurn(scene: Scene, view: TurnView, req: Pick<BoardTurnRequest, "fight" | "options" | "movement" | "done"> & { line: string }, how: BoardHow): Promise<{ move: BoardMove; entries: Reply[]; costUsd: number }> {
  const result = await runTools({
    operation: "fight.turn", instructions: boardInstructions(scene, view), input: boardInput(scene, view, `${boardNote(req.fight)}\n\n${turnNote(req)}`), tools: [ACT, MOVE_TOWARDS, END_TURN],
    effort: "low", maxTurns: 4, calls: how.calls, roundMs: 20_000, deadlineMs: 40_000, parallel: false, stop: () => true,
  }, async (name, args) => { checkBoardCall(req, name, args); return { ok: true }; });
  const move = result.stopped ? moveOf(result.stopped.name, result.stopped.args) : { kind: "end_turn" as const, narration: result.text.trim() };
  if (!move.narration && move.kind === "end_turn" && !result.stopped) throw new Error("fight.turn: the GM made no move");
  return { move, entries: move.narration.trim() ? [spoken(scene, view, move.narration, how.byKey)] : [], costUsd: result.costUsd };
}

/** At most this many things on a typed turn, then it's over. */
export const BOARD_STEPS = 5;

/** What the player said and can do, and what's been done of it so far. */
function turnNote(req: Pick<BoardTurnRequest, "options" | "movement" | "done"> & { line: string }): string {
  const options = req.options.filter(o => o.id !== "auto" && o.id !== "end_turn" && !o.id.startsWith("walk@"));
  return [
    `## It's your turn: the player said «${req.line}»`,
    `What they can do now (act's id: what it is):\n${options.map(o => `- ${o.id}: ${o.label}`).join("\n") || "- (nothing more but a move)"}`,
    req.movement > 0 ? `They have ${req.movement} ft of movement left: move_towards someone or something to go there.` : "They have no movement left this turn.",
    ...(req.done.length ? [`## This turn so far\n${req.done.map(doneLine).join("\n")}`] : []),
    req.done.length >= BOARD_STEPS ? "That's all for this turn: call end_turn." : "Do what they said and nothing more, a call at a time, then end_turn with what came of it.",
  ].join("\n\n");
}

const doneLine = (d: BoardDone, i: number) => `${i + 1}. ${d.act}: «${d.narration}»\n   ${d.refused ? `The board refused it: ${d.refused}` : `The board: ${d.moments.map(m => [m.caption, ...m.lines].join(" · ")).join(" / ") || "(nothing happened)"}`}`;

/** A tool call held to the board: wrong ones are answered in the loop (InvalidToolArguments) for the GM to put right. */
export function checkBoardCall(req: Pick<BoardTurnRequest, "fight" | "options" | "movement" | "done">, name: string, args: Record<string, unknown>): void {
  const narration = typeof args.narration === "string" ? args.narration.trim() : "";
  if (name !== "end_turn" && req.done.length >= BOARD_STEPS) throw new InvalidToolArguments("That's all for this turn: call end_turn.");
  if (name === "act") {
    const id = String(args.id ?? "").trim();
    if (!req.options.some(o => o.id === id)) throw new InvalidToolArguments(`act's id is one the board lists now: ${req.options.map(o => o.id).filter(i => !i.startsWith("walk@")).slice(0, 24).join(", ")}.`);
    if (!narration) throw new InvalidToolArguments("act needs its narration.");
    return;
  }
  if (name === "move_towards") {
    if (typeof args.target !== "string" || !args.target.trim()) throw new InvalidToolArguments("move_towards needs a target: an id from the fight.");
    if (req.movement <= 0) throw new InvalidToolArguments("They have no movement left this turn: act, or end_turn.");
    if (!narration) throw new InvalidToolArguments("move_towards needs its narration.");
    return;
  }
  if (name === "end_turn" && !narration) throw new InvalidToolArguments("end_turn needs its narration.");
}

function moveOf(name: string, args: Record<string, unknown>): BoardMove {
  const narration = String(args.narration ?? "").trim();
  if (name === "act") return { kind: "act", id: String(args.id).trim(), narration };
  if (name === "move_towards") return { kind: "toward", target: String(args.target).trim(), ...(args.away === true ? { away: true } : {}), narration };
  return { kind: "end_turn", narration };
}

/** The narration as the screen has it: names the player hasn't heard swapped for what they'd call them, and who says each line. */
function spoken(scene: Scene, view: TurnView, text: string, byKey: (markup: Markup) => Markup): Reply {
  const known = asKnown(text.trim(), unheardOf(scene, view));
  const { text: words, marked } = readReply(scene, view, known.text);
  return { speaker: "gm", kind: "narration", text: words, ...(marked.speech.length ? { markup: byKey({ speech: marked.speech }) } : {}) };
}
