import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, Keys, useGame } from "./common.tsx";
import { Place } from "./place.tsx";

const HELP: Record<string, string[]> = {
  explore: [
    "Walk with the arrow keys or WASD: they move with the screen (up is up). On the map, north is up-left.",
    "The lead (gold, with a !) is where the story is waiting: walk there and talk to whoever's waiting, or step into the place. g walks you there; any key stops.",
    "e (or Enter) talks to whoever you're facing, looks at things, and goes through doors. Bumping into someone whose scene is waiting opens it too.",
    "The sidebar says where you are, what time it is, who is about (arrows point the way on screen) and which way the lead lies.",
    "c shows your character sheet, j your notebook. Esc opens the menu (save and quit). The game saves as you go.",
  ],
  scene: [
    "Type what you say or do and press Enter. Speech in quotes, actions in plain words.",
    "The GM narrates and plays everyone else; rolls happen when the story needs them (🎲 lines).",
    "#sheet your character sheet · #map a sketch of the scene · #save · #quit (to the title).",
    "PgUp/PgDn scroll the transcript. When the scene ends, the story moves on by itself.",
    "For testing: #exits lists the scene's endings, #end <id> takes one now.",
  ],
  combat: [
    "Arrows move 5 ft a square (diagonals too: they move with the screen). Blue tiles are where you can still get to this turn.",
    "One action a turn: a attack your target, c cast (at your target, or t on yourself), u knock over a lantern or brazier beside you, d dash, g dodge, x disengage. z closes in on your target.",
    "Tab (or 1–9) picks a target: it's bracketed on the map. Melee needs you next to them; bows reach further, at disadvantage past their range.",
    "Mind the grain dust (the brown tiles): fire in it goes up all at once, and takes everyone in it with it.",
    "m lists every option you have, e (or Space) ends your turn, f lets the dice decide it. s shows your sheet.",
    "When it's over, Enter takes the story on: how it ended goes into what happens next.",
  ],
};

const MENU = ["Back to the game", "Save and return to the title", "Save and quit"];

export function Overlay({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const o = game.overlay;
  useKeyboard(key => {
    const o = game.overlay;
    if (!o || key.defaultPrevented) return;
    key.preventDefault();
    if (o.kind === "menu") {
      if (key.name === "up") o.index = (o.index + MENU.length - 1) % MENU.length;
      else if (key.name === "down") o.index = (o.index + 1) % MENU.length;
      else if (key.name === "escape") { game.closeOverlay(); return; }
      else if (key.name === "return") {
        game.closeOverlay();
        if (o.index === 1) { game.quitToTitle(); return; }
        if (o.index === 2) { game.quit(); return; }
        return;
      }
      game.emit();
      return;
    }
    if (o.kind === "spells") {
      if (key.name === "up") o.index = (o.index + o.spells.length - 1) % o.spells.length;
      else if (key.name === "down") o.index = (o.index + 1) % o.spells.length;
      else if (key.name === "escape") { game.closeOverlay(); return; }
      else if (key.name === "return" || key.name === "t") {
        const spell = o.spells[o.index]!;
        game.closeOverlay();
        void game.cast(spell.id, key.name === "t");
        return;
      }
      game.emit();
      return;
    }
    if (o.kind === "actions") {
      const actions = game.fightActions;
      if (key.name === "up") o.index = (o.index + actions.length - 1) % Math.max(1, actions.length);
      else if (key.name === "down") o.index = (o.index + 1) % Math.max(1, actions.length);
      else if (key.name === "escape" || key.name === "m") { game.closeOverlay(); return; }
      else if (key.name === "return") {
        const action = actions[o.index];
        game.closeOverlay();
        if (action) void game.combatAct(action.id);
        return;
      }
      game.emit();
      return;
    }
    // Sheet, help, journal, scene map: any of these keys closes them.
    if (["escape", "return", "space", "c", "s", "q", "j"].includes(key.name) || key.sequence === "?") game.closeOverlay();
  });
  if (!o) return null;
  const w = Math.min(width - 4, 104);
  const h = Math.min(height - 2, 40);
  const box = (title: string, children: ReactNode, keys: Array<[string, string]>) =>
    <box position="absolute" left={Math.floor((width - w) / 2)} top={Math.max(0, Math.floor((height - h) / 2))} width={w} height={h} zIndex={100}
      border borderStyle="double" borderColor={C.borderHot} title={` ${title} `} backgroundColor={C.panel} flexDirection="column" paddingX={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">{children}</box>
      <Keys items={keys} />
    </box>;
  switch (o.kind) {
    case "sheet":
      return box("Character sheet", <scrollbox flexGrow={1} scrollX={false}><text fg={C.text} wrapMode="word">{o.text}</text></scrollbox>, [["Esc", "close"]]);
    case "scene-map": {
      const world = game.session?.world;
      return box(world ? world.entities[world.root]?.name ?? "The scene" : "The scene", world
        ? <Place game={game} width={w - 4} height={h - 4} view="map" />
        : <text fg={C.dim}>This scene has no map of its own yet: it's all in the telling.</text>, [["Esc", "close"]]);
    }
    case "journal": {
      const history = game.session?.history ?? [];
      const stood = (sceneId: string) => history.find(h => h.sceneId === sceneId)?.summary.split("\n").slice(1).join("\n").trim();
      return box("The investigator's notebook", <scrollbox flexGrow={1} scrollX={false}>
        {game.journal.length ? game.journal.map((j, i) => <box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
          <text fg={C.title} attributes={BOLD}>{`${j.title}: ${j.ending}`}</text>
          {j.lines.map((l, k) => <text key={k} fg={C.text} wrapMode="word">{`· ${l}`}</text>)}
          {stood(j.sceneId) ? <text fg={C.dim} wrapMode="word">{stood(j.sceneId)!}</text> : null}
        </box>) : <text fg={C.dim}>Nothing yet. The notebook is new, and smells of it.</text>}
      </scrollbox>, [["Esc", "close"]]);
    }
    case "help": {
      const mode = game.screen === "combat" ? "combat" : game.screen === "scene" ? "scene" : "explore";
      return box("How to play", <box flexDirection="column">{HELP[mode]!.map((l, i) => <text key={i} fg={C.text} wrapMode="word" marginBottom={1}>{`· ${l}`}</text>)}</box>, [["Esc", "close"]]);
    }
    case "menu":
      return box("Menu", <box flexDirection="column" paddingY={1}>{MENU.map((m, i) => <text key={i}>
        <span fg={i === o.index ? C.lead : C.dim}>{i === o.index ? "▶ " : "  "}</span><span fg={i === o.index ? C.title : C.text} {...(i === o.index ? { attributes: BOLD } : {})}>{m}</span>
      </text>)}</box>, [["↑↓", "choose"], ["Enter", "select"], ["Esc", "back"]]);
    case "spells":
      return box("Cast a spell", <box flexDirection="column">{o.spells.map((s, i) => <text key={s.id}>
        <span fg={i === o.index ? C.lead : C.dim}>{i === o.index ? "▶ " : "  "}</span>
        <span fg={i === o.index ? C.title : C.text}>{s.name}</span><span fg={C.faint}>{s.level ? ` (level ${s.level})` : " (cantrip)"}</span>
      </text>)}</box>, [["↑↓", "choose"], ["Enter", "cast at the target"], ["t", "cast on yourself"], ["Esc", "never mind"]]);
    case "actions": {
      const actions = game.fightActions;
      const rows = h - 4;
      const first = Math.max(0, Math.min(o.index - Math.floor(rows / 2), actions.length - rows));
      return box("Your options", <box flexDirection="column">{actions.slice(first, first + rows).map((a, j) => {
        const i = first + j;
        return <text key={a.id}>
          <span fg={i === o.index ? C.lead : C.dim}>{i === o.index ? "▶ " : "  "}</span>
          <span fg={i === o.index ? C.title : C.text}>{truncate(a.label, w - 8)}</span>
        </text>;
      })}</box>, [["↑↓", "choose"], ["Enter", "do it"], ["Esc", "never mind"]]);
    }
  }
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
