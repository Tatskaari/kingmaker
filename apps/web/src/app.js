import "./logging.js";
import "./dice-roll.css";
import { installDicePreview, showDiceRoll } from "./dice-roll.js";

installDicePreview();
import { debugOverview, debugSections, characterTranscripts, recentTranscriptsView } from "./debug-view.js";
import { coalescedRefresh, updateTranscriptPanel } from "./debug-live.js";
import { AlertLog } from "./alerts.js";
import { captureCourtMap, mountCourtMap, updateCourtMap } from "./court-map.js";
import { buildIssueReport, issuePageUrl, issueReportFilename } from "./issue-report.js";
import { sandboxIntroduction, handoffPrefix, courtAffiliations, characterSprites, patronName } from "./introduction.js";
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
let debugSection = "";
let transcriptRoute = {};
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
let reviewDraft = null;
let saves = [];
let activeSaveId = null;
let requestSequence = 0;
let gameViewGeneration = 0;
const playerMessageReceivedAt = new Map();

const gameWorker = new Worker(new URL("./game.worker.ts", import.meta.url), { type: "module" });
const pendingRequests = new Map();
const gameReplacementRequests = new Set(["reset_world", "reset_characters", "reset", "load_game", "create_game", "create_development_game", "configure", "delete_game"]);
gameWorker.addEventListener("message", event => {
  if (event.data.type === "conversation_roll") {
    const { requestId, rollId, characterId, result } = event.data;
    const pending = pendingRequests.get(requestId);
    const acknowledge = completed => gameWorker.postMessage({ type: "acknowledge_roll", payload: { requestId, rollId, completed } });
    if (!["talk", "end_conversation"].includes(pending?.type) || pending.generation !== gameViewGeneration || pending.characterId !== characterId) {
      acknowledge(false); return;
    }
    void showDiceRoll({ ...result, label: result.skill.replaceAll("_", " ") })
      .then(acknowledge, () => acknowledge(false));
    return;
  }
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
    if (debugOpen && debugTab === "transcripts") refreshDebugTranscripts();
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
  if (gameReplacementRequests.has(type)) { gameViewGeneration++; document.querySelector(".dice-dialog")?.close(); conversationReviews.clear(); stopNpcGoal(); }
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

// Restore authored NPC personalities and clear learned notes without resetting the palace.
window.resetCharacters = async function resetCharacters() {
  if (busy) throw new Error("Wait for the current request to finish before resetting the characters.");
  if (!state?.player) throw new Error("Load a game with a created character first.");
  busy = true; notice = "Resetting characters…"; render();
  try {
    const result = await rpc("reset_characters");
    state = result.state; saves = result.saves;
    activeCharacter = null; closedConversation = null; debugData = null;
    npcRun = [];
    notice = "NPCs reset. Conversations and learned notes cleared; your character and palace have been kept.";
    return { reset: true };
  } catch (error) { notice = `Error: ${error.message}`; throw error; }
  finally { busy = false; render(); }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function shell(content, inCourt = false) {
  document.body.classList.toggle("in-court", inCourt);
  const sheetButton = state?.player ? `<button class="sheet-tab" data-sheet-open aria-label="Open character sheet"><span class="sheet-tab-icon">♙</span><span>Character</span></button>` : "";
  const sheet = state?.player ? characterSheet() : "";
  const keyControl = apiKey ? `<button class="reset" data-key-change>Change OpenRouter key</button>` : "";
  const reportControl = state?.player ? `<button class="reset" data-report-issue>Report an issue</button>` : "";
  const gameControls = state ? `<button class="reset" data-games>Saved games</button><button class="reset" data-reset>Start over</button>${reportControl}` : "";
  if (inCourt) {
    const popover = (id, title, body) => `<aside id="${id}" class="court-popover" popover aria-label="${title}"><button class="popover-close" popovertarget="${id}" popovertargetaction="hide" aria-label="Close ${title}">×</button>${body}</aside>`;
    return `<div class="court-shell">${content}<nav class="court-toolbar" aria-label="Game controls">
      <button popovertarget="court-menu">☰ <span>Menu</span></button>
      <button popovertarget="court-messages">Messages</button>
      ${sheetButton}<button class="debug-button" data-debug-open aria-label="Open debug inspector">⌘ <span>Debug</span></button>
    </nav></div>
    ${popover("court-menu", "Game menu", `<div class="eyebrow">Palace of Caerwyn</div><h2>Kingmaker</h2><p>Welcome to court, ${escapeHtml(state.player?.name || "Emissary")}.</p><p>Left-click to walk. Right-click characters and objects for actions.</p><div class="court-menu-controls">${gameControls}${keyControl}</div><p class="map-credit">Tiny Dungeon tiles by Kenney · CC0</p>`)}
    ${popover("court-messages", "Messages", '<div class="player-event-feed" data-player-feed></div>')}
    ${sheet}${debugInspector()}`;
  }
  return `${state ? `<button class="debug-button" data-debug-open aria-label="Open debug inspector">⌘ <span>Debug</span></button>` : ""}${sheetButton}<div class="shell"><header class="masthead"><div class="eyebrow">An improvised political cRPG</div><h1>Kingmaker</h1><div class="rule"></div><p class="subtitle">Four kingdoms. A century’s mandate. A peace coming undone.</p></header>${content}<div class="footer">${gameControls}${keyControl}</div></div>${sheet}${debugInspector()}`;
}

function downloadFile(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function openIssueReporter() {
  const dialog = document.createElement("dialog");
  dialog.className = "issue-reporter";
  dialog.setAttribute("aria-labelledby", "issue-reporter-title");
  dialog.innerHTML = `<form method="dialog" data-issue-form><div class="eyebrow">Help improve Kingmaker</div><h2 id="issue-reporter-title">Report an issue</h2><p>Describe what went wrong. The first line becomes the GitHub issue title.</p><textarea name="description" required autofocus placeholder="A short summary\n\nWhat happened, and what did you expect instead?"></textarea><p class="report-privacy">Your downloaded report includes the current world state, grouped agent runs, recent API requests and responses, warnings and errors, environment details, and a screenshot. The GitHub repository is public, so review the ZIP before attaching it.</p><p class="status" data-report-status role="status"></p><div class="report-actions"><button type="button" class="reset" data-report-cancel>Cancel</button><button class="primary" value="submit">Download report &amp; open GitHub</button></div></form>`;
  app.append(dialog);
  const form = dialog.querySelector("[data-issue-form]");
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector("[data-report-cancel]").addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const description = String(new FormData(form).get("description") || "").trim();
    if (!description) return;
    const submit = form.querySelector("button[value=submit]");
    const status = form.querySelector("[data-report-status]");
    submit.disabled = true; status.textContent = "Gathering diagnostics…";
    const issueTab = window.open("about:blank", "_blank");
    try {
      const generatedAt = new Date().toISOString();
      const [diagnostics, screenshot] = await Promise.all([
        rpc("issue_report"),
        captureCourtMap(document.querySelector("[data-court-map]")),
      ]);
      const report = buildIssueReport({
        description, generatedAt,
        worldState: diagnostics.worldState,
        requests: diagnostics.requests,
        agentRuns: diagnostics.agentRuns,
        alerts: alerts.entries,
        environment: { url: location.href, userAgent: navigator.userAgent, language: navigator.language, viewport: { width: innerWidth, height: innerHeight } },
        ...(screenshot ? { screenshot: new Uint8Array(await screenshot.arrayBuffer()) } : {}),
      });
      downloadFile(report, issueReportFilename(generatedAt));
      const target = issuePageUrl(description);
      if (issueTab) issueTab.location.href = target;
      else location.href = target;
      close();
    } catch (error) {
      issueTab?.close();
      status.textContent = `Could not create the report: ${error.message}`;
      status.classList.add("error"); submit.disabled = false;
    }
  });
  dialog.showModal();
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

const abilityNames = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const statName = value => escapeHtml(value.replaceAll("_", " ").replaceAll("-", " "));
function playerStats(build, editable = false) {
  if (!build) return `<section><h3>Stats</h3><p>No stats assigned yet.</p></section>`;
  const numeric = (label, path, value, min = 1) => `<label>${label}<input type="number" min="${min}" max="4294967295" step="1" required data-review-field="player.dnd.${path}" value="${value ?? min}" ${busy ? "disabled" : ""}></label>`;
  const classes = (build.classes || []).map((item, index) => editable
    ? `<p>${statName(item.classId)} · ${statName(item.subclassId || "")}</p>${numeric("Level", `classes.${index}.level`, item.level)}`
    : `<p>Level ${item.level} ${statName(item.classId)} · ${statName(item.subclassId || "")}</p>`).join("");
  const scores = abilityNames.map(ability => {
    const score = build.abilityScores?.[ability] ?? 0;
    const modifier = Math.floor((score - 10) / 2);
    return editable ? numeric(statName(ability), `abilityScores.${ability}`, score)
      : `<div><dt>${statName(ability)}</dt><dd>${score} <small>(${modifier >= 0 ? "+" : ""}${modifier})</small></dd></div>`;
  }).join("");
  const hp = editable ? `<div class="ability-grid">${numeric("Current HP", "hitPoints.current", build.hitPoints?.current, 0)}${numeric("Maximum HP", "hitPoints.maximum", build.hitPoints?.maximum)}</div>`
    : `<p>HP ${build.hitPoints?.current ?? 0} / ${build.hitPoints?.maximum ?? 0}</p>`;
  const skills = (build.proficiencies || []).filter(item => item.kind === "PROFICIENCY_KIND_SKILL").map(item => `<li>${statName(item.targetId)}${item.rank === "PROFICIENCY_RANK_EXPERTISE" ? " (expertise)" : ""}</li>`).join("");
  return `<section class="player-stats"><h3>${editable ? "Your starting build" : "Stats"}</h3>${editable ? "<p>Adjust your level, abilities and HP freely for this prototype. Scores above 20 are welcome.</p>" : ""}${classes}${hp}<${editable ? "div" : "dl"} class="ability-grid">${scores}</${editable ? "div" : "dl"}><h4>Skills</h4><ul>${skills || "<li>None recorded</li>"}</ul></section>`;
}

function characterSheet() {
  const player = state.player;
  const initials = player.name.split(/\s+/).map(part => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const relationships = player.relationships?.length
    ? player.relationships.map(relationship => `<li><strong>${escapeHtml(relationship.characterName)}</strong><p>${escapeHtml(relationship.description)}</p></li>`).join("")
    : `<li><p>No relationships recorded yet.</p></li>`;
  return `<div class="sheet-scrim ${sheetOpen ? "open" : ""}" data-sheet-close></div><aside class="character-sheet ${sheetOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Character sheet" aria-hidden="${sheetOpen ? "false" : "true"}" ${sheetOpen ? "" : "inert"}><button class="sheet-close" data-sheet-close aria-label="Close character sheet">×</button><div class="eyebrow">Your character</div><h2>${escapeHtml(player.name)}</h2><div class="sheet-seal">${escapeHtml(initials)}</div><section><p class="character-identity">${escapeHtml(player.gender || "")} · ${escapeHtml(player.delegation || "Visiting emissary")}</p><h3>Biography</h3><p>${escapeHtml(player.lore)}</p></section>${playerStats(player.dnd)}<section class="goal"><h3>Current goal</h3><p>${escapeHtml(player.currentGoal || "No goal yet.")}</p></section><section><h3>Inventory</h3><ul>${state.inventory?.length ? state.inventory.map(item => `<li>${escapeHtml(item.name)}${item.details ? `<p>${escapeHtml(item.details)}</p>` : ""}</li>`).join("") : "<li>Empty</li>"}</ul></section><section><h3>Relationships</h3><ul class="relationship-list">${relationships}</ul></section></aside>`;
}

function debugInspector() {
  const content = debugTab === "alerts" ? alertsView() : debugError
    ? `<p class="debug-error">${escapeHtml(debugError)}</p>`
    : debugData
      ? debugTab === "overview" ? debugOverview(debugRequest.type, debugData, debugSection) : debugTab === "transcripts" ? transcriptView() : `<pre>${escapeHtml(JSON.stringify(debugData, null, 2))}</pre>`
      : `<p class="debug-loading">Reading worker state…</p>`;
  const tabs = `<div class="debug-tabs" role="tablist" aria-label="Debug view">${[["overview", "Browse"], ["json", "Raw JSON"], ["transcripts", "Agent runs & requests"], ["alerts", "Session warnings & errors"]].map(([id, title]) => `<button id="debug-tab-${id}" role="tab" data-debug-tab="${id}" aria-selected="${debugTab === id}" aria-controls="debug-panel" tabindex="${debugTab === id ? 0 : -1}">${title}</button>`).join("")}</div>`;
  const isCharacter = debugRequest.type === "debug_character";
  const sectionTitle = debugSections[debugRequest.type]?.[debugSection];
  const breadcrumbs = `<nav class="debug-breadcrumbs" aria-label="Debug navigation"><button data-debug-home ${debugRequest.type === "debug" && !debugSection ? 'aria-current="page"' : ""}>Overall debug</button>${isCharacter ? '<span>/</span><button data-debug-characters>Characters</button>' : ""}${debugRequest.type !== "debug" ? `<span>/</span><button data-debug-section="" ${!sectionTitle ? 'aria-current="page"' : ""}>${escapeHtml(debugTitle)}</button>` : ""}${sectionTitle ? `<span>/</span><span aria-current="page">${escapeHtml(sectionTitle)}</span>` : ""}</nav>`;
  return `<div class="debug-scrim ${debugOpen ? "open" : ""}" data-debug-close></div><aside class="debug-inspector ${debugOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Debug inspector" aria-hidden="${debugOpen ? "false" : "true"}" ${debugOpen ? "" : "inert"}><header><div><div class="eyebrow">Live worker memory</div><h2>${escapeHtml(debugTitle)}</h2></div><div class="debug-actions"><button data-debug-refresh>Refresh</button><button class="debug-close" data-debug-close aria-label="Close debug inspector">×</button></div></header>${breadcrumbs}<p class="debug-note">${isCharacter ? "Character knowledge and visible notes. Agent runs are filtered to this character." : "Authoritative world state and live activity. Select a section to explore."} API keys are excluded.</p>${tabs}<div id="debug-panel" class="debug-panel" role="tabpanel" aria-labelledby="debug-tab-${debugTab}" tabindex="0">${content}</div></aside>`;
}

function transcriptView() {
  return recentTranscriptsView(debugData?.requests, debugData?.agentRuns, {
    ...transcriptRoute, names: Object.fromEntries((state?.characters || []).map(character => [character.id, character.name])),
  });
}

const refreshDebugTranscripts = coalescedRefresh(async () => {
  if (!debugOpen || debugTab !== "transcripts") return;
  const sequence = debugReadSequence;
  const generation = gameViewGeneration;
  const request = debugRequest;
  const isCurrent = () => debugOpen && debugTab === "transcripts"
    && sequence === debugReadSequence && generation === gameViewGeneration;
  try {
    const data = await rpc("debug_transcripts", {});
    if (!isCurrent()) return;
    debugData = request.type === "debug_character" ? characterTranscripts(data, request.payload.characterId) : data;
    debugError = "";
    const panel = document.querySelector("#debug-panel");
    if (panel) updateTranscriptPanel(panel, transcriptView());
  } catch (error) {
    if (!isCurrent()) return;
    const panel = document.querySelector("#debug-panel");
    if (!panel) return;
    let status = panel.querySelector("[data-refresh-error]");
    if (!status) {
      status = document.createElement("p");
      status.dataset.refreshError = "";
      status.className = "debug-error";
      status.setAttribute("role", "status");
      panel.append(status);
    }
    status.textContent = `Could not refresh requests: ${error.message}. Existing records are still shown.`;
  }
});

async function openDebug(request = debugRequest, title = debugTitle) {
  if (debugOpen && debugTab === "alerts" && request === debugRequest) { alerts.acknowledge(); render(); return; }
  const readSequence = ++debugReadSequence;
  if (!debugOpen || request.type !== debugRequest.type || request.payload.characterId !== debugRequest.payload.characterId) { debugTab = "overview"; debugSection = ""; transcriptRoute = {}; }
  debugOpen = true;
  sheetOpen = false;
  debugRequest = request;
  debugTitle = request.type === "debug_character" ? state.characters.find(item => item.id === request.payload.characterId)?.name || title : title;
  debugData = null;
  debugError = "";
  render();
  try {
    const data = await rpc(debugTab === "transcripts" ? "debug_transcripts" : request.type, request.payload);
    if (readSequence !== debugReadSequence) return;
    debugData = debugTab === "transcripts" && request.type === "debug_character" ? characterTranscripts(data, request.payload.characterId) : data;
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
    app.innerHTML = shell(`<section class="introduction" aria-label="Welcome to Kingmaker"><div class="eyebrow">A roleplaying sandbox · Tech demo</div><h2>Welcome to Kingmaker</h2>${sandboxIntroduction.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}<button class="dialogue-option" data-meet-stranger ${busy ? "disabled" : ""}>Meet the Stranger →</button><p class="status ${notice.startsWith("Error") ? "error" : ""}" role="status">${escapeHtml(notice)}</p></section>`);
    bind(); return;
  }
  app.innerHTML = shell(`<section class="panel"><div class="conversation-head"><div><div class="eyebrow">A private audience with your patron</div><h2>${patronName}</h2></div><button class="character-debug" data-gm-debug>Debug Stranger</button></div><div class="messages">${messageList(messages, patronName)}</div>${replyOptions(state.gmReplyOptions?.options, "gm", state.gmReplyOptions?.compelled)}${state.gmReplyOptions?.compelled ? `<p class="compelled-hint">A powerful force compels you to respond accordingly</p>` : `<form class="composer" data-gm-form><textarea name="message" aria-label="Speak to the Laughing Stranger" placeholder="Invent your story, answer him, or ask for ideas…" required ${busy ? "disabled" : ""}></textarea><button class="primary" ${busy ? "disabled" : ""}>Reply</button></form>`}<p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  bind();
  document.querySelector(".messages")?.scrollTo(0, messages.length === 1 ? 0 : 999999);
}

function renderCharacterReview() {
  reviewDraft ||= structuredClone(state.playerDraft);
  const field = (label, key, value, multiline = false) => `<label>${label}${multiline ? `<textarea data-review-field="${key}" required ${busy ? "disabled" : ""}>${escapeHtml(value || "")}</textarea>` : `<input data-review-field="${key}" value="${escapeHtml(value || "")}" required ${busy ? "disabled" : ""}>`}</label>`;
  const identityFields = reviewDraft.player.delegation
    ? `${field("Gender", "player.gender", reviewDraft.player.gender)}<label>Court affiliation<select data-review-field="player.delegation" ${busy ? "disabled" : ""}>${courtAffiliations.map(id => `<option value="${id}" ${reviewDraft.player.delegation === id ? "selected" : ""}>${id}</option>`).join("")}</select></label>`
    : field("Homeland", "homeland", reviewDraft.homeland);
  const appearanceChoices = reviewDraft.player.delegation ? `<fieldset class="sprite-options" ${busy ? "disabled" : ""}><legend>Your appearance</legend><p class="field-hint">Choose how you appear in court.</p><div class="sprite-grid">${characterSprites.map((sprite, index) => `<label class="sprite-choice"><input type="radio" name="appearance" data-review-field="player.sprite" value="${sprite}" ${reviewDraft.player.sprite === sprite ? "checked" : ""}><span class="court-sprite" style="background-position:${-(sprite % 12) * 32}px ${-Math.floor(sprite / 12) * 32}px" aria-hidden="true"></span><span>Traveller ${index + 1}</span></label>`).join("")}</div></fieldset>` : "";
  const buildSummary = playerStats(reviewDraft.player.dnd, true);
  const transcript = (state.gmMessages || []).filter(message => !(message.role === "user" && message.text.startsWith(handoffPrefix)));
  app.innerHTML = shell(`<section class="panel character-review"><div class="eyebrow">Before you enter Caerwyn</div><h2>Review your character</h2><p>Review what you and the Stranger established. Correct any details before saving your character and entering court.</p><details class="review-transcript"><summary>Conversation with the Stranger</summary><div class="messages">${messageList(transcript, patronName)}</div></details><form data-review-form>${field("Name", "player.name", reviewDraft.player.name)}${identityFields}${appearanceChoices}${field("Role", "embassyRole", reviewDraft.embassyRole)}${field("Biography", "player.lore", reviewDraft.player.lore, true)}${field("Personal goal", "player.currentGoal", reviewDraft.player.currentGoal, true)}${buildSummary}<h3>Relationships</h3>${reviewDraft.player.relationships.map((item, index) => field(`Your view of ${escapeHtml(state.characters.find(character => character.id === item.characterId)?.name || item.characterId)}`, `player.relationships.${index}.description`, item.description, true)).join("")}<h3>Initial impressions of you</h3>${reviewDraft.npcRelationships.map((item, index) => field(escapeHtml(state.characters.find(character => character.id === item.ownerCharacterId)?.name || item.ownerCharacterId), `npcRelationships.${index}.relationship.description`, item.relationship.description, true)).join("")}<button class="primary" ${busy ? "disabled" : ""}>Save character and enter court</button></form><p class="status ${notice.startsWith("Error") ? "error" : ""}" role="status">${escapeHtml(notice)}</p></section>`);
  bind();
}

function renderDay(bindPage = true) {
  const openPopover = app.querySelector(".court-popover:popover-open")?.id;
  app.innerHTML = shell(`<section class="court-panel" aria-label="Palace of Caerwyn"><div data-court-map></div><p class="status ${notice.startsWith("Error") ? "error" : ""}" data-court-notice role="status">${escapeHtml(notice)}</p></section>`, true);
  if (openPopover && !activeCharacter && !sheetOpen && !debugOpen) document.getElementById(openPopover)?.showPopover();
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
    updateCourtMap(mapRoot, state);
    return state.doors;
  }, state.roomAccess, state.fixtures, state.fixtureActions, async actionId => {
    const result = await rpc("interact_fixture", { actionId });
    state = result.state; saves = result.saves; notice = result.message;
    updateCourtMap(mapRoot, state); updateNpcPanel(); updatePlayerFeed();
    const status = document.querySelector("[data-court-notice]");
    if (status) { status.textContent = notice; status.classList.toggle("error", notice.startsWith("Error")); }
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

function conversationNoticeView() {
  const waitingText = notice.replace(/(?:\.\.\.|…|\.)$/, "");
  const waitingMessage = busy && waitingText && !notice.startsWith("Error")
    ? `<div class="message waiting" role="status"><span class="speaker">Scene</span>${escapeHtml(waitingText)}<span class="waiting-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></div>`
    : "";
  return { waitingMessage, statusMessage: waitingMessage ? "" : notice };
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
  const { waitingMessage, statusMessage } = conversationNoticeView();
  renderDay(false);
  const dialog = document.createElement("dialog");
  dialog.className = "conversation-modal";
  dialog.setAttribute("aria-label", `Conversation with ${character.name}`);
  dialog.innerHTML = `<section class="panel"><div class="conversation-head"><button class="back" data-end-conversation ${busy ? "disabled" : ""}>${busy ? "Please wait…" : ended ? "Return to palace" : ending ? "Finish conversation review" : "End conversation"}</button><div class="conversation-tools"><span class="eyebrow">A private audience</span><button class="character-debug" data-character-debug>⌘ Debug ${escapeHtml(character.name)}</button></div></div><h2>${escapeHtml(character.name)}</h2><div class="messages">${messages.length ? messageList(messages, character.name) : `<div class="message character"><span class="speaker">Scene</span>${escapeHtml(character.name)} waits for you to speak first.<span class="earshot">${escapeHtml(earshotMessage)}</span></div>`}${waitingMessage}</div>${ended || ending ? `<p class="scene">${escapeHtml(character.name)} has ended the conversation. You can return to the palace while their memories and next goal are reviewed.</p>` : `${replyOptions(state.conversationReplyOptions?.[activeCharacter], activeCharacter)}<form class="composer" data-talk-form><textarea name="message" placeholder="What do you say?" required ${busy ? "disabled" : ""}></textarea><div class="composer-actions"><button class="primary" ${busy ? "disabled" : ""}>Speak</button><button type="submit" data-respond-and-close ${busy ? "disabled" : ""}>Speak &amp; leave</button></div></form>`}<p class="status ${statusMessage.startsWith("Error") ? "error" : ""}">${escapeHtml(statusMessage)}</p></section>`;
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

function reviewConversation(characterId, message) {
  if (conversationReviews.has(characterId) && !conversationReviews.get(characterId).error) return;
  const review = {};
  conversationReviews.set(characterId, review);
  void rpc("end_conversation", { characterId, ...(message === undefined ? {} : { message }) }).then(result => {
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

function submitComposerOnEnter(form, event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!busy) form.requestSubmit();
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
    reviewDraft = null; const result = await rpc("create_game"); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game";
  }));
  document.querySelector("[data-skip-character]")?.addEventListener("click", () => run(async () => {
    reviewDraft = null; const result = await rpc("create_development_game"); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game";
  }));
  document.querySelectorAll("[data-save-load]").forEach(button => button.addEventListener("click", () => run(async () => {
    reviewDraft = null; const result = await rpc("load_game", { saveId: button.dataset.saveLoad }); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game";
  })));
  document.querySelectorAll("[data-save-delete]").forEach(button => button.addEventListener("click", () => run(async () => {
    const result = await rpc("delete_game", { saveId: button.dataset.saveDelete }); saves = result.saves;
  })));
  document.querySelector("[data-games]")?.addEventListener("click", () => { state = null; activeSaveId = null; activeCharacter = null; screen = "saves"; render(); });
  document.querySelector("[data-report-issue]")?.addEventListener("click", openIssueReporter);
  document.querySelector("[data-sheet-open]")?.addEventListener("click", () => { sheetOpen = true; debugOpen = false; render(); });
  document.querySelectorAll("[data-sheet-close]").forEach(button => button.addEventListener("click", () => { sheetOpen = false; render(); }));
  document.querySelector("[data-debug-open]")?.addEventListener("click", () => { debugSection = ""; debugTab = "overview"; openDebug({ type: "debug", payload: {} }, "Overall debug"); });
  const debugButton = document.querySelector("[data-debug-open]");
  if (debugButton) debugButton.insertAdjacentHTML("beforebegin", alertBell());
  bindAlertBell();
  bindAlertClear();
  document.querySelector("[data-gm-debug]")?.addEventListener("click", () => openDebug({ type: "debug_gm", payload: {} }, "Laughing Stranger Debug"));
  document.querySelector("[data-character-debug]")?.addEventListener("click", () => {
    const character = state.characters.find(item => item.id === activeCharacter);
    openDebug({ type: "debug_character", payload: { characterId: activeCharacter } }, `${character?.name || activeCharacter} Debug`);
  });
  const debugHome = async (section = "") => {
    debugTab = "overview";
    await openDebug({ type: "debug", payload: {} }, "Overall debug");
    debugSection = section; render();
    document.querySelector("#debug-panel")?.focus();
  };
  document.querySelector("[data-debug-home]")?.addEventListener("click", () => debugHome());
  document.querySelector("[data-debug-characters]")?.addEventListener("click", () => debugHome("characters"));
  document.querySelectorAll("[data-debug-section]").forEach(button => button.addEventListener("click", async () => {
    debugSection = button.dataset.debugSection;
    const reload = debugTab !== "overview";
    debugTab = "overview";
    if (reload) await openDebug(); else render();
    document.querySelector("#debug-panel")?.focus();
  }));
  document.querySelectorAll("[data-debug-character]").forEach(button => button.addEventListener("click", async () => {
    const id = button.dataset.debugCharacter;
    await openDebug({ type: "debug_character", payload: { characterId: id } }, state.characters.find(item => item.id === id)?.name || id);
    document.querySelector("#debug-panel")?.focus();
  }));
  document.querySelector("#debug-panel")?.addEventListener("click", event => {
    const session = event.target.closest("[data-transcript-session]");
    const call = event.target.closest("[data-transcript-call]");
    if (!session && !call) return;
    transcriptRoute = session ? { session: session.dataset.transcriptSession } : { ...transcriptRoute, call: call.dataset.transcriptCall };
    const panel = document.querySelector("#debug-panel");
    panel.innerHTML = transcriptView();
    panel.scrollTop = 0;
    panel.focus();
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
      select(event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]);
    });
  });
  document.querySelectorAll("[data-objective-override]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button"), status = form.querySelector("[data-objective-status]");
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "Saving…";
    const sequence = debugReadSequence, generation = gameViewGeneration;
    try {
      const result = await rpc("debug_override_objective", {
        characterId: form.dataset.objectiveOverride, objective: Object.fromEntries(new FormData(form)),
      });
      if (generation !== gameViewGeneration) return;
      state = result.state; saves = result.saves;
      if (debugOpen && sequence === debugReadSequence) await openDebug();
    } catch (error) {
      status.textContent = error.message;
    } finally { button.disabled = false; }
  }));
  document.querySelector("[data-debug-refresh]")?.addEventListener("click", () => debugTab === "transcripts" ? refreshDebugTranscripts() : openDebug());
  document.querySelectorAll("[data-debug-close]").forEach(button => button.addEventListener("click", () => { debugOpen = false; render(); }));
  document.querySelector("[data-meet-stranger]")?.addEventListener("click", () => run(async () => {
    const result = await rpc("start_introduction"); state = result.state; saves = result.saves;
  }));
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
    owner[path.at(-1)] = input.type === "number" || input.dataset.reviewField === "player.sprite" ? (input.value === "" ? null : Number(input.value)) : input.value;
  }));
  document.querySelector("[data-review-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    run(async () => {
      const result = await rpc("save_character", { draft: reviewDraft });
      state = result.state; saves = result.saves; reviewDraft = null;
    });
  });
  const gmForm = document.querySelector("[data-gm-form]");
  gmForm?.querySelector("textarea")?.addEventListener("keydown", event => submitComposerOnEnter(gmForm, event));
  gmForm?.addEventListener("submit", event => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message");
    run(async () => { const result = await rpc("gm", { message }); state = result.state; saves = result.saves; });
  });
  const talkForm = document.querySelector("[data-talk-form]");
  talkForm?.querySelector("textarea")?.addEventListener("keydown", event => submitComposerOnEnter(talkForm, event));
  talkForm?.addEventListener("submit", event => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message");
    if (event.submitter?.hasAttribute("data-respond-and-close")) {
      const characterId = activeCharacter;
      activeCharacter = null; notice = "";
      reviewConversation(characterId, message);
      render();
      return;
    }
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
  document.querySelector("[data-reset]")?.addEventListener("click", () => run(async () => { reviewDraft = null; const result = await rpc("reset"); state = result.state; saves = result.saves; activeCharacter = null; sheetOpen = false; debugOpen = false; }));
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
