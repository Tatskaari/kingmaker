/**
 * The zoo's scenes (src/game/zoo) are short scenes played in the zoo's theatre, each built to show a
 * few of the runtime's mechanics with the real GM, and small enough to finish in a few turns. Their
 * worlds line up with their rooms on the theatre's map: (0, 0) feet is the room's corner (its wall),
 * 5 ft to a tile, so a room's floor starts at tile (1, 1).
 */

/** A room tile's middle, in its world's feet. */
export const ft = (i: number, j: number): [number, number] => [i * 5 + 2.5, j * 5 + 2.5];
