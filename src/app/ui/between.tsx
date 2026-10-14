import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import type { Card, Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, Keys, SCROLLBAR, Spinner, useGame, wrap } from "./common.tsx";
import { Transcript, transcriptRows } from "./scene.tsx";

/** How long each line of a conversation between scenes waits for the one before, in ms (KM_APP_TALK_MS; 0: all at once). */
const PACE = () => Number(process.env.KM_APP_TALK_MS ?? 700);

/**
 * Between scenes: whoever walks with the player tells what happened and where next (Kell reads the
 * entry back from her notebook), in the scene's own style, a line at a time; or, with nobody there,
 * the card: the story moving on, the next lead.
 */
export function BetweenScreen({ game }: { game: Game }) {
  useGame(game);
  const card = game.card;
  return card?.talk ? <Talk game={game} card={card} lines={card.talk} /> : <Plain game={game} card={card} />;
}

function Talk({ game, card, lines }: { game: Game; card: Card; lines: NonNullable<Card["talk"]> }) {
  const { width, height } = useTerminalDimensions();
  const [said, setSaid] = useState(PACE() > 0 ? 1 : lines.length);
  useEffect(() => {
    if (said >= lines.length) return;
    const timer = setTimeout(() => setSaid(n => n + 1), PACE());
    return () => clearTimeout(timer);
  }, [said, lines.length]);
  const done = said >= lines.length;
  // A press (or a click) hurries the talk along to its end, then goes on.
  const go = () => { if (done) game.continueFromCard(); else setSaid(lines.length); };
  useKeyboard(key => {
    if (game.overlay || game.screen !== "between" || key.defaultPrevented) return;
    if (key.name === "return" || key.name === "space") { key.preventDefault(); go(); }
    else if (key.name === "escape") { key.preventDefault(); game.overlay = { kind: "menu", index: 0 }; game.emit(); }
  });
  const w = Math.min(width - 2, 104);
  const who = lines.find(l => l.kind === "dialogue")?.name ?? "them";
  // Sized for the whole talk from the start, so it doesn't grow as the lines come.
  const rows = Math.max(3, Math.min(transcriptRows(lines, w - 5) + 2, height - 6));
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <box width={w} height={rows} flexDirection="column" flexShrink={0} border borderColor={C.border} title={` ${card.title} `} titleAlignment="left" titleColor={C.title} paddingX={1}>
      <scrollbox flexGrow={1} minHeight={0} scrollX={false} stickyScroll stickyStart="bottom" paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        <Transcript lines={lines.slice(0, said)} />
      </scrollbox>
    </box>
    <Clickable width={w} height={3} flexShrink={0} border borderColor={done ? C.borderHot : C.border} title={` With ${who} `} titleAlignment="left" paddingX={1} onClick={go}>
      <text>
        <span fg={done ? C.lead : C.faint}>{"▶ "}</span>
        <span fg={done ? C.lead : C.dim} attributes={done ? BOLD : 0}>{done ? "Back to the map" : "…"}</span>
        <span fg={C.faint}>{done ? "   Enter, or click (on the map, g walks you to the lead)" : `   ${who} hasn't finished`}</span>
      </text>
    </Clickable>
    <box height={1} marginTop={height > 30 ? 1 : 0} flexShrink={0}><Keys items={[["Enter", done ? "back to the map" : "hurry them along"], ["Esc", "menu"]]} /></box>
  </box>;
}

/** The card: the story moving on, the next lead. */
function Plain({ game, card }: { game: Game; card: Card | undefined }) {
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    if (game.overlay || game.screen !== "between" || key.defaultPrevented) return;
    if (key.name === "return" || key.name === "space") { key.preventDefault(); game.continueFromCard(); }
  });
  const w = Math.min(width - 6, 100);
  const lines = (card?.lines ?? []).flatMap(l => (l ? wrap(l, w - 4) : [""])).slice(0, Math.max(4, height - 10));
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={card?.title.startsWith("Roll") ? C.danger : C.title} attributes={BOLD}>{card?.title ?? ""}</text>
    <Clickable width={w} marginTop={1} flexDirection="column" border borderColor={C.border} paddingX={1} paddingY={1} onClick={() => game.continueFromCard()}>
      {card?.working ? <Spinner label={card.working} /> : lines.map((l, i) => <text key={i} fg={l.startsWith("The lead") ? C.lead : l.startsWith("How things") ? C.title : C.text}>{l || " "}</text>)}
    </Clickable>
    {card?.working ? null : <box marginTop={1}><Keys items={[["Enter", "continue", () => game.continueFromCard()]]} /></box>}
  </box>;
}
