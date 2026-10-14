/**
 * The world you walk around in (docs/design/playable.md, src/game/map/): tile maps of Caerwyn and
 * the places its scenes are played in, exploration, the isometric ASCII renderer, and the bridge
 * between a scene's world (feet) and the map (5-ft tiles).
 *
 * Coordinates: x runs east, y south, a tile is 5 ft. On screen the viewer stands to the south-west:
 * the map's north runs up-left and its east up-right (KEYS steps by the compass; the app may prefer
 * to rotate arrows to the screen).
 *
 * Exploring (the app's explore mode):
 *   const ex = newExploration(storyFromSession(session));          // the lane by the granary gate
 *   key:      const r = move(ex, ...KEYS[key]);                      // r.message for the log; r.bumped
 *             if (r.trigger) { enterScene(ex, r.trigger.sceneId); await openScene(session) }
 *   use/talk: const it = interact(ex);                               // scene -> as above; travel -> travel(ex, it.interaction.to);
 *                                                                    // examine -> show it.interaction.text
 *   sidebar:  look(ex), nearby(ex), leadMarker(ex.story, ex.map), regionAt(getMap(ex.map), ex.at)?.name
 *   draw:     renderExplore(ex, { w, h }) -> StyledLine[] (pass { tick } to animate water and fire)
 *   walk to:  pathTo(ex, tile) -> steps for move()
 *
 * Scenes (scene mode): after enterScene, draw renderExplore(ex, size, { world: session.world }): the
 * place with its roof off, framed, the world's people and things on it (the player follows the
 * world's player). When the scene ends: leaveScene(ex, session.world) BEFORE chainScene (which drops
 * the world), then setStory(ex, storyFromSession(session)) once the story has moved on.
 *
 * Combat: battlefield(sceneId, session.world) gives the map, everyone's tile and what's in the way;
 * spotsNear() finds tiles for people the world doesn't have (the Crakes); reachable() a move range;
 * render(map, actors, camera, size, { roofs: false, marks, cursor, reveal }) draws the fight.
 *
 * Saving: ExploreState (overlay included) is plain JSON; keep it with the session.
 */

export { MAPS, getMap, decorOf } from "./maps/index.ts";
export { PLACES, scenePlace, regionForScene, sceneStart, storyFromSession, timeFor, leadScene, type ScenePlace } from "./places.ts";
export { newExploration, setStory, actorsHere, move, travel, pathTo, look, nearby, interact, enterScene, leaveScene, renderExplore, KEYS, type ExploreState, type Follower, type MoveResult, type Nearby } from "./explore.ts";
export { presence, liveScenes, isLive, leadMarker, regionOpen } from "./presence.ts";
export { actorsFromWorld, captureScene, overlayActors, overlayRegionStates, emptyOverlay, feetToTile, tileToFeet, nearestTile, nearestWalk, FEET_PER_TILE, type MapOverlay, type OverlayScene, type FromWorldOptions } from "./reconcile.ts";
export { battlefield, spotsNear, reachable, type Battlefield } from "./setup.ts";
export { render, project, screenOf, tileAtScreen, type RenderOptions, type Viewport } from "./render.ts";
export { toAnsi, toPlain } from "./ansi.ts";
export { buildMap, tileAt, regionAt, inBounds, isStructure, isRoofed, direction, steps, type MapTile, type PlaceRegion, type MapDef, type MapSpec, type TileDef, type DecorDef } from "./tiles.ts";
export { CAST, lookForEntity, lookForName } from "./looks.ts";
export { heronWorld } from "./worlds/heron.ts";
export { dressingRoomWorld } from "./worlds/dressing-room.ts";
