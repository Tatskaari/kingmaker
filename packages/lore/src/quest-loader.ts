import { create } from "@bufbuild/protobuf";
import { QuestSchema, QuestStageSchema, QuestTransitionSchema, QuestStateSchema, type QuestState } from "../../contracts/src/v2.js";
import { links, resolveLink, type Note } from "./markdown.js";
import { validateQuest } from "./quest-service.js";

/** Compile authored quest data only when constructing a fresh scenario world. */
export function loadQuests(notes: ReadonlyMap<string, Note>, scenarioID: string): Record<string, QuestState> {
  const prefix = `Scenarios/${scenarioID}/Quests/`;
  const quests = new Map<string, QuestState>();
  const text = (path: string, field: string): string => {
    const value = notes.get(path)!.metadata[field];
    if (typeof value !== "string" || !value.trim()) throw new Error(`${path}: ${field} must be nonempty text`);
    return value;
  };
  const flag = (path: string, field: string): boolean => {
    const value = notes.get(path)!.metadata[field];
    if (value !== undefined && typeof value !== "boolean") throw new Error(`${path}: ${field} must be a boolean`);
    return value === true;
  };
  const title = (path: string) => text(path, "title");
  const gm = (path: string) => {
    const note = notes.get(path)!;
    if (note.error) throw new Error(`${path}: ${note.error}`);
    if (note.metadata.visibility !== "gm") throw new Error(`${path}: quest definitions must have visibility: gm`);
    return note;
  };
  for (const [path, overview] of notes) {
    if (!path.startsWith(prefix) || !/^[^/]+\/index\.md$/.test(path.slice(prefix.length))) continue;
    const folder = path.slice(0, -"index.md".length);
    const stages = [...notes.keys()].filter(name => name.startsWith(folder)
      && /^\d{3}_stage_[^/]+\.md$/.test(name.slice(folder.length))).sort();
    if (!stages.length) continue;
    gm(path);
    const quest = create(QuestSchema, { id: text(path, "id"), title: title(path), description: overview.body });
    const initial: string[] = [];
    for (const stagePath of stages) {
      const stage = gm(stagePath), id = text(stagePath, "id");
      if (stage.metadata.initial !== undefined && typeof stage.metadata.initial !== "boolean") {
        throw new Error(`${stagePath}: initial must be a boolean`);
      }
      if (stage.metadata.initial === true) initial.push(id);
      quest.stages.push(create(QuestStageSchema, { id, title: title(stagePath), description: stage.body, completed: flag(stagePath, "completed") }));
      const outgoing = stage.metadata.transitions ?? [];
      if (!Array.isArray(outgoing)) throw new Error(`${stagePath}: transitions must be a list of note links`);
      for (const reference of outgoing) {
        try {
          const parsed = typeof reference === "string" ? links(reference) : [];
          if (parsed.length !== 1) throw new Error("Expected one transition note link");
          const target = resolveLink(notes, stagePath, parsed[0]!);
          if (!target || !target.startsWith(`${folder}transitions/`) || target.endsWith("/index.md")) {
            throw new Error("Transition must resolve inside this quest's transitions folder");
          }
          const transition = gm(target);
          const trigger = transition.metadata.trigger;
          if (trigger !== "discretionary" && trigger !== "predicate") throw new Error(`${target}: unsupported transition trigger`);
          const playerTalkedTo = trigger === "predicate" ? text(target, "player_talked_to") : "";
          if (trigger === "discretionary" && transition.metadata.player_talked_to !== undefined) throw new Error(`${target}: player_talked_to requires trigger: predicate`);
          if (playerTalkedTo && !notes.has(`Scenarios/${scenarioID}/Characters/${playerTalkedTo}/character.md`)) {
            throw new Error(`${target}: unknown conversation character: ${playerTalkedTo}`);
          }
          const condition = text(target, "condition");
          for (const reference of links(condition)) resolveLink(notes, target, reference);
          quest.transitions.push(create(QuestTransitionSchema, { id: text(target, "id"),
            fromStageId: id, toStageId: text(target, "to"), description: transition.body, condition, playerTalkedTo }));
        } catch (error) {
          throw new Error(`${stagePath}: ${String(reference)}: ${String(error)}`, { cause: error });
        }
      }
    }
    if (initial.length !== 1) throw new Error(`${path}: exactly one stage must declare initial: true`);
    quest.initialStageId = initial[0]!;
    try { validateQuest(quest); } catch (error) { throw new Error(`${path}: ${String(error)}`, { cause: error }); }
    if (quests.has(quest.id)) throw new Error(`${path}: duplicate quest ID: ${quest.id}`);
    quests.set(quest.id, create(QuestStateSchema, { quest, currentStageId: quest.initialStageId, active: flag(path, "active") }));
  }
  return Object.fromEntries(quests);
}
