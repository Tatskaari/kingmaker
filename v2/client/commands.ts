// Copied from the prototype's src/app/game.ts:139-161 at 44c6d4a (COMMANDS, commandNamed), cut to help, retry (new) and quit; the only alias left is ?.
/**
 * The scene's commands, typed with a / (or the old #): what each one does, for the help and the
 * list over the box as one is typed (the prototype's src/app/game.ts COMMANDS and commandNamed,
 * with only what this client has so far).
 */
export const COMMANDS: Array<{ name: string; what: string; testing?: boolean }> = [
  { name: "help", what: "how to play" },
  { name: "retry", what: "carry a turn the GM lost on from where it got to" },
  { name: "quit", what: "leave the game (it's kept: the simulation has it)" },
];

/** A typed command by name, alias, or the start of one ("/h" is the help; "/" alone is nothing). */
export function commandNamed(typed: string): string | undefined {
  const t = typed.toLowerCase();
  const alias: Record<string, string> = { "?": "help" };
  if (alias[t]) return alias[t];
  if (COMMANDS.some(c => c.name === t)) return t;
  const starts = t ? COMMANDS.filter(c => c.name.startsWith(t)) : [];
  return starts.length === 1 ? starts[0]!.name : undefined;
}
