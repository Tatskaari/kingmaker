import type { ReactNode } from "react";
import { TextAttributes } from "@opentui/core";

/**
 * Screens to draw with both renderers (src/web/tui/compare/README in run.ts): small trees that
 * exercise one thing each (borders and titles, wrapping, alignment, clipping, absolute boxes,
 * scrollboxes, inputs, the big font, wide characters), then the game's own screens. Each one is a
 * size, an element, and optionally input to feed in before the frame is compared.
 */

export interface Step { run?: () => void; keys?: string[]; type?: string; click?: [number, number, number?]; move?: [number, number]; scroll?: [number, number, "up" | "down"]; wait?: number }
export interface Scenario { name: string; width: number; height: number; node: () => ReactNode | Promise<ReactNode>; steps?: Step[] }

const LOREM = "The yard behind the King's Granary smells of wet grain and pigeons. Wendell Prout turns slowly on the sack hoist above the shut loft door, and a scrawny boy in enormous boots is lobbing gutter-stones at him (with a running commentary): e.g., \"left-handed/right-handed?\"";

export const synthetic: Scenario[] = [
  {
    name: "borders and titles", width: 60, height: 14,
    node: () => <box width={60} height={14} backgroundColor="#15131a" flexDirection="column">
      <box border borderColor="#4a4458" title=" Left " titleAlignment="left" height={3}><text fg="#ddd5c4">plain</text></box>
      <box border borderStyle="rounded" borderColor="#c9a24a" title=" Centre " titleAlignment="center" height={3} paddingX={1}><text>rounded, padded</text></box>
      <box border borderStyle="double" borderColor="#e8c170" title=" Right " titleAlignment="right" titleColor="#ff6b6b" height={3} backgroundColor="#1b1922"><text fg="#8fc7ff">double, filled</text></box>
      <box flexDirection="row" height={5}>
        <box border borderStyle="heavy" width={10} title=" A title far too long " />
        <box border={["left"]} borderStyle="heavy" borderColor="#8fc7ff" paddingLeft={1} width={20}><text fg="#8fc7ff" wrapMode="word">a bar down the left of a quote</text></box>
        <box border={["top", "bottom"]} width={12}><text>top+bottom</text></box>
        <box border={["left", "right"]} width={10}><text>sides</text></box>
      </box>
    </box>,
  },
  {
    name: "flex rows, columns, grow, gap", width: 70, height: 12,
    node: () => <box width={70} height={12} flexDirection="column" backgroundColor="#15131a">
      <box flexDirection="row" height={3} gap={2}>
        <box border flexGrow={1}><text>grow 1</text></box>
        <box border flexGrow={2}><text>grow 2</text></box>
        <box border width={12}><text>fixed 12</text></box>
      </box>
      <box flexDirection="row" height={4} justifyContent="space-between" alignItems="center" marginTop={1} paddingX={2}>
        <text fg="#e8c170">left</text><text fg="#7bd389">middle</text><text fg="#ff6b6b">right</text>
      </box>
      <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <text attributes={TextAttributes.BOLD}>centred, bold</text>
        <text attributes={TextAttributes.ITALIC} fg="#8a8273">italic, dim colour</text>
      </box>
    </box>,
  },
  {
    name: "word wrap", width: 50, height: 30,
    node: () => <box width={50} height={30} flexDirection="column" backgroundColor="#15131a">
      <box width={31} border><text wrapMode="word">{LOREM}</text></box>
      <box width={23} border><text wrapMode="word"><span fg="#f0b86e" attributes={TextAttributes.BOLD}>Sergeant Agnes Kell: </span><span fg="#e9e2d0">“That's a javelin in the King's granary wall, investigator.” She writes it down. “Noted.”</span></text></box>
      <box width={17} border><text>Abcdefghijklmnopqrstuvwxyz0123456789 split mid-word</text></box>
    </box>,
  },
  {
    name: "char wrap, no wrap, lines", width: 40, height: 20,
    node: () => <box width={40} height={20} flexDirection="column" backgroundColor="#15131a">
      <box width={21} border><text wrapMode="char">{LOREM.slice(0, 80)}</text></box>
      <box width={21} border><text wrapMode="none">{LOREM.slice(0, 80)}</text></box>
      <box width={30} border height={4}><text>{"one\ntwo\nthree\nfour"}</text></box>
      <box width={30} border height={3}><text height={1}>{"only the first\nsecond"}</text></box>
      <box width={30}><text textAlign="center" wrapMode="word" flexShrink={0}><span fg="#4a4458">{"──────── "}</span><span fg="#a89bc4" attributes={TextAttributes.ITALIC}>The case is made</span><span fg="#4a4458">{" ────────"}</span></text></box>
    </box>,
  },
  {
    name: "absolute, zIndex, overflow", width: 50, height: 16,
    node: () => <box width={50} height={16} backgroundColor="#15131a">
      <box width={30} height={6} border title=" clipped " overflow="hidden" flexDirection="column">
        <text>{Array.from({ length: 10 }, (_, i) => `line ${i} of text that runs past the right edge of the box`).join("\n")}</text>
      </box>
      <box position="absolute" left={10} top={3} width={24} height={6} zIndex={50} border borderStyle="rounded" borderColor="#c9a24a" backgroundColor="#1b1922" title=" Menu " flexDirection="column" paddingX={1}>
        <text><span fg="#ffd75e">1 </span><span fg="#e8c170" attributes={TextAttributes.BOLD}>Talk</span></text>
        <text fg="#5c564d">Esc never mind</text>
      </box>
      <box position="absolute" left={0} top={10} width={50} height={6} zIndex={10} backgroundColor="#3b3550"><text>under the next</text></box>
      <box position="absolute" left={5} top={11} width={20} height={3} zIndex={20} border backgroundColor="#1b1922"><text>on top</text></box>
    </box>,
  },
  {
    name: "wide and odd characters", width: 40, height: 10,
    node: () => <box width={40} height={10} border flexDirection="column" backgroundColor="#15131a">
      <box flexDirection="row"><text width={3} flexShrink={0} fg="#ffd166">🎲</text><text flexGrow={1} flexShrink={1} wrapMode="word" fg="#ffd166">Medicine check to examine Prout: 11 + 1 = 12 vs DC 12: success</text></box>
      <box flexDirection="row"><text width={3} flexShrink={0} fg="#7cc6b4">ⓘ</text><text flexGrow={1} wrapMode="word" fg="#7cc6b4">You no longer have your javelin</text></box>
      <text>{"↖↑↗→↘↓↙← • ▶ ⠋ … · — “quotes” ░▒▓█▀▄"}</text>
      <text>{"tab\there and a control \x01 char"}</text>
    </box>,
  },
  {
    name: "scrollbox sticky bottom", width: 40, height: 12,
    node: () => <box width={40} height={12} border title=" talk " paddingX={1} flexDirection="column" backgroundColor="#15131a">
      <scrollbox flexGrow={1} minHeight={0} scrollX={false} stickyScroll stickyStart="bottom" paddingRight={1}
        verticalScrollbarOptions={{ position: "absolute", right: 0, top: 0, bottom: 0, trackOptions: { foregroundColor: "#4a4458", backgroundColor: "#15131a" } }}>
        <box flexDirection="column" flexShrink={0}>
          {Array.from({ length: 14 }, (_, i) => <text key={i} wrapMode="word">{`${i}: the conversation goes on, a line at a time`}</text>)}
        </box>
      </scrollbox>
    </box>,
  },
  {
    name: "scrollbox short", width: 40, height: 10,
    node: () => <box width={40} height={10} border title=" notes " paddingX={1} flexDirection="column" backgroundColor="#15131a">
      <scrollbox flexGrow={1} scrollX={false} paddingRight={1} verticalScrollbarOptions={{ position: "absolute", right: 0, top: 0, bottom: 0, trackOptions: { foregroundColor: "#4a4458", backgroundColor: "#15131a" } }}>
        <text fg="#8a8273">Nothing yet. The notebook is new, and smells of it.</text>
      </scrollbox>
    </box>,
  },
  {
    name: "inputs", width: 60, height: 8,
    node: () => <box width={60} height={8} flexDirection="column" backgroundColor="#15131a">
      <box border borderColor="#c9a24a" title=" Name " height={3}><input value="" placeholder="Wren Ashdown (Enter for the default)" focused /></box>
      <box border borderColor="#4a4458" title=" Who they are " height={3}><input value="a disgraced palace auditor" placeholder="placeholder" focused={false} /></box>
    </box>,
  },
  {
    name: "input typed past its width", width: 30, height: 3,
    node: () => <box border title=" say " height={3} width={30}><input value="" placeholder="Say it" focused /></box>,
    steps: [{ type: "The quick brown fox jumps over the lazy dog and keeps going" }],
  },
  {
    name: "ascii font", width: 80, height: 8,
    node: () => <box width={80} height={8} alignItems="center" justifyContent="center" backgroundColor="#15131a">
      <ascii-font text="KINGMAKER" font="block" color={["#e8c170", "#c98a3a"]} />
    </box>,
  },
];
