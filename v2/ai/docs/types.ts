/**
 * What the docs service is handed: a view of the game's working set, never the game's own state. The
 * AI API is given what a call needs and reads nothing else of the game (it reads and writes the lore,
 * which is its own). Only what the docs service uses is here; the prototype builds the view from its
 * session (src/lore/view.ts). The backstory's shape is here too, a copy of the prototype's.
 */

/** The scene being played. */
export interface SceneView {
  id: string;
  title: string;
  /** The dramatic question it answers. */
  premise: string;
  /** Where and when (the prep). */
  setting: string;
  /** What the place can't offer (the prep). */
  limits?: string[];
  /** Lore docs about the place (paths in the lore): the GM's own entry docs, always open. */
  lore?: string[];
}

/** Someone present in the scene. */
export interface Person {
  /** Their cast id: their scope is `character:<id>`, and their lore entry's `character`. */
  id: string;
  name: string;
  /** How they look (the prep). */
  look: string;
  /** What they want (the prep). */
  wants: string;
  /** What they know (the prep). */
  knows: string[];
  /** How they stand towards the player: the attention filter is told its first clause. */
  attitude: string;
}

/** The player character. */
export interface PlayerView {
  name: string;
  concept: string;
  /** Who they are, in a line for a model's brief: their name and concept, and their backstory's summary. */
  who: string;
}

/** An entry of the scene so far, as the models read it. */
export interface Line {
  turn: number;
  /** As a script has it: "Kell: …", "Wren (player): …", or "[…]" for a dice or system line. */
  text: string;
  /** On a dice line, its own words (a binding ruling). */
  roll?: string;
}

/** The entries as one script, blank lines between (the way the transcript is shown to every model). */
export const script = (lines: Line[]): string => lines.map(l => l.text).join("\n\n");

/** A note disclosure has opened for a scope (`p`: how sure it was, on the turn it opened). */
export interface OpenedNote { path: string; title: string; scope: string; turn: number; p?: number }

/** What disclosure keeps for a scene: the notes open in it (24 at most), and those kept out of it however relevant. */
export interface Disclosed {
  opened: Array<Omit<OpenedNote, "p">>;
  withheld?: string[];
}

/** The working set for a scene. */
export interface WorkingSet {
  /** The game's id: whose copy of the lore is read and written. */
  game: string;
  /** The turn the game is on. */
  turn: number;
  scene: SceneView;
  player: PlayerView;
  /** The people present, in the scene's order. */
  present: Person[];
  /** The scene so far, an entry a line. */
  transcript: Line[];
  /** Disclosure's notes for the scene, once it has any. */
  memory?: Disclosed;
}

/** How a scene ended: the exit taken. */
export interface Ending { title: string; outcome: string }

/**
 * The player's backstory, written (or drafted, or worked in from their notes) at character creation
 * and checked against the world's lore: the whole of it, and what it says of them.
 */
export interface Backstory {
  /** The whole of it, in the player's words (with any lore fix they accepted). */
  text: string;
  /** Who they are, in a sentence or two (in the third person): what every GM brief says of them. */
  summary: string;
  personality: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
}
