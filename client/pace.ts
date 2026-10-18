/**
 * How fast the client plays out what it shows a step at a time (browser-design §4.1): a walk on the
 * map, a step a move, and the talk between scenes, a line at a time; and whether a fight's moves are
 * played out at all (reduced motion). A setting, where the prototype read the environment: the
 * terminal host sets it from KM_APP_STEP_MS, KM_APP_TALK_MS and KM_REDUCED_MOTION
 * (hosts/terminal.ts), the checks set their own, and the page keeps these but for reduced motion,
 * which it takes from the browser.
 */

export interface Pace {
  /** How long a walk waits between steps, so the player sees the way (ms). */
  stepMs: number;
  /** How long each line of a talk between scenes waits for the one before (ms; 0: all at once). */
  talkMs: number;
  /** Reduced motion: a fight's moves aren't played out, each shows its end at once with its caption (KM_REDUCED_MOTION in a terminal, the browser's own setting on a page). */
  reducedMotion: boolean;
}

let pace: Pace = { stepMs: 45, talkMs: 700, reducedMotion: false };

/** The pace now. */
export const pacing = (): Pace => pace;

/** Change the pace from now on, everywhere in this process: what isn't given stays as it was. */
export function setPace(changes: Partial<Pace>): void {
  pace = { ...pace, ...changes };
}
