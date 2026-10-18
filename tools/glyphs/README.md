# Kingmaker Glyphs: our own font of pixel-art people and creatures

Part of the [architecture overview](../../ARCHITECTURE.md); the look layer that draws with these is the client's, [client/look](../../client/look/).

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

Each sprite sits in one cell. The font has Adwaita Mono's metrics: units per em 1000, every advance
600, typo ascender 965 and descender -285 with USE_TYPO_METRICS, and the hhea and win values too.
Every sprite's ink stays inside them, so nothing is clipped and nothing overhangs. There's a Bold
face with the same outlines. The game draws beings bold, and without a Bold face fontconfig would
embolden the Regular one synthetically and smear the pixels.

## Files

| file | what it is |
|---|---|
| `assets/glyphs/kingmaker.txt` | The bitmaps, drawn by hand: a header per glyph (name, code point, what it is), then 18 rows of 9, `#` ink and `.` blank. |
| `tools/glyphs/build.py` | Bitmaps to fonts: traces each glyph's ink into clean outlines and builds Regular and Bold TrueType fonts. Writes `client/look/kingmaker-glyphs.ts` (names, code points, pixels). |
| `web/fonts/KingmakerGlyphs-{Regular,Bold}.ttf` | The built fonts, committed so the game doesn't need Python; the page serves them. |
| `tools/glyphs/sheet.py` | Contact sheets in `runs/glyphs/`: the bitmaps big; the font at the real cell size and 3x, with names in Adwaita Mono beside them; and text through Pango with GTK 4's font rendering, as VTE draws it. |
| `tools/glyphs/vte.py` | Every sprite drawn by a real VTE terminal (the widget Ptyxis is built on) in a private headless compositor, and checked pixel by pixel against the bitmaps. |
| `tools/glyphs/frame.py` | Draws `dump.ts --json` frames as the terminal would (Pango, fallback and all), as PNGs. The dump was the prototype's (`src/game/look/dump.ts`, in git history at `bc2ab1f`): the game has none yet. |
| `client/look/kingmaker.ts` | The glyph set's rules: which sprite a being gets, and how it lies down. |

## Use it

```sh
npm run glyphs              # build the fonts and install them (~/.local/share/fonts/kingmaker), then fc-cache -f
npm run client              # (a stack running: npm run dev) draws with them once they're installed here (KM_GLYPHS=ascii for letters)
KM_GLYPHS=kingmaker npm run client   # over SSH, with the font installed where your terminal is
npm run glyphs:uninstall    # remove the installed fonts (and fc-cache -f)
```

The game draws them wherever it draws a being: on the map
(the map renderer draws its actors through the look layer's `actorLook`), on a scene's place from
above, and in fights. With the font installed in `~/.local/share/fonts/kingmaker` and the terminal
local, the game picks the set by itself (`detectGlyphSet` in `client/look/glyphs.ts`, asked by `hosts/terminal.ts`). Over SSH it
can't tell what fonts your terminal has, so it draws letters unless `KM_GLYPHS=kingmaker` says
otherwise.

The browser needs no install: the page's build serves the two fonts in `web/fonts/` with the page
(`fonts.css`, made by `web/fonts/fonts.ts`), and the page draws with them by default.

Building needs fontTools (`pip install fonttools`, or the `python3-fonttools` package). Installing
doesn't: without fontTools, `npm run glyphs` installs the committed fonts as they are, and says so.
The font must be installed on the machine whose terminal draws the game, so install it locally even
when the game runs over SSH. Without the repository there, copy the two files in `web/fonts/` to
`~/.local/share/fonts/` and run `fc-cache -f`. To check that fontconfig will use it:

```sh
fc-list ':family=Kingmaker Glyphs'                      # both faces installed
fc-match -f '%{family}\n' 'Adwaita Mono:charset=10e000' # -> Kingmaker Glyphs: the fallback for the sprites
fc-match -f '%{family} %{style}\n' 'Adwaita Mono:bold:charset=10e000'   # -> Kingmaker Glyphs Bold
npm run glyphs:vte                                      # a real VTE draws every sprite: 0 soft, 0 misplaced
```

Other terminals: anything that falls back through fontconfig works the same way (GNOME's VTE
terminals, kitty, WezTerm, Alacritty, foot, Konsole). kitty draws a private-use glyph across two cells
when a space follows it and the glyph is wider than a cell; ours never are, since their ink stops a
pixel short of the advance. With a terminal font whose advance isn't 0.6 em (Iosevka and Ubuntu Mono
are 0.5) the sprites sit a little wide or narrow in its cells; a build with that font's metrics fixes
it (the metrics are constants at the top of `build.py`; `--metrics` compares them with Adwaita Mono's).

## Draw a glyph

1. Add it to `assets/glyphs/kingmaker.txt`: a header line, then 18 rows of 9, the last column
   blank. Give it the next free code point in its block (the cast from U+10E000, townsfolk from
   U+10E040, creatures from U+10E080, animation frames from U+10E0C0). Never renumber a glyph that has
   shipped.
2. `npm run glyphs` builds, installs and regenerates `kingmaker-glyphs.ts`. `npm run glyphs:sheet`
   draws the sheets: look at `runs/glyphs/pango-3x.png`, the real rendering three times up, and
   `npm run glyphs:vte` has a real terminal draw them.
3. For it to appear in the game, map words to it in `client/look/kingmaker.ts` (`PEOPLE`,
   `CREATURES`, or `ROLES` by role id), or give a cast member it as their `km` in the cast table
   (`CAST` in `client/look/cast.ts`, which `client/look/people.ts` reads).
4. The prototype's tests checked that the fonts and the code were rebuilt from the bitmaps as they
   are, and that OpenTUI measures every sprite as one cell (`src/game/look/kingmaker.test.ts`, in git
   history at `bc2ab1f`); the game hasn't those tests yet, so check by eye on the sheets and with
   `npm run screens`.

Tips for a readable sprite. Each design pixel is one screen pixel at Adwaita Mono 11, so a pixel
shows. A sprite reads by its outline, because it's all one colour: give each one a shape of its own
(a raised fist, a sack on the shoulder, a lantern held out, a coat flaring to the knee), and keep a
gap of a pixel between an arm or a prop and the body. Size carries meaning too: adults are about 16
rows tall, children 10 or 11, Big Hobb fills the cell. Leave the last column blank: it's the gap that
keeps a crowd of sprites from merging into one shape.

## The grid and the metrics

A design pixel is exactly one screen pixel at the size the game is drawn: Adwaita Mono 11 at 96 dpi
has a 14.67-pixel em, so a pixel is 1000 / 14.67 = 68.18 units. The grid is anchored to the
baseline, 14 rows above it (row 0's top at 955 units, under the 965 ascender) and 4 below (row 17's
bottom at -273, above the -285 descender). VTE lays that size out in 9 x 20 cells with the baseline
15 pixels down, so every row and column of a sprite lands on whole screen pixels, rows 1 to 18 of the
cell. That matters because GTK 4 draws text without hinting: it doesn't snap outlines to pixels, so
a grid stretched to fill the cell instead (66.7 x 69.4 units a pixel) is drawn with ghost rows and
soft right-hand columns. Adwaita Mono's advance is 8.8 pixels, so 8 columns of ink fit inside it;
the ninth pixel of the cell is the blank column.

`npm run glyphs:vte` checks it the strict way: a real VTE (GTK 4, the library Ptyxis uses) draws
every sprite at 11 and 22 point, and every pixel of each is compared with its bitmap. At other sizes
the sprites scale like any font: soft at 10 or 12 point, sharp again at whole multiples (22, 33).
