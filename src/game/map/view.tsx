import type { StyledLine } from "../types.ts";

/**
 * Styled lines (the renderer's output) as OpenTUI text: one <text> per line, one <span> per run.
 * Every line is exactly the viewport's width, so a column box of them is the map.
 */
export function MapView({ lines }: { lines: StyledLine[] }) {
  return (
    <box flexDirection="column">
      {lines.map((line, i) => (
        <text key={i}>
          {line.map((s, j) => (s.bold ? <b key={j} fg={s.fg} bg={s.bg}>{s.text}</b> : <span key={j} fg={s.fg} bg={s.bg}>{s.text}</span>))}
        </text>
      ))}
    </box>
  );
}
