/**
 * The world you walk around in (docs/design/playable.md, src/game/map/): tile maps of Caerwyn and
 * the places its scenes are played in, exploration, the isometric ASCII renderer, and the bridge
 * between a scene's world (feet) and the map (5-ft tiles).
 *
 * The app's loop, roughly:
 *   const ex = newExploration(storyFromSession(session));
 *   on a key: const r = move(ex, ...KEYS[key]); if (r.trigger) open the scene (enterScene(ex, r.trigger.sceneId)).
 *   on "talk/use": const it = interact(ex); scene -> open it; travel -> travel(ex, it.interaction.to); examine -> show the text.
 *   draw: renderExplore(ex, { w, h }, { world: session.world }) -> StyledLine[].
 *   scene over: leaveScene(ex, session.world) before chainScene; then setStory(ex, storyFromSession(session)).
 */

export { MAPS, getMap, decorOf } from "./maps/index.ts";
export { PLACES, scenePlace, regionForScene, sceneStart, storyFromSession, timeFor, leadScene, type ScenePlace } from "./places.ts";
export { newExploration, setStory, actorsHere, move, travel, pathTo, look, nearby, interact, enterScene, leaveScene, renderExplore, KEYS, type ExploreState, type Follower, type MoveResult, type Nearby } from "./explore.ts";
export { presence, liveScenes, isLive, leadMarker, regionOpen } from "./presence.ts";
export { actorsFromWorld, captureScene, overlayActors, overlayRegionStates, emptyOverlay, feetToTile, tileToFeet, nearestTile, FEET_PER_TILE, type MapOverlay, type OverlayScene } from "./reconcile.ts";
export { render, project, screenOf, tileAtScreen, type RenderOptions, type Viewport } from "./render.ts";
export { toAnsi, toPlain } from "./ansi.ts";
export { buildMap, tileAt, regionAt, inBounds, isStructure, isRoofed, direction, steps, type MapTile, type PlaceRegion, type MapDef, type MapSpec, type TileDef, type DecorDef } from "./tiles.ts";
export { CAST, lookForEntity, lookForName } from "./looks.ts";
export { heronWorld } from "./worlds/heron.ts";
export { dressingRoomWorld } from "./worlds/dressing-room.ts";
