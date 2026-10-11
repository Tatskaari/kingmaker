const escape = value => String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

export function questFeedItems(quests) {
  return `<ol>${quests.map(quest => `<li><button type="button" class="quest-link" data-quest-id="${escape(quest.id)}">${escape(quest.title)}</button></li>`).join("")}</ol>`;
}

export function questLogContent(quest) {
  return `<section class="panel"><header class="quest-log-head"><div><div class="eyebrow">Quest log</div><h2>${escape(quest.title)}</h2></div><button type="button" class="history-close" data-quest-log-close aria-label="Close quest log" title="Close (Esc)" autofocus><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><ol class="quest-log-stages">${quest.stages.map(stage => `<li><details ${stage.status === "active" ? "open" : ""}><summary><span class="quest-stage-status">${stage.status === "active" ? "Current" : "Completed"}</span><strong>${escape(stage.title)}</strong></summary><p>${escape(stage.description)}</p></details></li>`).join("")}</ol></section>`;
}
