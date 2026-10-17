/**
 * How fast the client plays out what it shows a step at a time (browser-design §4.1): a walk on the
 * map, a step a move, and the talk between scenes, a line at a time. A setting, where the prototype
 * read the environment: the terminal host sets it from KM_APP_STEP_MS and KM_APP_TALK_MS
 * (hosts/terminal.ts), the checks set their own, and the page keeps these.
 */

export interface Pace {
  /** How long a walk waits between steps, so the player sees the way (ms). */
  stepMs: number;
  /** How long each line of a talk between scenes waits for the one before (ms; 0: all at once). */
  talkMs: number;
}

let pace: Pace = { stepMs: 45, talkMs: 700 };

/** The pace now. */
export const pacing = (): Pace => pace;

/** Change the pace from now on, everywhere in this process: what isn't given stays as it was. */
export function setPace(changes: Partial<Pace>): void {
  pace = { ...pace, ...changes };
}
