import { traceCliGmCalls, gmCallLabel, type CliGmCall } from "./gm-calls.js";
import type { ConversationStrategy } from "../../packages/conversation/src/phases.js";
import { directConversationStrategy } from "../../packages/conversation/src/phases.js";
import { traceCliDecisions, decisionCallLabel, type CliDecisionCall } from "./decision-calls.js";
import { formatConversation, type MessageAnalysis } from "./analysis.js";
import type { AiService, RuntimeServices } from "../../packages/conversation/src/services.js";
import type { DndCharacter } from "../../packages/contracts/src/index.js";
import { conversationStrategy, type ManualRoll, type RequestRoll } from "../../packages/conversation/src/conversation-strategy.js";
import { useEffect, useRef, useState } from "react";
import { stripVTControlCharacters } from "node:util";
import { createCliRenderer, createClipboard, createHostClipboard, createRendererClipboardAdapter,
  type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { ConversationRuntime } from "../../packages/conversation/src/runtime.js";
import { disclosureDetails, type DisclosureRound, type DisclosureSession } from "../../packages/conversation/src/disclosure.js";
import { conversationRequest, converse, type Complete, type ConversationInput, type LlmTurn } from "../../packages/conversation/src/conversation.js";
import { classifyQuestTransitions } from "../../packages/conversation/src/quest-classification.js";
import type { QuestService } from "../../packages/lore/src/quest-service.js";
import { CliTimeline } from "./timeline.js";

export interface ConversationResult {
  characterId: string;
  transcript: ConversationInput["transcript"];
  turns: LlmTurn[];
  gmTurns: CliGmCall[];
  analysis: MessageAnalysis[];
  decisionCalls: CliDecisionCall[];
  disclosure: DisclosureRound[];
  openedDocuments: ConversationInput["sources"];
}
interface AppProps {
  input: ConversationInput;
  complete: Complete;
  checks?: { quests?: Pick<QuestService, "list">; services?: Partial<RuntimeServices>; ai: AiService; build: DndCharacter | undefined; beginTurn?: () => void; beforeTurn?: () => Promise<DisclosureSession>; response?: (report: (event: import("../../packages/conversation/src/attention.js").AnalysisEvent) => void) => ConversationStrategy };
  disclosure?: DisclosureSession;
  copyText: (text: string) => Promise<string>;
  onFinish: (result: ConversationResult) => void;
}

export function ConversationApp({ input, complete, disclosure, checks, copyText, onFinish }: AppProps) {
  const renderer = useRenderer(), { width, height } = useTerminalDimensions();
  const [timeline] = useState(() => {
    const result = new CliTimeline();
    result.recordMessages(conversationRequest(input).messages.slice(0, -1));
    return result;
  });
  const gmCount = useRef(0);
  const [transcript, setTranscript] = useState(input.transcript);
  const [turns, setTurns] = useState<LlmTurn[]>([]);
  const [rounds, setRounds] = useState<DisclosureRound[]>([]);
  const [rollPrompt, setRollPrompt] = useState<ManualRoll | null>(null);
  const pendingRoll = useRef<((value: number) => void) | null>(null);
  const [decisionCalls, setDecisionCalls] = useState<CliDecisionCall[]>([]);
  const [analysis, setAnalysis] = useState<MessageAnalysis[]>([]);
  const [gmTurns, setGmTurns] = useState<CliGmCall[]>([]);
  const requestRoll: RequestRoll = (check, signal) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => { pendingRoll.current = null; setRollPrompt(null); reject(signal.reason); };
    signal.addEventListener("abort", cancel, { once: true });
    pendingRoll.current = value => {
      signal.removeEventListener("abort", cancel); pendingRoll.current = null; setRollPrompt(null); resolve(value);
    };
    setSelected(null); setDraft(""); setRollPrompt(check);
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
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
  const messageIds = timeline.messageIds(messages);
  const entries = timeline.sort([
    ...messages.map((message, index) => ({ id: `message-${index}`, timeId: messageIds[index]!, label: `${index + 1}. ${message.role}`, text: message.content ?? "No text content." })),
    ...gmTurns.map(call => ({ id: call.id, timeId: call.id, label: gmCallLabel(call), text: JSON.stringify(call, null, 2) })),
    ...decisionCalls.map(call => ({ id: call.id, timeId: call.id, label: decisionCallLabel(call), text: JSON.stringify(call, null, 2) })),
    ...rounds.flatMap(round => [
      { id: `jev-${round.turn}-${round.round}`, timeId: `jev-${round.turn}-${round.round}`, label: `Jev ${round.turn}.${round.round} ${round.status}`, text: disclosureDetails(round) },
      ...round.opened.map((document, index) => ({ id: `opened-${round.turn}-${round.round}-${index}`, timeId: `jev-${round.turn}-${round.round}`, label: `↳ ${document.path.split("/").at(-1)}`, text: `# ${document.path}\n${document.markdown}` })),
    ]),
  ]);
  const selectedIndex = entries.findIndex(entry => entry.id === selected);
  const source = selected === null
    ? formatConversation(transcript, input.characterId, analysis) || "Type a message to begin."
    : entries[selectedIndex]?.text ?? "No text content.";
  const choose = (id: string | null) => { renderer.clearSelection(); setSelected(id); };
  useEffect(() => () => controller.current.abort(), []);
  useEffect(() => {
    content.current?.scrollTo(selected === null ? content.current.scrollHeight : 0);
    if (selected !== null) sidebar.current?.scrollChildIntoView(selected);
  }, [selected]);
  async function send(message: string) {
    if (running.current || !message.trim()) return;
    running.current = true; setBusy(true); setStatus("");
    const index = turns.length;
    const messageIndex = transcript.length;
    setAnalysis(previous => previous.filter(event => event.messageIndex < messageIndex));
    try {
      if (checks?.beforeTurn) disclosure = await checks.beforeTurn();
      checks?.beginTurn?.();
      const turnInput = { ...input, ...(checks?.services?.scenario ? { world: checks.services.scenario.read() } : {}), transcript, message };
      const trace = (round: DisclosureRound) => {
        timeline.record(`jev-${round.turn}-${round.round}`);
        if (round.answers) {
          const source = `disclosure round ${round.round}`;
          setAnalysis(previous => [...previous.filter(event => !(event.messageIndex === messageIndex && event.kind === "labels" && event.source === source)),
            { messageIndex, kind: "labels", subject: "player", source, decisions: round.answers! }]);
        }
        setRounds(previous => {
          const index = previous.findIndex(item => item.turn === round.turn && item.round === round.round);
          return index < 0 ? [...previous, round] : previous.map((item, i) => i === index ? round : item);
        });
      };
      const tracedAi = checks && traceCliDecisions(traceCliGmCalls(checks.ai, call => {
        timeline.record(call.id);
        setGmTurns(previous => previous.some(item => item.id === call.id)
          ? previous.map(item => item.id === call.id ? call : item) : [...previous, call]);
      }, () => `gm-${gmCount.current++}`), call => {
        timeline.record(call.id);
        setDecisionCalls(previous => previous.some(item => item.id === call.id)
          ? previous.map(item => item.id === call.id ? call : item) : [...previous, call]);
      });
      const report = (event: import("../../packages/conversation/src/attention.js").AnalysisEvent) => setAnalysis(previous => [...previous, { ...event, messageIndex: messageIndex + (event.subject === "character" ? 1 : 0) }]);
      const strategies = disclosure && checks
        ? conversationStrategy(disclosure, tracedAi!, checks.build, message, requestRoll, trace, () => {}, {}, {}, checks.services ? { services: checks.services, characterId: input.characterId } : undefined,
        report, checks.response?.(report))
        : disclosure ? disclosure.strategy(trace) : directConversationStrategy;
      const runtime = new ConversationRuntime({
        services: { ...checks?.services, ...(tracedAi ? { ai: tracedAi } : {}), debug: { record: () => {} }, character: { respond: async (request, signal) => {
          const response = await complete(request, signal);
          signal?.throwIfAborted();
          // Stamp the reply before post-reply analysis starts, not when it finishes.
          timeline.recordMessages([...request.messages, response]);
          setTurns(previous => [...previous.slice(0, index), { request, response }]);
          return response;
        } } },
        strategies: { conversation: strategies },
      });
      let accepted: LlmTurn | undefined;
      const result = await converse({ ...turnInput, sources: disclosure?.sources ?? input.sources }, runtime, controller.current.signal,
        turn => {
          accepted = turn;
          timeline.recordMessages([...turn.request.messages, ...(turn.response ? [turn.response] : [])]);
          setTurns(previous => [...previous.slice(0, index), turn]);
        });
      setTranscript(result.transcript); setDraft("");
      if (checks?.quests && tracedAi && accepted?.response) {
        // Run only after acceptance; a classifier failure must not discard the spoken exchange.
        await classifyQuestTransitions(checks.quests.list(), input.characterId,
          [...accepted.request.messages, accepted.response], tracedAi, controller.current.signal);
      }
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
      onFinish({ characterId: input.characterId, transcript, gmTurns, analysis,
        decisionCalls: decisionCalls.map(call => call.status === "pending"
          ? { ...call, status: "failed", error: "Cancelled when conversation ended." } : call),
        disclosure: rounds.map(round => round.status === "pending" ? { ...round, status: "error", error: "Cancelled when conversation ended." } : round),
        openedDocuments: disclosure?.sources ?? input.sources,
        turns: turns.map(turn => turn.response || turn.error ? turn : { ...turn, error: "Cancelled when conversation ended." }),
      });
    } else if (key.name === "escape") { key.preventDefault(); choose(null); }
    else if (key.name === "tab") { key.preventDefault(); choose(selected === null ? entries[0]!.id : null); }
    else if (key.name === "pageup" || key.name === "pagedown" || (key.shift && ["up", "down"].includes(key.name))) {
      key.preventDefault();
      content.current?.scrollBy((key.name === "pageup" || key.name === "up" ? -1 : 1) * (key.shift ? 1 : Math.max(1, height - 7)));
    } else if (selected !== null && ["up", "down"].includes(key.name)) {
      key.preventDefault(); choose(entries[Math.max(0, Math.min(entries.length - 1, selectedIndex + (key.name === "up" ? -1 : 1)))]!.id);
    }
  });
  return <box width={width} height={height} flexDirection="column">
    <text height={1} selectable={false} truncate>{`Conversation · ${input.characterId}${busy ? " · Thinking…" : latest?.durationMs !== undefined ? ` · ${latest.durationMs}ms` : ""}`}</text>
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box width="80%" border flexDirection="column" paddingX={1}>
        <text height={1} selectable={false} truncate>{selected === null ? "Conversation" : `${entries[selectedIndex]?.label} · Esc to return`}</text>
        <scrollbox id="conversation-content" ref={content} flexGrow={1} minHeight={0} scrollX={false}
          stickyScroll={selected === null} stickyStart="bottom" viewportCulling={false}>
          <text id="message-content" flexShrink={0} wrapMode="word" selectable>{stripVTControlCharacters(source)}</text>
        </scrollbox>
        <text height={1} selectable={false} truncate fg="yellow">{status || " "}</text>
        <input id="conversation-input" value={draft} onInput={setDraft} onSubmit={() => {
          if (!rollPrompt) { void send(draft); return; }
          const value = Number(draft);
          if (!Number.isInteger(value) || value < 1 || value > 20) { setStatus("Enter a whole number from 1 to 20."); return; }
          setStatus(""); setDraft(""); pendingRoll.current?.(value);
        }}
          focused={selected === null && (!busy || !!rollPrompt)} placeholder={rollPrompt ? `${rollPrompt.skill} · ${rollPrompt.difficulty} · modifier ${rollPrompt.modifier >= 0 ? "+" : ""}${rollPrompt.modifier}: enter d20 (1–20)` : busy ? "Waiting for reply…" : "Say something…"} />
      </box>
      <box width="20%" border flexDirection="column">
        <text height={1} selectable={false} truncate>Messages / Jev</text>
        <scrollbox id="message-list" ref={sidebar} flexGrow={1} minHeight={0} scrollX={false} viewportCulling={false} stickyScroll stickyStart="bottom">
          {entries.map(entry => <text id={entry.id} key={entry.id} height={1} flexShrink={0}
            selectable truncate bg={selected === entry.id ? "#334155" : "transparent"}
            onMouseDown={event => { clickStart.current = { x: event.x, y: event.y }; }}
            onMouseUp={event => {
              // A drag selects sidebar text; only an un-dragged click opens it.
              if (event.x === clickStart.current?.x && event.y === clickStart.current?.y) choose(entry.id);
              clickStart.current = null;
            }}>{entry.label}</text>)}
        </scrollbox>
      </box>
    </box>
    <text height={1} selectable={false} truncate>Wheel scroll · Drag select · Ctrl+Y copy · Tab inspect · Esc chat · Ctrl+D finish</text>
  </box>;
}

export async function runConversationCli(input: ConversationInput, complete: Complete, disclosure?: DisclosureSession, checks?: AppProps["checks"]): Promise<ConversationResult> {
  let fail: (error: Error) => void = () => {};
  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false,
    onDestroy: () => fail(new Error("Conversation terminal closed.")),
  });
  const clipboard = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) });
  const root = createRoot(renderer);
  try {
    return await new Promise<ConversationResult>((resolve, reject) => {
      fail = reject;
      root.render(<ConversationApp input={input} complete={complete} {...(checks ? { checks } : {})} {...(disclosure ? { disclosure } : {})} onFinish={resolve} copyText={async text => {
        const result = await clipboard.writeText(text, { destination: "best-available" });
        if (result.host.status === "written") return "Copied selection.";
        if (result.terminal.status === "attempted") return "Copy sent to terminal clipboard.";
        throw new Error("No clipboard is available in this terminal.");
      }} />);
    });
  } finally { root.unmount(); renderer.destroy(); await clipboard.dispose(); }
}
