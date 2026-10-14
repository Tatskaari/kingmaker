import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { sceneById } from "../../../scenes/index.ts";
import type { Game } from "../game.ts";
import type { Resumable } from "../save.ts";
import { timeOf, TIME_WORDS } from "../story.ts";
import { C } from "../theme.ts";
import { BOLD, ITALIC, Keys, Spinner, useGame } from "./common.tsx";

const TAGLINES = [
  "Being an account of a murder, a great deal of grain, and the eve of the Centennial Assembly.",
  "No clerks were harmed in the making of this game. Well. One.",
  "The King remembers how everyone takes their tea. He would like to remember who did this.",
];

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function describe(r: Resumable): string {
  const scene = (() => { try { return sceneById(r.session.sceneId).title; } catch { return r.session.sceneId; } })();
  const where = r.save.mode === "scene" ? `in ${scene}` : r.save.mode === "combat" ? `fighting at ${scene}` : `heading for ${scene}`;
  return `${r.session.player.name}: ${TIME_WORDS[timeOf(r.session.sceneId)].split(",")[0]}, ${where} (${ago(r.mtime)})`;
}

export function TitleScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState<string | undefined>();
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]!);
  useEffect(() => { game.loadSaves(); }, [game]);
  const items: Array<{ label: string; detail?: string; run: () => void }> = [
    ...game.saves.slice(0, 3).map((r, i) => ({
      label: i === 0 ? "Continue" : "Continue an older game",
      detail: describe(r),
      run: () => { setLoading(`Finding your place in the story…`); void game.resume(r).finally(() => setLoading(undefined)); },
    })),
    { label: "New game", detail: "make a character and take the case", run: () => game.newCharacter() },
    { label: "Quit", detail: "the clerk will keep", run: () => game.quit() },
  ];
  useKeyboard(key => {
    if (game.overlay || loading || key.defaultPrevented || game.screen !== "title") return;
    key.preventDefault();
    if (key.name === "up" || key.name === "k" || key.name === "w") setIndex(i => (i + items.length - 1) % items.length);
    else if (key.name === "down" || key.name === "j" || key.name === "s") setIndex(i => (i + 1) % items.length);
    else if (key.name === "return" || key.name === "space") items[Math.min(index, items.length - 1)]!.run();
    else if (key.name === "n") game.newCharacter();
    else if (key.name === "q" || key.name === "escape") game.quit();
  });
  const wide = width >= 84;
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    {wide ? <ascii-font text="KINGMAKER" font="block" color={[C.title, "#c98a3a"]} /> : <text fg={C.title} attributes={BOLD}>K I N G M A K E R</text>}
    <text fg={C.text} attributes={BOLD} marginTop={1}>The Hanged Clerk of Caerwyn</text>
    <text fg={C.dim} attributes={ITALIC}>{tagline}</text>
    <box flexDirection="column" marginTop={2} width={Math.min(width - 4, 90)} border borderColor={C.border} paddingX={2} paddingY={1}>
      {items.map((item, i) => {
        const on = i === Math.min(index, items.length - 1);
        return <text key={i}>
          <span fg={on ? C.lead : C.dim}>{on ? "▶ " : "  "}</span>
          <span fg={on ? C.title : C.text} {...(on ? { attributes: BOLD } : {})}>{item.label}</span>
          {item.detail ? <span fg={C.dim}>{`   ${item.detail}`}</span> : null}
        </text>;
      })}
    </box>
    <box marginTop={1} height={1}>{loading ? <Spinner label={loading} /> : <Keys items={[["↑↓", "choose"], ["Enter", "select"], ["n", "new game"], ["q", "quit"]]} />}</box>
    {game.error ? <text fg={C.danger} marginTop={1}>{game.error}</text> : null}
  </box>;
}
