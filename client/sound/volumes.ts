// New: the sound's volumes (docs/sound-design.md): each bus's and all of them, where the engine starts and where the page's switches put them back.

/** How loud each bus is, and all of them: 0 is silent, 1 the bus's own level; the master can go past 1 (to 1.5), the engine's limiter keeping it in bounds. */
export interface Volumes { master: number; sfx: number; voice: number; music: number }

/** Where they start: the effects and the voices at their own level, the music under them. */
export const VOLUMES: Volumes = { master: 1, sfx: 1, voice: 1, music: 0.6 };

/** How far the master goes. */
export const MOST_MASTER = 1.5;
