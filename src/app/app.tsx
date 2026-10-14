import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect } from "react";
import type { Game } from "./game.ts";
import { C } from "./theme.ts";
import { BetweenScreen } from "./ui/between.tsx";
import { CombatScreen } from "./ui/combat.tsx";
import { useGame } from "./ui/common.tsx";
import { CreatedScreen, CreateScreen, CreatingScreen } from "./ui/create.tsx";
import { EndScreen } from "./ui/end.tsx";
import { ExploreScreen } from "./ui/explore.tsx";
import { Overlay } from "./ui/overlay.tsx";
import { SceneScreen } from "./ui/scene.tsx";
import { TitleScreen } from "./ui/title.tsx";

/** The whole game: one screen at a time, with overlays (sheet, help, menu) on top. */
export function App({ game, onQuit }: { game: Game; onQuit: () => void }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    if (key.ctrl && (key.name === "c" || key.name === "d")) { key.preventDefault(); game.quit(); }
  });
  useEffect(() => { if (game.quitting) onQuit(); });
  const screen = (() => {
    switch (game.screen) {
      case "title": return <TitleScreen game={game} />;
      case "create": return <CreateScreen game={game} />;
      case "creating": return <CreatingScreen game={game} />;
      case "created": return <CreatedScreen game={game} />;
      case "explore": return <ExploreScreen game={game} />;
      case "scene": return <SceneScreen game={game} />;
      case "between": return <BetweenScreen game={game} />;
      case "combat": return <CombatScreen game={game} />;
      case "end": return <EndScreen game={game} />;
    }
  })();
  return <box width={width} height={height} backgroundColor={C.bg}>
    {screen}
    <Overlay game={game} />
  </box>;
}
