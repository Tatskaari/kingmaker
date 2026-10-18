// Copied from the prototype's src/app/game.ts:139-161 at 44c6d4a (COMMANDS, commandNamed), cut to sheet, journal, help, report (M5), retry (new), suggestions, quit and the testing exits and end, with quests (new: story-design §4.5); the aliases left are c, ?, j and notebook.
/**
 * The scene's commands, typed with a / (or the old #): what each one does, for the help and the
 * list over the box as one is typed (the prototype's src/app/game.ts COMMANDS and commandNamed,
 * with only what this client has so far).
 */
export const COMMANDS: Array<{ name: string; what: string; testing?: boolean }> = [
  { name: "sheet", what: "your character sheet" },
  { name: "journal", what: "the investigator's notebook" },
  { name: "quests", what: "the story's quests, and how each stands" },
  { name: "help", what: "how to play" },
  { name: "retry", what: "carry a turn the GM lost on from where it got to" },
  { name: "suggestions", what: "[on|off]: the suggested lines over the box" },
  { name: "quit", what: "back to the title (the game is kept: the simulation has it)" },
  { name: "report", what: "[what went wrong]: report a problem, saved for Claude" },
  { name: "exits", what: "the scene's endings (for testing)", testing: true },
  { name: "end", what: "<exit>: take an ending now (for testing, as the dev stack's owner)", testing: true },
];

/** A typed command by name, alias, or the start of one ("/sh" is the sheet; "/" alone is nothing). */
export function commandNamed(typed: string): string | undefined {
  const t = typed.toLowerCase();
  const alias: Record<string, string> = { c: "sheet", "?": "help", j: "journal", notebook: "journal" };
  if (alias[t]) return alias[t];
  if (COMMANDS.some(c => c.name === t)) return t;
  const starts = t ? COMMANDS.filter(c => c.name.startsWith(t)) : [];
  return starts.length === 1 ? starts[0]!.name : undefined;
}
