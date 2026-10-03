import { stringify } from "yaml";
import { documentLink, documentMarkdown, escapeDocumentHtml as escape } from "./document-markdown.js";
import { transcriptDetail } from "./debug-view.js";

export function documentExplorer(data = {}, route = {}, names = {}) {
  const docs = data.docs || {}, paths = Object.keys(docs).sort();
  const path = route.path ?? data.scenario ?? "", doc = docs[path];
  const name = id => names[id] || id;
  const parts = path.split("/").filter(Boolean);
  const folder = !path || path.endsWith("/");
  const children = prefix => [...new Set(paths.filter(path => path.startsWith(prefix)).map(path => {
    const rest = path.slice(prefix.length), slash = rest.indexOf("/");
    return prefix + (slash < 0 ? rest : rest.slice(0, slash + 1));
  }))].sort((a, b) => Number(b.endsWith("/")) - Number(a.endsWith("/")) || a.localeCompare(b));
  const label = entry => entry.split("/").filter(Boolean).at(-1) || "Documents";
  function tree(prefix = "") {
    return `<ul>${children(prefix).map(entry => entry.endsWith("/")
      ? `<li><details ${path.startsWith(entry) ? "open" : ""}><summary>${documentLink(entry, label(entry))}</summary>${tree(entry)}</details></li>`
      : `<li ${entry === path ? 'aria-current="page"' : ""}>${documentLink(entry, label(entry))}</li>`).join("")}</ul>`;
  }
  const breadcrumbs = `<nav class="debug-breadcrumbs doc-breadcrumbs" aria-label="Document navigation">${documentLink("", "Documents")}${parts.map((part, index) => {
    const target = parts.slice(0, index + 1).join("/") + (index < parts.length - 1 || folder ? "/" : "");
    return `<span>/</span>${index === parts.length - 1 ? `<span aria-current="page">${escape(part)}</span>` : documentLink(target, part)}`;
  }).join("")}</nav>`;
  const writes = (data.history || []).filter(write => write.path === path);
  const history = writes.map(write => {
    const tool = write.call.response?.tool_calls?.find(call => call.id === write.toolCallId);
    let args = tool?.function.arguments || "";
    try { args = JSON.stringify(JSON.parse(args), null, 2); } catch { /* Show the captured value. */ }
    return `<article class="doc-write" data-transcript-key="${escape(write.call.spanId || write.call.id)}"><h4>${escape(name(write.call.characterId))} · ${escape(write.call.kind.replaceAll("_", " "))}</h4>
      <p class="debug-meta"><time>${escape(new Date(write.updatedAt).toLocaleString())}</time> · ${escape(tool?.function.name || "Document update")}</p>
      <pre>${escape(args)}</pre><details><summary>View transcript</summary>${transcriptDetail(write.call, name)}</details></article>`;
  }).join("");
  const popup = `<div id="document-history" class="doc-history" popover data-transcript-key="history" data-transcript-container role="dialog" aria-label="Recent document updates">
    <header><h3>Recent document updates</h3><button popovertarget="document-history" popovertargetaction="hide" aria-label="Close document history">×</button></header>
    <p>${escape(path)}</p><p class="debug-meta">Successful tool writes from this loaded session. Up to 50 updates are retained across all documents.</p>
    <section data-transcript-key="writes" data-transcript-container>${history || '<p>No recent tool updates for this document.</p>'}</section></div>`;
  const content = doc
    ? `<details class="doc-metadata"><summary>Document properties</summary><pre>${escape(stringify(doc.frontmatter || {}))}</pre></details>${documentMarkdown(doc.body, path, paths)}`
    : folder ? `<ul>${children(path).map(entry => `<li>${documentLink(entry, label(entry))}</li>`).join("")}</ul>`
      : '<p>This document is no longer available. Select another document in the explorer.</p>';
  return `${breadcrumbs}<div class="doc-explorer" data-transcript-key="document-explorer" data-transcript-container>
    <nav class="doc-tree" aria-label="Document directory" data-transcript-key="directory">${tree()}</nav>
    <section class="doc-reader" data-transcript-key="${escape(path)}" data-transcript-container><header class="doc-title"><h2>${escape(label(path))}</h2>
      ${doc ? `<button class="doc-history-button" popovertarget="document-history" aria-label="Recent updates to this document" title="Recent document updates">↶ <span>History (${writes.length})</span></button>` : ""}</header>
      <article class="doc-content">${content}</article>${doc ? popup : ""}</section></div>`;
}
