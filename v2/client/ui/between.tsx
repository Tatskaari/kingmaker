// Copied from the prototype's src/app/ui/between.tsx at 44c6d4a, whole but for the seams: it reads a SceneModel (the story's BetweenView) in place of the Game's card; with no map, the talk's way on is the lead's scene ("On to The Drowned Rat") where it was "Back to the map", and j opens the notebook where Esc was the menu; new, t (town-design §1.1) is a word with whoever walks with the player, the talk opened on the map (talkFrom). FightScreen is new: the fight's stand-in (src/game/fight-standin.ts) as the card's Plain.
import type { KeyEvent } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import type { SceneModel } from "../scene/model.ts";
import type { Line } from "../scene/view.ts";
import type { BetweenView } from "../story/view.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, Keys, SCROLLBAR, useStore, wayOnKey, wrap, type KeyHint } from "./common.tsx";
import { Transcript, transcriptRows } from "./scene.tsx";

/**
 * Keys between scenes, as on any way on (wayOnKey): an Enter of its own does `go` (or a click
 * does); typed characters never do, and the Enter ending them only ends them (`ended` says so).
 * j is the notebook, and t a word with whoever walks with the player (`talk`, town-design §3.6),
 * when nothing's being typed.
 */
function betweenKey(scene: SceneModel, page: SceneModel["page"], key: KeyEvent, go: () => void, ended: () => void, talk?: () => void): void {
  if (scene.overlay || scene.page !== page || key.defaultPrevented) return;
  if (key.name === "j" && !scene.typing && !key.ctrl && !key.meta) { key.preventDefault(); scene.overlay = { kind: "journal" }; scene.emit(); return; }
  if (key.name === "t" && talk && !scene.typing && !key.ctrl && !key.meta) { key.preventDefault(); talk(); return; }
  const what = wayOnKey(scene, key);
  if (!what) return;
  key.preventDefault();
  if (what === "go") go();
  else if (what === "line") ended();
}

/** What the way on says once an Enter has only ended something typed at it. */
const TYPED = "   (that typing went nowhere: Enter goes on)";

/** How long each line of a conversation between scenes waits for the one before, in ms (KM_APP_TALK_MS; 0: all at once). */
const PACE = () => Number(process.env.KM_APP_TALK_MS ?? 700);

/**
 * Between scenes: whoever walks with the player tells what happened and where next (Kell reads the
 * entry back from her notebook), in the scene's own style, a line at a time; or, with nobody there,
 * the card: the story moving on, the next lead.
 */
export function BetweenScreen({ scene }: { scene: SceneModel }) {
  useStore(scene);
  const card = scene.between();
  if (!card) return null;
  return card.talk ? <Talk scene={scene} card={card} lines={card.talk} /> : <Plain scene={scene} card={card} />;
}

/** A word with whoever walks with the player, from the card (t): on a map, where the talk opens; none with nobody there, or for a spectator. */
function talkFrom(scene: SceneModel, card: BetweenView): { key: KeyHint; run: () => void } | undefined {
  const friend = card.friend;
  if (!friend || !scene.view.onMap || scene.view.watching) return undefined;
  const run = () => scene.talkWith(friend.key);
  return { key: ["t", `a word with ${friend.name.split(" ").pop()}`, run], run };
}

function Talk({ scene, card, lines }: { scene: SceneModel; card: BetweenView; lines: Line[] }) {
  const { width, height } = useTerminalDimensions();
  const [said, setSaid] = useState(PACE() > 0 ? 1 : lines.length);
  useEffect(() => {
    if (said >= lines.length) return;
    const timer = setTimeout(() => setSaid(n => n + 1), PACE());
    return () => clearTimeout(timer);
  }, [said, lines.length]);
  const done = said >= lines.length;
  const [typed, setTyped] = useState(false);
  // An Enter (or a click) hurries the talk along to its end, then goes on.
  const go = () => { setTyped(false); scene.typing = false; if (done) scene.toLead(); else setSaid(lines.length); };
  const talk = talkFrom(scene, card);
  useKeyboard(key => betweenKey(scene, "between", key, go, () => setTyped(true), talk?.run));
  const w = Math.min(width - 2, 104);
  const who = lines.find(l => l.kind === "dialogue")?.name ?? "them";
  // Sized for the whole talk from the start, so it doesn't grow as the lines come.
  const rows = Math.max(3, Math.min(transcriptRows(lines, w - 5) + 2, height - 6));
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <box width={w} height={rows} flexDirection="column" flexShrink={0} border borderColor={C.border} title={` ${card.title} `} titleAlignment="left" titleColor={C.title} paddingX={1}>
      <scrollbox flexGrow={1} minHeight={0} scrollX={false} stickyScroll stickyStart="bottom" paddingRight={1} verticalScrollbarOptions={SCROLLBAR}>
        <Transcript lines={lines.slice(0, said)} />
      </scrollbox>
    </box>
    <Clickable width={w} height={3} flexShrink={0} border borderColor={done ? C.borderHot : C.border} title={` With ${who} `} titleAlignment="left" paddingX={1} onClick={go}>
      <text>
        <span fg={done ? C.lead : C.faint}>{"▶ "}</span>
        <span fg={done ? C.lead : C.dim} attributes={done ? BOLD : 0}>{done ? card.go : "…"}</span>
        <span fg={C.faint}>{typed ? TYPED : done ? "   Enter, or click" : `   ${who} hasn't finished`}</span>
      </text>
    </Clickable>
    <box height={1} flexShrink={0}><text fg={C.warn}>{scene.status ?? " "}</text></box>
    <box height={1} marginTop={height > 30 ? 1 : 0} flexShrink={0}><Keys items={[["Enter", done ? "go on" : "hurry them along", go], ...(talk ? [talk.key] : []), ["j", "notebook", () => { scene.overlay = { kind: "journal" }; scene.emit(); }]]} /></box>
  </box>;
}

/** The card: the story moving on, the next lead. */
function Plain({ scene, card }: { scene: SceneModel; card: BetweenView }) {
  const { width, height } = useTerminalDimensions();
  const [typed, setTyped] = useState(false);
  const talk = talkFrom(scene, card);
  useKeyboard(key => betweenKey(scene, "between", key, () => scene.toLead(), () => setTyped(true), talk?.run));
  const w = Math.min(width - 6, 100);
  const lines = card.card.flatMap(l => (l ? wrap(l, w - 4) : [""])).slice(0, Math.max(4, height - 10));
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.title} attributes={BOLD}>{card.title}</text>
    <Clickable width={w} marginTop={1} flexDirection="column" border borderColor={C.border} paddingX={1} paddingY={1} onClick={() => scene.toLead()}>
      {lines.map((l, i) => <text key={i} fg={l.startsWith("The lead") ? C.lead : l.startsWith("How things") ? C.title : C.text}>{l || " "}</text>)}
    </Clickable>
    <box height={1} flexShrink={0}><text fg={C.warn}>{scene.status ?? " "}</text></box>
    <box marginTop={1} flexDirection="row"><Keys items={[["Enter", card.go.replace(/^On/, "on"), () => scene.toLead()], ...(talk ? [talk.key] : []), ["j", "notebook", () => { scene.overlay = { kind: "journal" }; scene.emit(); }]]} />{typed ? <text fg={C.faint}>{TYPED}</text> : null}</box>
  </box>;
}

/**
 * The fight (story-design §4.5): until it's played on the map (V12), the prototype's stand-in, as a
 * card. It says what it is; Enter (or a click) fights it out, as won (fight_it_out), and it's back to
 * the scene, which picks up from the fight: the stand-in's line, how it went, the GM's aftermath
 * streaming in.
 */
export function FightScreen({ scene }: { scene: SceneModel }) {
  useStore(scene);
  const { width, height } = useTerminalDimensions();
  const [typed, setTyped] = useState(false);
  useKeyboard(key => betweenKey(scene, "fight", key, () => scene.fightOn(), () => setTyped(true)));
  const fight = scene.fight();
  const w = Math.min(width - 6, 100);
  const lines = fight.lines.flatMap(l => wrap(l, w - 4));
  return <box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center" backgroundColor={C.bg}>
    <text fg={C.danger} attributes={BOLD}>{fight.title}</text>
    <box width={w} marginTop={1} flexDirection="column" border borderColor={C.danger} paddingX={1} paddingY={1}>
      {lines.map((l, i) => <text key={i} fg={C.dim}>{l || " "}</text>)}
    </box>
    <Clickable width={w} height={3} flexShrink={0} border borderColor={C.danger} title=" The fight " titleAlignment="left" titleColor={C.danger} paddingX={1} onClick={() => scene.fightOn()}>
      <text>
        <span fg={C.lead}>{"▶ "}</span>
        <span fg={C.danger} attributes={BOLD}>{fight.go}</span>
        <span fg={C.faint}>{typed ? TYPED : "   Enter, or click"}</span>
      </text>
    </Clickable>
    <box height={1} flexShrink={0}><text fg={C.warn}>{scene.status ?? " "}</text></box>
    <box height={1} flexShrink={0}><Keys items={[["Enter", "fight it out", () => scene.fightOn()], ["j", "notebook", () => { scene.overlay = { kind: "journal" }; scene.emit(); }]]} /></box>
  </box>;
}
