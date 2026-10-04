import { toJson } from "@bufbuild/protobuf";
import { stringify } from "yaml";
import { DocumentSchema, type Document } from "../../contracts/src/v2.js";
import type { DocumentSnapshot } from "./service-types.js";

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Stable version input; callers can retain this string across asynchronous hashing. */
export function documentVersion(document: Document): string {
  return JSON.stringify(canonical(toJson(DocumentSchema, document)));
}
export async function documentSha(version: string): Promise<string> {
  const bytes = new TextEncoder().encode(version);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function snapshot(path: string, document: Document): Promise<DocumentSnapshot> {
  const sha = await documentSha(documentVersion(document));
  const metadata = document.frontmatter ?? {};
  const text = (Object.keys(metadata).length || /^---\r?\n/.test(document.body)) ? `---\n${stringify(canonical(metadata))}---\n${document.body}` : document.body;
  return { path, sha, text, document };
}

