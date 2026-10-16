// Cut from the prototype's src/app/ui/overlay.tsx at 44c6d4a (:40-48, :83, :110-116, :163-172, :190-191): the mark's popover and the help only, HELP.scene trimmed to this client's commands.
import type { MouseEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import type { SceneModel } from "../scene/model.ts";
import { C } from "../theme.ts";
import { Keys, useStore, type KeyHint } from "./common.tsx";
import { MarkPopover } from "./popover.tsx";

/** How to play a scene (the prototype's src/app/ui/overlay.tsx HELP.scene, with what this client has). */
const HELP = [
  "Type and press Enter. Plain words are what you say, out loud, to whoever's there: Who paid you, then? *Asterisks* or (brackets) are what you do: *looks over my shoulder*, (I cast Fireball). Talk and do in the same breath if you like.",
  "The GM narrates and plays everyone else, each person's lines in their colour (gold italics for anyone not here). Underlined words are the GM's marks (on coral, why someone acts as they do; teal, something you'd know; lavender, something you did): click one, or Tab to it and press Enter, for a note from what you know. Rolls happen when the story needs them (🎲 lines); ⓘ lines are things changing: what you carry, what's on fire, what you are now.",
  "/help this · /retry carries on a turn the GM lost · /quit leaves (the game is kept). PgUp/PgDn (or the mouse wheel) scroll the conversation.",
];

const CLOSE = ["escape", "return", "space", "q"];

/** What's open over the scene: a mark's popover, or the help. */
export function Overlay({ scene }: { scene: SceneModel }) {
  useStore(scene);
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    const o = scene.overlay;
    if (!o || key.defaultPrevented) return;
    key.preventDefault();
    // A marked phrase, open: Tab goes on to the reply's next mark; any other key puts it away.
    if (o.kind === "mark") { if (key.name === "tab") scene.stepMark(key.shift ? -1 : 1); else scene.closeOverlay(); return; }
    if (CLOSE.includes(key.name) || key.sequence === "?") scene.closeOverlay();
  });
  const o = scene.overlay;
  if (!o) return null;
  if (o.kind === "mark") return <MarkPopover scene={scene} at={o} width={width} height={height} />;
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
