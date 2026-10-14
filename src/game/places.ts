import { sceneById } from "../../scenes/index.ts";
import type { SessionState } from "../runtime/session.ts";
import type { Action, Explorer, GameState } from "./play.ts";

/**
 * Exploring Caerwyn as places and paths (no map): the text stand-in for the isometric map, with
 * the same Explorer interface. Each place says what it's like at each time of day, where you can go,
 * and, when the story's lead scene is here, how you walk into it.
 */

interface Place { name: string; paths: string[]; looks: Partial<Record<GameState["story"]["time"] | "any", string>> }

const PLACES: Record<string, Place> = {
  "granary-lane": { name: "the lane behind the King's Granary", paths: ["market-square"], looks: {
    any: "A narrow lane of wet cobbles behind the granary. An old elm leans over a shoulder-high yard wall; pigeons argue in it.",
    morning: "A narrow lane of wet cobbles behind the granary. Over the wall something creaks on a rope, rhythmically; a girl's voice is swearing at someone in two languages, and a woman in a watch cape is waiting by the yard gate with a notebook.",
  } },
  "market-square": { name: "the market square", paths: ["granary-lane", "river-stairs", "palace-gate"], looks: {
    any: "The square is half bunting and half scaffolding for tomorrow's procession. The Corn Exchange has chalked up today's bread price, and people are grumbling at it in the traditional manner.",
    evening: "Lamps are being lit along the procession route. The bread price on the Corn Exchange board has gone up again since noon, and someone has written something rude beside it.",
    night: "The square is empty but for the sweepers and a watchman asleep upright against a lamppost, which is a skill.",
  } },
  "river-stairs": { name: "the river stairs", paths: ["market-square", "wharves"], looks: {
    any: "Wet green steps going down to the black river. Halfway down, three steps lead to a low door with a din behind it: the Drowned Rat.",
    night: "The steps are slick and the river is high. Light and noise leak from the Drowned Rat's door halfway down; below, the wharves run off into fog.",
  } },
  "wharves": { name: "the wharves", paths: ["river-stairs"], looks: {
    any: "Warehouses and moorings along the river, barges nodding at their lines. At the downriver end, where the lamps give out, a tall tarred warehouse has a painted heron on its sign.",
    night: "Fog off the river, barge lanterns, night porters going down to the shifts. Downriver, the Heron's hoist is working, swinging sacks out over a broad barge, and a brazier glows at its land door.",
  } },
  "palace-gate": { name: "the palace gate", paths: ["market-square"], looks: {
    any: "Iron gates, very polished guards and a great deal of bunting. Nobody without business gets in on the eve of the Assembly, and the guards make it clear that you have no business.",
  } },
};

/** Where each scene is walked into, and how. */
const DOORS: Record<string, { at: string; id: string; label: string; text: string }> = {
  "hanged-clerk": { at: "granary-lane", id: "talk_kell", label: "Talk to the sergeant waiting at the yard gate", text: "You go over to the woman with the notebook, and she nods you through the gate into the yard." },
  "drowned-rat": { at: "river-stairs", id: "enter_drowned_rat", label: "Go down the three steps into the Drowned Rat", text: "You go down the three steps and push open the Drowned Rat's door." },
  "heron-warehouse": { at: "wharves", id: "approach_heron", label: "Make your way along the dark wharf to the Heron warehouse", text: "You go along the wharf to where the lamps give out, towards the Heron." },
};

const placeOf = (game: GameState) => (game.explore["at"] as string | undefined) ?? "granary-lane";
const slug = (id: string) => id.replace(/-/g, "_");

export const places: Explorer = {
  start(game) { game.explore["at"] = "granary-lane"; },
  observe(game) {
    const here = PLACES[placeOf(game)]!;
    const look = here.looks[game.story.time] ?? here.looks.any ?? "";
    const lead = game.story.lead ? DOORS[game.story.lead] : undefined;
    const leadLine = lead && game.story.lead ? `\n\nThe story is heading for ${sceneById(game.story.lead).title}${lead.at === placeOf(game) ? ", right here." : `, at ${PLACES[lead.at]!.name}.`}` : "";
    return `You are in ${here.name} (${game.story.time.replace("-", " ")}).\n${look}${leadLine}`;
  },
  actions(game) {
    const at = placeOf(game);
    const here = PLACES[at]!;
    const lead = game.story.lead ? DOORS[game.story.lead] : undefined;
    return [
      ...(lead && lead.at === at ? [{ id: lead.id, label: lead.label, kind: "enter" as const }] : []),
      ...here.paths.map(p => ({ id: `go_${slug(p)}`, label: `Walk to ${PLACES[p]!.name}`, kind: "move" as const })),
      { id: "look", label: "Look around", kind: "examine" as const },
    ] satisfies Action[];
  },
  act(game, _session: SessionState, id) {
    const at = placeOf(game);
    const lead = game.story.lead ? DOORS[game.story.lead] : undefined;
    if (lead && lead.at === at && id === lead.id) return { text: lead.text, scene: true };
    const to = PLACES[at]!.paths.find(p => `go_${slug(p)}` === id);
    if (to) { game.explore["at"] = to; return { text: `You walk to ${PLACES[to]!.name}.` }; }
    if (id === "look") return { text: PLACES[at]!.looks[game.story.time] ?? PLACES[at]!.looks.any ?? "" };
    throw new Error(`Unavailable action: ${id}`);
  },
  afterScene(game, session) {
    // Leaving a scene, you're outside the place it happened.
    const door = Object.entries(DOORS).find(([scene]) => session.history.at(-1)?.sceneId === scene)?.[1];
    if (door) game.explore["at"] = door.at;
  },
};
