import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, ITALIC, Keys, SCROLLBAR, useGame, wrap } from "./common.tsx";

export function EndScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  // The zoo's End (its curtain cord) is a look at one: the visit carries on, so Enter goes back to it.
  const zoo = game.isZoo && game.core?.state.mode !== "end";
  const back = () => (zoo ? game.backFromEnd() : game.toTitle());
  useKeyboard(key => {
    if (game.overlay || game.screen !== "end" || key.defaultPrevented) return;
    if (key.name === "return" || key.name === "escape") { key.preventDefault(); back(); }
    else if (key.name === "q") game.quit();
  });
  const end = game.ending;
  const w = Math.min(width - 4, 110);
  const big = width >= 70 && height >= 30;
  const chapters = end?.chapters ?? [];
  const notes = (sceneId: string) => (game.journal.find(j => j.sceneId === sceneId)?.lines ?? []).flatMap(l => wrap(l, w - 4));
  const tab = wrap(`The GM's bar tab this sitting: $${(end?.spentUsd ?? 0).toFixed(2)}. The King has graciously declined to pay it.`, w);
  const below = 1 + chapters.reduce((n, c) => n + 1 + notes(c.sceneId).length, 0) + tab.length;
  const narration = Math.max(5, height - (big ? 8 : 2) - below - 5);
  return <box width={width} height={height} flexDirection="column" alignItems="center" backgroundColor={C.bg} paddingTop={1}>
    {big ? <ascii-font text="THE END" font="block" color={[C.title, "#c98a3a"]} /> : <text fg={C.title} attributes={BOLD}>T H E   E N D</text>}
    <box width={w} height={narration} marginTop={1} border borderColor={C.border} title={` ${game.session?.player.name ?? "The investigator"} `} paddingX={1}>
      {/* The scrollbar over a column kept for it (see SCROLLBAR): a long closing doesn't lose a character a line under it. */}
      <scrollbox flexGrow={1} minHeight={0} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        <text fg={C.gm} wrapMode="word">{end?.closing ?? ""}</text>
      </scrollbox>
    </box>
    <box width={w} height={below} flexDirection="column" marginTop={1} flexShrink={0}>
      <text fg={C.title} flexShrink={0}>How it went</text>
      {chapters.flatMap((c, i) => [
        <text key={`c${i}`} flexShrink={0}><span fg={C.dim}>{`${i + 1}. ${c.title}: `}</span><span fg={C.text}>{c.ending}</span></text>,
        ...notes(c.sceneId).map((l, j) => <text key={`n${i}-${j}`} fg={C.faint} flexShrink={0}>{`   ${l}`}</text>),
      ])}
      {tab.map((l, i) => <text key={`t${i}`} fg={C.faint} attributes={ITALIC} flexShrink={0}>{l}</text>)}
    </box>
    {/* Buttons too: a click goes back to the title, or quits. */}
    <box height={1} marginTop={1} flexShrink={0}><Keys items={[["Enter", zoo ? "back to the zoo" : "back to the title", back], ["q", "quit", () => game.quit()]]} /></box>
  </box>;
}
