import { respondJson, type Effort } from "../llm/openrouter.ts";
import { applyOps, worldView, type SceneWorld, type WorldOp } from "./scene-world.ts";

/**
 * The stage manager: after each reply, keep the world in step with what the story established
 * (someone moved, picked something up, hid, arrived, left; a door opened; a note worth keeping).
 * It writes operations in the world language, with ids the schema enforces; the world applies
 * them, resolving "near" and distances spatially. Damage and fire from the rules are already in:
 * it records knock-on effects only. (docs/research/gm-world-interface.md has the eval behind it.)
 */

export const WORLD_LANGUAGE = `Operations. Every operation has every field; leave the ones it doesn't use as "", 0 or []. "what" and "to" are always ids from the world (in brackets), never names.
- move: "what" (someone or something) goes to an area ("to" = an area id), or to beside someone or something ("to" = their id).
- place: "what" goes near, behind, beside, under, on or in something ("to", "how"). "behind" also notes it on both. Also distances: "how": "away" puts "what" "feet" feet from "to" (on the far side from where it was, or wherever there's room), "toward" moves "what" "feet" feet closer to "to".
- give: "what" (a thing) is now held by someone, or put in a container ("to"), wherever it was before (in someone's hands, inside their things, on the floor): the world finds it. "quantity" for part of a stack (two of the pennies), 0 for all of it.
- drop: "what" is put down ("to": near something, or "" where its holder stands); "quantity" as for give.
- create: someone or something new the story has just brought in: "name", "kind" (person, creature, object, item), "to" (an area, someone or something to be near; for an item, a person "to" means it's in their hands), "text" (who or what they are).
- state: "what" gains ("add") or loses ("remove") states: burning, wet, broken, open, closed, locked, barred, overturned, hidden, prone, unconscious, asleep, lit, dark, slick, poisoned, tied-up, sitting, crouching...
- note: something worth remembering about "what" ("text"), written about it alone (also noted on "to" only when it's true of both).
- forget: "what"'s notes stop being true (it moved on, stopped doing it): clears those containing "text", or all of them when "text" is "".
- remove: someone or something leaves the scene ("text": where to).
- destroy: "what" is wrecked ("text": what's left of it).
The world's physics (use these for fire, water, spills and wounds rather than writing states by hand: they keep the world consistent):
- ignite: "what" is set alight (the physics decides whether it catches: metal and stone only scorch, wet things won't).
- douse: water thrown over "what" (it goes out, gets wet and scorched, and stands in a puddle).
- spill: a liquid ("name": water, oil, spirits, ale, blood or grease) is spilled at "to" (someone or something), "feet" its size.
- chill: "what" is frozen by cold (water to ice).
- bleed: "what" (someone) is badly wounded or killed: blood on the ground ("how": "light" for a lesser wound).
- break: "what" is broken (a container spills what it held).`;

const INSTRUCTIONS = [
  "You keep the world model of a roleplaying scene in step with the story. After each exchange, write the operations that make the model show what the GM's reply has established. The GM reads the model before every reply, the map draws it, and the rules resolve spells and blows from it (who a Fireball catches depends on where everyone stands), so above all it has to be right about where people are, who holds what, what's open, shut, burning or broken, and who has come or gone.",
  "- The reply is what happened. Where the model disagrees with it (it may be out of date), the reply wins: put people where the reply has them. Only what has happened, though: not plans, offers, threats, glances or where people's attention goes.",
  "- The rules have already applied their dice (listed, if any): don't repeat or undo them, but do record knock-on effects the reply narrates (someone fleeing the flames, a fire put out with a bucket).",
  "- People are often described rather than named (\"the pot-boy\", \"the big man\"): see who's who, and never create someone who is already in the world.",
  "- Create only someone who could act, or something someone could pick up, use, hide behind or be hurt by, that the story has just brought in. Never scenery: birds, leaves, smells, crowds or windows outside the place.",
  "- Prefer a move or a state to a note. A note is for something the model can't otherwise show that will matter later (who is hiding where, what is under what), written about one entity. When something someone was doing has stopped (they stopped throwing stones, got down off the wall), forget the note that says they're doing it.",
  "- Money and things changing hands always count: paying, tipping, handing over, taking, putting something down. Record them as give (or drop) with the quantity, from whoever had them (the player pays from the player's purse).",
  "- If the player character has left this place altogether, for somewhere this world doesn't contain (another building, across town, out of sight down the river), remove \"player\" with where they went: that ends the scene.",
  "- Often nothing changes: an empty list is fine.",
  WORLD_LANGUAGE,
].join("\n\n");

/** Strict JSON schema with the world's ids as the only selectors: no names, no groups, nothing that can fail to match. */
function opSchema(world: SceneWorld): Record<string, unknown> {
  const ids = ["", ...Object.keys(world.entities).filter(id => id !== world.root)];
  return {
    type: "object", additionalProperties: false, required: ["ops"],
    properties: { ops: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["op", "what", "to", "how", "feet", "name", "kind", "text", "add", "remove", "quantity"],
      properties: {
        op: { type: "string", enum: ["move", "place", "give", "drop", "create", "state", "note", "forget", "remove", "destroy", "ignite", "douse", "spill", "chill", "bleed", "break"] },
        what: { type: "string", enum: ids }, to: { type: "string", enum: ids },
        how: { type: "string", enum: ["", "near", "behind", "beside", "under", "on", "in", "away", "toward", "light"] }, feet: { type: "integer" }, quantity: { type: "integer" },
        name: { type: "string" }, kind: { type: "string", enum: ["", "person", "creature", "object", "item"] }, text: { type: "string" },
        add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } },
      },
    } } },
  };
}

export interface StageContext {
  /** This turn's dice lines: what the rules already did, so it's neither redone nor undone. */
  rules?: string[];
  /** The people present, for who's who: the story often describes rather than names them. */
  cast?: Array<{ id: string; name: string; look?: string }>;
  /** Reasoning: "low" was the most accurate in the eval (F1 0.82 vs 0.68), at about 5 s, off the path to first text. */
  effort?: Effort;
}

export async function stageManage(world: SceneWorld, player: { name: string }, playerTurn: string, reply: string, turn: number, context: StageContext = {}): Promise<{ changes: string[]; problems: string[]; costUsd: number }> {
  const who = (context.cast ?? []).filter(c => world.entities[c.id] && !world.entities[c.id]!.states.includes("gone"))
    .map(c => `- ${c.name} [${c.id}]${c.look ? `: ${c.look.split(/(?<=[.;])\s/)[0]!.slice(0, 160)}` : ""}`);
  const result = await respondJson<{ ops: WorldOp[] }>({
    operation: "world.stage", effort: context.effort ?? "low",
    instructions: INSTRUCTIONS,
    input: [{ role: "user", content: [
      `## The world before this exchange\n${worldView(world, { full: true })}`,
      ...(who.length ? [`Who's who (the story may describe them without naming them):\n${who.join("\n")}`] : []),
      `The player character is ${player.name} (id "player").`,
      `## The latest exchange\nPlayer: ${playerTurn}${context.rules?.length ? `\n\nRules (dice already rolled and applied to the world): ${context.rules.join("; ")}` : ""}\n\nGM: ${reply}`,
    ].join("\n\n") }],
    json: { name: "world_ops", schema: opSchema(world) },
  });
  const applied = applyOps(world, (result.ops ?? []).slice(0, 16), turn, "stage");
  return { ...applied, costUsd: result._meta.costUsd };
}
