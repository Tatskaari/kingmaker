// The prototype's src/game/town.ts:465-490 at 44c6d4a (the action menu's entry points: actionMenu, aimFor, aimAt, entryOf) and :567-583 (the menu's acts among the map's ACTIONS: menuActions), on the client: over the shared menu the simulation refuses by (shared/map/menu.ts, on shared/map/town-world.ts's townWorld), from the explore view's rows (town-design §3.3: the ExploreState, the sheet's catalogue, the explore row's keep) in place of the game and the session. The town's world is built once a state (the view's state is never changed in place). New: TownMenu, the seam the screen check and the tests put a fixture in.
import type { ExploreState } from "../../shared/map/explore.ts";
import { aimView, checkAim, menuOf, menuText, type AimAt, type AimView, type Keep, type MenuCtx, type MenuView } from "../../shared/map/menu.ts";
import { townWorld, type TownWorld } from "../../shared/map/town-world.ts";
import type { Action } from "../../shared/map/town.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import type { Catalogue, Entry } from "../../shared/rules/aim.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";

/**
 * The action menu on the map as the client asks for it (the app's m, a right-click's "Do
 * something…", aiming): what's on offer, what an entry can be aimed at from here, what it would do
 * at a tile, the menu as QA observation text, and the town's world the effects play in.
 */
export interface TownMenu {
  /** What the player can do here, by kind, and what's in reach; `at`: aimed at that tile already. */
  menu(c: MenuCtx, at?: Tile2): MenuView | undefined;
  /** What one of the menu's entries (by its key) can be aimed at from here: its reach, and who and what is in it. */
  aim(c: MenuCtx, key: string): AimView | undefined;
  /** An entry aimed at a tile: whether it can be (and why not, there), what an area would cover and catch, and the action id to do it with. */
  check(c: MenuCtx, key: string, at: Tile2): AimAt | undefined;
  /** The menu as a QA observation says it (headless observe). */
  text(c: MenuCtx): string;
  /** The town's world as the rules see it now: where what an act did plays out on the map. */
  world(ex: ExploreState): SceneWorld | undefined;
}

/** The menu's context from what the explore view has: the state, the sheet's catalogue, the keep. */
export const menuCtx = (view: { ex: ExploreState; catalogue?: Catalogue | undefined; keep?: Keep | undefined }): MenuCtx => ({ ex: view.ex, catalogue: view.catalogue, keep: view.keep ?? {} });

/** A menu entry as the rules have it (what it needs and why it can't be done at all), before what's in reach is counted: the sheet's catalogue's. */
export const entryOf = (c: MenuCtx, key: string): Entry | undefined => c.catalogue?.entries.find(e => e.key === key);

/** The town's world for a state, built once for it: a menu asks of every tile in reach, and aiming at each tile the pointer crosses. */
const worlds = new WeakMap<ExploreState, TownWorld>();
function worldOf(ex: ExploreState): TownWorld {
  let tw = worlds.get(ex);
  if (!tw) { tw = townWorld(ex); worlds.set(ex, tw); }
  return tw;
}

/** The menu over the shared code: the simulation refuses by the same checks the client offers and greys out by. */
export const SHARED_TOWN: TownMenu = {
  menu: (c, at) => (c.catalogue ? menuOf(c, at) : undefined),
  aim: (c, key) => { const entry = entryOf(c, key); return entry ? aimView(c, worldOf(c.ex), entry) : undefined; },
  check: (c, key, at) => { const entry = entryOf(c, key); return entry ? checkAim(c, worldOf(c.ex), entry, at) : undefined; },
  text: c => (c.catalogue ? menuText(c) : ""),
  world: ex => worldOf(ex).world,
};

/**
 * The menu's acts as the QA console lists them among the map's ACTIONS (the prototype's town.ts
 * :567-583): what needs no aiming, and for what does the nearest of what's in reach (for an area,
 * the nearest it doesn't catch you in) and yourself, when it can be; observe's menu text lists the rest.
 */
export function menuActions(town: TownMenu, c: MenuCtx): Action[] {
  const menu = town.menu(c);
  const out: Action[] = [];
  for (const e of menu?.sections.flatMap(s => s.entries) ?? []) {
    if (e.why || !e.act) continue;
    const kind: Action["kind"] = e.key === "jump" ? "move" : e.effect === "harm" ? "fight" : e.key.startsWith("rest") ? "wait" : "use";
    if (e.id) { out.push({ id: e.id, label: `${e.name}: ${e.summary}`, kind }); continue; }
    const view = town.aim(c, e.key);
    if (!view) continue;
    const near = e.aim.kind === "area" ? view.targets.find(t => !(town.check(c, e.key, t.at)?.caught ?? []).includes("you")) : view.targets[0];
    if (view.selfReady) out.push({ id: `${e.act}_self`, label: `${e.name} on yourself (${e.summary})`, kind });
    if (near) out.push({ id: near.id, label: `${e.name} ${e.key === "jump" ? "to" : e.effect === "harm" ? "at" : "on"} ${near.name} (${e.summary})`, kind });
  }
  return out;
}
