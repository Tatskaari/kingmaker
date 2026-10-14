import { respondJson } from "../llm/openrouter.ts";
import { applyOps, worldView, type SceneWorld, type WorldOp } from "./scene-world.ts";

/**
 * The stage manager: after each reply, keep the world in step with what the story established
 * (someone moved, picked something up, hid, arrived, left; a door opened; a note worth keeping).
 * It writes operations in the world language; the world applies them, resolving selectors and
 * "near" spatially. Damage and fire from the rules are already in: it records knock-on effects only.
 */

export const WORLD_LANGUAGE = `Operations. Every operation has every field; leave the ones it doesn't use as "" or [].
- move: "what" goes to an area, or to beside someone or something ("to").
- place: "what" goes near, behind, beside, under, on or in something ("to", "how"). "behind" also notes it on both.
- give: "what" (a thing) is now held by someone ("to").
- drop: "what" is put down ("to": near something, or "" where its holder stands).
- create: someone or something the story has just brought in: "name", "kind" (person, creature, object, item), "to" (an area, or near someone or something), "text" (who or what they are).
- state: "what" gains ("add") or loses ("remove") states: burning, wet, broken, open, closed, locked, overturned, hidden, prone, unconscious, asleep, lit, dark, slick, poisoned, tied-up...
- note: something worth remembering about "what" ("text"), also noted on "to" when it's about both ("Cob is hiding behind the bar").
- remove: someone or something leaves the scene ("text": where to).
- destroy: "what" is wrecked ("text": what's left of it).
Selectors ("what", "to"): an id from the world, a name, "player", or a group: "all <filters>" with kind:object, tag:flammable, state:burning, in:<area id>, held:<id>, name:<word>, within:<feet>:<id> (e.g. "all tag:flammable within:10:card-table").`;

const OP_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["op", "what", "to", "how", "name", "kind", "text", "add", "remove"],
  properties: {
    op: { type: "string", enum: ["move", "place", "give", "drop", "create", "state", "note", "remove", "destroy"] },
    what: { type: "string" }, to: { type: "string" }, how: { type: "string" }, name: { type: "string" }, kind: { type: "string" }, text: { type: "string" },
    add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } },
  },
};

export async function stageManage(world: SceneWorld, player: { name: string }, playerTurn: string, reply: string, turn: number): Promise<{ changes: string[]; problems: string[]; costUsd: number }> {
  const result = await respondJson<{ ops: WorldOp[] }>({
    operation: "world.stage", effort: "none",
    instructions: [
      "You keep a roleplaying scene's world model in step with the story. Read the latest exchange and write the operations that make the model match what the GM's reply has established as having happened: people moving, things picked up, handed over, put down, hidden, opened or closed, broken, lit or put out, someone or something new arriving or leaving, and notes worth keeping for continuity (who is hiding where, what is under what, who is holding whom).",
      "Only what has happened, not plans, threats, offers or things merely mentioned. Damage and fire from spells and blows are already applied by the rules: don't repeat them, but do record knock-on effects the reply narrates (a table overturned, someone fleeing the flames, a fire put out with a bucket). Reuse ids from the model. Create only someone who could act, or something someone could pick up, use, hide behind or be hurt by, that the story has just brought into the scene; never scenery, sounds, weather or passing details. Often nothing changes: an empty list is fine.",
      WORLD_LANGUAGE,
    ].join("\n\n"),
    input: [{ role: "user", content: `## The world before this exchange\n${worldView(world, { full: true })}\n\nThe player character is ${player.name} (id "player").\n\n## The latest exchange\nPlayer: ${playerTurn}\n\nGM: ${reply}` }],
    json: { name: "world_ops", schema: { type: "object", additionalProperties: false, required: ["ops"], properties: { ops: { type: "array", items: OP_SCHEMA } } } },
  });
  const applied = applyOps(world, (result.ops ?? []).slice(0, 12), turn, "stage");
  return { ...applied, costUsd: result._meta.costUsd };
}
