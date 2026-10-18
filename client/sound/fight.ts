// New: a fight as it's heard (docs/sound-design.md): each moment's beats (client/fight/script.ts) as they play on the board, a step's tap, a blade's whoosh or a club's, a bow's twang, a spell cast and flying and landing in its element, a hit by its damage (a critical's crack), a miss, a parry, a fall, someone running off, the start's sting and the player's turn's chime. Each sounds when its beat plays, and all of a moment's stop if it's hurried past.
import type { Unit } from "../../shared/fight/types.ts";
import type { Beat } from "../fight/script.ts";
import { blowStyle, elementOf } from "../look/fight.ts";
import { hush, sfx } from "./cues.ts";

/** The group a fight's sounds are in: hurrying a moment along stops what's still to come of it. */
export const FIGHT = "fight";

/**
 * A moment's beats, each sounding `delay(beat)` ms from now: what the board shows, heard. An area's
 * blast is the moment's one boom (who it caught don't each go off again).
 */
export function fightSounds(beats: Beat[], units: Record<string, Unit>, delay: (b: Beat) => number): void {
  const area = beats.some(b => b.kind === "area");
  for (const b of beats) {
    const when = { delay: delay(b), group: FIGHT };
    switch (b.kind) {
      case "order": sfx("fight.start", {}, when); break;
      case "turn": if (units[b.unit]?.role === "player") sfx("fight.turn", {}, when); break;
      case "step": sfx("blow.step", {}, when); break;
      case "swing": sfx("blow.swing", { kind: blowStyle(b.with) }, when); break;
      case "shot": sfx("blow.shot", { kind: b.with, ms: b.ms }, when); break;
      case "bolt": {
        const element = elementOf(b.element, b.spell);
        sfx("spell.cast", element ? { element } : {}, when);
        sfx("spell.bolt", { ...(element ? { element } : {}), ms: b.ms, count: /missile/i.test(b.spell) ? 3 : 1 }, when);
        break;
      }
      case "area": {
        const element = elementOf(b.element, b.spell);
        const far = b.tiles.reduce((m, t) => Math.max(m, Math.hypot(t.x - b.to.x, t.y - b.to.y)), 0);
        sfx("spell.cast", element ? { element } : {}, when);
        sfx("spell.area", { ...(element ? { element } : {}), size: Math.max(5, (far + 0.5) * 5) }, { ...when, delay: when.delay + (element === "fire" ? Math.max(0, b.ms - 300) : b.ms * 0.5) });
        break;
      }
      case "hit":
        if (area && b.type && !/^(slashing|piercing|bludgeoning)$/.test(b.type)) break;
        sfx("blow.hit", { ...(b.type ? { kind: b.type } : {}), critical: b.critical }, when);
        break;
      case "heal": sfx("spell.heal", {}, when); break;
      case "miss": sfx(b.word === "parried" ? "blow.parry" : "blow.miss", {}, when); break;
      case "fall": sfx("blow.fall", {}, { ...when, delay: when.delay + b.ms * 0.4 }); break;
      case "gone": if (b.state === "fled") sfx("blow.flee", {}, when); break;
      default: break;
    }
  }
}

/** A fight's sounds still to come, stopped: the moment was hurried past, or skipped. */
export function hushFight(): void {
  hush(FIGHT);
}
