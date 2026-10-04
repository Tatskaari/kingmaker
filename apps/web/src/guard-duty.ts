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
    const instruction = `Hold your assigned post in ${room.name} at (${actor.position.x}, ${actor.position.y}). Watch for trouble you can actually perceive. If you witness an unauthorized intrusion into private palace quarters, leave your post to intercept the intruder and arrest them through your conversation action. Do not arrest people for ordinary lawful movement or unseen events. Return to your post after dealing with trouble.`;
    const access = { visibility: "private", readers: [`character:${character.characterId}`] };
    world.docs[activity] = create(DocumentSchema, { frontmatter: { ...access, summary: `Guard duty at ${room.name}.`,
      name: `Guard ${room.name}`, status: "On duty at the assigned post.",
      success_criteria: "An observed disturbance has been dealt with and you have returned to your post.", current_goal: instruction } });
    world.docs[routine] = create(DocumentSchema, { frontmatter: { ...access, summary: `Wait on guard duty at ${room.name}.`, activities: [activity] },
      body: `${instruction}\nContinue waiting while the post is quiet. Activate the duty activity when observed trouble requires intervention.` });
    if (!character.activity && !character.wait) character.activity = activity;
  }
}
