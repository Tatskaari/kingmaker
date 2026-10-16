// Cut from the prototype's src/app/app.tsx at 44c6d4a: one screen, the scene, with what's open over it; Ctrl+C or Ctrl+D leaves.
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { SceneModel } from "./scene/model.ts";
import { C } from "./theme.ts";
import { useStore } from "./ui/common.tsx";
import { Overlay } from "./ui/overlay.tsx";
import { SceneScreen } from "./ui/scene.tsx";

/** The client: the scene, with what's open over it (the prototype's src/app/app.tsx, with one screen so far). Ctrl+C leaves. */
export function App({ scene, onQuit }: { scene: SceneModel; onQuit: () => void }) {
  useStore(scene);
  const { width, height } = useTerminalDimensions();
  useKeyboard(key => {
    if (key.ctrl && (key.name === "c" || key.name === "d")) { key.preventDefault(); onQuit(); }
  });
  return <box width={width} height={height} backgroundColor={C.bg}>
    <SceneScreen scene={scene} />
    <Overlay scene={scene} />
  </box>;
}
