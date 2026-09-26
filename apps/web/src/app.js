import { debugOverview, recentTranscriptsView } from "./debug-view.js";
import { mountCourtMap, animateCourtCharacter } from "./court-map.js";
import { introduction, introductionHandoff, handoffPrefix, nameSuggestions, homelandSuggestions, patronName } from "./introduction.js";

const app = document.querySelector("#app");
let state;
let activeCharacter = null;
let closedConversation = null;
let busy = false;
let npcRun = null;
let npcStatus = "";
let npcTrace = [];
let notice = "";
let sheetOpen = false;
let debugOpen = false;
let debugTab = "overview";
let debugReadSequence = 0;
let debugData = null;
let debugError = "";
let debugTitle = "Debug Inspector";
let debugRequest = { type: "debug", payload: {} };
const apiKeyStorageKey = "kingmaker.openrouter-api-key";
let apiKey = "";
try { apiKey = sessionStorage.getItem(apiKeyStorageKey)?.trim() || ""; }
catch { /* The app still works when browser storage is unavailable. */ }
let screen = "key";
let introPage = 0;
let reviewDraft = null;
let traveller = { name: "", homeland: "" };
let saves = [];
let activeSaveId = null;
let requestSequence = 0;

const gameWorker = new Worker(new URL("./game.worker.ts", import.meta.url), { type: "module" });
const pendingRequests = new Map();
gameWorker.addEventListener("message", event => {
  if (event.data.type === "transcripts_changed") {
    if (debugOpen && debugTab === "transcripts") void openDebug();
    return;
  }
  const pending = pendingRequests.get(event.data.id);
  if (!pending) return;
  pendingRequests.delete(event.data.id);
  if (event.data.ok) pending.resolve(event.data.value);
  else pending.reject(new Error(event.data.error));
});

function rpc(type, payload = {}) {
  if (["reset_world", "reset_characters", "reset", "load_game", "create_game", "configure", "delete_game"].includes(type)) stopNpcGoal();
  const id = ++requestSequence;
  gameWorker.postMessage({ id, type, payload });
  return new Promise((resolve, reject) => pendingRequests.set(id, { resolve, reject }));
}

function stopNpcGoal() {
  if (!npcRun) return;
  const characterId = npcRun.characterId;
  npcRun.abort(); npcRun = null; npcStatus = "Jev stopped.";
  void rpc("finish_npc", { characterId, reason: "cancelled", detail: "The player stopped the run." }).catch(() => {});
  void rpc("cancel_npc").catch(() => {});
}

async function runNpcGoal(characterId, queued = [], handoffs = 3) {
  if (state.npcActivities?.[characterId]?.status !== "active") return;
  stopNpcGoal();
  const controller = new AbortController(); controller.characterId = characterId; npcRun = controller; npcTrace = [];
  const name = state.characters.find(item => item.id === characterId)?.name || characterId;
  const active = () => npcRun === controller && !controller.signal.aborted;
  try {
    for (let round = 0; round < 3 && active(); round++) {
      let reason = "limit", detail = "Stopped at the 24-action limit.";
      try {
        for (let step = 0; step < 24 && active(); step++) {
          npcStatus = `${name}: Jev is choosing action ${step + 1}…`; render();
          const plan = await rpc("plan_npc", { characterId });
          if (!active()) return;
          npcTrace.push(plan);
          if (plan.decision.choice === "complete" || plan.decision.choice === "unable") {
            reason = plan.decision.choice; detail = JSON.stringify(plan.decision); break;
          }
          if (!plan.action) throw new Error("Jev returned no available action.");
          npcStatus = `${name}: ${plan.action.description}`; render();
          await animateCourtCharacter(app, characterId, plan.action.path, controller.signal);
          if (!active()) return;
          const result = await rpc("execute_npc", { characterId, actionId: plan.action.id, revision: plan.revision, goal: plan.goal });
          if (!active()) return;
          state = result.state; saves = result.saves;
          if (plan.action.type === "talk") {
            if (state.npcActivities[plan.action.target]?.status === "active") queued.push(plan.action.target);
            if (state.npcActivities[characterId]?.status !== "active") { npcStatus = `${name}: idle after conversation.`; return; }
          }
        }
      } catch (error) { if (!active()) return; reason = "error"; detail = error.message; }
      if (!active()) return;
      const finished = await rpc("finish_npc", { characterId, reason, detail });
      state = finished.state; saves = finished.saves;
      npcStatus = `${name}: reviewing Jev's ${reason} result…`; render();
      const reviewed = await rpc("review_npc", { characterId, allowNextGoal: round < 2 });
      state = reviewed.state; saves = reviewed.saves;
      if (!active()) return;
      if (state.npcActivities[characterId].status !== "active") {
        npcStatus = `${name}: idle${round === 2 ? " (automatic replanning limit reached)" : ""}.`; break;
      }
    }
  } catch (error) { if (active()) npcStatus = `${name}: ${error.message} Outcome saved for review retry.`; }
  finally { if (npcRun === controller) {
    npcRun = null; render();
    const next = queued.find(id => state.npcActivities[id]?.status === "active");
    if (next && handoffs > 0 && !controller.signal.aborted) void runNpcGoal(next, queued.filter(id => id !== next), handoffs - 1);
  } }
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
    npcTrace = []; npcStatus = "";
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
  return `${state ? `<button class="debug-button" data-debug-open aria-label="Open debug inspector">⌘ <span>Debug</span></button>` : ""}${sheetButton}<div class="shell"><header class="masthead"><div class="eyebrow">An improvised political cRPG</div><h1>Kingmaker</h1><div class="rule"></div><p class="subtitle">Whoever holds the Crown of Winter at solstice dawn will rule.</p></header>${content}<div class="footer">${gameControls}${keyControl}</div></div>${sheet}${debugInspector()}`;
}

function renderKeyEntry() {
  app.innerHTML = shell(`<section class="panel key-entry"><div><div class="eyebrow">Connect your model</div><h2>Enter an OpenRouter key</h2><p>The key stays in this browser tab across reloads and is never included in game saves or debug output.</p><form data-key-form><input type="password" name="apiKey" autocomplete="off" placeholder="sk-or-v1-…" required><button class="primary" ${busy ? "disabled" : ""}>${busy ? "Connecting…" : "Continue"}</button></form><p class="status ${notice.startsWith("Error") ? "error" : ""}" role="status">${escapeHtml(notice)}</p></div></section>`);
  bind();
}

function renderSavePicker() {
  const games = saves.length
    ? `<div class="save-list">${saves.map(save => `<article class="save-card"><button class="save-load" data-save-load="${escapeHtml(save.id)}"><strong>${escapeHtml(save.characterName)}</strong><span>Last played ${escapeHtml(new Date(save.updatedAt).toLocaleString())}</span></button><button class="save-delete" data-save-delete="${escapeHtml(save.id)}" aria-label="Delete ${escapeHtml(save.characterName)}">×</button></article>`).join("")}</div>`
    : `<p class="empty-saves">No emissaries have entered the Great Hall on this device.</p>`;
  app.innerHTML = shell(`<section class="panel save-picker"><div class="conversation-head"><div><div class="eyebrow">Local chronicles</div><h2>Choose an emissary</h2></div><button class="primary" data-new-game>New game</button></div>${games}<p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  bind();
}

function characterSheet() {
  const player = state.player;
  const initials = player.name.split(/\s+/).map(part => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const relationships = player.relationships?.length
    ? player.relationships.map(relationship => `<li><strong>${escapeHtml(relationship.characterName)}</strong><p>${escapeHtml(relationship.description)}</p></li>`).join("")
    : `<li><p>No relationships recorded yet.</p></li>`;
  return `<div class="sheet-scrim ${sheetOpen ? "open" : ""}" data-sheet-close></div><aside class="character-sheet ${sheetOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Character sheet" aria-hidden="${sheetOpen ? "false" : "true"}"><button class="sheet-close" data-sheet-close aria-label="Close character sheet">×</button><div class="eyebrow">Your character</div><h2>${escapeHtml(player.name)}</h2><div class="sheet-seal">${escapeHtml(initials)}</div><section><h3>Biography</h3><p>${escapeHtml(player.lore)}</p></section><section class="goal"><h3>Current goal</h3><p>${escapeHtml(player.currentGoal || "No goal yet.")}</p></section><section><h3>Inventory</h3><ul>${state.inventory?.length ? state.inventory.map(item => `<li>${escapeHtml(item.name)}</li>`).join("") : "<li>Empty</li>"}</ul></section><section><h3>Relationships</h3><ul class="relationship-list">${relationships}</ul></section></aside>`;
}

function debugInspector() {
  const content = debugError
    ? `<p class="debug-error">${escapeHtml(debugError)}</p>`
    : debugData
      ? debugTab === "overview" ? debugOverview(debugRequest.type, debugData) : debugTab === "transcripts" ? recentTranscriptsView(debugData.transcripts) : `<pre>${escapeHtml(JSON.stringify(debugData, null, 2))}</pre>`
      : `<p class="debug-loading">Reading worker state…</p>`;
  const tabs = `<div class="debug-tabs" role="tablist" aria-label="Debug view">${[["overview", "Overview"], ["json", "Raw JSON"], ["transcripts", "Recent transcripts"]].map(([id, title]) => `<button id="debug-tab-${id}" role="tab" data-debug-tab="${id}" aria-selected="${debugTab === id}" aria-controls="debug-panel" tabindex="${debugTab === id ? 0 : -1}">${title}</button>`).join("")}</div>`;
  return `<div class="debug-scrim ${debugOpen ? "open" : ""}" data-debug-close></div><aside class="debug-inspector ${debugOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Debug inspector" aria-hidden="${debugOpen ? "false" : "true"}"><header><div><div class="eyebrow">Live worker memory</div><h2>${escapeHtml(debugTitle)}</h2></div><div class="debug-actions"><button data-debug-refresh>Refresh</button><button class="debug-close" data-debug-close aria-label="Close debug inspector">×</button></div></header><p class="debug-note">Character state, visible events, known world, conversation, and assembled model context. The global inspector includes the authoritative world. GM debug includes prompts, raw model responses, and tool results—not hidden reasoning. API keys are excluded.</p>${tabs}<div id="debug-panel" class="debug-panel" role="tabpanel" aria-labelledby="debug-tab-${debugTab}" tabindex="0">${content}</div></aside>`;
}

async function openDebug(request = debugRequest, title = debugTitle) {
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
      content = `${introduction[introPage].map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}<button class="dialogue-option" data-intro-next>${introPage === introduction.length - 1 ? "Embark..." : "Continue..."}</button>`;
    } else if (introPage === introduction.length) {
      content = `<p>On the road to Caerwyn, every traveller has a name and a place they call home.</p><form data-traveller-form><label for="traveller-name">Your name</label><div class="identity-field"><input id="traveller-name" name="name" value="${escapeHtml(traveller.name)}" maxlength="80" required autocomplete="off"><button type="button" data-roll="name" aria-label="Generate a name">⚄</button></div><label for="traveller-homeland">Where are you from?</label><p class="field-hint" id="homeland-hint">Your homeland is a vassal state of Caerwyn. Invent one, or roll the dice.</p><div class="identity-field"><input id="traveller-homeland" name="homeland" value="${escapeHtml(traveller.homeland)}" maxlength="80" required aria-describedby="homeland-hint" autocomplete="off"><button type="button" data-roll="homeland" aria-label="Generate a homeland">⚄</button></div><button class="dialogue-option">Continue...</button></form>`;
    } else {
      content = `<p>On the road from ${escapeHtml(traveller.homeland)}, you, ${escapeHtml(traveller.name)}, encounter a stranger at a crossroads. He sits on a milestone beneath a bare winter tree, turning a coin between his fingers. He laughs knowingly as you approach.</p><button class="dialogue-option" data-begin ${busy ? "disabled" : ""}>Continue...</button>`;
    }
    app.innerHTML = shell(`<section class="introduction" aria-label="Your journey" tabindex="-1">${content}<p class="status ${notice.startsWith("Error") ? "error" : ""}" role="status">${escapeHtml(notice)}</p></section>`);
    return bind();
  }
  app.innerHTML = shell(`<section class="panel"><div class="conversation-head"><div><div class="eyebrow">A private audience with your patron</div><h2>${patronName}</h2></div><button class="character-debug" data-gm-debug>Debug Stranger</button></div><div class="messages">${messageList(messages, patronName)}</div>${replyOptions(state.gmReplyOptions?.options, "gm", state.gmReplyOptions?.compelled)}${state.gmReplyOptions?.compelled ? `<p class="compelled-hint">A powerful force compels you to respond accordingly</p>` : `<form class="composer" data-gm-form><textarea name="message" aria-label="Speak to the Laughing Stranger" placeholder="Tell him what you desire…" required ${busy ? "disabled" : ""}></textarea><button class="primary" ${busy ? "disabled" : ""}>Reply</button></form>`}<p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  bind();
  document.querySelector(".messages")?.scrollTo(0, 999999);
}

function renderCharacterReview() {
  reviewDraft ||= structuredClone(state.playerDraft);
  const field = (label, key, value, multiline = false) => `<label>${label}${multiline ? `<textarea data-review-field="${key}" required ${busy ? "disabled" : ""}>${escapeHtml(value || "")}</textarea>` : `<input data-review-field="${key}" value="${escapeHtml(value || "")}" required ${busy ? "disabled" : ""}>`}</label>`;
  app.innerHTML = shell(`<section class="panel character-review"><div class="eyebrow">Before you enter Caerwyn</div><h2>Review your character</h2><p>Edit any details before saving your character and entering the court.</p><form data-review-form>${field("Name", "player.name", reviewDraft.player.name)}${field("Homeland", "homeland", reviewDraft.homeland)}${field("Role", "embassyRole", reviewDraft.embassyRole)}${field("Biography", "player.lore", reviewDraft.player.lore, true)}${field("Personal goal", "player.currentGoal", reviewDraft.player.currentGoal, true)}<h3>Relationships</h3>${reviewDraft.player.relationships.map((item, index) => field(`Your view of ${escapeHtml(state.characters.find(character => character.id === item.characterId)?.name || item.characterId)}`, `player.relationships.${index}.description`, item.description, true)).join("")}<h3>Initial impressions of you</h3>${reviewDraft.npcRelationships.map((item, index) => field(escapeHtml(state.characters.find(character => character.id === item.ownerCharacterId)?.name || item.ownerCharacterId), `npcRelationships.${index}.relationship.description`, item.relationship.description, true)).join("")}<button class="primary" ${busy ? "disabled" : ""}>Save character and enter court</button></form><p class="status ${notice.startsWith("Error") ? "error" : ""}" role="status">${escapeHtml(notice)}</p></section>`);
  bind();
}

function renderDay(bindPage = true) {
  const playerName = state.player?.name || "The Emissary";
  app.innerHTML = shell(`<section class="panel court-panel"><div class="day-heading"><div><div class="eyebrow">Palace of Caerwyn</div><h2>Welcome to court, <span class="player-name">${escapeHtml(playerName)}</span></h2></div></div><p class="scene">Left-click to walk around the palace. Right-click characters and objects to see their actions.</p><div data-court-map></div>${npcStatus || Object.values(state.npcActivities || {}).some(activity => activity.reviewPending || activity.status === "active") ? `<section class="npc-planner"><p role="status">${escapeHtml(npcStatus)}</p>${npcRun ? `<button data-stop-npc>Stop Jev</button>` : ""}${!npcRun ? Object.entries(state.npcActivities || {}).filter(([, activity]) => activity.reviewPending || activity.status === "active").map(([id, activity]) => `<button data-npc-continue="${escapeHtml(id)}">${activity.reviewPending ? "Review outcome" : "Resume goal"} · ${escapeHtml(state.characters.find(character => character.id === id)?.name || id)}</button>`).join("") : ""}<details><summary>Jev decisions and world context</summary><pre>${escapeHtml(JSON.stringify(npcTrace, null, 2))}</pre></details></section>` : ""}<div class="court-day-footer"><span class="map-credit">Tiny Dungeon tiles by Kenney · CC0</span></div><p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
  if (bindPage) bind();
  const mapRoot = document.querySelector("[data-court-map]");
  void mountCourtMap(mapRoot, state.characters, state.player, id => {
    if (busy || !mapRoot.isConnected) return;
    activeCharacter = id; closedConversation = null; notice = ""; render();
  }, busy || !!npcRun, async point => {
    const result = await rpc("move_player", point);
    state = result.state; saves = result.saves;
  }, state.doors, async (id, open) => {
    const result = await rpc("set_door", { id, open });
    state = result.state; saves = result.saves;
    return state.doors;
  }, state.roomAccess, state.fixtures, state.fixtureActions, async actionId => {
    const result = await rpc("interact_fixture", { actionId });
    state = result.state; saves = result.saves; notice = result.message; render();
  }).catch(() => {
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
  renderDay(false);
  const dialog = document.createElement("dialog");
  dialog.className = "conversation-modal";
  dialog.setAttribute("aria-label", `Conversation with ${character.name}`);
  dialog.innerHTML = `<section class="panel"><div class="conversation-head"><button class="back" data-end-conversation ${busy ? "disabled" : ""}>${busy ? "Please wait…" : ended ? "Return to palace" : ending ? "Finish conversation review" : "End conversation"}</button><div class="conversation-tools"><span class="eyebrow">A private audience</span><button class="character-debug" data-character-debug>⌘ Debug ${escapeHtml(character.name)}</button></div></div><h2>${escapeHtml(character.name)}</h2><div class="messages">${messages.length ? messageList(messages, character.name) : `<div class="message character"><span class="speaker">Scene</span>${escapeHtml(character.name)} waits for you to speak first.</div>`}</div>${ended || ending ? `<p class="scene">${escapeHtml(character.name)} has ended the conversation.${ended ? " Their memories and goal have been reviewed." : " Saving their memories and next goal."}</p>` : `${replyOptions(state.conversationReplyOptions?.[activeCharacter], activeCharacter)}<form class="composer" data-talk-form><textarea name="message" placeholder="What do you say?" required ${busy ? "disabled" : ""}></textarea><button class="primary" ${busy ? "disabled" : ""}>Speak</button></form>`}<p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`;
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
  if (activeCharacter) return renderConversation();
  renderDay();
}

async function talkAndReview(characterId, message) {
  const response = await rpc("talk", { characterId, message });
  state = response.state; saves = response.saves;
  if (!state.conversationEndRequested?.[characterId]) return;
  const messages = state.conversations?.[characterId] || [];
  notice = "Remembering the conversation…"; render();
  const reviewed = await rpc("end_conversation", { characterId });
  state = reviewed.state; saves = reviewed.saves;
  closedConversation = { id: characterId, messages };
  void runNpcGoal(characterId);
}

async function run(action) {
  if (busy) return;
  busy = true; notice = state?.phase === "player_creation" ? "Somewhere in the dark, the Stranger smiles…" : "The court considers your words…"; render();
  try { await action(); notice = ""; }
  catch (error) { notice = `Error: ${error.message}`; }
  finally { busy = false; render(); }
}

function bind() {
  document.querySelectorAll("[data-npc-continue]").forEach(button => button.addEventListener("click", () => run(async () => {
    const characterId = button.dataset.npcContinue;
    if (state.npcActivities?.[characterId]?.reviewPending) {
      const result = await rpc("review_npc", { characterId }); state = result.state; saves = result.saves;
    }
    void runNpcGoal(characterId);
  })));

  document.querySelector("[data-stop-npc]")?.addEventListener("click", async () => { stopNpcGoal(); render(); const result = await rpc("state"); state = result.state; render(); });
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
    introPage = 0; reviewDraft = null; traveller = { name: "", homeland: "" }; const result = await rpc("create_game"); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game";
  }));
  document.querySelectorAll("[data-save-load]").forEach(button => button.addEventListener("click", () => run(async () => {
    introPage = 0; reviewDraft = null; traveller = { name: "", homeland: "" }; const result = await rpc("load_game", { saveId: button.dataset.saveLoad }); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game";
  })));
  document.querySelectorAll("[data-save-delete]").forEach(button => button.addEventListener("click", () => run(async () => {
    const result = await rpc("delete_game", { saveId: button.dataset.saveDelete }); saves = result.saves;
  })));
  document.querySelector("[data-games]")?.addEventListener("click", () => { state = null; activeSaveId = null; activeCharacter = null; screen = "saves"; render(); });
  document.querySelector("[data-sheet-open]")?.addEventListener("click", () => { sheetOpen = true; debugOpen = false; render(); });
  document.querySelectorAll("[data-sheet-close]").forEach(button => button.addEventListener("click", () => { sheetOpen = false; render(); }));
  document.querySelector("[data-debug-open]")?.addEventListener("click", () => openDebug({ type: "debug", payload: {} }, "Debug Inspector"));
  document.querySelector("[data-gm-debug]")?.addEventListener("click", () => openDebug({ type: "debug_gm", payload: {} }, "Laughing Stranger Debug"));
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
      const tabs = ["overview", "json", "transcripts"];
      const index = tabs.indexOf(debugTab);
      select(event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3]);
    });
  });
  document.querySelector("[data-debug-refresh]")?.addEventListener("click", () => openDebug());
  document.querySelectorAll("[data-debug-close]").forEach(button => button.addEventListener("click", () => { debugOpen = false; render(); }));
  document.querySelector("[data-intro-next]")?.addEventListener("click", () => { introPage += 1; render(); document.querySelector(".introduction")?.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  document.querySelectorAll("[data-roll]").forEach(button => button.addEventListener("click", () => {
    const field = button.dataset.roll;
    const input = document.querySelector(`[name="${field}"]`);
    const suggestions = (field === "name" ? nameSuggestions : homelandSuggestions).filter(value => value !== input.value);
    input.value = suggestions[Math.floor(Math.random() * suggestions.length)];
    traveller[field] = input.value;
    input.focus();
  }));
  document.querySelector("[data-traveller-form]")?.addEventListener("input", event => { if (event.target.name) traveller[event.target.name] = event.target.value; });
  document.querySelector("[data-traveller-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    for (const field of ["name", "homeland"]) {
      const input = form.elements.namedItem(field);
      input.value = input.value.trim();
      if (!input.reportValidity()) return;
      traveller[field] = input.value;
    }
    introPage += 1; render(); document.querySelector(".introduction")?.focus({ preventScroll: true }); window.scrollTo(0, 0);
  });
  document.querySelector("[data-begin]")?.addEventListener("click", () => run(async () => {
    const result = await rpc("gm", { message: introductionHandoff(traveller.name, traveller.homeland) }); state = result.state; saves = result.saves;
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
    owner[path.at(-1)] = input.value;
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
    if (closedConversation?.id === activeCharacter) { activeCharacter = null; closedConversation = null; notice = ""; render(); return; }
    void run(async () => {
    notice = "Remembering your conversation…"; render();
    const characterId = activeCharacter;
    const result = await rpc("end_conversation", { characterId });
    state = result.state; saves = result.saves; activeCharacter = null;
    void runNpcGoal(characterId);
    });
  });
  document.querySelector("[data-reset]")?.addEventListener("click", () => run(async () => { introPage = 0; reviewDraft = null; traveller = { name: "", homeland: "" }; const result = await rpc("reset"); state = result.state; saves = result.saves; activeCharacter = null; sheetOpen = false; debugOpen = false; }));
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
