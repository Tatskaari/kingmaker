// Cut from the prototype's src/app/ui/overlay.tsx at 44c6d4a (:40-48, :80-83, :103-109, :110-116, :124-127, :163-191, :242-252, :253-262 the help scrolled): the sheet, the mark's popover, the help, and the investigator's notebook (story-design §4.5: from rows, its scrolling keys the prototype's) with the quests beside it (new: the prototype records them and shows none), HELP.scene trimmed to this client's commands and to what it shows (marks, no ⓘ lines, a deed for the example where it had a spell), its suggested lines' paragraph (:45) less a talk's and the Esc menu's words; the sheet is the seat's sheet row (SceneModel.sheet) in place of the session's.
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, type ReactNode } from "react";
import type { SceneModel } from "../scene/model.ts";
import { questLine } from "../story/view.ts";
import { C } from "../theme.ts";
import { BOLD, Keys, SCROLLBAR, useStore, wrap, type KeyHint } from "./common.tsx";
import { MarkPopover } from "./popover.tsx";
import { sheetHeight } from "./sheet-layout.ts";
import { SheetView, type SheetHandle } from "./sheet.tsx";

/**
 * How to play a scene (the prototype's src/app/ui/overlay.tsx HELP.scene, with what this client has).
 * The rules' ⓘ lines come back with the vertical that makes them (V7): until then the rules' only
 * lines are the dice (a change of gear among them). Its example of a deed is one a player can play in
 * the yard; the prototype's spell comes back with V7, which brings spells into a scene.
 */
const HELP = [
  "Type and press Enter. Plain words are what you say, out loud, to whoever's there: Who paid you, then? *Asterisks* or (brackets) are what you do: *looks over my shoulder*, (I check his pockets). Talk and do in the same breath if you like.",
  "The GM narrates and plays everyone else, each person's lines in their colour (gold italics for anyone not here). Underlined words are the GM's marks (on coral, why someone acts as they do; teal, something you'd know; lavender, something you did): click one, or Tab to it and press Enter, for a note from what you know. Rolls happen when the story needs them (🎲 lines).",
  "After each reply, suggested lines come up over the box (a risky try in yellow): a number or a click puts one in the box to send or change; typing hides them. /suggestions off turns them off.",
  "/sheet (or /c) your character sheet · /journal (or /j) your notebook · /quests the quests · /help this · /retry carries on a turn the GM lost · /quit goes back to the title (the game is kept). PgUp/PgDn (or the mouse wheel) scroll the conversation.",
  "When a scene ends, it waits for you: an Enter of its own, or a click, goes on. For testing, as the dev stack's owner: /exits lists the scene's endings, /end <id> takes one now.",
];

const CLOSE = ["escape", "return", "space", "q"];
/** The keys that scroll the notebook and the quests: a row, a page, the whole way (the prototype's SCROLL_KEYS). */
const SCROLL_KEYS: Record<string, number> = { up: -1, down: 1, pageup: -2, pagedown: 2, home: -3, end: 3 };
/** The keys that put the sheet away, when it has no use for them itself (the prototype's, c and s among them). */
const CLOSE_SHEET = ["escape", "return", "space", "c", "s", "q"];

/** What's open over the scene: the character sheet, a mark's popover, or the help. */
export function Overlay({ scene }: { scene: SceneModel }) {
  useStore(scene);
  const { width, height } = useTerminalDimensions();
  const sheet = useRef<SheetHandle>(null);
  const scroll = useRef<ScrollBoxRenderable>(null);
  useKeyboard(key => {
    const o = scene.overlay;
    if (!o || key.defaultPrevented) return;
    if ((o.kind === "journal" || o.kind === "quests" || o.kind === "help") && SCROLL_KEYS[key.name] !== undefined) {
      key.preventDefault();
      const page = Math.max(3, Math.min(height - 2, 40) - 6);
      const by = SCROLL_KEYS[key.name]!;
      scroll.current?.scrollBy(Math.abs(by) === 2 ? Math.sign(by) * page : Math.abs(by) === 3 ? Math.sign(by) * 100000 : by);
      return;
    }
    // The sheet takes its own keys (pages, scrolling, a spell picked or open); these close it.
    if (o.kind === "sheet") {
      if (CLOSE_SHEET.includes(key.name) && !sheet.current?.wants(key)) { key.preventDefault(); scene.closeOverlay(); }
      return;
    }
    key.preventDefault();
    // A marked phrase, open: Tab goes on to the reply's next mark; any other key puts it away.
    if (o.kind === "mark") { if (key.name === "tab") scene.stepMark(key.shift ? -1 : 1); else scene.closeOverlay(); return; }
    // Any of these keys closes the help, the notebook and the quests (j the notebook, as it opens it between scenes).
    if (CLOSE.includes(key.name) || key.sequence === "?" || (key.name === "j" && o.kind === "journal")) scene.closeOverlay();
  });
  const o = scene.overlay;
  if (!o) return null;
  if (o.kind === "mark") return <MarkPopover scene={scene} at={o} width={width} height={height} />;
  if (o.kind === "sheet") {
    // As much of the screen as it can use (all of a small one), and no taller than the sheet.
    const shown = scene.sheet();
    const sw = width <= 100 ? width : Math.min(width - 4, 160);
    const sh = shown ? sheetHeight(shown.data, shown.who, sw - 4, (height <= 30 ? height : Math.min(height - 2, 56)) - 2, { bar: true }) + 2 : Math.min(height, 8);
    const close = () => scene.closeOverlay();
    return <>
      {/* A click outside the sheet puts it away. */}
      <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={close} />
      <box position="absolute" left={Math.floor((width - sw) / 2)} top={Math.floor((height - sh) / 2)} width={sw} height={sh} zIndex={100}
        border borderStyle="double" borderColor={C.borderHot} title=" Character sheet " backgroundColor={C.panel} flexDirection="column" paddingX={1}>
        {!shown
          ? <box flexDirection="column" flexGrow={1}><text fg={C.danger} wrapMode="word" flexGrow={1}>No character yet.</text><Keys items={[["Esc", "close"]]} /></box>
          : <SheetView ref={sheet} data={shown.data} who={shown.who} width={sw - 4} height={sh - 2} active onClose={close} keys={[["Esc", "close", close]]} />}
      </box>
    </>;
  }
  const w = Math.min(width - 4, 104);
  const h = Math.min(height - 2, 40);
  const close = () => scene.closeOverlay();
  // A click anywhere outside it closes it.
  const box = (title: string, children: ReactNode, keys: KeyHint[]) => <>
    <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={(e: MouseEvent) => { if (e.button === 0) close(); }} />
    <box position="absolute" left={Math.floor((width - w) / 2)} top={Math.max(0, Math.floor((height - h) / 2))} width={w} height={h} zIndex={100}
      border borderStyle="double" borderColor={C.borderHot} title={` ${title} `} backgroundColor={C.panel} flexDirection="column" paddingX={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">{children}</box>
      <Keys items={keys} />
    </box>
  </>;
  if (o.kind === "journal") {
    // The notebook (the prototype's): each scene's ending, its lines, how things stood after it.
    const notebook = scene.story?.notebook ?? [];
    return box("The investigator's notebook", <scrollbox ref={scroll} flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
      {notebook.length ? notebook.map((j, i) => <box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
        <text fg={C.title} attributes={BOLD}>{`${j.title}: ${j.ending}`}</text>
        {j.lines.map((l, k) => <text key={k} fg={C.text} wrapMode="word">{`· ${l}`}</text>)}
        {j.stood ? <text fg={C.dim} wrapMode="word">{j.stood}</text> : null}
      </box>) : <text fg={C.dim}>Nothing yet. The notebook is new, and smells of it.</text>}
    </scrollbox>, [["Esc", "close", close], ["↑↓", "scroll"], ["/quests", "the quests", () => { scene.overlay = { kind: "quests" }; scene.emit(); }]]);
  }
  if (o.kind === "quests") {
    // The quests (new): each as it stands, its latest word first, what came before it under it.
    const quests = scene.story?.quests ?? [];
    return box("The quests", <scrollbox ref={scroll} flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
      {quests.length ? quests.map((q, i) => <box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
        <text wrapMode="word"><span fg={q.status === "active" ? C.title : q.status === "failed" ? C.danger : C.good} attributes={BOLD}>{`${q.title} (${q.status})`}</span><span fg={C.text}>{questLine(q).slice(`${q.title} (${q.status})`.length)}</span></text>
        {q.notes.slice(0, -1).reverse().map((n, k) => <text key={k} fg={C.dim} wrapMode="word">{`· ${n}`}</text>)}
      </box>) : <text fg={C.dim}>No quests yet: the story hasn't set you any.</text>}
    </scrollbox>, [["Esc", "close", close], ["↑↓", "scroll"], ["/journal", "the notebook", () => { scene.overlay = { kind: "journal" }; scene.emit(); }]]);
  }
  // A short screen scrolls it (the wheel, ↑↓, PgUp/PgDn), as the notebook does. Wrapped here, at
  // spaces only, under its bullet (OpenTUI's own wrapping breaks before a comma after a bracket).
  const wrapped = HELP.map(l => wrap(l, w - 8).map((t, i) => `${i ? "  " : "· "}${t}`));
  const long = wrapped.reduce((n, l) => n + l.length + 1, 0) > h - 3;
  return box("How to play", <scrollbox ref={scroll} flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
    {wrapped.map((l, i) => <text key={i} fg={C.text} marginBottom={1} flexShrink={0}>{l.join("\n")}</text>)}
  </scrollbox>, [["Esc", "close", close], ...(long ? [["↑↓ PgUp/PgDn", "scroll"] as KeyHint] : [])]);
}
