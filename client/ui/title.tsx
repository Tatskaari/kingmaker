// Copied from the prototype's src/app/ui/title.tsx at 44c6d4a: it reads a TitleModel in place of the Game (saves are my_games' rows, live, so nothing loads them; describe and ago are title/model.ts's); Report a problem (b) is cut (V16); Esc quits in a terminal and not on a page (:12-16, the app's surface where it read KM_IN_BROWSER). The zoo (z) is v2's (M6): its menu (ui/zoo.tsx) over the title's lines, an exhibit then who to be, where the prototype's carried a visit on.
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import type { Surface } from "../app/model.ts";
import type { GameRow } from "../backend.ts";
import { describe, type TitleModel } from "../title/model.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, ITALIC, Keys, Spinner, useStore, type KeyHint } from "./common.tsx";
import { ZooPanel, zooKey, zooLines } from "./zoo.tsx";

/**
 * On a web page, Esc is how a page dismisses things and there's nothing for the game to quit to, so
 * there only q (or the Quit item) closes it.
 */
const escQuits = (surface: Surface) => surface === "terminal";

const TAGLINES = [
  "Being an account of a murder, a great deal of grain, and the eve of the Centennial Assembly.",
  "No clerks were harmed in the making of this game. Well. One.",
  "The King remembers how everyone takes their tea. He would like to remember who did this.",
];

export function TitleScreen({ game, surface = "terminal" }: { game: TitleModel; surface?: Surface }) {
  useStore(game);
  const { width, height } = useTerminalDimensions();
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState<string | undefined>();
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]!);
  // The game x was pressed on: x again deletes it, anything else keeps it.
  const [doomed, setDoomed] = useState<string | undefined>();
  // The line chosen on the zoo's menu, while it's open.
  const [zooAt, setZooAt] = useState(0);
  const openZoo = () => { setZooAt(0); game.openZoo(); };
  const items: Array<{ label: string; detail?: string; save?: GameRow; run: () => void }> = [
    ...game.saves.slice(0, 3).map((r, i) => ({
      label: i === 0 ? "Continue" : "Continue an older game",
      detail: describe(r),
      save: r,
      run: () => { setLoading(`Finding your place in the story…`); void game.resume(r).finally(() => setLoading(undefined)); },
    })),
    { label: "New game", detail: "make a character and take the case", run: () => game.newCharacter() },
    { label: "The zoo", detail: "every feature of the game, laid out to see and try: the combat ring first", run: openZoo },
    { label: "Quit", detail: "the clerk will keep", run: () => game.quit() },
  ];
  const at = Math.min(index, items.length - 1);
  const idOf = (save: GameRow) => String(save.gameId);
  const pick = (i: number) => {
    if (loading || game.screen !== "title") return;
    if (doomed) { setDoomed(undefined); return; }
    items[Math.min(i, items.length - 1)]!.run();
  };
  const select = (i: number) => { if (i !== at) setDoomed(undefined); setIndex(i); };
  const doom = () => {
    const save = items[at]!.save;
    if (!save || loading) return;
    if (doomed !== idOf(save)) { setDoomed(idOf(save)); return; }
    setDoomed(undefined);
    game.deleteSave(save);
  };
  useKeyboard(key => {
    if (loading || key.defaultPrevented || game.screen !== "title") return;
    key.preventDefault();
    if (game.zooMenu) {
      const step = game.zooMenu.step;
      const moved = zooKey(game, key, zooAt);
      if (moved !== undefined) setZooAt(moved);
      else if (game.zooMenu?.step !== step) setZooAt(0);
      return;
    }
    if (doomed) {
      if (key.name === "x" || key.name === "delete") doom();
      else setDoomed(undefined);
      return;
    }
    if (key.name === "up" || key.name === "k" || key.name === "w") select((at + items.length - 1) % items.length);
    else if (key.name === "down" || key.name === "j" || key.name === "s") select((at + 1) % items.length);
    else if (key.name === "return" || key.name === "space") pick(at);
    else if (key.name === "x" || key.name === "delete") doom();
    else if (key.name === "n") game.newCharacter();
    else if (key.name === "z") openZoo();
    else if (key.name === "q" || (key.name === "escape" && escQuits(surface))) game.quit();
  });
  const keys: KeyHint[] = game.zooMenu
    ? [["↑↓", "choose"], ["Enter", game.zooMenu.step === "exhibits" ? "open it" : "be them", () => zooLines(game)[zooAt]?.run()], ["Esc", "back", () => { setZooAt(0); game.zooBack(); }]]
    : doomed
    ? [["x", "delete it", doom], ["any other key", "keep it", () => setDoomed(undefined)]]
    : [["↑↓", "choose"], ["Enter", "select", () => pick(at)], ...(items[at]!.save ? [["x", "delete", doom] satisfies KeyHint] : []), ["n", "new game", () => game.newCharacter()], ["z", "the zoo", openZoo], ["q", "quit", () => game.quit()]];
  const wide = width >= 84;
  const w = Math.min(width - 4, 90);
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    {wide ? <ascii-font text="KINGMAKER" font="block" color={[C.title, "#c98a3a"]} /> : <text fg={C.title} attributes={BOLD}>K I N G M A K E R</text>}
    <text fg={C.text} attributes={BOLD} marginTop={1}>The Hanged Clerk of Caerwyn</text>
    <text fg={C.dim} attributes={ITALIC}>{tagline}</text>
    {game.zooMenu ? <ZooPanel game={game} index={zooAt} width={w} onPick={setZooAt} /> : <box flexDirection="column" marginTop={2} width={w} border borderColor={C.border} paddingX={2} paddingY={1}>
      {/* Each a button: the pointer picks it out as it moves, a click does it. Not as it rests: OpenTUI says
          "over" to whatever comes up under a pointer left where it was, and Enter would do that, not Continue. */}
      {items.map((item, i) => {
        const on = i === at;
        const going = !!item.save && idOf(item.save) === doomed;
        const label = going ? "Delete this game?" : item.label;
        const detail = going ? `${item.save!.name}'s, for good: x again deletes it` : item.detail;
        return <Clickable key={i} height={1} flexShrink={0} onClick={() => pick(i)} onMouseMove={() => { if (i !== at) select(i); }}>
          <text>
            <span fg={going ? C.danger : on ? C.lead : C.dim}>{on ? "▶ " : "  "}</span>
            <span fg={going ? C.danger : on ? C.title : C.text} {...(on ? { attributes: BOLD } : {})}>{label}</span>
            {detail ? <span fg={C.dim}>{truncate(`   ${detail}`, Math.max(0, w - 8 - label.length))}</span> : null}
          </text>
        </Clickable>;
      })}
    </box>}
    <box marginTop={1} height={1}>{loading ? <Spinner label={loading} /> : <Keys items={keys} />}</box>
    {game.error ? <text fg={C.danger} marginTop={1}>{game.error}</text> : null}
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
