import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, Keys, Spinner, useGame, wrap } from "./common.tsx";

/** The card between scenes: the story moving on, the next lead, "Roll for initiative!". */
export function BetweenScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    if (game.overlay || game.screen !== "between" || key.defaultPrevented) return;
    if (key.name === "return" || key.name === "space") { key.preventDefault(); game.continueFromCard(); }
  });
  const card = game.card;
  const w = Math.min(width - 6, 100);
  const lines = (card?.lines ?? []).flatMap(l => (l ? wrap(l, w - 4) : [""])).slice(0, Math.max(4, height - 10));
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={card?.title.startsWith("Roll") ? C.danger : C.title} attributes={BOLD}>{card?.title ?? ""}</text>
    <box width={w} marginTop={1} flexDirection="column" border borderColor={C.border} paddingX={1} paddingY={1}>
      {card?.working ? <Spinner label={card.working} /> : lines.map((l, i) => <text key={i} fg={l.startsWith("The lead") ? C.lead : l.startsWith("How things") ? C.title : C.text}>{l || " "}</text>)}
    </box>
    {card?.working ? null : <box marginTop={1}><Keys items={[["Enter", "continue"]]} /></box>}
  </box>;
}
