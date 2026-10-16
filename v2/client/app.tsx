// Cut from the prototype's src/app/app.tsx at 44c6d4a: the screen switch over an AppModel in place of the Game (the title, character creation's six, the map between scenes and the scene; the fight and the End come with their verticals), with what's open over the scene and the map; Ctrl+C or Ctrl+D leaves.
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useSyncExternalStore } from "react";
import type { AppModel } from "./app/model.ts";
import type { ExploreModel } from "./explore/model.ts";
import type { SceneModel } from "./scene/model.ts";
import { C } from "./theme.ts";
import { BackstoryScreen, ChooseScreen, CreatedScreen, CreateScreen, CreatingScreen, CustomScreen } from "./ui/create.tsx";
import { ExploreScreen } from "./ui/explore.tsx";
import { ExploreOverlay, Overlay } from "./ui/overlay.tsx";
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
      case "explore": return app.explore ? <ExplorePlay explore={app.explore} /> : null;
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

/** The map between scenes, with what's open over it (the sheet, the help, What happens, the menu). */
export function ExplorePlay({ explore }: { explore: ExploreModel }) {
  return <>
    <ExploreScreen explore={explore} />
    <ExploreOverlay explore={explore} />
  </>;
}

/**
 * Redraw when the screen changes, or the scene does (another game's): not at every row. It's React's
 * useSyncExternalStore over which screen is up (the scene's model, on the scene), which looks again
 * once it has subscribed: a screen changed as the App comes up is drawn, not lost (as useStore).
 */
function useScreen(app: AppModel): void {
  const subscribe = useCallback((listener: () => void) => app.subscribe(listener), [app]);
  useSyncExternalStore(subscribe, () => (app.screen === "scene" ? app.scene ?? app.screen : app.screen === "explore" ? app.explore ?? app.screen : app.screen));
}
