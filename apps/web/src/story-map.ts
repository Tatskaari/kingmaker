interface StoryNode { id: string; title: string; guidance: string; completed: boolean }
interface StoryEdge { id: string; from: string; to: string; condition: string; trigger: string }
interface LiveTree { node: string; phase: string; transition?: string; error?: string; conditions?: { id: string; decision?: { choice: string } }[] }
interface StoryGraph { id: string; title: string; active: boolean; currentNode: string; history: string[]; nodes: StoryNode[]; edges: StoryEdge[]; characterId?: string; live?: LiveTree }
interface StoryData { quests: StoryGraph[]; conversations: StoryGraph[] }
interface StoryRoute { kind?: "quests" | "conversations"; id?: string }
interface Character { id: string; name: string; sprite?: number; physicalForm?: string; roomId?: string }

const escape = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const portraits = new Set(["abel", "aldren", "bran", "corvin", "court-servant", "cressida", "elinor", "gurt", "holt", "klog", "oswin", "palace-guard", "peregrine", "rowan"]);

function sprite(character?: Character) {
  if (!character) return `<span class="story-gm-token" aria-hidden="true">GM</span>`;
  const position = Number.isInteger(character.sprite) ? ` style="background-position:${-(character.sprite! % 12) * 32}px ${-Math.floor(character.sprite! / 12) * 32}px"` : "";
  const portrait = portraits.has(character.id) ? ` data-portrait="${escape(character.id)}"` : "";
  return `<span class="court-sprite${character.physicalForm === "cow" ? " court-cow" : ""}"${portrait}${position} aria-hidden="true"></span>`;
}

function graphView(graph: StoryGraph, character?: Character) {
  const travelled = new Set(graph.history);
  const visited = new Set(graph.edges.filter(edge => travelled.has(edge.id)).flatMap(edge => [edge.from, edge.to]));
  visited.add(graph.currentNode);
  const decisions = new Map(graph.live?.conditions?.map(item => [item.id, item.decision?.choice]) ?? []);
  const liveText = graph.live?.phase === "checking" ? "Checking which path the conversation earned…"
    : graph.live?.phase === "failed" ? `Path check failed: ${graph.live.error || "unknown error"}`
      : graph.live?.transition ? `Chose ${graph.live.transition}` : "Waiting for the next established event.";
  return `<section class="story-board" aria-label="${escape(graph.title)} story graph">
    <header class="story-board-head"><div>${sprite(character)}<div><span class="story-state">${graph.active ? "Active" : "Dormant"}</span><h3>${escape(graph.title)}</h3></div></div><p><strong>GM now:</strong> ${escape(graph.currentNode)} · ${escape(liveText)}</p></header>
    <div class="story-flow">${graph.nodes.map(node => {
      const current = node.id === graph.currentNode;
      const edges = graph.edges.filter(edge => edge.from === node.id);
      return `<article class="story-step ${current ? "current" : visited.has(node.id) ? "visited" : "future"}">
        <div class="story-node">${current ? `<span class="story-you-are-here">GM is here</span>` : ""}<span class="story-node-id">${escape(node.id)}</span><h4>${escape(node.title)}</h4>${current ? `<p>${escape(node.guidance)}</p>` : ""}</div>
        ${edges.length ? `<ul class="story-paths">${edges.map(edge => `<li class="${escape(decisions.get(edge.id) || (travelled.has(edge.id) ? "hit" : ""))}" title="${escape(edge.condition)}"><span>${escape(edge.id)}</span><small>${escape(edge.trigger)}</small><b aria-label="leads to">→ ${escape(edge.to)}</b></li>`).join("")}</ul>` : `<p class="story-ending">End of this authored branch</p>`}
      </article>`;
    }).join("")}</div>
  </section>`;
}

export function storyMapView(data: StoryData, route: StoryRoute = {}, characters: Character[] = []) {
  const kind = route.kind === "conversations" ? "conversations" : "quests";
  const graphs = data[kind] ?? [];
  const selected = graphs.find(graph => graph.id === route.id) ?? graphs.find(graph => graph.active) ?? graphs[0];
  const byId = new Map(characters.map(character => [character.id, character]));
  const nameCounts = new Map(characters.map(character => [character.name, characters.filter(item => item.name === character.name).length]));
  return `<div class="story-map">
    <nav class="story-kind" aria-label="Story graph type"><button data-story-kind="quests" aria-pressed="${kind === "quests"}">Quest trees</button><button data-story-kind="conversations" aria-pressed="${kind === "conversations"}">Conversation trees</button></nav>
    <div class="story-picker" role="list" aria-label="${kind === "quests" ? "Quests" : "Characters"}">${graphs.map(graph => {
      const character = graph.characterId ? byId.get(graph.characterId) : undefined;
      const duplicate = character && (nameCounts.get(character.name) ?? 0) > 1 ? `${character.roomId || character.id} · ` : "";
      return `<button role="listitem" data-story-id="${escape(graph.id)}" aria-current="${selected?.id === graph.id}">${kind === "conversations" ? sprite(character) : `<span class="story-quest-mark" aria-hidden="true">◆</span>`}<span><strong>${escape(character?.name || graph.title)}</strong><small>${escape(duplicate + graph.currentNode)}</small></span></button>`;
    }).join("")}</div>
    ${selected ? graphView(selected, selected.characterId ? byId.get(selected.characterId) : undefined) : `<p class="debug-empty">No ${escape(kind)} are authored in this game.</p>`}
  </div>`;
}
