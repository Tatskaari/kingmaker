/**
 * Does OpenTUI draw the map exactly as rendered? Renders the tour's views through OpenTUI's headless
 * test renderer (with MapView) and compares each captured frame with the plain text, which catches
 * any glyph OpenTUI measures as double width (it would push the rest of its line over).
 *
 * node --experimental-ffi --no-warnings --import tsx src/game/map/view-check.tsx
 */
import { testRender } from "@opentui/react/test-utils";
import { buildWorld, damageThing } from "../../world/scene-world.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import type { StyledLine } from "../types.ts";
import { CAST, enterScene, heronWorld, newExploration, renderExplore, toPlain } from "./index.ts";
import { MapView } from "./view.tsx";

const size = { w: 80, h: 24 };
const views: Array<[string, StyledLine[]]> = [];
views.push(["the town, morning", renderExplore(newExploration({ time: "morning", played: [], lead: "hanged-clerk", flags: {} }), size)]);
views.push(["the town, the next morning", renderExplore(newExploration({ time: "next-morning", played: ["hanged-clerk", "drowned-rat", "heron-warehouse"], lead: "kings-morning", flags: {} }, { at: { x: 11, y: 16 } }), size)]);
const rat = newExploration({ time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} });
enterScene(rat, "drowned-rat");
const ratWorld = buildWorld("drowned-rat", drownedRatWorld, ["kell", "nan-quill", "dilly", "hobb"].map(id => ({ id, name: CAST[id]!.name })), { name: "you" });
damageThing(ratWorld, ratWorld.entities["card-table"]!, 3, "fire", 1);
views.push(["the Rat, with a fire", renderExplore(rat, size, { world: ratWorld })]);
const heron = newExploration({ time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} });
enterScene(heron, "heron-warehouse");
views.push(["the Heron", renderExplore(heron, size, { world: buildWorld("heron-warehouse", heronWorld, ["kell", "saul", "hep", "scrope", "hobb"].map(id => ({ id, name: CAST[id]!.name })), { name: "you" }) })]);
const king = newExploration({ time: "next-morning", played: ["hanged-clerk", "drowned-rat", "heron-warehouse"], lead: "kings-morning", flags: {} });
enterScene(king, "kings-morning");
views.push(["the King's dressing room", renderExplore(king, size)]);

let same = true;
for (const [name, lines] of views) {
  const setup = await testRender(<MapView lines={lines} />, { width: size.w, height: size.h });
  await setup.renderOnce();
  const drawn = setup.captureCharFrame().split("\n");
  const differ = toPlain(lines).split("\n").map((line, i) => [i, line, drawn[i] ?? ""] as const).filter(([, a, b]) => a.trimEnd() !== b.trimEnd());
  // And the colours come through: the drawn frame has as many distinct backgrounds as the rendered one, near enough.
  const key = (c: { r: number; g: number; b: number }) => `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const drawnBgs = new Set(setup.captureSpans().lines.flatMap(l => l.spans.map(s => key(s.bg))));
  const renderedBgs = new Set(lines.flat().map(s => s.bg).filter(Boolean));
  console.log(`${name}: ${differ.length ? `${differ.length} lines differ` : "drawn exactly"} (${renderedBgs.size} backgrounds rendered, ${drawnBgs.size} drawn)`);
  for (const [i, a, b] of differ.slice(0, 2)) console.log(`  line ${i}\n  rendered: ${a}\n  drawn:    ${b}`);
  same &&= !differ.length;
  await setup.dispose();
}
console.log(same ? "OpenTUI draws the map exactly as rendered." : "OpenTUI draws some lines differently (above).");
process.exit(same ? 0 : 1);
