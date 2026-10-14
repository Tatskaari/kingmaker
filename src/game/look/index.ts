/**
 * The look: art direction for the terminal world view (docs/research/ascii-art-direction.md).
 * Caves of Qud's discipline (a glyph, a colour, a detail; a small named palette), Brogue's
 * coloured light and dancing colours, Cogmind's brief particle effects, in truecolor.
 *
 * - The appearance of anything: lookOf(thing, ctx) for a scene-world entity, a map actor or a name
 *   the GM just said; rules on the name, tags and kind first, Luna (cached) only for the unknown.
 * - Living terrain: groundCell / surfaceCell / cloudCell / flameCell / rainAt, pure in (cell, time).
 * - Light: LightField (ambient by time of day, coloured sources, soft falloff, walls cast shadows).
 * - Effects: Effects (fireball, bolt, explosion, splash, douse, smoke, steam...) and floating text.
 * - The director: animates what changed in a world between turns (walks, ignitions, douses...).
 * - For the map renderer (src/game/map/render.ts): map.ts (actorLook, groundAt, surfaceLayer).
 * - A top-down stage renderer for scene worlds (renderStage) and the gallery (gallery.tsx).
 */
export { lookOf, baseLook, describeLook, resetLooks, type Look, type Lookable, type LookContext, type Cell, type TimeOfDay } from "./appearance.ts";
export { parseName, singular, type ParsedName } from "./names.ts";
export { matchRole, roleById, type Role, type Motion, type Stamp } from "./roles.ts";
export { CAST_LOOKS, castLook } from "./people.ts";
export { detectGlyphSet, glyphFor, nerd, plainOf, type GlyphSet } from "./glyphs.ts";
export { PALETTE, QUD, FLAMES, hexOf, rgbOf, mix, type RGB } from "./color.ts";
export { LookCache, lookCache, setLookCache, setInventor, requestInvention, flushInventions, inventionVersion, lastInventionError, type Invention, type Inventor } from "./invent.ts";
export { groundCell, wallCell, surfaceCell, puddleOver, flameCell, cloudCell, cloudDensity, rainAt, type Ground, type SurfaceKind, type CloudKind, type Weather, type TCell } from "./terrain.ts";
export { surfacesOf, type SurfacePatch, type CloudPatch } from "./surfaces.ts";
export { LightField, DAYLIGHT, ambientOf, shade, glint, type LightSource } from "./light.ts";
export { Effects, areaCell, type EffectKind, type EffectOptions, type EffectFrame, type Anchor, type Sprite, type FloatText } from "./effects.ts";
export { Director, Tweens } from "./director.ts";
export { Canvas } from "./canvas.ts";
export { renderStage, layoutOf, type Dressing, type StageView, type StageLayout } from "./stage.ts";
export { drownedRatDressing, granaryYardDressing, kingsRoomDressing } from "./dressings.ts";
export { actorLook, lightOf, groundAt, surfaceLayer, lookFrame, tileFeet, type ActorLook, type LookFrame, type SurfaceLayer } from "./map.ts";
export { VIGNETTES, VignettePlayer, frameAt, type Vignette } from "./vignettes.ts";
