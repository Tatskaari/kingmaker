import type { JsonValue } from "@bufbuild/protobuf";

/** A model may wrap an otherwise valid structured reply in a Markdown fence. */
export class InvalidModelJsonError extends Error {}

export function parseModelObject(content: string | null, stage: string): Record<string, JsonValue> {
  const source = (content ?? "").trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(source);
  let value: unknown;
  try { value = JSON.parse(fenced?.[1] ?? source); }
  catch { throw new InvalidModelJsonError(`${stage} returned an unreadable response. Please try again.`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidModelJsonError(`${stage} returned an invalid response. Please try again.`);
  }
  return value as Record<string, JsonValue>;
}
