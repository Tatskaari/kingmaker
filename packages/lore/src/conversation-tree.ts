import { create } from "@bufbuild/protobuf";
import { fromMarkdown } from "mdast-util-from-markdown";
import { QuestSchema, QuestStageSchema, QuestTransitionSchema, type QuestTransition } from "../../contracts/src/v2.js";
import { parseMarkdown, type Note } from "./markdown.js";
import { validateQuest } from "./quest-service.js";

/** A GM-owned dialogue graph backed by the existing quest progress service. */
export function parseConversationTree(markdown: string) {
  return compileConversationTree(parseMarkdown(markdown));
}

export function compileConversationTree(note: Note) {
  if (note.error) throw new Error(note.error);
  const field = (key: string) => {
    const value = note.metadata[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Conversation tree requires ${key}`);
    return value;
  };
  if (note.metadata.visibility !== "gm") throw new Error("Conversation trees require visibility: gm");
  const characterId = field("character");
  const quest = create(QuestSchema, { id: field("id"), title: field("title"), initialStageId: field("initial") });
  const scripts: Record<string, string> = {};
  let stage: typeof quest.stages[number] | undefined;
  let edge: QuestTransition | undefined;
  const nodes = fromMarkdown(note.body).children;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.type !== "heading") continue;
    const heading = note.body.slice(node.position!.start.offset!, node.position!.end.offset!).replace(/^#+\s*/, "").trim();
    const next = nodes.slice(index + 1).find(item => item.type === "heading");
    const body = note.body.slice(node.position!.end.offset!, next?.position?.start.offset ?? note.body.length).trim();
    if (node.depth === 1) continue;
    const nodeMatch = /^Node: ([a-z][a-z0-9-]*)$/.exec(heading);
    const when = /^When: ([a-z][a-z0-9-]*) -> ([a-z][a-z0-9-]*)$/.exec(heading);
    const run = /^Run: ([a-z][a-z0-9-]*\.ts)$/.exec(heading);
    if (node.depth === 2 && nodeMatch) {
      stage = create(QuestStageSchema, { id: nodeMatch[1]!, title: nodeMatch[1]! });
      quest.stages.push(stage); edge = undefined;
    } else if (node.depth === 3 && heading === "Guidance" && stage && !stage.description && !edge) {
      if (!body) throw new Error(`${stage.id}: empty guidance`);
      stage.description = body;
    } else if (node.depth === 3 && when && stage) {
      if (!body) throw new Error(`${when[1]}: empty condition`);
      edge = create(QuestTransitionSchema, { id: when[1]!, fromStageId: stage.id, toStageId: when[2]!, condition: body });
      quest.transitions.push(edge);
    } else if (node.depth === 4 && run && edge && !Object.hasOwn(scripts, edge.id)) {
      if (body) throw new Error("Run headings cannot have a body");
      scripts[edge.id] = run[1]!;
    } else throw new Error(`Invalid conversation heading: ${heading}`);
  }
  validateQuest(quest);
  if (quest.stages.some(stage => !stage.description)) throw new Error("Every node requires Guidance");
  return { characterId, quest, scripts };
}
export type ConversationTree = ReturnType<typeof parseConversationTree>;
