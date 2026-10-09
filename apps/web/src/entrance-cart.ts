import type { MapFixture } from "../../../packages/contracts/src/index.js";
import type { Point } from "../../../packages/core/src/navigation.js";

import { isCartPart as isEntranceCart } from "../../../packages/core/src/cart.js";
export { isEntranceCart };
function drawGiftTree(context: CanvasRenderingContext2D) {
    // A substantial terracotta pot and the Nine Furrows gift tree.
    context.fillStyle = "#733c2d"; context.fillRect(10, -2, 13, 12);
    context.fillStyle = "#ce895a"; context.fillRect(9, -3, 15, 3); context.fillRect(12, 0, 3, 8);
    context.fillStyle = "#68492d"; context.fillRect(15, -13, 3, 12);
    context.fillStyle = "#254e38"; context.fillRect(7, -15, 20, 9); context.fillRect(11, -19, 12, 15);
    context.fillStyle = "#56834c"; context.fillRect(9, -15, 9, 6); context.fillRect(13, -18, 8, 5);
    context.fillStyle = "#a4b967"; context.fillRect(12, -15, 4, 3);
}

const rattling = (now: number) => now % 3200 < 720;

/** Entrance goods and the surviving tree use the same fixture renderer. */
export function drawEntranceScenery(context: CanvasRenderingContext2D, fixture: MapFixture): boolean {
  if (!fixture.position) return false;
  if (fixture.id === "furn_gift_tree") {
    context.save(); context.translate(fixture.position.x * 16 - 8, fixture.position.y * 16);
    drawGiftTree(context); context.restore(); return true;
  }
  if (!["furn_delivery_cushions", "furn_delivery_supplies"].includes(fixture.id)) return false;
  context.save(); context.translate(fixture.position.x * 16, fixture.position.y * 16);
  context.fillStyle = "#51341f"; context.fillRect(0, 4, 16, 12);
  context.fillStyle = "#c39054"; context.fillRect(1, 5, 14, 9);
  context.fillStyle = "#77532f"; context.fillRect(1, 8, 14, 1); context.fillRect(1, 12, 14, 1);
  if (fixture.id === "furn_delivery_cushions") {
    for (const y of [6, 2, -2]) {
      context.fillStyle = "#613857"; context.fillRect(2, y, 12, 5);
      context.fillStyle = "#bd718b"; context.fillRect(3, y, 10, 3);
      context.fillStyle = "#eed29a"; context.fillRect(2, y + 2, 1, 1); context.fillRect(13, y + 2, 1, 1);
    }
  } else {
    context.fillStyle = "#e0d5ad"; context.fillRect(2, 0, 10, 6);
    context.fillStyle = "#a59b83"; context.fillRect(2, 2, 10, 1); context.fillRect(2, 5, 10, 1);
    context.fillStyle = "#f7eac9"; context.fillRect(7, -2, 6, 3);
    context.fillStyle = "#72553a"; context.fillRect(5, 0, 2, 16);
  }
  if (fixture.open) { context.fillStyle = "#f5dc9a"; context.fillRect(4, 13, 8, 2); }
  context.restore(); return true;
}

/** Pixel art, split across the two physical fixture tiles, like the palace beds. */
export function drawEntranceCart(context: CanvasRenderingContext2D, fixtures: readonly MapFixture[], now: number): void {
  const shake = rattling(now) ? Math.round(Math.sin(now / 23)) : 0;
  for (const fixture of fixtures.filter(isEntranceCart)) {
    if (!fixture.position) continue;
    const right = fixture.id === "furn_cart_right";
    context.save();
    context.translate(fixture.position.x * 16 + shake, fixture.position.y * 16);
    context.beginPath(); context.rect(0, -20, 16, 40); context.clip();
    if (right) context.translate(-16, 0);
    // Four iron-bound wheels, slatted bed and crooked shafts.
    context.fillStyle = "#211b1b";
    for (const x of [2, 25]) for (const y of [-2, 10]) context.fillRect(x, y, 5, 7);
    context.fillStyle = "#92918b";
    for (const x of [3, 26]) for (const y of [-1, 11]) context.fillRect(x, y, 2, 4);
    context.fillStyle = "#4c2d20"; context.fillRect(0, 2, 32, 11);
    context.fillStyle = "#bd864c";
    for (const y of [3, 7, 11]) context.fillRect(1, y, 30, 2);
    context.fillStyle = "#64462e"; context.fillRect(3, 14, 2, 6); context.fillRect(27, 14, 2, 6);
    context.fillStyle = "#ded0a0"; context.fillRect(2, 4, 2, 8); context.fillRect(28, 4, 2, 8);
    drawGiftTree(context);
    context.restore();
  }
}

/** Local, gesture-gated foley. Kenney Impact Sounds is CC0; see the bundled license. */
export function cartRattle(root: HTMLElement, signal: AbortSignal) {
  const sounds = ["impactWood_heavy_000", "impactMetal_light_000"].map(name => new Audio(`./assets/${name}.ogg`));
  const button = document.createElement("button"); button.type = "button"; button.className = "court-cart-sound";
  button.textContent = "Mute cart"; button.setAttribute("aria-pressed", "false"); button.hidden = true; root.append(button);
  let enabled = true, unlocked = false, nextImpact = 0, sample = 0;
  const silence = () => { for (const sound of sounds) { sound.pause(); sound.currentTime = 0; } };
  root.addEventListener("pointerdown", () => { unlocked = true; }, { signal });
  root.addEventListener("keydown", () => { unlocked = true; }, { signal });
  button.addEventListener("click", () => {
    unlocked = true; enabled = !enabled; silence();
    button.textContent = enabled ? "Mute cart" : "Unmute cart";
    button.setAttribute("aria-pressed", String(!enabled));
  }, { signal });
  document.addEventListener("visibilitychange", () => { if (document.hidden) silence(); }, { signal });
  signal.addEventListener("abort", () => { silence(); button.remove(); }, { once: true });
  return (fixtures: readonly MapFixture[], player: Point | undefined, now: number) => {
    const cart = fixtures.find(isEntranceCart)?.position;
    const distance = cart && player ? Math.hypot(cart.x - player.x, cart.y - player.y) : Infinity;
    button.hidden = distance > 9;
    if (!enabled || !unlocked || document.hidden || distance > 9) { silence(); return; }
    if (!rattling(now) || now < nextImpact) return;
    nextImpact = now + 130; const sound = sounds[sample++ % sounds.length]!;
    sound.volume = Math.max(0, 0.35 * (1 - distance / 10));
    sound.playbackRate = sample % 2 ? 0.85 : 1.15; sound.currentTime = 0;
    void sound.play().catch(() => { /* Browser autoplay restrictions must not interrupt the map. */ });
  };
}
