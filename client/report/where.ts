// After the prototype's src/app/game.ts at 44c6d4a, its whereNow (:2301-2313): the screen and what was over it, the turn under way, the status, the fight's round; the game's place in it from the screens' views here (the scene, the map's tile, the fight), where it read the game's files.
import type { Where } from "../../shared/report/format.ts";
import type { Screen } from "../app/model.ts";
import type { ExploreModel } from "../explore/model.ts";
import type { FightModel } from "../fight/model.ts";
import type { SceneModel } from "../scene/model.ts";
import type { TitleModel } from "../title/model.ts";

/**
 * Where the player was as they asked to report a problem (V16, M5), from the client's own: the
 * screen up (a scene's page beyond it: between scenes, the story's fight's stand-in, The End) and
 * what was open over it, or where the report was asked for from; then whichever of the scene, the
 * map and the fight is on screen, as its view has it.
 */

/** The app's screens' models, as where reads them. */
export interface Screens {
  screen: Screen;
  title: TitleModel;
  scene?: SceneModel | undefined;
  explore?: ExploreModel | undefined;
  fight?: FightModel | undefined;
}

export function whereOf(app: Screens, from?: string): Where {
  const over = overlayOf(app);
  return {
    screen: screenOf(app),
    ...(from ?? over ? { overlay: (from ?? over)! } : {}),
    ...(app.screen === "scene" && app.scene ? inScene(app.scene) : {}),
    ...(app.screen === "explore" && app.explore ? onMap(app.explore) : {}),
    ...(app.screen === "fight" && app.fight ? inFight(app.fight) : {}),
    ...(app.screen === "title" ? { latest: true } : {}),
  };
}

/** The screen up: the app's, or a scene's page past the scene itself. */
function screenOf(app: Screens): string {
  const page = app.screen === "scene" ? app.scene?.page : undefined;
  return page && page !== "scene" ? (page === "fight" ? "standin" : page) : app.screen;
}

/** What was open over the screen: an overlay, a menu, the zoo's menu on the title. */
function overlayOf(app: Screens): string | undefined {
  switch (app.screen) {
    case "scene": return app.scene?.overlay?.kind ?? (app.scene?.sceneMenu ? "the place's menu" : undefined);
    case "explore": return app.explore?.overlay?.kind ?? (app.explore?.doMenu ? "the action menu" : app.explore?.aiming ? "aiming" : app.explore?.menu ? "a tile's menu" : undefined);
    case "fight": return app.fight?.overlay?.kind ?? (app.fight?.menu ? "the action menu" : app.fight?.aim ? "aiming" : undefined);
    case "title": return app.title.zooMenu ? "the zoo's menu" : undefined;
    default: return undefined;
  }
}

function inScene(scene: SceneModel): Partial<Where> {
  const v = scene.view;
  const busy = scene.busy();
  const status = scene.status ?? scene.gone ?? scene.refusal() ?? v.note;
  return {
    game: v.game,
    ...(v.watching ? { watching: v.watching } : {}),
    scene: { ...(v.sceneId ? { id: v.sceneId } : {}), title: v.title, ...(v.turn !== undefined ? { turn: v.turn } : {}), phase: v.phase, ...(v.over ? { over: true } : {}), ...(v.talk ? { talk: true } : {}) },
    ...(v.time ? { time: v.time } : {}),
    ...(busy ? { busy } : {}),
    ...(status ? { status } : {}),
  };
}

function onMap(explore: ExploreModel): Partial<Where> {
  const v = explore.view;
  const said = explore.messages[explore.messages.length - 1];
  return {
    game: v.game,
    ...(v.watching ? { watching: v.watching } : {}),
    map: { key: v.ex.map, at: { x: v.ex.at.x, y: v.ex.at.y } },
    time: v.ex.story.time,
    ...(said ? { status: said } : {}),
  };
}

function inFight(fight: FightModel): Partial<Where> {
  const v = fight.view;
  const turn = v.board.units[v.turn]?.name;
  return {
    game: v.game,
    ...(v.watching ? { watching: v.watching } : {}),
    fight: { round: v.round, ...(turn ? { turn } : {}), status: v.status },
    ...(fight.status ? { status: fight.status } : {}),
  };
}
