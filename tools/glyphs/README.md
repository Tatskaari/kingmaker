# Kingmaker Glyphs: our own font of pixel-art people and creatures

The game draws its world in a terminal, and a terminal draws characters from a font, so custom art
for the cast and the monsters means a custom font.

## How a terminal can show glyphs its font doesn't have

A terminal can't switch fonts per cell on request: the grid is drawn in one font (Adwaita Mono, by
default, in Ptyxis). But every modern terminal falls back per character. When its font has no glyph
for a character, it asks the system (fontconfig, on Linux) for an installed font that does, and
draws that one character from it, at the cell's size. That's how emoji and Chinese show up in a
Latin monospace font. "ASCII art" in a modern terminal is really Unicode art, drawn by whichever
installed font has each character.

So Kingmaker Glyphs puts its sprites at code points no other font uses: Unicode's Supplementary
Private Use Area-B, from **U+10E000**. Nerd Fonts don't use it (v2 or v3: their Material Design icons
are at U+F0001-U+F1AF0, everything else in the BMP's U+E000-U+F8FF). Neither do Font Awesome,
Material Icons or any font on a stock Fedora desktop: the BMP Private Use Area is crowded there, with
Inter, Adwaita Sans, OpenSymbol, STIX and others. Apple's SF Symbols sit at the start of plane 16,
well below U+10E000. Once the font is installed, the game prints a sprite like any other character,
in any colour, and the terminal finds it here.

Each glyph fills exactly one cell. The font has Adwaita Mono's metrics: units per em 1000, every
advance 600, typo ascender 965 and descender -285 with USE_TYPO_METRICS, and the hhea and win values
too. The full block spans 600 x 1250 units, so the terminal draws a sprite at the cell's size, with
nothing clipped and nothing overhanging. There's a Bold face with the same outlines. The game draws
beings bold, and without a Bold face fontconfig would embolden the Regular one synthetically and
smear the pixels.

## Files

| file | what it is |
|---|---|
| `assets/glyphs/kingmaker.txt` | The bitmaps, drawn by hand: a header per glyph (name, code point, what it is), then 18 rows of 9, `#` ink and `.` blank. |
| `tools/glyphs/build.py` | Bitmaps to fonts: traces each glyph's ink into clean outlines and builds Regular and Bold TrueType fonts. Writes `src/game/look/kingmaker-glyphs.ts` (names, code points, pixels). |
| `assets/fonts/KingmakerGlyphs-{Regular,Bold}.ttf` | The built fonts, committed so the game doesn't need Python. |
| `tools/glyphs/sheet.py` | Contact sheets in `runs/glyphs/`: the bitmaps big; the font at the real cell size and 3x, with names in Adwaita Mono beside them; and text through Pango, as VTE draws it. |
| `tools/glyphs/frame.py` | Draws `dump.ts --json` frames as the terminal would (Pango, fallback and all), as PNGs. |
| `src/game/look/kingmaker.ts` | The glyph set's rules: which sprite a being gets. |
| `src/game/look/kingmaker-check.tsx` | Draws sprites on the map and in the gallery through OpenTUI's headless renderer, and checks every row lines up. |

## Use it

```sh
npm run glyphs              # build the fonts and install them (~/.local/share/fonts/kingmaker), then fc-cache -f
KM_GLYPHS=kingmaker npm run game
node --experimental-ffi --no-warnings --import tsx src/game/look/gallery.tsx sprites --glyphs kingmaker
npm run glyphs:uninstall    # remove the installed fonts (and fc-cache -f)
```

The font must be installed on the machine whose terminal draws the game, so install it locally even
when the game runs over SSH. To check that fontconfig will use it:

```sh
fc-list ':family=Kingmaker Glyphs'                      # both faces installed
fc-match -f '%{family}\n' 'Adwaita Mono:charset=10e000' # -> Kingmaker Glyphs: the fallback for the sprites
fc-match -f '%{family} %{style}\n' 'Adwaita Mono:bold:charset=10e000'   # -> Kingmaker Glyphs Bold
```

Other terminals: anything that falls back through fontconfig works the same way (GNOME's VTE
terminals, kitty, WezTerm, Alacritty, foot, Konsole). kitty draws a private-use glyph across two cells
when a space follows it and the glyph is wider than a cell. Ours are exactly one cell wide for any
monospace font with a 0.6 em advance, which covers most of them. With a narrower font (Iosevka is 0.5
em, Ubuntu Mono 0.5) the sprites draw a little wide; a build with that font's metrics fixes it (the
metrics are constants at the top of `build.py`; `--metrics` compares them with Adwaita Mono's).

## Draw a glyph

1. Add it to `assets/glyphs/kingmaker.txt`: a header line, then 18 rows of 9. Give it the next free
   code point in its block (the cast from U+10E000, townsfolk from U+10E040, creatures from U+10E080,
   animation frames from U+10E0C0). Never renumber a glyph that has shipped.
2. `npm run glyphs` builds, installs and regenerates `kingmaker-glyphs.ts`. `npm run glyphs:sheet`
   draws the sheets: look at `runs/glyphs/pango-3x.png`, the real rendering three times up.
3. For it to appear in the game, map words to it in `src/game/look/kingmaker.ts` (`WORDS`, or `ROLES`
   by role id), or give a cast member it as their `km` in `people.ts` and `src/game/map/looks.ts`.
4. `node --no-warnings --test src/game/look/*.test.ts` checks the fonts and the code were rebuilt from
   the bitmaps as they are, and that OpenTUI measures every sprite as one cell.

Tips for a readable sprite. Each design pixel is one screen pixel at Adwaita Mono 11 (a 9 x 20 cell,
glyphs 8.8 x 18.3 pixels), so a pixel shows. A sprite reads by its outline, because it's all one
colour: give each one a shape of its own (a raised fist, a sack on the shoulder, a lantern held
out), and keep a gap of a pixel between an arm or a prop and the body. Size carries meaning too:
adults are about 16 rows tall, children 10 or 11, Big Hobb fills the cell.

## The grid and the metrics

The grid is 9 x 18 pixels at 66.7 x 69.4 units, near-square. It's the cell's aspect (600 x 1250
units) at the size the user's terminal draws it: Ptyxis with Adwaita Mono 11 at 96 dpi gives a
14.67-pixel em, so glyphs are 8.8 x 18.3 pixels in a 9 x 20 cell (as VTE measures it). One design
pixel per screen pixel is the only scale at which pixel art stays crisp. Slight hinting snaps each row to
a pixel; finer grids blur. At other sizes the outlines scale like any font: soft at fractional
scales, sharp at 2x.
