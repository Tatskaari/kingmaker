// Copied from the prototype's src/app/ui/end.tsx at 44c6d4a, whole but for the seams: it reads a SceneModel's epilogue (story/view.ts epilogueOf, from rows) in place of the Game's ending and journal; the zoo's End goes (V19), and so do b (reporting a problem: the prototype's report tool isn't this client's) and q (Ctrl+C quits the client).
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { SceneModel } from "../scene/model.ts";
import { C } from "../theme.ts";
import { BOLD, isEnter, ITALIC, Keys, SCROLLBAR, useStore, wrap } from "./common.tsx";

/** The End: the closing, how each scene went (its notebook lines under it), the GM's bar tab; Enter goes back to the title. */
export function EndScreen({ scene }: { scene: SceneModel }) {
  useStore(scene);
  const { width, height } = useTerminalDimensions();
  const back = () => scene.toTitle();
  useKeyboard(key => {
    if (scene.overlay || scene.page !== "end" || key.defaultPrevented) return;
    if (isEnter(key) || key.name === "escape") { key.preventDefault(); back(); }
  });
  const end = scene.epilogue();
  const w = Math.min(width - 4, 110);
  const big = width >= 70 && height >= 30;
  const chapters = end?.chapters ?? [];
  const notes = (lines: string[]) => lines.flatMap(l => wrap(l, w - 4));
  const tab = wrap(end?.tab ?? "", w);
  // Nothing played yet: say so, under the heading.
  const none = chapters.length ? [] : wrap("Nothing yet.", w);
  const below = 1 + none.length + chapters.reduce((n, c) => n + 1 + notes(c.lines).length, 0) + tab.length;
  const narration = Math.max(5, height - (big ? 8 : 2) - below - 5);
  return <box width={width} height={height} flexDirection="column" alignItems="center" backgroundColor={C.bg} paddingTop={1}>
    {big ? <ascii-font text="THE END" font="block" color={[C.title, "#c98a3a"]} /> : <text fg={C.title} attributes={BOLD}>T H E   E N D</text>}
    <box width={w} height={narration} marginTop={1} border borderColor={C.border} title={` ${end?.who ?? "The investigator"} `} paddingX={1}>
      {/* The scrollbar over a column kept for it (see SCROLLBAR): a long closing doesn't lose a character a line under it. */}
      <scrollbox flexGrow={1} minHeight={0} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        <text fg={C.gm} wrapMode="word">{end?.closing ?? ""}</text>
      </scrollbox>
    </box>
    <box width={w} height={below} flexDirection="column" marginTop={1} flexShrink={0}>
      <text fg={C.title} flexShrink={0}>How it went</text>
      {none.map((l, i) => <text key={`none${i}`} fg={C.dim} flexShrink={0}>{l}</text>)}
      {chapters.flatMap((c, i) => [
        <text key={`c${i}`} flexShrink={0}><span fg={C.dim}>{`${i + 1}. ${c.title}: `}</span><span fg={C.text}>{c.ending}</span></text>,
        ...notes(c.lines).map((l, j) => <text key={`n${i}-${j}`} fg={C.faint} flexShrink={0}>{`   ${l}`}</text>),
      ])}
      {tab.map((l, i) => <text key={`t${i}`} fg={C.faint} attributes={ITALIC} flexShrink={0}>{l}</text>)}
    </box>
    {/* A button too: a click goes back to the title. */}
    <box height={1} marginTop={1} flexShrink={0}><Keys items={[["Enter", "back to the title", back], ["Ctrl+C", "quit"]]} /></box>
  </box>;
}
