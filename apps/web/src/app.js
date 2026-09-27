import { debugOverview, recentTranscriptsView } from "./debug-view.js";
import { AlertLog } from "./alerts.js";
import { mountCourtMap, updateCourtMap } from "./court-map.js";
import { introduction, introductionTitles, introductionHandoff, handoffPrefix, nameSuggestions, delegations, characterSprites, newTraveller, patronName } from "./introduction.js";
import { courtCharactersWithinEarshot } from "./earshot.js";
import { formatElapsedTime } from "./relative-time.js";
import devOpenRouterApiKey from "virtual:kingmaker-dev-openrouter-key";

const app = document.querySelector("#app");
let state;
let activeCharacter = null;
let closedConversation = null;
const conversationReviews = new Map();
let busy = false;
let npcRun = [];
let notice = "";
let sheetOpen = false;
let debugOpen = false;
let debugTab = "overview";
let debugReadSequence = 0;
let debugData = null;
let debugError = "";
const alerts = new AlertLog();
function alertBell() {
  return `<button class="alert-bell ${alerts.severity}" data-alert-open aria-label="Warnings and errors: ${alerts.unread} unread" title="Warnings and errors"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2v.35A7 7 0 0 1 19 11v5l2 3H3l2-3v-5a7 7 0 0 1 5-6.65V4a2 2 0 0 1 2-2Zm-3 19h6a3 3 0 0 1-6 0Z"/></svg> ${alerts.unread || ""}</button>`;
}
function alertsView() {
  return `<p>Recent warnings and errors in this session. Retry times are measured from each entry's timestamp.</p><button data-alert-clear>Clear history</button>${alerts.entries.map(entry => `<article class="alert-entry ${entry.level}"><strong>${entry.level === "error" ? "Error" : "Warning"}</strong> <time>${new Date(entry.time).toLocaleTimeString()}</time><p>${escapeHtml(entry.message)}</p></article>`).join("") || "<p>No warnings or errors.</p>"}`;
}
function refreshAlerts() {
  const bell = document.querySelector("[data-alert-open]");
  if (bell) { bell.outerHTML = alertBell(); bindAlertBell(); }
  if (debugOpen && debugTab === "alerts") {
    document.querySelector("#debug-panel").innerHTML = alertsView();
    bindAlertClear();
  }
}
function bindAlertClear() {
  document.querySelector("[data-alert-clear]")?.addEventListener("click", () => { alerts.clear(); refreshAlerts(); });
}
function bindAlertBell() {
  document.querySelector("[data-alert-open]")?.addEventListener("click", () => {
    debugOpen = true; sheetOpen = false; debugTab = "alerts";
    alerts.acknowledge(); debugReadSequence++; render();
  });
}
let debugTitle = "Debug Inspector";
let debugRequest = { type: "debug", payload: {} };
const apiKeyStorageKey = "kingmaker.openrouter-api-key";
let apiKey = devOpenRouterApiKey;
try { apiKey = sessionStorage.getItem(apiKeyStorageKey)?.trim() || ""; }
catch { /* The app still works when browser storage is unavailable. */ }
if (!apiKey) apiKey = devOpenRouterApiKey;
let screen = "key";
let introPage = 0;
let strangerTutorialOpen = false;
let reviewDraft = null;
let traveller = newTraveller();
let saves = [];
let activeSaveId = null;
let requestSequence = 0;
let gameViewGeneration = 0;
const playerMessageReceivedAt = new Map();

const gameWorker = new Worker(new URL("./game.worker.ts", import.meta.url), { type: "module" });
const pendingRequests = new Map();
const gameReplacementRequests = new Set(["reset_world", "reset_characters", "reset", "load_game", "create_game", "create_development_game", "configure", "delete_game"]);
gameWorker.addEventListener("message", event => {
  if (event.data.type === "dialogue_thinking") {
    const pending = pendingRequests.get(event.data.requestId);
    if (pending?.type === "talk" && pending.generation === gameViewGeneration
      && pending.characterId === event.data.characterId && activeCharacter === event.data.characterId
      && busy && typeof event.data.text === "string") {
      notice = event.data.text;
      render();
    }
    return;
  }
  if (event.data.type === "alert") {
    alerts.add(event.data.level === "warning" ? "warning" : "error", String(event.data.message));
    refreshAlerts();
    return;
  }
  if (event.data.type === "transcripts_changed") {
    if (debugOpen && debugTab === "transcripts") void openDebug();
    return;
  }
  if (event.data.type === "npc_update") {
    if (event.data.activeSaveId !== activeSaveId) return;
    if (!state || event.data.state.revision >= (state.revision ?? 0)) state = event.data.state;
    npcRun = event.data.running;
    const initiatedConversation = event.data.initiatedConversation || initiatedConversationId();
    if (initiatedConversation && !activeCharacter) {
      activeCharacter = initiatedConversation;
      closedConversation = null;
      notice = "";
      render();
      return;
    }
    updateCourtMap(document.querySelector("[data-court-map]"), state);
    updateNpcPanel();
    updatePlayerFeed();
    return;
  }
  const pending = pendingRequests.get(event.data.id);
  if (!pending) return;
  pendingRequests.delete(event.data.id);
  if (event.data.ok) {
    const value = event.data.value;
    // A background commit can arrive while a dialogue response is listing saves.
    if (value?.state && state && !gameReplacementRequests.has(pending.type)
      && value.state.revision < state.revision) value.state = state;
    pending.resolve(value);
  }
  else pending.reject(new Error(event.data.error));
});

function rpc(type, payload = {}) {
  if (["move_player", "set_door", "interact_fixture"].includes(type)) payload = { ...payload, generations: state.generations };
  if (gameReplacementRequests.has(type)) { gameViewGeneration++; conversationReviews.clear(); stopNpcGoal(); }
  const id = ++requestSequence;
  gameWorker.postMessage({ id, type, payload });
  return new Promise((resolve, reject) => pendingRequests.set(id, {
    resolve, reject, type, generation: gameViewGeneration, characterId: payload.characterId,
  }));
}

function stopNpcGoal() {
  npcRun = [];
  void rpc("cancel_npc").catch(() => {});
}
function initiatedConversationId() {
  return Object.entries(state?.conversations || {})
    .find(([id, messages]) => messages[0]?.role === "character" && !state.conversationEndRequested?.[id] && !conversationReviews.has(id))?.[0] || null;
}
async function runNpcGoal(characterId) {
  await rpc("start_npc", { characterId });
}
function updatePlayerFeed() {
  const feed = document.querySelector("[data-player-feed]");
  if (!feed) return;
  const messages = state.playerMessages || [];
  const now = Date.now();
  feed.innerHTML = `<h2>What you hear</h2>${messages.length
    ? `<ol>${[...messages].reverse().map(entry => {
      const parsedCreatedAt = Date.parse(entry.createdAt || "");
      if (!playerMessageReceivedAt.has(entry.id)) playerMessageReceivedAt.set(entry.id, now);
      const timestamp = Number.isNaN(parsedCreatedAt) ? playerMessageReceivedAt.get(entry.id) : parsedCreatedAt;
      const exactTime = Number.isNaN(parsedCreatedAt) ? "Received since opening this game" : new Date(parsedCreatedAt).toLocaleString();
      return `<li><time class="eyebrow" datetime="${escapeHtml(entry.createdAt || "")}" title="${escapeHtml(exactTime)}">${formatElapsedTime(timestamp, now)}</time><p>${escapeHtml(entry.message)}</p></li>`;
    }).join("")}</ol>`
    : `<p class="feed-empty">Word from the court will appear here.</p>`}`;
}
globalThis.setInterval?.(updatePlayerFeed, 1000);

function updateNpcPanel() {
  const panel = document.querySelector("[data-npc-panel]"); if (!panel) return;
  const activities = { ...state.npcActivities };
  for (const id of conversationReviews.keys()) activities[id] ??= {};
  const active = Object.entries(activities).filter(([id, activity]) => conversationReviews.has(id) || npcRun.includes(id) || activity.status === "active" || activity.reviewPending);
  panel.innerHTML = `<header class="npc-activity-heading"><h3>Active NPCs <span>${active.length}</span></h3>${npcRun.length ? '<button data-background-stop>Pause activity</button>' : ""}</header>
    ${active.length ? `<ul class="npc-goals">${active.map(([id, activity]) => {
      const character = state.characters.find(character => character.id === id);
      const running = npcRun.includes(id);
      const review = conversationReviews.get(id);
      if (review) return `<li><div class="npc-goal-content"><div class="npc-goal-heading">${escapeHtml(character?.name || id)}<span class="npc-activity-state">${review.error ? "Review failed" : "Remembering conversation"}</span></div><p>${escapeHtml(review.error || "Their memories and next goal are being reviewed.")}</p></div>${review.error ? `<button data-retry-conversation="${escapeHtml(id)}">Retry review</button>` : ""}</li>`;
      const talking = !!state.conversations?.[id]?.length && closedConversation?.id !== id;
      const status = talking ? "In conversation" : activity.reviewPending ? (running ? "Reviewing outcome" : "Awaiting review") : running ? "Acting" : "Active objective";
      const objective = character?.activeObjective;
      const work = objective ? `<div class="npc-objective"><strong>${escapeHtml(objective.name)}</strong><p>${escapeHtml(objective.status)}</p><dl><dt>Success</dt><dd>${escapeHtml(objective.successCriteria)}</dd><dt>Current goal</dt><dd>${escapeHtml(objective.currentGoal)}</dd></dl></div>`
        : `<p>${escapeHtml(activity.goal || character?.currentGoal || "No active objective.")}</p>`;
      return `<li><div class="npc-goal-content"><div class="npc-goal-heading"><button class="npc-goal-name" data-npc-debug="${escapeHtml(id)}" aria-label="Debug ${escapeHtml(character?.name || id)}">${escapeHtml(character?.name || id)}</button><span class="npc-activity-state ${running ? "running" : ""}">${status}</span></div>${work}</div>${!running && !talking ? `<button class="npc-goal-resume" data-background-resume="${escapeHtml(id)}">${activity.reviewPending ? "Review outcome" : "Continue"}</button>` : ""}</li>`;
    }).join("")}</ul>` : '<p class="npc-goals-empty">No NPCs are pursuing a goal right now.</p>'}`;
  panel.hidden = false;
  panel.onclick = event => {
    const retry = event.target.closest("[data-retry-conversation]");
    if (retry) { reviewConversation(retry.dataset.retryConversation); updateNpcPanel(); }
    if (event.target.closest("[data-background-stop]")) stopNpcGoal();
    const resume = event.target.closest("[data-background-resume]");
    if (resume) void runNpcGoal(resume.dataset.backgroundResume).catch(error => { notice = `Error: ${error.message}`; render(); });
    const debug = event.target.closest("[data-npc-debug]");
    if (debug) {
      const id = debug.dataset.npcDebug;
      const character = state.characters.find(item => item.id === id);
      void openDebug({ type: "debug_character", payload: { characterId: id } }, `${character?.name || id} Debug`);
    }
  };
}

// Development convenience: refresh the physical world without recreating an emissary.
window.resetWorld = async function resetWorld() {
  if (busy) throw new Error("Wait for the current request to finish before resetting the world.");
  if (!state?.player) throw new Error("Load a game with a created character first.");
  busy = true; notice = "Resetting the palace…"; render();
  try {
    const result = await rpc("reset_world");
    state = result.state; saves = result.saves;
    activeCharacter = null; closedConversation = null; debugData = null;
    notice = "Palace reset. Your character and conversations have been kept.";
    return { reset: true };
  } catch (error) { notice = `Error: ${error.message}`; throw error; }
  finally { busy = false; render(); }
};

// Restore authored NPC personalities and clear learned events without resetting the palace.
window.resetCharacters = async function resetCharacters() {
  if (busy) throw new Error("Wait for the current request to finish before resetting the characters.");
  if (!state?.player) throw new Error("Load a game with a created character first.");
  busy = true; notice = "Resetting characters…"; render();
  try {
    const result = await rpc("reset_characters");
    state = result.state; saves = result.saves;
    activeCharacter = null; closedConversation = null; debugData = null;
    npcRun = [];
    notice = "NPCs reset. Conversations and learned events cleared; your character and palace have been kept.";
    return { reset: true };
  } catch (error) { notice = `Error: ${error.message}`; throw error; }
  finally { busy = false; render(); }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function shell(content) {
  const sheetButton = state?.player ? `<button class="sheet-tab" data-sheet-open aria-label="Open character sheet"><span class="sheet-tab-icon">♙</span><span>Character</span></button>` : "";
  const sheet = state?.player ? characterSheet() : "";
  const keyControl = apiKey ? `<button class="reset" data-key-change>Change OpenRouter key</button>` : "";
  const gameControls = state ? `<button class="reset" data-games>Saved games</button><button class="reset" data-reset>Start over</button>` : "";
  return `${state ? `<button class="debug-button" data-debug-open aria-label="Open debug inspector">⌘ <span>Debug</span></button>` : ""}${sheetButton}<div class="shell"><header class="masthead"><div class="eyebrow">An improvised political cRPG</div><h1>Kingmaker</h1><div class="rule"></div><p class="subtitle">Four kingdoms. A century’s mandate. A peace coming undone.</p></header>${content}<div class="footer">${gameControls}${keyControl}</div></div>${sheet}${debugInspector()}`;
}

function renderKeyEntry() {
  app.innerHTML = shell(`<section class="panel key-entry"><div><div class="eyebrow">Connect your model</div><h2>Enter an OpenRouter key</h2><p>The key stays in this browser tab across reloads and is never included in game saves or debug output.</p><form data-key-form><input type="password" name="apiKey" autocomplete="off" placeholder="sk-or-v1-…" required><button class="primary" ${busy ? "disabled" : ""}>${busy ? "Connecting…" : "Continue"}</button></form><p class="status ${notice.startsWith("Error") ? "error" : ""}" role="status">${escapeHtml(notice)}</p></div></section>`);
  bind();
}

function renderSavePicker() {
  const games = saves.length
    ? `<div class="save-list">${saves.map(save => `<article class="save-card"><button class="save-load" data-save-load="${escapeHtml(save.id)}"><strong>${escapeHtml(save.characterName)}</strong><span>Last played ${escapeHtml(new Date(save.updatedAt).toLocaleString())}</span></button><button class="save-delete" data-save-delete="${escapeHtml(save.id)}" aria-label="Delete ${escapeHtml(save.characterName)}">×</button></article>`).join("")}</div>`
    : `<p class="empty-saves">No emissaries have entered the Great Hall on this device.</p>`;
  app.innerHTML = shell(`<section class="panel save-picker"><div class="conversation-head"><div><div class="eyebrow">Local chronicles</div><h2>Choose an emissary</h2></div><div class="save-actions"><button class="development-shortcut" data-skip-character>Skip character creation</button><button class="primary" data-new-game>New game</button></div></div>${games}<p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  bind();
}

function characterSheet() {
  const player = state.player;
  const initials = player.name.split(/\s+/).map(part => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const relationships = player.relationships?.length
    ? player.relationships.map(relationship => `<li><strong>${escapeHtml(relationship.characterName)}</strong><p>${escapeHtml(relationship.description)}</p></li>`).join("")
    : `<li><p>No relationships recorded yet.</p></li>`;
  return `<div class="sheet-scrim ${sheetOpen ? "open" : ""}" data-sheet-close></div><aside class="character-sheet ${sheetOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Character sheet" aria-hidden="${sheetOpen ? "false" : "true"}"><button class="sheet-close" data-sheet-close aria-label="Close character sheet">×</button><div class="eyebrow">Your character</div><h2>${escapeHtml(player.name)}</h2><div class="sheet-seal">${escapeHtml(initials)}</div><section><p class="character-identity">${escapeHtml(player.gender || "")} · ${escapeHtml(player.delegation || "Visiting emissary")}</p><h3>Biography</h3><p>${escapeHtml(player.lore)}</p></section><section class="goal"><h3>Current goal</h3><p>${escapeHtml(player.currentGoal || "No goal yet.")}</p></section><section><h3>Inventory</h3><ul>${state.inventory?.length ? state.inventory.map(item => `<li>${escapeHtml(item.name)}${item.details ? `<p>${escapeHtml(item.details)}</p>` : ""}</li>`).join("") : "<li>Empty</li>"}</ul></section><section><h3>Relationships</h3><ul class="relationship-list">${relationships}</ul></section></aside>`;
}

function debugInspector() {
  const content = debugTab === "alerts" ? alertsView() : debugError
    ? `<p class="debug-error">${escapeHtml(debugError)}</p>`
    : debugData
      ? debugTab === "overview" ? debugOverview(debugRequest.type, debugData) : debugTab === "transcripts" ? recentTranscriptsView(debugData.transcripts) : `<pre>${escapeHtml(JSON.stringify(debugData, null, 2))}</pre>`
      : `<p class="debug-loading">Reading worker state…</p>`;
  const tabs = `<div class="debug-tabs" role="tablist" aria-label="Debug view">${[["overview", "Overview"], ["json", "Raw JSON"], ["transcripts", "Recent transcripts"], ["alerts", "Warnings & errors"]].map(([id, title]) => `<button id="debug-tab-${id}" role="tab" data-debug-tab="${id}" aria-selected="${debugTab === id}" aria-controls="debug-panel" tabindex="${debugTab === id ? 0 : -1}">${title}</button>`).join("")}</div>`;
  return `<div class="debug-scrim ${debugOpen ? "open" : ""}" data-debug-close></div><aside class="debug-inspector ${debugOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Debug inspector" aria-hidden="${debugOpen ? "false" : "true"}"><header><div><div class="eyebrow">Live worker memory</div><h2>${escapeHtml(debugTitle)}</h2></div><div class="debug-actions"><button data-debug-refresh>Refresh</button><button class="debug-close" data-debug-close aria-label="Close debug inspector">×</button></div></header><p class="debug-note">Character state, visible events, known world, conversation, and assembled model context. The global inspector includes the authoritative world. GM debug includes prompts, raw model responses, and tool results—not hidden reasoning. API keys are excluded.</p>${tabs}<div id="debug-panel" class="debug-panel" role="tabpanel" aria-labelledby="debug-tab-${debugTab}" tabindex="0">${content}</div></aside>`;
}

async function openDebug(request = debugRequest, title = debugTitle) {
  if (debugOpen && debugTab === "alerts" && request === debugRequest) { alerts.acknowledge(); render(); return; }
  const readSequence = ++debugReadSequence;
  if (!debugOpen || request.type !== debugRequest.type || request.payload.characterId !== debugRequest.payload.characterId) debugTab = "overview";
  debugOpen = true;
  sheetOpen = false;
  debugRequest = request;
  debugTitle = title;
  debugData = null;
  debugError = "";
  render();
  try {
    const data = await rpc(debugTab === "transcripts" ? "debug_transcripts" : request.type, request.payload);
    if (readSequence !== debugReadSequence) return;
    debugData = data;
  }
  catch (error) {
    if (readSequence !== debugReadSequence) return;
    debugError = error.message;
  }
  render();
}

function messageList(messages, assistantName) {
  if (!messages.length) return "";
  return messages.map(message => {
    const isAssistant = message.role === "assistant" || message.role === "character";
    return `<div class="message ${escapeHtml(message.role)}"><span class="speaker">${isAssistant ? escapeHtml(assistantName) : "You"}</span>${escapeHtml(message.text)}</div>`;
  }).join("");
}

function replyOptions(options, target, compelled = false) {
  if (!options?.length) return "";
  return `<div class="reply-options" role="group" aria-label="${compelled ? "You must respond" : "Suggested replies"}">${options.map((option, index) => `<button class="reply-option" data-reply-target="${escapeHtml(target)}" data-reply-index="${index}" ${busy ? "disabled" : ""}>${escapeHtml(option)}</button>`).join("")}</div>`;
}

function renderCreation() {
  const messages = (state.gmMessages || []).filter(message => !(message.role === "user" && message.text.startsWith(handoffPrefix)));
  if (!messages.length) {
    let content;
    if (introPage < introduction.length) {
      content = `<div class="eyebrow">The four kingdoms · ${introPage + 1} / ${introduction.length}</div><h2>${introductionTitles[introPage]}</h2>${introduction[introPage].map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}<div class="intro-navigation">${introPage > 0 ? `<button class="reset" data-intro-back>Back</button>` : ""}<button class="dialogue-option" data-intro-next>${introPage === introduction.length - 1 ? "Choose your delegation →" : "Continue →"}</button></div>`;
    } else if (introPage === introduction.length) {
      content = `<div class="eyebrow">Your place in the realm</div><h2>Choose your delegation</h2><p>Three kingdoms have come to Caerwyn. You travel in the service of one of them. Your own loyalties are yours to decide.</p><form data-delegation-form><fieldset class="delegation-options"><legend class="sr-only">Your delegation</legend>${delegations.map(item => `<label class="delegation-card"><input type="radio" name="delegation" value="${item.id}" ${traveller.delegation === item.id ? "checked" : ""} required><span><strong>${item.id}</strong><em>${item.motto}</em><span>${item.description}</span><small>${item.demand}</small><small class="delegation-companions">Travelling with<br>${item.companions}</small></span></label>`).join("")}</fieldset><div class="intro-navigation"><button type="button" class="reset" data-intro-back>Back</button><button class="dialogue-option">Join the delegation →</button></div></form>`;
    } else {
      content = `<div class="eyebrow">The ${escapeHtml(traveller.delegation)} delegation</div><h2>Who travels to court?</h2><form data-traveller-form><fieldset class="identity-controls" ${busy ? "disabled" : ""}><label for="traveller-name">Your name</label><div class="identity-field"><input id="traveller-name" name="name" value="${escapeHtml(traveller.name)}" maxlength="80" required autocomplete="off"><button type="button" data-roll="name" aria-label="Generate a name">⚄</button></div><label for="traveller-gender">Your gender</label><div class="identity-field"><input id="traveller-gender" name="gender" list="gender-options" value="${escapeHtml(traveller.gender)}" maxlength="40" required autocomplete="off" placeholder="Choose or describe your gender"></div><datalist id="gender-options"><option value="Woman"><option value="Man"><option value="Non-binary"></datalist><fieldset class="sprite-options"><legend>Your appearance</legend><p class="field-hint">Choose the sprite that will represent you in court.</p><div class="sprite-grid">${characterSprites.map((sprite, index) => `<label class="sprite-choice"><input type="radio" name="sprite" value="${sprite}" ${traveller.sprite === sprite ? "checked" : ""} required><span class="court-sprite" style="background-position:${-(sprite % 12) * 32}px ${-Math.floor(sprite / 12) * 32}px" aria-hidden="true"></span><span>Traveller ${index + 1}</span></label>`).join("")}</div></fieldset><div class="intro-navigation"><button type="button" class="reset" data-intro-back ${busy ? "disabled" : ""}>Back</button><button class="dialogue-option" ${busy ? "disabled" : ""}>${busy ? "On the road…" : "Meet the Stranger →"}</button></div></fieldset></form>`;
    }
    app.innerHTML = shell(`<section class="introduction" aria-label="Your journey" tabindex="-1">${content}<p class="status ${notice.startsWith("Error") ? "error" : ""}" role="status">${escapeHtml(notice)}</p></section>`);
    return bind();
  }
  const tutorial = strangerTutorialOpen ? `<dialog class="stranger-tutorial" aria-labelledby="stranger-tutorial-title"><div class="eyebrow">Shape your story</div><h2 id="stranger-tutorial-title">The mysterious Stranger</h2><p>Before you stands a mysterious Stranger, an otherworldly character with strange power over fate and providence.</p><p>Respond in character and he will help create your backstory. What you establish together—your ambitions, relationships, and position within the court—will be shared with the other characters and used to shape the scenario around you.</p><button class="primary" data-stranger-tutorial-close>Begin the conversation</button></dialog>` : "";
  app.innerHTML = shell(`<section class="panel"><div class="conversation-head"><div><div class="eyebrow">A private audience with your patron</div><h2>${patronName}</h2></div><button class="character-debug" data-gm-debug>Debug Stranger</button></div><div class="messages">${messageList(messages, patronName)}</div>${replyOptions(state.gmReplyOptions?.options, "gm", state.gmReplyOptions?.compelled)}${state.gmReplyOptions?.compelled ? `<p class="compelled-hint">A powerful force compels you to respond accordingly</p>` : `<form class="composer" data-gm-form><textarea name="message" aria-label="Speak to the Laughing Stranger" placeholder="Tell him what you desire…" required ${busy ? "disabled" : ""}></textarea><button class="primary" ${busy ? "disabled" : ""}>Reply</button></form>`}<p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>${tutorial}`);
  bind();
  const tutorialDialog = document.querySelector(".stranger-tutorial");
  tutorialDialog?.addEventListener("cancel", () => { strangerTutorialOpen = false; });
  tutorialDialog?.showModal();
  document.querySelector(".messages")?.scrollTo(0, 999999);
}

function renderCharacterReview() {
  reviewDraft ||= structuredClone(state.playerDraft);
  const field = (label, key, value, multiline = false) => `<label>${label}${multiline ? `<textarea data-review-field="${key}" required ${busy ? "disabled" : ""}>${escapeHtml(value || "")}</textarea>` : `<input data-review-field="${key}" value="${escapeHtml(value || "")}" required ${busy ? "disabled" : ""}>`}</label>`;
  const identityFields = reviewDraft.player.delegation
    ? `${field("Gender", "player.gender", reviewDraft.player.gender)}<label>Delegation<select data-review-field="player.delegation" ${busy ? "disabled" : ""}>${delegations.map(item => `<option value="${item.id}" ${reviewDraft.player.delegation === item.id ? "selected" : ""}>${item.id}</option>`).join("")}</select></label><label>Character sprite<select data-review-field="player.sprite" ${busy ? "disabled" : ""}>${characterSprites.map((sprite, index) => `<option value="${sprite}" ${reviewDraft.player.sprite === sprite ? "selected" : ""}>Traveller ${index + 1}</option>`).join("")}</select></label><span class="court-sprite review-sprite" aria-label="Selected character sprite" style="background-position:${-(reviewDraft.player.sprite % 12) * 32}px ${-Math.floor(reviewDraft.player.sprite / 12) * 32}px"></span>`
    : field("Homeland", "homeland", reviewDraft.homeland);
  const transcript = (state.gmMessages || []).filter(message => !(message.role === "user" && message.text.startsWith(handoffPrefix)));
  app.innerHTML = shell(`<section class="panel character-review"><div class="eyebrow">Before you enter Caerwyn</div><h2>Review your character</h2><p>Review what you and the Stranger established. Correct any details before saving your character and entering court.</p><details class="review-transcript"><summary>Conversation with the Stranger</summary><div class="messages">${messageList(transcript, patronName)}</div></details><form data-review-form>${field("Name", "player.name", reviewDraft.player.name)}${identityFields}${field("Role", "embassyRole", reviewDraft.embassyRole)}${field("Biography", "player.lore", reviewDraft.player.lore, true)}${field("Personal goal", "player.currentGoal", reviewDraft.player.currentGoal, true)}<h3>Relationships</h3>${reviewDraft.player.relationships.map((item, index) => field(`Your view of ${escapeHtml(state.characters.find(character => character.id === item.characterId)?.name || item.characterId)}`, `player.relationships.${index}.description`, item.description, true)).join("")}<h3>Initial impressions of you</h3>${reviewDraft.npcRelationships.map((item, index) => field(escapeHtml(state.characters.find(character => character.id === item.ownerCharacterId)?.name || item.ownerCharacterId), `npcRelationships.${index}.relationship.description`, item.relationship.description, true)).join("")}<button class="primary" ${busy ? "disabled" : ""}>Save character and enter court</button></form><p class="status ${notice.startsWith("Error") ? "error" : ""}" role="status">${escapeHtml(notice)}</p></section>`);
  bind();
}

function renderDay(bindPage = true) {
  const playerName = state.player?.name || "The Emissary";
  app.innerHTML = shell(`<section class="panel court-panel"><div class="day-heading"><div><div class="eyebrow">Palace of Caerwyn</div><h2>Welcome to court, <span class="player-name">${escapeHtml(playerName)}</span></h2></div></div><p class="scene">Left-click to walk around the palace. Right-click characters and objects to see their actions.</p><div data-court-map></div><section class="npc-planner" data-npc-panel></section><div class="court-day-footer"><span class="map-credit">Tiny Dungeon tiles by Kenney · CC0</span></div><p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  const feed = document.createElement("aside");
  feed.className = "player-event-feed";
  feed.dataset.playerFeed = "";
  feed.setAttribute("aria-label", "Messages for you");
  app.append(feed);
  updatePlayerFeed();
  if (bindPage) bind();
  updateNpcPanel();
  const mapRoot = document.querySelector("[data-court-map]");
  void mountCourtMap(mapRoot, state.characters, state.player, async id => {
    if (busy || conversationReviews.has(id) || !mapRoot.isConnected) return;
    activeCharacter = id; closedConversation = null; notice = ""; render();
  }, busy, async point => {
    const result = await rpc("move_player", point);
    state = result.state; saves = result.saves;
  }, state.doors, async (id, open) => {
    const result = await rpc("set_door", { id, open });
    state = result.state; saves = result.saves;
    return state.doors;
  }, state.roomAccess, state.fixtures, state.fixtureActions, async actionId => {
    const result = await rpc("interact_fixture", { actionId });
    state = result.state; saves = result.saves; notice = result.message; render();
  }, async id => {
    if (conversationReviews.has(id)) throw new Error("Conversation review is pending.");
    await rpc("pause_npc", { characterId: id });
  }, async id => {
    const character = state.characters.find(item => item.id === id);
    await openDebug({ type: "debug_character", payload: { characterId: id } }, `${character?.name || id} Debug`);
  }).then(() => updateCourtMap(mapRoot, state)).catch(() => {
    if (!mapRoot.isConnected) return;
    const message = document.createElement("p"); message.className = "status error";
    message.textContent = "The palace artwork could not load. You can still select a character by name."; mapRoot.append(message);
  });
}

function renderConversation() {
  const character = state.characters.find(item => item.id === activeCharacter);
  if (!character) { activeCharacter = null; return renderDay(); }
  const ended = closedConversation?.id === activeCharacter;
  const ending = !!state.conversationEndRequested?.[activeCharacter];
  const messages = ended ? closedConversation.messages : state.conversations?.[activeCharacter] || [];
  const listeners = courtCharactersWithinEarshot(character, state.characters, state.doors, state.fixtures);
  const earshotMessage = listeners.length
    ? `Within earshot:\n${listeners.map(listener => `${listener.name} — ${listener.level}`).join("\n")}`
    : "No one else is within earshot.";
  renderDay(false);
  const dialog = document.createElement("dialog");
  dialog.className = "conversation-modal";
  dialog.setAttribute("aria-label", `Conversation with ${character.name}`);
  dialog.innerHTML = `<section class="panel"><div class="conversation-head"><button class="back" data-end-conversation ${busy ? "disabled" : ""}>${busy ? "Please wait…" : ended ? "Return to palace" : ending ? "Finish conversation review" : "End conversation"}</button><div class="conversation-tools"><span class="eyebrow">A private audience</span><button class="character-debug" data-character-debug>⌘ Debug ${escapeHtml(character.name)}</button></div></div><h2>${escapeHtml(character.name)}</h2><div class="messages">${messages.length ? messageList(messages, character.name) : `<div class="message character"><span class="speaker">Scene</span>${escapeHtml(character.name)} waits for you to speak first.<span class="earshot">${escapeHtml(earshotMessage)}</span></div>`}</div>${ended || ending ? `<p class="scene">${escapeHtml(character.name)} has ended the conversation. You can return to the palace while their memories and next goal are reviewed.</p>` : `${replyOptions(state.conversationReplyOptions?.[activeCharacter], activeCharacter)}<form class="composer" data-talk-form><textarea name="message" placeholder="What do you say?" required ${busy ? "disabled" : ""}></textarea><button class="primary" ${busy ? "disabled" : ""}>Speak</button></form>`}<p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`;
  // Keep character debugging within the modal's focus boundary.
  for (const panel of app.querySelectorAll(".debug-scrim, .debug-inspector")) dialog.append(panel);
  app.append(dialog);
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (debugOpen) { debugOpen = false; render(); return; }
    if (!busy) dialog.querySelector("[data-end-conversation]")?.click();
  });
  dialog.showModal();
  bind();
  dialog.querySelector(".messages")?.scrollTo(0, 999999);
  if (!busy && !debugOpen) dialog.querySelector("textarea")?.focus();
}

function render() {
  if (screen === "key" || !apiKey) return renderKeyEntry();
  if (screen === "saves") return renderSavePicker();
  if (!state) return;
  if (state.phase === "character_review") return renderCharacterReview();
  if (state.phase === "player_creation") return renderCreation();
  activeCharacter ||= initiatedConversationId();
  if (activeCharacter) return renderConversation();
  renderDay();
}

async function talkAndReview(characterId, message) {
  const response = await rpc("talk", { characterId, message });
  state = response.state; saves = response.saves;
  if (!state.conversationEndRequested?.[characterId]) return;
  const messages = state.conversations?.[characterId] || [];
  closedConversation = { id: characterId, messages };
  reviewConversation(characterId);
}

function reviewConversation(characterId) {
  if (conversationReviews.has(characterId) && !conversationReviews.get(characterId).error) return;
  const review = {};
  conversationReviews.set(characterId, review);
  void rpc("end_conversation", { characterId }).then(result => {
    if (conversationReviews.get(characterId) !== review) return;
    state = result.state; saves = result.saves;
    conversationReviews.delete(characterId);
    updateCourtMap(document.querySelector("[data-court-map]"), state);
    updateNpcPanel();
    void runNpcGoal(characterId).catch(error => { notice = `Error: ${error.message}`; render(); });
  }).catch(error => {
    if (conversationReviews.get(characterId) !== review) return;
    review.error = error.message;
    updateNpcPanel();
  });
}

async function run(action) {
  if (busy) return;
  busy = true; notice = state?.phase === "player_creation" ? "Somewhere in the dark, the Stranger smiles…" : "The court considers your words…"; render();
  try { await action(); notice = ""; }
  catch (error) { notice = `Error: ${error.message}`; }
  finally { busy = false; render(); }
}

function bind() {
  document.querySelector("[data-key-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    const key = String(new FormData(event.currentTarget).get("apiKey") || "").trim();
    run(() => configure(key));
  });
  document.querySelector("[data-key-change]")?.addEventListener("click", () => {
    if (busy) return;
    try { sessionStorage.removeItem(apiKeyStorageKey); } catch {}
    apiKey = ""; state = null; activeSaveId = null; activeCharacter = null;
    sheetOpen = false; debugOpen = false; notice = ""; screen = "key"; render();
  });
  document.querySelector("[data-new-game]")?.addEventListener("click", () => run(async () => {
    introPage = 0; strangerTutorialOpen = false; reviewDraft = null; traveller = newTraveller(); const result = await rpc("create_game"); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game"; if (state.travellerIdentity) { traveller = { ...state.travellerIdentity }; introPage = introduction.length + 1; }
  }));
  document.querySelector("[data-skip-character]")?.addEventListener("click", () => run(async () => {
    introPage = 0; reviewDraft = null; traveller = { name: "", homeland: "" }; const result = await rpc("create_development_game"); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game";
  }));
  document.querySelectorAll("[data-save-load]").forEach(button => button.addEventListener("click", () => run(async () => {
    introPage = 0; reviewDraft = null; traveller = newTraveller(); const result = await rpc("load_game", { saveId: button.dataset.saveLoad }); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game"; if (state.travellerIdentity) { traveller = { ...state.travellerIdentity }; introPage = introduction.length + 1; }
  })));
  document.querySelectorAll("[data-save-delete]").forEach(button => button.addEventListener("click", () => run(async () => {
    const result = await rpc("delete_game", { saveId: button.dataset.saveDelete }); saves = result.saves;
  })));
  document.querySelector("[data-games]")?.addEventListener("click", () => { state = null; activeSaveId = null; activeCharacter = null; screen = "saves"; render(); });
  document.querySelector("[data-sheet-open]")?.addEventListener("click", () => { sheetOpen = true; debugOpen = false; render(); });
  document.querySelectorAll("[data-sheet-close]").forEach(button => button.addEventListener("click", () => { sheetOpen = false; render(); }));
  document.querySelector("[data-debug-open]")?.addEventListener("click", () => openDebug({ type: "debug", payload: {} }, "Debug Inspector"));
  const debugButton = document.querySelector("[data-debug-open]");
  if (debugButton) debugButton.insertAdjacentHTML("beforebegin", alertBell());
  bindAlertBell();
  bindAlertClear();
  document.querySelector("[data-gm-debug]")?.addEventListener("click", () => openDebug({ type: "debug_gm", payload: {} }, "Laughing Stranger Debug"));
  document.querySelector("[data-stranger-tutorial-close]")?.addEventListener("click", () => { strangerTutorialOpen = false; render(); });
  document.querySelector("[data-character-debug]")?.addEventListener("click", () => {
    const character = state.characters.find(item => item.id === activeCharacter);
    openDebug({ type: "debug_character", payload: { characterId: activeCharacter } }, `${character?.name || activeCharacter} Debug`);
  });
  document.querySelectorAll("[data-debug-tab]").forEach(button => {
    const select = async tab => {
      debugTab = tab;
      await openDebug();
      document.querySelector(`[data-debug-tab="${tab}"]`)?.focus();
    };
    button.addEventListener("click", () => select(button.dataset.debugTab));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = ["overview", "json", "transcripts", "alerts"];
      const index = tabs.indexOf(debugTab);
      select(event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3]);
    });
  });
  document.querySelector("[data-debug-refresh]")?.addEventListener("click", () => openDebug());
  document.querySelectorAll("[data-debug-close]").forEach(button => button.addEventListener("click", () => { debugOpen = false; render(); }));
  const moveIntro = page => { introPage = page; render(); document.querySelector(".introduction")?.focus({ preventScroll: true }); window.scrollTo(0, 0); };
  document.querySelector("[data-intro-next]")?.addEventListener("click", () => moveIntro(introPage + 1));
  document.querySelector("[data-intro-back]")?.addEventListener("click", () => { if (!busy) moveIntro(Math.max(0, introPage - 1)); });
  document.querySelector("[data-delegation-form]")?.addEventListener("change", event => { traveller.delegation = event.target.value; });
  document.querySelector("[data-delegation-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    traveller.delegation = new FormData(event.currentTarget).get("delegation");
    moveIntro(introduction.length + 1);
  });
  document.querySelector("[data-roll]")?.addEventListener("click", () => {
    const input = document.querySelector("#traveller-name");
    const suggestions = nameSuggestions.filter(value => value !== input.value);
    input.value = suggestions[Math.floor(Math.random() * suggestions.length)];
    traveller.name = input.value; input.focus();
  });
  document.querySelector("[data-traveller-form]")?.addEventListener("input", event => {
    if (["name", "gender", "sprite"].includes(event.target.name)) traveller[event.target.name] = event.target.name === "sprite" ? Number(event.target.value) : event.target.value;
  });
  document.querySelector("[data-traveller-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    for (const field of ["name", "gender"]) {
      const input = form.elements.namedItem(field); input.value = input.value.trim();
      if (!input.reportValidity()) return;
      traveller[field] = input.value;
    }
    traveller.sprite = Number(new FormData(form).get("sprite"));
    const selectedIdentity = { ...traveller };
    run(async () => {
      const identity = await rpc("set_identity", { identity: selectedIdentity }); state = identity.state; saves = identity.saves;
      const result = await rpc("gm", { message: introductionHandoff(selectedIdentity) }); state = result.state; saves = result.saves;
      strangerTutorialOpen = true;
    });
  });
  document.querySelectorAll("[data-reply-index]").forEach(button => button.addEventListener("click", () => {
    if (busy) return;
    const target = button.dataset.replyTarget;
    const options = target === "gm" ? state.gmReplyOptions?.options : state.conversationReplyOptions?.[target];
    const message = options?.[Number(button.dataset.replyIndex)];
    if (!message) return;
    run(async () => {
      if (target !== "gm") { await talkAndReview(target, message); return; }
      const result = await rpc("gm", { message });
      state = result.state; saves = result.saves;
    });
  }));
  document.querySelectorAll("[data-review-field]").forEach(input => input.addEventListener("input", () => {
    const path = input.dataset.reviewField.split(".");
    let owner = reviewDraft;
    for (const key of path.slice(0, -1)) owner = owner[key];
    owner[path.at(-1)] = input.dataset.reviewField === "player.sprite" ? Number(input.value) : input.value;
    if (input.dataset.reviewField === "player.sprite") {
      const preview = document.querySelector(".review-sprite");
      if (preview) preview.style.backgroundPosition = `${-(Number(input.value) % 12) * 32}px ${-Math.floor(Number(input.value) / 12) * 32}px`;
    }
  }));
  document.querySelector("[data-review-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    run(async () => {
      const result = await rpc("save_character", { draft: reviewDraft });
      state = result.state; saves = result.saves; reviewDraft = null;
    });
  });
  document.querySelector("[data-gm-form]")?.addEventListener("submit", event => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message");
    run(async () => { const result = await rpc("gm", { message }); state = result.state; saves = result.saves; });
  });
  document.querySelector("[data-talk-form]")?.addEventListener("submit", event => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message");
    run(() => talkAndReview(activeCharacter, message));
  });
  document.querySelector("[data-end-conversation]")?.addEventListener("click", () => {
    if (busy) return;
    if (closedConversation?.id === activeCharacter) { activeCharacter = null; closedConversation = null; notice = ""; render(); return; }
    const characterId = activeCharacter;
    activeCharacter = null; notice = "";
    reviewConversation(characterId);
    render();
  });
  document.querySelector("[data-reset]")?.addEventListener("click", () => run(async () => { introPage = 0; reviewDraft = null; traveller = newTraveller(); const result = await rpc("reset"); state = result.state; saves = result.saves; activeCharacter = null; sheetOpen = false; debugOpen = false; }));
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && (sheetOpen || debugOpen)) { sheetOpen = false; debugOpen = false; render(); }
});

async function configure(key) {
  const result = await rpc("configure", { apiKey: key });
  apiKey = key;
  try { sessionStorage.setItem(apiKeyStorageKey, key); } catch {}
  saves = result.saves;
  screen = "saves";
}

if (apiKey) run(() => configure(apiKey));
else render();
