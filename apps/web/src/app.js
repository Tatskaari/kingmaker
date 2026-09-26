import { introduction, introductionHandoff, handoffPrefix, nameSuggestions, homelandSuggestions, patronName } from "./introduction.js";

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
let debugRequest = { type: "debug", payload: {} };
let apiKey = "";
let screen = "key";
let introPage = 0;
let traveller = { name: "", homeland: "" };
let saves = [];
let activeSaveId = null;
let requestSequence = 0;

const gameWorker = new Worker(new URL("./game.worker.ts", import.meta.url), { type: "module" });
const pendingRequests = new Map();
gameWorker.addEventListener("message", event => {
  const pending = pendingRequests.get(event.data.id);
  if (!pending) return;
  pendingRequests.delete(event.data.id);
  if (event.data.ok) pending.resolve(event.data.value);
  else pending.reject(new Error(event.data.error));
});

function rpc(type, payload = {}) {
  const id = ++requestSequence;
  gameWorker.postMessage({ id, type, payload });
  return new Promise((resolve, reject) => pendingRequests.set(id, { resolve, reject }));
}

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
  app.innerHTML = shell(`<section class="panel key-entry"><div><div class="eyebrow">Connect your model</div><h2>Enter an OpenRouter key</h2><p>The key stays in this browser tab and is never included in game saves or debug output.</p><form data-key-form><input type="password" name="apiKey" autocomplete="off" placeholder="sk-or-v1-…" required><button class="primary">Continue</button></form></div></section>`);
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
  return `<div class="sheet-scrim ${sheetOpen ? "open" : ""}" data-sheet-close></div><aside class="character-sheet ${sheetOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Character sheet" aria-hidden="${sheetOpen ? "false" : "true"}"><button class="sheet-close" data-sheet-close aria-label="Close character sheet">×</button><div class="eyebrow">Your character</div><h2>${escapeHtml(player.name)}</h2><div class="sheet-seal">${escapeHtml(initials)}</div><section><h3>Biography</h3><p>${escapeHtml(player.lore)}</p></section><section class="goal"><h3>Current goal</h3><p>${escapeHtml(player.currentGoal || "No goal yet.")}</p></section><section><h3>Relationships</h3><ul class="relationship-list">${relationships}</ul></section></aside>`;
}

function debugInspector() {
  const content = debugError
    ? `<p class="debug-error">${escapeHtml(debugError)}</p>`
    : debugData
      ? `<pre>${escapeHtml(JSON.stringify(debugData, null, 2))}</pre>`
      : `<p class="debug-loading">Reading worker state…</p>`;
  return `<div class="debug-scrim ${debugOpen ? "open" : ""}" data-debug-close></div><aside class="debug-inspector ${debugOpen ? "open" : ""}" role="dialog" aria-modal="true" aria-label="Debug inspector" aria-hidden="${debugOpen ? "false" : "true"}"><header><div><div class="eyebrow">Live worker memory</div><h2>${escapeHtml(debugTitle)}</h2></div><div class="debug-actions"><button data-debug-refresh>Refresh</button><button class="debug-close" data-debug-close aria-label="Close debug inspector">×</button></div></header><p class="debug-note">Character state, visible events, known world, conversation, and assembled model context. The global inspector includes the authoritative world. Secrets and API keys are excluded.</p>${content}</aside>`;
}

async function openDebug(request = debugRequest, title = debugTitle) {
  debugOpen = true;
  sheetOpen = false;
  debugRequest = request;
  debugTitle = title;
  debugData = null;
  debugError = "";
  render();
  try { debugData = await rpc(debugRequest.type, debugRequest.payload); }
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
  app.innerHTML = shell(`<section class="panel"><div class="conversation-head"><div><div class="eyebrow">A private audience with your patron</div><h2>${patronName}</h2></div></div><div class="messages">${messageList(messages, patronName)}</div><form class="composer" data-gm-form><textarea name="message" aria-label="Speak to the Laughing Stranger" placeholder="Tell him what you desire…" required ${busy ? "disabled" : ""}></textarea><button class="primary" ${busy ? "disabled" : ""}>Reply</button></form><p class="status ${notice.startsWith("Error") ? "error" : ""}">${escapeHtml(notice)}</p></section>`);
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
  if (screen === "saves") return renderSavePicker();
  if (!state) return;
  if (state.phase === "player_creation") return renderCreation();
  if (activeCharacter) return renderConversation();
  renderDay();
}

async function run(action) {
  busy = true; notice = state?.phase === "player_creation" ? "Somewhere in the dark, the Stranger smiles…" : "The court considers your words…"; render();
  try { await action(); notice = ""; }
  catch (error) { notice = `Error: ${error.message}`; }
  finally { busy = false; render(); }
}

function bind() {
  document.querySelector("[data-key-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    apiKey = String(new FormData(event.currentTarget).get("apiKey") || "").trim();
    run(async () => { const result = await rpc("configure", { apiKey }); saves = result.saves; screen = "saves"; });
  });
  document.querySelector("[data-key-change]")?.addEventListener("click", () => { apiKey = ""; state = null; screen = "key"; render(); });
  document.querySelector("[data-new-game]")?.addEventListener("click", () => run(async () => {
    introPage = 0; traveller = { name: "", homeland: "" }; const result = await rpc("create_game"); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game";
  }));
  document.querySelectorAll("[data-save-load]").forEach(button => button.addEventListener("click", () => run(async () => {
    introPage = 0; traveller = { name: "", homeland: "" }; const result = await rpc("load_game", { saveId: button.dataset.saveLoad }); state = result.state; saves = result.saves; activeSaveId = result.activeSaveId; screen = "game";
  })));
  document.querySelectorAll("[data-save-delete]").forEach(button => button.addEventListener("click", () => run(async () => {
    const result = await rpc("delete_game", { saveId: button.dataset.saveDelete }); saves = result.saves;
  })));
  document.querySelector("[data-games]")?.addEventListener("click", () => { state = null; activeSaveId = null; activeCharacter = null; screen = "saves"; render(); });
  document.querySelector("[data-sheet-open]")?.addEventListener("click", () => { sheetOpen = true; debugOpen = false; render(); });
  document.querySelectorAll("[data-sheet-close]").forEach(button => button.addEventListener("click", () => { sheetOpen = false; render(); }));
  document.querySelector("[data-debug-open]")?.addEventListener("click", () => openDebug({ type: "debug", payload: {} }, "Debug Inspector"));
  document.querySelector("[data-character-debug]")?.addEventListener("click", () => {
    const character = state.characters.find(item => item.id === activeCharacter);
    openDebug({ type: "debug_character", payload: { characterId: activeCharacter } }, `${character?.name || activeCharacter} Debug`);
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
  document.querySelector("[data-gm-form]")?.addEventListener("submit", event => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message");
    run(async () => { const result = await rpc("gm", { message }); state = result.state; saves = result.saves; });
  });
  document.querySelectorAll("[data-character]").forEach(button => button.addEventListener("click", () => { activeCharacter = button.dataset.character; notice = ""; render(); }));
  document.querySelector("[data-talk-form]")?.addEventListener("submit", event => {
    event.preventDefault(); const message = new FormData(event.currentTarget).get("message");
    run(async () => { const result = await rpc("talk", { characterId: activeCharacter, message }); state = result.state; saves = result.saves; });
  });
  document.querySelector("[data-back]")?.addEventListener("click", () => { activeCharacter = null; notice = ""; render(); });
  document.querySelector("[data-end-day]")?.addEventListener("click", () => { notice = "The twelve-hour night phase is the next milestone. For now, the day remains yours."; render(); });
  document.querySelector("[data-reset]")?.addEventListener("click", () => run(async () => { introPage = 0; traveller = { name: "", homeland: "" }; const result = await rpc("reset"); state = result.state; saves = result.saves; activeCharacter = null; sheetOpen = false; debugOpen = false; }));
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && (sheetOpen || debugOpen)) { sheetOpen = false; debugOpen = false; render(); }
});

render();
