// Copied from the prototype's src/game/map/ansi.ts at 44c6d4a, whole; StyledLine from client/ui/types.ts.
import type { StyledLine } from "../ui/types.ts";

/** Styled lines as a terminal string (24-bit colour), for the headless demo and debugging. */
export function toAnsi(lines: StyledLine[], options: { color?: boolean } = {}): string {
  const color = options.color ?? true;
  return lines.map(line => line.map(span => {
    if (!color || (!span.fg && !span.bg && !span.bold)) return span.text;
    const codes: string[] = [];
    if (span.bold) codes.push("1");
    if (span.fg) codes.push(`38;2;${rgb(span.fg)}`);
    if (span.bg) codes.push(`48;2;${rgb(span.bg)}`);
    return `\x1b[${codes.join(";")}m${span.text}\x1b[0m`;
  }).join("")).join("\n");
}

/** Just the characters. */
export const toPlain = (lines: StyledLine[]) => lines.map(l => l.map(s => s.text).join("")).join("\n");

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}
