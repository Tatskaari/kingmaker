import { create } from "@bufbuild/protobuf";
import { fromMarkdown } from "mdast-util-from-markdown";
import { QuestSchema, QuestStageSchema, QuestTransitionSchema, type QuestTransition } from "../../contracts/src/v2.js";
import { type Note } from "./markdown.js";
import { validateQuest } from "./quest-service.js";

/** Shared Markdown graph syntax; compilation never executes host scripts. */
export function compileAuthoredGraph(note: Note, kind: "conversation" | "quest" = "conversation") {
  if (note.error) throw new Error(note.error);
  const field = (key: string) => {
    const value = note.metadata[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Authored graph requires ${key}`);
    return value;
  };
  if (note.metadata.visibility !== "gm") throw new Error("Authored graphs require visibility: gm");
  const quest = create(QuestSchema, { id: field("id"), title: field("title"), initialStageId: field("initial") });
  const scripts: Record<string, string> = {};
  const triggers = new Set<string>();
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
    const nodeMatch = /^Node: ([a-z][a-z0-9_-]*)(?: \| (\S.*))?$/.exec(heading);
    const when = /^When: ([a-z][a-z0-9_-]*) -> ([a-z][a-z0-9_-]*)$/.exec(heading);
    const run = /^Run: ([a-z][a-z0-9_-]*\.ts)$/.exec(heading);
    if (node.depth === 2 && nodeMatch) {
      stage = create(QuestStageSchema, { id: nodeMatch[1]!, title: nodeMatch[2] ?? nodeMatch[1]! });
      if (!quest.stages.length && kind === "quest") quest.description = note.body.slice(0, node.position!.start.offset!).trim();
      quest.stages.push(stage); edge = undefined;
    } else if (node.depth === 3 && heading === "Guidance" && stage && !stage.description && !edge) {
      if (!body) throw new Error(`${stage.id}: empty guidance`);
      stage.description = body;
    } else if (kind === "quest" && node.depth === 3 && heading === "Quest Log" && stage && !stage.questLog && !edge) {
      if (!body) throw new Error(`${stage.id}: empty quest log`);
      stage.questLog = body;
    } else if (kind === "quest" && node.depth === 3 && heading === "Completed" && stage && !stage.completed && !edge) {
      if (body) throw new Error("Completed headings cannot have a body");
      stage.completed = true;
    } else if (node.depth === 3 && when && stage) {
      if (!body) throw new Error(`${when[1]}: empty condition`);
      edge = create(QuestTransitionSchema, { id: when[1]!, fromStageId: stage.id, toStageId: when[2]!, condition: body });
      quest.transitions.push(edge);
    } else if (kind === "quest" && node.depth === 4 && heading.startsWith("Trigger: ") && edge && !triggers.has(edge.id)) {
      if (body) throw new Error("Trigger headings cannot have a body");
      const trigger = heading.slice("Trigger: ".length);
      const talkedTo = /^player_talked_to ([a-z][a-z0-9_-]*)$/.exec(trigger);
      const fixtureAbsent = /^fixture_absent ([a-z][a-z0-9_-]*)$/.exec(trigger);
      if (trigger !== "none" && trigger !== "discretionary" && !talkedTo && !fixtureAbsent) throw new Error(`Unsupported quest trigger: ${trigger}`);
      edge.playerTalkedTo = talkedTo?.[1] ?? "";
      edge.fixtureAbsent = fixtureAbsent?.[1] ?? "";
      triggers.add(edge.id);
    } else if (node.depth === 4 && run && edge && !Object.hasOwn(scripts, edge.id)) {
      if (body) throw new Error("Run headings cannot have a body");
      scripts[edge.id] = run[1]!;
    } else throw new Error(`Invalid graph heading: ${heading}`);
  }
  validateQuest(quest);
  if (quest.stages.some(stage => !stage.description)) throw new Error("Every node requires Guidance");
  if (kind === "quest" && quest.stages.some(stage => !stage.questLog)) throw new Error("Every quest node requires Quest Log");
  if (kind === "quest" && quest.transitions.some(edge => !triggers.has(edge.id))) throw new Error("Every quest transition requires Trigger");
  return { quest, scripts };
}
