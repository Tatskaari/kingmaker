// New: the game as it's heard (docs/sound-design.md): attached to the app's model as reporting is, it follows whichever screen is up and its model, and says what it hears: the music's mood for the screen (the title, the town by day or night, a scene, between scenes, a fight, The End); a scene's talk, dice and chimes (scene.ts); a fight's end; and what opens over the screens and closes again (the menus, the sheet, the notebook), the pick moving in them, aiming, and a move refused. What's chosen in them is the screens' own to say (cues.ts ui), as only they know.
import type { AppModel } from "../app/model.ts";
import type { ExploreModel } from "../explore/model.ts";
import type { FightModel } from "../fight/model.ts";
import type { SceneModel } from "../scene/model.ts";
import { MAPS } from "../../shared/map/maps.ts";
import type { MusicSlot } from "../../shared/music/assignments.ts";
import { music, sfx, ui } from "./cues.ts";
import type { MusicContext } from "./cues.ts";
import type { Mood } from "./music.ts";
import { SceneSound } from "./scene.ts";
import { VOICES } from "./voices.ts";

/** The music for whichever screen is up (none: quiet, as after a fight's last blow). */
export function moodOf(app: Pick<AppModel, "screen" | "scene" | "explore" | "fight">): Mood | null {
  switch (app.screen) {
    case "title": case "create": case "creating": case "choose": case "custom": case "backstory": case "created": return "title";
    case "explore": return app.explore?.view.fight ? "fight" : dark(app.explore?.view.ex.story.time) ? "night" : "town";
    case "fight": return app.fight && fightOver(app.fight) ? null : "fight";
    case "scene": {
      const scene = app.scene;
      if (!scene) return null;
      switch (scene.page) {
        case "between": return "between";
        case "fight": return "fight";
        case "end": return "end";
        case "scene": return scene.view.talk ? "between" : dark(scene.view.musicTime ?? scene.view.place?.time) ? "night" : "scene";
      }
    }
  }
}

/** The authored scene/map and hour sent to the library, without depending on display titles. */
export function musicOf(app: Pick<AppModel, "screen" | "scene" | "explore" | "fight">): { mood: Mood | null } & MusicContext {
  const mood = moodOf(app);
  if (!mood) return { mood };
  const explore = app.explore?.view;
  if (app.screen === "explore" && explore) {
    const map = explore.ex.map, slot = explore.fight ? "combat" : explore.ex.story.time;
    const track = MAPS[map]?.map.music?.[slot];
    return { mood, map, slot, ...(track ? { track } : {}) };
  }
  if (app.screen === "fight" && app.fight) {
    const view = app.fight.view, map = view.map.id;
    // The app retains an earlier scene model; only the scene active on this fight's map owns it.
    const scene = explore?.game === view.game && explore.ex.map === map ? explore.ex.scene : undefined;
    const track = view.map.music?.combat;
    return { mood, map, slot: "combat", ...(scene ? { scene } : {}), ...(track ? { track } : {}) };
  }
  if (app.screen === "scene" && app.scene) {
    const scene = app.scene;
    if (scene.page !== "fight" && scene.page !== "scene") return { mood };
    const slot = scene.page === "fight" ? "combat" : scene.view.musicTime ?? scene.view.place?.time ?? "morning";
    const map = explore?.game === scene.view.game ? explore.ex.map : undefined;
    const track = map ? MAPS[map]?.map.music?.[slot as MusicSlot] : undefined;
    return { mood, slot, ...(scene.view.sceneKey ? { scene: scene.view.sceneKey } : {}), ...(map ? { map } : {}), ...(track ? { track } : {}) };
  }
  return { mood };
}

const dark = (time: string | undefined) => time === "evening" || time === "night";

/** A fight over, and its last moment played out. */
const fightOver = (fight: FightModel) => fight.view.status !== "on" && fight.player.caughtUp;

/** What's open over a screen, as far as it's heard: a menu or a page over it, and the pick in it. */
interface Open { over?: string; menu?: string; index?: number; aim?: string; refusal?: string }

/** The game heard: from now until the returned function stops it. */
export function attachSound(app: AppModel): () => void {
  const heard = new SceneSound(VOICES);
  let scene: SceneModel | undefined, explore: ExploreModel | undefined, fight: FightModel | undefined;
  const off: Partial<Record<"app" | "scene" | "explore" | "fight", () => void>> = {};
  let open: Open = {};
  let page: string | undefined;
  let fightEnded: string | undefined;

  const listen = () => {
    const now = openOf(app);
    sayWhatOpened(open, now);
    open = now;
    if (app.screen === "scene" && scene) {
      if (scene.page === "scene") heard.hear(scene.view);
      if (scene.page !== page && scene.page === "end") sfx("story.end");
      page = scene.page;
    }
    if (app.screen === "fight" && fight && fightOver(fight) && fightEnded !== `${fight.view.game}:${fight.view.id}`) {
      fightEnded = `${fight.view.game}:${fight.view.id}`;
      sfx(fight.view.outcome === "victory" ? "fight.won" : "fight.lost");
    }
    const { mood, ...context } = musicOf(app);
    music(mood, context);
  };
  /** Each model the app has now, listened to (a new one for another game, or another fight; another game's people with voices of their own). */
  const follow = () => {
    if (app.scene !== scene) { off.scene?.(); scene = app.scene; if (scene) { VOICES.forget(); off.scene = scene.subscribe(listen); } }
    if (app.explore !== explore) { off.explore?.(); explore = app.explore; if (explore) off.explore = explore.subscribe(listen); }
    if (app.fight !== fight) { off.fight?.(); fight = app.fight; if (fight) off.fight = fight.subscribe(listen); }
    listen();
  };
  off.app = app.subscribe(follow);
  follow();
  return () => { for (const stop of Object.values(off)) stop(); music(null); };
}

/** What's open over the screen that's up, and the pick in it. */
function openOf(app: AppModel): Open {
  switch (app.screen) {
    case "scene": {
      const s = app.scene;
      if (!s) return {};
      const menu = s.sceneMenu;
      return {
        ...(s.overlay ? { over: s.overlay.kind } : {}),
        ...(menu ? { menu: `place:${menu.title}`, index: menu.index } : {}),
        ...(s.refusal() ? { refusal: s.refusal()! } : {}),
      };
    }
    case "explore": {
      const e = app.explore;
      if (!e) return {};
      const over = e.overlay;
      return {
        ...(over ? { over: over.kind, ...("index" in over ? { index: over.index } : {}) } : {}),
        ...(e.doMenu ? { menu: "do", index: e.doMenu.index } : e.menu ? { menu: `tile:${e.menu.title}`, index: e.menu.index } : {}),
        ...(e.aiming ? { aim: `${e.aiming.at.x},${e.aiming.at.y}` } : {}),
        ...(e.view.refusal ? { refusal: e.view.refusal } : {}),
      };
    }
    case "fight": {
      const f = app.fight;
      if (!f) return {};
      const over = f.overlay;
      return {
        ...(over ? { over: over.kind, ...("index" in over ? { index: over.index } : {}) } : {}),
        ...(f.menu ? { menu: "do", index: f.menu.index } : {}),
        ...(f.aim ? { aim: `${f.aim.entry.name}:${f.aim.index}` } : {}),
        ...(f.view.refusal ? { refusal: f.view.refusal } : {}),
      };
    }
    default: return {};
  }
}

/** Pages turned and menus opened, closed and moved through, aims moved, a refusal: each change between what was open and what is. */
function sayWhatOpened(was: Open, now: Open): void {
  if (now.over !== was.over) {
    if (!now.over) ui("close");
    else ui(now.over === "menu" || now.over === "foes" ? "open" : "page");
  } else if (now.over && now.index !== was.index && now.index !== undefined) ui("move");
  if (!now.over && !was.over) {
    if (now.menu !== was.menu) ui(now.menu ? "open" : "close");
    else if (now.menu && now.index !== was.index) ui("move");
  }
  if (now.aim && was.aim && now.aim !== was.aim) ui("move");
  if (now.refusal && now.refusal !== was.refusal) ui("denied");
}
