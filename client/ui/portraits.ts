// Copied from the prototype's src/app/ui/portraits.ts at 44c6d4a: the 28 colours of src/game/look/color.ts's PALETTE it uses are inlined (PALETTE below), and StyledLine comes from ./types.ts.
import { C } from "../theme.ts";
import type { StyledLine } from "./types.ts";

/**
 * A portrait for each of the twelve SRD classes, for the character sheet: single-width characters
 * only, coloured cell by cell. A cell's colour is a letter naming an ink (INK below, or the
 * portrait's own `colors`): its character's in `chars` if it has one, else the last `paint`
 * rectangle over the cell, else the portrait's `base`.
 */

export interface Portrait {
  /** A line under it, in the house voice (PORTRAIT_W at most). */
  caption: string;
  art: string[];
  /** The ink for cells nothing else colours. */
  base: string;
  /** Rectangles of ink, later over earlier: [top, bottom, left, right, ink], rows and columns inclusive. */
  paint?: Array<[number, number, number, number, string]>;
  /** Inks by character, wherever it is (the stars on a hat, the flowers in a beard). */
  chars?: Record<string, string>;
  /** The portrait's own inks (a robe's colour, a flame), over INK. */
  colors?: Record<string, string>;
}

/** The named colours the portraits are inked in (the prototype's look palette, src/game/look/color.ts). */
const PALETTE = {
  crimson: "#b8323a", scarlet: "#e0442a", orange: "#f08a2a", gold: "#ffd75f", cream: "#f0e4c4", oak: "#a0703a",
  walnut: "#7a5232", leather: "#8a5a32", leaf: "#5a9a3a", grass: "#7ab84a", poison: "#8fdc3a", sky: "#9fc8f0",
  azure: "#3a8ae0", ice: "#cfefff", violet: "#9a6ae0", purple: "#8a3aa0", white: "#f4f1e8", bone: "#e4dcc0",
  silver: "#c8ccd4", pewter: "#a8acb4", grey: "#9a968e", slate: "#7a8090", iron: "#7d8794", steel: "#a8b4c0",
  brass: "#c9a24a", copper: "#d08850", charcoal: "#3a3430", flesh: "#d8a07a",
} as const;

export const PORTRAIT_W = 22;
export const PORTRAIT_H = 15;

const INK: Record<string, string> = {
  s: PALETTE.flesh, S: "#b07a58", e: C.text, E: "#ffffff", r: PALETTE.crimson, R: PALETTE.scarlet,
  h: PALETTE.walnut, H: PALETTE.grey, W: PALETTE.white, n: PALETTE.bone,
  m: PALETTE.steel, M: PALETTE.iron, g: PALETTE.gold, b: PALETTE.brass, o: PALETTE.copper,
  w: PALETTE.oak, l: PALETTE.leather, c: PALETTE.slate, C: PALETTE.pewter, k: PALETTE.charcoal,
  f: PALETTE.scarlet, F: PALETTE.orange, y: PALETTE.gold, Y: PALETTE.cream,
  G: PALETTE.leaf, L: PALETTE.grass, P: PALETTE.poison,
  v: PALETTE.violet, p: PALETTE.purple, u: PALETTE.azure, U: PALETTE.sky, i: PALETTE.ice,
  d: C.dim, D: C.faint, t: C.text,
};

/** A drawing's rows, from a template literal that starts and ends on a line of its own. */
const grid = (s: string) => s.replace(/^\n/, "").replace(/\n$/, "").split("\n");

export const PORTRAITS: Record<string, Portrait> = {
  // Horns, a temper and an axe. The steam is extra.
  barbarian: {
    caption: "Calm, for a barbarian.",
    base: "m",
    colors: { a: PALETTE.silver, h: "#c8552e" },
    art: grid(String.raw`
 ,_          _,  ||\
  \ \  ____  / / || \
   \ \/    \/ /  ||  |
    \_|====|_/   ||  |
     |\    /|    || /
  ~  |o    o|  ~ ||/
   ~(|  /\  |)~  ||
     | .--. |   {##}
     | |vv| |    ||
   __\\\''///__  ||
  /~~ \\\/// ~~ \||
 /~~~~ \\// ~~~~ \
|~~~~~~ \/ ~~~~~~  |
|  ~~          ~~  |
|__________________|
`),
    paint: [
      [0, 2, 0, 5, "n"], [0, 0, 13, 14, "n"], [1, 1, 13, 15, "n"], [2, 2, 12, 14, "n"], [3, 3, 7, 10, "b"],
      [4, 8, 4, 13, "s"], [4, 4, 6, 6, "h"], [4, 4, 11, 11, "h"], [5, 5, 6, 6, "e"], [5, 5, 11, 11, "e"], [6, 6, 8, 9, "S"],
      [7, 7, 7, 10, "r"], [8, 8, 7, 7, "r"], [8, 8, 10, 10, "r"], [8, 8, 8, 9, "W"],
      [5, 6, 0, 3, "D"], [5, 6, 14, 16, "D"],
      [9, 14, 0, 19, "l"], [0, 10, 17, 18, "w"], [0, 5, 19, 21, "a"], [7, 7, 16, 19, "S"],
      [9, 9, 5, 12, "h"], [10, 10, 6, 11, "h"], [11, 11, 7, 10, "h"], [12, 12, 8, 9, "h"],
    ],
  },
  // Sings for his supper. The critics are throwing theirs.
  bard: {
    caption: "The critics are in.",
    base: "c",
    colors: { c: "#3a9a6a", q: "#e05a8a", t: PALETTE.crimson },
    art: grid(String.raw`
           ,~~.
      ____/ ,'    ♪
     /_________\
    (___________)  ♫
      | ^   ^ |
      |   .   |   ♪
      |  (O)  |  @ --
       \_____/
     ____| |____
    /    '-'    \
   |   .--.      |
   |  / () \======o=
   |  \    /======o=
   |   '--'      |
   |_____________|
`),
    paint: [
      [0, 1, 11, 14, "q"],
      [4, 8, 6, 14, "s"], [4, 4, 8, 8, "e"], [4, 4, 12, 12, "e"], [6, 6, 9, 11, "r"],
      [1, 6, 16, 21, "y"], [6, 6, 17, 17, "R"], [6, 6, 19, 20, "D"],
      [9, 14, 3, 17, "t"], [9, 9, 9, 11, "s"],
      [10, 13, 6, 11, "w"], [11, 11, 8, 9, "k"], [11, 12, 12, 17, "b"], [11, 12, 18, 19, "w"],
    ],
  },
  // The halo is on a wire. Nobody has been told.
  cleric: {
    caption: "The halo is on a wire.",
    base: "s",
    colors: { c: "#e9e2d0", q: PALETTE.brass },
    art: grid(String.raw`
      .--------.
     (__________)
          |
       .-'|'-.
      /~~~~~~~\
     |  ^   ^  |
     |    L    |
      \ '---' /    _
       '-...-'    (#)
     ____| |____  {=}
    /    \ /    \  |
   |      ☼      | |
   |      |      | |
   |      |      | |
   |______|______| |
`),
    paint: [
      [0, 1, 0, 21, "g"], [2, 3, 10, 10, "D"],
      [4, 4, 6, 14, "h"], [5, 5, 8, 12, "e"], [6, 6, 10, 10, "S"], [7, 7, 8, 12, "r"],
      [9, 14, 3, 17, "c"], [9, 9, 9, 11, "s"], [11, 11, 10, 10, "g"], [12, 14, 10, 10, "q"],
      [7, 8, 18, 20, "M"], [9, 9, 18, 20, "S"], [10, 14, 19, 19, "w"],
    ],
  },
  // A druid of the old school: antlers, and a wren that has moved into the beard.
  druid: {
    caption: "The wren pays no rent.",
    base: "G",
    colors: { a: "#c8a878", B: "#a65a32", f: "#f0e070" },
    chars: { "*": "f" },
    art: grid(String.raw`
  \ | /        \ | /
   \|/          \|/
    \\  .----.  //
     \\/~~~~~~\//
      /~ ~~~~ ~\
     |  o    o  |
     |    ()    |
      \ ~~~~~~ /
       {*}{}*{}*}
       {}*{(o>}{
      {*}{{}}{*}{
   .--{}*{{}*{}*}--.
  /   {*}{{}}{*}{   \
 |     {}*{{}*}{     |
 |      {*}{}*}      |
`),
    paint: [
      [0, 3, 0, 21, "a"], [2, 2, 8, 13, "G"], [3, 3, 7, 14, "L"], [3, 3, 7, 7, "G"], [3, 3, 14, 14, "G"],
      [4, 7, 5, 16, "s"], [4, 4, 7, 14, "L"], [5, 5, 8, 13, "e"], [6, 6, 10, 11, "S"], [7, 7, 8, 13, "L"],
      [8, 14, 5, 17, "G"], [9, 9, 11, 12, "B"], [9, 9, 13, 13, "y"],
      [11, 14, 0, 5, "l"], [11, 14, 17, 21, "l"],
    ],
  },
  // An arrow in the helmet. The helmet won.
  fighter: {
    caption: "The helmet won.",
    base: "m",
    art: grid(String.raw`
        _____     /\
      .'  |  '.   ||
 >>--/____|____\  ||
     |  _   _  |  ||
     |  o   o  |  ||
     |    >    |  ||
     |   ---   |  ||
      \ ::::: /  o==o
   ____\_____/__ (##)
  /::::\     /::::\()
 |::::::\___/::::::|
 |:::::::::::::::::|
 |:::::|==o==|:::::|
 |:::::::::::::::::|
 |_________________|
`),
    paint: [
      [0, 9, 18, 19, "M"], [0, 0, 18, 19, "m"], [7, 7, 17, 20, "b"], [8, 8, 17, 20, "S"], [9, 9, 19, 20, "b"],
      [2, 2, 1, 4, "w"], [2, 2, 1, 2, "y"], [1, 2, 10, 10, "M"],
      [3, 7, 6, 14, "s"], [3, 3, 8, 8, "h"], [3, 3, 12, 12, "h"], [4, 4, 8, 8, "e"], [4, 4, 12, 12, "e"], [5, 5, 10, 10, "S"], [6, 6, 9, 11, "r"], [7, 7, 8, 12, "k"],
      [9, 14, 1, 19, "C"], [12, 12, 7, 11, "l"], [12, 12, 9, 9, "b"],
    ],
  },
  // Inner peace, and a cup of tea balanced on it.
  monk: {
    caption: "Not a drop spilled.",
    base: "F",
    colors: { Q: "#e4dcc0" },
    art: grid(String.raw`
          ) )
         ( (
        \____/o
       '------'
       .-''''-.
      /        \
     |  -    -  |
     |    L     |
      \  \__/  /
       '-.__.-'
    ____|    |____
   /    \ /\ /    \
  |      /||\      |
  |     (_||_)     |
  |________________|
`),
    paint: [
      [0, 1, 0, 21, "D"], [2, 3, 7, 14, "Q"],
      [4, 9, 5, 16, "s"], [6, 6, 8, 13, "e"], [7, 7, 10, 10, "S"], [8, 8, 9, 12, "r"],
      [10, 10, 8, 13, "s"], [11, 13, 8, 13, "s"], [11, 11, 8, 8, "F"], [11, 11, 13, 13, "F"],
    ],
  },
  // Polished until it hurts to look at.
  paladin: {
    caption: "Polished. Excessively.",
    base: "m",
    chars: { "+": "Y", "*": "y" },
    art: grid(String.raw`
  +      ,~~~,      *
        (,~~~,)
 *    .---' '---.
     /           \  +
    |  ====|====  |
    |      |      |
    |  ::  |  ::  |
  * |______|______| *
     \____________/
   .--'   |  |   '--.
  /  .----------.    \
 |  |  \  |  /  |    |
 |  |  -- ☼ --  |    |
 |   \  / | \  /     |
 |    '--.__.--'     |
`),
    paint: [
      [0, 1, 7, 13, "R"],
      [4, 4, 6, 14, "k"], [5, 6, 10, 10, "k"], [6, 6, 6, 7, "k"], [6, 6, 13, 14, "k"],
      [10, 14, 3, 15, "w"], [11, 13, 6, 14, "g"],
    ],
  },
  // Sees everything. The crow sees more, and is unimpressed.
  ranger: {
    caption: "The crow has doubts.",
    base: "G",
    colors: { K: "#4a4a5a", d: "#4a6a3a" },
    art: grid(String.raw`
        .----.    |\
       /      \   | )
      /  .--.  \  |  )
     /  /    \  \ |  )
     | | -  - | | |  )
     | |   >  | | |  )
     | |  --  | | |  )
      \ \____/ /  |  )
   ,_  \______/   |  )
  (o>__/      \__ |  )
  /)\  \      /  \|  )
   |    \    /    |  )
   |     \  /     | )
   |      \/      |/
   |______________|
`),
    paint: [
      [0, 14, 18, 21, "w"], [0, 14, 18, 18, "D"],
      [3, 7, 7, 12, "d"], [4, 4, 8, 13, "P"], [5, 5, 10, 10, "S"], [6, 6, 9, 10, "r"],
      [8, 10, 2, 4, "K"], [9, 9, 3, 3, "y"], [9, 9, 4, 4, "b"],
      [9, 14, 4, 17, "l"], [10, 13, 6, 13, "b"],
    ],
  },
  // Soft shoes, a smile, and a purse that was someone else's this morning.
  rogue: {
    caption: "Someone else's purse.",
    base: "k",
    colors: { k: "#6c6a7a" },
    art: grid(String.raw`
        _______
      .'       '.
     /  _______  \
    |  |=======|  |
    |  |(o) (-)|  |
    |  |   >   |  |
    |  | \_v_/ |  |
    |   \_____/   |
     \___________/  _
    __/  |   |  \_ ($)
   /      \_/     \\~/
  |  ==|=======>   |
  |                |
  |=======[]=======|
  |________________|
`),
    paint: [
      [3, 3, 7, 15, "r"], [4, 4, 7, 15, "s"], [4, 4, 8, 10, "e"], [4, 4, 12, 14, "e"],
      [5, 7, 7, 15, "s"], [6, 6, 9, 13, "r"], [6, 6, 11, 11, "g"],
      [8, 10, 17, 21, "o"], [9, 9, 19, 19, "g"],
      [9, 10, 8, 10, "s"], [11, 11, 5, 7, "w"], [11, 11, 8, 15, "m"], [13, 13, 3, 18, "l"], [13, 13, 10, 11, "b"],
    ],
  },
  // Gifted, in the sense that nobody asked for it. The hair has been on fire since Tuesday.
  sorcerer: {
    caption: "On fire since Tuesday.",
    base: "F",
    colors: { Q: "#4fd0a0" },
    art: grid(String.raw`
    (    )  (   (
   ) )  ( ) ) ) )  (
  ( ( ) )\( ( ( ( ) )
   \ \|/ \|/ \|/ \|/
    .------------.
   /  \\      //  \
  |   (O)    (O)   |
  | ≈            ≈ |
  |      .--.      |
   \     '--'     /
    '-.        .-'
 '.*  '-.____.-'  *.'
  \|/   _|  |_   \|/
   |\  /      \  /|
   | \/        \/ |
`),
    paint: [
      [0, 3, 0, 21, "f"], [0, 0, 0, 21, "y"], [1, 1, 0, 21, "F"], [3, 3, 0, 21, "F"],
      [4, 10, 2, 19, "s"], [5, 5, 6, 15, "k"], [6, 6, 6, 15, "E"], [7, 7, 4, 4, "Q"], [7, 7, 17, 17, "Q"], [8, 9, 9, 12, "r"],
      [11, 11, 0, 21, "y"], [11, 11, 6, 15, "s"], [12, 12, 2, 4, "s"], [12, 12, 17, 19, "s"],
      [12, 14, 5, 16, "v"], [13, 14, 3, 7, "v"], [13, 14, 14, 18, "v"],
    ],
  },
  // Signed in a hurry. There was small print.
  warlock: {
    caption: "Mind the small print.",
    base: "p",
    colors: { K: "#2a2433", P: "#9dff6b" },
    art: grid(String.raw`
          /\
         /  \
        / /\ \
       / /  \ \
      / / ●  ● \
     | |   ..   |
     | |  ~~~~  |
     | |________|
    /  \        /\
   /  .-\------/-.\
  |  | (o) |  ._ ||
  |  | ~~~ |  |~~||
  |  '-----'  |~~||
  |           |X_||
  |___________|__||
`),
    paint: [
      [4, 6, 8, 15, "K"], [4, 4, 10, 14, "P"], [5, 5, 11, 12, "k"], [6, 6, 10, 13, "k"],
      [9, 12, 5, 11, "w"], [10, 10, 7, 9, "P"], [11, 11, 7, 9, "k"],
      [10, 14, 13, 16, "n"], [13, 13, 14, 14, "r"], [11, 13, 14, 15, "k"],
    ],
  },
  // The hat was a gift. The wizard has grown into it as far as the nose.
  wizard: {
    caption: "The hat was a gift.",
    base: "u",
    chars: { "*": "y", "☼": "g", ".": "U" },
    art: grid(String.raw`
         .
        / \
       / * \      . .
      /  .  \    ' ♦ '
     / ☼     \    '|'
    /    .  * \    |
   /  *        \   |
  /_____________\  |
(___________________)
    \    _\    /   |
     \ ~~~~~~ /    |
     \\\\\|/////   |
      \\\\|////    |
       \\\|///     |
        \\|//      |
`),
    paint: [
      [7, 7, 3, 15, "p"], [2, 4, 17, 21, "U"], [4, 14, 19, 19, "w"],
      [9, 9, 4, 15, "s"], [10, 10, 5, 14, "s"], [10, 10, 7, 12, "W"], [11, 14, 5, 15, "W"],
    ],
  },
};

/** For a class without a portrait: someone, details to follow. */
const GENERIC: Portrait = {
  caption: "Details to follow.",
  base: "d",
  art: grid(String.raw`

         .--.
        /    \
       |  ??  |
        \    /
         '--'
      .-'    '-.
     /          \
    |            |
    |            |
    |            |
    |____________|
`),
};

/** The line under a class's portrait. */
export const portraitCaption = (classId: string | undefined): string => ((classId && PORTRAITS[classId]) || GENERIC).caption;

/** The class's portrait as styled lines, PORTRAIT_W wide and PORTRAIT_H tall (anyone else: a silhouette). */
export function portraitLines(classId: string | undefined): StyledLine[] {
  const p = (classId && PORTRAITS[classId]) || GENERIC;
  const inks = { ...INK, ...p.colors };
  const paint = [...(p.paint ?? [])].reverse();
  const keyAt = (x: number, y: number, ch: string) =>
    p.chars?.[ch] ?? paint.find(([top, bottom, left, right]) => y >= top && y <= bottom && x >= left && x <= right)?.[4] ?? p.base;
  const rows: StyledLine[] = [];
  for (let y = 0; y < PORTRAIT_H; y++) {
    const art = [...(p.art[y] ?? "")];
    const line: StyledLine = [];
    for (let x = 0; x < PORTRAIT_W; x++) {
      const ch = art[x] ?? " ";
      const fg = ch === " " ? undefined : inks[keyAt(x, y, ch)] ?? C.dim;
      const last = line.at(-1);
      if (last && last.fg === fg) last.text += ch;
      else line.push({ text: ch, ...(fg ? { fg } : {}) });
    }
    rows.push(line);
  }
  return rows;
}

export const PORTRAIT_CLASSES = ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"];
