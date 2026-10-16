// Cut from the prototype's src/app/app.tsx at 44c6d4a: the screen switch over an AppModel in place of the Game (the title, character creation's six and the scene; the map, the fight and the End come with their verticals), with what's open over the scene; Ctrl+C or Ctrl+D leaves.
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import type { AppModel } from "./app/model.ts";
import type { SceneModel } from "./scene/model.ts";
import { C } from "./theme.ts";
import { BackstoryScreen, ChooseScreen, CreatedScreen, CreateScreen, CreatingScreen, CustomScreen } from "./ui/create.tsx";
import { Overlay } from "./ui/overlay.tsx";
import { SceneScreen } from "./ui/scene.tsx";
import { TitleScreen } from "./ui/title.tsx";

/**
 * The client: one screen at a time (app/model.ts screenOf names it), with what's open over the
 * scene. It redraws only when the screen changes: each screen follows its own model, so the reply
 * streaming in redraws the scene, not the App.
 */
export function App({ app }: { app: AppModel }) {
  useScreen(app);
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    if (key.ctrl && (key.name === "c" || key.name === "d")) { key.preventDefault(); app.quit(); }
  });
  const scene = app.scene;
  const screen = (() => {
    switch (app.screen) {
      case "title": return <TitleScreen game={app.title} />;
      case "create": return <CreateScreen game={app.creation} />;
      case "creating": return <CreatingScreen game={app.creation} />;
      case "choose": return <ChooseScreen game={app.creation} />;
      case "custom": return <CustomScreen game={app.creation} />;
      case "backstory": return <BackstoryScreen game={app.creation} />;
      case "created": return <CreatedScreen game={app.creation} />;
      case "scene": return scene ? <ScenePlay scene={scene} /> : null;
    }
  })();
  return <box width={width} height={height} backgroundColor={C.bg}>{screen}</box>;
}

/** A scene, with what's open over it (the sheet, a mark, the help). */
export function ScenePlay({ scene }: { scene: SceneModel }) {
  return <>
    <SceneScreen scene={scene} />
    <Overlay scene={scene} />
  </>;
}

/** Redraw when the screen changes, or the scene does (another game's): not at every row. */
function useScreen(app: AppModel): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    let shown = [app.screen, app.scene] as const;
    return app.subscribe(() => {
      if (app.screen === shown[0] && app.scene === shown[1]) return;
      shown = [app.screen, app.scene];
      setTick(t => t + 1);
    });
  }, [app]);
}
