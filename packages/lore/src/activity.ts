import { stringify } from "yaml";
import type { Document, WorldState } from "../../contracts/src/v2.js";
import { labels, permitted } from "./access.js";
import { characterEntry } from "./active-goal.js";
import type { DocsService, DocumentSnapshot, ScenarioService } from "./services.js";

export interface ActivityDefinition { name: string; status: string; success_criteria: string; current_goal: string }
export interface WaitDefinition { name: string; instructions: string; activities: string[] }
export type IntentServices = { docs: DocsService; scenario: ScenarioService };
export function documentReference(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.endsWith(".md") || value.includes("\\")
    || value.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Expected a vault-relative Markdown path.");
  return value;
}
export function activityDefinition(document: Document): ActivityDefinition {
  const fields = ["name", "status", "success_criteria", "current_goal"] as const;
  return Object.fromEntries(fields.map(key => {
    const value = document.frontmatter?.[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Activity requires ${key}.`);
    return [key, value];
  })) as unknown as ActivityDefinition;
}
export function waitActivities(document: Document): string[] {
  const values = document.frontmatter?.activities ?? [];
  if (!Array.isArray(values)) throw new Error("Wait activities must be a list of Markdown paths.");
  return [...new Set(values.map(value => {
    const path = documentReference(value);
    if (!path) throw new Error("Wait activity must name a document.");
    return path;
  }))];
}
/** References never confer permission to read their targets. */
export function intentDocument(world: WorldState, id: string, path: string): Document {
  documentReference(path);
  const entry = characterEntry(world, id), character = world.docs[entry]!;
  const doc = world.docs[path];
  if (!doc) throw new Error(`Missing intent document: ${path}`);
  if (!permitted(path, { body: doc.body, metadata: doc.frontmatter ?? {} }, entry, {
    character: id, labels: labels(character.frontmatter?.labels), factions: labels(character.frontmatter?.factions),
  })) throw new Error(`No read access: ${path}`);
  return doc;
}
export function characterIntent(world: WorldState, id: string) {
  const entry = characterEntry(world, id), metadata = world.docs[entry]!.frontmatter;
  const activity = documentReference(metadata?.activity), wait = documentReference(metadata?.wait);
  return { entry, activity, wait };
}
export function routinePath(world: WorldState, id: string): string | null {
  const path = characterEntry(world, id).replace(/character\.md$/, "routine.md");
  if (!world.docs[path]) return null;
  waitActivities(intentDocument(world, id, path));
  return path;
}
export function activityGoal(world: WorldState, id: string): string | null {
  const { activity } = characterIntent(world, id);
  return activity ? activityDefinition(intentDocument(world, id, activity)).current_goal : null;
}
export function intentContext(world: WorldState, id: string): string {
  const { activity, wait } = characterIntent(world, id);
  return [["Activity", activity], ["Wait", wait]].flatMap(([label, path]) => {
    if (!path) return [];
    const doc = intentDocument(world, id, path);
    return [`# ${label}: ${path}\n${stringify(doc.frontmatter ?? {})}\n${doc.body}`];
  }).join("\n\n");
}
export function formatActivity(id: string, definition: ActivityDefinition): string {
  for (const value of Object.values(definition)) if (typeof value !== "string" || !value.trim()) throw new Error("Activity fields must be nonempty text.");
  return `---\n${stringify({ summary: definition.name, visibility: "private", readers: [`character:${id}`], ...definition })}---\n`;
}
export function formatWait(id: string, definition: WaitDefinition): string {
  if (!definition.name?.trim() || !definition.instructions?.trim()) throw new Error("Wait requires a name and instructions.");
  definition.activities.forEach(path => { if (!documentReference(path)) throw new Error("Expected activity path."); });
  return `---\n${stringify({ summary: definition.name, visibility: "private", readers: [`character:${id}`], activities: definition.activities })}---\n${definition.instructions}\n`;
}
/** Publish the pointer and notes with one SHA-checked character write. */
export async function setIntent(services: IntentServices, before: DocumentSnapshot,
  intent: { activity: string | null; wait: string | null }, body = before.document.body) {
  const world = services.scenario.snapshot();
  const id = /\/Characters\/([^/]+)\/character\.md$/.exec(before.path)?.[1];
  if (!id) throw new Error("Intent requires an NPC character entry.");
  if (intent.activity) activityDefinition(intentDocument(world, id, intent.activity));
  if (intent.wait) {
    const doc = intentDocument(world, id, intent.wait);
    for (const path of waitActivities(doc)) activityDefinition(intentDocument(world, id, path));
  }
  const text = `---\n${stringify({ ...before.document.frontmatter, ...intent })}---\n${body}`;
  if (text === before.text) return;
  if (before.text) await services.docs.replace(before.path, before.sha, before.text, text);
  else await services.docs.insert(before.path, before.sha, 0, text);
}
