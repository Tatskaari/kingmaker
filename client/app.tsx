// Cut from the prototype's src/app/app.tsx at 44c6d4a: the screen switch over an AppModel in place of the Game (the title, character creation's six, the map between scenes, a fight on the map (M6) and the game: its scene, the moment between scenes, the fight's stand-in and The End), with what's open over the scene and the map; Ctrl+C or Ctrl+D leaves; the title, the scene and the map are told where they're drawn (the app's surface: a terminal or a page).
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useSyncExternalStore } from "react";
import type { AppModel, Surface } from "./app/model.ts";
import type { ExploreModel } from "./explore/model.ts";
import type { SceneModel } from "./scene/model.ts";
import { C } from "./theme.ts";
import { BackstoryScreen, ChooseScreen, CreatedScreen, CreateScreen, CreatingScreen, CustomScreen } from "./ui/create.tsx";
import { BetweenScreen, FightScreen } from "./ui/between.tsx";
import { EndScreen } from "./ui/end.tsx";
import { ExploreScreen } from "./ui/explore.tsx";
import { FightPlay } from "./ui/fight.tsx";
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
      case "title": return <TitleScreen game={app.title} surface={app.surface} />;
      case "create": return <CreateScreen game={app.creation} />;
      case "creating": return <CreatingScreen game={app.creation} />;
      case "choose": return <ChooseScreen game={app.creation} />;
      case "custom": return <CustomScreen game={app.creation} />;
      case "backstory": return <BackstoryScreen game={app.creation} />;
      case "created": return <CreatedScreen game={app.creation} />;
      case "scene": return scene ? <ScenePlay scene={scene} surface={app.surface} /> : null;
      case "explore": return app.explore ? <ExplorePlay explore={app.explore} surface={app.surface} /> : null;
      case "fight": return app.fight ? <FightPlay fight={app.fight} surface={app.surface} /> : null;
    }
  })();
  return <box width={width} height={height} backgroundColor={C.bg}>{screen}</box>;
}

/**
 * The game's screen, with what's open over it (the sheet, the help, the notebook, the
 * quests): the scene; once it's over, the moment between scenes, the fight's stand-in, or The End,
 * as the way on goes (SceneModel.page).
 */
export function ScenePlay({ scene, surface = "terminal" }: { scene: SceneModel; surface?: Surface }) {
  const page = usePage(scene);
  return <>
    {page === "between" ? <BetweenScreen scene={scene} /> : page === "fight" ? <FightScreen scene={scene} /> : page === "end" ? <EndScreen scene={scene} /> : <SceneScreen scene={scene} surface={surface} />}
    <Overlay scene={scene} />
  </>;
}

/** The map between scenes, with what's open over it (the sheet, the help, What happens, the menu). */
export function ExplorePlay({ explore, surface = "terminal" }: { explore: ExploreModel; surface?: Surface }) {
  return <>
    <ExploreScreen explore={explore} surface={surface} />
    <ExploreOverlay explore={explore} />
  </>;
}

/** Which of the game's screens is up: redrawn when it changes, not at every row (each screen follows the scene's model itself). */
function usePage(scene: SceneModel): SceneModel["page"] {
  const subscribe = useCallback((listener: () => void) => scene.subscribe(listener), [scene]);
  return useSyncExternalStore(subscribe, () => scene.page);
}

/**
 * Redraw when the screen changes, or the scene does (another game's): not at every row. It's React's
 * useSyncExternalStore over which screen is up (the scene's model, on the scene), which looks again
 * once it has subscribed: a screen changed as the App comes up is drawn, not lost (as useStore).
 */
function useScreen(app: AppModel): void {
  const subscribe = useCallback((listener: () => void) => app.subscribe(listener), [app]);
  useSyncExternalStore(subscribe, () => (app.screen === "scene" ? app.scene ?? app.screen : app.screen === "explore" ? app.explore ?? app.screen : app.screen === "fight" ? app.fight ?? app.screen : app.screen));
}
