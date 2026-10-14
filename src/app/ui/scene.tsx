import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, useState } from "react";
import { presentCast } from "../../runtime/brief.ts";
import { sceneById } from "../../../scenes/index.ts";
import type { Game, Line } from "../game.ts";
import { TIME_WORDS } from "../story.ts";
import { C, personColor } from "../theme.ts";
import { BOLD, ITALIC, Keys, Spinner, useGame, wrap } from "./common.tsx";
import { Place } from "./place.tsx";

function Entry({ line, live }: { line: Line; live?: boolean }) {
  const cursor = live ? <span fg={C.title}>▍</span> : null;
  switch (line.kind) {
    case "header":
      return <box flexDirection="column" marginBottom={1} flexShrink={0}>
        <text fg={C.title} attributes={BOLD}>{`— ${line.name} —`}</text>
        <text fg={C.dim} attributes={ITALIC} wrapMode="word">{line.text}</text>
      </box>;
    case "player":
      return <text marginBottom={1} wrapMode="word" flexShrink={0}><span fg={C.player} attributes={BOLD}>{`${line.name ?? "You"}: `}</span><span fg={C.player}>{line.text}</span></text>;
    case "dialogue":
      return <text marginBottom={1} wrapMode="word" flexShrink={0}><span fg={personColor(line.speaker) ?? C.name} attributes={BOLD}>{`${line.name ?? line.speaker}: `}</span><span fg={C.gm}>{line.text}</span>{cursor}</text>;
    case "roll":
      return <text wrapMode="word" flexShrink={0} fg={C.dice}>{`🎲 ${line.text}`}</text>;
    case "system":
      return <text marginBottom={1} wrapMode="word" flexShrink={0} fg={C.system}>{`— ${line.text} —`}</text>;
    case "error":
      return <text marginBottom={1} wrapMode="word" flexShrink={0} fg={C.danger}>{line.text}</text>;
    default:
      return <text marginBottom={1} wrapMode="word" flexShrink={0}><span fg={C.gm}>{line.text}</span>{cursor}</text>;
  }
}

export function SceneScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const [draft, setDraft] = useState("");
  const scroll = useRef<ScrollBoxRenderable>(null);
  useKeyboard(key => {
    if (game.overlay || game.screen !== "scene" || key.defaultPrevented) return;
    if (key.name === "pageup" || key.name === "pagedown") {
      scroll.current?.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(3, height - 12));
    } else if (key.name === "escape") { key.preventDefault(); game.overlay = { kind: "menu", index: 0 }; game.emit(); }
  });
  const session = game.session;
  if (!session) return null;
  const scene = sceneById(session.sceneId);
  // The place needs room to be drawn: a wide panel beside the transcript on a wide terminal.
  const side = width >= 100 ? Math.min(62, Math.floor(width * 0.42)) : 0;
  const here = presentCast(scene, session);
  const send = (value: string) => {
    if (game.busy || !value.trim()) return;
    setDraft("");
    void game.input(value);
  };
  const busy = game.busy;
  // Before the reply starts, show what the GM is doing; once text streams, the cursor says it.
  return <box width={width} height={height} flexDirection="column" backgroundColor={C.bg}>
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box flexGrow={1} border borderColor={C.border} title={` ${scene.title} · ${TIME_WORDS[game.story.time].split(",")[0]} `} titleAlignment="left" flexDirection="column" paddingX={1}>
        <scrollbox ref={scroll} flexGrow={1} minHeight={0} scrollX={false} stickyScroll stickyStart="bottom" viewportCulling={false}>
          {game.lines.map((line, i) => <Entry key={i} line={line} />)}
          {game.live ? <Entry line={game.live} live /> : null}
        </scrollbox>
      </box>
      {side ? <box width={side} border borderColor={C.border} title=" At the scene " flexDirection="column" paddingX={1} overflow="hidden">
        <text fg={C.player} attributes={BOLD}>{session.player.name}</text>
        <text fg={C.dim}>{wrap(session.rules?.status ?? "", side - 4).join("\n")}</text>
        {session.world ? <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title}>{truncate(session.world.entities[session.world.root]?.name ?? "The place", side - 4)}</text>
          <Place game={game} width={side - 4} height={Math.max(10, height - 16)} />
        </box> : <box flexDirection="column" marginTop={1} flexShrink={0}>
          <text fg={C.title}>Here</text>
          {here.map(c => <text key={c.id} fg={personColor(c.id) ?? C.text}>{truncate(c.name, side - 4)}</text>)}
        </box>}
        <text fg={C.title} marginTop={1}>Commands</text>
        <text fg={C.dim}>{"#sheet #map #journal #help #save #quit"}</text>
        <text fg={C.faint} wrapMode="word">Speech in quotes, actions in plain words: "Who paid you?" I look at the girl's fist.</text>
      </box> : null}
    </box>
    <box height={1} paddingX={1}>
      {busy ? <Spinner label={busy} /> : <text fg={game.status ? C.warn : C.faint}>{game.status ?? " "}</text>}
    </box>
    <box height={3} border borderColor={busy ? C.border : C.borderHot} title=" What do you do? " titleAlignment="left">
      <input value={draft} onInput={setDraft} onSubmit={() => send(draft)} focused={!game.overlay && game.screen === "scene"} placeholder={busy ? "The GM has the floor…" : "Say something or do something, then Enter"} />
    </box>
    <box height={1} paddingX={1}>
      <Keys items={[["Enter", "say or do it"], ["PgUp/PgDn", "scroll"], ["#sheet #map #help", "commands"], ["Esc", "menu"], ["Ctrl+C", "save & quit"]]} />
    </box>
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
