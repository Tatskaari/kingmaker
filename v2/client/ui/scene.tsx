// Cut from the prototype's src/app/ui/scene.tsx at 44c6d4a: the conversation, the status line, the box, the suggested lines (their rows kept while they come, :319-340) and the keys as written; the scene's place and its menu, the way on, talks' choices and glances go; it reads a SceneModel in place of the Game.
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, useState } from "react";
import type { Markup } from "../../shared/markup.ts";
import { MAX_LINE } from "../../shared/protocol/refusals.ts";
import { COMMANDS, commandNamed } from "../commands.ts";
import type { Style } from "../reply.ts";
import type { SceneModel } from "../scene/model.ts";
import type { Line, Suggestion } from "../scene/view.ts";
import { C, MARK_LABEL, MARK_TINT } from "../theme.ts";
import { BOLD, Clickable, fit, isEnter, ITALIC, Keys, SCROLLBAR, Spinner, useStore, wrap, type KeyHint } from "./common.tsx";
import { Reply } from "./reply.tsx";

/** The edge of a turn gone by; the latest has the panels' own. */
const EDGE = "#302b39";
/** The rules' word on what changed without a roll (what you carry, what's burning): not the dice's yellow. */
const INFO = "#7cc6b4";
/** The marks in a line's margin: the dice for a roll, an i in a ring for news (one column wide; the die has always taken two). */
const MARK = { roll: "🎲", info: "ⓘ" } as const;

/** One piece of the conversation: the scene's heading, a turn, or a line between turns (how it ended). */
type Part = { kind: "header"; line: Line } | { kind: "rule"; line: Line } | { kind: "turn"; lines: Line[] };

/**
 * The conversation a turn at a time: what was set before the player spoke, then each thing they said
 * or did with everything that answered it. The system's lines sit between turns.
 */
export function partsOf(lines: Line[]): Part[] {
  const parts: Part[] = [];
  let turn: Line[] | undefined;
  for (const line of lines) {
    if (line.kind === "header") { parts.push({ kind: "header", line }); turn = undefined; }
    else if (line.kind === "system") { parts.push({ kind: "rule", line }); turn = undefined; }
    else if (line.kind === "player" || !turn) { turn = [line]; parts.push({ kind: "turn", lines: turn }); }
    else turn.push(line);
  }
  return parts;
}

/**
 * What the transcript needs to show the GM's markup: each line's markup, each speaker's colour, the
 * mark Tab picked out, and what a click or the pointer on one does. A line is known by its place in
 * the transcript's lines (the live one comes after them).
 */
export interface MarkView {
  markup: (line: Line) => Markup | undefined;
  color: (speaker: string | undefined) => string;
  focus?: { line: number; mark: number } | undefined;
  open?: (line: number, mark: number, x: number, y: number) => void;
  point?: (line: number, mark: number | undefined) => void;
}

/**
 * The conversation, in turns: each exchange in its own box, the latest the brightest; `live` is the
 * reply streaming in. With `width` (the columns it has) and `marks`, the GM's replies are drawn
 * with their markup: each person's lines in their colour, in paragraphs, the marked phrases to click.
 */
export function Transcript({ lines, live, width, marks }: { lines: Line[]; live?: Line | undefined; width?: number; marks?: MarkView }) {
  const all = live ? [...lines, live] : lines;
  const parts = partsOf(all);
  const last = parts.findLastIndex(p => p.kind === "turn");
  const index = new Map(all.map((l, i) => [l, i]));
  const shown: Shown | undefined = width && marks ? { width: width - 4, marks, index } : undefined;
  return <box flexDirection="column" flexShrink={0}>
    {parts.map((part, i) => part.kind === "header"
      ? <box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
        <text fg={C.title} attributes={BOLD}>{`— ${part.line.name} —`}</text>
        {part.line.text ? <text fg={C.dim} attributes={ITALIC} wrapMode="word">{part.line.text}</text> : null}
      </box>
      : part.kind === "rule" ? <Rule key={i} line={part.line} />
      : <Turn key={i} lines={part.lines} latest={i === last} live={live} shown={shown} />)}
  </box>;
}

/** How a turn's replies are drawn with their markup: the columns inside a turn's box, and what to draw it with. */
interface Shown { width: number; marks: MarkView; index: Map<Line, number> }

/** A reply's markup as drawn: what Tab picked out lit up, and colours by speaker and kind. */
export function replyStyle(marks: MarkView, focus?: number): Style {
  return { narration: C.gm, speech: marks.color, voice: C.speech, mark: kind => MARK_TINT[kind], ...(focus !== undefined ? { focus: { mark: focus, fg: C.bg, bg: kind => C[kind] } } : {}) };
}

/** A line between turns: how the scene ended as a rule across, the rest as a note. */
function Rule({ line }: { line: Line }) {
  const ending = /^Scene ends: (.+)$/.exec(line.text)?.[1];
  if (ending) return <text flexShrink={0} marginBottom={1} textAlign="center" wrapMode="word">
    <span fg={C.border}>{"──────── "}</span><span fg={C.system} attributes={ITALIC}>{ending}</span><span fg={C.border}>{" ────────"}</span>
  </text>;
  return <text marginBottom={1} wrapMode="word" flexShrink={0} fg={C.system}>{`— ${line.text} —`}</text>;
}

/** One exchange: the player's line (under their name, with a bar down its side), then all that answered it. */
function Turn({ lines, latest, live, shown }: { lines: Line[]; latest: boolean; live?: Line | undefined; shown?: Shown | undefined }) {
  const said = lines[0]?.kind === "player" ? lines[0] : undefined;
  const answer = said ? lines.slice(1) : lines;
  return <box border borderStyle="rounded" borderColor={latest ? C.border : EDGE} paddingX={1} flexDirection="column" flexShrink={0}
    {...(said ? { title: ` ${said.name ?? "You"} `, titleAlignment: "left" as const, titleColor: C.player } : {})}>
    {said ? <box border={["left"]} borderStyle="heavy" borderColor={C.player} paddingLeft={1} flexShrink={0}>
      <text fg={C.player} wrapMode="word">{said.text}</text>
    </box> : null}
    {answer.map((line, i) => {
      const prev = i ? answer[i - 1] : said;
      // The rules' lines come in bursts: no gap between them.
      const close = !!prev && isMarked(prev) && isMarked(line);
      return <Entry key={i} line={line} live={line === live} gap={prev && !close ? 1 : 0} shown={shown} />;
    })}
  </box>;
}

const isMarked = (line: Line) => line.kind === "roll" || line.kind === "info";

function Entry({ line, live, gap, shown }: { line: Line; live?: boolean; gap: number; shown?: Shown | undefined }) {
  const cursor = live ? <span fg={C.title}>▍</span> : null;
  // A GM reply with its markup: each person's lines in their colour, in paragraphs, its marks to click.
  const markup = shown && line.kind === "narration" ? shown.marks.markup(line) : undefined;
  if (shown && markup) {
    const at = shown.index.get(line) ?? -1;
    const focus = shown.marks.focus?.line === at ? shown.marks.focus.mark : undefined;
    return <box marginTop={gap} flexShrink={0}>
      <Reply text={line.text} markup={markup} width={shown.width} style={replyStyle(shown.marks, focus)} cursor={live ? C.title : undefined}
        onOpen={(m, x, y) => shown.marks.open?.(at, m, x, y)} onPoint={m => shown.marks.point?.(at, m)} />
    </box>;
  }
  switch (line.kind) {
    case "player":
      return <text marginTop={gap} wrapMode="word" flexShrink={0} fg={C.player}>{line.text}</text>;
    case "dialogue":
      return <text marginTop={gap} wrapMode="word" flexShrink={0}><span fg={shown?.marks.color(line.speaker) ?? C.name} attributes={BOLD}>{`${line.name ?? line.speaker}: `}</span><span fg={C.gm}>{line.text}</span>{cursor}</text>;
    case "roll": case "info": {
      // The mark in its own margin, so a long line wraps under its words, not under the mark.
      const color = line.kind === "roll" ? C.dice : INFO;
      return <box marginTop={gap} flexDirection="row" flexShrink={0}>
        <text width={3} flexShrink={0} fg={color}>{MARK[line.kind]}</text>
        <text flexGrow={1} flexShrink={1} wrapMode="word" fg={color}>{line.text}</text>
      </box>;
    }
    case "error":
      return <text marginTop={gap} wrapMode="word" flexShrink={0} fg={C.danger}>{line.text}</text>;
    case "system":
      return <text marginTop={gap} wrapMode="word" flexShrink={0} fg={C.system}>{`— ${line.text} —`}</text>;
    default:
      return <text marginTop={gap} wrapMode="word" flexShrink={0}><span fg={C.gm}>{line.text}</span>{cursor}</text>;
  }
}

/** The side panel's width beside the conversation: a narrow one at 80 columns, none narrower. */
export const sceneSide = (width: number) => (width >= 100 ? Math.min(62, Math.floor(width * 0.42)) : width >= 80 ? 26 + Math.floor((width - 80) / 4) : 0);

/** Something to pick above the box: a suggested line, or a command being typed. */
interface Pick { key: string; label: string; color: string; run: () => void }

/**
 * A scene's suggested lines that fit in `rows` (to say, to do, a risky try, a way out, in that
 * order): a second line to say gives way first, so every kind keeps its line.
 */
export function fitSuggestions(all: Suggestion[], rows: number): Suggestion[] {
  const keep = [...all];
  while (keep.length > rows) {
    const second = keep.findIndex((k, i) => k.kind === "say" && keep.slice(0, i).some(e => e.kind === "say"));
    keep.splice(second >= 0 ? second : keep.length - 1, 1);
  }
  return keep;
}

/** The suggested lines' colours, by kind: a risky try in the dice's yellow, a way out quieter than the rest. */
const KIND_COLOR: Record<Suggestion["kind"], string> = { say: C.player, do: C.player, try: C.dice, leave: C.dim };

/** The choices, a line each, in `rows` rows. */
function Picks({ picks, rows, width }: { picks: Pick[]; rows: number; width: number }) {
  return <box flexDirection="column" paddingX={1} flexShrink={0} height={rows}>
    {picks.map((p, i) => <Clickable key={i} height={1} flexShrink={0} onClick={p.run}>
      <text flexShrink={0}>
        <span fg={C.title}>{`${p.key} `}</span>
        <span fg={p.color}>{truncate(p.label, Math.max(8, width - p.key.length - 4))}</span>
      </text>
    </Clickable>)}
  </box>;
}

/**
 * A scene: the conversation on the left, with the box to type in; on the right, the character
 * whose scene it is, who's there and the game's number (a narrow panel at 80 columns, none below
 * it). The line under the conversation says what the GM is doing while it has the floor, or the
 * game's word (a refusal, or what the turn is waiting on). A spectator's box never opens: it says
 * who has the lead. Tab goes through the last reply's marked phrases, Enter opens the one picked
 * out, a click opens any.
 */
export function SceneScreen({ scene }: { scene: SceneModel }) {
  useStore(scene);
  const { width, height } = useTerminalDimensions();
  const [draft, setDraft] = useState("");
  const scroll = useRef<ScrollBoxRenderable>(null);
  const input = useRef<InputRenderable>(null);
  const view = scene.view;
  /**
   * What's in the box now. The draft is as of the last render: keys that came in the same read as
   * this one (a paste, a fast typist, a browser's terminal) are in the input but not the draft yet.
   */
  const typed = () => input.current?.value ?? draft;
  // Emptied directly too: a draft that went "#exits" and back to "" between two renders never changes the prop.
  const clear = () => { setDraft(""); if (input.current) input.current.value = ""; };
  const send = (value: string) => {
    if (!value.trim()) return;
    const command = /^[/#]/.test(value.trim());
    // A line waits in the box while the GM has the floor; a command goes any time. A line the
    // simulation refuses in words worth seeing goes too (a spectator's, after the end, while a turn is failed).
    if (!command && !scene.sends()) return;
    clear();
    scene.input(value);
  };
  // What to pick above the box: a command being typed, or the scene's suggested lines (a number or a
  // click puts one in the box, to send or change). Anything else typed puts them away.
  const typing = /^[/#]/.test(draft) ? draft.slice(1).split(/\s+/)[0]!.toLowerCase() : undefined;
  const commands = typing === undefined || draft.includes(" ") ? [] : COMMANDS.filter(c => c.name.startsWith(typing) || commandNamed(typing) === c.name);
  const room = Math.min(9, Math.max(3, height - 18));
  /** The suggested lines have rows of their own, kept for them while they're on their way, so the conversation doesn't move when they come. */
  const rows = height < 26 ? 4 : 5;
  const choices = fitSuggestions(view.suggestions, rows);
  /** Put a suggested line in the box (in place of nothing: they're shown only while it's empty). */
  const fill = (line: string) => { if (input.current) { input.current.value = line; input.current.focus(); } setDraft(line); };
  const toPick: Pick[] = typing !== undefined ? commands.slice(0, room).map(c => ({ key: `/${c.name}`, label: c.what, color: c.testing ? C.faint : C.dim, run: () => send(`/${c.name}`) }))
    : draft ? []
    : choices.map((s, i) => ({ key: String(i + 1), label: s.text, color: KIND_COLOR[s.kind], run: () => fill(choices[i]!.text) }));
  // The rows they take: a command's list, or nothing with words in the box; else the suggested lines' own, kept while they're coming.
  const kept = typing !== undefined || draft ? toPick.length : (toPick.length || view.suggestionsComing) ? rows : 0;

  const side = sceneSide(width);
  const narrow = width < 100;
  /** Tab: the last reply's marked phrases, and round again; Shift+Tab the other way. */
  const tab = (by: number) => {
    const marks = scene.lastMarks();
    if (!marks.length) return;
    const focus = scene.markFocus;
    const at = focus ? marks.findIndex(m => m.line === focus.line && m.mark === focus.mark) : -1;
    scene.markFocus = marks[at < 0 ? (by > 0 ? 0 : marks.length - 1) : (at + by + marks.length) % marks.length];
    scene.markPointed = undefined;
    scene.emit();
  };

  useKeyboard(key => {
    if (scene.overlay || key.defaultPrevented) return;
    if (key.name === "pageup" || key.name === "pagedown") {
      scroll.current?.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(3, height - 12));
    } else if (key.name === "escape") {
      // Esc lets go of what Tab picked out.
      if (scene.markFocus) { key.preventDefault(); scene.markFocus = undefined; scene.emit(); }
    } else if (key.name === "tab" && scene.lastMarks().length) {
      // The box has no use for Tab: it goes through the last reply's marks.
      key.preventDefault();
      tab(key.shift ? -1 : 1);
    } else if (isEnter(key) && !typed() && scene.markFocus) {
      // Enter with nothing in the box, on a mark Tab picked out: what it says.
      key.preventDefault();
      scene.openMark(scene.markFocus.line, scene.markFocus.mark);
    } else if (!typed() && /^[1-9]$/.test(key.sequence ?? "") && toPick[Number(key.sequence) - 1] && typing === undefined) {
      // A number picks one of the suggested lines, while nothing's been typed (it goes in the box, even with the GM still busy).
      key.preventDefault();
      toPick[Number(key.sequence) - 1]!.run();
    }
  });

  const lines = scene.lines();
  // The GM's replies with their markup: each speaker's colour, the mark Tab picked out, a click opens one.
  const markView: MarkView = {
    markup: line => line.marked, color: id => scene.speechColor(id), focus: scene.overlay ? undefined : scene.markFocus,
    open: (line, mark, x, y) => scene.openMark(line, mark, x, y),
    point: (line, mark) => {
      const was = scene.markPointed;
      if (mark === undefined) { if (was?.line !== line) return; scene.markPointed = undefined; }
      else if (was?.line === line && was.mark === mark) return;
      else scene.markPointed = { line, mark };
      scene.emit();
    },
  };
  const inner = side - 4;
  const busy = scene.busy();
  const open = view.mayType && !scene.gone;
  // The game's word on the status line, in place of the spinner: the client's own, that the game has
  // gone from the server, that the box is full, the simulation's last refusal (until the scene moves
  // on), or what the turn is waiting on (the AI service lost, and asked again; the server out of reach).
  const full = draft.length >= MAX_LINE ? `(The box is full: a turn takes ${MAX_LINE.toLocaleString("en-GB")} characters at most.)` : undefined;
  const said = scene.status ?? scene.gone ?? full ?? scene.refusal() ?? view.note;
  // The box, while it's shut: the game gone, the scene over, who has the lead, a failed turn's /retry, or the GM has the floor.
  const shut = scene.gone ? "The game is gone from the server." : view.over ? "The scene is over."
    : view.watching ? `${view.watching} has the lead: you're watching.`
    : view.phase === "failed" ? "The GM lost the thread: /retry carries it on."
    : "The GM has the floor…";
  const status = view.player.status ?? "";
  // How to talk: plain words are speech; asterisks and brackets are deeds. (A narrow panel leaves it to the box's own hint.)
  const talk = narrow ? [] : [
    ...wrap("Plain words are what you say:", inner).map(text => ({ text, color: C.faint })),
    { text: "  Who paid you, then?", color: C.player },
    ...wrap("*Asterisks* or (brackets) are what you do:", inner).map(text => ({ text, color: C.faint })),
    { text: "  *looks over my shoulder*", color: C.player },
    { text: "  (I cast Fireball)", color: C.player },
  ];
  const keys: KeyHint[] = [
    ...(toPick.length && typing === undefined ? [[`1–${toPick.length}`, "into the box"] as KeyHint] : []),
    ["/help", "", () => { scene.input("/help"); }],
    ...(scene.lastMarks().length ? [["Tab", "marks"] as KeyHint] : []), ["PgUp/PgDn", "scroll"],
    ["/quit", "", () => { scene.input("/quit"); }],
  ];
  // A marked phrase picked out (Tab) or pointed at: what it is, on the bottom line.
  const markAt = !scene.overlay ? scene.markPointed ?? scene.markFocus : undefined;
  const marked = markAt ? lines[markAt.line] : undefined;
  const theMark = markAt ? marked?.marked?.marks[markAt.mark] : undefined;
  const markLine = theMark && marked ? {
    title: `${MARK_LABEL[theMark.kind]}: ${marked.text.slice(theMark.start, theMark.end)}`,
    // On a narrow screen, what to do about it before the start of its note (the popover has it whole).
    detail: narrow ? "" : theMark.note,
    hint: scene.markPointed ? { long: theMark.kind === "why" ? "click to see why" : "click to read it", short: theMark.kind === "why" ? "click: why" : "click: read" } : { long: "Enter to read it  ·  Esc lets go", short: "Enter: read · Esc: let go" },
  } : undefined;
  // The conversation's frame: everything but the status line, what's to pick, the box and the bottom line.
  scene.talkArea = { w: width - side, h: height - 5 - kept };
  // Where the conversation ends on screen: the scroll box's content is the transcript alone.
  scene.talkEnd = () => { const talk = scroll.current?.content.getChildren()[0]; return talk ? talk.screenY + talk.height - 1 : undefined; };
  const title = view.time ? ` ${view.title} · ${view.time} ` : ` ${view.title} `;
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box flexGrow={1} border borderColor={C.border} title={title} titleAlignment="left" flexDirection="column" paddingX={1}>
        {/* The scrollbar is laid over a column kept for it (see SCROLLBAR): the talk never loses a character under it. */}
        {/* Not focusable: a click on the conversation leaves the box with the keys. */}
        <scrollbox ref={scroll} focusable={false} flexGrow={1} minHeight={0} scrollX={false} stickyScroll stickyStart="bottom" viewportCulling={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
          <Transcript lines={lines} live={scene.live()} width={width - side - 5} marks={markView} />
        </scrollbox>
      </box>
      {side ? <box width={side} border borderColor={C.border} title=" At the scene " flexDirection="column" paddingX={1} overflow="hidden">
        {view.watching ? <text fg={C.dim} flexShrink={0}>Watching</text> : null}
        <text fg={C.player} attributes={BOLD} flexShrink={0}>{truncate(view.player.name, inner)}</text>
        {status ? <text fg={C.dim} flexShrink={0}>{wrap(status, inner).join("\n")}</text> : null}
        <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title}>Here</text>
          {view.present.map(p => <text key={p.key} fg={p.color ?? C.text}>{truncate(p.name, inner)}</text>)}
        </box>
        {/* The game's number: a second terminal watches with it. */}
        <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title}>{`Game ${view.game}`}</text>
          <text fg={C.faint}>{truncate(`--join ${view.game} to watch`, inner)}</text>
        </box>
        {talk.length ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title} flexShrink={0}>How to talk</text>
          {talk.map((l, i) => <text key={i} flexShrink={0} fg={l.color}>{truncate(l.text, inner)}</text>)}
        </box> : null}
      </box> : null}
    </box>
    <box height={1} paddingX={1} flexShrink={0}>
      {busy && !said ? <Spinner label={busy} /> : <text fg={said ? C.warn : C.faint}>{said ?? " "}</text>}
    </box>
    {kept ? <Picks picks={toPick} rows={kept} width={width - 2} /> : null}
    <box height={3} flexShrink={0} border borderColor={open ? C.borderHot : C.border} title=" What do you say? " titleAlignment="left" paddingX={1}>
      {/* Talking is the default: plain words are said out loud; asterisks and brackets are things done. */}
      {/* What's submitted is what the input holds as Enter comes: the letters before it in the same read are in it, and not yet in the draft. */}
      {/* As much as a turn takes (the simulation's limit): OpenTUI's own is 1,000, and it cut a longer line without a word. */}
      <input ref={input} scrollMargin={0.05} maxLength={MAX_LINE} value={draft} onInput={setDraft} onSubmit={(value: unknown) => send(typeof value === "string" ? value : typed())} focused={!scene.overlay}
        placeholder={!open ? shut : width >= 100
          ? "Say it out loud. Do things in *asterisks* or (brackets): *looks over my shoulder*, (I cast Fireball)"
          : "Say it out loud; *asterisks* or (brackets) to do things"} />
    </box>
    <box height={1} paddingX={1} flexShrink={0}>
      {markLine ? <PointerLine title={markLine.title} detail={markLine.detail} width={width - 2} hint={markLine.hint} />
        : <Keys items={fit(keys, width - 2, width < 100 ? 3 : 5)} gap={width < 100 ? " · " : "  ·  "} />}
    </box>
  </box>;
}

/**
 * The bottom line while a mark is picked out or pointed at (in place of the keys): what it is, the
 * start of its note, and what a click (or Enter) does, as much as fits: the name always, then the
 * note, then the hint (its short form on a narrow screen, none when there's no room).
 */
function PointerLine({ title, detail, hint, width }: { title: string; detail: string; hint: { long: string; short: string } | undefined; width: number }) {
  const sep = width < 100 ? " · " : "  ·  ";
  const what = truncate(title, width);
  const left = width - what.length;
  const said = detail ? sep.length + detail.length : 0;
  const hints = hint ? [hint.long.replace(/ {2}· {2}/g, sep), hint.short].map(h => `${sep}${h}`) : [];
  // What it's doing first, whole if it can be, then as much of the hint as is left room for.
  const tail = hints.find(h => said + h.length <= left) ?? hints.slice(1).find(h => (detail ? sep.length + 12 : 0) + h.length <= left) ?? "";
  const more = detail ? truncate(`${sep}${detail}`, left - tail.length) : "";
  return <text flexShrink={0} height={1}>
    <span fg={C.title} attributes={BOLD}>{what}</span>
    <span fg={C.text}>{more.length > sep.length + 1 ? more : ""}</span>
    <span fg={C.dim}>{tail}</span>
  </text>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
