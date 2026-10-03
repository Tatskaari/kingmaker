export interface Ambition { name: string; status?: string; successCriteria?: string; currentGoal?: string }
export interface Relationship { characterId: string; description: string }
export interface CharacterWriting {
  id: string; name: string; lore?: string; currentGoal?: string;
  dialogueObjectives?: string[]; parkedObjectives?: Ambition[]; relationships?: Relationship[];
}
export interface Note { id: string; text: string; characterIds?: string[]; visibility?: string }
export interface Story { characters: CharacterWriting[]; notes?: Note[]; premise?: string }
export type WritingPanel = "overview" | "characters" | "quests" | "notes";
export const html = (value: unknown): string => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const textField = (label: string, path: string, value: unknown, rows = 4): string => `<label class="field"><span>${html(label)}</span><textarea data-writing="${path}" rows="${rows}">${html(value)}</textarea></label>`;
const characterLink = (character: CharacterWriting): string => `<button data-story-character="${html(character.id)}">${html(character.name)}</button>`;

export function writingView(story: Story, panel: WritingPanel, selectedId: string, query: string): string {
  const character = story.characters.find(item => item.id === selectedId) ?? story.characters[0];
  const matching = story.characters.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  const sidebar = `<aside><h2>Cast & story</h2><label class="field"><span>Search ${panel === "notes" ? "world notes" : "character writing"}</span><input id="story-search" type="search" value="${html(query)}" placeholder="Name, secret, ambition…"></label><div class="character-list">${matching.map(item => `<button data-story-character="${html(item.id)}" class="${item === character ? "active" : ""}">${html(item.name)}<small>${item.parkedObjectives?.length ?? 0} ambitions · ${item.relationships?.length ?? 0} relationships</small></button>`).join("") || '<p class="hint">No matching characters.</p>'}</div></aside>`;
  let content = "";
  if (panel === "overview") {
    content = `<div class="form-card"><p class="eyebrow">Scenario at a glance</p><h2>The story so far</h2><details><summary>Read scenario premise</summary><p class="story-prose">${html(story.premise)}</p></details><div class="story-stats"><span>${story.characters.length} characters</span><span>${story.characters.reduce((count, item) => count + (item.parkedObjectives?.length ?? 0), 0)} ambitions</span><span>${story.notes?.length ?? 0} world notes</span></div><p class="hint">Open a character to write their lore, follow relationships, and develop their quests. Connect your local scenario file to edit alongside Codex; saved file changes appear here automatically.</p></div><div class="story-grid">${matching.map(item => `<article class="form-card">${characterLink(item)}<p class="story-prose">${html(item.currentGoal || "No current goal.")}</p><h3>Ambitions</h3><ul>${(item.parkedObjectives ?? []).map(objective => `<li>${html(objective.name)}</li>`).join("") || "<li>None yet</li>"}</ul><h3>Connections</h3><div class="connections">${(item.relationships ?? []).map(relation => { const target = story.characters.find(candidate => candidate.id === relation.characterId); return target ? characterLink(target) : `<span>${html(relation.characterId)}</span>`; }).join("")}</div></article>`).join("")}</div>`;
  } else if (panel === "notes") {
    content = `<div class="form-card"><h2>World notes</h2><p class="hint">Shared facts and secrets that support the story. Character links show who the note concerns.</p></div>${(story.notes ?? []).map((note, index) => ({ note, index })).filter(({ note }) => JSON.stringify(note).toLowerCase().includes(query.toLowerCase())).map(({ note, index }) => `<article class="form-card"><h2>${html(note.id)}</h2><p class="eyebrow">${html(note.visibility?.replace("NOTE_VISIBILITY_", "") ?? "Unspecified visibility")}</p>${textField("Story fact / secret", `notes.${index}.text`, note.text, 7)}<div class="connections">${(note.characterIds ?? []).map(id => characterLink(story.characters.find(item => item.id === id) ?? { id, name: id })).join("")}</div></article>`).join("")}`;
  } else if (character) {
    const index = story.characters.indexOf(character), base = `characters.${index}`;
    content = `<div class="form-card"><p class="eyebrow">${html(character.id)}</p><h2>${html(character.name)}</h2><div class="connections"><button data-story-panel="characters">Character</button><button data-story-panel="quests">Quests & ambitions</button><button id="collaboration-brief">Copy context for Codex</button></div><p id="copy-status" role="status"></p></div>`;
    if (panel === "characters") {
      content += `<div class="form-card">${textField("Name", `${base}.name`, character.name, 1)}${textField("Lore, voice & secrets", `${base}.lore`, character.lore, 12)}${textField("Current goal", `${base}.currentGoal`, character.currentGoal)}</div><div class="form-card"><h2>Relationships</h2>${(character.relationships ?? []).map((relation, i) => `<div class="relationship">${characterLink(story.characters.find(item => item.id === relation.characterId) ?? { id: relation.characterId, name: relation.characterId })}${textField("How they see this person", `${base}.relationships.${i}.description`, relation.description)}</div>`).join("") || '<p class="hint">No authored relationships.</p>'}</div><div class="form-card"><h2>Incoming relationships</h2>${story.characters.flatMap(item => (item.relationships ?? []).filter(relation => relation.characterId === character.id).map(relation => `<div class="relationship">${characterLink(item)}<p class="story-prose">${html(relation.description)}</p></div>`)).join("") || '<p class="hint">No incoming relationships.</p>'}</div>`;
    } else {
      content += `<div class="form-card"><h2>Dialogue objectives</h2><p class="hint">Outcomes to pursue through conversation, in priority order.</p>${(character.dialogueObjectives ?? []).map((objective, i) => `${textField(`Conversation ${i + 1}`, `${base}.dialogueObjectives.${i}`, objective, 8)}<button data-remove-dialogue="${i}">Remove conversation ${i + 1}</button>`).join("")}<button id="add-dialogue">Add dialogue objective</button></div><div class="form-card"><h2>Parked ambitions</h2><p class="hint">These are the scenario’s authored undertakings. They inform intentions; they are not active action-planner tasks.</p>${(character.parkedObjectives ?? []).map((objective, i) => `<article class="ambition"><h3>Ambition ${i + 1}</h3>${textField("Name / hook", `${base}.parkedObjectives.${i}.name`, objective.name, 2)}${textField("Status", `${base}.parkedObjectives.${i}.status`, objective.status)}${textField("Success criteria", `${base}.parkedObjectives.${i}.successCriteria`, objective.successCriteria)}${textField("Current goal", `${base}.parkedObjectives.${i}.currentGoal`, objective.currentGoal)}<button data-remove-ambition="${i}">Remove ambition ${i + 1}</button></article>`).join("")}<button id="add-ambition">Add ambition</button></div>`;
    }
  }
  return `<section class="scenario-workspace">${sidebar}<div class="form-scroll">${content}</div></section>`;
}

// Paths are generated by this view, so editing one field preserves all unrelated authored data.
export function updateWriting(story: Story, path: string, value: string): void {
  const parts = path.split(".");
  let target: unknown = story;
  for (const part of parts.slice(0, -1)) target = (target as Record<string, unknown>)[part];
  (target as Record<string, unknown>)[parts.at(-1)!] = value;
}

export function collaborationBrief(story: Story, id: string): string {
  const character = story.characters.find(item => item.id === id);
  return `Let's work on this Kingmaker character and their quests. Edit the connected scenario JSON, preserving unrelated content.\nCharacter ID: ${id}\n\n${JSON.stringify({ character, incomingRelationships: story.characters.flatMap(item => (item.relationships ?? []).filter(relation => relation.characterId === id).map(relation => ({ from: item.id, ...relation }))), notes: story.notes?.filter(note => note.characterIds?.includes(id)) }, null, 2)}\n\nRequested changes: `;
}
