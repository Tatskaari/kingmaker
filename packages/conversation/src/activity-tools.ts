import { renderPrompt } from "../../prompts/src/index.js";
import { stringify } from "yaml";
import { create } from "@bufbuild/protobuf";
import { DocumentSchema } from "../../contracts/src/v2.js";
import { activityDefinition, characterIntent, formatActivity, formatWait, intentDocument, waitActivities, routinePath, type ActivityDefinition, type WaitDefinition } from "../../lore/src/activity.js";
import { parseMarkdown } from "../../lore/src/markdown.js";
import type { DocumentSnapshot, DocumentWrite } from "../../lore/src/services.js";
import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { RuntimeServices } from "./services.js";

const text = { type: "string", minLength: 1 };
export const activityTools: OpenRouterTool[] = [
  { type: "function", function: { name: "set_activity", description: renderPrompt("activity-tools-set-activity"), parameters: {
    type: "object", additionalProperties: false, required: ["name", "status", "success_criteria", "current_goal"],
    properties: { name: text, status: text, success_criteria: text, current_goal: text, activate: { type: "boolean" } },
  } } },
  { type: "function", function: { name: "set_wait", description: renderPrompt("activity-tools-set-wait"), parameters: {
    type: "object", additionalProperties: false, required: ["name", "instructions", "activities"],
    properties: { name: text, instructions: text, activities: { type: "array", items: text }, routine: { type: "boolean" } },
  } } },
  { type: "function", function: { name: "clear_activity", description: renderPrompt("activity-tools-clear-activity"), parameters: { type: "object", additionalProperties: false, properties: {} } } },
];

/** Stage each intent update so its documents and pointer publish atomically. */
export class ActivityEdits {
  private writes = new Map<string, DocumentWrite>();
  private intent: { activity: string | null; wait: string | null } | undefined;
  private expected;
  constructor(private services: RuntimeServices, private id: string, private before: DocumentSnapshot) {
    this.expected = characterIntent(services.scenario.read(), id);
    this.id = this.expected.actorId;
  }
  get pending() { return this.writes.size > 0 || this.intent !== undefined; }
  refreshDocument(before: DocumentSnapshot) { this.before = before; }
  async call(name: string, input: Record<string, unknown>) {
    const world = this.draft();
    if (name === "clear_activity") {
      this.intent = { activity: null, wait: routinePath(world, this.id) }; return { staged: true };
    }
    const folder = this.before.path.replace(/character\.md$/, "");
    let path: string, content: string;
    if (name === "set_activity") {
      const { name: title, status, success_criteria, current_goal } = input;
      const definition = { name: title, status, success_criteria, current_goal } as ActivityDefinition;
      content = formatActivity(/\/Characters\/([^/]+)\//.exec(this.before.path)![1]!, definition);
      const current = characterIntent(world, this.id).activity;
      path = current && JSON.stringify(activityDefinition(intentDocument(world, this.id, current))) === JSON.stringify(definition)
        ? current : `${folder}activity-${crypto.randomUUID()}.md`;
      if (input.activate !== false) this.intent = { activity: path, wait: null };
    } else if (name === "set_wait") {
      content = formatWait(/\/Characters\/([^/]+)\//.exec(this.before.path)![1]!, input as unknown as WaitDefinition);
      path = input.routine === true ? `${folder}routine.md` : `${folder}wait-${crypto.randomUUID()}.md`;
      this.intent = { activity: null, wait: path };
    } else throw new Error(`Unknown activity tool: ${name}`);
    if (!this.writes.has(path)) {
      const existing = world.docs[path] ? await this.services.docs.read(path) : undefined;
      this.writes.set(path, { path, expectedSha: existing?.sha ?? null, text: content });
    } else this.writes.get(path)!.text = content;
    return { staged: true, path };
  }
  private draft() {
    const current = this.services.scenario.read();
    const world = { ...current, docs: { ...current.docs } };
    for (const write of this.writes.values()) {
      const note = parseMarkdown(write.text);
      world.docs[write.path] = create(DocumentSchema, { frontmatter: note.metadata as Record<string, string>, body: note.body });
    }
    return world;
  }
  changes(body: string) {
    const world = this.draft(), intent = this.intent ?? characterIntent(world, this.id);
    if (intent.activity) activityDefinition(intentDocument(world, this.id, intent.activity));
    if (intent.wait) for (const path of waitActivities(intentDocument(world, this.id, intent.wait))) activityDefinition(intentDocument(world, this.id, path));
    const metadata = this.before.document.frontmatter;
    const text = `---\n${stringify(metadata)}---\n${body}`;
    return { writes: [...this.writes.values(), { path: this.before.path, expectedSha: this.before.sha, text }],
      intents: this.intent ? [{ ...this.expected, ...intent }] : [] };
  }
  async commit(body: string) { const { writes, intents } = this.changes(body); await this.services.docs.commit(writes, intents); }
}
