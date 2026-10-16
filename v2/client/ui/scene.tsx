// Cut from the prototype's src/app/ui/scene.tsx at 44c6d4a: the conversation, the status line, the box, the suggested lines (their rows kept while they come, :319-340), the keys as written, transcriptRows (:116-127, less the look's notes), and once the scene is over its way on in place of the box (:230-256, onward and Continue, with the over-key handling at :459-466); and the scene's place (the world bridge): glance notes (:48, :99-105), pointing, the menu and Tab through the place (:258-260, :345-432, the place's keys in useKeyboard, :483-495's menuKey), the bottom line about what's pointed at (:533-540), the place in the side panel (:562-571) and the menu over it (:599-602); talks' choices go; it reads a SceneModel in place of the Game.
import type { InputRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { Markup } from "../../shared/markup.ts";
import { MAX_LINE } from "../../shared/protocol/refusals.ts";
import { COMMANDS, commandNamed } from "../commands.ts";
import type { LookCanvasRenderable } from "../look/opentui.ts";
import type { StagePicks } from "../look/stage.ts";
import { replyRows, type Style } from "../reply.ts";
import { pointedAt, pointOrder, sameTarget, thingActions, type SceneAction, type SceneTarget } from "../scene/menu.ts";
import type { SceneMenu, SceneModel } from "../scene/model.ts";
import type { Line, SceneView, Suggestion } from "../scene/view.ts";
import type { WayOn } from "../story/view.ts";
import { C, MARK_LABEL, MARK_TINT } from "../theme.ts";
import { BOLD, Clickable, fit, isEnter, ITALIC, Keys, SCROLLBAR, Spinner, useStore, wayOnKey, wrap, type KeyHint } from "./common.tsx";
import { MenuBox } from "./menu.tsx";
import { Place, type PlacePointing } from "./place.tsx";
import { Reply } from "./reply.tsx";

/** The edge of a turn gone by; the latest has the panels' own. */
const EDGE = "#302b39";
/** The rules' word on what changed without a roll (what you carry, what's burning): not the dice's yellow. */
const INFO = "#7cc6b4";
/** A look at something in the place: the pointer's blue, quietly. */
const LOOK = "#7f9fc8";
/** The marks in a line's margin: the dice for a roll, an i in a ring for news, an eye-ish ring for a look (one column wide; the die has always taken two). */
const MARK = { roll: "🎲", info: "ⓘ", look: "◉" } as const;

/**
 * One piece of the conversation: the scene's heading, a turn, a line between turns (how it ended),
 * or a note of something looked at (the place's menu's Look: not a turn).
 */
type Part = { kind: "header"; line: Line } | { kind: "rule"; line: Line } | { kind: "turn"; lines: Line[] } | { kind: "note"; line: Line };

/**
 * The conversation a turn at a time: what was set before the player spoke, then each thing they said
 * or did with everything that answered it. The system's lines sit between turns. A look sits after
 * the turn it came in, and the turn goes on growing above it (a look while the GM is mid-reply
 * doesn't split the reply).
 */
export function partsOf(lines: Line[]): Part[] {
  const parts: Part[] = [];
  let turn: Line[] | undefined;
  for (const line of lines) {
    if (line.kind === "header") { parts.push({ kind: "header", line }); turn = undefined; }
    else if (line.kind === "system") { parts.push({ kind: "rule", line }); turn = undefined; }
    else if (line.kind === "look") parts.push({ kind: "note", line });
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
      : part.kind === "note" ? <Note key={i} line={part.line} />
      : <Turn key={i} lines={part.lines} latest={i === last} live={live} shown={shown} />)}
  </box>;
}

/** How a turn's replies are drawn with their markup: the columns inside a turn's box, and what to draw it with. */
interface Shown { width: number; marks: MarkView; index: Map<Line, number> }

/** A reply's markup as drawn: what Tab picked out lit up, and colours by speaker and kind. */
export function replyStyle(marks: MarkView, focus?: number): Style {
  return { narration: C.gm, speech: marks.color, voice: C.speech, mark: kind => MARK_TINT[kind], ...(focus !== undefined ? { focus: { mark: focus, fg: C.bg, bg: kind => C[kind] } } : {}) };
}

/** Something looked at in the place: a quiet note between turns, the look's mark in its own margin (it isn't a turn, and the GM never hears it). */
function Note({ line }: { line: Line }) {
  return <box flexDirection="row" marginBottom={1} paddingX={1} flexShrink={0}>
    <text width={3} flexShrink={0} fg={LOOK}>{MARK.look}</text>
    <text flexGrow={1} flexShrink={1} wrapMode="word" fg={C.dim} attributes={ITALIC}>{line.text}</text>
  </box>;
}

/** A line between turns: how the scene ended as a rule across, the rest as a note. */
function Rule({ line }: { line: Line }) {
  const ending = /^Scene ends: (.+)$/.exec(line.text)?.[1];
  if (ending) return <text flexShrink={0} marginBottom={1} textAlign="center" wrapMode="word">
    <span fg={C.border}>{"──────── "}</span><span fg={C.system} attributes={ITALIC}>{ending}</span><span fg={C.border}>{" ────────"}</span>
  </text>;
  return <text marginBottom={1} wrapMode="word" flexShrink={0} fg={C.system}>{`— ${line.text} —`}</text>;
}

/** About how many rows a conversation takes at a width (for a panel sized to fit it): its turns, their borders, the gaps. */
export function transcriptRows(lines: Line[], width: number): number {
  const inner = width - 4;
  const style: Style = { narration: "", speech: () => "", mark: () => "" };
  return partsOf(lines).reduce((n, part) => {
    if (part.kind !== "turn") return n + 1 + (part.kind === "header" ? 1 + wrap(part.line.text, width).length : 0);
    const rows = part.lines.map((l, i) => (i ? 1 : 0) + (l.kind === "narration" && l.marked ? replyRows(l.text, l.marked, inner, style).length
      : wrap(l.kind === "dialogue" ? `${l.name ?? l.speaker}: ${l.text}` : l.text, l.kind === "player" || isMarked(l) ? inner - 3 : inner).length));
    return n + 2 + rows.reduce((a, b) => a + b, 0);
  }, 0);
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

/**
 * The open box's hint: plain words are said, asterisks and brackets are done, with a deed V0 can
 * play in the yard (a spell waits for V7, which brings spells into a scene). The short one where the
 * long won't fit whole.
 */
const HINT = "Say it out loud. Do things in *asterisks* or (brackets): *looks over my shoulder*, (I check his pockets)";
const HINT_SHORT = "Say it out loud; *asterisks* or (brackets) to do things";

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

/** What the pointer's on in the place, and how it got there: the mouse on the place or on the list, or Tab and the arrows. */
interface Pointer { target: SceneTarget; from: "place" | "list" | "keys" }

/** The side panel's rows for the game's number: its own and its --join on a wide panel, one line on a narrow one (with the place). */
const GAME_ROWS = { wide: 3, narrow: 2 } as const;

/**
 * In place of the box once the scene is over: the way on, to press or click when the player has
 * finished reading (the prototype's Continue). Its hint in short where the whole won't fit (80 columns).
 */
function Continue({ way, onGo, width }: { way: WayOn; onGo: () => void; width: number }) {
  const { title, go, ready, fight } = way;
  const wait = `   (take your time: the last word stays put)`;
  const hint = ready ? "   Enter, or click here" : go.length + wait.length + 6 <= width ? wait : "   (take your time)";
  return <Clickable height={3} flexShrink={0} border borderColor={!ready ? C.border : fight ? C.danger : C.borderHot}
    title={` ${title} `} titleAlignment="left" titleColor={fight ? C.danger : C.title} paddingX={1} onClick={onGo}>
    <text>
      <span fg={ready ? C.lead : C.faint}>{"▶ "}</span>
      <span fg={!ready ? C.dim : fight ? C.danger : C.lead} attributes={ready ? BOLD : 0}>{go}</span>
      <span fg={C.faint}>{hint}</span>
    </text>
  </Clickable>;
}

/**
 * A scene: the conversation on the left, with the box to type in; on the right, the character
 * whose scene it is, the place drawn from above with who's in it (the cast listed by name until its
 * rows come), and the game's number (a narrow panel at 80 columns, none below it). The line under
 * the conversation says what the GM is doing while it has the floor, or the game's word (a refusal,
 * or what the turn is waiting on). A spectator's box never opens: it says who has the lead. Tab goes
 * through the last reply's marked phrases, then what's in the place; Enter opens the mark picked out,
 * or the menu of what Tab picked out in the place; a click opens any mark. Point at someone or
 * something in the place (or in the list under it) and the bottom line says what they are; a click
 * talks to someone or glances at something; a right-click opens a menu of what can be done with it,
 * in the map's style, inside the panel. A right-click on the open menu is one on what's under it,
 * never a choice: only a left click, a number or Enter chooses. A glance is instant (a quiet note in
 * the conversation); talking starts the line in the box with their name; the rest are deeds, sent as
 * the lead's line as if typed. The box keeps every key that's meant for it: what it doesn't use
 * (Tab), or doesn't need with nothing in it (↑↓, and Enter on what Tab picked out), goes to the
 * place; anything typed with the menu open closes it and goes in the box. Once the scene is over (or
 * its fight is next), the way on takes the box's place (story-design §4.5): an Enter of its own goes
 * on, or a click.
 */
export function SceneScreen({ scene }: { scene: SceneModel }) {
  useStore(scene);
  const { width, height } = useTerminalDimensions();
  const [draft, setDraft] = useState("");
  const scroll = useRef<ScrollBoxRenderable>(null);
  const input = useRef<InputRenderable>(null);
  /** The scene that's over whose keys have been looked at (to see what was in the box as it ended). */
  const seen = useRef<SceneView | undefined>(undefined);
  const [pointer, setPointer] = useState<Pointer | undefined>(undefined);
  const canvas = useRef<LookCanvasRenderable>(null);
  const picks = useRef<StagePicks | undefined>(undefined);
  /** Who or what is drawn at a cell of the screen, in the place or its list (the place says, as it's drawn). */
  const hit = useRef<((x: number, y: number) => SceneTarget | undefined) | undefined>(undefined);
  /** The name the box was last started with (talking to someone), so talking to someone else starts it with theirs instead. */
  const started = useRef<string | undefined>(undefined);
  /** The scene's end has been seen by the keys (the way back to the map): what was in the box then goes unsaid. */
  // An overlay coming up (a click on /sheet) puts the menu away.
  useEffect(() => { if (scene.overlay && scene.sceneMenu) scene.closeSceneMenu(); });
  const view = scene.view;
  const way = scene.wayOn();
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
    started.current = undefined;
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
  const fill = (line: string) => { started.current = undefined; if (input.current) { input.current.value = line; input.current.focus(); } setDraft(line); };
  const toPick: Pick[] = typing !== undefined ? commands.slice(0, room).map(c => ({ key: `/${c.name}`, label: c.what, color: c.testing ? C.faint : C.dim, run: () => send(`/${c.name}`) }))
    : draft ? []
    : choices.map((s, i) => ({ key: String(i + 1), label: s.text, color: KIND_COLOR[s.kind], run: () => fill(choices[i]!.text) }));
  // The rows they take: a command's list, or nothing with words in the box; else the suggested lines' own, kept while they're coming.
  const kept = typing !== undefined || draft ? toPick.length : (toPick.length || view.suggestionsComing) ? rows : 0;

  // The place needs room to be drawn: beside the transcript, a narrow panel on a narrow terminal (80 columns).
  const side = sceneSide(width);
  const narrow = width < 100;
  // The place: pointing at what's in it, and its menu.
  const world = scene.place.world;
  const ctx = scene.sceneContext();
  /** Point at something (or let go of it), from wherever: the latest pointing wins; letting go only lets go of what was pointed at from there. */
  const point = (target: SceneTarget | undefined, from: Pointer["from"]) => setPointer(p => {
    if (!target) return p?.from === from ? undefined : p;
    return p && p.from === from && sameTarget(p.target, target) ? p : { target, from };
  });
  /** Start the line in the box (talking to someone): their name first, before whatever was being typed (in place of whoever it started with). */
  const startLine = (start: string) => {
    const now = typed();
    const rest = started.current && now.startsWith(started.current) ? now.slice(started.current.length) : now;
    const next = rest.startsWith(start) ? rest : `${start}${rest}`;
    started.current = start;
    if (input.current) { input.current.value = next; input.current.focus(); }
    setDraft(next);
  };
  /** Do one of the menu's actions: look (a note, at once), talk (start the line), or a deed (the lead's line). */
  const act = (a: SceneAction) => {
    if (a.start !== undefined) startLine(a.start);
    else if (a.look !== undefined) scene.lookNote(a.look);
    else if (a.line) scene.deed(a.line);
  };
  const choose = (i: number) => {
    const menu = scene.sceneMenu, a = menu?.actions[i];
    if (!menu || !a) return;
    // What to give, which spell, something else that's there: its own menu, where this one was.
    if (a.choices) { scene.sceneMenu = { ...menu, title: a.title ?? a.label, actions: a.choices, index: 0, parent: menu }; scene.emit(); return; }
    scene.closeSceneMenu();
    act(a);
  };
  /** Open the menu for something: where the mouse was, or where it's drawn (Enter on what Tab picked out). */
  const openFor = (target: SceneTarget, at?: { x: number; y: number }) => {
    const c = canvas.current;
    const cell = "id" in target ? picks.current?.cellOf(target.id) : target.cell;
    scene.openSceneMenu(target, at?.x ?? (c && cell ? c.x + cell.x : width - side), at?.y ?? (c && cell ? c.y + cell.y : 1));
  };
  /** Tab and the arrows: through what's in the place (the people first), lighting each up. (A mark Tab had picked out is let go of first, outside the state's update: the model's emit redraws.) */
  const step = (by: number) => {
    const p = picks.current;
    if (!world || !p || p.scene !== world.scene || !pointOrder(world, p.shown()).length) return;
    if (scene.markFocus) { scene.markFocus = undefined; scene.emit(); }
    setPointer(was => stepFrom(was, by, p));
  };
  const stepFrom = (was: Pointer | undefined, by: number, p: StagePicks): Pointer | undefined => {
    if (!world) return was;
    const all = pointOrder(world, p.shown());
    if (!all.length) return was;
    const at = was && "id" in was.target ? all.indexOf(was.target.id) : -1;
    const id = all[at < 0 ? (by > 0 ? 0 : all.length - 1) : (at + by + all.length) % all.length]!;
    // What's under it where it's drawn comes with it (the rope under Prout).
    const cell = p.cellOf(id);
    const there = cell ? p.at(cell.x, cell.y) : undefined;
    return { target: { id, ...(there?.id === id && there.under ? { under: there.under } : {}) }, from: "keys" };
  };
  /** What's in the place, in Tab's order (none until it's been drawn). */
  const placeOrder = () => (world && side && picks.current?.scene === world.scene ? pointOrder(world, picks.current.shown()) : []);
  /**
   * Tab: the last reply's marked phrases first (what was just read), then on through the place, and
   * round again; Shift+Tab the other way. Picking out a mark lets go of what the keys had in the place.
   */
  const tab = (by: number) => {
    const marks = scene.lastMarks();
    const things = placeOrder();
    const focus = scene.markFocus;
    const at = focus ? marks.findIndex(m => m.line === focus.line && m.mark === focus.mark) : -1;
    // The bottom line says what Tab picked out, whatever mark the pointer was resting on.
    const pick = (m: { line: number; mark: number } | undefined) => { scene.markFocus = m; if (m) scene.markPointed = undefined; if (m && pointer?.from === "keys") setPointer(undefined); scene.emit(); };
    if (at >= 0) {
      const next = at + by;
      if (next >= 0 && next < marks.length) return pick(marks[next]);
      if (things.length) { pick(undefined); return step(by); }
      return pick(marks[(next + marks.length) % marks.length]);
    }
    const on = pointer?.from === "keys" && "id" in pointer.target ? things.indexOf(pointer.target.id) : -1;
    const edge = on >= 0 && ((by > 0 && on === things.length - 1) || (by < 0 && on === 0));
    if (marks.length && (edge || (on < 0 && (by > 0 || !things.length)))) return pick(by > 0 ? marks[0] : marks[marks.length - 1]);
    if (things.length) step(by);
  };
  /** A spectator's pointer on the lead's character: the prototype's words for it are the lead's own ("You", "your things"), so there's nothing to do with it there. */
  const theLead = (target: SceneTarget) => !!view.watching && "id" in target && !!world?.entities[target.id]?.player;
  const pointing: PlacePointing = {
    lit: scene.sceneMenu?.target ?? pointer?.target,
    picks, canvas, point, hit,
    click: (target, button, x, y) => {
      if (scene.overlay || theLead(target)) return;
      if (button === "right") { openFor(target, { x, y }); return; }
      // A click with the menu open just puts it away; otherwise it does the first thing (talk to someone, look at something).
      if (scene.sceneMenu) { scene.closeSceneMenu(); return; }
      const first = world ? thingActions(world, target, scene.sceneContext()).actions[0] : undefined;
      if (first) act(first);
    },
    miss: () => scene.closeSceneMenu(),
  };

  useKeyboard(key => {
    if (scene.overlay || scene.page !== "scene" || key.defaultPrevented) return;
    // The menu has the keys while it's open; anything else (a letter, a space) puts it away and goes in the box.
    const menu = scene.sceneMenu;
    if (menu) { if (menuKey(menu, key)) key.preventDefault(); return; }
    if (key.name === "pageup" || key.name === "pagedown") {
      scroll.current?.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(3, height - 12));
    } else if (way && !(key.name === "tab" && scene.lastMarks().length) && !(scene.markFocus && (isEnter(key) || key.name === "escape"))) {
      // Over: an Enter of its own goes on (or a click). A line was in the box as it ended? Its Enter only ends it.
      if (seen.current !== view) { seen.current = view; if (typed().trim()) scene.typing = true; }
      const what = wayOnKey(scene, key);
      if (!what) return;
      key.preventDefault();
      if (what === "go") { clear(); scene.goOn(); }
      else if (what === "line") { clear(); scene.status = "The scene was over, so that went unsaid. Enter goes on."; scene.emit(); }
    } else if (key.name === "escape") {
      // Esc lets go of what Tab picked out: a mark first, then what the keys had in the place.
      if (scene.markFocus) { key.preventDefault(); scene.markFocus = undefined; scene.emit(); }
      else if (pointer?.from === "keys") { key.preventDefault(); setPointer(undefined); }
    } else if (key.name === "tab" && (scene.lastMarks().length || placeOrder().length)) {
      // The box has no use for Tab: it goes through the last reply's marks, then what's in the place.
      key.preventDefault();
      tab(key.shift ? -1 : 1);
    } else if (isEnter(key) && !typed() && scene.markFocus) {
      // Enter with nothing in the box, on a mark Tab picked out: what it says.
      key.preventDefault();
      scene.openMark(scene.markFocus.line, scene.markFocus.mark);
    } else if ((key.name === "up" || key.name === "down") && placeOrder().length && !typed()) {
      // With nothing in the box, the arrows go through the place too.
      key.preventDefault();
      step(key.name === "up" ? -1 : 1);
    } else if (isEnter(key) && !typed() && pointer?.from === "keys" && world) {
      // Enter with nothing in the box, on what Tab picked out: its menu. (Not what the mouse merely rests on; nothing for a spectator on the lead.)
      key.preventDefault();
      if (!theLead(pointer.target)) openFor(pointer.target);
    } else if (!typed() && /^[1-9]$/.test(key.sequence ?? "") && toPick[Number(key.sequence) - 1] && typing === undefined) {
      // A number picks one of the suggested lines, while nothing's been typed (it goes in the box, even with the GM still busy).
      key.preventDefault();
      toPick[Number(key.sequence) - 1]!.run();
    }
  });

  /**
   * The menu's keys: ↑↓ or Tab choose, Enter (or the number) does it, → into a choice's own menu, ←
   * back out of it, Esc never mind. Anything else (a letter, a space, Backspace) puts the menu away
   * and goes on to the box, as typed. True when the key was the menu's.
   */
  function menuKey(menu: SceneMenu, key: KeyEvent): boolean {
    const n = menu.actions.length;
    const digit = /^[1-9]$/.test(key.sequence ?? "") ? Number(key.sequence) - 1 : -1;
    if (key.name === "up" || (key.name === "tab" && key.shift)) { menu.index = (menu.index + n - 1) % Math.max(1, n); scene.emit(); }
    else if (key.name === "down" || key.name === "tab") { menu.index = (menu.index + 1) % Math.max(1, n); scene.emit(); }
    else if (isEnter(key)) choose(menu.index);
    else if (digit >= 0 && digit < n) choose(digit);
    else if (key.name === "right") { if (menu.actions[menu.index]?.choices) choose(menu.index); }
    else if (key.name === "left") { if (menu.parent) { scene.sceneMenu = menu.parent; scene.emit(); } }
    else if (key.name === "escape") scene.closeSceneMenu();
    else { scene.closeSceneMenu(); return false; }
    return true;
  }

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
  const open = view.mayType && !scene.gone && !view.cutOff;
  // The game's word on the status line, in place of the spinner: the client's own, that the game has
  // gone from the server, that the box is full, the simulation's last refusal (until the scene moves
  // on), or what the turn is waiting on (the AI service lost, and asked again; the server out of reach,
  // or done with this session).
  const full = draft.length >= MAX_LINE ? `(The box is full: a turn takes ${MAX_LINE.toLocaleString("en-GB")} characters at most.)` : undefined;
  // Once it's over, what the story's way on waits on (the GM lost, and asked again), or why it got stuck.
  const said = scene.status ?? scene.gone ?? full ?? scene.refusal() ?? view.note ?? (way ? scene.story?.note : undefined);
  // The box, while it's shut: the game gone, the connection cut off, the scene over or ending, who has the lead, a failed turn's /retry, or the GM has the floor.
  const shut = scene.gone ? "The game is gone from the server." : view.cutOff ? "Cut off from the game's server." : view.over ? "The scene is over." : view.ending ? "The scene is ending…"
    : view.watching ? `${view.watching} has the lead: you're watching.`
    : view.phase === "failed" ? "The GM lost the thread: /retry carries it on."
    : "The GM has the floor…";
  const status = view.player.status ?? "";
  // How to talk: plain words are speech; asterisks and brackets are deeds. (A narrow panel leaves it to the box's own hint.)
  const talkLines = narrow ? [] : [
    ...wrap("Plain words are what you say:", inner).map(text => ({ text, color: C.faint })),
    { text: "  Who paid you, then?", color: C.player },
    ...wrap("*Asterisks* or (brackets) are what you do:", inner).map(text => ({ text, color: C.faint })),
    { text: "  *looks over my shoulder*", color: C.player },
    { text: "  (I check his pockets)", color: C.player },
  ];
  // The side panel's rows (inside its border, under the conversation's frame's height): the place has
  // what the lead's name, their status, its title and the game's number leave, and How to talk only
  // where the place keeps its fewest rows and the list of who's in it besides.
  const least = narrow ? 6 : 8;
  const panelRows = height - 7 - kept;
  const gameRows = world && narrow ? GAME_ROWS.narrow : GAME_ROWS.wide;
  const fixedRows = (view.watching ? 1 : 0) + 1 + (status ? wrap(status, inner).length : 0) + 2 + gameRows;
  const listed = world ? Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature" || e.kind === "surface") && !e.states.includes("gone")).length : 0;
  const talk = !world || panelRows - fixedRows - (2 + talkLines.length) >= least + listed ? talkLines : [];
  const placeH = Math.max(least, panelRows - fixedRows - (talk.length ? 2 + talk.length : 0));
  const picking = typing === undefined && toPick.length;
  const keys: KeyHint[] = [
    ...(way ? [["Enter", "go on", () => { clear(); scene.goOn(); }] as KeyHint] : picking ? [[`1–${toPick.length}`, "into the box"] as KeyHint] : []),
    ["/help", "", () => { scene.input("/help"); }],
    ...(scene.story ? [["/journal", "", () => { scene.input("/journal"); }] as KeyHint] : []),
    ...(scene.lastMarks().length ? [["Tab", world && side ? "marks, the place" : "marks"] as KeyHint] : world && side ? [["Tab", "the place"] as KeyHint] : []), ["PgUp/PgDn", "scroll"],
    ["/quit", "", () => { scene.input("/quit"); }],
  ];
  // What the pointer's on, and the bottom line about it in place of the keys (as the map's), while no menu's open.
  const menu = scene.overlay ? undefined : scene.sceneMenu;
  const about = world && side && !menu && !scene.overlay ? pointer?.target : undefined;
  const lead = about && theLead(about) ? world?.entities.player : undefined;
  const pointed = lead ? { title: lead.name, detail: "has the lead" } : about && world ? pointedAt(world, about, ctx) : undefined;
  const first = about && world && !lead ? thingActions(world, about, ctx).actions[0] : undefined;
  // What Tab picked out: Enter opens its menu while the box is empty.
  const hint = !first ? undefined : pointer?.from === "keys" ? (draft ? { long: "Esc lets go", short: "Esc: let go" } : { long: "Enter for what you can do  ·  Esc lets go", short: "Enter: more · Esc: let go" })
    : first.id === "talk" ? { long: "click to talk  ·  right-click for more", short: "click: talk · right: more" } : { long: "click to look  ·  right-click for more", short: "click: look · right: more" };
  // A marked phrase picked out (Tab) or pointed at: what it is, on the bottom line.
  const markAt = !menu && !scene.overlay ? scene.markPointed ?? scene.markFocus : undefined;
  const marked = markAt ? lines[markAt.line] : undefined;
  const theMark = markAt ? marked?.marked?.marks[markAt.mark] : undefined;
  const markLine = theMark && marked ? {
    title: `${MARK_LABEL[theMark.kind]}: ${marked.text.slice(theMark.start, theMark.end)}`,
    // On a narrow screen, what to do about it before the start of its note (the popover has it whole).
    detail: narrow ? "" : theMark.note,
    hint: scene.markPointed ? { long: theMark.kind === "why" ? "click to see why" : "click to read it", short: theMark.kind === "why" ? "click: why" : "click: read" } : { long: "Enter to read it  ·  Esc lets go", short: "Enter: read · Esc: let go" },
  } : undefined;
  // The menu stays in the panel (and the three columns of the conversation's edge: its border and scrollbar, never its words), above the box.
  const bounds = { x: width - side - 3, y: 0, w: side + 3, h: height - 4 };
  // The conversation's frame: everything but the status line, what's to pick, the box and the bottom line.
  scene.talkArea = { w: width - side, h: height - 5 - kept };
  // Where the conversation ends on screen: the scroll box's content is the transcript alone.
  scene.talkEnd = () => { const talk = scroll.current?.content.getChildren()[0]; return talk ? talk.screenY + talk.height - 1 : undefined; };
  const title = view.time ? ` ${view.title} · ${view.time} ` : ` ${view.title} `;
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg} onMouseDown={() => scene.closeSceneMenu()}>
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
        {world ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title} flexShrink={0}>{truncate(world.entities[world.root]?.name ?? "The place", inner)}</text>
          <Place place={scene.place} ctx={ctx} width={inner} height={placeH} live={!scene.overlay} watching={!!view.watching} pointing={pointing} least={least} />
        </box> : <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title}>Here</text>
          {view.present.map(p => <text key={p.key} fg={p.color ?? C.text}>{truncate(p.name, inner)}</text>)}
        </box>}
        {/* The game's number: a second terminal watches with it (on one line in a narrow panel with the place). */}
        {gameRows === GAME_ROWS.narrow ? <text fg={C.title} marginTop={1} flexShrink={0}>{truncate(`Game ${view.game} · --join ${view.game}`, inner)}</text>
          : <box flexDirection="column" marginTop={1} flexShrink={0}>
            <text fg={C.title}>{`Game ${view.game}`}</text>
            <text fg={C.faint}>{truncate(`--join ${view.game} to watch`, inner)}</text>
          </box>}
        {talk.length ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title} flexShrink={0}>How to talk</text>
          {talk.map((l, i) => <text key={i} flexShrink={0} fg={l.color}>{truncate(l.text, inner)}</text>)}
        </box> : null}
      </box> : null}
    </box>
    <box height={1} paddingX={1} flexShrink={0}>
      {busy && !said ? <Spinner label={busy} /> : <text fg={said ? C.warn : C.faint}>{said ?? " "}</text>}
    </box>
    {kept && !way ? <Picks picks={toPick} rows={kept} width={width - 2} /> : null}
    {way ? <Continue way={way} width={width} onGo={() => { clear(); scene.goOn(); }} /> : <box height={3} flexShrink={0} border borderColor={open ? C.borderHot : C.border} title=" What do you say? " titleAlignment="left" paddingX={1}>
      {/* Talking is the default: plain words are said out loud; asterisks and brackets are things done. */}
      {/* What's submitted is what the input holds as Enter comes: the letters before it in the same read are in it, and not yet in the draft. */}
      {/* As much as a turn takes (the simulation's limit): OpenTUI's own is 1,000, and it cut a longer line without a word. */}
      <input ref={input} scrollMargin={0.05} maxLength={MAX_LINE} value={draft} onInput={setDraft} onSubmit={(value: unknown) => send(typeof value === "string" ? value : typed())} focused={!scene.overlay}
        placeholder={!open ? shut : width - 4 >= HINT.length ? HINT : HINT_SHORT} />
    </box>}
    <box height={1} paddingX={1} flexShrink={0}>
      {markLine ? <PointerLine title={markLine.title} detail={markLine.detail} width={width - 2} hint={markLine.hint} />
        : pointed ? <PointerLine title={pointed.title} detail={pointed.detail} width={width - 2} hint={hint} />
        : <Keys items={fit(keys, width - 2, width < 100 ? 3 : 5)} gap={width < 100 ? " · " : "  ·  "} />}
    </box>
    {/* A right-click on the menu is one on what's under it (it may cover what was aimed at): never a choice. */}
    {menu ? <MenuBox title={menu.title} items={menu.actions.map(a => a.label)} index={menu.index} x={menu.x} y={menu.y} bounds={bounds}
      onChoose={choose} onHover={i => { menu.index = i; scene.emit(); }}
      onRight={(x, y) => { const under = hit.current?.(x, y); if (under && !theLead(under)) openFor(under, { x, y }); else scene.closeSceneMenu(); }} /> : null}
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
