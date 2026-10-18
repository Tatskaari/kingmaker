// New (docs/combat-gm.md): the GM in a fight in the conversation. Once the mouthpiece has rolled for
// initiative, the scene goes round everyone in initiative order, and each turn is the GM's to play
// and narrate through three tools: perform_action (an act the rules resolve: the loop stops on it,
// the simulation rolls it, and the GM is asked again with what came of it), end_turn and end_combat.
// The GM is the mouthpiece's (the user's two-part prompt, the scene's prep and its people, who says
// each line, what the player sees), with the fight's own instructions (ai/prompts/combat-gm.md) in
// place of the reply format, and the fight as it stands after the scene's history.

import { ACTION_VERBS, ACTS_A_TURN, COMBAT_OUTCOMES, COMBAT_VERBS, SIDE_PICKS, type CombatOutcome, type CombatVerb, type SidePick } from "../../shared/gm/combat.ts";
import type { Markup } from "../../shared/markup.ts";
import type { CombatAction, CombatDone, CombatFighter, CombatMove, CombatView, Reply } from "../../shared/protocol/ai.ts";
import { SKILLS, type Scene, type Skill } from "../../shared/scene/types.ts";
import type { CallContext, Message } from "../llm/openrouter.ts";
import { InvalidToolArguments, runTools, type ToolDef } from "../llm/tools.ts";
import { prompt } from "../prompts/index.ts";
import { sceneEntries } from "./brief.ts";
import { charactersOf, gmText, mouthpieceInput, prepOf, SPOKEN_RULES } from "./two-part.ts";
import { asKnown, unheardOf } from "./unheard.ts";
import { readReply } from "./voice.ts";
import type { TurnView } from "./view.ts";

const NARRATION = { type: "string" };

export const PERFORM_ACTION: ToolDef = {
  name: "perform_action",
  description: "Someone does something on their turn that the rules decide (or the fight needs to know about). The game rolls it at once and answers with the dice and what came of it; then go on, with another perform_action or end_turn. One call at a time.",
  parameters: {
    type: "object", additionalProperties: false, required: ["action", "narration"],
    properties: {
      action: {
        type: "string", enum: COMBAT_VERBS.filter(v => v !== "move"),
        description: "attack: a blow or a shot with a weapon (the cast use their own; a melee blow needs them within 5 ft: move_towards first). cast: a spell (the player's, by its id). grapple, shove: hands on someone within 5 ft (the player's). feature: a class feature (the player's, by its id). check: a stunt the dice decide (the player's: skill and dc). stand: getting up off the ground when they're prone (half their move; a move from the ground does it first). flee: running from the fight (they leave it). surrender: giving up (they're out of it): whoever gives up calls it, so the rules know. other: something the player does that's none of these (picking something up, helping someone); on anyone else's turn, what they say, how they hold their ground or how they look is end_turn's narration.",
      },
      target: { type: "string", description: "Who it's aimed at: an id from the fight (\"player\" for the player character), or a thing's id; omit when it's at nobody." },
      spell: { type: "string", description: "cast: the spell's id, as the player's sheet has it." },
      weapon: { type: "string", description: "attack (the player's): the weapon's id, when it isn't their main one; \"improvised\" for a stool, a bottle, a stone." },
      feature: { type: "string", description: "feature: the feature's id, as the player's sheet has it." },
      skill: { type: "string", enum: [...SKILLS], description: "check: the skill." },
      dc: { type: "integer", description: "check: the DC (10 easy, 13 moderate, 15 hard, 18 very hard)." },
      narration: { ...NARRATION, description: "What the table hears as they make the attempt, up to the moment the dice decide it: the swing, the aim, the words of the spell ('you swing at his gut', never 'you punch him in the gut'). Never whether it works, and never the player's own words quoted back. One or two sentences." },
    },
  },
};

export const MOVE_TOWARDS: ToolDef = {
  name: "move_towards",
  description: "Someone moves on their turn, up to their speed: towards someone or something (they stop beside them, if they can get there), or with away: true, back from them. The game moves them in the place and answers with where they've got to. Once a turn; a second move is a dash, which takes their action.",
  parameters: {
    type: "object", additionalProperties: false, required: ["target", "narration"],
    properties: {
      target: { type: "string", description: "Whom or what they move towards (or away from): an id from the fight (\"player\" for the player character), or a thing's or a place's id from the world." },
      away: { type: "boolean", description: "true: backing off from the target instead." },
      narration: { ...NARRATION, description: "How they move, in a sentence: the dash across the floor, the step back, the shove through the crowd." },
    },
  },
};

export const END_TURN: ToolDef = {
  name: "end_turn",
  description: "This person's turn is over. The next in the initiative order goes next.",
  parameters: {
    type: "object", additionalProperties: false, required: ["narration"],
    properties: { narration: { ...NARRATION, description: "What came of their turn, as the rules decided it (each hit, miss, wound and fall told in the fiction), and anything said. A couple of sentences; nothing of the next person's turn." } },
  },
};

export const END_COMBAT: ToolDef = {
  name: "end_combat",
  description: "The fight is over: the rules say one side can't fight on, or it stops in the fiction (a surrender, the player getting away, everyone backing off, someone talking it down). The scene goes back to conversation.",
  parameters: {
    type: "object", additionalProperties: false, required: ["outcome", "narration"],
    properties: {
      outcome: { type: "string", enum: [...COMBAT_OUTCOMES], description: "won: the player's side beat them. lost: the player is down or their side beaten. yielded: the other side gave up. fled: the player got away. stopped: both sides stopped." },
      narration: { ...NARRATION, description: "How it ends: what came of this last turn, who's standing, who's down, who ran or gave up, and where that leaves everyone. Then stop, for the player." },
    },
  },
};

export const PICK_SIDES: ToolDef = {
  name: "pick_sides",
  description: "Before the next turn: the side each of the people listed takes in the fight, or that they run from it, by who they are. Everyone listed gets one, in one call.",
  parameters: {
    type: "object", additionalProperties: false, required: ["sides", "narration"],
    properties: {
      sides: {
        type: "array", description: "One for each of the people listed, by their id.",
        items: {
          type: "object", additionalProperties: false, required: ["id", "side"],
          properties: {
            id: { type: "string" },
            side: { type: "string", enum: [...SIDE_PICKS], description: "with_player: they fight beside the player. against_player: they fight the player. flee: they run from it (gone from the scene)." },
          },
        },
      },
      narration: { ...NARRATION, description: "What the table sees as they take their sides: the newcomers coming in, who squares up beside whom, who bolts. A sentence or two; nobody's turn yet." },
    },
  },
};

/** The fight's instructions: the mouthpiece's prompt with the scene's prep and people, the fight's, then who says each line and what the player sees. */
export function combatInstructions(scene: Scene, view: TurnView): string {
  return [prompt("two-part-gm", { tone: prompt("tone-comic"), beats: prepOf(scene, view), characters: charactersOf(scene, view) }), prompt("combat-gm"), SPOKEN_RULES()].join("\n\n");
}

/**
 * The fight's input: the scene's history as the mouthpiece reads it, what's been narrated in this
 * turn so far (the fight's earlier turns since the player's line), then the fight as it stands.
 */
export function combatInput(scene: Scene, view: TurnView, combat: CombatView): Message[] {
  const input = mouthpieceInput(scene, view, [], { fight: true });
  const now = sceneEntries(view).filter(e => e.turn === view.turn && e.kind !== "player" && e.kind !== "system");
  if (view.turn > 0 && now.length) input.push({ role: "assistant", content: gmText(scene, view, now) });
  input.push({ role: "system", content: fightNote(view, combat) });
  return input;
}

/** The fight as it stands, for the GM: the round, everyone in order and how they stand, whose turn it is and what they can do, what they've done so far, or that it's over. */
export function fightNote(view: TurnView, combat: CombatView): string {
  const whose = fighterOf(combat, combat.whose);
  const parts = [
    `## The fight: round ${combat.state.round}${combat.state.why ? ` (${combat.state.why})` : ""}`,
    `In initiative order (it holds every round):\n${combat.fighters.map(f => fighterLine(f, f.id === combat.whose && !combat.over, combat.fighters)).join("\n")}`,
    ...[outOfIt(view, combat)].filter((n): n is string => !!n),
    combat.pending?.length ? sidesNote(combat) : combat.over ? overNote(combat) : turnNote(view, combat, whose),
    ...(combat.done.length ? [`## This turn so far\n${combat.done.map(doneLine).join("\n")}`] : []),
  ];
  return parts.join("\n\n");
}

function fighterLine(f: CombatFighter, now: boolean, all: CombatFighter[]): string {
  const name = f.id === "player" ? "You, the player character (\"you\" in your narration, never their name)" : f.called ? `${f.called} (${f.name}: the player hasn't heard the name, so they're ${f.called} in your narration until someone says it)` : f.name;
  const side = f.id === "player" ? "" : f.side === "party" ? ", with the player" : ", against the player";
  const state = f.out ? (f.out === "fled" ? "fled: out of the fight" : "gave up: out of the fight") : f.down ? "down: 0 hit points, out cold" : `${f.hurt}, HP ${f.hp}/${f.max}, AC ${f.ac}${f.conditions?.length ? `, ${f.conditions.join(", ")}${f.conditions.includes("prone") ? " (on the ground: getting up, stand, takes half their move)" : ""}` : ""}`;
  const reach = f.out ? "" : `; ${f.reach.melee ? "melee, reach 5 ft" : `ranged, ${f.reach.feet} ft`}, moves ${f.reach.speed} ft`;
  const apart = f.out ? "" : Object.entries(f.feet).filter(([id]) => all.some(o => o.id === id && !o.out)).map(([id, ft]) => `${nameIn(all, id)} ${ft <= 5 ? "beside them" : `${ft} ft`}`).join(", ");
  return `- ${name} [${f.id}]${side}, initiative ${f.initiative}: ${state}${reach}${apart ? `. From: ${apart}` : ""}${now ? "  ◀ their turn now" : ""}`;
}

const nameIn = (all: CombatFighter[], id: string) => (id === "player" ? "you" : all.find(f => f.id === id)?.called ?? all.find(f => f.id === id)?.name ?? id);

function turnNote(view: TurnView, combat: CombatView, whose: CombatFighter): string {
  const used = actionUsed(combat);
  const limit = combat.done.length >= ACTS_A_TURN ? "\nThat's all for this turn: call end_turn." : used ? `\nTheir action is used: anything more this turn is a move${whose.id === "player" ? " or something small (other)" : ""}, or call end_turn with what came of it.` : "";
  if (whose.id === "player") {
    const line = sceneEntries(view).filter(e => e.turn === view.turn && e.kind === "player").map(e => e.text).pop() ?? "";
    return `## It's the player's turn\nThey said: «${line}»\nDo what they said and nothing more: a move_towards for where they go and a perform_action for each thing they do that the rules decide, as their character can (${sheetLine(view)}), then end_turn. What they only say needs no action: answer it in end_turn.${limit}`;
  }
  const side = whose.side === "party" ? "with the player" : "against the player";
  return `## It's ${whose.name}'s turn [${whose.id}], ${side}\nPlay it as ${whose.name} would, from who they are and how the fight is going for them now: move_towards someone if they need to close in (a melee blow needs them beside their target) or back off, a perform_action for what they do (attack with their weapon; flee if they run; surrender if they give up, so the rules take them out of it), then end_turn, whose narration has what came of it and anything they say. They may talk, back off, run or give up instead of attacking.${limit}`;
}

/**
 * Who ran from the fight: gone from the scene, or (one the story needs: the companion, a holder of what
 * the player still needs) keeping clear of it nearby, here when it's over, which the narration keeps
 * to (the smoke test: Kell put to flight, still talking two lines on).
 */
function outOfIt(view: TurnView, combat: CombatView): string | undefined {
  const fled = combat.state.fled ?? [];
  if (!fled.length) return undefined;
  const e = (id: string) => view.world?.entities[id];
  const clear = fled.filter(id => e(id) && !e(id)!.states.includes("gone"));
  const away = fled.filter(id => !clear.includes(id));
  const name = (id: string) => `${e(id)?.name ?? id} [${id}]`;
  return `Out of the fight: ${[...away.map(id => `${name(id)} ran off and is gone from here`), ...clear.map(id => `${name(id)} is keeping clear of it, close by (backing off, hiding, never leaving: they're here when it's over)`)].join("; ")}.`;
}

/** Who has no side yet: the people the reply didn't put on one as the fight broke out, and whoever has just arrived. */
function sidesNote(combat: CombatView): string {
  const who = combat.pending!.map(p => `- ${p.called ? `${p.called} (${p.name}: the player hasn't heard the name)` : p.name} [${p.id}]${p.arriving ? `, just arrived: ${p.arriving.trim().replace(/\.$/, "")}` : ""}${p.about ? `. ${p.about}` : ""}`);
  return `## Before the next turn: who's on which side
These people are here and have no side in the fight yet. Call pick_sides with one for each: with_player, against_player or flee, as who they are would (what they want and fear, whom they're loyal to, what they never do, how the fight looks to them right now). Someone whose card says they won't stand against someone, or fight but for their own, doesn't, whatever the player has said. Its narration shows them taking it.
${who.join("\n")}`;
}

function overNote(combat: CombatView): string {
  return `## The fight is over\nBy the rules: ${combat.over!.why}. Call end_combat (outcome ${combat.over!.outcome}) and narrate how it ends, including what came of the last turn.`;
}

const doneLine = (d: CombatDone, i: number) => `${i + 1}. ${d.act.action === "move" ? `move_towards ${d.act.target}${d.act.away ? " (away)" : ""}` : `perform_action ${d.act.action}${d.act.target ? ` at ${d.act.target}` : ""}`}${d.act.spell ? ` (${d.act.spell})` : ""}: «${d.act.narration}»\n   ${d.refused ? "Refused by the rules" : "The rules"}: ${[...d.lines.map(l => `🎲 ${l}`), d.result].filter(Boolean).join(" · ")}`;

/** What the player's character can do, from their sheet. */
function sheetLine(view: TurnView): string {
  const r = view.rules;
  const list = (name: string, xs: Array<{ id: string; name: string }> | undefined) => (xs?.length ? `${name}: ${xs.map(x => `${x.name} [${x.id}]`).join(", ")}` : "");
  const spells = r?.spells?.map(s => (s.bonus ? { ...s, name: `${s.name} (a bonus action, cast before the blow it goes with)` } : s));
  return [list("spells ready", spells), list("weapons", r?.weapons), list("features", r?.features)].filter(Boolean).join("; ") || "no spells, weapons or features on their sheet";
}

const fighterOf = (combat: CombatView, id: string): CombatFighter => {
  const f = combat.fighters.find(x => x.id === id) ?? combat.fighters[0]!;
  return f.called ? { ...f, name: f.called } : f;
};

/** How the combat GM is asked: the request's calls, and the game's keys for who says each line. */
export interface CombatHow { calls: CallContext; byKey(markup: Markup): Markup }

/**
 * The GM's next move in the fight: one tool call, held to the fight (an action of a verb the turn
 * can still take, by someone who can take it; nothing but end_combat once it's over), each wrong
 * call answered in the loop so the GM can put it right. A reply in words alone is its turn's end
 * (or the fight's, once it's over).
 */
export async function combatMove(scene: Scene, view: TurnView, combat: CombatView, how: CombatHow): Promise<{ move: CombatMove; entries: Reply[]; costUsd: number }> {
  const tools = combat.pending?.length ? [PICK_SIDES] : combat.over ? [END_COMBAT] : [PERFORM_ACTION, MOVE_TOWARDS, END_TURN, END_COMBAT];
  const bonus = bonusSpells(view);
  const result = await runTools({
    operation: combat.pending?.length ? "combat.sides" : combat.whose === "player" ? "combat.player" : "combat.turn", instructions: combatInstructions(scene, view), input: combatInput(scene, view, combat), tools,
    effort: "low", maxTurns: 4, calls: how.calls, roundMs: 20_000, deadlineMs: 45_000, parallel: false, stop: () => true,
  }, async (name, args) => { checkCall(combat, name, asSpell(view, args), bonus); return { ok: true }; });
  const asked = result.stopped ? moveOf(result.stopped.name, asSpell(view, result.stopped.args)) : wordsAlone(combat, result.text);
  // Something small after the turn's action is what came of the turn, told early (smoke2-1018: a miss told by other, then again by end_turn): the turn ends on it.
  const move: CombatMove = asked.kind === "act" && asked.act.action === "other" && actionUsed(combat, bonus) ? { kind: "end_turn", narration: asked.act.narration } : asked;
  const narration = "narration" in move ? move.narration : move.act.narration;
  return { move, entries: narration.trim() ? [spoken(scene, view, narration, how.byKey)] : [], costUsd: result.costUsd };
}

/** A tool call held to the fight: wrong ones are answered in the loop (InvalidToolArguments) for the GM to put right. */
export function checkCall(combat: CombatView, name: string, args: Record<string, unknown>, bonus: ReadonlySet<string> = new Set()): void {
  const narration = typeof args.narration === "string" ? args.narration.trim() : "";
  if (!narration) throw new InvalidToolArguments(`${name} needs its narration.`);
  if (combat.pending?.length) return checkSides(combat, name, args);
  if (combat.over && name !== "end_combat") throw new InvalidToolArguments(`The fight is over (${combat.over.why}): call end_combat.`);
  if (name === "end_combat" && !COMBAT_OUTCOMES.includes(args.outcome as CombatOutcome)) throw new InvalidToolArguments(`end_combat's outcome is one of ${COMBAT_OUTCOMES.join(", ")}.`);
  if (name === "move_towards") return checkMove(combat, args);
  if (name !== "perform_action") return;
  const action = args.action as CombatVerb;
  if (!COMBAT_VERBS.includes(action)) throw new InvalidToolArguments(`perform_action's action is one of ${COMBAT_VERBS.join(", ")}.`);
  const whose = fighterOf(combat, combat.whose);
  if (combat.done.length >= ACTS_A_TURN) throw new InvalidToolArguments("That's all for this turn: call end_turn.");
  const quick = action === "cast" && bonus.has(String(args.spell ?? ""));
  if (quick && bonusUsed(combat, bonus)) throw new InvalidToolArguments(`${whose.name} has cast a bonus-action spell this turn already.`);
  if (ACTION_VERBS.has(action) && !quick && actionUsed(combat, bonus)) throw new InvalidToolArguments(`${whose.name} has used their action this turn: a move${whose.id === "player" ? " or something small (other)" : ""}, or end_turn.`);
  if (whose.id !== "player" && ["cast", "grapple", "shove", "feature", "check"].includes(action)) throw new InvalidToolArguments(`${whose.name} can attack with their weapon, move, flee or surrender: the rules don't have ${action} for them.`);
  // smoke2-1018: Kell's turn told as other, other, end_turn (her surrender among them, so the rules never knew).
  if (whose.id !== "player" && action === "other") throw new InvalidToolArguments(`What ${whose.name} says, how they hold their ground or how they look is end_turn's narration: call end_turn with it. If they give up, perform_action surrender; if they run, flee.`);
  if (["attack", "grapple", "shove"].includes(action) && typeof args.target !== "string") throw new InvalidToolArguments(`${action} needs a target: an id from the fight.`);
  if (action === "attack" && whose.id !== "player" && !combat.fighters.some(f => f.id === args.target)) throw new InvalidToolArguments(`${whose.name}'s attack is at someone in the fight: ${combat.fighters.filter(f => f.id !== whose.id).map(f => f.id).join(", ")}.`);
  if (action === "cast" && typeof args.spell !== "string") throw new InvalidToolArguments("cast needs the spell's id.");
  if (action === "feature" && typeof args.feature !== "string") throw new InvalidToolArguments("feature needs the feature's id.");
  if (action === "check" && (!SKILLS.includes(args.skill as Skill) || !Number.isInteger(args.dc))) throw new InvalidToolArguments("check needs a skill and an integer dc.");
}

/** pick_sides held to who has no side yet: each of them once, each a side or flee. */
function checkSides(combat: CombatView, name: string, args: Record<string, unknown>): void {
  const ids = combat.pending!.map(p => p.id);
  if (name !== "pick_sides") throw new InvalidToolArguments(`First, pick_sides for ${ids.join(", ")}.`);
  const sides = Array.isArray(args.sides) ? args.sides as Array<{ id?: unknown; side?: unknown }> : [];
  const wrong = sides.filter(x => !SIDE_PICKS.includes(x.side as SidePick)).map(x => String(x.id));
  if (wrong.length) throw new InvalidToolArguments(`Each side is one of ${SIDE_PICKS.join(", ")} (${wrong.join(", ")}).`);
  const named = new Set(sides.map(x => String(x.id)));
  const missing = ids.filter(id => !named.has(id));
  if (missing.length) throw new InvalidToolArguments(`pick_sides needs one for each: ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} none.`);
}

/** Whether this turn has used its action already: an action verb (a bonus-action spell isn't one), or a second move (a dash). */
function actionUsed(combat: CombatView, bonus: ReadonlySet<string> = new Set()): boolean {
  const done = combat.done.filter(d => !d.refused);
  return done.some(d => ACTION_VERBS.has(d.act.action) && !(d.act.action === "cast" && bonus.has(d.act.spell ?? ""))) || done.filter(d => d.act.action === "move").length > 1;
}

/** Whether this turn has cast its bonus-action spell. */
const bonusUsed = (combat: CombatView, bonus: ReadonlySet<string>) => combat.done.some(d => !d.refused && d.act.action === "cast" && bonus.has(d.act.spell ?? ""));

/** The player's spells cast as a bonus action (a smite), by id. */
const bonusSpells = (view: TurnView) => new Set((view.rules?.spells ?? []).filter(s => s.bonus).map(s => s.id));

/**
 * A feature the player's sheet has as a spell (QA round hobo1-1018: a paladin's Divine Smite called
 * as a feature, which the rules haven't got, twice, "the smite does not answer"): cast as that spell.
 */
function asSpell(view: TurnView, args: Record<string, unknown>): Record<string, unknown> {
  if (args.action !== "feature" || typeof args.feature !== "string") return args;
  const said = args.feature.trim().toLowerCase();
  const spell = (view.rules?.spells ?? []).find(s => s.id === said || s.name.toLowerCase() === said.replace(/-/g, " "));
  if (!spell) return args;
  const { feature: _f, ...rest } = args;
  return { ...rest, action: "cast", spell: spell.id };
}

/** move_towards held to the turn: a target, at most two moves (the second a dash, the turn's action). */
function checkMove(combat: CombatView, args: Record<string, unknown>): void {
  const whose = fighterOf(combat, combat.whose);
  if (typeof args.target !== "string" || !args.target.trim()) throw new InvalidToolArguments("move_towards needs a target: an id from the fight or the world.");
  if (combat.done.length >= ACTS_A_TURN) throw new InvalidToolArguments("That's all for this turn: call end_turn.");
  const moves = combat.done.filter(d => !d.refused && d.act.action === "move").length;
  if (moves >= 2 || (moves === 1 && actionUsed(combat))) throw new InvalidToolArguments(`${whose.name} has moved as far as they can this turn: call end_turn.`);
  // hobo2-1018: a second move to the man he was already beside was a dash, which spent the swing.
  const to = String(args.target).trim();
  const feet = combat.fighters.find(f => f.id === combat.whose)?.feet[to];
  if (!args.away && feet !== undefined && feet <= 7) throw new InvalidToolArguments(`${whose.name} is beside ${combat.fighters.find(f => f.id === to)?.name ?? to} already: no need to move. Go on with what they do.`);
}

/** A held call as the move it is. */
function moveOf(name: string, args: Record<string, unknown>): CombatMove {
  const narration = String(args.narration ?? "").trim();
  if (name === "end_turn") return { kind: "end_turn", narration };
  if (name === "end_combat") return { kind: "end_combat", outcome: args.outcome as CombatOutcome, narration };
  if (name === "pick_sides") return { kind: "sides", sides: Object.fromEntries((args.sides as Array<{ id: string; side: SidePick }>).map(x => [x.id, x.side])), narration };
  if (name === "move_towards") return { kind: "act", act: { action: "move", target: String(args.target).trim(), ...(args.away === true ? { away: true } : {}), narration } };
  const text = (k: string) => (typeof args[k] === "string" && (args[k] as string).trim() ? { [k]: (args[k] as string).trim() } : {});
  const act: CombatAction = {
    action: args.action as CombatVerb, narration, ...text("target"), ...text("spell"), ...text("weapon"), ...text("feature"),
    ...(args.action === "check" ? { skill: args.skill as Skill, dc: Number(args.dc) } : {}),
  };
  return { kind: "act", act };
}

/** A reply in words with no tool: the turn's end, or the fight's once it's over. Nothing at all is a failure. */
function wordsAlone(combat: CombatView, text: string): CombatMove {
  if (!text.trim()) throw new Error("combat: the GM made no move");
  if (combat.pending?.length) return { kind: "sides", sides: Object.fromEntries(combat.pending.map(p => [p.id, "flee" as const])), narration: text.trim() };
  return combat.over ? { kind: "end_combat", outcome: combat.over.outcome, narration: text.trim() } : { kind: "end_turn", narration: text.trim() };
}

/** The narration as the screen has it: names the player hasn't heard swapped for what they'd call them, and who says each line. */
function spoken(scene: Scene, view: TurnView, text: string, byKey: (markup: Markup) => Markup): Reply {
  const known = asKnown(text.trim(), unheardOf(scene, view));
  const { text: words, marked } = readReply(scene, view, known.text);
  return { speaker: "gm", kind: "narration", text: words, ...(marked.speech.length ? { markup: byKey({ speech: marked.speech }) } : {}) };
}
