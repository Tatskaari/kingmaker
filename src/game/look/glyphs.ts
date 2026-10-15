import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KINGMAKER_GLYPHS, type KingmakerGlyph } from "./kingmaker-glyphs.ts";

/**
 * Glyph sets. Four, from richest to safest:
 *
 * - "kingmaker": our own font, Kingmaker Glyphs (assets/fonts/, `npm run glyphs` builds and installs
 *   it), of pixel-art people and creatures at U+10E000 up, in Unicode's Supplementary Private Use
 *   Area-B, where no Nerd Font or other common font has anything. The terminal falls back to it for
 *   those characters, and each fills exactly one cell. Every named person and every creature it has a
 *   sprite for gets one (kingmaker.ts says which); everything else is "ascii".
 * - "ascii": CP437-flavoured Unicode, the default. Code page 437's pictographs (☻ ♣ ♠ ≈ ▲ ⌂ Θ δ ∩ ⌐
 *   ⌡ ¡ ° ∙ · ░▒▓ █ and the box drawing) plus a few friends (¤ ♔ ●). All single width, all in every
 *   terminal font worth having, none with an emoji presentation (emoji widths are a minefield).
 * - "nerd": Nerd Font icons (Material Design, the nf-md-* set at U+F0001-U+F1AF0) where an icon
 *   reads better than a letter: a bird, a mug, a tray, a door. Needs a Nerd Font, ideally the
 *   "Nerd Font Mono" variant (icons fit one cell), or a terminal that bundles the symbols (kitty,
 *   WezTerm). Anything without an icon falls back to "ascii".
 * - "plain": seven-bit ASCII only, for logs, dumb terminals and screen readers.
 *
 * The code points below were checked against Nerd Fonts' glyphnames.json (v3.5.1); the old
 * Material Design range (U+F500-U+FD46) was retired in v3 and isn't used.
 */

export type GlyphSet = "ascii" | "nerd" | "plain" | "kingmaker";
export const GLYPH_SETS: GlyphSet[] = ["ascii", "nerd", "plain", "kingmaker"];

export interface Glyph { ascii: string; nerd?: string; plain?: string; /** A Kingmaker Glyphs sprite (a character). */ km?: string }

/** A Kingmaker Glyphs sprite by name ("kell", "pigeon"), as a character. */
export const km = (name: KingmakerGlyph): string => String.fromCodePoint(KINGMAKER_GLYPHS[name][0]);

/** True for a Kingmaker Glyphs sprite (one cell wide, by construction). */
export const isKingmaker = (ch: string) => { const c = ch.codePointAt(0) ?? 0; return c >= 0x10e000 && c <= 0x10efff; };

/** Nerd Font icons by their nf-md-* names (without the prefix), as characters. */
const NERD_CODES: Record<string, number> = {
  account: 0xf0004, account_group: 0xf0849, anchor: 0xf0031, apple: 0xf0035, axe: 0xf08c8, barley: 0xf0073, barrel: 0xf0074, basket: 0xf0076,
  bat: 0xf0b5f, bed: 0xf02e3, bee: 0xf0fa1, beer: 0xf0098, bell: 0xf009a, bird: 0xf15c6, bomb: 0xf0691, bone: 0xf00b9, book: 0xf00ba,
  book_open_variant: 0xf14f7, bottle_tonic: 0xf112e, bottle_tonic_skull: 0xf1132, bottle_wine: 0xf0854, bow_arrow: 0xf1841, bowl: 0xf028e,
  bread_slice: 0xf0cee, bridge: 0xf0618, broom: 0xf00e2, bucket: 0xf1415, bug: 0xf00e4, butterfly: 0xf1589, campfire: 0xf0edd, candelabra_fire: 0xf17d3,
  candle: 0xf05e2, cards_playing: 0xf18a1, castle: 0xf011a, cat: 0xf011b, cheese: 0xf12b9, church: 0xf0144, clock: 0xf0954, cloud: 0xf015f,
  coffin: 0xf0b7f, corn: 0xf07b8, cow: 0xf019a, cross: 0xf0953, crown: 0xf01a5, cup: 0xf01aa, cupcake: 0xf095a, desk: 0xf1239, diamond_stone: 0xf01c8,
  dice_5: 0xf01ce, dog_side: 0xf0a44, door_closed: 0xf081b, door_closed_lock: 0xf10af, door_open: 0xf081c, dresser: 0xf0f4a, duck: 0xf01e5,
  egg: 0xf0aaf, email: 0xf01ee, emoticon_dead: 0xf0c6e, exclamation_thick: 0xf1238, eye: 0xf0208, feather: 0xf06d3, fence: 0xf179a, fire: 0xf0238,
  fireplace: 0xf0e2e, fireplace_off: 0xf0e2f, fish: 0xf023a, flag: 0xf023b, flask_round_bottom: 0xf124b, flower: 0xf024a, flower_tulip: 0xf09f1,
  food_apple: 0xf025b, food_drumstick: 0xf141f, gate: 0xf0299, ghost: 0xf02a0, glass_mug_variant: 0xf1116, glass_wine: 0xf0876, glasses: 0xf02aa,
  gold: 0xf124f, grass: 0xf1510, grave_stone: 0xf0ba2, hammer: 0xf08ea, hand_saw: 0xf0e48, hanger: 0xf02c8, hat_fedora: 0xf0ba4, heart: 0xf02d1,
  horse_variant: 0xf15c1, human: 0xf02e6, human_child: 0xf02e7, kettle: 0xf05fa, key: 0xf0306, knife: 0xf09fb, ladder: 0xf15a2, lamp: 0xf06b5,
  leaf: 0xf032a, link_variant: 0xf0339, liquor: 0xf191e, lock: 0xf033e, mace: 0xf1843, magic_staff: 0xf1844, map: 0xf034d, mirror: 0xf11fd,
  mushroom: 0xf07df, music_note: 0xf0387, necklace: 0xf0f0b, needle: 0xf0391, newspaper: 0xf0395, oil_lamp: 0xf0f19, owl: 0xf03d2, package_variant_closed: 0xf03d7,
  pail: 0xf1417, paw: 0xf03e9, pickaxe: 0xf08b7, pig: 0xf0401, pine_tree: 0xf0405, pot: 0xf02e5, pot_steam: 0xf065a, purse: 0xf0f1c, rabbit: 0xf0907,
  ring: 0xf07eb, rodent: 0xf1327, sack: 0xf0d2e, sail_boat: 0xf0ec8, scale_balance: 0xf05d1, script_text: 0xf0bc2, seat: 0xf0cc3, sheep: 0xf0cc6,
  shield: 0xf0498, shoe_formal: 0xf0b47, shovel: 0xf0710, sign_text: 0xf0782, skull: 0xf068c, skull_crossbones: 0xf0bc6, smoke: 0xf1799, snail: 0xf1677,
  snake: 0xf150e, snowflake: 0xf0717, sofa_single: 0xf156e, spear: 0xf1845, spider: 0xf11ea, spider_web: 0xf0bca, sprout: 0xf0e66, stairs: 0xf04cd,
  sword: 0xf04e5, table_furniture: 0xf05bc, tea: 0xf0d9e, tent: 0xf0508, timer_sand: 0xf051f, torch: 0xf1606, tray: 0xf1294, tray_full: 0xf1296,
  treasure_chest: 0xf0726, tree: 0xf0531, trumpet: 0xf1096, turtle: 0xf0cd7, violin: 0xf060f, wardrobe: 0xf0f90, water: 0xf058c, water_pump: 0xf058f,
  water_well: 0xf106b, waves: 0xf078d, window_closed_variant: 0xf11db, window_open_variant: 0xf11dc, wizard_hat: 0xf1477,
};

/** The icon for an nf-md name ("bird", "glass_mug_variant"), or undefined. */
export function nerd(name: string): string | undefined {
  const code = NERD_CODES[name];
  return code === undefined ? undefined : String.fromCodePoint(code);
}
export const NERD_NAMES = Object.keys(NERD_CODES);

/** Every non-ASCII glyph the look layer draws, and its seven-bit stand-in. */
const PLAIN: Record<string, string> = {
  "☻": "p", "☺": "c", "♔": "R", "@": "@", "♣": "T", "♠": "t", "≈": "~", "∽": "~", "▲": "^", "▴": "^", "⌂": "=", "Θ": "0", "θ": "o", "δ": "s",
  "∩": "n", "⌐": "-", "⌡": "j", "¡": "i", "°": "o", "∙": ".", "·": ".", "•": "*", "●": "O", "○": "o", "◘": "#", "◙": "0", "░": ".", "▒": ":",
  "▓": "#", "█": "#", "▀": "\"", "▄": "_", "▌": "|", "▐": "|", "■": "#", "▪": "=", "▫": ".", "□": "o", "▬": "=", "▯": "|", "¤": "*", "¥": "Y",
  "Ω": "&", "π": "T", "╥": "h", "╤": "T", "═": "=", "─": "-", "│": "|", "║": "|", "╫": "H", "╪": "+", "┼": "+", "╦": "T", "╩": "^", "╨": "^",
  "≡": "=", "§": "&", "∞": "8", "ö": "o", "Ö": "O", "ü": "u", "Ü": "U", "ô": "o", "ⁿ": "n", "♪": "d", "♫": "d", "ƒ": "f", "α": "f", "∴": ":",
  "%": "%", "÷": "/", "¬": "-", "↑": "^", "↓": "v", "←": "<", "→": ">", "♦": "*", "♥": "v", "☼": "*", "Φ": "0", "ø": "o",
  "▼": "v", "▾": "|", "╲": "\\", "╱": "/", "ʌ": "^", "∵": ":", "˛": ",", "‚": ",", "‘": "'", "’": "'", "`": "'", "¨": "\"", "¸": ",",
  "†": "+", "‡": "+", "♀": "o", "♂": "o", "ı": "i", "í": "i", "Ш": "W", "▣": "#", "╳": "x", "×": "x", "✦": "*", "✧": "*", "∗": "*",
  "╬": "+", "╎": ":", "◄": "<", "►": ">", "▁": "_", "æ": "=", "ò": "o", "◊": "o",
  // The map's own: roofs, steps, ledges, the lead and its arrows, decor glyphs (signs, books, hatches, cupboards, trays, coins).
  "▚": "#", "▞": "#", "▂": "_", "▃": "_", "▔": "-", "╌": "-", "╷": "|", "▙": "#", "‿": "_", "▽": "v", "▿": "v", "▸": ">",
  "↘": "\\", "↙": "/", "↖": "\\", "↗": "/", "ɞ": "g", "Å": "A", "Π": "n", "Ψ": "Y", "┃": "|", "━": "-",
  "▤": "=", "▦": "#", "▥": "#", "ū": "u", "¢": "c",
  // The GM's typography, a cell at a time (plainText does whole lines better: "…" is three dots).
  "“": "\"", "”": "\"", "—": "-", "–": "-", "…": ".",
};

/** A line of text in seven bits (barks): the GM's dashes, ellipses and curly quotes made plain, the rest by plainOf. */
export function plainText(text: string): string {
  return [...text.replace(/…/g, "...")].map(plainOf).join("");
}

/** The seven-bit stand-in for a glyph (Nerd icons have no plain form of their own: callers pass one). */
export function plainOf(ch: string): string {
  if (ch.length === 1 && ch.charCodeAt(0) < 128) return ch;
  return PLAIN[ch] ?? "?";
}

/** A glyph in a set, falling back kingmaker or nerd -> ascii -> plain. */
export function glyphFor(g: Glyph, set: GlyphSet): string {
  if (set === "nerd" && g.nerd) return g.nerd;
  if (set === "kingmaker" && g.km) return g.km;
  if (set === "plain") return g.plain ?? plainOf(g.ascii);
  return g.ascii;
}

/** Translate a glyph already chosen in the ascii set to another set (terrain, particles; a crowd's faces). */
export function inSet(ascii: string, set: GlyphSet): string {
  if (set === "kingmaker") return ascii === "☻" ? km("man") : ascii === "☺" ? km("child") : ascii;
  return set === "plain" ? plainOf(ascii) : ascii;
}

/** True for a Nerd Font private-use icon (they may draw wider than a cell in non-Mono fonts). */
export const isNerdIcon = (ch: string) => { const c = ch.codePointAt(0) ?? 0; return (c >= 0xe000 && c <= 0xf8ff) || (c >= 0xf0000 && c <= 0xfffff); };

/** Is the Kingmaker Glyphs font installed for this user (where npm run glyphs puts it)? */
export const kingmakerFontHere = () => existsSync(join(homedir(), ".local", "share", "fonts", "kingmaker", "KingmakerGlyphs-Regular.ttf"));

let chosen: GlyphSet | undefined;
/** The glyph set this process draws with (KM_GLYPHS, or the environment's best guess), decided once. */
export const glyphSet = (): GlyphSet => (chosen ??= detectGlyphSet().set);
/** Draw with another set from now on, everywhere in this process (the zoo's lever); undefined goes back to KM_GLYPHS's. */
export function setGlyphSet(set: GlyphSet | undefined): void { chosen = set; }

/**
 * Which glyph set to use. There is no terminal query that says whether a font has a glyph, so this
 * is configuration first (KM_GLYPHS=ascii|nerd|plain|kingmaker), then a guess from the environment:
 * seven-bit for dumb terminals and non-UTF-8 locales; "ascii" otherwise, with a note when the
 * terminal is known to bundle the Nerd Font symbols (kitty, WezTerm), so the player can opt in.
 * The kingmaker set when its font is installed here (npm run glyphs) and the terminal is local:
 * over SSH the terminal is somewhere else, and so are its fonts.
 */
export function detectGlyphSet(env: Record<string, string | undefined> = process.env, sprites = env === process.env && kingmakerFontHere()): { set: GlyphSet; reason: string; nerdLikely: boolean } {
  const asked = env.KM_GLYPHS?.toLowerCase();
  const nerdLikely = !!env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty" || env.TERM_PROGRAM === "WezTerm" || !!env.WEZTERM_EXECUTABLE;
  if (asked === "ascii" || asked === "nerd" || asked === "plain" || asked === "kingmaker") return { set: asked, reason: "KM_GLYPHS", nerdLikely };
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  if (env.TERM === "dumb" || env.TERM === "linux" || (locale && !/utf-?8/i.test(locale))) return { set: "plain", reason: `no Unicode here (TERM=${env.TERM ?? ""}, locale ${locale || "unset"})`, nerdLikely: false };
  if (sprites && !env.SSH_CONNECTION && !env.SSH_TTY) return { set: "kingmaker", reason: "Kingmaker Glyphs is installed (KM_GLYPHS=ascii for letters)", nerdLikely };
  return { set: "ascii", reason: nerdLikely ? "this terminal bundles Nerd Font symbols: KM_GLYPHS=nerd turns them on" : "the default (KM_GLYPHS=kingmaker with Kingmaker Glyphs installed for sprites, or nerd with a Nerd Font for icons)", nerdLikely };
}
