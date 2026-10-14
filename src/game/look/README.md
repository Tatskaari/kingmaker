# src/game/look: the look of the world view

This module is the art direction layer: how anything in the world looks, alive. The research and decisions behind it are in [docs/research/ascii-art-direction.md](../../../docs/research/ascii-art-direction.md).

## Run it

```sh
# The gallery: seven animated vignettes on real scene worlds, with the real rules and physics.
node --experimental-ffi --no-warnings --import tsx src/game/look/gallery.tsx [rat|yard|dust|surfaces|inventions|glyphs|weather] [--glyphs nerd]
#   keys: ←/→ or 1-7 vignette · space pause · r restart · g glyph set · t time of day · w weather · q quit

# Exact frames, headless (plain, ANSI, or every cell as JSON):
node --no-warnings src/game/look/dump.ts                      # list the vignettes
node --no-warnings src/game/look/dump.ts rat --t 0,8600,15000 # frames at those milliseconds
node --no-warnings src/game/look/dump.ts surfaces --ansi --w 120 --h 40
node --no-warnings src/game/look/dump.ts all --plain --glyphs plain

# The game's own views with the look (the town, scenes on the map and from above, the Heron fight):
node --no-warnings src/game/look/frames.ts                    # .ansi, .txt and .json frames into runs/look-wire

# Tests, and a pty smoke test of the gallery:
node --test --no-warnings src/game/look/*.test.ts
python3 src/game/look/smoke.py
```

**Environment variables.**
- `KM_GLYPHS=ascii|nerd|plain` sets the glyph set (the default is ascii; nerd needs a Nerd Font, ideally a Mono variant, or kitty or WezTerm).
- `KM_LOOK_CACHE` sets where the model's looks are cached (the default is `runs/look-cache.json`).
- `KM_LOOK_MODEL=off` never calls the model.

## The files

| file | what it does |
|---|---|
| `appearance.ts` | `lookOf(thing, ctx)`, the look of anything right now: glyph, fg, bg, bold, glow, the light it sheds (flickered), lift, alpha, group, footprint and stamp, burning, wreck. `baseLook` is the static half, cached per kind of thing. |
| `names.ts` | `parseName`: the head noun; states and colours from adjectives; "a flock of", "a pool of", "a bucket of", "a stub of". |
| `roles.ts` | The rules: about 200 roles (glyph per set, colour, motion, light, footprint), matched by head noun, then phrase, then tag, then kind. |
| `people.ts` | The cast's letters and colours, from the map module's `CAST` (the one cast table). |
| `invent.ts` | Unknown names: an immediate guess, then a batched Luna call (glyphs chosen by name from a menu), cached on disk. |
| `glyphs.ts` | The glyph sets (ascii, nerd, plain), the verified Nerd Font code points, seven-bit fallbacks, `detectGlyphSet`. |
| `color.ts` | Packed-RGB maths, the named palette, Qud's 18 colours, flame ramps, damage colours. |
| `noise.ts` | Hashes, value noise and `flicker`: animation is a pure function of (where, when, seed). |
| `terrain.ts` | Living terrain: ground, walls, surfaces (water, oil, spirits, blood, ash, ice...), flames on a burning surface, clouds, rain. |
| `surfaces.ts` | The world's surfaces (`kind: "surface"` entities from `src/world/systems.ts`) as patches and clouds. |
| `light.ts` | `LightField`: ambient by time of day (indoor and outdoor), coloured sources, soft falloff, shadows from walls; `shade` and `glint`. |
| `effects.ts` | `Effects`: analytic particles, rings, flashes, transient lights, shake; floating numbers, alerts and barks. |
| `director.ts` | Turns world changes into motion: walks (tweens), ignitions, douses, wrecks, explosions, spills, damage numbers, barks from replies. |
| `stage.ts` | A top-down renderer for a scene world: the scene's place in the app, beside the transcript. |
| `dressings.ts` | What the scenes' worlds are built of (floors, walls, glass, windows, water), by scene: `dressingFor`. |
| `map.ts` | The face the isometric map renderer calls (below). |
| `canvas.ts` | The frame (cells), with `toLines()` (StyledLine[]), `toAnsi()`, `toPlain()` and `toJSON()`. |
| `opentui.ts` | `<lookCanvas>`: a live OpenTUI renderable that paints frames (a Canvas, or styled lines) straight into the buffer, at most `fps` new frames a second. |
| `vignettes.ts`, `gallery.tsx`, `dump.ts`, `smoke.py` | The gallery, its headless dump and its smoke test. |
| `frames.ts` | Headless frames of the game's own views (src/game/views.ts) with the look. |

## The API in one screen

```ts
import { lookOf, Effects, Director, renderStage, actorLook, groundAt, surfaceLayer, lookFrame } from "./look/index.ts";

lookOf(entity, { t: now, time: "night", glyphs: "ascii" })   // a cell (+ light, glow, lift...) for anything with a name
lookOf({ name: "a flock of pigeons", kind: "creature" })     // GM inventions too: rules first, the model's cache next, a guess meanwhile

const fx = new Effects();                                     // per scene; the clock is performance.now() unless you pass one
fx.effect("fireball", { from: casterFeet, at: targetFeet, radius: 20 });   // returns { duration, endsAt }
fx.effect("bolt", { from, to, color: "#9ad8ff" }); fx.effect("explosion", { at, radius: 15 }); fx.effect("splash", { at });
fx.float(atOrId, "12", { damage: "fire" }); fx.bark("kell", "Was that strictly necessary?"); fx.alert("cob");
const frame = fx.frame(now, id => positionOf(world, id));     // sprites, areas, texts, lights, shake: all in feet

const director = new Director(fx); director.prime(world);     // when a scene opens
director.spellsFrom(world, ruleLines, now, aliases);          // "Cast Fireball ...: a 20-foot sphere on X": a ball of fire from the player to X
director.rulesLines(world, ruleLines, now, aliases);          // "X takes 7 fire damage", "the big man takes 7 damage" float a 7
director.observe(world, now);                                 // after every turn: walks, fires, douses, spills, wrecks (and hurt the lines didn't float)
director.barksFrom(world, gmReply, now, called);              // short quoted lines over their speakers (called: "the landlady")
director.barkLine(world, "kell", line, now);                  // a cast member's own short line

renderStage(world, dressing, { w, h, t: now, time, effects: fx, positions: id => director.tweens.at(id, now) });  // a Canvas
```

## How it's wired into the game

The plug-in point is `src/game/views.ts`: every picture of the world the game draws goes through it, with one clock, `t` in milliseconds (`performance.now()` in the app).

**The isometric map** (`src/game/map/render.ts`, for the town, a scene's place on the map and a fight on its battlefield) keeps its own projection, blocks, roofs, cutaways and markers. The look decides the rest:

- **Things and people** are `actorLook(actor, frame)`: world things by the rules, the cast by their letters, the map's decor as authored, with their states (burning things flicker and throw tongues of flame, embers and smoke; smashed ones are splinters; the hidden are faint). The player's highlight, bunting and the hanged man's rope are the map's own.
- **Ground** is `groundAt(terrain, px, py, frame)` per cell, in projected-plane coordinates so it doesn't crawl with the camera; rivers run the way each map's river runs.
- **Surfaces** are `surfaceLayer(world, frame)` for each scene world on the map (`RenderOptions.worlds`): the live scene's, and what played scenes spilled (the map's overlay keeps them; smoke clears and fires burn out by a later hour). They lie over the ground and under actors; smoke and steam veil everything. `reconcile.actorsFromWorld` skips them: they're patches, not actors.
- **Hazards** (`RenderOptions.hazards`) are tiles on fire (`fireAt`), thick with dust (`dustAt`) or scorched: a fight's own, or a world's areas (`areaHazards`: the Heron's dusty floor, where it went up).
- **Light** is per tile and coloured, Brogue-style: the time of day's daylight (`DAYLIGHT` in the map's palette: dimmer in a room whose roof is lifted), plus every source in reach (lamps and fires by `actorLook`'s light, burning patches, effects, a fight's fire, lit windows at night and daylight through them by day), falling off softly and stopped by opaque tiles. People and buildings keep a floor of light. The Rat's driftwood fire lights it blue.
- **Effects** (`RenderOptions.effects`: an `EffectFrame` in a region's world feet) are projected: sprites by their feet and height, areas cell by cell, the frame's shake on the camera, and floating text (barks, damage numbers) last and unlit.
- **Plain text** (`color: false`, the QA console's `townText`) stays quiet: the palette's static ground, no motion, no effects, no icons, single-width glyphs.

**A scene's place from above** is `stageView` (the stage with `dressingFor(scene)`). The app keeps one `Effects` and one `Director` per scene (`Game.sceneLook()` in `src/app/game.ts`): primed when the scene's place is first drawn; the rules' lines go to `spellsFrom`, `rulesLines` and `observe` as they land (in that order: a number floats once); the GM's reply to `barksFrom` (and a cast member's own line to `barkLine`); and after every turn `observe` animates what the stage manager changed. The scene screen draws the stage beside the transcript (a live `<lookCanvas>`); `#map` shows the same place on the isometric map with the same effects.

**A fight** plays its log as effects (`fightEffects`: a spell from its caster, a ball of fire for fire in an area, sparks where a blow lands, damage numbers, the dust going up), with its dust hanging and its fire burning on the battlefield.

**In the app** the world's views are live canvases that ask for a new frame about twelve times a second (`FPS` in `src/app/ui/common.tsx`) and are held still under an overlay; the rest of the screen redraws only when the game changes.

**Glyph sets.** `glyphSet()` reads `KM_GLYPHS` once; everything the look draws honours it (the map's own glyphs too, in plain).

## Open issues

- **Unauthored worlds.** The four worlds of the arc have dressings (the Rat, the yard and loft, the Heron, the King's room). A new world without one renders with default floors and no walls: give it a dressing, or have the stage read its map's tiles.
- **Combat's own letters.** The app draws a fight's cast from the one cast table, and the others with no letter twice (`fightLooks`: a porter's S is Saul's, so he's L), but the combat module's text grid (the QA console's view of a fight, `gridText`) still has letters of its own (Hep is H there, G on the map).
- **The map's light is per tile.** Walls stop it whole tiles at a time, and a block's faces take the light of the tile they stand on.
- **Nerd icons overhang in non-Mono fonts.** The nerd set is opt-in for that reason.
- **The model's looks aren't reviewed.** The menu keeps them sane, but a bad answer stays cached until `runs/look-cache.json` is edited or deleted.
