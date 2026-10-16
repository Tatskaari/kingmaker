// Cut from the prototype's src/app/ui/overlay.tsx at 44c6d4a (:40-48, :83, :110-116, :124-127, :163-191): the sheet, the mark's popover and the help only, HELP.scene trimmed to this client's commands and to what it shows (no marks, no ⓘ lines, a deed for the example where it had a spell); the sheet is the seat's sheet row (SceneModel.sheet) in place of the session's.
import type { MouseEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, type ReactNode } from "react";
import type { SceneModel } from "../scene/model.ts";
import { C } from "../theme.ts";
import { Keys, useStore, type KeyHint } from "./common.tsx";
import { MarkPopover } from "./popover.tsx";
import { sheetHeight } from "./sheet-layout.ts";
import { SheetView, type SheetHandle } from "./sheet.tsx";

/**
 * How to play a scene (the prototype's src/app/ui/overlay.tsx HELP.scene, with what this client has).
 * The GM's marks and the rules' ⓘ lines come back with the verticals that make them (V5, V7): the
 * replies have no marks yet, and the rules' only lines are the dice (a change of gear among them).
 * Its example of a deed is one the yard can play; the prototype's spell comes back with V7, which
 * brings spells into a scene.
 */
const HELP = [
  "Type and press Enter. Plain words are what you say, out loud, to whoever's there: Who paid you, then? *Asterisks* or (brackets) are what you do: *looks over my shoulder*, (I check his pockets). Talk and do in the same breath if you like.",
  "The GM narrates and plays everyone else, each person's lines in their colour (gold italics for anyone not here). Rolls happen when the story needs them (🎲 lines).",
  "/sheet (or /c) your character sheet · /help this · /retry carries on a turn the GM lost · /quit goes back to the title (the game is kept). PgUp/PgDn (or the mouse wheel) scroll the conversation.",
];

const CLOSE = ["escape", "return", "space", "q"];
/** The keys that put the sheet away, when it has no use for them itself (the prototype's, c and s among them). */
const CLOSE_SHEET = ["escape", "return", "space", "c", "s", "q"];

/** What's open over the scene: the character sheet, a mark's popover, or the help. */
export function Overlay({ scene }: { scene: SceneModel }) {
  useStore(scene);
  const { width, height } = useTerminalDimensions();
  const sheet = useRef<SheetHandle>(null);
  useKeyboard(key => {
    const o = scene.overlay;
    if (!o || key.defaultPrevented) return;
    // The sheet takes its own keys (pages, scrolling, a spell picked or open); these close it.
    if (o.kind === "sheet") {
      if (CLOSE_SHEET.includes(key.name) && !sheet.current?.wants(key)) { key.preventDefault(); scene.closeOverlay(); }
      return;
    }
    key.preventDefault();
    // A marked phrase, open: Tab goes on to the reply's next mark; any other key puts it away.
    if (o.kind === "mark") { if (key.name === "tab") scene.stepMark(key.shift ? -1 : 1); else scene.closeOverlay(); return; }
    if (CLOSE.includes(key.name) || key.sequence === "?") scene.closeOverlay();
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
  return box("How to play", <box flexDirection="column">{HELP.map((p, i) => <text key={i} fg={C.text} wrapMode="word" marginBottom={1}>{p}</text>)}</box>, [["Esc", "close", close]]);
}
