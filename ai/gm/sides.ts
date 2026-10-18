// New (docs/combat-gm.md): the sides a fight's people take as it breaks out, before it's set out on
// the board. The GM (the mouthpiece's: the user's two-part prompt, the scene's prep and its people)
// picks, for each of the people here the reply left with no side, with the player, against them,
// or running from it, in one tool call held to the list (pick_sides); its narration is what the
// table sees as they take them, shown under the reply that rolled for initiative.

import { SIDE_PICKS, type SidePick } from "../../shared/gm/fight.ts";
import type { Markup } from "../../shared/markup.ts";
import type { FightNewcomer, Reply, SidesRequest } from "../../shared/protocol/ai.ts";
import type { Scene } from "../../shared/scene/types.ts";
import type { CallContext, Message } from "../llm/openrouter.ts";
import { InvalidToolArguments, runTools, type ToolDef } from "../llm/tools.ts";
import { prompt } from "../prompts/index.ts";
import { sceneEntries } from "./brief.ts";
import { charactersOf, gmText, mouthpieceInput, prepOf, SPOKEN_RULES } from "./two-part.ts";
import { asKnown, unheardOf } from "./unheard.ts";
import { readReply } from "./voice.ts";
import type { TurnView } from "./view.ts";

export const PICK_SIDES: ToolDef = {
  name: "pick_sides",
  description: "The side each of the people listed takes in the fight that's breaking out, or that they run from it, by who they are. Everyone listed gets one, in one call.",
  parameters: {
    type: "object", additionalProperties: false, required: ["sides", "narration"],
    properties: {
      sides: {
        type: "array", description: "One for each of the people listed, by their id.",
        items: {
          type: "object", additionalProperties: false, required: ["id", "side"],
          properties: {
            id: { type: "string" },
            side: { type: "string", enum: [...SIDE_PICKS], description: "with_player: they fight beside the player. against_player: they fight the player. flee: they run from it (off out of the place)." },
          },
        },
      },
      narration: { type: "string", description: "What the table sees as they take their sides: who squares up beside whom, who backs off, who bolts for the door. A sentence or two, in the scene's voice; nobody's blow yet." },
    },
  },
};

/** The sides' instructions: the mouthpiece's prompt with the scene's prep and people, how sides are taken, then who says each line and what the player sees. */
export function sidesInstructions(scene: Scene, view: TurnView): string {
  return [prompt("two-part-gm", { tone: prompt("tone-comic"), beats: prepOf(scene, view), characters: charactersOf(scene, view) }), prompt("fight-sides"), SPOKEN_RULES()].join("\n\n");
}

/** The sides' input: the scene's history as the mouthpiece reads it, the reply that rolled for initiative, then who's to pick. */
export function sidesInput(scene: Scene, view: TurnView, ask: SidesRequest["sides"]): Message[] {
  const input = mouthpieceInput(scene, view, [], { fight: true });
  const now = sceneEntries(view).filter(e => e.turn === view.turn && e.kind !== "player" && e.kind !== "system");
  if (view.turn > 0 && now.length) input.push({ role: "assistant", content: gmText(scene, view, now) });
  input.push({ role: "system", content: sidesNote(scene, ask) });
  return input;
}

/** Who has no side yet, and who's on which already. */
export function sidesNote(scene: Scene, ask: SidesRequest["sides"]): string {
  const name = (id: string) => (id === "player" ? "the player" : `${scene.cast.find(c => c.id === id)?.name ?? scene.cast.flatMap(c => c.members ?? []).find(m => m.id === id)?.name ?? id} [${id}]`);
  const already = [
    ...(ask.against.length ? [`Against the player: ${ask.against.map(name).join(", ")}.`] : []),
    ...(ask.with.length ? [`Beside the player: ${ask.with.map(name).join(", ")}.`] : []),
  ];
  return `## A fight is breaking out${ask.why ? `: ${ask.why}` : ""}
${already.join(" ")}
These people have no side in it yet. Call pick_sides with one for each: with_player, against_player or flee, as who they are would.
${ask.pending.map(newcomerLine).join("\n")}`;
}

function newcomerLine(p: FightNewcomer): string {
  const who = p.called ? `${p.called} (${p.name}: the player hasn't heard the name)` : p.name;
  const coming = p.coming ? `, not here yet: they come in after ${p.coming.after} round${p.coming.after === 1 ? "" : "s"} of fighting (${p.coming.why.trim().replace(/\.$/, "")})` : "";
  return `- ${who} [${p.id}]${coming}${p.about ? `. ${p.about}` : ""}`;
}

/** How the sides are asked: the request's calls, and the game's keys for who says each line. */
export interface SidesHow { calls: CallContext; byKey(markup: Markup): Markup }

/**
 * Everyone's side: one pick_sides call, each wrong call answered in the loop so the GM can put it
 * right (someone missing, a side that isn't one). A reply in words alone has them all run.
 */
export async function pickSides(scene: Scene, view: TurnView, ask: SidesRequest["sides"], how: SidesHow): Promise<{ sides: Record<string, SidePick>; entries: Reply[]; costUsd: number }> {
  const result = await runTools({
    operation: "fight.sides", instructions: sidesInstructions(scene, view), input: sidesInput(scene, view, ask), tools: [PICK_SIDES],
    effort: "low", maxTurns: 3, calls: how.calls, roundMs: 20_000, deadlineMs: 30_000, parallel: false, stop: () => true,
  }, async (name, args) => { checkSides(ask, name, args); return { ok: true }; });
  const args = result.stopped?.args;
  const sides: Record<string, SidePick> = args
    ? Object.fromEntries((args.sides as Array<{ id: string; side: SidePick }>).map(x => [x.id, x.side]))
    : Object.fromEntries(ask.pending.map(p => [p.id, "flee" as const]));
  const narration = String(args?.narration ?? result.text ?? "").trim();
  return { sides, entries: narration ? [spoken(scene, view, narration, how.byKey)] : [], costUsd: result.costUsd };
}

/** pick_sides held to who has no side yet: each of them once, each a side or flee. */
export function checkSides(ask: SidesRequest["sides"], name: string, args: Record<string, unknown>): void {
  const ids = ask.pending.map(p => p.id);
  if (name !== "pick_sides") throw new InvalidToolArguments(`Call pick_sides for ${ids.join(", ")}.`);
  if (typeof args.narration !== "string" || !args.narration.trim()) throw new InvalidToolArguments("pick_sides needs its narration.");
  const sides = Array.isArray(args.sides) ? args.sides as Array<{ id?: unknown; side?: unknown }> : [];
  const wrong = sides.filter(x => !SIDE_PICKS.includes(x.side as SidePick)).map(x => String(x.id));
  if (wrong.length) throw new InvalidToolArguments(`Each side is one of ${SIDE_PICKS.join(", ")} (${wrong.join(", ")}).`);
  const named = new Set(sides.map(x => String(x.id)));
  const missing = ids.filter(id => !named.has(id));
  if (missing.length) throw new InvalidToolArguments(`pick_sides needs one for each: ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} none.`);
}

/** The narration as the screen has it: names the player hasn't heard swapped for what they'd call them, and who says each line. */
function spoken(scene: Scene, view: TurnView, text: string, byKey: (markup: Markup) => Markup): Reply {
  const known = asKnown(text.trim(), unheardOf(scene, view));
  const { text: words, marked } = readReply(scene, view, known.text);
  return { speaker: "gm", kind: "narration", text: words, ...(marked.speech.length ? { markup: byKey({ speech: marked.speech }) } : {}) };
}
