const escape = value => String(value ?? "—").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const label = value => String(value ?? "Unknown").replace(/^(GAME_PHASE_|EVENT_VISIBILITY_|TRANSCRIPT_ROLE_)/, "").replaceAll("_", " ").toLowerCase();
const empty = text => `<p class="debug-empty">${escape(text)}</p>`;
const card = (title, content) => `<section class="debug-card"><h3>${escape(title)}</h3>${content}</section>`;
const facts = entries => `<dl class="debug-facts">${entries.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
const list = (items, render, fallback) => items?.length ? `<ul class="debug-list">${items.map(item => `<li>${render(item)}</li>`).join("")}</ul>` : empty(fallback);
const messages = items => list(items, item => `<strong>${escape(item.speakerId || label(item.role))}</strong><p>${escape(item.text ?? item.content ?? "Tool call (see Raw JSON)")}</p>`, "No messages recorded.");
const events = items => card("Events", list(items, event => `<span class="debug-meta">Day ${escape(event.day)} · ${escape(label(event.visibility))} · ${escape(event.type)}</span><p>${escape(event.summary)}</p>`, "No events recorded."));

function characterCard(character, name) {
  return card(character.name || character.id, `<p class="debug-meta">${escape(character.id)}</p><h4>Current goal</h4><p>${escape(character.currentGoal || "No goal recorded.")}</p><details><summary>Biography and relationships</summary><p>${escape(character.lore || "No biography recorded.")}</p>${list(character.relationships, relationship => `<strong>${escape(name(relationship.characterId))}</strong><p>${escape(relationship.description)}</p>`, "No relationships recorded.")}</details>`);
}

function worldCards(world, name) {
  if (!world) return card("World", empty("No world state available."));
  const roomName = id => world.rooms?.find(room => room.id === id)?.name || id;
  return card("World status", facts([["Phase", label(world.phase)], ["Day", world.day], ["Solstice day", world.solsticeDay], ["Revision", world.revision], ["Rooms", world.rooms?.length ?? 0], ["Objects", world.objects?.length ?? 0]]))
    + card("Character locations", list(world.actors, actor => `<strong>${escape(name(actor.characterId))}</strong><p>${escape(roomName(actor.roomId))} · ${actor.awake ? "Awake" : "Asleep"}</p>`, "No locations recorded."))
    + card("Objects", list(world.objects, object => `<strong>${escape(object.name || object.id)}</strong><p>${escape(roomName(object.locationId))} · ${object.concealed ? "Concealed" : "Visible"}</p>`, "No known objects."));
}

export function debugOverview(type, data) {
  let content;
  if (type === "debug_gm") {
    const compulsion = data.compulsion || {};
    content = card("Stranger status", facts([["Compulsion", compulsion.active ? "On" : "Off"], ["Consumed flag", compulsion.consumedFlag ?? "No accepted options call"], ["Prompt", data.promptMatchesCurrentScenario ? "Current" : "Older saved version"], ["Latest turn calls", data.latestTurnCalls?.length ?? 0], ["Saved messages", data.savedTranscript?.length ?? 0]]))
      + card("Offered replies", list(compulsion.options, option => escape(option), "No replies offered."))
      + card("Latest model calls", `<p class="debug-meta">${escape(data.traceNote)}</p>${list(data.latestTurnCalls, call => `<strong>${escape(call.request?.model)}</strong><p class="${call.error ? "debug-error" : ""}">${escape(call.error || (call.response ? "Response received" : "No response received"))}</p>${list(call.toolResults, tool => `<strong>${escape(tool.name)}</strong> · ${escape(tool.result?.error || (tool.result?.ok === false ? "Failed" : "Completed"))}`, "No tool results.")}`, "No calls captured in this runtime. Check the saved transcript below.")}`)
      + card("Saved transcript", messages(data.savedTranscript));
  } else if (type === "debug_character") {
    // Use only this inspector's knowledge-filtered payload, never global state.
    const character = data.character || {};
    const name = id => id === character.id ? character.name : id;
    content = characterCard(character, name) + worldCards(data.knownWorld, name)
      + events(data.visibleEvents) + card("Conversation", messages(data.conversation))
      + card("Model context", facts([["Assembled messages", data.modelMessages?.length ?? 0]]) + `<p class="debug-meta">Complete prompts and messages are available in Raw JSON.</p>`);
  } else {
    const scenario = data.scenario || {};
    const name = id => scenario.characters?.find(character => character.id === id)?.name || id;
    content = card("Scenario", facts([["ID", scenario.id], ["Characters", scenario.characters?.length ?? 0], ["Events", scenario.events?.length ?? 0], ["GM messages", data.gameMasterHistory?.length ?? 0]]) + `<details><summary>Premise</summary><p>${escape(scenario.premise)}</p></details>`)
      + worldCards(scenario.world, name)
      + (scenario.characters || []).map(character => characterCard(character, name)).join("")
      + events(scenario.events)
      + card("Conversations", list(Object.entries(data.conversations || {}), ([id, transcript]) => `<strong>${escape(name(id))}</strong><p>${transcript.length} messages</p>`, "No conversations recorded."));
  }
  return `<div class="debug-grid">${content}</div>`;
}

export function recentTranscriptsView(entries = []) {
  const kinds = { game_master: "Game master", dialogue: "Dialogue", conversation_review: "Conversation review", jev: "Jev decision", outcome_review: "Outcome review" };
  return `<p class="debug-note">Latest 50 model calls for this loaded game session, newest first. Includes requests, returned responses and network/provider errors. Reloading or loading a game starts a fresh log. No hidden reasoning or authentication headers are captured.</p>`
    + (entries.length ? entries.map(entry => `<article class="debug-card"><details><summary><strong>${escape(kinds[entry.kind] || entry.kind)} · ${escape(entry.characterId)}</strong> — ${escape(entry.status === "success" ? "Response received" : entry.status)} <span class="debug-meta">${escape(entry.startedAt)}${entry.durationMs === undefined ? "" : ` · ${(entry.durationMs / 1000).toFixed(2)}s`}</span></summary><h4>Request</h4><pre>${escape(JSON.stringify(entry.request, null, 2))}</pre>${entry.response === undefined ? "" : `<h4>Response</h4><pre>${escape(JSON.stringify(entry.response, null, 2))}</pre>`}${entry.error ? `<h4>Error</h4><pre class="debug-error">${escape(entry.error)}</pre>` : ""}</details></article>`).join("") : empty("No model calls recorded yet in this session."));
}
