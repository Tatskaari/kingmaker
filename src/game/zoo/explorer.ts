import type { SessionState } from "../../runtime/session.ts";
import { areaAt, positionOf, type SceneWorld } from "../../world/scene-world.ts";
import {
  actorsAt, actorsHere, direction, enterScene, feetToTile, getMap, inRect, interact, leaveScene, move, newExploration, pathTo, roamRegion, steps, walkPlan,
  type ExploreState,
} from "../map/index.ts";
import type { Action, ExploreDone as Done, Explorer, GameState } from "../play.ts";
import { isMenuAct } from "../menu.ts";
import { actionsAt as townActionsAt, exploreState, interactLabel as townInteractLabel, targets, town, townOf, type LeadTarget, type TileActions } from "../town.ts";
import type { CombatResult, MapActor, Tile2 } from "../types.ts";
import { point, zooOf, type Cue, type Exhibit, type Outcome, type Show, type Trigger, type Wing } from "./model.ts";
import { HALL, ROOMS, WINGS, wingOf, type Room } from "./wings/index.ts";
import { freshWorld, inWing, outfit } from "./world.ts";

/**
 * The zoo on the map, behind the game core's Explorer (src/game/play.ts), as a hub: walk it like
 * the town, read the signs, set the exhibits off. Walking about, looking, talking and doors are the
 * town's own explorer (src/game/town.ts), on the zoo's maps with the wings' worlds live on them; the
 * zoo adds:
 *
 *   use_<trigger>          set an exhibit off (walking over first): a lever, a spell at a scarecrow, a fight
 *   go_to_lead             walk to the next exhibit you haven't seen (g)
 *   a scene's place        talking to whoever's waiting there, or stepping into its rooms, opens its scene
 *   a plate                walking onto it sets it off
 *
 * What a trigger did goes in the zoo's news (its rules lines and its effects), for the view to play
 * once (look.ts), and into "What happens" as words.
 */

const SIGHT = 10;
const COMPASS: Record<string, [number, number]> = {
  north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1], south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1],
};

export const WELCOME = "Welcome to the Zoo: everything the game does, laid out to see and try. Read a sign (right-click it, or face it and press e), set an exhibit off from its menu, and press g for the next exhibit you haven't seen. v looks down on a wing from above. The doors round the hall go to the wings.";

// ---------------------------------------------------------------------------------------------
// Where things are.

/** Every exhibit, with its wing. */
export const EXHIBITS: Array<Exhibit & { wing: Wing }> = WINGS.flatMap(w => w.exhibits.map(e => ({ ...e, wing: w })));

/** A trigger by id, with its exhibit and wing. */
export function triggerById(id: string): { trigger: Trigger; exhibit: Exhibit; wing: Wing } | undefined {
  for (const w of WINGS) for (const e of w.exhibits) for (const t of e.triggers) if (t.id === id) return { trigger: t, exhibit: e, wing: w };
  return undefined;
}

/** Where a trigger is offered now: its own tile, or where its thing is in the wing's world (undefined once it's gone). */
export function triggerTile(ex: ExploreState, wing: Wing, t: Trigger): Tile2 | undefined {
  if (typeof t.at !== "string") return t.at;
  const world = ex.roam?.[wing.id];
  const p = world ? positionOf(world, t.at) : undefined;
  const region = world ? roamRegion(getMap(wing.id), world) : undefined;
  return p && region && !world!.entities[t.at]?.states.includes("gone") ? feetToTile(region, p) : undefined;
}

interface Offered { trigger: Trigger; exhibit: Exhibit; wing: Wing; at: Tile2; distance: number; direction: string }

/** The triggers on this map within so many steps, nearest first. */
function offered(game: GameState, session: SessionState | undefined, radius = SIGHT): Offered[] {
  const ex = exploreState(game);
  const wing = wingOf(ex.map);
  if (!wing || ex.scene) return [];
  const out: Offered[] = [];
  for (const e of wing.exhibits) for (const t of e.triggers) {
    const at = triggerTile(ex, wing, t);
    if (!at || steps(at, ex.at) > radius) continue;
    if (t.when && session && !onOffer(game, session, ex, wing, t)) continue;
    out.push({ trigger: t, exhibit: e, wing, at, distance: steps(at, ex.at), direction: direction(ex.at, at) });
  }
  return out.sort((a, b) => a.distance - b.distance || a.trigger.id.localeCompare(b.trigger.id));
}

/** A trigger's `when`, asked of the wing's world as it stands (it only reads). */
function onOffer(game: GameState, session: SessionState, ex: ExploreState, wing: Wing, t: Trigger): boolean {
  const world = ex.roam?.[wing.id];
  if (!world || !t.when) return !!world;
  try {
    return t.when({ game, session, ex, zoo: zooOf(game), wing, world, turn: zooOf(game).turns[wing.id] ?? 1, ops: () => [], tick: () => [], at: id => positionOf(world, id) ?? { x: 0, y: 0 }, thing: id => world.entities[id]! });
  } catch { return false; }
}

/** The room of one of the zoo's scenes that a tile is in (a room, not the street outside it). */
function roomAt(mapId: string, at: Tile2): Room | undefined {
  return ROOMS.find(r => r.map === mapId && r.rooms.some(rect => inRect(rect, at)));
}

/** A scene's host: someone waiting in one of the zoo's scenes' places, whose scene opens when they're spoken to. */
function hostScene(a: MapActor | undefined): string | undefined {
  const i = a?.interaction;
  return i?.kind === "scene" && ROOMS.some(r => r.sceneId === i.sceneId) ? i.sceneId : undefined;
}

// ---------------------------------------------------------------------------------------------
// The next exhibit (the zoo's lead).

/** The next exhibit not yet seen: the wing you're in first, then the zoo's order (the hall, then each wing). */
export function nextExhibit(game: GameState): (Exhibit & { wing: Wing }) | undefined {
  const seen = new Set(zooOf(game).seen);
  const ex = exploreState(game);
  return EXHIBITS.find(e => e.wing.id === ex.map && !seen.has(e.id)) ?? EXHIBITS.find(e => !seen.has(e.id));
}

/** Where g walks: the next exhibit's sign on this map, or the way towards its wing. */
export function zooLead(game: GameState): LeadTarget | undefined {
  const ex = exploreState(game);
  if (ex.scene) return undefined;
  const next = nextExhibit(game);
  if (!next) return undefined;
  if (next.wing.id === ex.map) return { at: next.sign, label: next.title, onto: false };
  const map = getMap(ex.map);
  const nearest = (exits: typeof map.exits) => [...exits].sort((a, b) => steps(a.at, ex.at) - steps(b.at, ex.at))[0];
  // The door to its wing, or to the wing its door is in (the chandlery is through the annexe); anywhere else, the way back to the hall.
  const to = (id: string | undefined) => (id ? nearest(map.exits.filter(e => e.to.map === id)) : undefined);
  const way = to(next.wing.id) ?? to(next.wing.via) ?? to(HALL.id) ?? nearest(map.exits);
  // "The Arena", not "The Arena (the Arena)": a wing's own sign is called what the wing is.
  const bare = (t: string) => t.toLowerCase().replace(/^the /, "");
  const label = bare(next.title) === bare(next.wing.name) ? next.title : `${next.title} (${next.wing.name})`;
  return way ? { at: way.at, label, onto: true, via: way.label } : undefined;
}

// ---------------------------------------------------------------------------------------------
// Doing things.

/** Mark an exhibit seen (its sign read, or set off). */
function saw(game: GameState, id: string): void {
  const z = zooOf(game);
  if (!z.seen.includes(id)) z.seen.push(id);
}

/** What a trigger left for the view to play, numbered so it's played once. */
function report(game: GameState, map: string, lines: string[], cues: Cue[]): void {
  const z = zooOf(game);
  z.seq++;
  z.news = { seq: z.seq, map, lines, cues };
}

/** Something for the screen to show once beyond the map (a sign in full, The End, the window). */
function show(game: GameState, kind: Show["kind"], id?: string): void {
  const z = zooOf(game);
  z.seq++;
  z.show = { seq: z.seq, kind, ...(id ? { id } : {}) };
}

/** One step: the map's move, then what it walked into (a scene's host), into (a scene's room) or onto (a plate). */
function stepOnce(game: GameState, dx: number, dy: number): { text: string; moved: boolean; travelled?: boolean; open?: string; plate?: Trigger } {
  const ex = exploreState(game);
  const from = { map: ex.map, at: { ...ex.at } };
  const r = move(ex, dx, dy);
  // Bumping into someone whose scene is waiting opens it, as talking to them would.
  const bumped = hostScene(r.bumped);
  if (bumped) return { text: `You go over to ${r.bumped!.name}.`, moved: false, open: bumped };
  const text = r.trigger ? "" : r.message ?? "";
  if (r.travelled) return { text, moved: true, travelled: true };
  if (!r.moved) return { text: text || "You stay where you are.", moved: false };
  // Into one of the zoo's scenes' rooms from outside them: the scene opens, as stepping into the Rat does.
  const room = roomAt(ex.map, ex.at);
  if (room && (from.map !== ex.map || !room.rooms.some(rect => inRect(rect, from.at)))) return { text: text || `You step into ${room.name}.`, moved: true, open: room.sceneId };
  const plate = wingOf(ex.map)?.exhibits.flatMap(e => e.triggers).find(t => t.step && typeof t.at !== "string" && t.at.x === ex.at.x && t.at.y === ex.at.y);
  return { text, moved: true, ...(plate ? { plate } : {}) };
}

/** Walk a path a step at a time, as keys would, stopping at anything in the way, a way out or a scene. */
function walk(game: GameState, path: Array<[number, number]>): { said: string[]; opened?: string } {
  const said: string[] = [];
  for (const [dx, dy] of path) {
    const r = stepOnce(game, dx, dy);
    if (r.text) said.push(r.text);
    if (r.open) return { said: arrived(said), opened: r.open };
    if (r.travelled || !r.moved) break;
  }
  return { said: arrived(said) };
}

/** Coming into somewhere new on the way is worth a word; the last one is enough. */
const arrived = (said: string[]) => said.filter((s, i) => !/^You come into/.test(s) || !said.slice(i + 1).some(t => /^You come into/.test(t)));

/** Walk up beside a tile (or onto it, for a plate), the shortest way. */
function walkBeside(game: GameState, at: Tile2, onto = false): { said: string[]; there: boolean; opened?: string } {
  const ex = exploreState(game);
  const near = onto ? 0 : 1;
  if (steps(ex.at, at) <= near) return { said: [], there: true };
  const path = pathTo(ex, at);
  if (!path) return { said: ["You can't see a way to it from here."], there: false };
  // Beside it is enough: stop at the first step that's within reach.
  const cut: Array<[number, number]> = [];
  let p = { ...ex.at };
  for (const [dx, dy] of path) {
    if (steps(p, at) <= near) break;
    cut.push([dx, dy]);
    p = { x: p.x + dx, y: p.y + dy };
  }
  const map = ex.map;
  const walked = walk(game, cut);
  const now = exploreState(game);
  if (walked.opened) return { said: walked.said, there: false, opened: walked.opened };
  return { said: walked.said, there: now.map === map && steps(now.at, at) <= near };
}

/** Set a trigger off (walking over first), in its wing's world. */
async function setOff(game: GameState, session: SessionState, id: string): Promise<Done> {
  const found = triggerById(id);
  if (!found) throw new Error(`Unavailable action: use_${id}. Observe again for what's about.`);
  const { trigger, exhibit, wing } = found;
  const ex = exploreState(game);
  if (ex.map !== wing.id) throw new Error(`Unavailable action: use_${id}: that's in ${wing.name}.`);
  const at = triggerTile(ex, wing, trigger);
  if (!at) return { text: `There's nothing there any more to ${trigger.label.charAt(0).toLowerCase()}${trigger.label.slice(1)}.` };
  if (trigger.when && !onOffer(game, session, ex, wing, trigger)) return { text: `That isn't on offer just now (${trigger.label}).` };
  const walked = walkBeside(game, at, !!trigger.step || !!trigger.stand);
  if (walked.opened) return { text: walked.said.join(" "), open: walked.opened };
  if (!walked.there) return { text: walked.said.join(" ") || "You can't get to it from here." };
  return run(game, session, wing, exhibit, trigger, walked.said);
}

async function run(game: GameState, session: SessionState, wing: Wing, exhibit: Exhibit, trigger: Trigger, said: string[] = []): Promise<Done> {
  const ex = exploreState(game);
  saw(game, exhibit.id);
  const outcome: Outcome = await inWing(game, session, ex, wing, z => trigger.run(z));
  report(game, wing.id, outcome.lines ?? [], outcome.cues ?? []);
  if (outcome.show) show(game, outcome.show);
  if (outcome.fight) zooOf(game).fight = { arena: outcome.fight, from: { map: ex.map, at: { ...ex.at } } };
  const text = [...said, outcome.text].filter(Boolean).join(" ");
  return { text, ...(outcome.open ? { open: outcome.open } : {}), ...(outcome.fight ? { fight: true } : {}) };
}

/** The exhibit whose sign an action reads, if it reads one: looked at by its tile, by its id, or faced (e). */
function signRead(game: GameState, session: SessionState, id: string): string | undefined {
  const ex = exploreState(game);
  const tile = /^look@(\d+),(\d+)$/.exec(id);
  const actor = tile ? actorsAt(ex, { x: Number(tile[1]), y: Number(tile[2]) })[0]
    : /^examine_/.test(id) ? targets(game, session).find(t => t.id === id)?.actor
    : id === "interact" ? interact(ex)?.actor : undefined;
  return actor ? /^[^:]+:sign:(.+)$/.exec(actor.id)?.[1] : undefined;
}

/**
 * After the town's walking about: a scene's room walked into, or a plate walked onto. A scene the
 * town thought it opened (it only knows the story's lead) is whoever's waiting beside you.
 */
async function afterTown(game: GameState, session: SessionState, done: Done, before: { map: string; at: Tile2 }): Promise<Done> {
  const ex = exploreState(game);
  if (done.scene) {
    delete done.scene;
    const near = actorsHere(ex).find(a => steps(a.at, ex.at) <= 1 && hostScene(a));
    if (near) return { ...done, open: hostScene(near)! };
  }
  if (ex.map === before.map && ex.at.x === before.at.x && ex.at.y === before.at.y) return done;
  const room = roomAt(ex.map, ex.at);
  if (room && (before.map !== ex.map || !room.rooms.some(r => inRect(r, before.at)))) return { ...done, open: room.sceneId };
  const wing = wingOf(ex.map);
  const plate = wing?.exhibits.flatMap(e => e.triggers.map(t => ({ e, t }))).find(({ t }) => t.step && typeof t.at !== "string" && t.at.x === ex.at.x && t.at.y === ex.at.y);
  if (plate && wing) {
    const fired = await run(game, session, wing, plate.e, plate.t);
    return { ...fired, text: [done.text, fired.text].filter(Boolean).join(" ") };
  }
  return done;
}

async function act(game: GameState, session: SessionState, id: string): Promise<Done> {
  const ex = exploreState(game);
  const before = { map: ex.map, at: { ...ex.at } };
  const use = /^use_(.+)$/.exec(id);
  // An exhibit's trigger; anything else used (a potion, from the action menu) is the town's to do.
  if (use && triggerById(use[1]!)) return setOff(game, session, use[1]!);
  if (id === "go_to_lead") {
    const lead = zooLead(game);
    if (!lead) return { text: "You've seen everything the zoo has. The exhibits don't mind being seen again." };
    const path = pathTo(ex, lead.at);
    if (!path) return { text: `You can't see a way to ${lead.label} from here.` };
    // Up to the sign (beside it), or through the way out.
    const walked = walk(game, lead.onto || !path.length ? path : path.slice(0, -1));
    const text = walked.said.join(" ") || `You're at ${lead.label}.`;
    return walked.opened ? { text, open: walked.opened } : { text };
  }
  const step = /^walk_(\w+)$/.exec(id);
  if (step && COMPASS[step[1]!]) {
    const [dx, dy] = COMPASS[step[1]!]!;
    const r = stepOnce(game, dx, dy);
    if (r.open) return { text: r.text, open: r.open };
    if (r.plate) {
      const found = triggerById(r.plate.id)!;
      const fired = await run(game, session, found.wing, found.exhibit, found.trigger);
      return { ...fired, text: [r.text, fired.text].filter(Boolean).join(" ") };
    }
    return { text: r.text };
  }
  if (id === "interact") {
    const it = interact(ex);
    // Whoever's waiting in a scene's place, in front of you.
    const host = hostScene(it?.actor);
    if (host) return { text: `You go over to ${it!.actor!.name}.`, open: host };
    // A trigger in front of you; or beside you, when there's nothing else here to do anything with.
    const front = { x: ex.at.x + ex.facing.x, y: ex.at.y + ex.facing.y };
    const here = offered(game, session, 1);
    const pick = here.find(o => o.at.x === front.x && o.at.y === front.y) ?? (it ? undefined : here[0]);
    if (pick) return setOff(game, session, pick.trigger.id);
  }
  // Talking to someone waiting in a scene's place opens it (walking over first).
  const byTile = /^talk@(\d+),(\d+)$/.exec(id);
  if (byTile || /^talk_/.test(id)) {
    const host = byTile ? actorsAt(ex, { x: Number(byTile[1]), y: Number(byTile[2]) }).find(a => hostScene(a)) : targets(game, session).find(t => t.id === id && hostScene(t.actor))?.actor;
    if (host) {
      const walked = walkBeside(game, host.at);
      if (walked.opened) return { text: walked.said.join(" "), open: walked.opened };
      if (!walked.there) return { text: walked.said.join(" ") || `You can't get to ${host.name} from here.` };
      return { text: [...walked.said, `You go over to ${host.name}.`].join(" "), open: hostScene(host)! };
    }
  }
  // A click walks a step at a time, so a scene's room walked into opens on the way (and a plate under you fires).
  const click = /^(?:walk|door)@(\d+),(\d+)$/.exec(id);
  if (click) {
    const plan = walkPlan(ex, { x: Number(click[1]), y: Number(click[2]) });
    if (!plan) return { text: "You can't see a way any nearer that from here." };
    const walked = walk(game, plan.path);
    if (walked.opened) return { text: walked.said.join(" "), open: walked.opened };
    return afterTown(game, session, { text: walked.said.join(" ") || (plan.reaches ? "You're already there." : "You're as near as you can get.") }, before);
  }
  // The town's way of walking about: look, examine, talk, doors and ways out; and the action menu's
  // acts (a spell, a leap, a rest), which the rules do on the wing's own world (src/game/town-world.ts).
  const sign = signRead(game, session, id);
  const done = await town.act(game, session, id);
  // A sign read is shown in full (the app's card), as well as said.
  if (sign) { saw(game, sign); show(game, "sign", sign); }
  // What the menu's act did plays on the map as an exhibit's does (the zoo's news: its rules lines, and what changed in the world).
  if (isMenuAct(id)) report(game, ex.map, (done as { lines?: string[] }).lines ?? done.text.split("\n").filter(Boolean), []);
  return afterTown(game, session, done, before);
}

// ---------------------------------------------------------------------------------------------
// What's offered, for the QA console and the app.

const slugOf = (s: string) => s.toLowerCase().replace(/'s\b/g, "s").replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function actions(game: GameState, session: SessionState): Action[] {
  const ex = exploreState(game);
  const out: Action[] = [];
  const lead = zooLead(game);
  if (lead) out.push({ id: "go_to_lead", label: `Walk to the next exhibit: ${lead.label}${lead.via ? ` (${lead.via.charAt(0).toLowerCase()}${lead.via.slice(1)} first)` : ""}`, kind: "move" });
  for (const o of offered(game, session)) {
    const reach = o.distance <= (o.trigger.step || o.trigger.stand ? 0 : 1);
    out.push({ id: `use_${o.trigger.id}`, label: reach ? o.trigger.label : `${o.trigger.label} (${o.distance} steps ${o.direction}: you walk over first)`, kind: "use" });
  }
  const wing = wingOf(ex.map);
  // The wing itself isn't somewhere to walk to: you're in it.
  for (const a of town.actions(game, session)) if (!wing || a.id !== `go_to_${slugOf(wing.name)}`) out.push(a);
  return out;
}

function observe(game: GameState, session: SessionState): string {
  const ex = exploreState(game);
  const wing = wingOf(ex.map);
  const here = offered(game, session, 6);
  const next = nextExhibit(game);
  const lead = zooLead(game);
  return [
    town.observe(game, session),
    ...(wing ? [wing.about] : []),
    ...(here.length ? [`To set off here: ${here.slice(0, 8).map(o => `${o.trigger.label} (${o.distance <= 1 ? "here" : `${o.distance} ${o.direction}`})`).join("; ")}.`] : []),
    ...(next && lead ? [`Next exhibit: ${next.title} in ${next.wing.name}${lead.via ? `: ${lead.via.charAt(0).toLowerCase()}${lead.via.slice(1)} first` : `, ${steps(lead.at, ex.at)} step${steps(lead.at, ex.at) === 1 ? "" : "s"} ${direction(ex.at, lead.at)}`}.`] : []),
    `Seen ${zooOf(game).seen.length} of ${EXHIBITS.length} exhibits.`,
  ].join("\n\n");
}

/** What a tile offers: its triggers first, then whatever the town offers (talk, look, go through, walk). */
function zooActionsAt(game: GameState, session: SessionState | undefined, at: Tile2): TileActions {
  const base = townActionsAt(game, session, at);
  const ex = exploreState(game);
  const wing = wingOf(ex.map);
  const mine: Action[] = [];
  if (wing && !ex.scene) for (const e of wing.exhibits) for (const t of e.triggers) {
    const tile = triggerTile(ex, wing, t);
    if (!tile || tile.x !== at.x || tile.y !== at.y) continue;
    if (t.when && session && !onOffer(game, session, ex, wing, t)) continue;
    mine.push({ id: `use_${t.id}`, label: t.label, kind: "use" });
  }
  // Someone waiting in a scene's place: talking to them opens it.
  const host = actorsAt(ex, at).some(a => hostScene(a));
  return { ...base, actions: [...mine, ...base.actions.map(a => (host && a.kind === "talk" ? { ...a, label: `${a.label} (the scene begins)` } : a))] };
}

function zooInteractLabel(game: GameState, session?: SessionState): { label: string; scene: boolean } | undefined {
  const ex = exploreState(game);
  const it = interact(ex);
  if (hostScene(it?.actor)) return { label: `${it!.interaction.label} (the scene begins)`, scene: true };
  const front = { x: ex.at.x + ex.facing.x, y: ex.at.y + ex.facing.y };
  const here = offered(game, session, 1);
  const pick = here.find(o => o.at.x === front.x && o.at.y === front.y) ?? (it ? undefined : here[0]);
  if (pick) return { label: pick.trigger.label, scene: false };
  return townInteractLabel(game, session);
}

const note = (game: GameState, text: string) => {
  if (!text) return;
  const town = townOf(game);
  town.log = [...town.log, text].slice(-5);
};

/** Where to come back to from a rehearsal on the story's own maps (kept in the zoo's state while it lasts). */
type Back = { back?: { map: string; at: Tile2 } };

// ---------------------------------------------------------------------------------------------
// The explorer.

export const zoo = {
  hub: true,

  start(game: GameState, session?: SessionState) {
    // The zoo's own story: no lead, nothing played, morning by the clock, Kell in her corner until asked.
    game.story = { time: "morning", played: [], flags: { kell: false } };
    const ex = newExploration(structuredClone(game.story), { map: HALL.id, at: HALL.entry });
    ex.roam = Object.fromEntries(WINGS.map(w => [w.id, freshWorld(w, { name: session?.player.name ?? "you" })]));
    game.explore = { ex, log: [], zoo: { version: 1, seen: [], turns: {}, seq: 0 } } as unknown as Record<string, unknown>;
    if (session) outfit(session);
    game.recent = [WELCOME];
  },

  observe,
  actions,

  async act(game: GameState, session: SessionState, id: string): Promise<Done> {
    const ex = exploreState(game);
    const was = ex.hidden ? { map: ex.map, at: { ...ex.at } } : undefined;
    const done = await act(game, session, id);
    // Hidden (the action menu's Hide) only until you show yourself, as in the town, whose own acts see
    // to it: a step out into the open, a scene, an exhibit set off.
    const shown = was && (ex.map !== was.map || ex.at.x !== was.at.x || ex.at.y !== was.at.y || !!done.open || !!done.scene || !!done.talk || (/^use_/.test(id) && !!triggerById(id.slice(4))));
    if (shown && ex.hidden) {
      delete ex.hidden;
      done.text = [done.text, "(You're in plain sight again.)"].filter(Boolean).join("\n");
    }
    note(game, done.text);
    syncPlayer(game);
    return done;
  },

  enterScene(game: GameState, session: SessionState) {
    const ex = exploreState(game);
    (zooOf(game) as Back).back = { map: ex.map, at: { ...ex.at } };
    // Played again, its place starts again: what the last time left goes.
    delete ex.overlay.scenes[session.sceneId];
    enterScene(ex, session.sceneId);
  },

  leaveScene(game: GameState, session: SessionState) {
    const ex = exploreState(game);
    leaveScene(ex, session.world);
    const z = zooOf(game) as Back;
    // A rehearsal of one of the story's own scenes was on the story's maps: back to the zoo, and the story's places as they were.
    if (!wingOf(ex.map) && !ROOMS.some(r => r.map === ex.map) && z.back) {
      ex.map = z.back.map;
      ex.at = { ...z.back.at };
      for (const f of ex.followers) { f.map = ex.map; f.at = { ...ex.at }; }
      delete ex.overlay.scenes[session.sceneId];
    }
    delete z.back;
  },

  afterScene(game: GameState) {
    exploreState(game);
  },

  afterFight(game: GameState, session: SessionState, result: CombatResult) {
    return afterArena(game, session, result);
  },

  actionsAt: zooActionsAt,
  interactLabel: zooInteractLabel,
  lead: zooLead,
} satisfies Explorer;

/** What happens after a fight from the map: the arena's (fights.ts) says, once it's loaded. */
let afterArena: (game: GameState, session: SessionState, result: CombatResult) => string = (_g, _s, result) => `The fight: ${result.summary}`;
export function onArenaOver(f: typeof afterArena): void { afterArena = f; }

/** A zoo game? (Its state says so.) */
export const isZoo = (game: GameState) => game.hub === "zoo";

/** A wing's world as it is now (the tour and the tests read it). */
export const wingWorld = (game: GameState, wing: string): SceneWorld | undefined => exploreState(game).roam?.[wing];

/** Is a trigger on offer now (its thing still there, its `when` true)? It may be further than a step away. */
export function available(game: GameState, session: SessionState, id: string): boolean {
  const found = triggerById(id);
  if (!found) return false;
  const ex = exploreState(game);
  if (ex.map !== found.wing.id || ex.scene) return false;
  return !!triggerTile(ex, found.wing, found.trigger) && (!found.trigger.when || onOffer(game, session, ex, found.wing, found.trigger));
}

/** Put the visitor somewhere in the zoo at once (the tour's way between wings; walking does the same through the doors). */
export function placePlayer(game: GameState, map: string, at: Tile2): void {
  const ex = exploreState(game);
  ex.map = map;
  ex.at = { ...at };
  for (const f of ex.followers) { f.map = map; f.at = { ...at }; }
  syncPlayer(game);
}

/** The wing's world has the visitor where the map has them (for the view from above, and what's near them). */
function syncPlayer(game: GameState): void {
  const ex = exploreState(game);
  const world = ex.roam?.[ex.map];
  const me = world?.entities.player;
  if (!world || !me || ex.scene) return;
  me.at = point(ex.at);
  me.parent = areaAt(world, me.at).id;
}

/** A wing's world put back as it was at the start (each wing's "put everything back" lever). */
export function resetWing(game: GameState, session: SessionState, wing: Wing): void {
  const ex = exploreState(game);
  ex.roam = { ...(ex.roam ?? {}), [wing.id]: freshWorld(wing, { name: session.player.name }) };
  delete zooOf(game).turns[wing.id];
}
