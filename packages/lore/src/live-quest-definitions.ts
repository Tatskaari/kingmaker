import { create } from "@bufbuild/protobuf";
import { canonical } from "../../core/src/state-version.js";
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
import { QuestStateSchema, type Quest, type WorldState } from "../../contracts/src/v2.js";
import { compileConversationTree } from "./conversation-tree.js";
import { DocumentValidationError } from "./document-audit.js";
import { loadQuests } from "./quest-loader.js";

/** Compile only unpublished document drafts; retain live progress and invalidate stale decisions. */
export function prepareQuestDefinitions(before: WorldState, draft: WorldState): WorldState["quests"] {
  const scenarioID = draft.scenario.split("/")[1]!;
  const prefix = `Scenarios/${scenarioID}/Quests/`;
  const changedHooks = new Set([...new Set([...Object.keys(before.docs), ...Object.keys(draft.docs)])]
    .filter(path => path.startsWith("Hooks/") && before.docs[path]?.body !== draft.docs[path]?.body)
    .map(path => path.slice("Hooks/".length)));
  const changed = [...new Set([...Object.keys(before.docs), ...Object.keys(draft.docs)])].filter(path => {
    if (!path.startsWith(prefix) && !/^Conversations\/[^/]+\.md$/.test(path)) return false;
    const old = before.docs[path], next = draft.docs[path];
    return old?.body !== next?.body || !equal(old?.frontmatter, next?.frontmatter)
      || (path.startsWith("Conversations/") && next && changedHooks.size > 0
        && Object.values(compileConversationTree({ body: next.body, metadata: next.frontmatter ?? {} }).scripts).some(name => changedHooks.has(name)));
  });
  if (!changed.length) return before.quests;
  const quests = { ...before.quests };
  const publish = (quest: Quest, existing: boolean, force = false) => {
    const current = before.quests[quest.id];
    if (!existing && current) throw new Error(`${quest.id}: quest ID already registered`);
    if (!current) { quests[quest.id] = create(QuestStateSchema, { quest, currentStageId: quest.initialStageId }); return; }
    if (!quest.stages.some(stage => stage.id === current.currentStageId)) {
      throw new Error(`${quest.id}: cannot remove current node ${current.currentStageId}; edit it in place`);
    }
    if (!force && equal(current.quest, quest)) return;
    if (current.revision === 0xffff_ffff) throw new Error(`${quest.id}: quest revision exhausted`);
    quests[quest.id] = { ...current, quest, revision: current.revision + 1 };
  };
  let path = changed[0]!;
  try {
    if (changed.some(name => name.startsWith(prefix))) {
      const notes = new Map(Object.entries(draft.docs).map(([name, doc]) => [name, { body: doc.body, metadata: doc.frontmatter ?? {} }]));
      const compiled = loadQuests(notes, scenarioID);
      const previous = new Set(Object.entries(before.docs).filter(([name]) => name.startsWith(prefix)
        && /^[^/]+\/quest\.md$/.test(name.slice(prefix.length))).flatMap(([, doc]) =>
        typeof doc.frontmatter?.id === "string" && before.quests[doc.frontmatter.id] ? [doc.frontmatter.id] : []));
      for (const id of previous) if (!compiled[id]) throw new Error(`${id}: cannot remove a live quest definition; edit its current node in place`);
      for (const [id, state] of Object.entries(compiled)) {
        publish(state.quest!, previous.has(id));
        if (!before.quests[id]) quests[id] = state;
      }
    }
    for (path of changed.filter(name => name.startsWith("Conversations/"))) {
      const doc = draft.docs[path];
      if (!doc) throw new Error(`${path}: cannot remove a live conversation definition; edit its current node in place`);
      const tree = compileConversationTree({ body: doc.body, metadata: doc.frontmatter ?? {} });
      if (path !== `Conversations/${tree.characterId}.md`) throw new Error(`${path}: conversation character must match its document path`);
      const oldId = before.docs[path]?.frontmatter?.id;
      if (oldId !== undefined && oldId !== tree.quest.id) throw new Error(`${path}: cannot change a live conversation ID`);
      if (!oldId && quests[tree.quest.id]) throw new Error(`${tree.quest.id}: quest ID already registered`);
      publish(tree.quest, oldId === tree.quest.id, true);
    }
    return quests;
  } catch (error) {
    throw new DocumentValidationError([{ kind: "invalid", trail: [path], detail: String(error) }]);
  }
}
