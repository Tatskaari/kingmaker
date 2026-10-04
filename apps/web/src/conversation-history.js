/** Preserve multiline turns and leave unstructured perceptions as scene text. */
export function historyTurns(text, characters) {
  const speakers = new Map(characters.map(character => [character.id, character.name]));
  speakers.set("player", "You");
  const turns = [];
  for (const line of text.split("\n")) {
    const match = /^([^:]+):\s?(.*)$/.exec(line);
    if (match && speakers.has(match[1])) {
      turns.push({ speaker: speakers.get(match[1]), role: match[1] === "player" ? "player" : "character", text: match[2] });
    } else if (turns.length) {
      turns[turns.length - 1].text += `\n${line}`;
    } else {
      turns.push({ speaker: "Scene", role: "scene", text: line });
    }
  }
  return turns;
}
