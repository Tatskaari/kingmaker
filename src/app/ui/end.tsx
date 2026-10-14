import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, ITALIC, Keys, useGame } from "./common.tsx";

export function EndScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    if (game.overlay || game.screen !== "end" || key.defaultPrevented) return;
    if (key.name === "return" || key.name === "escape") { key.preventDefault(); game.toTitle(); }
    else if (key.name === "q") game.quit();
  });
  const end = game.ending;
  const w = Math.min(width - 4, 110);
  return <box width={width} height={height} flexDirection="column" alignItems="center" backgroundColor={C.bg} paddingTop={1}>
    {width >= 70 ? <ascii-font text="THE END" font="block" color={[C.title, "#c98a3a"]} /> : <text fg={C.title} attributes={BOLD}>T H E   E N D</text>}
    <box width={w} flexGrow={1} minHeight={4} marginTop={1} border borderColor={C.border} title={` ${game.session?.player.name ?? "The investigator"} `} paddingX={1}>
      <scrollbox flexGrow={1} scrollX={false}>
        <text fg={C.gm} wrapMode="word">{end?.closing ?? ""}</text>
      </scrollbox>
    </box>
    <box width={w} flexDirection="column" marginTop={1}>
      <text fg={C.title}>How it went</text>
      {(end?.chapters ?? []).map((c, i) => <text key={i}><span fg={C.dim}>{`${i + 1}. ${c.title}: `}</span><span fg={C.text}>{c.ending}</span></text>)}
      <text fg={C.faint} attributes={ITALIC} marginTop={1}>{`The GM's bar tab this sitting: $${(end?.spentUsd ?? 0).toFixed(2)}. The King has graciously declined to pay it.`}</text>
    </box>
    <box marginTop={1} marginBottom={1}><Keys items={[["Enter", "back to the title"], ["q", "quit"]]} /></box>
  </box>;
}
