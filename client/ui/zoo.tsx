// New (M6): the zoo on screen. On the title (z), its menu over the title's own: the exhibits the installed zoo has, then who to be, each a line to choose by the keys or a click, as the title's are; and its sound board (client/sound/board.ts), its kinds and then their sounds, the list scrolling with the pick when it's longer than the screen has room for. In a fight from one of its exhibits (the fight's screen, client/ui/fight.tsx, calls these): n fights it again (and Enter once it's over), o opens the line-ups to pick other foes from, and the side panel and the keys say so.
import type { KeyEvent } from "@opentui/core";
import type { ReactNode } from "react";
import type { FightModel } from "../fight/model.ts";
import type { TitleModel } from "../title/model.ts";
import { C } from "../theme.ts";
import { soundBoard } from "../sound/board.ts";
import { ui } from "../sound/cues.ts";
import { fightAgain, foesPicked, openFoes, zooFightIn } from "../zoo/fight.ts";
import { BOLD, Clickable, isEnter, ITALIC, type KeyHint } from "./common.tsx";

/** A line of the zoo's menu: what it says, a line about it, and what choosing it does. */
export interface ZooLine { label: string; detail: string; run: () => void }

/** The zoo's menu's lines at its step: the exhibits (each opens who to be next) and the sound board; who to be (each makes the visit); the board's kinds of sound, or a kind's sounds (each played). */
export function zooLines(game: TitleModel): ZooLine[] {
  const zoo = game.zoo, menu = game.zooMenu;
  if (!menu) return [];
  const board: ZooLine = { label: "The sound board", detail: "every sound the game makes, and its music in each mood", run: () => game.openSounds() };
  if (menu.step === "sounds") return soundBoard().map(k => ({ label: k.title, detail: k.detail, run: () => game.pickSounds(k.id) }));
  if (menu.step === "sound") return soundBoard().find(k => k.id === menu.kind)?.lines.map(l => ({ label: l.label, detail: l.detail, run: l.play })) ?? [];
  if (menu.step === "exhibits") return [...(zoo?.exhibits ?? []).map(e => ({ label: e.title, detail: e.description, run: () => game.pickExhibit(e.id) })), board];
  return (zoo?.builds ?? []).map(b => ({ label: b.title, detail: b.concept, run: () => void game.visit({ exhibit: menu.exhibit, build: b.id }) }));
}

/** A line chosen: its chime, but for the sound board's sounds, which are heard on their own. */
const chosen = (game: TitleModel) => { if (game.zooMenu?.step !== "sound") ui("choose"); };

/** The zoo's menu's heading at its step. */
function headingOf(game: TitleModel): string {
  const menu = game.zooMenu;
  if (menu?.step === "builds") return `${game.zoo?.exhibits.find(e => e.id === menu.exhibit)?.title ?? menu.exhibit}: who are you?`;
  if (menu?.step === "sounds") return "The sound board: every sound the game makes, by kind";
  if (menu?.step === "sound") return `The sound board: ${soundBoard().find(k => k.id === menu.kind)?.title.toLowerCase() ?? menu.kind} (Enter plays one)`;
  return "The zoo: every feature of the game, laid out to see and try";
}

/** Keys on the zoo's menu: ↑↓ choose, Enter or a number does it, Esc goes back a step. The new index, when it moved. */
export function zooKey(game: TitleModel, key: KeyEvent, index: number): number | undefined {
  const lines = zooLines(game);
  const at = Math.min(index, Math.max(0, lines.length - 1));
  const digit = /^[1-9]$/.test(key.sequence ?? "") ? Number(key.sequence) - 1 : -1;
  if (key.name === "escape" || key.name === "q" || key.name === "backspace") { ui("back"); game.zooBack(); }
  else if (key.name === "up" || key.name === "k" || key.name === "w") return lines.length ? (at + lines.length - 1) % lines.length : 0;
  else if (key.name === "down" || key.name === "j" || key.name === "s") return lines.length ? (at + 1) % lines.length : 0;
  else if ((isEnter(key) || key.name === "space") && lines[at]) { chosen(game); lines[at].run(); }
  else if (digit >= 0 && digit < lines.length) { chosen(game); lines[digit]!.run(); }
  return undefined;
}

/** The zoo's menu, where the title's lines are: its heading, its lines (the chosen one lit, each a button; `rows` of them at most, scrolling with the pick), and what it has to say. */
export function ZooPanel({ game, index, width, rows = 99, onPick }: { game: TitleModel; index: number; width: number; rows?: number; onPick: (i: number) => void }) {
  const lines = zooLines(game);
  const heading = headingOf(game);
  const at = Math.min(index, Math.max(0, lines.length - 1));
  const room = Math.max(3, rows);
  const first = Math.max(0, Math.min(at - Math.floor(room / 2), lines.length - room));
  return <box flexDirection="column" marginTop={2} width={width} border borderColor={C.borderHot} paddingX={2} paddingY={1} title=" The zoo " titleAlignment="left">
    <text fg={C.title} attributes={BOLD} height={1} flexShrink={0}>{truncate(heading, width - 6)}</text>
    {lines.map((line, i) => {
      if (i < first || i >= first + room) return null;
      const on = i === at;
      return <Clickable key={i} height={1} flexShrink={0} onClick={() => { chosen(game); line.run(); }} onMouseMove={() => { if (i !== at) onPick(i); }}>
        <text>
          <span fg={on ? C.lead : C.dim}>{on ? "▶ " : "  "}</span>
          <span fg={on ? C.title : C.text} {...(on ? { attributes: BOLD } : {})}>{line.label}</span>
          <span fg={C.dim}>{truncate(`   ${line.detail}`, Math.max(0, width - 8 - line.label.length))}</span>
        </text>
      </Clickable>;
    })}
    {!lines.length && !game.zooNote ? <text fg={C.faint} attributes={ITALIC} height={1}>The zoo has nothing to show yet.</text> : null}
    {game.zooNote ? <text fg={C.danger} height={1} flexShrink={0}>{truncate(game.zooNote, width - 6)}</text> : null}
  </box>;
}

const truncate = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);

// ---------------------------------------------------------------------------------------------
// In a fight from one of the zoo's exhibits.

/** The zoo's keys in its fight: n fights it again, o picks other foes, and once it's over Enter fights it again. True when the key was the zoo's. */
export function zooFightKey(model: FightModel, key: KeyEvent): boolean {
  if (!zooFightIn(model)) return false;
  if (key.name === "n" || (isEnter(key) && model.view.status !== "on" && model.player.caughtUp)) return fightAgain(model);
  if (key.name === "o") return openFoes(model);
  return false;
}

/** Keys on the line-ups' list: ↑↓ choose, Enter or a number picks, Esc (or o) puts it away. */
export function zooFoesKey(model: FightModel, key: KeyEvent): void {
  const o = model.overlay;
  const lineUps = zooFightIn(model)?.lineUps ?? [];
  if (o?.kind !== "foes" || !lineUps.length) { model.closeOverlay(); return; }
  const digit = /^[1-9]$/.test(key.sequence ?? "") ? Number(key.sequence) - 1 : -1;
  if (key.name === "up") { o.index = (o.index + lineUps.length - 1) % lineUps.length; model.emit(); }
  else if (key.name === "down") { o.index = (o.index + 1) % lineUps.length; model.emit(); }
  else if (isEnter(key)) foesPicked(model, o.index);
  else if (digit >= 0 && digit < lineUps.length) foesPicked(model, digit);
  else if (key.name === "escape" || key.name === "o" || key.name === "q") model.closeOverlay();
}

/** The line-ups to fight, the one being fought marked, the one picked out lit; each a button. */
export function ZooFoes({ model, width }: { model: FightModel; width: number }) {
  const zoo = zooFightIn(model);
  const o = model.overlay;
  if (!zoo || o?.kind !== "foes") return null;
  return <box flexDirection="column" paddingY={1}>
    {zoo.lineUps.map((l, i) => {
      const on = i === o.index;
      const now = l.id === zoo.foes.id ? "  (this fight)" : "";
      return <Clickable key={l.id} height={2} flexShrink={0} flexDirection="column" onClick={() => foesPicked(model, i)} onMouseMove={() => { if (o.index !== i) { o.index = i; model.emit(); } }}>
        <text height={1}>
          <span fg={on ? C.lead : C.dim}>{on ? "▶ " : "  "}</span>
          <span fg={on ? C.title : C.text} {...(on ? { attributes: BOLD } : {})}>{`${i + 1} ${l.title}`}</span>
          <span fg={C.faint}>{now}</span>
        </text>
        <text height={1} fg={C.dim}>{truncate(`    ${l.description ?? ""}`, width - 6)}</text>
      </Clickable>;
    })}
  </box>;
}

/** How tall the line-ups' list is, with its box: two rows a line-up, and the box's own. */
export const zooFoesRows = (model: FightModel) => (zooFightIn(model)?.lineUps.length ?? 0) * 2 + 6;

/** The side panel's lines for the zoo, two so they fit beside a small board: whose fight it is, and n and o, each a button; none outside the zoo. */
export function zooPanel(model: FightModel, inner: number): ReactNode[] {
  const zoo = zooFightIn(model);
  if (!zoo) return [];
  return [
    <text key="zoo-head" height={1} flexShrink={0} fg={C.faint} attributes={ITALIC}>{truncate(`The zoo: ${zoo.foes.title}`, inner)}</text>,
    <box key="zoo-keys" height={1} flexShrink={0} flexDirection="row">
      <Clickable height={1} onClick={() => fightAgain(model)}><text><span fg={C.title}>{"n "}</span><span fg={C.text}>{"again"}</span></text></Clickable>
      <text fg={C.faint}>{" · "}</text>
      <Clickable height={1} onClick={() => openFoes(model)}><text><span fg={C.title}>{"o "}</span><span fg={C.text}>{inner >= 22 ? "other foes" : "foes"}</span></text></Clickable>
    </box>,
  ];
}

/** The keys' line for the zoo: once it's over, Enter fights it again and o picks others; while it's on, n and o. None outside the zoo. */
export function zooHints(model: FightModel, over: boolean): KeyHint[] {
  if (!zooFightIn(model)) return [];
  return over
    ? [["Enter", "fight again", () => fightAgain(model)], ["o", "other foes", () => openFoes(model)]]
    : [["n", "fight again", () => fightAgain(model)], ["o", "other foes", () => openFoes(model)]];
}
