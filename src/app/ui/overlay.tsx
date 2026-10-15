import type { MouseEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, Keys, SCROLLBAR, useGame, type KeyHint } from "./common.tsx";
import { ActionMenu, fightGroups, menuKey, menuLayout } from "./actions.tsx";
import { Place } from "./place.tsx";
import { sheetHeight } from "./sheet-layout.ts";
import { SheetView } from "./sheet.tsx";

const HELP: Record<string, string[]> = {
  explore: [
    "Click on the map to walk there (any key or click stops you). Right-click anyone or anything for what you can do with them; the Nearby list works the same.",
    "Walk with the arrow keys or WASD: they move with the screen (up is up). On the map, north is up-left.",
    "The lead (gold, with a !) is where the story is waiting: walk there and talk to whoever's waiting, or step into the place. g walks you there; any key stops.",
    "e (or Enter) talks to whoever you're facing, looks at things, and goes through doors. Bumping into someone whose scene is waiting opens it too.",
    "The sidebar says where you are, what time it is, who is about (arrows point the way on screen) and which way the lead lies.",
    "Once Kell walks with you, e beside her (or a right-click on her) stops for a word between scenes. The story waits; walk on, or say goodbye, when you're done.",
    "m (or its button) lists what you can do, by kind: cantrips, spells by level with your slots, class features with their uses, actions (attack, leap, hide, throw, shove, grab, rest). What can't be done now is dimmed, with why. Click one, or ↑↓ and Enter, or its number; ←→ jump a kind. Right-click someone, then Do something…, for the same list aimed at them.",
    "Aiming: point and click; or Tab through what's in reach, the arrows to move the aim, t for yourself, Enter. The faint ring is how far it reaches; an area shows what it covers and who it catches (mind yourself). Esc, or a right-click, thinks better of it.",
    "It's the rules': a Fireball breaks a door down, and it stays down. Hurt someone and the town reacts: people run, the guards come on, and it's a fight on the map. What you do to someone whose scene is waiting opens it, your act first; to Kell, a talk.",
    "c shows your character sheet, j your notebook. Esc opens the menu (save and quit). The keys at the bottom are buttons too. The game saves as you go.",
  ],
  scene: [
    "Type and press Enter. Plain words are what you say, out loud, to whoever's there: Who paid you, then?",
    "*Asterisks* or (brackets) are what you do: *looks over my shoulder*, (I cast Fireball). Talk and do in the same breath if you like.",
    "The GM narrates and plays everyone else. Rolls happen when the story needs them (🎲 lines); ⓘ lines are things changing: what you carry, what's on fire, what you are now.",
    "When there are things you might say (in a word with Kell: her suggestions, a goodbye, walking on), they're listed over the box: click one, or press its number.",
    "/sheet your character sheet · /map the scene's place · /journal your notebook · /help this (those four any time, even with the GM mid-sentence) · /save · /quit (saves, then the title). The old #sheet still works, for traditionalists. Click them at the bottom of the screen, too.",
    "PgUp/PgDn (or the mouse wheel) scroll the conversation. When a scene ends, it waits for you: an Enter of its own, or a click, goes on. Whatever you were typing as it ended goes unsaid.",
    "For testing: /exits lists the scene's endings, /end <id> takes one now.",
  ],
  combat: [
    "By mouse: click a blue tile to move there; click someone on the other side to aim at them, and click them again to attack. The options on the right, and the keys at the bottom, are buttons.",
    "Arrows move 5 ft a square (diagonals too: they move with the screen). Blue tiles are where you can still get to this turn.",
    "One action a turn: a attack your target, c cast (at your target, or t on yourself), u knock over a lantern or brazier beside you, d dash, g dodge, x disengage. z closes in on your target.",
    "Tab (or 1–9) picks a target: it's bracketed on the map. Melee needs you next to them; bows reach further, at disadvantage past their range.",
    "Mind the grain dust (the brown tiles): fire in it goes up all at once, and takes everyone in it with it.",
    "m lists every option you have, by kind (attacks, cantrips, spells by level with your slots, things to knock over, moving, the rest), as the map's m does; e (or Space) ends your turn, f lets the dice decide it. s shows your sheet.",
    "When it's over, Enter (or a click) takes the story on: how it ended goes into what happens next.",
  ],
};

const MENU = ["Back to the game", "Save and return to the title", "Save and quit"];
const CLOSE = ["escape", "return", "space", "c", "s", "q"];

export function Overlay({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const o = game.overlay;
  useKeyboard(key => {
    const o = game.overlay;
    if (!o || key.defaultPrevented) return;
    // The sheet takes its own keys (pages, scrolling); these close it.
    if (o.kind === "sheet") {
      if (CLOSE.includes(key.name)) { key.preventDefault(); game.closeOverlay(); }
      return;
    }
    key.preventDefault();
    if (o.kind === "menu") {
      if (key.name === "up") o.index = (o.index + MENU.length - 1) % MENU.length;
      else if (key.name === "down") o.index = (o.index + 1) % MENU.length;
      else if (key.name === "escape") { game.closeOverlay(); return; }
      else if (key.name === "return") { pickMenu(game, o.index); return; }
      game.emit();
      return;
    }
    if (o.kind === "spells") {
      if (key.name === "up") o.index = (o.index + o.spells.length - 1) % o.spells.length;
      else if (key.name === "down") o.index = (o.index + 1) % o.spells.length;
      else if (key.name === "escape") { game.closeOverlay(); return; }
      else if (key.name === "return" || key.name === "t") { pickSpell(game, o.spells[o.index]!.id, key.name === "t"); return; }
      game.emit();
      return;
    }
    if (o.kind === "actions") {
      // The fight's options, by kind: the action menu's own keys.
      const { groups, ids } = fightMenu(game);
      const r = menuKey(key, groups, o.index, menuLayout(groups, o.index, width, height, undefined, o.top));
      if (r.close) game.closeOverlay();
      else if (r.choose !== undefined) pickAction(game, ids[r.choose]);
      else if (r.index !== undefined) { o.index = r.index; game.emit(); }
      return;
    }
    // Help, journal, scene map: any of these keys closes them.
    if (CLOSE.includes(key.name) || key.name === "j" || key.sequence === "?") game.closeOverlay();
  });
  if (!o) return null;
  const w = Math.min(width - 4, 104);
  const h = Math.min(height - 2, 40);
  const close = () => game.closeOverlay();
  // A click anywhere outside it closes it (the menu too: back to the game).
  const box = (title: string, children: ReactNode, keys: KeyHint[]) => <>
    <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={(e: MouseEvent) => { if (e.button === 0) close(); }} />
    <box position="absolute" left={Math.floor((width - w) / 2)} top={Math.max(0, Math.floor((height - h) / 2))} width={w} height={h} zIndex={100}
      border borderStyle="double" borderColor={C.borderHot} title={` ${title} `} backgroundColor={C.panel} flexDirection="column" paddingX={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">{children}</box>
      <Keys items={keys} />
    </box>
  </>;
  switch (o.kind) {
    case "sheet": {
      // As much of the screen as it can use (all of a small one), and no taller than the sheet.
      const sw = width <= 100 ? width : Math.min(width - 4, 160);
      const sh = game.session && !o.error ? sheetHeight(o.sheet, game.session.player, sw - 4, (height <= 30 ? height : Math.min(height - 2, 56)) - 2, { bar: true }) + 2 : Math.min(height, 8);
      const close = () => game.closeOverlay();
      return <>
        {/* A click outside the sheet puts it away. */}
        <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={close} />
        <box position="absolute" left={Math.floor((width - sw) / 2)} top={Math.floor((height - sh) / 2)} width={sw} height={sh} zIndex={100}
          border borderStyle="double" borderColor={C.borderHot} title=" Character sheet " backgroundColor={C.panel} flexDirection="column" paddingX={1}>
          {o.error || !game.session
            ? <box flexDirection="column" flexGrow={1}><text fg={C.danger} wrapMode="word" flexGrow={1}>{o.error ?? "No character yet."}</text><Keys items={[["Esc", "close"]]} /></box>
            : <SheetView data={o.sheet} who={game.session.player} width={sw - 4} height={sh - 2} active onClose={close} keys={[["Esc", "close", close]]} />}
        </box>
      </>;
    }
    case "scene-map": {
      const world = game.shownWorld;
      return box(world ? world.entities[world.root]?.name ?? "The scene" : "The scene", world
        ? <Place game={game} width={w - 4} height={h - 4} view="map" />
        : <text fg={C.dim}>This scene has no map of its own yet: it's all in the telling.</text>, [["Esc", "close", close]]);
    }
    case "journal": {
      const history = game.session?.history ?? [];
      const stood = (sceneId: string) => history.find(h => h.sceneId === sceneId)?.summary.split("\n").slice(1).join("\n").trim();
      return box("The investigator's notebook", <scrollbox flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        {game.journal.length ? game.journal.map((j, i) => <box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
          <text fg={C.title} attributes={BOLD}>{`${j.title}: ${j.ending}`}</text>
          {j.lines.map((l, k) => <text key={k} fg={C.text} wrapMode="word">{`· ${l}`}</text>)}
          {stood(j.sceneId) ? <text fg={C.dim} wrapMode="word">{stood(j.sceneId)!}</text> : null}
        </box>) : <text fg={C.dim}>Nothing yet. The notebook is new, and smells of it.</text>}
      </scrollbox>, [["Esc", "close", close]]);
    }
    case "help": {
      const mode = game.screen === "combat" ? "combat" : game.screen === "scene" ? "scene" : "explore";
      // It scrolls (the wheel) when the screen's too small for all of it, as the notebook does.
      return box("How to play", <scrollbox flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        {HELP[mode]!.map((l, i) => <text key={i} fg={C.text} wrapMode="word" marginBottom={1} flexShrink={0}>{`· ${l}`}</text>)}
      </scrollbox>, [["Esc", "close", close], ["wheel", "scroll"]]);
    }
    case "menu":
      return box("Menu", <box flexDirection="column" paddingY={1}>{MENU.map((m, i) => <Clickable key={i} height={1} onClick={() => pickMenu(game, i)}><text>
        <span fg={i === o.index ? C.lead : C.dim}>{i === o.index ? "▶ " : "  "}</span><span fg={i === o.index ? C.title : C.text} {...(i === o.index ? { attributes: BOLD } : {})}>{m}</span>
      </text></Clickable>)}</box>, [["↑↓", "choose"], ["Enter", "select"], ["Esc", "back", close]]);
    case "spells":
      return box("Cast a spell", <box flexDirection="column">{o.spells.map((s, i) => <Clickable key={s.id} height={1} onClick={() => pickSpell(game, s.id, false)}><text>
        <span fg={i === o.index ? C.lead : C.dim}>{i === o.index ? "▶ " : "  "}</span>
        <span fg={i === o.index ? C.title : C.text}>{s.name}</span><span fg={C.faint}>{s.level ? ` (level ${s.level})` : " (cantrip)"}</span>
      </text></Clickable>)}</box>, [["↑↓", "choose"], ["Enter", "cast at the target"], ["t", "cast on yourself"], ["Esc", "never mind", close]]);
    case "actions": {
      // Every option the fight has, by kind: the same menu as the map's m.
      const { groups, ids } = fightMenu(game);
      return <ActionMenu title="Your options" groups={groups} index={Math.min(o.index, Math.max(0, ids.length - 1))} width={width} height={height} scroll={o}
        onPick={i => { if (o.index !== i) { o.index = i; game.emit(); } }} onChoose={i => pickAction(game, ids[i])} onClose={close} />;
    }
  }
}

/** The fight's options as the action menu groups them. */
function fightMenu(game: Game): ReturnType<typeof fightGroups> {
  const fight = game.fight;
  return fightGroups(game.fightActions, fight?.options().spells ?? [], fight?.view().player.slots ?? "");
}

/** The menu's choices, by key or click: back to the game, save to the title, or save and quit. */
function pickMenu(game: Game, index: number): void {
  game.closeOverlay();
  if (index === 1) game.quitToTitle();
  else if (index === 2) game.quit();
}

function pickSpell(game: Game, spell: string, onSelf: boolean): void {
  game.closeOverlay();
  void game.cast(spell, onSelf);
}

function pickAction(game: Game, id: string | undefined): void {
  game.closeOverlay();
  if (id) void game.combatAct(id);
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
