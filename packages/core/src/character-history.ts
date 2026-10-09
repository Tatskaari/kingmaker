export interface CharacterHistoryEntry { kind: "action" | "event"; id: string; text: string }
export interface CharacterHistory { characterHistory?: Record<string, CharacterHistoryEntry[]> }

/** Append only committed actions and witnessed events, retaining their shared ordering. */
export function recordCharacterHistory(state: CharacterHistory, id: string, entry: CharacterHistoryEntry) {
  const history = (state.characterHistory ??= {})[id] ??= [];
  if (entry.kind === "event" && history.some(previous => previous.kind === "event" && previous.id === entry.id)) return;
  history.push(entry);
  if (history.length > 64) history.splice(0, history.length - 64);
}
export function renderCharacterHistory(history: readonly CharacterHistoryEntry[]) {
  return history.map(entry => `${entry.kind === "action" ? "Completed action" : "Perceived event"}: ${entry.text}`).join("\n");
}
