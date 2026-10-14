import { worldView, type SceneWorld } from "../../src/world/scene-world.ts";
import { loadCases } from "./cases.ts";
import { stageView } from "./language.ts";
import { kindOf, subjectOf } from "./score.ts";
import type { WorldCase } from "./types.ts";

/**
 * What the GM reads: how big each view of the world is next to the GM's whole prompt, and whether
 * the entities an exchange turns on (those its labels name, and those the player's turn names) are
 * shown in full (a line with their id, states and notes) or only counted ("3 things").
 *
 *   node --no-warnings evals/world/view.ts
 */
const tokens = (text: string) => Math.round(text.length / 4);

/** Entities the exchange turns on: named in the labels, or named in the player's turn. */
function needed(c: WorldCase): string[] {
  const ids = new Set<string>();
  for (const x of [...c.expect, ...(c.allow ?? [])]) {
    const k = kindOf(x);
    if (k !== "create" && c.world.entities[subjectOf(x)]) ids.add(subjectOf(x));
    if ("near" in x && x.near) ids.add(x.near);
  }
  const said = c.playerTurn.toLowerCase();
  for (const e of Object.values(c.world.entities)) {
    if (e.kind === "area" || e.kind === "place" || e.id === "player") continue;
    const name = e.name.toLowerCase().replace(/^(the|a|an) /, "");
    if (name.length > 3 && said.includes(name)) ids.add(e.id);
  }
  ids.delete("player");
  return [...ids].filter(id => c.world.entities[id] && c.world.entities[id]!.kind !== "area");
}

/** Shown in full: the view has its own line with its id. */
const shown = (view: string, id: string) => new RegExp(`\\[${id.replace(/[-]/g, "\\-")}\\]`).test(view);

const rows: Array<Record<string, number | string>> = [];
for (const c of loadCases()) {
  const w: SceneWorld = c.world;
  const views = { proximity: worldView(w), full: worldView(w, { full: true }), proposed: stageView(w, { full: false }) };
  const gmPrompt = c.gm ? tokens(c.gm.instructions + c.gm.input.map(m => m.content).join("\n")) : 0;
  const need = needed(c);
  rows.push({
    case: c.id, entities: Object.keys(w.entities).length, gmPrompt,
    proximity: tokens(views.proximity), full: tokens(views.full), proposed: tokens(views.proposed),
    needed: need.length,
    proximityShows: need.filter(id => shown(views.proximity, id)).length,
    fullShows: need.filter(id => shown(views.full, id)).length,
    playerHidden: (w.entities.player?.states.length ?? 0) + (w.entities.player?.notes.length ?? 0) > 0 ? 1 : 0,
  });
}
const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k]), 0);
const avg = (k: string) => Math.round(sum(k) / rows.length);
console.log("case | entities | GM prompt (tokens) | proximity view | full view | proposed view | needed | shown in proximity | shown in full");
for (const r of rows) console.log(`${r.case} | ${r.entities} | ${r.gmPrompt} | ${r.proximity} | ${r.full} | ${r.proposed} | ${r.needed} | ${r.proximityShows} | ${r.fullShows}`);
console.log(`\nMean: ${avg("entities")} entities; GM prompt ${avg("gmPrompt")} tokens; views: proximity ${avg("proximity")}, full ${avg("full")}, proposed ${avg("proposed")} tokens (the full view is ${Math.round((100 * sum("full")) / Math.max(1, sum("gmPrompt")))}% of the GM's prompt).`);
console.log(`Entities an exchange turns on, shown in full: proximity ${sum("proximityShows")}/${sum("needed")}, full ${sum("fullShows")}/${sum("needed")}.`);
console.log(`Cases where the player has states or notes the current views never show: ${sum("playerHidden")}/${rows.length}.`);
