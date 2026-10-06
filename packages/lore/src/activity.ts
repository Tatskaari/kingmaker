import { stringify } from "yaml";
import type { Document, WorldState } from "../../contracts/src/v2.js";
import { labels, permitted } from "./access.js";
import { runtimeActor } from "./runtime-actor.js";
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
  id = world.simulation!.runtimeCharacters[id]?.characterId ?? id;
  const entry = characterEntry(world, id), character = world.docs[entry]!;
  const doc = world.docs[path];
  if (!doc) throw new Error(`Missing intent document: ${path}`);
  if (!permitted(path, { body: doc.body, metadata: doc.frontmatter ?? {} }, entry, {
    character: id, labels: labels(character.frontmatter?.labels), factions: labels(character.frontmatter?.factions),
  })) throw new Error(`No read access: ${path}`);
  return doc;
}
export function characterIntent(world: WorldState, id: string) {
  const actor = runtimeActor(world, id), entry = actor.document;
  const activity = documentReference(actor.activity), wait = documentReference(actor.wait);
  return { entry, activity, wait, actorId: actor.id, expectedRevision: actor.intentRevision };
}
export function routinePath(world: WorldState, id: string): string | null {
  const intent = characterIntent(world, id), character = runtimeActor(world, id);
  const individual = intent.entry.replace(/character\.md$/, `routine-${character.id}.md`);
  const path = character.id !== character.characterId && world.docs[individual] ? individual
    : intent.entry.replace(/character\.md$/, "routine.md");
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
/** Publish runtime intent and memory notes in one checked transaction. */
export async function setIntent(services: IntentServices, before: DocumentSnapshot,
  intent: { activity: string | null; wait: string | null }, body = before.document.body,
  expected = characterIntent(services.scenario.snapshot(), /\/Characters\/([^/]+)\/character\.md$/.exec(before.path)![1]!)) {
  const text = `---\n${stringify(before.document.frontmatter ?? {})}---\n${body}`;
  await services.docs.commit([{ path: before.path, expectedSha: before.sha, text }], [{ ...expected, ...intent }]);
}
