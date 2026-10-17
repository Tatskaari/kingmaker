// Cut from the prototype's src/app/ui/overlay.tsx at 44c6d4a (:40-48, :80-83, :103-109, :110-116, :124-127, :163-191, :242-252, :253-262 the help scrolled): the sheet, the mark's popover, the help, and the investigator's notebook (story-design §4.5: from rows, its scrolling keys the prototype's) with the quests beside it (new: the prototype records them and shows none), HELP.scene trimmed to this client's commands and to what it shows (marks, no ⓘ lines, a deed for the example where it had a spell), its suggested lines' paragraph (:45) less a talk's and the Esc menu's words; the sheet is the seat's sheet row (SceneModel.sheet) in place of the session's. The map's (ExploreOverlay, map-design §2): HELP.explore (:28-38) less what's cut from the map (the action menu, aiming, the rules' work, talks with Kell, the notebook, the report), the Esc menu (:84, :297-306) back to the game or the title, What happens (:233-238) and the sheet, over an ExploreModel.
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, type ReactNode, type RefObject } from "react";
import type { ExploreModel } from "../explore/model.ts";
import type { SceneModel, SheetShown } from "../scene/model.ts";
import { questLine } from "../story/view.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, Keys, SCROLLBAR, useStore, wrap, type KeyHint } from "./common.tsx";
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
/** The keys that scroll the notebook, the quests, the help and What happens: a row (±1), a page (±2), the whole way (±3) (the prototype's SCROLL_KEYS). */
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
  if (o.kind === "sheet") return <SheetBox shown={scene.sheet()} sheet={sheet} width={width} height={height} close={() => scene.closeOverlay()} />;
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

/** The character sheet over the screen: the seat's sheet row as the engine made it (none until it's in), and who they are. */
function SheetBox({ shown, sheet, width, height, close }: { shown: SheetShown | undefined; sheet: RefObject<SheetHandle | null>; width: number; height: number; close: () => void }) {
  // As much of the screen as it can use (all of a small one), and no taller than the sheet.
  const sw = width <= 100 ? width : Math.min(width - 4, 160);
  const sh = shown ? sheetHeight(shown.data, shown.who, sw - 4, (height <= 30 ? height : Math.min(height - 2, 56)) - 2, { bar: true }) + 2 : Math.min(height, 8);
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

// -------------------------------------------------------------------------------------------------
// The map's (src/app/ui/overlay.tsx HELP.explore, the menu, What happens and the sheet, over an ExploreModel).

/** How to play on the map (the prototype's HELP.explore, with what this client has of it). */
const EXPLORE_HELP = [
  "Click on the map to walk there (any key or click stops you). Right-click anyone or anything for what you can do with them; the Nearby list works the same.",
  "Walk with the arrow keys or WASD: they move with the screen (up is up). On the map, north is up-left.",
  "The lead (gold, with a !) is where the story is waiting: walk there and talk to whoever's waiting, or step into the place. g walks you there; any key stops.",
  "e (or Enter) talks to whoever you're facing, looks at things, and goes through doors. Bumping into someone whose scene is waiting opens it too.",
  "The sidebar says where you are, what time it is, who is about (arrows point the way on screen) and which way the lead lies.",
  "c shows your character sheet, r What happens in full. Esc opens the menu (back to the title). The keys at the bottom are buttons too. The game is kept as you go.",
];

/** The Esc menu on the map: back to the game, or to the title (the game is kept). */
const EXPLORE_MENU = ["Back to the game", "Back to the title (the game is kept)"];
const CLOSE_MAP = ["escape", "return", "space", "c", "s", "q", "r"];

/** What's open over the map: the help, What happens, the Esc menu, the character sheet. */
export function ExploreOverlay({ explore: game }: { explore: ExploreModel }) {
  useStore(game);
  const { width, height } = useTerminalDimensions();
  const sheet = useRef<SheetHandle>(null);
  const scroll = useRef<ScrollBoxRenderable>(null);
  useKeyboard(key => {
    const o = game.overlay;
    if (!o || key.defaultPrevented) return;
    if (o.kind === "sheet") {
      if (CLOSE_SHEET.includes(key.name) && !sheet.current?.wants(key)) { key.preventDefault(); game.closeOverlay(); }
      return;
    }
    key.preventDefault();
    if ((o.kind === "help" || o.kind === "log") && SCROLL_KEYS[key.name] !== undefined) {
      const page = Math.max(3, Math.min(height - 2, 40) - 6);
      const by = SCROLL_KEYS[key.name]!;
      scroll.current?.scrollBy(Math.abs(by) === 2 ? Math.sign(by) * page : Math.abs(by) === 3 ? Math.sign(by) * 100000 : by);
      return;
    }
    if (o.kind === "menu") {
      const n = EXPLORE_MENU.length;
      if (key.name === "up") o.index = (o.index + n - 1) % n;
      else if (key.name === "down") o.index = (o.index + 1) % n;
      else if (key.name === "escape") { game.closeOverlay(); return; }
      else if (key.name === "return") { pickMenu(game, o.index); return; }
      game.emit();
      return;
    }
    if (CLOSE_MAP.includes(key.name) || key.sequence === "?") game.closeOverlay();
  });
  const o = game.overlay;
  if (!o) return null;
  const close = () => game.closeOverlay();
  if (o.kind === "sheet") return <SheetBox shown={game.sheet()} sheet={sheet} width={width} height={height} close={close} />;
  const w = Math.min(width - 4, 104);
  const h = Math.min(height - 2, 40);
  const box = (title: string, children: ReactNode, keys: KeyHint[], rows?: number) => { const bh = rows ? Math.min(h, Math.max(8, rows)) : h; return <>
    <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={(e: MouseEvent) => { if (e.button === 0) close(); }} />
    <box position="absolute" left={Math.floor((width - w) / 2)} top={Math.max(0, Math.floor((height - bh) / 2))} width={w} height={bh} zIndex={100}
      border borderStyle="double" borderColor={C.borderHot} title={` ${title} `} backgroundColor={C.panel} flexDirection="column" paddingX={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">{children}</box>
      <Keys items={keys} />
    </box>
  </>; };
  switch (o.kind) {
    case "log":
      // What happens, in full: the last things said on the map, the newest at the bottom.
      return box("What happens", <scrollbox ref={scroll} flexGrow={1} scrollX={false} stickyScroll stickyStart="bottom" paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        {game.messages.length ? game.messages.map((m, i, all) => <text key={i} fg={i === all.length - 1 ? C.text : C.dim} wrapMode="word" marginBottom={1} flexShrink={0}>{m}</text>)
          : <text fg={C.dim}>Nothing yet.</text>}
      </scrollbox>, [["↑↓", "scroll"], ["Esc", "close", close]]);
    case "help": {
      // A short screen scrolls it (the wheel, ↑↓, PgUp/PgDn). Wrapped here, at spaces only, under its bullet.
      const wrapped = EXPLORE_HELP.map(l => wrap(l, w - 8).map((t, i) => `${i ? "  " : "· "}${t}`));
      const long = wrapped.reduce((n, l) => n + l.length + 1, 0) > h - 3;
      return box("How to play", <scrollbox ref={scroll} flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        {wrapped.map((l, i) => <text key={i} fg={C.text} marginBottom={1} flexShrink={0}>{l.join("\n")}</text>)}
      </scrollbox>, [["Esc", "close", close], ...(long ? [["↑↓ PgUp/PgDn", "scroll"] as KeyHint] : [])]);
    }
    case "menu":
      return box("Menu", <box flexDirection="column" paddingY={1}>{EXPLORE_MENU.map((m, i) => <Clickable key={i} height={1} onClick={() => pickMenu(game, i)}><text>
        <span fg={i === o.index ? C.lead : C.dim}>{i === o.index ? "▶ " : "  "}</span><span fg={i === o.index ? C.title : C.text} {...(i === o.index ? { attributes: BOLD } : {})}>{m}</span>
      </text></Clickable>)}</box>, [["↑↓", "choose"], ["Enter", "select"], ["Esc", "back", close]], EXPLORE_MENU.length + 6);
  }
}

/** The menu's choices, by key or click: back to the game, or to the title. */
function pickMenu(game: ExploreModel, index: number): void {
  game.closeOverlay();
  if (index === 1) game.quit();
}
