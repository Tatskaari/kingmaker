import { useEffect, useRef, useState } from "react";
import { stripVTControlCharacters } from "node:util";
import { createCliRenderer, createClipboard, createHostClipboard, createRendererClipboardAdapter,
  type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { conversationRequest, converse, type Complete, type ConversationInput, type LlmTurn } from "../../packages/conversation/src/conversation.js";

export interface ConversationResult {
  characterId: string;
  transcript: ConversationInput["transcript"];
  turns: LlmTurn[];
}
interface AppProps {
  input: ConversationInput;
  complete: Complete;
  copyText: (text: string) => Promise<string>;
  onFinish: (result: ConversationResult) => void;
}

export function ConversationApp({ input, complete, copyText, onFinish }: AppProps) {
  const renderer = useRenderer(), { width, height } = useTerminalDimensions();
  const [transcript, setTranscript] = useState(input.transcript);
  const [turns, setTurns] = useState<LlmTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const controller = useRef(new AbortController());
  const running = useRef(false);
  const content = useRef<ScrollBoxRenderable>(null);
  const sidebar = useRef<ScrollBoxRenderable>(null);
  const clickStart = useRef<{ x: number; y: number } | null>(null);
  const latest = turns.at(-1);
  // A request already includes prior speech. Display that history only once.
  const messages = latest ? [...latest.request.messages, latest.response ?? {
    role: latest.error ? "error" : "pending", content: latest.error ?? "Waiting for the character's reply…",
  }] : conversationRequest(input).messages.slice(0, -1);
  const source = selected === null
    ? transcript.map(message => `${message.speakerId === "player" ? "You" : input.characterId}: ${message.text}`).join("\n\n") || "Type a message to begin."
    : messages[selected]?.content ?? "No text content.";
  const choose = (index: number | null) => { renderer.clearSelection(); setSelected(index); };
  useEffect(() => () => controller.current.abort(), []);
  useEffect(() => {
    content.current?.scrollTo(selected === null ? content.current.scrollHeight : 0);
    if (selected !== null) sidebar.current?.scrollChildIntoView(`message-${selected}`);
  }, [selected]);
  async function send(message: string) {
    if (running.current || !message.trim()) return;
    running.current = true; setBusy(true); setStatus("");
    const index = turns.length;
    try {
      const result = await converse({ ...input, transcript, message }, complete, controller.current.signal,
        turn => setTurns(previous => [...previous.slice(0, index), turn]));
      setTranscript(result.transcript); setDraft("");
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; setBusy(false); }
  }
  async function copy() {
    const text = renderer.getSelection()?.getSelectedText();
    if (!text) { setStatus("Drag over text in either pane to select it."); return; }
    try { setStatus(await copyText(text)); }
    catch (cause) { setStatus(`Copy failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
  }
  useKeyboard(key => {
    if (key.ctrl && (key.name === "y" || (key.name === "c" && renderer.getSelection()?.getSelectedText()))) {
      key.preventDefault(); void copy(); return;
    }
    if (key.ctrl && (key.name === "c" || key.name === "d")) {
      key.preventDefault(); controller.current.abort();
      onFinish({ characterId: input.characterId, transcript,
        turns: turns.map(turn => turn.response || turn.error ? turn : { ...turn, error: "Cancelled when conversation ended." }),
      });
    } else if (key.name === "escape") { key.preventDefault(); choose(null); }
    else if (key.name === "tab") { key.preventDefault(); choose(selected === null ? 0 : null); }
    else if (key.name === "pageup" || key.name === "pagedown" || (key.shift && ["up", "down"].includes(key.name))) {
      key.preventDefault();
      content.current?.scrollBy((key.name === "pageup" || key.name === "up" ? -1 : 1) * (key.shift ? 1 : Math.max(1, height - 7)));
    } else if (selected !== null && ["up", "down"].includes(key.name)) {
      key.preventDefault(); choose(Math.max(0, Math.min(messages.length - 1, selected + (key.name === "up" ? -1 : 1))));
    }
  });
  return <box width={width} height={height} flexDirection="column">
    <text height={1} selectable={false} truncate>{`Conversation · ${input.characterId}${busy ? " · Thinking…" : latest?.durationMs !== undefined ? ` · ${latest.durationMs}ms` : ""}`}</text>
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box width="80%" border flexDirection="column" paddingX={1}>
        <text height={1} selectable={false} truncate>{selected === null ? "Conversation" : `Message ${selected + 1} · ${messages[selected]?.role} · Esc to return`}</text>
        <scrollbox id="conversation-content" ref={content} flexGrow={1} minHeight={0} scrollX={false}
          stickyScroll={selected === null} stickyStart="bottom" viewportCulling={false}>
          <text id="message-content" flexShrink={0} wrapMode="word" selectable>{stripVTControlCharacters(source)}</text>
        </scrollbox>
        <text height={1} selectable={false} truncate fg="yellow">{status || " "}</text>
        <input id="conversation-input" value={draft} onInput={setDraft} onSubmit={() => { void send(draft); }}
          focused={selected === null && !busy} placeholder={busy ? "Waiting for reply…" : "Say something…"} />
      </box>
      <box width="20%" border flexDirection="column">
        <text height={1} selectable={false}>Messages</text>
        <scrollbox id="message-list" ref={sidebar} flexGrow={1} minHeight={0} scrollX={false} viewportCulling={false}>
          {messages.map((message, index) => <text id={`message-${index}`} key={index} height={1} flexShrink={0}
            selectable truncate bg={selected === index ? "#334155" : "transparent"}
            onMouseDown={event => { clickStart.current = { x: event.x, y: event.y }; }}
            onMouseUp={event => {
              // A drag selects sidebar text; only an un-dragged click opens it.
              if (event.x === clickStart.current?.x && event.y === clickStart.current?.y) choose(index);
              clickStart.current = null;
            }}>{`${index + 1}. ${message.role}`}</text>)}
        </scrollbox>
      </box>
    </box>
    <text height={1} selectable={false} truncate>Wheel scroll · Drag select · Ctrl+Y copy · Tab inspect · Esc chat · Ctrl+D finish</text>
  </box>;
}

export async function runConversationCli(input: ConversationInput, complete: Complete): Promise<ConversationResult> {
  let fail: (error: Error) => void = () => {};
  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false,
    onDestroy: () => fail(new Error("Conversation terminal closed.")),
  });
  const clipboard = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) });
  const root = createRoot(renderer);
  try {
    return await new Promise<ConversationResult>((resolve, reject) => {
      fail = reject;
      root.render(<ConversationApp input={input} complete={complete} onFinish={resolve} copyText={async text => {
        const result = await clipboard.writeText(text, { destination: "best-available" });
        if (result.host.status === "written") return "Copied selection.";
        if (result.terminal.status === "attempted") return "Copy sent to terminal clipboard.";
        throw new Error("No clipboard is available in this terminal.");
      }} />);
    });
  } finally { root.unmount(); renderer.destroy(); await clipboard.dispose(); }
}
