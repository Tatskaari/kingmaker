import { structuredPatch } from "diff";
import { documentLink, escapeDocumentHtml as escape } from "./document-markdown.js";
import { transcriptDetail } from "./debug-view.js";

function toolFor(write) {
  return write.call.response?.tool_calls?.find(call => call.id === write.toolCallId);
}

function documentDiff(write) {
  const patch = structuredPatch(write.path, write.path, write.beforeText, write.afterText, "", "", { context: 3 });
  if (!patch.hunks.length) return '<p class="debug-meta">No text changes.</p>';
  return `<pre class="doc-diff" aria-label="Document changes">${patch.hunks.map(hunk => {
    let oldLine = hunk.oldStart, newLine = hunk.newStart;
    return `<span class="doc-diff-hunk">@@ −${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@</span>${hunk.lines.map(line => {
      const added = line.startsWith("+"), removed = line.startsWith("-"), marker = line.startsWith("\\");
      return `<span class="doc-diff-line ${added ? "doc-diff-add" : removed ? "doc-diff-remove" : ""}"><span class="doc-diff-number">${added || marker ? "" : oldLine++}</span><span class="doc-diff-number">${removed || marker ? "" : newLine++}</span><code>${escape(line)}</code></span>`;
    }).join("")}`;
  }).join("")}</pre>`;
}

export function documentHistory(writes, name) {
  const groups = new Map();
  for (const write of writes) {
    const call = write.call, key = JSON.stringify([call.conversationId, call.turnId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(write);
  }
  const history = [...groups].map(([key, updates]) => {
    const call = updates[0].call;
    const participants = [...new Set(call.participantIds)].map(name);
    const title = call.kind === "conversation_review" ? `Conversation between ${participants.join(" and ")}`
      : `${call.kind.replaceAll("_", " ")} · ${name(call.characterId)}`;
    const counts = { replaces: 0, adds: 0, removals: 0, updates: 0 }, seen = new Set();
    for (const write of updates) {
      const toolKey = `${write.call.spanId}/${write.toolCallId}`;
      if (seen.has(toolKey)) continue;
      seen.add(toolKey);
      const kind = ({ replace_document: "replaces", insert_document: "adds", create_document: "adds", delete_document: "removals" })[toolFor(write)?.function.name] || "updates";
      counts[kind]++;
    }
    const summary = Object.entries(counts).filter(([kind, count]) => kind !== "updates" || count).map(([kind, count]) => `${count} ${count === 1 ? kind.slice(0, -1) : kind}`).join(", ");
    return `<details class="doc-edit-group" data-transcript-key="${escape(key)}"><summary><strong>${escape(title)}</strong><span class="doc-edit-counts">${summary}</span><span class="debug-meta"><time>${escape(new Date(updates[0].updatedAt).toLocaleString())}</time> · ${new Set(updates.map(write => write.path)).size} document${new Set(updates.map(write => write.path)).size === 1 ? "" : "s"} · Turn ${escape(call.turnId.slice(0, 8))}</span></summary>
      ${[...updates].reverse().map(write => `<article class="doc-write"><h4>${documentLink(write.path, write.path)}</h4><p class="debug-meta">${escape(name(write.call.characterId))} · ${escape(toolFor(write)?.function.name || "Document update")}</p>${documentDiff(write)}<details><summary>View transcript</summary>${transcriptDetail(write.call, name)}</details></article>`).join("")}</details>`;
  }).join("");
  return `<div id="document-history" class="doc-history" popover data-transcript-key="history" data-transcript-container role="dialog" aria-label="Recent edits">
    <header><h3>Recent edits</h3><button popovertarget="document-history" popovertargetaction="hide" aria-label="Close edit history">×</button></header>
    <p class="debug-meta">Across all documents · Latest 50 successful changes from this loaded session. Older changes in a turn may have expired. Counts describe tool calls; green + and red − lines show text changes.</p>
    <section data-transcript-key="writes" data-transcript-container>${history || '<p>No recent edits in this session.</p>'}</section></div>`;
}
