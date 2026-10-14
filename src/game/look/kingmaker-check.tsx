/**
 * Does OpenTUI draw Kingmaker Glyphs one cell each? Draws the map's Rat and Heron with everyone's
 * glyph from the kingmaker set (as the integrated renderer will), and the gallery's yard and
 * vocabulary board, through OpenTUI's headless test renderer, and compares each captured frame with
 * what was rendered: a sprite measured as two cells would push the rest of its row over.
 *
 *   node --experimental-ffi --no-warnings --import tsx src/game/look/kingmaker-check.tsx
 */
import { testRender } from "@opentui/react/test-utils";
import { buildWorld } from "../../world/scene-world.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import type { StyledLine } from "../types.ts";
import { CAST, actorsHere, enterScene, getMap, heronWorld, newExploration, regionForScene, render, toPlain } from "../map/index.ts";
import { MapView } from "../map/view.tsx";
import { isKingmaker } from "./glyphs.ts";
import { actorLook, lookFrame } from "./map.ts";
import { frameAt } from "./vignettes.ts";

process.env.KM_LOOK_MODEL ??= "off";
const size = { w: 90, h: 30 };
const views: Array<[string, StyledLine[]]> = [];
for (const [scene, world, people] of [["drowned-rat", drownedRatWorld, ["kell", "nan-quill", "dilly", "hobb", "arlo", "cob"]], ["heron-warehouse", heronWorld, ["kell", "saul", "hep", "scrope", "hobb", "duchess"]]] as const) {
  const ex = newExploration({ time: "night", played: ["hanged-clerk"], lead: scene, flags: {} });
  enterScene(ex, scene);
  const w = buildWorld(scene, world, people.map(id => ({ id, name: CAST[id]!.name })), { name: "you" });
  const frame = lookFrame(3, "night", "kingmaker");
  const actors = actorsHere(ex, w).map(a => ({ ...a, glyph: actorLook(a, frame).glyph }));
  const r = regionForScene(scene)!.region.rect;
  // A renderer that works out each actor's look itself does it in `glyphs`; one that doesn't draws the glyphs it's given.
  const options = { time: "night" as const, roofs: false, tick: 3, glyphs: "kingmaker" as const };
  views.push([`the map: ${scene}`, render(getMap(ex.map), actors, { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) }, size, options)]);
}
views.push(["the gallery: the yard", frameAt("yard", 2400, { ...size, glyphs: "kingmaker" }).toLines()]);
views.push(["the gallery: the vocabulary", frameAt("sprites", 3000, { ...size, glyphs: "kingmaker" }).toLines()]);

let same = true;
for (const [name, lines] of views) {
  const setup = await testRender(<MapView lines={lines} />, { width: size.w, height: size.h });
  await setup.renderOnce();
  const drawn = setup.captureCharFrame().split("\n");
  const sprites = [...toPlain(lines)].filter(isKingmaker).length;
  const differ = toPlain(lines).split("\n").map((line, i) => [i, line, drawn[i] ?? ""] as const).filter(([, a, b]) => a.trimEnd() !== b.trimEnd());
  console.log(`${name}: ${sprites} sprites, ${differ.length ? `${differ.length} lines differ` : "drawn exactly"}`);
  for (const [i, a, b] of differ.slice(0, 2)) console.log(`  line ${i}\n  rendered: ${a}\n  drawn:    ${b}`);
  same &&= !differ.length && sprites > 0;
  await setup.dispose();
}
console.log(same ? "OpenTUI draws every sprite in one cell: the rows line up." : "Some rows differ (above).");
process.exit(same ? 0 : 1);
