import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { sceneById } from "../../../scenes/index.ts";
import { whereabouts } from "../../game/map/index.ts";
import { exploreState } from "../../game/town.ts";
import type { Game } from "../game.ts";
import type { Resumable } from "../save.ts";
import { timeOf, TIME_WORDS } from "../story.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, ITALIC, Keys, Spinner, useGame, type KeyHint } from "./common.tsx";

/**
 * On a web page (the browser builds set KM_IN_BROWSER: src/web), Esc is how a page dismisses things
 * and there's nothing for the game to quit to, so there only q (or the Quit item) closes it.
 */
const escQuits = () => process.env.KM_IN_BROWSER !== "1";

const TAGLINES = [
  "Being an account of a murder, a great deal of grain, and the eve of the Centennial Assembly.",
  "No clerks were harmed in the making of this game. Well. One.",
  "The King remembers how everyone takes their tea. He would like to remember who did this.",
];

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function describe(r: Resumable): string {
  const scene = (() => { try { return sceneById(r.session.sceneId).title; } catch { return r.session.sceneId; } })();
  // A fight that broke out on the map is where the map has the player, not at the scene the story's heading for.
  const street = r.game.mode === "combat" && r.game.fightOnMap ? (() => { try { return whereabouts(exploreState(r.game)).place; } catch { return undefined; } })() : undefined;
  const where = r.game.mode === "scene" ? `in ${scene}` : street ? `fighting in ${street}` : r.game.mode === "combat" ? `fighting at ${scene}` : `heading for ${scene}`;
  return `${r.session.player.name}: ${TIME_WORDS[r.game.story.time ?? timeOf(r.session.sceneId)].split(",")[0]}, ${where} (${ago(r.mtime)})`;
}

export function TitleScreen({ game }: { game: Game }) {
  useGame(game);
  const { width, height } = useTerminalDimensions();
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState<string | undefined>();
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]!);
  useEffect(() => { game.loadSaves(); }, [game]);
  // The game x was pressed on: x again deletes it, anything else keeps it.
  const [doomed, setDoomed] = useState<string | undefined>();
  const items: Array<{ label: string; detail?: string; save?: Resumable; zoo?: boolean; run: () => void }> = [
    ...game.saves.slice(0, 3).map((r, i) => ({
      label: i === 0 ? "Continue" : "Continue an older game",
      detail: describe(r),
      save: r,
      run: () => { setLoading(`Finding your place in the story…`); void game.resume(r).finally(() => setLoading(undefined)); },
    })),
    { label: "New game", detail: "make a character and take the case", run: () => game.newCharacter() },
    // The zoo: every feature laid out to see and try, kept apart from the story's games.
    // A visit can go the way of a game (x, twice): the next one starts fresh.
    { label: "The zoo", detail: game.zooVisit ? "carry on your visit: every feature, laid out to see and try (x starts afresh)" : "every feature of the game, laid out to see and try", ...(game.zooVisit ? { save: game.zooVisit } : {}), zoo: true, run: () => openZoo() },
    { label: "Quit", detail: "the clerk will keep", run: () => game.quit() },
  ];
  const at = Math.min(index, items.length - 1);
  function openZoo(): void {
    if (loading || game.screen !== "title") return;
    setLoading("Opening the zoo…");
    void game.zoo().finally(() => setLoading(undefined));
  }
  const pick = (i: number) => {
    if (loading || game.screen !== "title") return;
    if (doomed) { setDoomed(undefined); return; }
    items[Math.min(i, items.length - 1)]!.run();
  };
  const select = (i: number) => { if (i !== at) setDoomed(undefined); setIndex(i); };
  const doom = () => {
    const save = items[at]!.save;
    if (!save || loading) return;
    if (doomed !== save.id) { setDoomed(save.id); return; }
    setDoomed(undefined);
    if (items[at]!.zoo) game.deleteZooVisits(); else game.deleteSave(save);
  };
  useKeyboard(key => {
    if (game.overlay || loading || key.defaultPrevented || game.screen !== "title") return;
    key.preventDefault();
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
    else if (key.name === "q" || (key.name === "escape" && escQuits())) game.quit();
  });
  const keys: KeyHint[] = doomed
    ? [["x", "delete it", doom], ["any other key", "keep it", () => setDoomed(undefined)]]
    : [["↑↓", "choose"], ["Enter", "select", () => pick(at)], ...(items[at]!.save ? [["x", "delete", doom] satisfies KeyHint] : []), ["n", "new game", () => game.newCharacter()], ["z", "the zoo", openZoo], ["q", "quit", () => game.quit()]];
  const wide = width >= 84;
  const w = Math.min(width - 4, 90);
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    {wide ? <ascii-font text="KINGMAKER" font="block" color={[C.title, "#c98a3a"]} /> : <text fg={C.title} attributes={BOLD}>K I N G M A K E R</text>}
    <text fg={C.text} attributes={BOLD} marginTop={1}>The Hanged Clerk of Caerwyn</text>
    <text fg={C.dim} attributes={ITALIC}>{tagline}</text>
    <box flexDirection="column" marginTop={2} width={w} border borderColor={C.border} paddingX={2} paddingY={1}>
      {/* Each a button: the pointer picks it out as it moves, a click does it. Not as it rests: OpenTUI says
          "over" to whatever comes up under a pointer left where it was, and Enter would do that, not Continue. */}
      {items.map((item, i) => {
        const on = i === at;
        const going = !!item.save && item.save.id === doomed;
        const label = going ? (item.zoo ? "Start the zoo afresh?" : "Delete this game?") : item.label;
        const detail = going ? (item.zoo ? "this visit goes, for good: x again, and z starts a new one" : `${item.save!.session.player.name}'s, for good: x again deletes it`) : item.detail;
        return <Clickable key={i} height={1} flexShrink={0} onClick={() => pick(i)} onMouseMove={() => { if (i !== at) select(i); }}>
          <text>
            <span fg={going ? C.danger : on ? C.lead : C.dim}>{on ? "▶ " : "  "}</span>
            <span fg={going ? C.danger : on ? C.title : C.text} {...(on ? { attributes: BOLD } : {})}>{label}</span>
            {detail ? <span fg={C.dim}>{truncate(`   ${detail}`, Math.max(0, w - 8 - label.length))}</span> : null}
          </text>
        </Clickable>;
      })}
    </box>
    <box marginTop={1} height={1}>{loading ? <Spinner label={loading} /> : <Keys items={keys} />}</box>
    {game.error ? <text fg={C.danger} marginTop={1}>{game.error}</text> : null}
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);
