import { seedMemories } from "./memories.js";
import { seedPresentation } from "./presentation.js";
import { clone, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { ActorStateSchema } from "../../contracts/src/index.js";
import { DocumentSchema, CharacterPropertiesSchema } from "../../contracts/src/v2.js";
import { seedRuntimeCharacter } from "./runtime-actor.js";
import { parseMarkdown } from "./markdown.js";
import type { CharacterCreationService } from "./service-types.js";
import type { WorldStore } from "./world-store.js";

export function createCharacterService(store: WorldStore): CharacterCreationService {
  return {
    create: input => store.write(async () => {
      if (!/^[a-z][a-z0-9_-]*$/.test(input.id)) throw new Error("Invalid character ID.");
      if (Object.hasOwn(store.state.docs, input.path)) throw new Error("Character document already exists.");
      const prefix = store.state.scenario.slice(0, store.state.scenario.lastIndexOf("/") + 1);
      if (input.id !== "player" && input.path !== `${prefix}Characters/${input.id}/character.md`) {
        throw new Error("NPC entry must use its scenario character path.");
      }
      if (input.id === "player" && (store.state.player || input.path !== "Players/player.md")) throw new Error("Invalid or existing player character.");
      const existing = store.state.simulation!.map?.actors.find(actor => actor.characterId === input.id);
      if (!store.state.simulation!.map || (!existing && !input.actor)) throw new Error("A character needs a map actor.");
      if (input.actor && (existing || input.actor.characterId !== input.id
        || !store.state.simulation!.map.rooms.some(room => room.id === input.actor!.roomId) || !input.actor.position)) {
        throw new Error("Invalid or duplicate character actor.");
      }
      const parsed = parseMarkdown(input.text);
      if (parsed.error) throw new Error(parsed.error);
      const draft = { ...store.state, docs: { ...store.state.docs }, simulation: { ...store.state.simulation!,
        map: { ...store.state.simulation!.map!, actors: [...store.state.simulation!.map!.actors] },
        runtimeCharacters: { ...store.state.simulation!.runtimeCharacters } } };
      draft.docs[input.path] = fromJson(DocumentSchema, { body: parsed.body, frontmatter: parsed.metadata as JsonObject });

      if (input.actor) draft.simulation!.map!.actors.push(clone(ActorStateSchema, input.actor));
      const id = input.actor?.instanceId ?? input.id;
      seedRuntimeCharacter(draft, id, input.id, input.path);
      const character = draft.simulation!.runtimeCharacters[id]!;
      const properties = clone(CharacterPropertiesSchema, input.properties);
      character.dnd = properties.dnd;
      character.inventory = properties.inventory;
      seedPresentation(draft, input.path, input.presentation);
      seedMemories(draft, input.path, input.id);
      if (input.id !== "player") draft.docs[draft.scenario] = { ...draft.docs[draft.scenario]!,
        body: draft.docs[draft.scenario]!.body + `\n- [[${input.path}]]\n` };
      draft.simulation!.map!.revision++;
      store.publishDocuments(draft);
    }),
  };
}
