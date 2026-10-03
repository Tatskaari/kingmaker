import { toJson } from "@bufbuild/protobuf";
import { stringify } from "yaml";
import { DocumentSchema, type Document } from "../../contracts/src/v2.js";
import type { DocumentSnapshot } from "./service-types.js";

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export async function snapshot(path: string, document: Document): Promise<DocumentSnapshot> {
  // Hash the full document, including GM properties and derived links, in stable key order.
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(toJson(DocumentSchema, document))));
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const metadata = document.frontmatter ?? {};
  const text = (Object.keys(metadata).length || /^---\r?\n/.test(document.body)) ? `---\n${stringify(canonical(metadata))}---\n${document.body}` : document.body;
  return { path, sha, text, document };
}

