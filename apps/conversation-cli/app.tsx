import { useEffect, useRef, useState } from "react";
import { stripVTControlCharacters } from "node:util";
import { Box, Text, render, useApp, useInput, useStdout, useWindowSize } from "ink";
import wrapAnsi from "wrap-ansi";
import { converse, type Complete, type ConversationInput, type LlmTurn } from "../../packages/conversation/src/conversation.js";

export interface ConversationResult {
  characterId: string;
  transcript: ConversationInput["transcript"];
  turns: LlmTurn[];
}

export function ConversationApp({ input, complete }: { input: ConversationInput; complete: Complete }) {
  const { exit } = useApp(), { stdout } = useStdout(), { columns, rows } = useWindowSize();
  const [transcript, setTranscript] = useState(input.transcript);
  const [turns, setTurns] = useState<LlmTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const controller = useRef(new AbortController());
  const running = useRef(false);
  const leftWidth = Math.floor(columns * 0.8), height = Math.max(1, rows - 7);
  const recent = turns.map((turn, index) => ({ turn, index })).slice(-Math.max(1, rows - 6)).reverse();
  const source = selected === null
    ? transcript.map(message => `${message.speakerId === "player" ? "You" : input.characterId}: ${message.text}`).join("\n\n") || "Type a message to begin."
    : JSON.stringify(turns[selected], null, 2);
  const lines = wrapAnsi(stripVTControlCharacters(source), Math.max(1, leftWidth - 4), { hard: true, trim: false }).split("\n");
  const maxOffset = Math.max(0, lines.length - height);
  const start = selected === null ? Math.max(0, maxOffset - offset) : Math.min(offset, maxOffset);
  const choose = (index: number | null) => { setSelected(index); setOffset(0); };
  const finish = () => {
    controller.current.abort();
    exit({ characterId: input.characterId, transcript,
      turns: turns.map(turn => turn.response || turn.error ? turn : { ...turn, error: "Cancelled when conversation ended." }),
    } satisfies ConversationResult);
  };
  useEffect(() => {
    // SGR mouse reporting; Ink's input parser delivers each complete CSI sequence.
    stdout.write("\x1b[?1000h\x1b[?1006h");
    return () => { stdout.write("\x1b[?1000l\x1b[?1006l"); controller.current.abort(); };
  }, [stdout]);
  async function send() {
    if (running.current || !draft.trim()) return;
    running.current = true; setBusy(true); setError("");
    const index = turns.length;
    try {
      const result = await converse({ ...input, transcript, message: draft }, complete, controller.current.signal,
        turn => setTurns(previous => [...previous.slice(0, index), turn]));
      setTranscript(result.transcript); setDraft(""); setOffset(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; setBusy(false); }
  }
  useInput((value, key) => {
    const mouse = value.match(/^\[<(\d+);(\d+);(\d+)([Mm])$/);
    if (mouse) {
      if (mouse[1] === "0" && mouse[4] === "M" && Number(mouse[2]) > leftWidth) {
        const item = recent[Number(mouse[3]) - 4];
        if (item) choose(item.index);
      }
      return;
    }
    if (key.ctrl && (value === "c" || value === "d")) return finish();
    if (key.escape) return choose(null);
    if (key.tab) return choose(selected === null && turns.length ? turns.length - 1 : null);
    if (key.pageUp || key.pageDown) {
      const direction = (key.pageDown ? 1 : -1) * (selected === null ? -1 : 1);
      return setOffset(Math.max(0, Math.min(maxOffset, offset + direction * height)));
    }
    if (selected !== null) {
      if (key.upArrow || key.downArrow) choose(Math.max(0, Math.min(turns.length - 1, selected + (key.upArrow ? 1 : -1))));
      return;
    }
    if (key.return) { void send(); return; }
    if (busy) return;
    if (key.backspace || key.delete) setDraft(text => [...text].slice(0, -1).join(""));
    else if (!key.ctrl && !key.meta && !key.leftArrow && !key.rightArrow && !key.upArrow && !key.downArrow) {
      setDraft(text => text + value.replace(/[\x00-\x1f\x7f]/g, " "));
    }
  });
  return <Box flexDirection="column" width={columns} height={rows}>
    <Text bold wrap="truncate">Conversation · {input.characterId}{busy ? " · Thinking…" : ""}</Text>
    <Box height={rows - 2}>
      <Box width={leftWidth} borderStyle="round" flexDirection="column" paddingX={1}>
        <Text bold wrap="truncate">{selected === null ? "Conversation" : `LLM turn ${selected + 1} · request / response · Esc to return`}</Text>
        <Box height={height} flexShrink={0}><Text>{lines.slice(start, start + height).join("\n")}</Text></Box>
        <Text color="red" wrap="truncate">{error || " "}</Text>
        <Text wrap="truncate">{selected === null ? `> ${draft.slice(-Math.max(1, leftWidth - 8))}${busy ? " …" : "▏"}` : `Lines ${start + 1}–${Math.min(lines.length, start + height)} / ${lines.length}`}</Text>
      </Box>
      <Box width={columns - leftWidth} borderStyle="round" flexDirection="column">
        <Text bold wrap="truncate"> LLM turns</Text>
        {recent.map(({ turn, index }) => <Text key={index} inverse={selected === index} wrap="truncate">
          {` ${index + 1}. ${turn.error ? "Error" : turn.response ? `${turn.durationMs}ms` : "Pending…"}`}
        </Text>)}
      </Box>
    </Box>
    <Text dimColor wrap="truncate">Enter send · Click/Tab debug · ↑↓ turns · PgUp/Dn scroll · Esc chat · ^D finish</Text>
  </Box>;
}

export async function runConversationCli(input: ConversationInput, complete: Complete): Promise<ConversationResult> {
  const app = render(<ConversationApp input={input} complete={complete} />, { alternateScreen: true, exitOnCtrlC: false });
  return await app.waitUntilExit() as ConversationResult;
}
