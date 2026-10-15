/**
 * The world you walk around in (docs/design/playable.md, src/game/map/): tile maps of Caerwyn and
 * the places its scenes are played in, exploration, the isometric ASCII renderer, and the bridge
 * between a scene's world (feet) and the map (5-ft tiles).
 *
 * Coordinates: x runs east, y south, a tile is 5 ft. On screen the viewer stands to the south-west:
 * the map's north runs up-left and its east up-right. SCREEN_KEYS moves with the screen (up is
 * straight up: a north-east step); KEYS moves by the compass, if the app would rather.
 *
 * Exploring (the app's explore mode):
 *   const ex = newExploration(storyFromSession(session));          // the lane by the granary gate
 *   key:      const r = move(ex, ...SCREEN_KEYS[key]);               // r.message for the log; r.bumped
 *             if (r.trigger) { enterScene(ex, r.trigger.sceneId); await openScene(session) }
 *   use/talk: const it = interact(ex);                               // scene -> as above; travel -> travel(ex, it.interaction.to);
 *                                                                    // examine -> show it.interaction.text
 *   sidebar:  look(ex), nearby(ex), leadMarker(ex.story, ex.map), regionAt(getMap(ex.map), ex.at)?.name
 *   draw:     renderExplore(ex, { w, h }) -> StyledLine[] (pass { t } in milliseconds: water runs, fire flickers)
 *   walk to:  pathTo(ex, tile) -> steps for move()
 *   mouse:    renderExplore(ex, size, { pick, hover }) fills a Picks: pick.at(x, y) is the tile (and who) drawn
 *             in that cell; walkPlan(ex, tile) is a click's walk (through a door, or as near as it gets);
 *             tileName(ex, tile) and lookAt(ex, tile) say what's there. exploreCamera is where it looks.
 *
 * Walking into things says what they are, in the house style (quips.ts: never the same line twice
 * running). Small things you walk past stand up on posts; big things in the way fill their square.
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
export { PLACES, scenePlace, registerPlace, regionForScene, sceneStart, storyFromSession, timeFor, leadScene, type ScenePlace } from "./places.ts";
export {
  newExploration, setStory, actorsHere, actorsAt, move, steer, travel, pathTo, walkPlan, look, lookAt, tileName, whereabouts, nearby, interact, enterScene, leaveScene, renderExplore, exploreFrame, exploreCamera, roamRegion, KEYS, SCREEN_KEYS,
  type ExploreState, type Follower, type MoveResult, type Nearby,
} from "./explore.ts";
export { bumpLine, placeLine, quip, type Bump, type QuipMemory } from "./quips.ts";
export { presence, addPresence, liveScenes, isLive, leadMarker, regionOpen, sceneTrigger, type Presence } from "./presence.ts";
export { actorsFromWorld, captureScene, overlayActors, overlayRegionStates, overlaySurfaces, emptyOverlay, feetToTile, tileToFeet, nearestTile, nearestWalk, FEET_PER_TILE, type MapOverlay, type OverlayScene, type FromWorldOptions } from "./reconcile.ts";
export { areaHazards, battlefield, spotsNear, reachable, type Battlefield } from "./setup.ts";
export { render, project, screenOf, tileAtScreen, Picks, type RenderOptions, type Viewport } from "./render.ts";
export { toAnsi, toPlain } from "./ansi.ts";
export { buildMap, tileAt, regionAt, inBounds, inRect, isStructure, isRoofed, isDoorway, direction, steps, type MapTile, type PlaceRegion, type MapDef, type MapSpec, type TileDef, type DecorDef } from "./tiles.ts";
export { CAST, lookForEntity, lookForName } from "./looks.ts";
export { heronWorld } from "../../../scenes/worlds/heron-warehouse.ts";
export { dressingRoomWorld } from "../../../scenes/worlds/kings-morning.ts";
