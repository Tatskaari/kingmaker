import { renderPrompt } from "../../../packages/prompts/src/index.js";
import { create } from "@bufbuild/protobuf";
import { DocumentSchema, type WorldState } from "../../../packages/contracts/src/v2.js";

/** Post assignments belong to this playthrough and body, while guard lore stays shared. */
export function assignGuardPosts(world: WorldState) {
  for (const character of Object.values(world.runtimeCharacters)) {
    const entry = world.docs[character.document]!;
    if (!Array.isArray(entry.frontmatter?.conversation_actions) || !entry.frontmatter.conversation_actions.includes("arrest")) continue;
    const actor = world.map!.actors.find(actor => actor.characterId === character.id);
    if (!actor?.position) continue;
    // Palace guards may enter private rooms in the course of their duty.
    for (const room of world.map!.rooms) if (room.private && !room.allowedCharacterIds.includes(character.id)) room.allowedCharacterIds.push(character.id);
    const room = world.map!.rooms.find(room => room.id === actor.roomId)!;
    const folder = character.document.replace(/character\.md$/, ""), activity = `${folder}activity-${character.id}.md`;
    const routine = `${folder}routine-${character.id}.md`;
    const instruction = renderPrompt("guard-duty-instruction", { room: room.name, x: actor.position.x, y: actor.position.y });
    const access = { visibility: "private", readers: [`character:${character.characterId}`] };
    world.docs[activity] = create(DocumentSchema, { frontmatter: { ...access, summary: `Guard duty at ${room.name}.`,
      name: `Guard ${room.name}`, status: "On duty at the assigned post.",
      success_criteria: "An observed disturbance has been dealt with and you have returned to your post.", current_goal: instruction } });
    world.docs[routine] = create(DocumentSchema, { frontmatter: { ...access, summary: `Wait on guard duty at ${room.name}.`, activities: [activity] },
      body: renderPrompt("guard-wait", { instruction: instruction }) });
    if (!character.activity && !character.wait) character.activity = activity;
  }
}
