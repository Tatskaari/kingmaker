import type { Page } from "playwright";

/**
 * What the static check asks of the lamp posts' pictures (src/web/page/lamps.ts), drawn on the
 * doors' canvas: which lamps the game said are in view and how many the page drew, whether a lamp's
 * picture covers the game's glyph and post where it took them back to the ground, and a lamp's
 * picture as pixels, to tell it changed. (Where every pixel on the canvas may be is the doors'
 * placement(), which lists the lamps' cells too: src/web/doors-check.ts.)
 */

export interface LampsSeen { drawn: number; received: number; lamps: Array<{ id: string; look: string; x: number; y: number; cells: number; ground: number; glow: number }> }

/** The lamp posts the game last said are in view (km.doors.frame.lamps), and how many the page drew; undefined with ?doors=off. */
export const lampsSeen = (page: Page) => page.evaluate(`(() => {
  const d = km.doors;
  if (!d) return undefined;
  const lamps = d.frame && d.frame.lamps ? d.frame.lamps : [];
  return { drawn: d.lampsDrawn, received: d.received, lamps: lamps.map(l => ({ id: l.id, look: l.look, x: l.x, y: l.y, cells: l.cells.length, ground: l.ground.length, glow: l.glow ? l.glow.length : 0 })) };
})()`) as Promise<LampsSeen | undefined>;

/** Waits for the game to say the lamp called `id` is in view (in `look`, if given) and the page to draw some lamps; the lamps last seen. */
export async function lampShown(page: Page, id: string, look?: string, timeout = 15000): Promise<LampsSeen | undefined> {
  const end = Date.now() + timeout;
  let seen: LampsSeen | undefined;
  for (;;) {
    seen = await lampsSeen(page);
    const lamp = seen?.lamps.find(l => l.id === id);
    if (seen && lamp && (!look || lamp.look === look) && seen.drawn > 0) return seen;
    if (Date.now() > end) return seen;
    await new Promise(r => setTimeout(r, 200));
  }
}

/**
 * A lamp's picture on the canvas: the pixels in the box round its cells (a cell either side, a row
 * above, the post's rows), as one string to compare; and how many device pixels of the cells it
 * took back to the ground the picture leaves see-through (none: the game's glyph and post are under
 * it, so none of them should show).
 */
export const lampPicture = (page: Page, id: string) => page.evaluate(`((id) => {
  const d = km.doors, frame = d.drawnFrame, k = d.cell;
  const lamp = frame && frame.lamps ? frame.lamps.find(l => l.id === id) : undefined;
  if (!lamp || !k) return undefined;
  const ctx = d.canvas.getContext("2d");
  const box = ctx.getImageData((lamp.x - 1) * k.width, (lamp.y - 1) * k.height, 3 * k.width, (3 + lamp.post) * k.height).data;
  let gaps = 0;
  for (const [x, y] of lamp.ground) {
    const px = ctx.getImageData(x * k.width, y * k.height, k.width, k.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) gaps++;
  }
  let hash = 0;
  for (let i = 0; i < box.length; i++) hash = (Math.imul(hash, 31) + box[i]) | 0;
  return { hash, gaps, ground: lamp.ground.length };
})(${JSON.stringify(id)})`) as Promise<{ hash: number; gaps: number; ground: number } | undefined>;
