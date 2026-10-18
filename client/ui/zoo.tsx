// New (M6): the zoo's menu on the title (z), over the title's own: the exhibits the installed zoo has, then who to be, each a line to choose by the keys or a click, as the title's are.
import type { KeyEvent } from "@opentui/core";
import type { TitleModel } from "../title/model.ts";
import { C } from "../theme.ts";
import { BOLD, Clickable, isEnter, ITALIC } from "./common.tsx";

/** A line of the zoo's menu: what it says, a line about it, and what choosing it does. */
export interface ZooLine { label: string; detail: string; run: () => void }

/** The zoo's menu's lines at its step: the exhibits (each opens who to be next), or who to be (each makes the visit). */
export function zooLines(game: TitleModel): ZooLine[] {
  const zoo = game.zoo, menu = game.zooMenu;
  if (!zoo || !menu) return [];
  if (menu.step === "exhibits") return zoo.exhibits.map(e => ({ label: e.title, detail: e.description, run: () => game.pickExhibit(e.id) }));
  return zoo.builds.map(b => ({ label: b.title, detail: b.concept, run: () => void game.visit({ exhibit: menu.exhibit, build: b.id }) }));
}

/** Keys on the zoo's menu: ↑↓ choose, Enter or a number does it, Esc goes back a step. The new index, when it moved. */
export function zooKey(game: TitleModel, key: KeyEvent, index: number): number | undefined {
  const lines = zooLines(game);
  const at = Math.min(index, Math.max(0, lines.length - 1));
  const digit = /^[1-9]$/.test(key.sequence ?? "") ? Number(key.sequence) - 1 : -1;
  if (key.name === "escape" || key.name === "q" || key.name === "backspace") game.zooBack();
  else if (key.name === "up" || key.name === "k" || key.name === "w") return lines.length ? (at + lines.length - 1) % lines.length : 0;
  else if (key.name === "down" || key.name === "j" || key.name === "s") return lines.length ? (at + 1) % lines.length : 0;
  else if (isEnter(key) || key.name === "space") lines[at]?.run();
  else if (digit >= 0 && digit < lines.length) lines[digit]!.run();
  return undefined;
}

/** The zoo's menu, where the title's lines are: its heading, its lines (the chosen one lit, each a button), and what it has to say. */
export function ZooPanel({ game, index, width, onPick }: { game: TitleModel; index: number; width: number; onPick: (i: number) => void }) {
  const lines = zooLines(game);
  const menu = game.zooMenu;
  const exhibit = menu?.step === "builds" ? game.zoo?.exhibits.find(e => e.id === menu.exhibit) : undefined;
  const heading = exhibit ? `${exhibit.title}: who are you?` : "The zoo: every feature of the game, laid out to see and try";
  const at = Math.min(index, Math.max(0, lines.length - 1));
  return <box flexDirection="column" marginTop={2} width={width} border borderColor={C.borderHot} paddingX={2} paddingY={1} title=" The zoo " titleAlignment="left">
    <text fg={C.title} attributes={BOLD} height={1} flexShrink={0}>{truncate(heading, width - 6)}</text>
    {lines.map((line, i) => {
      const on = i === at;
      return <Clickable key={i} height={1} flexShrink={0} onClick={() => line.run()} onMouseMove={() => { if (i !== at) onPick(i); }}>
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
