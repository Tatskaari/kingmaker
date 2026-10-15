import type { InputRenderable, MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, type ReactNode } from "react";
import type { Game } from "../game.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, FPS, isEnter, Keys, SCROLLBAR, Spinner, useGame, wrap, type KeyHint } from "./common.tsx";
import { ActionMenu, fightGroups, menuKey, menuLayout } from "./actions.tsx";
import { Place } from "./place.tsx";
import { townView } from "../../game/views.ts";
import { mapDoors, overlayWanted, stageDoors } from "../../game/look/overlay.ts";
import { mapLamps, stageLamps } from "../../game/look/lamps.ts";
import { StagePicks } from "../../game/look/stage.ts";
import { Picks } from "../../game/map/index.ts";
import { EXHIBITS } from "../../game/zoo/explorer.ts";
import { firstMorning } from "../../game/zoo/window.ts";
import { stagePicture } from "../../game/zoo/pictures.ts";
import { wingOf } from "../../game/zoo/wings/index.ts";
import { exploreState } from "../../game/town.ts";
import { sheetHeight } from "./sheet-layout.ts";
import { SheetView, type SheetHandle } from "./sheet.tsx";

/** How to report a problem, on the map, in the zoo and in a fight (a scene's help says /report). */
const REPORT_HELP = "Something wrong? b (or Report a problem… in the Esc menu): say what went wrong in a line or two, and the game saves everything needed to look into it, for Claude.";

const HELP: Record<string, string[]> = {
  explore: [
    "Click on the map to walk there (any key or click stops you). Right-click anyone or anything for what you can do with them; the Nearby list works the same.",
    "Walk with the arrow keys or WASD: they move with the screen (up is up). On the map, north is up-left.",
    "The lead (gold, with a !) is where the story is waiting: walk there and talk to whoever's waiting, or step into the place. g walks you there; any key stops.",
    "e (or Enter) talks to whoever you're facing, looks at things, and goes through doors. Bumping into someone whose scene is waiting opens it too.",
    "The sidebar says where you are, what time it is, who is about (arrows point the way on screen) and which way the lead lies.",
    "Once Kell walks with you, e beside her (or a right-click on her) stops for a word between scenes. The story waits; walk on, or say goodbye, when you're done.",
    "m (or its button) lists what you can do, by kind: cantrips, spells by level with your slots, class features with their uses, actions (attack, leap, hide, throw, shove, grab, rest). What can't be done now is dimmed, with why. Click one, or ↑↓ and Enter, or its number; ←→ jump a kind. Right-click someone, then Do something…, for the same list aimed at them.",
    "Aiming: point and click; or Tab through what's in reach, the arrows to move the aim, t for yourself, Enter. The faint ring is how far it reaches; an area shows what it covers and who it catches, and if that's you it says so in red and asks for the Enter or the click again. Esc, or a right-click, thinks better of it.",
    "It's the rules': a Fireball breaks a door down, and it stays down. Hurt someone and the town reacts: people run, the guards come on, and it's a fight on the map. What you do to someone or something whose scene is waiting (Kell, the yard gate) opens it, your act first; to Kell, a talk. Hidden, you stay so until you move or speak to anyone.",
    "c shows your character sheet, j your notebook. Esc opens the menu (save and quit). The keys at the bottom are buttons too. The game saves as you go.",
    REPORT_HELP,
  ],
  scene: [
    "Type and press Enter. Plain words are what you say, out loud, to whoever's there: Who paid you, then?",
    "*Asterisks* or (brackets) are what you do: *looks over my shoulder*, (I cast Fireball). Talk and do in the same breath if you like.",
    "The place on the right is the scene's: point at someone or something in it (or in the list under it) and the bottom line says what they are. A click talks to someone (their name starts your line) or glances at something; a right-click says what you can do with it: look, look closely, talk, take it, give them something, open or use it, go over, cast one of your spells at it, attack. A glance costs nothing and shows what anyone could see from where you stand; looking closely, and the rest, is your turn, sent as if you'd typed it. What you carry is under your own @ (Your things).",
    "By key: Tab (or ↑↓, with nothing typed) goes through what's in the place, Enter (with nothing typed) opens the menu of what Tab picked out, Esc lets go. In a menu, a click, ↑↓ and Enter, or its number; → and ← in and out of what to give, which spell or what with; anything you type puts it away and goes in the box. A right-click on a menu is a right-click on what's under it.",
    "The GM narrates and plays everyone else. Rolls happen when the story needs them (🎲 lines); ⓘ lines are things changing: what you carry, what's on fire, what you are now.",
    "When there are things you might say (in a word with Kell: her suggestions, a goodbye, walking on), they're listed over the box: click one, or press its number.",
    "/sheet your character sheet · /map the scene's place · /journal your notebook · /help this · /report what went wrong, saved for Claude (those five any time, even with the GM mid-sentence) · /save · /quit (saves, then the title). The old #sheet still works, for traditionalists. Click them at the bottom of the screen, too.",
    "PgUp/PgDn (or the mouse wheel) scroll the conversation. When a scene ends, it waits for you: an Enter of its own, or a click, goes on. Whatever you were typing as it ended goes unsaid.",
    "For testing: /exits lists the scene's endings, /end <id> takes one now.",
  ],
  zoo: [
    "Every feature of the game, laid out to see and try. Read a sign (right-click it, or face it and press e): it opens in full, with what you can set off there.",
    "Set an exhibit off from its sign's card (1-9), or right-click its lever, bell, chalk circle or person. You're walked over first; you stand on a chalk circle to cast from it.",
    "m lists what you can do, by kind, as on the story's map: your spells, features and actions, done by the rules to the wing's own things and people (a Fireball at the scarecrow burns it, and its people take it as the town's would). Right-click anything, then Do something…, for the same aimed at it.",
    "g walks you to the next exhibit you haven't seen (the gold marker). The hall's doors go to the wings; each wing's door goes back.",
    "v looks down on the wing from above: people walking, fires, the weather. r reads What happens in full.",
    "The Theatre's booths are scenes with the GM: step in. The Arena's bells start fights. Ask Kell, in her corner, and she walks with you.",
    "c your sheet (the hall's wardrobe changes who you are), j the notebook, Esc the menu. Nothing here reaches the story; the title's zoo carries on your visit.",
    REPORT_HELP,
  ],
  combat: [
    "By mouse: click a blue tile to move there; click someone on the other side to aim at them, and click them again to attack. The options on the right, and the keys at the bottom, are buttons.",
    "Arrows move 5 ft a square (diagonals too: they move with the screen). Blue tiles are where you can still get to this turn.",
    "One action a turn: a attack your target, c cast (at your target, or t on yourself), u knock over a lantern or brazier beside you, d dash, g dodge, x disengage. z closes in on your target.",
    "Tab (or 1–9) picks a target: it's bracketed on the map. Melee needs you next to them; bows reach further, at disadvantage past their range.",
    "Mind the grain dust (the brown tiles): fire in it goes up all at once, and takes everyone in it with it.",
    "m lists every option you have, by kind (attacks, cantrips, spells by level with your slots, things to knock over, moving, the rest), as the map's m does; e (or Space) ends your turn, f lets the dice decide it. s shows your sheet.",
    "When it's over, Enter (or a click) takes the story on: how it ended goes into what happens next.",
    REPORT_HELP,
  ],
};

/** The Esc menu: back to the game, the title, quitting, and reporting a problem (last, so the keys to the rest are as they were). */
const MENU = ["Back to the game", "Save and return to the title", "Save and quit", "Report a problem…"];
/** Keys that scroll the help, the notebook, a sign's card and What happens: a line (±1), a page (±2), all the way (±3). */
const SCROLL_KEYS: Record<string, number> = { up: -1, down: 1, pageup: -2, pagedown: 2, home: -3, end: 3 };
/** The overlays those keys scroll (the wheel scrolls them too). */
const SCROLLED = new Set(["help", "journal", "sign", "log"]);
const CLOSE = ["escape", "return", "space", "c", "s", "q"];

export function Overlay({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const o = game.overlay;
  const sheet = useRef<SheetHandle>(null);
  /** The scrollbox of the help, the notebook, a sign's card or What happens, for the keys that scroll it. */
  const scroll = useRef<ScrollBoxRenderable>(null);
  /** The box a report's words are typed in. */
  const words = useRef<InputRenderable>(null);
  useKeyboard(key => {
    const o = game.overlay;
    if (!o || key.defaultPrevented) return;
    // Reporting a problem: the box has the keys (Enter sends what's in it). Esc never minds (not in
    // the moment it's being saved: where it went is still to say); once it's gone, Enter puts this away too.
    if (o.kind === "report") {
      if ((key.name === "escape" && !o.sending) || (o.said && isEnter(key))) { key.preventDefault(); game.closeOverlay(); }
      return;
    }
    if (SCROLLED.has(o.kind) && SCROLL_KEYS[key.name] !== undefined) {
      key.preventDefault();
      const page = Math.max(3, Math.min(height - 2, 40) - 6);
      const by = SCROLL_KEYS[key.name]!;
      scroll.current?.scrollBy(Math.abs(by) === 2 ? Math.sign(by) * page : Math.abs(by) === 3 ? Math.sign(by) * 100000 : by);
      return;
    }
    // A sign's card: its number sets that one off (the card closes, and you're walked over).
    if (o.kind === "sign" && /^[1-9]$/.test(key.sequence ?? "")) {
      key.preventDefault();
      const pick = game.zooTriggers(o.exhibit)[Number(key.sequence) - 1];
      if (pick) void game.useFromCard(pick.id);
      return;
    }
    // The sheet takes its own keys (pages, scrolling, a spell picked or open); these close it.
    if (o.kind === "sheet") {
      if (CLOSE.includes(key.name) && !sheet.current?.wants(key)) { key.preventDefault(); game.closeOverlay(); }
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
    // Any of these keys closes the help, the notebook, the scene map, the view from above, a sign's card and What happens.
    if (CLOSE.includes(key.name) || key.name === "j" || key.name === "v" || key.name === "r" || key.sequence === "?") game.closeOverlay();
  });
  if (!o) return null;
  const w = Math.min(width - 4, 104);
  const h = Math.min(height - 2, 40);
  const close = () => game.closeOverlay();
  // A click anywhere outside it closes it (the menu too: back to the game), unless it's `sticky` (a
  // report being typed). `rows`: as tall as its content needs (a sign's card), up to the usual.
  const box = (title: string, children: ReactNode, keys: KeyHint[], rows?: number, sticky = false) => { const bh = rows ? Math.min(h, Math.max(8, rows)) : h; return <>
    <box position="absolute" left={0} top={0} width={width} height={height} zIndex={99} onMouseDown={(e: MouseEvent) => { if (e.button === 0 && !sticky) close(); }} />
    <box position="absolute" left={Math.floor((width - w) / 2)} top={Math.max(0, Math.floor((height - bh) / 2))} width={w} height={bh} zIndex={100}
      border borderStyle="double" borderColor={C.borderHot} title={` ${title} `} backgroundColor={C.panel} flexDirection="column" paddingX={1}>
      <box flexGrow={1} minHeight={0} flexDirection="column" overflow="hidden">{children}</box>
      <Keys items={keys} />
    </box>
  </>; };
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
            : <SheetView ref={sheet} data={o.sheet} who={game.session.player} width={sw - 4} height={sh - 2} active onClose={close} keys={[["Esc", "close", close]]} />}
        </box>
      </>;
    }
    case "scene-map": {
      const world = game.shownWorld;
      return box(world ? world.entities[world.root]?.name ?? "The scene" : "The scene", world
        ? <Place game={game} width={w - 4} height={h - 4} view="map" />
        : <text fg={C.dim}>This scene has no map of its own yet: it's all in the telling.</text>, [["Esc", "close", close]]);
    }
    case "stage": {
      // A zoo wing from above, alive: people mid-walk, its fires, its weather, what its exhibits set off.
      const core = game.core;
      const wing = core ? wingOf(exploreState(core.state).map) : undefined;
      return box(wing ? `${wing.name.charAt(0).toUpperCase()}${wing.name.slice(1)}, from above` : "From above", core
        ? <lookCanvas width={w - 4} height={h - 4} fps={FPS} live painter={(cw, ch, now) => {
          // In a browser, the doors are drawn as pictures over it.
          const pick = overlayWanted() ? new StagePicks({ doors: true }) : undefined;
          const frame = stagePicture(core.state, { w: cw, h: ch }, now, game.mapFx(), pick);
          return frame && pick ? { frame, doors: stageDoors(pick, frame), lamps: stageLamps(pick) } : frame ?? [];
        }} />
        : null, [["Esc", "close", close], ["v", "close", close]]);
    }
    case "sign": {
      // A sign read, in full, and what can be set off by it from here (click one, or its number).
      const exhibit = EXHIBITS.find(e => e.id === o.exhibit);
      const offers = game.zooTriggers(o.exhibit);
      return box(exhibit?.title ?? "A sign", <scrollbox ref={scroll} flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        <text fg={C.text} wrapMode="word" flexShrink={0}>{exhibit?.text ?? ""}</text>
        {offers.length ? <text fg={C.title} attributes={BOLD} marginTop={1} flexShrink={0}>Set it off</text> : null}
        {offers.map((a, i) => <Clickable key={a.id} flexShrink={0} onClick={() => void game.useFromCard(a.id)}><text wrapMode="word">
          <span fg={C.lead}>{`${i < 9 ? i + 1 : " "} `}</span><span fg={C.text}>{a.label}</span>
        </text></Clickable>)}
        {exhibit?.needsModel ? <text fg={C.faint} marginTop={1} wrapMode="word" flexShrink={0}>{"(This one needs the GM, a model, to be seen properly: offline it does what it can, and says so.)"}</text> : null}
      </scrollbox>, [...(offers.length ? [["1-9", "set it off"] as KeyHint] : []), ["↑↓", "scroll"], ["Esc", "close", close]],
      // Its words, the list and the note, wrapped as they'll be drawn, with the borders and the keys.
      wrap(exhibit?.text ?? "", w - 5).length + (offers.length ? 2 + offers.reduce((n, a) => n + wrap(`1 ${a.label}`, w - 5).length, 0) : 0) + (exhibit?.needsModel ? 3 : 0) + 3);
    }
    case "window": {
      // Caerwyn as a new game of the story has it, alive: the lane by the granary gate, the lead on the yard.
      const morning = firstMorning();
      return box("Through the window: the story's first morning", <lookCanvas width={w - 4} height={h - 4} fps={FPS} live
        painter={(cw, ch, now) => {
          const pick = overlayWanted() ? new Picks({ doors: true }) : undefined;
          const lines = townView(morning, undefined, { w: cw, h: ch }, { t: now, ...(pick ? { pick } : {}) });
          return pick ? { frame: lines, doors: mapDoors(pick, lines), lamps: mapLamps(pick, lines) } : lines;
        }} />, [["Esc", "close", close]]);
    }
    case "log":
      // What happens, in full: the last things said on the map, the newest at the bottom.
      return box("What happens", <scrollbox ref={scroll} flexGrow={1} scrollX={false} stickyScroll stickyStart="bottom" paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        {game.messages.length ? game.messages.map((m, i, all) => <text key={i} fg={i === all.length - 1 ? C.text : C.dim} wrapMode="word" marginBottom={1} flexShrink={0}>{m}</text>)
          : <text fg={C.dim}>Nothing yet.</text>}
      </scrollbox>, [["↑↓", "scroll"], ["Esc", "close", close]]);
    case "journal": {
      const history = game.session?.history ?? [];
      const stood = (sceneId: string) => history.find(h => h.sceneId === sceneId)?.summary.split("\n").slice(1).join("\n").trim();
      return box("The investigator's notebook", <scrollbox ref={scroll} flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        {game.journal.length ? game.journal.map((j, i) => <box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
          <text fg={C.title} attributes={BOLD}>{`${j.title}: ${j.ending}`}</text>
          {j.lines.map((l, k) => <text key={k} fg={C.text} wrapMode="word">{`· ${l}`}</text>)}
          {stood(j.sceneId) ? <text fg={C.dim} wrapMode="word">{stood(j.sceneId)!}</text> : null}
        </box>) : <text fg={C.dim}>Nothing yet. The notebook is new, and smells of it.</text>}
      </scrollbox>, [["Esc", "close", close], ["↑↓", "scroll"]]);
    }
    case "help": {
      const mode = game.screen === "combat" ? "combat" : game.screen === "scene" ? "scene" : game.isZoo ? "zoo" : "explore";
      // A short screen scrolls it (the wheel, ↑↓, PgUp/PgDn), as the notebook does. Wrapped here, at
      // spaces only, under its bullet (OpenTUI's own wrapping breaks before a comma after a bracket).
      const wrapped = HELP[mode]!.map(l => wrap(l, w - 8).map((t, i) => `${i ? "  " : "· "}${t}`));
      const long = wrapped.reduce((n, l) => n + l.length + 1, 0) > h - 3;
      return box("How to play", <scrollbox ref={scroll} flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        {wrapped.map((l, i) => <text key={i} fg={C.text} marginBottom={1} flexShrink={0}>{l.join("\n")}</text>)}
      </scrollbox>, [["Esc", "close", close], ...(long ? [["↑↓ PgUp/PgDn", "scroll"] as KeyHint] : [])]);
    }
    case "report": {
      // What went wrong (Enter sends it), then where the report went, to tell Claude.
      const inner = w - 4;
      if (o.sending) return box("Report a problem", <Spinner label="Saving the report…" />, [], 5, true);
      if (o.said) {
        return box(o.failed ? "The report couldn't be saved" : "Report saved", <text fg={o.failed ? C.danger : C.text} wrapMode="word">{o.said}</text>,
          [["Enter", "back to the game", close]], wrap(o.said, inner).length + 3);
      }
      const ask = "What went wrong? A line or two: what you did, what happened, what you expected.";
      const note = "The report keeps this game, what's on screen and the GM's calls (never your key), for Claude to look into.";
      const send = () => void game.sendReport(words.current?.value ?? "");
      const rows = wrap(ask, inner).length + 3 + (o.problem ? wrap(o.problem, inner).length : 0) + wrap(note, inner).length + 3;
      return box("Report a problem", <box flexDirection="column">
        <text fg={C.title} wrapMode="word" flexShrink={0}>{ask}</text>
        <box height={3} border borderColor={C.borderHot} paddingX={1} flexShrink={0}>
          <input ref={words} focused placeholder="Kell asked me the same thing three times…"
            onSubmit={(value: unknown) => void game.sendReport(typeof value === "string" ? value : words.current?.value ?? "")} />
        </box>
        {o.problem ? <text fg={C.warn} wrapMode="word" flexShrink={0}>{o.problem}</text> : null}
        <text fg={C.dim} wrapMode="word" flexShrink={0}>{note}</text>
      </box>, [["Enter", "send", send], ["Esc", "never mind", close]], rows, true);
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

/** The menu's choices, by key or click: back to the game, save to the title, save and quit, or report a problem. */
function pickMenu(game: Game, index: number): void {
  // The report takes the menu's place: the screen it keeps is the one from before the menu came up.
  if (index === 3) { game.openReport(); return; }
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
