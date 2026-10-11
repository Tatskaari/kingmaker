import { create } from "@bufbuild/protobuf";
import { QuestStateSchema, type QuestState } from "../../contracts/src/v2.js";
import { links, resolveLink, type Note } from "./markdown.js";
import { compileQuestTree } from "./quest-tree.js";

/** Compile authored quest graphs for a fresh world or an unpublished document draft. */
export function loadQuests(notes: ReadonlyMap<string, Note>, scenarioID: string): Record<string, QuestState> {
  const prefix = `Scenarios/${scenarioID}/Quests/`;
  const quests = new Map<string, QuestState>();
  for (const [path, note] of notes) {
    if (!path.startsWith(prefix) || !/^[^/]+\/quest\.md$/.test(path.slice(prefix.length))) continue;
    try {
      const { quest, active } = compileQuestTree(note);
      for (const edge of quest.transitions) {
        if (edge.playerTalkedTo && !notes.has(`Scenarios/${scenarioID}/Characters/${edge.playerTalkedTo}/character.md`)) {
          throw new Error(`Unknown conversation character: ${edge.playerTalkedTo}`);
        }
        for (const reference of links(edge.condition)) resolveLink(notes, path, reference);
      }
      if (quests.has(quest.id)) throw new Error(`Duplicate quest ID: ${quest.id}`);
      quests.set(quest.id, create(QuestStateSchema, { quest, currentStageId: quest.initialStageId, active }));
    } catch (error) {
      throw new Error(`${path}: ${String(error)}`, { cause: error });
    }
  }
  return Object.fromEntries(quests);
}
