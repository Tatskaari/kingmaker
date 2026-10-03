import { fromMarkdown } from "mdast-util-from-markdown";
import type { RootContent, Root } from "mdast";
import { parse } from "yaml";

export interface Note { body: string; metadata: Record<string, unknown>; error?: string }

/** Call only after checking access: summaries are part of the protected document. */
export function summaryPreview(metadata: Record<string, unknown>): { summary?: string } {
  const summary = metadata.summary;
  if (summary === undefined) return {};
  if (typeof summary !== "string" || !summary.trim()) throw new Error("Document summary must be nonempty text");
  return { summary: summary.trim() };
}

/** Parse supplied Markdown text; no filesystem access or runtime services. */
export function parseMarkdown(input: string): Note {
  const source = input.replace(/^\uFEFF/, "");
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  try {
    if ((source.startsWith("---\n") || source.startsWith("---\r\n")) && !header) throw new Error("Unclosed frontmatter");
    const metadata: unknown = header ? parse(header[1]!) : {};
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Frontmatter must be a mapping");
    return { body: source.slice(header?.[0].length ?? 0), metadata: metadata as Record<string, unknown> };
  } catch (error) {
    return { body: "", metadata: {}, error: String(error) };
  }
}

function normalize(value: string): string {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export function links(body: string): { target: string; wiki: boolean }[] {
  const tree = fromMarkdown(body);
  const definitions = new Map<string, string>();
  const result: { target: string; wiki: boolean }[] = [];
  function walk(node: Root | RootContent, action: (node: Root | RootContent) => void) {
    action(node);
    if ("children" in node) for (const child of node.children) walk(child, action);
  }
  walk(tree, node => { if (node.type === "definition") definitions.set(node.identifier, node.url); });
  walk(tree, node => {
    if (node.type === "link" || node.type === "image") result.push({ target: node.url, wiki: false });
    if (node.type === "linkReference" || node.type === "imageReference") {
      const target = definitions.get(node.identifier);
      if (target) result.push({ target, wiki: false });
    }
    if (node.type === "text") {
      for (const match of node.value.matchAll(/\[\[([^\]\n]+)\]\]/g)) result.push({ target: match[1]!.split("|")[0]!, wiki: true });
    }
  });
  return result;
}

export class AmbiguousLinkError extends Error {}

/** Resolve a note reference without following it. External URLs and assets are not notes. */
export function resolveLink(notes: ReadonlyMap<string, unknown>, name: string, link: { target: string; wiki: boolean }): string | undefined {
  const raw = link.target.split("#")[0]!.split("?")[0]!;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) return undefined;
  let target = decodeURIComponent(raw);
  if (!target) return name;
  if (!link.wiki && /\.[^/]+$/.test(target) && !target.endsWith(".md")) return undefined;
  if (!target.endsWith(".md")) target += ".md";
  const relative = normalize(name.slice(0, name.lastIndexOf("/") + 1) + target);
  const absolute = normalize(target.replace(/^\//, ""));
  const candidates = link.wiki
    ? (notes.has(absolute) ? [absolute] : notes.has(relative) ? [relative] : [...notes.keys()].filter(key => key.endsWith("/" + absolute)))
    : [link.target.startsWith("/") ? absolute : relative].filter(key => notes.has(key));
  if (candidates.length > 1) throw new AmbiguousLinkError(`Matches: ${candidates.join(", ")}`);
  if (!candidates.length) throw new Error(`No matching vault note: ${link.target}`);
  return candidates[0]!;
}
