import type { Backend } from "../../client/backend.ts";
import * as verbs from "../../client/headless.ts";
import type { SceneView } from "../../client/scene/view.ts";
import { capture, carryStoryOn, carryTurnOn, patiently, QUIET, SETTLED, type Patience } from "./patience.ts";
import type { GameRecord } from "./record.ts";
import { endingsOf, sceneOf, skipOrder, type Loaded } from "./scenes.ts";

/**
 * A game taken to the round's scene the way the story takes a player there, so a later scene is
 * reached through every real boundary before it: the lead walked to on the map (the hanged clerk
 * opens as the player walks into the yard); a scene before the one wanted ended for QA on its first
 * good or mixed ending (end_scene, which only the dev stack's owner may call), as a thorough
 * player's game would end it, every discovery it can reach reached first, so the story moves on
 * through its boundary as it would after play (the hand-off, the next scene's opening rewritten, the
 * lead) and owes nothing it carries into the next scene; then the next lead walked to, until the
 * scene wanted is open and its opening played. It works on the fake model as on real ones: nothing
 * here asks a model for anything a player's game wouldn't.
 */
export async function reachScene(conn: Backend, target: string, loaded: Loaded, record: GameRecord, patience: Patience): Promise<void> {
  for (let step = 0; step < loaded.keys.length * 4; step++) {
    const open = openKey(conn.view(), loaded);
    if (open === target) return;
    passedOver(open, target, loaded);

    if (open) await endForQa(conn, open, loaded, record, patience);
    else await moveOn(conn, patience);
  }
  throw new Error(`The story didn't come to ${target}: it's at ${where(conn.view())}.`);
}

/** The scene open and ready to be played (its opening over, the player's to speak), by its key; none on the map, between scenes or while an opening is played. */
export function openKey(view: SceneView | undefined, loaded: Loaded): string | undefined {
  if (!view || view.over || view.fighting || view.talk || !view.mayType) return undefined;
  return loaded.keys.find(key => sceneOf(loaded, key).title === view.title);
}

/**
 * A step on towards the next scene: on the map, walk to the lead (its scene opens, and its opening
 * is played); once a scene's over, on from it (go: between scenes, the lead walked to, a stuck
 * story tried again); an opening still being played, or one that failed, waited for or tried again.
 */
async function moveOn(conn: Backend, patience: Patience): Promise<void> {
  const view = conn.view();
  if (view?.story?.ended) throw new Error("The story is over (The End) before the scene was reached.");

  if (!view) await patiently(conn, () => verbs.act(conn, "go_to_lead", QUIET, SETTLED), carryTurnOn, patience);
  else if (view.over || view.fighting) await patiently(conn, () => verbs.go(conn, QUIET, SETTLED), carryStoryOn, patience);
  else await patiently(conn, () => carryTurnOn(conn), carryTurnOn, patience);
}

/**
 * The scene ended for QA through its first good or mixed ending, as the dev stack's owner (the
 * headless client's end), thorough (its discoveries reached first), and the story's moving on waited
 * for. When the game won't take an ending (the scene it runs hasn't one by that id), the next in
 * skipOrder's order is tried.
 */
async function endForQa(conn: Backend, key: string, loaded: Loaded, record: GameRecord, patience: Patience): Promise<void> {
  const endings = skipOrder(endingsOf(sceneOf(loaded, key)));
  const refused: string[] = [];
  for (const ending of endings) {
    const out = capture();
    const code = await patiently(conn, () => verbs.end(conn, ending.id, out, SETTLED, { thorough: true }), carryStoryOn, patience);
    if (code === 0 || conn.view()?.over) {
      record.skipped.push({ scene: key, exit: ending.id, title: ending.title, ...(ending.grade ? { result: ending.grade } : {}) });
      return;
    }
    if (!/There's no ending called/.test(out.printed)) throw new Error(`${key} wouldn't end for QA: ${out.printed.trim() || `the headless client's end exited ${code}`}`);
    refused.push(ending.id);
  }
  throw new Error(`${key} wouldn't end on any of its endings (${refused.join(", ")}): is the stack's campaign the one the loop read?`);
}

/** The story went past the scene wanted (the boundary found it overtaken, and skipped it): no later step brings it back. */
function passedOver(open: string | undefined, target: string, loaded: Loaded): void {
  if (!open || loaded.keys.indexOf(open) < loaded.keys.indexOf(target)) return;
  throw new Error(`The story passed over ${target} and opened ${open}: the boundary judged ${target} overtaken by what the scenes before it ended on.`);
}

function where(view: SceneView | undefined): string {
  if (!view) return "the map";
  return `${view.title} (${view.over ? "over" : view.phase})`;
}
