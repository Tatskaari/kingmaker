const escape = value => String(value ?? "—").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const label = value => String(value ?? "Unknown").replace(/^(GAME_PHASE_|NOTE_VISIBILITY_|TRANSCRIPT_ROLE_)/, "").replaceAll("_", " ").toLowerCase();
const empty = text => `<p class="debug-empty">${escape(text)}</p>`;
const card = (title, content) => `<section class="debug-card"><h3>${escape(title)}</h3>${content}</section>`;
const facts = entries => `<dl class="debug-facts">${entries.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
const list = (items, render, fallback) => items?.length ? `<ul class="debug-list">${items.map(item => `<li>${render(item)}</li>`).join("")}</ul>` : empty(fallback);
const messages = items => list(items, item => `<strong>${escape(item.speakerId || label(item.role))}</strong><p>${escape(item.text ?? item.content ?? "Tool call (see Raw JSON)")}</p>`, "No messages recorded.");
const notes = items => card("Notes", list(items, note => `<span class="debug-meta">Day ${escape(note.day)} · ${escape(label(note.visibility))}</span><p>${escape(note.text)}</p>`, "No notes recorded."));
const eventFeed = items => card("Events in earshot", list(items, item => {
  const decision = item.jevDecision === "process" ? "Wake / process"
    : item.jevDecision === "ignore" ? "Ignore"
      : item.jevDecision === "pending" ? "Decision pending"
        : item.jevDecision === "error" ? `Decision failed: ${item.jevError || "Unknown error"}`
          : "Not consulted — perception roll failed";
  return `<span class="debug-meta">Day ${escape(item.day)} · ${escape(item.level)} earshot</span><strong>${escape(item.kind)}</strong><p>${escape(item.summary)}</p>${item.perception && item.perception !== item.summary ? `<h4>Jev perceived</h4><p>${escape(item.perception)}</p>` : ""}${facts([["Observed", item.observed ? "Yes" : "No"], ["Legality", item.legality || "Not specified"], ["Owner", item.ownerName || "Not specified"], ["Jev", decision]])}`;
}, "No world events have happened within this character's earshot during this loaded session."));

function objectiveEditor(character) {
  const objective = character.activeObjective || {};
  const fields = [["name", "Objective name", objective.name], ["status", "Status and execution plan", objective.status],
    ["success_criteria", "Success criteria", objective.successCriteria], ["current_goal", "Current goal", character.currentGoal]];
  return `<details><summary>Override active objective</summary><form data-objective-override="${escape(character.id)}" class="objective-editor">
    <p>Replace this character's active objective and stop their current run. Use Continue in Overall debug → Activity to execute the new plan.</p>
    ${fields.map(([key, title, value]) => `<label>${title}<textarea name="${key}" rows="${key === "status" ? 4 : 2}" required>${escape(value || "")}</textarea></label>`).join("")}
    <button type="submit">Save objective override</button><p data-objective-status role="status"></p>
  </form></details>`;
}

function characterCard(character, name, editable = true) {
  const objective = character.activeObjective;
  const active = objective ? `<h4>Active objective</h4><p>${escape(objective.name)}</p><h4>Status and execution plan</h4><p>${escape(objective.status)}</p><h4>Success criteria</h4><p>${escape(objective.successCriteria)}</p>` : "";
  return card(character.name || character.id, `<p class="debug-meta">${escape(character.id)}</p><h4>Dialogue objectives</h4>${list(character.dialogueObjectives, objective => escape(objective), "No dialogue objectives recorded.")}${active}${editable ? objectiveEditor(character) : ""}<h4>Current goal</h4><p>${escape(character.currentGoal || "No goal recorded.")}</p><details><summary>Biography and relationships</summary><p>${escape(character.lore || "No biography recorded.")}</p>${list(character.relationships, relationship => `<strong>${escape(name(relationship.characterId))}</strong><p>${escape(relationship.description)}</p>`, "No relationships recorded.")}</details>`);
}

function worldCards(world, name, characters = []) {
  if (!world) return card("World", empty("No world state available."));
  const objects = world.objects ?? [...characters, ...(world.fixtures ?? []), ...(world.rooms ?? [])].flatMap(owner => (owner.inventory?.items ?? []).map(item => ({ ...item, locationId: owner.id })));
  const roomName = id => world.rooms?.find(room => room.id === id)?.name || id;
  return card("World status", facts([["Phase", label(world.phase)], ["Day", world.day], ["Revision", world.revision], ["Rooms", world.rooms?.length ?? 0], ["Objects", objects.length]]))
    + card("Character locations", list(world.actors, actor => `<strong>${escape(name(actor.characterId))}</strong><p>${escape(roomName(actor.roomId))} · ${actor.awake ? "Awake" : "Asleep"}</p>`, "No locations recorded."))
    + card("Objects", list(objects, object => `<strong>${escape(object.name || object.id)}</strong><p>${escape(roomName(object.locationId))} · ${object.concealed ? "Concealed" : "Visible"}</p>`, "No known objects."));
}

export const debugSections = {
  debug: { characters: "Characters", activity: "Activity", world: "World", notes: "Notes", conversations: "Conversations" },
  debug_character: { world: "Known world", events: "Events in earshot", notes: "Visible notes", conversation: "Conversation", context: "Model context" },
};
const drilldown = (section, title, detail) => `<button class="debug-drilldown" data-debug-section="${section}"><strong>${escape(title)} →</strong><span>${escape(detail)}</span></button>`;
const characterLink = (id, name) => `<button class="debug-character-link" data-debug-character="${escape(id)}">${escape(name || id)} →</button>`;

export function characterTranscripts(data, characterId) {
  const related = entry => entry.characterId === characterId || entry.participantIds?.includes(characterId);
  return {
    requests: (data.requests || []).filter(related),
    agentRuns: Object.fromEntries(Object.entries(data.agentRuns || {})
      .filter(([, run]) => related(run) || run.calls?.some(related))
      .map(([key, run]) => [key, run.calls ? { ...run, calls: run.calls.filter(related) } : run])),
  };
}

export function debugOverview(type, data, section = "") {
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
    const sections = {
      world: () => worldCards(data.knownWorld, name),
      events: () => eventFeed(data.eventFeed),
      notes: () => notes(data.visibleNotes),
      conversation: () => card("Conversation", messages(data.conversation)),
      context: () => card("Model context", messages(data.modelMessages)),
    };
    content = sections[section] ? sections[section]() : characterCard(character, name)
      + Object.entries(debugSections.debug_character).map(([id, title]) => drilldown(id, title, {
        world: "What this character knows", events: `${data.eventFeed?.length ?? 0} perceived events`,
        notes: `${data.visibleNotes?.length ?? 0} available notes`, conversation: `${data.conversation?.length ?? 0} messages`,
        context: `${data.modelMessages?.length ?? 0} assembled messages`,
      }[id])).join("");

  } else {
    const scenario = data.scenario || {};
    const name = id => scenario.characters?.find(character => character.id === id)?.name || id;
    const characters = scenario.characters || [];
    const sections = {
      characters: () => card("Characters", list(characters, character => character.id === scenario.playerCharacterId
        ? `<details><summary>${escape(character.name)} · Player</summary>${characterCard(character, name, false)}</details>`
        : characterLink(character.id, character.name) + `<p class="debug-meta">${escape(character.currentGoal || "No current goal")}</p>`, "No characters recorded.")),
      activity: () => '<section class="debug-card npc-planner" data-npc-panel></section>',
      world: () => worldCards(scenario.world, name, characters),
      notes: () => notes(scenario.notes),
      conversations: () => card("Conversations", list(Object.entries(data.conversations || {}), ([id, transcript]) =>
        characterLink(id, name(id)) + `<p>${transcript.length} messages</p>`, "No conversations recorded.")),
    };
    content = sections[section] ? sections[section]()
      : card("Scenario", facts([["ID", scenario.id], ["Phase", label(scenario.world?.phase)], ["Day", scenario.world?.day], ["Revision", scenario.world?.revision]]) + `<details><summary>Premise</summary><p>${escape(scenario.premise)}</p></details>`)
        + Object.entries(debugSections.debug).map(([id, title]) => drilldown(id, title, {
          characters: `${characters.length} characters · inspect individual knowledge and goals`,
          activity: "Live NPC goals, progress and controls", world: "Authoritative locations and objects",
          notes: `${scenario.notes?.length ?? 0} scenario notes`,
          conversations: `${Object.keys(data.conversations || {}).length} conversations`,
        }[id])).join("");

  }
  return `<div class="debug-grid">${content}</div>`;
}

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const array = value => Array.isArray(value) ? value : [];
function parsedContent(response) {
  try { return object(JSON.parse(response?.content)); } catch { return null; }
}

function disclosureSummary(entry, response) {
  const disclosure = entry.request.disclosure;
  const documents = array(disclosure.candidates).map(document => {
    const probability = response[document.id]?.probabilities?.[document.id];
    const valid = typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1;
    return { ...document, probability, valid, open: valid && probability > disclosure.threshold };
  }).sort((a, b) => Number(b.open) - Number(a.open));
  const count = documents.filter(document => document.open).length;
  return `<h4>Documents considered (${documents.length})</h4><p class="debug-meta">${count} selected to open. Open means relevance exceeds ${escape(disclosure.threshold * 100)}%; Not opened means it did not. These are retrieval decisions, before document loading.</p>`
    + list(documents, document => `<div class="disclosure-document"><strong>${escape(document.path)}</strong><span class="transcript-status ${document.open ? "success" : document.valid ? "error" : "pending"}">${document.open ? "Open" : document.valid ? "Not opened" : "No decision"}</span></div>`
      + `<p class="debug-meta">${document.valid ? `Relevance: ${escape(Math.round(document.probability * 100))}% · ` : ""}Linked from ${escape(document.from)}</p>`
      + (document.summary ? `<p>${escape(document.summary)}</p>` : ""), "No documents considered.");
}

function transcriptSummary(entry) {
  if (entry.status === "pending") return empty("Waiting for the model…");
  if (entry.error) return `<p class="debug-error">${escape(entry.error)}</p>`;
  const response = object(entry.response);
  if (!response) return empty("No response recorded.");
  if (entry.kind === "prog_disc" && entry.request?.disclosure) return disclosureSummary(entry, response);
  if (entry.kind === "conversation_expression") {
    return facts([["Expression", response.expression]])
      + list(Object.entries(object(response.decision?.probabilities) || {}), ([expression, probability]) =>
        `${escape(expression)}: ${Math.round(probability * 100)}%`, "No probabilities.");
  }
  if (entry.kind === "conversation_check") {
    return `<h4>Player turn</h4><p>${escape(entry.request?.playerTurn)}</p><h4>Suggested checks</h4>`
      + (response.needsCheck ? list(array(response.checks), skill => escape(skill), "None.") : empty("No check needed."))
      + list(Object.entries(object(response.decisions) || {}), ([skill, decision]) => `<strong>${escape(skill)}</strong>`
        + facts([["Decision", decision.choice], ["Probability", `${Math.round((decision.probabilities?.[decision.choice] ?? 0) * 100)}%`],
          ...(typeof decision.confidence === "number" ? [["Confidence", `${Math.round(decision.confidence * 100)}%`]] : [])]), "No decisions.")
      + `<p class="debug-meta">Diagnostic classification only; no dice were rolled.</p>`;
  }
  if (entry.request?.questions && !response.choice) return list(Object.entries(response), ([id, decision]) =>
    `<strong>${escape(id)}</strong>` + facts([["Decision", decision.choice], ["Probabilities", JSON.stringify(decision.probabilities)]]), "No decisions returned.");
  if (entry.kind === "jev") {
    const state = entry.request?.state;
    const action = array(state?.actions).find(item => item?.id === response.choice);
    const choice = response.choice === "complete" ? "Planner reports complete" : response.choice === "unable" ? "Planner reports unable to progress" : action?.description || entry.request?.questions?.next?.criteria?.[response.choice] || response.choice;
    const probability = object(response.probabilities)?.[response.choice];
    return (typeof state === "string" ? `<h4>Action planner input</h4><pre>${escape(state)}</pre>` : `<h4>Goal</h4><p>${escape(state?.goal || "Not recorded")}</p>`) + `<h4>Decision</h4><p>${escape(choice)}</p>`
      + facts([["Choice", response.choice], ...(typeof probability === "number" ? [["Choice probability", `${Math.round(probability * 100)}%`]] : []), ...(typeof response.confidence === "number" ? [["Confidence", `${Math.round(response.confidence * 100)}%`]] : [])])
      + `<p class="debug-meta">This is the planner's decision, not confirmation that an action was executed.</p>`;
  }
  const output = parsedContent(response);
  if (entry.kind === "npc_request" && output) return `<h4>Request</h4><p>${escape(output.request)}</p><h4>Private intent</h4><p>${escape(output.intent)}</p>`;
  if (entry.kind === "npc_resolution" && output) return `<h4>Exchange</h4><p>${escape(output.summary)}</p>` + ["initiator", "recipient"].map(role => `<h4>${escape(role)}</h4>` + transcriptSummary({ ...entry, kind: "conversation_review", response: { content: JSON.stringify(output[role]) } })).join("");
  if (entry.kind === "dialogue" && output) {
    return `<h4>Character said</h4><p>${escape(output.utterance)}</p><p class="debug-meta">${output.endConversation === true ? "Chose to end the conversation." : "Conversation continues."}</p>`
      + `<h4>Suggested player replies</h4>${list(array(output.replyOptions), reply => escape(reply), "No suggested replies.")}`;
  }
  return (response.content ? `<h4>Response</h4><p>${escape(response.content)}</p>` : empty("No spoken response."))
    + (array(response.tool_calls).length ? `<h4>Tools requested</h4>${list(response.tool_calls, call => `<strong>${escape(call?.function?.name)}</strong><pre>${escape(call?.function?.arguments)}</pre>`, "No tools.")}` : "");
}

const transcriptKinds = { skill_check: "Jev skill check", skill_difficulty: "Jev skill difficulty", prog_disc: "Jev progressive disclosure", npc_goal: "Goal execution", character: "Conversation", npc_request: "NPC request", npc_resolution: "NPC conversation resolution", game_master: "Game master", gm_consultation: "GM consultation", dialogue: "Dialogue", dialogue_flavour: "Dialogue flavour", conversation_review: "Conversation review", conversation_attention: "Jev conversation attention", conversation_check: "Jev conversation checks", conversation_expression: "Jev portrait expression", world_event: "World event review", event_decision: "Event attention decision", jev: "Jev action decision", outcome_review: "Outcome review" };
const transcriptStatus = status => ({ pending: "Active", success: "Completed", stopped: "Stopped", error: "Failed" })[status] || status;
const transcriptTime = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleTimeString() : "—";
const transcriptType = kind => transcriptKinds[kind] || kind;
export function transcriptSessions(entries = [], runs = {}) {
  const included = new Set(Object.values(runs).flatMap(run => (run.calls || []).map(call => call.id)));
  return [...Object.entries(runs).map(([key, run]) => ({ ...run, key: `run:${key}` })),
    ...entries.filter(entry => !included.has(entry.id)).map(entry => ({
      key: `request:${entry.id}`, kind: entry.kind, characterId: entry.characterId,
      status: entry.status, startedAt: entry.startedAt, calls: [entry],
    }))].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
}
const transcriptTable = (headers, rows) => `<table class="transcript-table" data-transcript-key="table"><thead><tr>${headers.map(title => `<th scope="col">${title}</th>`).join("")}</tr></thead>${rows}</table>`;
const transcriptRow = (key, cells) => `<tbody data-transcript-key="${escape(key)}"><tr>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr></tbody>`;
const sessionButton = (key, text) => `<button data-transcript-session="${escape(key)}">${escape(text)}</button>`;
const statusBadge = status => `<span class="transcript-status ${escape(status)}">${escape(transcriptStatus(status))}</span>`;

export function recentTranscriptsView(entries = [], runs = {}, route = {}) {
  if (route.characterId) return characterTranscriptView(entries, runs, route);
  const sessions = transcriptSessions(entries, runs);
  const name = id => route.names?.[id] || id;
  const session = sessions.find(item => item.key === route.session);
  const call = session?.calls?.find(item => String(item.id) === route.call);
  const crumbs = `<nav class="debug-breadcrumbs" aria-label="Transcript navigation">${sessionButton("", "All sessions")}${session ? `<span>/</span>${sessionButton(session.key, `${name(session.characterId)} · ${transcriptType(session.kind)}`)}` : ""}${call ? `<span>/</span><span aria-current="page">Call ${escape(call.id)}</span>` : ""}</nav>`;
  if (route.session && !session) return crumbs + empty("This session is no longer in the retained history. Return to All sessions.");
  if (route.call && !call) return crumbs + empty("This call is no longer available.");
  if (call) return crumbs + transcriptDetail(call, name);
  if (session) {
    const calls = session.calls || [];
    return crumbs + `<p class="debug-note">${escape(session.context?.objective || session.context?.goal || transcriptType(session.kind))} · ${calls.length} calls · ${escape(transcriptStatus(session.status))}. Session completion does not imply goal success.</p>${session.error ? `<p class="debug-error">${escape(session.error)}</p>` : ""}`
      + (calls.length ? transcriptTable(["Call", "Character", "Transcript type", "Status", "Started", "Duration"], calls.map(item => transcriptRow(`call:${item.id}`, [
        `<button data-transcript-call="${escape(item.id)}">Call ${escape(item.id)} →</button>`, escape(name(item.characterId)),
        escape(transcriptType(item.kind)), statusBadge(item.status), escape(transcriptTime(item.startedAt)),
        item.durationMs === undefined ? "—" : `${(item.durationMs / 1000).toFixed(2)}s`,
      ])).join("")) : empty("No calls recorded yet."))
      + `<details data-transcript-key="context"><summary>Session context</summary>${session.context?.messages ? messages(session.context.messages) : ""}<pre>${escape(JSON.stringify({ id: session.key, ...session.context }, null, 2))}</pre></details>`;
  }
  return `<p class="debug-note">One row per execution session or conversation. Select a session, then a call to inspect it. Latest 50 completed sessions plus active sessions; recent ungrouped calls appear separately. Reloading or loading a game clears this history.</p>`
    + (sessions.length ? transcriptTable(["Character", "Transcript type", "Purpose", "Calls", "Status", "Started"], sessions.map(item => transcriptRow(item.key, [
      sessionButton(item.key, `${name(item.characterId)} →`), escape(transcriptType(item.kind)),
      escape(item.context?.objective || item.context?.goal || (item.kind === "character" ? "Conversation with the player" : transcriptType(item.kind))),
      String(item.calls?.length ?? 0), statusBadge(item.status), escape(transcriptTime(item.startedAt)),
    ])).join("")) : empty("No model calls recorded yet in this session."));
}

export function transcriptDetail(call, name) {
  return `<section class="transcript-detail" data-transcript-key="call:${escape(call.id)}"><h3>${escape(transcriptType(call.kind))}</h3>${facts([["Character", name(call.characterId)], ["Participants", (call.participantIds || [call.characterId]).map(name).join(", ")], ["Status", transcriptStatus(call.status)], ["Started", transcriptTime(call.startedAt)], ["Duration", call.durationMs === undefined ? "In progress" : `${(call.durationMs / 1000).toFixed(2)}s`]])}<div class="transcript-summary">${transcriptSummary(call)}</div><details><summary>Trace context</summary>${facts([["Conversation ID", call.conversationId], ["Turn ID", call.turnId], ["Span ID", call.spanId], ["Scenario", call.scenario], ["World generation", call.worldGeneration], ["Location", call.location ? `${call.location.x}, ${call.location.y}` : "Not recorded"]])}</details>${call.request?.messages ? `<details><summary>Request messages (${call.request.messages.length})</summary>${messages(call.request.messages)}</details>` : ""}<details><summary>Full request and response</summary><h4>Request</h4><pre>${escape(JSON.stringify(call.request, null, 2))}</pre><h4>Response</h4><pre>${escape(JSON.stringify(call.response ?? null, null, 2))}</pre></details></section>`;
}

/** Chronological request browser, scoped before resolving a selected call. */
function characterTranscriptView(entries, runs, route) {
  const scoped = characterTranscripts({ requests: entries, agentRuns: runs }, route.characterId);
  const sessions = transcriptSessions(scoped.requests, scoped.agentRuns).reverse();
  const calls = sessions.flatMap(session => session.calls || []).sort((a, b) => a.id - b.id);
  const selected = route.call ? calls.find(call => String(call.id) === route.call) : calls.at(-1);
  const name = id => route.names?.[id] || id;
  if (!calls.length) return empty("No AI requests recorded for this character yet.");
  const menu = sessions.map(session => {
    const turns = [...new Set(session.calls.map(call => call.turnId))];
    return `<section data-transcript-key="${escape(session.key)}"><h4>${escape(transcriptType(session.kind))} · ${escape(transcriptTime(session.startedAt))}</h4>${session.calls.map(call =>
      `<button data-transcript-call="${escape(call.id)}" aria-current="${selected?.id === call.id ? "true" : "false"}"><span>Turn ${turns.indexOf(call.turnId) + 1} · ${escape(transcriptType(call.kind))}</span><small>${escape(name(call.characterId))} · ${escape(transcriptTime(call.startedAt))} · ${escape(transcriptStatus(call.status))}</small></button>`).join("")}</section>`;
  }).join("");
  return `<p class="debug-note">Requests involving ${escape(name(route.characterId))}, including dialogue, Jev decisions and character reviews. Select a call on the right. History is cleared when a game is loaded.</p>`
    + `<div class="character-transcripts" data-transcript-container data-transcript-key="character-transcripts"><div class="transcript-selected" data-transcript-container data-transcript-key="selected">${selected ? transcriptDetail(selected, name) : empty("This call is no longer available for this character. Select another call.")}</div><nav class="transcript-call-list" aria-label="Character AI requests" data-transcript-container data-transcript-key="call-list">${menu}</nav></div>`;
}

/** Saved history includes system context that the player-facing conversation omits. */
export function conversationTranscriptView(data, names = {}) {
  const turns = data?.conversation || [];
  if (!turns.length) return empty("No current conversation. Start an audience with this character to inspect its history.");
  return `<section class="debug-conversation" aria-label="Current conversation transcript"><p class="debug-meta">${turns.length} entries · Oldest first</p>${turns.map((turn, index) => {
    const role = label(turn.role);
    const system = role === "game master";
    const modelRole = system ? "system" : role === "character" ? "assistant" : "user";
    const speaker = system ? turn.speakerId === "earshot" ? "Conversation earshot" : "DM / context"
      : names[turn.speakerId] || (role === "player" ? "You" : names[data.characterId] || turn.speakerId || role);
    return `<article class="history-turn ${system ? "context" : role === "player" ? "player" : "character"}" data-transcript-key="conversation-${index}"><span class="speaker">${escape(speaker)}</span><span class="debug-meta">${index + 1} · ${modelRole}${system ? " · Hidden from dialogue" : ""}</span><p>${escape(turn.text || "")}</p></article>`;
  }).join("")}</section>`;
}
