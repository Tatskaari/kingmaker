// The prototype's src/app/game.ts at 44c6d4a, its look section (:2141-2192: sceneLook, animate, animateRolls, observeScene), as a model fed by the scene's views: the world is the one rebuilt from the place's rows (view.place), a finished entry is a transcript row new since the last view, and the aliases are the names the lead knows the cast by (my_names).
import { Director } from "../look/director.ts";
import { Effects } from "../look/effects.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";
import type { PlaceView, SceneView } from "./view.ts";

/**
 * The scene's place on screen (the world bridge's §3.5): the world as the rows last had it, and the
 * effects and the director that turn what changes in it into motion. One Effects and one Director a
 * scene, primed on the first world seen: what's there already, and what was said before, isn't news.
 * Then, on each view: the rules' new lines (a spell, its damage, what it broke) play from the caster
 * to the aim with the numbers floated; a reply's short spoken lines go over their speakers' heads;
 * and whatever else changed in the world (who walked where, what caught fire, what got wet) is
 * observed. The world stays as it was last seen when a view comes without one, as the prototype's
 * kept the world a scene left.
 */
export class PlaceModel {
  /** The place as the last view with one had it. */
  shown?: PlaceView;
  /** The scene's effects and director: a new pair for another scene. */
  look?: { scene: string; fx: Effects; director: Director };
  /** How many of the scene's entries have been played (or were there when its place was first seen). */
  private played = 0;
  private readonly clock: () => number;

  /** `clock` is the look's (the canvas paints at performance.now()); a test passes its own. */
  constructor(clock: () => number = () => performance.now()) {
    this.clock = clock;
  }

  get world(): SceneWorld | undefined { return this.shown?.world; }

  /** A new view: the place's world as it has it, and what's new in it played. */
  update(view: SceneView): void {
    const place = view.place;
    if (!place) return;
    this.shown = place;
    const world = place.world;
    if (this.look?.scene !== world.scene) {
      const fx = new Effects();
      const director = new Director(fx);
      director.prime(world);
      this.look = { scene: world.scene, fx, director };
      this.played = view.entries.length;
      return;
    }
    const t = this.clock();
    const { director } = this.look;
    const fresh = view.entries.slice(Math.min(this.played, view.entries.length));
    this.played = view.entries.length;
    const rolled: string[] = [];
    for (const entry of fresh) {
      // A spell and what it did land as a burst of lines: they're shown together, below.
      if (entry.kind === "roll") rolled.push(entry.text);
      // Who says what is known (the GM's tags): each short line over whoever said it.
      else if (entry.kind === "narration" && entry.markup?.speech.some(s => s.speaker)) director.barksFromSpeech(world, entry.markup.speech.map(s => ({ speaker: s.speaker, text: entry.text.slice(s.start, s.end) })), t);
      else if (entry.kind === "dialogue") director.barkLine(world, entry.speaker, entry.text, t);
    }
    if (rolled.length) {
      director.spellsFrom(world, rolled, t, place.unnamed);
      // The numbers from the lines first: observe then floats only what they didn't say.
      director.rulesLines(world, rolled, t, place.unnamed);
    }
    // Who walked where, what caught fire, what broke: compared with the world last seen (nothing, when nothing changed).
    director.observe(world, t);
  }

  /** Where someone is drawn now: mid-walk where the director has them, else where the world does. */
  positionAt(id: string, t: number) {
    return this.look?.director.tweens.at(id, t);
  }
}
