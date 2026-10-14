# Art direction for the terminal world view

What the best ASCII and tile roguelikes do with a cell, a colour and a moment of time, what the terminal lets us do, and the decisions for Kingmaker's world view. The code is in `src/game/look/` (see its README for the API); the gallery shows the result:

```
node --experimental-ffi --no-warnings --import tsx src/game/look/gallery.tsx
```

**The brief.** The game's world is an entity tree that the rules and the stage manager change as the story goes: a Fireball burns tables, oil slicks catch, a bucket of water leaves a table scorched and standing in a puddle, and the GM invents things ("a flock of pigeons", "a burning branch", "ale") that need a look on the spot. The user chose ASCII so the AI can put anything in the world without art assets, and wants what happens in the story shown well: "If something's on fire, it should be red and probably animated. Water and grass should probably have some life too. I really like how Caves of Qud works."

## Decisions, in short

1. **A cell is a glyph, a foreground and a background; meaning lives in all three.** This is Qud's tile model in character form. Things get a glyph by shape and a colour by material; the background carries ground, light, stains, glow and smoke.
2. **A small named palette, truecolor in between.** Base looks choose from about 50 named colours (Qud keeps 18). Light, flames and water make the in-between shades, the way Qud's tiles mix their primary and detail colours. The model picks names, never hex values.
3. **Colour carries meaning, consistently.** This follows Brogue and Cogmind:
   - fire is red, orange and yellow, and it always moves;
   - water is blue and it shimmers;
   - magic is violet and poison is green;
   - metal is grey and things lie in muted material colours;
   - people are bright and bold. Damage numbers are coloured by damage type.
4. **Motion means life or danger.** Still things never animate. Fire flickers, water runs, grass and leaves sway in travelling gusts, birds flap, smoke drifts and embers rise. Everything is a pure function of (cell, time, seed), so there's no per-cell state and every frame is exact.
5. **Light is coloured and physical, Brogue-style.**
   - Ambient light comes from the time of day, separately for indoors and outdoors.
   - Each source adds coloured light with a soft falloff, and walls cast shadows.
   - Emissive cells (flames, lamps, sparks) aren't darkened.
   - Glints on water take the colour of the light on them.
   - People and room outlines have a light floor, so they stay findable in the dark.
   - The blue driftwood fire lights the Rat blue.
6. **Effects are brief (Cogmind) and analytic.**
   - A bolt takes 150 to 400 ms, a fireball about 1 s plus smoke, an explosion about 1.2 s with shake, and floating numbers about 1.3 s.
   - Barks last 2 to 6 s, depending on length.
   - Particles are formulas of time, not a simulation, so any instant can be drawn.
7. **The world drives the picture.** The director diffs the world between turns and animates what changed:
   - people walk instead of teleporting;
   - things that catch fire spark and flash;
   - douses splash and steam, and wrecks throw debris;
   - the rules' damage lines float as numbers.
   Surfaces are drawn straight from the physics' own surface entities (`src/world/systems.ts`).
8. **Rules first, the model only for the unknown.** About 200 rules read a name's head noun, its adjectives (states: burning, singed, wet; colours: blue, silver), and constructions like "a flock of", "a pool of" and "a bucket of". Names nothing recognises get a guess at once, and a Luna call (no reasoning) picks a glyph from a curated menu, by name. The answer is cached on disk by the name's key: one call per kind of thing, batched, never per frame.
9. **Three glyph sets.**
   - `ascii`, the default, is CP437-flavoured Unicode.
   - `nerd` uses Nerd Font icons where an icon reads better than a letter. It's opt-in with `KM_GLYPHS=nerd`; the Nerd Font Mono variant works best, and kitty and WezTerm bundle the symbols.
   - `plain` is seven-bit ASCII, guaranteed by a test.
   People keep their letters in every set.
10. **About 30 fps through OpenTUI.** OpenTUI defaults to 30 fps, diffs cells natively and wraps frames in synchronized output (DEC 2026). The world view is a "live" renderable that paints cells directly, with no React re-render per frame. A 130×38 frame costs 2 to 7 ms.

## Caves of Qud

- **The tile model.**
  - Every object has a glyph, a foreground colour, a background colour and a *detail* colour.
  - Its tiles are 16×24 pixels with at most three of the game's 18 fixed colours: primary, detail and background. Black pixels take the foreground (TileColor) and white pixels take the detail colour. Transparent pixels show the background, "Qud viridian" (`k`, #0f3b3a).
  - "Some tiles use colors outside of the fixed palette. These colors are always some mixture of the primary and detail colors of the tile." Zones are 80×25.
  - ([Visual Style](https://wiki.cavesofqud.com/wiki/Visual_Style), [Modding:Tiles](https://wiki.cavesofqud.com/wiki/Modding:Tiles))
- **Colour codes.** There are 18 colour codes, used as `&x` for foreground and `^x` for background:

  | code | name | hex |
  |---|---|---|
  | k | (viridian) | #0f3b3a |
  | K | dark grey | #155352 |
  | r | dark red | #a64a2e |
  | R | red | #d74200 |
  | o | dark orange | #f15f22 |
  | O | orange | #e99f10 |
  | w | brown | #98875f |
  | W | gold | #cfc041 |
  | g | dark green | #009403 |
  | G | green | #00c420 |
  | b | dark blue | #0048bd |
  | B | blue | #0096ff |
  | c | dark cyan | #40a4b9 |
  | C | cyan | #77bfcf |
  | m | dark magenta | #b154cf |
  | M | magenta | #da5bd6 |
  | y | grey | #b1c9c3 |
  | Y | white | #ffffff |

  A `ColorString` is foreground plus background, `TileColor` the same for tiles, and `DetailColor` a single colour. Markup "shaders" (`{{fiery|...}}`) colour text by sequence, alternation, border or distribution. `fiery` is a red sequence and `glittering` is K-K-y-M-y-K-K. ([Modding:Colors & Object Rendering](https://wiki.cavesofqud.com/wiki/Modding:Colors_%26_Object_Rendering)) We keep the 18 colours as `QUD` in `color.ts`, for reference and for Qud-style codes.
- **Animation.** An `AnimatedMaterialGeneric` part swaps tiles, colours or glyphs on a tick schedule. The fan, for example, uses `AnimationLength="20"` and `TileAnimationFrames="0=…,5=…,10=…,15=…"`, plus low and high frame offsets. Our flickers likewise take a per-object seed, so neighbours never pulse in step. ([Modding:Tiles](https://wiki.cavesofqud.com/wiki/Modding:Tiles))
- **Particles and floating text.**
  - Qud's options include "Display ASCII visual effects" ("particle effects that use text characters on the play area") and "Display floating damage numbers" ("numbers (and sometimes text) that appear above an object when it takes damage").
  - "Display combat animations" means tiles sliding for bumps.
  - There are also a vignette and scanlines.
  - In code, `ParticleText("&r" + …, 2.9f, 1)` floats coloured text for a few seconds.
  - ([Options](https://wiki.cavesofqud.com/wiki/Options), [Modding:Mutations](https://wiki.cavesofqud.com/wiki/Modding:Mutations))
  - We have the same: damage numbers rise and fade, "!" bobs over someone who has noticed something, and barks sit over speakers. We also have the slide, as the director's tweens.
- **What to take from Qud.**
  - Discipline: a fixed palette, every object designed as glyph plus two colours, and a strong background colour that isn't black.
  - Motion used sparingly.
  - Floating text as feedback rather than log spam.

## Brogue CE

- **Colours that dance.** Brogue's `color` has base RGB and random components ("random RGB components to add to base components", "random scalar to add to all components"). It also has a `colorDances` flag: "this color 'dances' with every refresh".
  - Fire is `{70, 20, 0, 15, 10, 0, 0, true}`, on a 0 to 100 scale.
  - Deep water is `{5, 8, 20, 0, 4, 15, 10, true}`.
  - Grass is `{15, 40, 15, 15, 50, 15, 10, false}`: random but static.
  - The torch light colour dances too.
  - ([Rogue.h](https://github.com/tmewett/BrogueCE/blob/master/src/brogue/Rogue.h), [Globals.c](https://github.com/tmewett/BrogueCE/blob/master/src/brogue/Globals.c))
  - Our version: fire, water and lights dance, by noise in time with a seed per object; grass, cobbles and boards get static per-cell variety.
- **Light.** A `lightSource` has a colour, a radius range, a "radial fade to percent", and whether it passes creatures ("the miner's light does"). Light is coloured and additive; a cell's colours are multiplied by its light.
  - We do the same: a `LightField` with ambient light by time of day and indoor or outdoor, coloured sources and a soft falloff.
  - Walls cast shadows, through a cached ray mask per light position.
  - Light brighter than daylight pushes colours towards the light's own colour, so a fire's glow looks warm rather than just bright.
- **Gas.** A gas tints the cell by concentration: `gasAugmentWeight = min(90, 30 + volume)`, then `applyColorAverage`. ([IO.c](https://github.com/tmewett/BrogueCE/blob/master/src/brogue/IO.c))
  - Our smoke, steam and dust veil a cell's colours by density instead of hiding it. Only the thick part of a cloud draws its own `░▒` wisps.
  - An opaque block of steam reads as a wall; we tried it.
- **Colour carries meaning.** Brogue colours magic detected on items blue when benevolent and red when malevolent, and colours everything else by what it is. Our flames tell you what's burning: wood and oil burn orange, and spirits (and the salt-soaked driftwood) burn blue.

## Cogmind

- **Particles are procedural scripts**, "a great time-saving substitute for hand-drawn animations". Templates make recolours and variants trivial, and a reload key gives instant iteration. ([ASCII Particle Effects](https://www.gridsagegames.com/blog/2014/03/particle-effects/))
- **Colour reflects strength**: "Weaker ballistic weapons fire gray or light brown projectiles, while more powerful versions are orange/red." ([Making Particles](https://www.gridsagegames.com/blog/2014/04/making-particles/))
- **Animation versus pacing.** Routine actions resolve quickly, so "movement and nearly every other action in the game is resolved quickly enough to be considered simultaneous", while impressive effects get "sufficient time". Off-screen effects aren't animated at all. ([Animation vs. Pacing](https://www.gridsagegames.com/blog/2014/01/animation-vs-pacing-dilemma-modern-roguelikes/))
- **Our version.**
  - Effects are data with a duration.
  - `effect()` returns `endsAt`, so the story can wait for a fireball and not for a candle.
  - Bolts and throws are a few hundred milliseconds.
  - The shockwave, flash, white-hot core and banded fireball are a second; smoke lingers a few seconds without blocking anything.
  - A comet head (one bright cell and two dim) makes a projectile readable at speed.

## Dungeon Crawl Stone Soup (console)

- **Elemental colours.** Crawl gives each element a weighted random colour, chosen per redraw from a hash of position and frame number ([colour.cc](https://github.com/crawl/crawl/blob/master/crawl-ref/source/colour.cc)):
  - fire: `{40, RED}, {40, YELLOW}, {40, LIGHTRED}`;
  - water: `{60, BLUE}, {60, CYAN}`;
  - smoke: `{30, LIGHTGREY}, {30, DARKGREY}, {30, LIGHTBLUE}, {30, MAGENTA}`;
  - trees: a hash of location, `GREEN` or `LIGHTGREEN`;
  - "shimmer blue" and "flash" also exist.
- This is the same idea as Brogue's dancing colours, in 16 colours. In truecolor we go further, with smooth ramps through eight stops per flame palette. The principle holds: the element, not the object, decides the colour behaviour.

## Angband

- **Grid lighting.** "Brighten if torchlit, darken if out of LoS, super dark for UNLIGHT", applied per grid with `get_color(a, ATTR_LIGHT|ATTR_DARK, …)`. ([ui-map.c](https://github.com/angband/angband/blob/master/src/ui-map.c))
- **Multi-hued monsters.** Monsters flagged `ATTR_MULTI`, `ATTR_FLICKER` or `ATTR_RAND` shimmer.
- Our version: light multiplies colour continuously rather than in steps, and our "shimmer" motion is reserved for liquids, glass, gems and metal.

## Dwarf Fortress

- **Material colour tokens.** Colours come from raws in foreground:background:brightness tokens: `[COLOR:x:y:z]`, `[DISPLAY_COLOR:7:0:1]`, `[BUILD_COLOR:…]`, over 8 colours with a bright flag. Iron is dark grey (8:0), gold is yellow, and woods vary through browns. ([Color](https://dwarffortresswiki.org/index.php/Color))
- **Glyph conventions.** It also set many furniture glyph habits (tables, chairs and beds as box-drawing and Greek letters).
- Our version:
  - Material colours (`MATERIAL_COLOR`) colour things whose role says "by material": an iron table is grey.
  - We follow the DF habit where it reads (Θ for beds, ╥ for chairs). We depart from it where it doesn't: π for tables, which the map module also uses.

## Ultima Ratio Regum

URR generates its world's culture procedurally (tombs, altars, and eventually paintings and sculptures) and presents it in an ASCII aesthetic with its own extended font ([Mark R Johnson](https://www.markrjohnsongames.com/games/ultima-ratio-regum/)). The lesson for us is generative appearance from data: a look derived from what a thing *is*, rather than a sprite per thing. That's the whole premise of the rules-then-model pipeline.

## Nerd Fonts

- **The glyph sets.** Nerd Fonts patch these sets into fonts ([Glyph Sets and Code Points](https://github.com/ryanoasis/nerd-fonts/wiki/Glyph-Sets-and-Code-Points)):
  - Material Design Icons, `nf-md-*`, U+F0001 to U+F1AF0. This is the useful one for us: birds, dogs, cats, rodents, a beer mug, a teacup, a tray, a candle, a lantern, a fireplace, a campfire, a treasure chest, a coffin, a ghost, a skull, a sword, a bow and arrow, a magic staff, a wizard hat, a crown, a scroll and so on.
  - The old Material range (U+F500 to U+FD46) was retired in v3.
  - Font Awesome (U+ED00 to U+F2FF), Weather Icons (U+E300 to U+E3E3), Octicons, Codicons, Devicons, Powerline and others.
- **We verified every code point.** The 163 icons we use were checked against the project's own `glyphnames.json` (v3.5.1, `md-*` names).
- **Widths.** The variants differ in icon width ([nerd-fonts README](https://github.com/ryanoasis/nerd-fonts)):
  - "Nerd Font" icons are double-width glyphs on a single-cell advance, so they overhang the next cell.
  - "Nerd Font Mono" icons fit one cell. This is what a dense map wants.
  - "Propo" is proportional, for UIs.
- **Terminals.**
  - kitty "has a builtin NERD font and will use it for symbols not found in any other font". It renders private-use-area symbols in one cell, or in two if a space follows ([kitty FAQ](https://sw.kovidgoyal.net/kitty/faq/)).
  - WezTerm "bundles JetBrains Mono, Nerd Font Symbols and Noto Color Emoji" ([WezTerm fonts](https://wezterm.org/config/fonts.html)).
- **Detection.** No terminal query says whether a font has a glyph. So the glyph set is configuration first (`KM_GLYPHS=ascii|nerd|plain`). After that comes a guess from the environment: plain for `TERM=dumb`/`linux` or a non-UTF-8 locale, and ascii otherwise, with a note when the terminal is known to bundle the symbols (`KITTY_WINDOW_ID`, `TERM=xterm-kitty`, `TERM_PROGRAM=WezTerm`).
- **Fallback.** Every glyph resolves as nerd, then ascii, then plain. People keep their letters even in the nerd set: Kell must be the blue K everywhere. Terrain stays CP437, because icons on every floor cell would be noise.

## Terminal constraints

- **Truecolor.** Check `COLORTERM=truecolor|24bit` (VTE, Konsole and iTerm2 set it), or terminfo's `RGB` capability. Otherwise fall back to 256 colours ([termstandard/colors](https://github.com/termstandard/colors)). OpenTUI handles the escape sequences; the look layer is truecolor throughout.
- **Widths, emoji and graphemes.** `wcwidth` per codepoint gets graphemes wrong: a farmer emoji measures 2 + 0 + 2. Terminals disagree on emoji widths (2 to 6 cells), and a disagreement desynchronizes the cursor. Mode 2027 negotiates grapheme clustering ([Grapheme Clusters and Terminal Emulators](https://mitchellh.com/writing/grapheme-clusters-in-terminals)). The rules we follow:
  - **No emoji anywhere on the map.** Not even ☕ (emoji presentation by default) or anything that needs VS16.
  - **Only single-width glyphs**: CP437's pictographs, box drawing, block elements, a few Latin-1 letters, and ♔.
  - Ghostty can be set to `grapheme-width-method = legacy|unicode` ([Ghostty config](https://ghostty.org/docs/config/reference)). OpenTUI exposes `widthMethod` and the terminal's capabilities.
  - East-Asian "ambiguous" glyphs such as ○, ♠, ☺ and ▲ may render double-width in CJK locales. That locale isn't our target; `KM_GLYPHS=plain` covers it.
- **Flicker-free redraws.** Synchronized output (DEC mode 2026: `CSI ? 2026 h` begins an update and `CSI ? 2026 l` ends it; `CSI ? 2026 $ p` queries support) stops tearing while a frame is written ([spec](https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036)). OpenTUI's native renderer queries it and uses it, and it diffs frames so only changed cells are written. We checked the strings in its Zig library.
- **Frame rate.** OpenTUI's defaults are `targetFps` 30 and `maxFps` 60. Thirty is plenty for flames and water, which change every 100 to 250 ms of perceived motion. Our renderable is `live`, so OpenTUI keeps drawing it without React state changes. A 130×38 frame costs 2 to 7 ms to compose; most of that is noise sampling and lighting.

## Decisions for Kingmaker, in detail

- **Palette.**
  - The background is an ink, `#0e0d12`, never pure black.
  - Grounds have their own dark backgrounds: cobbles with per-stone shades and damp patches, flagstones by slab with darker joints, planks in staggered runs, grass with travelling gusts, water with a current.
  - Things use named material colours; flames use eight-stop ramps (fire, blue, green, violet, ember).
  - The cast keep the map module's letters and colours (`CAST_LOOKS`).
- **Glyph conventions** (roguelike tradition, kept because players read them instantly):

  | glyph | means |
  |---|---|
  | `@` | you |
  | letters | named people and creatures (lowercase for children and small beasts) |
  | ☻ ☺ | anonymous adults and children |
  | `v` | birds |
  | `%` | food and remains |
  | `!` | bottles |
  | `$` | money |
  | `/` | long things |
  | `[` | clothes |
  | ≡ | writing |
  | `+` `'` | doors |
  | ▲ | flames |
  | ~ ≈ | liquids |
  | ♣ ♠ | trees |
  | Θ Ö ö ü | round vessels |
  | ■ δ | boxes and sacks |

- **States are looks.**
  - burning: flame ramp, ember background, glow, light by size; the thing's glyph alternates with flame glyphs.
  - smouldering: a pulsing ember.
  - destroyed: char, rubble, splinters, shards or a puddle, by material.
  - scorched: sooty. wet: darker and bluer, with a glint. frozen: icy. oiled: a thin-film rainbow sheen.
  - poisoned: green. bloodied: red. hidden: faint. hanging: raised with a rope. overhead: dim and raised.
  - lit: light and flicker. A door shows open, shut or barred. Overturned furniture shows its legs.
- **Big things over several cells.** Stamps by role: tabletops, the skiff-hull bar, hearths with stone surrounds, a tree canopy (sunlit upper left, shaded lower right, casting a shadow by day), sacks in courses, wardrobes. Wrecks scatter over their footprint, and a burning table burns all over.
- **Surfaces, BG3-style, from `systems.ts`.**
  - water: sky reflections and glints.
  - oil: a dark rainbow sheen; burning, orange flames and smoke.
  - spirits: a pale shimmer; burning, blue flames.
  - blood: dark and still, with one wet highlight.
  - ale: amber foam. grease: a yellow-brown slick. ice: pale, with glints and cracks.
  - scorch marks: blackened, with pale ash.
  - smoke and steam: drifting veils that thin as their `ttl` runs out.
  - Burning patches draw last, so a puddle beside a fire never hides it.
- **The model.**
  - Luna (`openai/gpt-6-luna`, effort none) is asked in batches of up to 20 names.
  - Strict JSON schema: a glyph name from a menu of 70, plus a letter for creatures; a Nerd Font icon name from the 163, or none; a palette colour name; a motion; and light, being, group and material.
  - Cached in `runs/look-cache.json` (`KM_LOOK_CACHE`), keyed by the name without articles, owners, states or numbers.
  - One measured call resolved four unknown names in 1.9 s for $0.00035: a sackbut became a brass ♪, marzipan a cream %, a whirligig a brass ☼, and a gibbering homunculus a flesh-coloured `g`.
  - Strict schemas refuse `"` in enum strings, so glyphs are chosen by name.
- **Effects API.** `effect(kind, opts)` takes one of: fireball, bolt, lightning, explosion, splash, douse, sparks, smoke, steam, dust, shockwave, flash, throw, ignite, debris, poof or embers. `float()` shows damage, healing and words, `bark()` puts speech over a speaker, and `alert()` shows a "!". Everything is in the world's feet, so the stage, the map and combat each project it their own way.
