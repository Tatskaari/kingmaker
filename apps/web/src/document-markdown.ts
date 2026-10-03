import { fromMarkdown } from "mdast-util-from-markdown";
import type { Root, RootContent } from "mdast";
import { resolveLink } from "../../../packages/lore/src/markdown.js";

export const escapeDocumentHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export const documentAnchor = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s+/g, "-");
export function documentLink(path: string, label: string, anchor = ""): string {
  return `<a href="#document=${encodeURIComponent(path)}" data-doc-path="${escapeDocumentHtml(path)}" data-doc-anchor="${escapeDocumentHtml(anchor)}">${escapeDocumentHtml(label)}</a>`;
}

/** Render authored Markdown without executing HTML or unsafe URL schemes. */
export function documentMarkdown(body: string, path: string, paths: string[]): string {
  const tree = fromMarkdown(body), notes = new Map(paths.map(path => [path, true]));
  const definitions = new Map<string, string>();
  const headings = new Map<string, number>();
  function scan(node: Root | RootContent) {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
    if ("children" in node) node.children.forEach(scan);
  }
  scan(tree);
  function link(url: string, label: string, wiki = false): string {
    if (/^(https?:|mailto:)/i.test(url)) return `<a href="${escapeDocumentHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    try {
      const target = resolveLink(notes, path, { target: url, wiki });
      if (target) {
        const anchor = decodeURIComponent(url.split("#").slice(1).join("#"));
        return `<a href="#document=${encodeURIComponent(target)}" data-doc-path="${escapeDocumentHtml(target)}" data-doc-anchor="${escapeDocumentHtml(anchor)}">${label}</a>`;
      }
    } catch { /* Missing and ambiguous notes remain readable, without misrouting. */ }
    return `<span class="doc-unresolved" title="Unresolved or unsupported link: ${escapeDocumentHtml(url)}">${label}</span>`;
  }
  function text(node: Root | RootContent): string {
    return "value" in node ? node.value : "children" in node ? node.children.map(text).join("") : "";
  }
  function render(node: Root | RootContent, insideLink = false): string {
    const children = () => "children" in node ? node.children.map(child => render(child, insideLink)).join("") : "";
    switch (node.type) {
      case "root": return children();
      case "text": return insideLink ? escapeDocumentHtml(node.value) : node.value.split(/(\[\[[^\]\n]+\]\])/g).map(part => {
        if (!part.startsWith("[[") || !part.endsWith("]]")) return escapeDocumentHtml(part);
        const [target = "", alias] = part.slice(2, -2).split("|");
        return link(target, escapeDocumentHtml(alias || target), true);
      }).join("");
      case "paragraph": return `<p>${children()}</p>`;
      case "heading": {
        const slug = documentAnchor(text(node)), count = headings.get(slug) ?? 0;
        headings.set(slug, count + 1);
        return `<h${node.depth} id="doc-heading-${escapeDocumentHtml(slug)}${count ? `-${count}` : ""}">${children()}</h${node.depth}>`;
      }
      case "strong": return `<strong>${children()}</strong>`;
      case "emphasis": return `<em>${children()}</em>`;
      case "blockquote": return `<blockquote>${children()}</blockquote>`;
      case "list": return node.ordered ? `<ol start="${node.start ?? 1}">${children()}</ol>` : `<ul>${children()}</ul>`;
      case "listItem": return `<li>${children()}</li>`;
      case "inlineCode": return `<code>${escapeDocumentHtml(node.value)}</code>`;
      case "code": return `<pre><code>${escapeDocumentHtml(node.value)}</code></pre>`;
      case "html": return escapeDocumentHtml(node.value);
      case "link": return link(node.url, node.children.map(child => render(child, true)).join(""));
      case "linkReference": return link(definitions.get(node.identifier) ?? "", node.children.map(child => render(child, true)).join(""));
      case "image": return link(node.url, escapeDocumentHtml(node.alt || node.url));
      case "imageReference": return link(definitions.get(node.identifier) ?? "", escapeDocumentHtml(node.alt));
      case "break": return "<br>";
      case "thematicBreak": return "<hr>";
      case "definition": return "";
      default: return children();
    }
  }
  return render(tree);
}
