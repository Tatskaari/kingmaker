// New (M6's screen, docs/combat-design.md §2 and §3): the fight's board drawn by the map's renderer, as the prototype's fightView drew it (src/game/views.ts at bc2ab1f): the place's own map, roofs off, everyone where the playback has them at this instant (a fall tipping their glyph over, a hit lighting them up), the lights and the brazier, the dust and the fire, the effects playing, whose turn lit on their tile, and on the player's turn the tiles they can walk to (those that would draw a swing in another tint), or what's being aimed: its reach, its targets, the one aimed at bracketed and an area's tiles.
import { fromKey } from "../../shared/fight/grid.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import { spellElement } from "../look/director.ts";
import { activeTint, areaTint, feetOf, fightRegion, propActor, TINT, unitActor } from "../look/fight.ts";
import type { GlyphSet } from "../look/glyphs.ts";
import type { Picks, RenderOptions, Viewport } from "../map/render.ts";
import { renderXray } from "../map/xray.ts";
import type { StyledLine } from "../ui/types.ts";
import type { FightModel } from "./model.ts";
import type { PlayFrame } from "./player.ts";
import { scriptOf } from "./script.ts";

export interface DrawOptions {
  /** The clock (ms) the frame is of. */
  t: number;
  glyphs?: GlyphSet;
  /** Filled in with what's drawn where, for the mouse. */
  pick?: Picks;
  /** false: plain characters (tests, logs). */
  color?: boolean;
}

/**
 * The fight's board at an instant (docs/combat-design.md §2): drawn from the model's playback (where
 * everyone stands now, who's falling and lit up), the board's lights and hazards, the playback's
 * effects, and the marks for the turn: whose it is, where the player can go, what they're aiming.
 */
export function drawFight(model: FightModel, size: Viewport, options: DrawOptions): StyledLine[] {
  const view = model.view, board = view.board, map = view.map;
  const play = model.player.frame(options.t);
  const actors = Object.values(board.units).flatMap(u => {
    const stance = play.stances[u.id];
    const a = stance ? unitActor(u, stance, map.id, play.falling[u.id]) : undefined;
    return a ? [a] : [];
  });
  for (const p of Object.values(board.props)) {
    const carrier = p.carriedBy ? play.stances[p.carriedBy] : undefined;
    if (p.carriedBy && (!carrier || carrier.state === "fled")) continue;
    const a = propActor(p, map.id, carrier?.at);
    if (a) actors.push(a);
  }
  const marks = marksOf(model, play, options.t);
  const aimed = model.aimed();
  const pc = play.stances[board.pc]?.at ?? board.units[board.pc]!.at;
  const acting = play.playing?.event.actor ? play.stances[play.playing.event.actor]?.at : undefined;
  const focus = aimed?.at ?? acting ?? (play.stances[play.turn]?.at) ?? pc;
  const camera = model.cameraFor(size, focus, options.t);
  const region = fightRegion(map);
  const effects = { region, frame: model.player.fx.frame(options.t, id => { const s = play.stances[id]; return s ? feetOf(s.at) : undefined; }) };
  const dust = board.dust.map(fromKey), fire = board.fire.map(fromKey);
  const hazards = { dust, fire, ...(board.flags["dust_exploded"] ? { scorched: dust } : {}) };
  const lit = Object.values(board.props).some(p => p.lit && p.state === "standing");
  const opts: RenderOptions = {
    roofs: false, time: board.time ?? (lit ? "night" : "afternoon"), focus: pc, reveal: Object.values(play.stances).map(s => s.at), hazards, effects,
    t: options.t, ...(options.glyphs ? { glyphs: options.glyphs } : {}), ...(options.color === false ? { color: false } : {}), ...(options.pick ? { pick: options.pick } : {}),
    ...(marks.length ? { marks } : {}), ...(aimed?.at ? { cursor: aimed.at } : {}), ...(model.hover && !model.aim ? { hover: model.hover } : {}),
    ...(Object.keys(play.flash).length ? { flash: play.flash } : {}),
  };
  return renderXray(map, actors, camera, size, opts);
}

/**
 * The board's tints: whose turn it is (their tile breathing gold, brightest as their turn begins);
 * a spell's area as it plays (its tiles lit in its element's colour from its beat to the blast's
 * landing); on the player's turn, the tiles they can walk to (blue) and those a walk to would draw a
 * swing (rust); while aiming, how far it reaches (a faint ring), who it could be aimed at, and the
 * aimed area's tiles in its element's colour.
 */
export function marksOf(model: FightModel, play: PlayFrame, t: number): NonNullable<RenderOptions["marks"]> {
  const { turn, stances, fresh } = play;
  const out = new Map<string, { at: Tile2; color: string }>();
  const put = (at: Tile2, color: string) => out.set(`${at.x},${at.y}`, { at: { ...at }, color });
  const playing = play.playing;
  if (playing && playing.event.kind === "cast" && playing.event.detail.area?.length && !model.reduced) {
    const area = scriptOf(playing.event).beats.find(b => b.kind === "area");
    if (area && playing.elapsed >= area.t && playing.elapsed < area.t + area.ms + 450) for (const a of playing.event.detail.area) put(a, areaTint(playing.event.detail.element, true));
  }
  const o = model.options;
  if (o && model.canAct() && !model.player.busy(t)) {
    if (model.aim) {
      const aimed = model.aimed();
      for (const r of model.ringOf(aimed?.range ?? 0)) put(r, TINT.ring);
      for (const target of model.aim.entry.options) if (target.at) put(target.at, TINT.target);
      for (const a of aimed?.area ?? []) put(a, areaTint(spellElement(model.aim.entry.name), true));
    } else if (!model.menu) {
      for (const m of o.moves) put(m, TINT.reach);
      for (const s of o.swings ?? []) put(s, TINT.swing);
    }
  }
  const active = stances[turn];
  if (active && model.view.status === "on") put(active.at, activeTint(t, fresh));
  return [...out.values()];
}
