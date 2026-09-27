const escape = value => String(value ?? "—").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const label = value => String(value ?? "Unknown").replace(/^(GAME_PHASE_|NOTE_VISIBILITY_|TRANSCRIPT_ROLE_)/, "").replaceAll("_", " ").toLowerCase();
const empty = text => `<p class="debug-empty">${escape(text)}</p>`;
const card = (title, content) => `<section class="debug-card"><h3>${escape(title)}</h3>${content}</section>`;
const facts = entries => `<dl class="debug-facts">${entries.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
const list = (items, render, fallback) => items?.length ? `<ul class="debug-list">${items.map(item => `<li>${render(item)}</li>`).join("")}</ul>` : empty(fallback);
const messages = items => list(items, item => `<strong>${escape(item.speakerId || label(item.role))}</strong><p>${escape(item.text ?? item.content ?? "Tool call (see Raw JSON)")}</p>`, "No messages recorded.");
const notes = items => card("Notes", list(items, note => `<span class="debug-meta">Day ${escape(note.day)} · ${escape(label(note.visibility))}</span><p>${escape(note.text)}</p>`, "No notes recorded."));

function characterCard(character, name) {
  const objective = character.activeObjective;
  const active = objective ? `<h4>Active objective</h4><p>${escape(objective.name)}</p><h4>Status and execution plan</h4><p>${escape(objective.status)}</p><h4>Success criteria</h4><p>${escape(objective.successCriteria)}</p>` : "";
  return card(character.name || character.id, `<p class="debug-meta">${escape(character.id)}</p>${active}<h4>Current goal</h4><p>${escape(character.currentGoal || "No goal recorded.")}</p><details><summary>Biography and relationships</summary><p>${escape(character.lore || "No biography recorded.")}</p>${list(character.relationships, relationship => `<strong>${escape(name(relationship.characterId))}</strong><p>${escape(relationship.description)}</p>`, "No relationships recorded.")}</details>`);
}

function worldCards(world, name) {
  if (!world) return card("World", empty("No world state available."));
  const roomName = id => world.rooms?.find(room => room.id === id)?.name || id;
  return card("World status", facts([["Phase", label(world.phase)], ["Day", world.day], ["Revision", world.revision], ["Rooms", world.rooms?.length ?? 0], ["Objects", world.objects?.length ?? 0]]))
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
      + notes(data.visibleNotes) + card("Conversation", messages(data.conversation))
      + card("Model context", facts([["Assembled messages", data.modelMessages?.length ?? 0]]) + `<p class="debug-meta">Complete prompts and messages are available in Raw JSON.</p>`);
  } else {
    const scenario = data.scenario || {};
    const name = id => scenario.characters?.find(character => character.id === id)?.name || id;
    content = card("Scenario", facts([["ID", scenario.id], ["Characters", scenario.characters?.length ?? 0], ["Notes", scenario.notes?.length ?? 0], ["GM messages", data.gameMasterHistory?.length ?? 0]]) + `<details><summary>Premise</summary><p>${escape(scenario.premise)}</p></details>`)
      + worldCards(scenario.world, name)
      + (scenario.characters || []).map(character => characterCard(character, name)).join("")
      + notes(scenario.notes)
      + card("Conversations", list(Object.entries(data.conversations || {}), ([id, transcript]) => `<strong>${escape(name(id))}</strong><p>${transcript.length} messages</p>`, "No conversations recorded."));
  }
  return `<div class="debug-grid">${content}</div>`;
}

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const array = value => Array.isArray(value) ? value : [];
function parsedContent(response) {
  try { return object(JSON.parse(response?.content)); } catch { return null; }
}

function transcriptSummary(entry) {
  if (entry.status === "pending") return empty("Waiting for the model…");
  if (entry.error) return `<p class="debug-error">${escape(entry.error)}</p>`;
  const response = object(entry.response);
  if (!response) return empty("No response recorded.");
  if (entry.kind === "jev") {
    const state = entry.request?.state;
    const action = array(state?.actions).find(item => item?.id === response.choice);
    const choice = response.choice === "complete" ? "Planner reports complete" : response.choice === "unable" ? "Planner reports unable to progress" : action?.description || response.choice;
    const probability = object(response.probabilities)?.[response.choice];
    return `<h4>Goal</h4><p>${escape(state?.goal || "Not recorded")}</p><h4>Decision</h4><p>${escape(choice)}</p>`
      + facts([["Choice", response.choice], ...(typeof probability === "number" ? [["Choice probability", `${Math.round(probability * 100)}%`]] : []), ...(typeof response.confidence === "number" ? [["Confidence", `${Math.round(response.confidence * 100)}%`]] : [])])
      + `<p class="debug-meta">This is the planner's decision, not confirmation that an action was executed.</p>`;
  }
  const output = parsedContent(response);
  if (entry.kind === "npc_request" && output) return `<h4>Request</h4><p>${escape(output.request)}</p><h4>Private intent</h4><p>${escape(output.intent)}</p>`;
  if (entry.kind === "npc_resolution" && output) return `<h4>Exchange</h4><p>${escape(output.summary)}</p>` + ["initiator", "recipient"].map(role => `<h4>${escape(role)}</h4>` + transcriptSummary({ ...entry, kind: "conversation_review", response: { content: JSON.stringify(output[role]) } })).join("");
  if (entry.kind === "conversation_review" || entry.kind === "outcome_review") {
    if (!output) return empty("Could not read structured review output. See the full response below.");
    const newNotes = array(output.newNotes), relationships = array(output.relationships), goal = object(output.goalUpdate);
    return `<h4>Notes returned (${newNotes.length})</h4>${list(newNotes, note => `<p>${escape(note)}</p>`, "No new notes.")}`
      + `<h4>Immediate goal</h4>${goal ? `<p>${escape(goal.goal)}</p><p class="debug-meta">Reason: ${escape(goal.reason)}</p>` : output.goalUpdate === null ? empty("No new goal — stay idle.") : empty("No goal update returned.")}`
      + `<h4>Relationship updates (${relationships.length})</h4>${list(relationships, relationship => `<strong>${escape(relationship?.characterId)}</strong><p>${escape(relationship?.description)}</p>`, "No relationship changes.")}`
      + `<h4>Biography</h4>${typeof output.lore === "string" ? `<p>${escape(output.lore)}</p>` : empty("Unchanged.")}`
      + `<p class="debug-meta">These are model-returned updates; validation and saving happen afterwards.</p>`;
  }
  if (entry.kind === "dialogue" && output) {
    return `<h4>Character said</h4><p>${escape(output.utterance)}</p><p class="debug-meta">${output.endConversation === true ? "Chose to end the conversation." : "Conversation continues."}</p>`
      + `<h4>Suggested player replies</h4>${list(array(output.replyOptions), reply => escape(reply), "No suggested replies.")}`;
  }
  return (response.content ? `<h4>Response</h4><p>${escape(response.content)}</p>` : empty("No spoken response."))
    + (array(response.tool_calls).length ? `<h4>Tools requested</h4>${list(response.tool_calls, call => `<strong>${escape(call?.function?.name)}</strong><pre>${escape(call?.function?.arguments)}</pre>`, "No tools.")}` : "");
}

export function recentTranscriptsView(entries = []) {
  const kinds = { npc_request: "NPC request", npc_resolution: "NPC conversation resolution", game_master: "Game master", gm_consultation: "GM consultation", dialogue: "Dialogue", dialogue_flavour: "Dialogue flavour", conversation_review: "Conversation review", world_event: "World event review", event_decision: "Event attention decision", jev: "Jev action decision", outcome_review: "Outcome review" };
  return `<p class="debug-note">Latest 50 model calls for this loaded game session, newest first. Reloading or loading a game starts a fresh log. No hidden reasoning or authentication headers are captured.</p>`
    + (entries.length ? entries.map(entry => `<article class="debug-card transcript-card"><h3>${escape(kinds[entry.kind] || entry.kind)} · ${escape(entry.characterId)}</h3><p class="debug-meta">${escape(entry.status === "success" ? "Response received" : entry.status)} · ${escape(entry.startedAt)}${entry.durationMs === undefined ? "" : ` · ${(entry.durationMs / 1000).toFixed(2)}s`}</p><div class="transcript-summary">${transcriptSummary(entry)}</div><details><summary>Full request and response</summary><h4>Request</h4><pre>${escape(JSON.stringify(entry.request, null, 2))}</pre>${entry.response === undefined ? "" : `<h4>Response</h4><pre>${escape(JSON.stringify(entry.response, null, 2))}</pre>`}${entry.error ? `<h4>Error</h4><pre class="debug-error">${escape(entry.error)}</pre>` : ""}</details></article>`).join("") : empty("No model calls recorded yet in this session."));
}
