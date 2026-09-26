const app = document.querySelector("#app");
let state;
let activeCharacter = null;
let busy = false;
let notice = "";
let sheetOpen = false;
let debugOpen = false;
let debugData = null;
let debugError = "";
let debugTitle = "Debug Inspector";
let debugPath = "/api/debug";
let apiKey = "";

const devEvents = new EventSource("/__dev/events");
devEvents.addEventListener("ready", event => {
  const previous = sessionStorage.getItem("kingmaker-dev-instance");
  sessionStorage.setItem("kingmaker-dev-instance", event.data);
  if (previous && previous !== event.data) location.reload();
});

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", "X-OpenRouter-Key": apiKey }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function shell(content) {
  const sheetButton = state?.player ? `<button class="sheet-tab" data-sheet-open aria-label="Open character sheet"><span class="sheet-tab-icon">♙</span><span>Character</span></button>` : "";
  const sheet = state?.player ? characterSheet() : "";
  const keyControl = apiKey ? `<button class="reset" data-key-change>Change OpenRouter key</button>` : "";
  return `<button class="debug-button" data-debug-open aria-label="Open debug inspector">⌘ <span>Debug</span></button>${sheetButton}<div class="shell"><header class="masthead"><div class="eyebrow">An improvised political cRPG</div><h1>Kingmaker</h1><div class="rule"></div><p class="subtitle">Whoever holds the Crown of Winter at solstice dawn will rule.</p></header>${content}<div class="footer">${state ? `<button class="reset" data-reset>Start over</button>` : ""}${keyControl}</div></div>${sheet}${debugInspector()}`;
}

function renderKeyEntry() {
  app.innerHTML = shell(`<section class="panel key-entry"><div><div class="eyebrow">Connect your model</div><h2>Enter an OpenRouter key</h2><p>The key stays in this browser tab and is never included in game saves or debug output.</p><form data-key-form><input type="password" name="apiKey" autocomplete="off" placeholder="sk-or-v1-…" required><button class="primary">Continue</button></form></div></section>`);
  bind();
}

function characterSheet() {
  const player = state.player;
  const initials = player.name.split(/\s+/).map(part => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const relationships = player.relationships?.length
    ? player.relationships.map(relationship => `<li><strong>${escapeHtml(relationship.characterName)}</strong><p>${escapeHtml(relationship.description)}</p></li>`).join("")
    : `<li><p>No relationships recorded yet.</p></li>`;
  return `<div class="sheet-scrim ${sheetOpen ? "open" : ""}" data-sheet-close></div><aside class="character-sheet ${sheetOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Character sheet" aria-hidden="${sheetOpen ? "false" : "true"}"><button class="sheet-close" data-sheet-close aria-label="Close character sheet">×</button><div class="eyebrow">Your character</div><h2>${escapeHtml(player.name)}</h2><div class="sheet-seal">${escapeHtml(initials)}</div><section><h3>Biography</h3><p>${escapeHtml(player.lore)}</p></section><section class="goal"><h3>Current goal</h3><p>${escapeHtml(player.currentGoal || "No goal yet.")}</p></section><section><h3>Relationships</h3><ul class="relationship-list">${relationships}</ul></section></aside>`;
}

function debugInspector() {
  const content = debugError
    ? `<p class="debug-error">${escapeHtml(debugError)}</p>`
    : debugData
      ? `<pre>${escapeHtml(JSON.stringify(debugData, null, 2))}</pre>`
      : `<p class="debug-loading">Reading server state…</p>`;
  return `<div class="debug-scrim ${debugOpen ? "open" : ""}" data-debug-close></div><aside class="debug-inspector ${debugOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Debug inspector" aria-hidden="${debugOpen ? "false" : "true"}"><header><div><div class="eyebrow">Live server memory</div><h2>${escapeHtml(debugTitle)}</h2></div><div class="debug-actions"><button data-debug-refresh>Refresh</button><button class="debug-close" data-debug-close aria-label="Close debug inspector">×</button></div></header><p class="debug-note">Character state, visible events, known world, conversation, and assembled model context. The global inspector includes the authoritative world. Secrets and API keys are excluded.</p>${content}</aside>`;
}

async function openDebug(path = debugPath, title = debugTitle) {
  debugOpen = true;
  sheetOpen = false;
  debugPath = path;
  debugTitle = title;
  debugData = null;
  debugError = "";
  render();
  try { debugData = await api(debugPath); }
  catch (error) { debugError = error.message; }
  render();
}

function messageList(messages, assistantName) {
  if (!messages.length) return "";
  return messages.map(message => {
    const isAssistant = message.role === "assistant" || message.role === "character";
    return `<div class="message ${escapeHtml(message.role)}"><span class="speaker">${isAssistant ? escapeHtml(assistantName) : "You"}</span>${escapeHtml(message.text)}</div>`;
  }).join("");
}

function renderCreation() {
  const messages = state.gmMessages || [];
  if (!messages.length) {
    app.innerHTML = shell(`<section class="panel begin"><div><h2>Enter the Great Hall</h2><p>You arrive with an embassy from a neighbouring allied kingdom. The Game Master will help decide who you are, where you came from, and what brought you here.</p><button class="primary" data-begin ${busy ? "disabled" : ""}>Begin</button><p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></div></section>`);
    return bind();
  }
  app.innerHTML = shell(`<section class="panel"><div class="conversation-head"><h2>The Game Master</h2><span class="eyebrow">Character creation</span></div><div class="messages">${messageList(messages, "Game Master")}</div><form class="composer" data-gm-form><textarea name="message" placeholder="Answer in your own words…" required ${busy ? "disabled" : ""}></textarea><button class="primary" ${busy ? "disabled" : ""}>Reply</button></form><p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  bind();
  document.querySelector(".messages")?.scrollTo(0, 999999);
}

function renderDay() {
  const playerName = state.player?.name || "The Emissary";
  app.innerHTML = shell(`<section class="panel"><div class="day-heading"><div><div class="eyebrow">Day ${state.day} · ${escapeHtml(state.location)}</div><h2>All eyes turn to <span class="player-name">${escapeHtml(playerName)}</span></h2></div></div><p class="scene">The embassy’s formal greeting is complete. King Aldren holds court beneath winter banners; Merlin watches from the edge of the dais; Lancelot stands beside the throne. You have enough standing to request a private word with any of them.</p><div class="choices">${state.characters.map(character => `<button class="choice" data-character="${escapeHtml(character.id)}">Talk to ${escapeHtml(character.name)}<span>Private audience →</span></button>`).join("")}<button class="choice end" data-end-day>End the day<span>Night awaits →</span></button></div><p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  bind();
}

function renderConversation() {
  const character = state.characters.find(item => item.id === activeCharacter);
  if (!character) { activeCharacter = null; return renderDay(); }
  const messages = state.conversations?.[activeCharacter] || [];
  app.innerHTML = shell(`<section class="panel"><div class="conversation-head"><button class="back" data-back>← Return to the Great Hall</button><div class="conversation-tools"><span class="eyebrow">A private audience</span><button class="character-debug" data-character-debug>⌘ Debug ${escapeHtml(character.name)}</button></div></div><h2>${escapeHtml(character.name)}</h2><div class="messages">${messages.length ? messageList(messages, character.name) : `<div class="message character"><span class="speaker">Scene</span>${escapeHtml(character.name)} waits for you to speak first.</div>`}</div><form class="composer" data-talk-form><textarea name="message" placeholder="What do you say?" required ${busy ? "disabled" : ""}></textarea><button class="primary" ${busy ? "disabled" : ""}>Speak</button></form><p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  bind();
  document.querySelector(".messages")?.scrollTo(0, 999999);
}

function render() {
  if (!apiKey) return renderKeyEntry();
  if (!state) return;
  if (state.phase === "player_creation") return renderCreation();
  if (activeCharacter) return renderConversation();
  renderDay();
}

async function run(action) {
  busy = true; notice = "The court considers your words…"; render();
  try { await action(); notice = ""; }
  catch (error) { notice = `Error: ${error.message}`; }
  finally { busy = false; render(); }
}

function bind() {
  document.querySelector("[data-key-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    apiKey = String(new FormData(event.currentTarget).get("apiKey") || "").trim();
    run(async () => { state = await api("/api/state"); });
  });
  document.querySelector("[data-key-change]")?.addEventListener("click", () => { apiKey = ""; state = null; render(); });
  document.querySelector("[data-sheet-open]")?.addEventListener("click", () => { sheetOpen = true; debugOpen = false; render(); });
  document.querySelectorAll("[data-sheet-close]").forEach(button => button.addEventListener("click", () => { sheetOpen = false; render(); }));
  document.querySelector("[data-debug-open]")?.addEventListener("click", () => openDebug("/api/debug", "Debug Inspector"));
  document.querySelector("[data-character-debug]")?.addEventListener("click", () => {
    const character = state.characters.find(item => item.id === activeCharacter);
    openDebug(`/api/debug/character/${activeCharacter}`, `${character?.name || activeCharacter} Debug`);
  });
  document.querySelector("[data-debug-refresh]")?.addEventListener("click", () => openDebug());
  document.querySelectorAll("[data-debug-close]").forEach(button => button.addEventListener("click", () => { debugOpen = false; render(); }));
  document.querySelector("[data-begin]")?.addEventListener("click", () => run(async () => {
    const result = await api("/api/gm", { method: "POST", body: JSON.stringify({ message: "Introduce the situation and help me create my emissary." }) }); state = result.state;
  }));
  document.querySelector("[data-gm-form]")?.addEventListener("submit", event => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message");
    run(async () => { const result = await api("/api/gm", { method: "POST", body: JSON.stringify({ message }) }); state = result.state; });
  });
  document.querySelectorAll("[data-character]").forEach(button => button.addEventListener("click", () => { activeCharacter = button.dataset.character; notice = ""; render(); }));
  document.querySelector("[data-talk-form]")?.addEventListener("submit", event => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message");
    run(async () => { const result = await api(`/api/talk/${activeCharacter}`, { method: "POST", body: JSON.stringify({ message }) }); state = result.state; });
  });
  document.querySelector("[data-back]")?.addEventListener("click", () => { activeCharacter = null; notice = ""; render(); });
  document.querySelector("[data-end-day]")?.addEventListener("click", () => { notice = "The twelve-hour night phase is the next milestone. For now, the day remains yours."; render(); });
  document.querySelector("[data-reset]")?.addEventListener("click", () => run(async () => { state = await api("/api/reset", { method: "POST" }); activeCharacter = null; sheetOpen = false; debugOpen = false; }));
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && (sheetOpen || debugOpen)) { sheetOpen = false; debugOpen = false; render(); }
});

render();
