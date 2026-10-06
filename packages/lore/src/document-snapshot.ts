import { canonical, sha256 } from "../../core/src/state-version.js";
import { toJson } from "@bufbuild/protobuf";
import { stringify } from "yaml";
import { DocumentSchema, type Document } from "../../contracts/src/v2.js";
import type { DocumentSnapshot } from "./service-types.js";

/** Stable version input; callers can retain this string across asynchronous hashing. */
export function documentVersion(document: Document): string {
  return JSON.stringify(canonical(toJson(DocumentSchema, document)));
}
export async function snapshot(path: string, document: Document): Promise<DocumentSnapshot> {
  const sha = await sha256(documentVersion(document));
  const metadata = document.frontmatter ?? {};
  const text = (Object.keys(metadata).length || /^---\r?\n/.test(document.body)) ? `---\n${stringify(canonical(metadata))}---\n${document.body}` : document.body;
  return { path, sha, text, document };
}

