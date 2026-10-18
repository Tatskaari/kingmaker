import type { ExploreView } from "../../client/explore/rows.ts";
import type { Stack } from "../dev/stack.ts";
import { bigints, check, homeUntil, mapUntil, moduleLog, note, ok, step, type Player } from "./kit.ts";

/**
 * The e2e's steps for the map between scenes (map-design §4, the integration's): a game that starts
 * on the campaign's map, in the granary lane in the morning; a walk from the lane into the yard that
 * opens the hanged clerk, with a spectator seeing the same walk (step 17's), or a word with Kell
 * that opens it (step 2's); back on the map after the ending, where the scene left the player, the
 * yard locked once they're out, and the Drowned Rat's door shut in the morning, nothing moving; the
 * map moves' times, as the module logged them. Every move goes through the client's connection.
 */

/** Where the campaign starts a game (campaign.json's start): the granary lane, by the yard's gate. */
const LANE = { x: 42, y: 9 };
/** The granary yard on the town's map (its region), where the hanged clerk is played. */
const YARD = { x: 40, y: 11, w: 7, h: 6 };

const inYard = (at: { x: number; y: number }) => at.x >= YARD.x && at.y >= YARD.y && at.x < YARD.x + YARD.w && at.y < YARD.y + YARD.h;

/** Where the walker stands, as the e2e says it: "caerwyn (42,9)", and the scene they're in. */
export function whereabouts(view: ExploreView): string {
  return `${view.ex.map} (${view.ex.at.x},${view.ex.at.y})${view.ex.scene ? ` in ${view.ex.scene}` : ""}`;
}

/**
 * A game's start on the map as a player sees it (map-design §3.3): the lane by the granary gate in
 * the morning, the hanged clerk the lead, waiting in the yard. A spectator sees the host's.
 */
export async function inTheLane(p: Player, game?: bigint): Promise<ExploreView> {
  const view = await mapUntil(p, `${p.name} to see the map`, 10_000, v => (game === undefined || v.game === String(game)) && !v.ex.scene && v);
  check(`${p.name} sees game ${view.game} on the map, in the granary lane in the morning, the hanged clerk waiting: ${whereabouts(view)}, "The lead: ${view.lead?.title}"${view.watching ? ` (watching ${view.watching})` : ""}`,
    view.ex.map === "caerwyn" && view.ex.at.x === LANE.x && view.ex.at.y === LANE.y && view.ex.story.time === "morning" && view.lead?.key === "hanged-clerk");
  return view;
}

/** A map move made and its row come back: the walker's map once its count of moves has gone up, refused moves throwing. */
async function moved(p: Player, what: string, move: () => ReturnType<Player["conn"]["walk"]>): Promise<ExploreView> {
  const before = p.conn.explore()?.acts ?? -1;
  const refused = await move();
  check(`${what}${refused ? `: refused, ${refused.code}` : ""}`, refused === undefined);
  return await mapUntil(p, `${p.name}'s move to come back`, 10_000, v => v.acts > before && v);
}

/** The explore row's events a player saw from an index on, as both clients should see them: each move's where, count and words. */
function exploreEvents(p: Player, from: number): string[] {
  return p.events.slice(from).filter(e => e.table === "explore").map(({ op, row }) =>
    `${op} ${row.map} (${row.at.x},${row.at.y})${row.scene === undefined ? "" : ` in ${row.scene}`} #${row.acts} ${JSON.stringify(row.said)} ${JSON.stringify(row.followers.map((f: { id: string }) => f.id), bigints)}`);
}

/**
 * 17's walk (map-design §4): B watching on the map, A takes two steps along the lane and back, then
 * walks to the lead, through the gate into the yard, which opens the hanged clerk. A and B see the
 * same explore events, move by move. What the walk to the lead said.
 */
export async function aWalkBothSee(a: Player, b: Player): Promise<string> {
  const from = { a: a.events.length, b: b.events.length };
  await moved(a, "A steps west along the lane (walk toward west)", () => a.conn.walk({ toward: "west" }));
  const back = await moved(a, "A steps back east (walk toward east)", () => a.conn.walk({ toward: "east" }));
  check(`A is back by the gate: ${whereabouts(back)}`, back.ex.at.x === LANE.x && back.ex.at.y === LANE.y);
  check("A walks to the lead (walk toward lead)", (await a.conn.walk({ toward: "lead" })) === undefined);
  const walked = await mapUntil(a, "A's walk into the yard", 10_000, v => v.ex.scene !== undefined && v);
  check(`the walk took A through the gate into the yard, and the hanged clerk opened: ${whereabouts(walked)}, "${walked.said}"`, walked.ex.scene === "hanged-clerk" && inYard(walked.ex.at));
  await mapUntil(b, "B to see A's walk", 10_000, v => v.ex.scene !== undefined && v);
  const seenA = exploreEvents(a, from.a), seenB = exploreEvents(b, from.b);
  check(`A and B saw the same ${seenA.length} explore events, move by move: ${seenA.join("; ")}`, seenA.length >= 3 && JSON.stringify(seenA) === JSON.stringify(seenB));
  return walked.said;
}

/**
 * 14a. After the ending (step 14), back to the map (map-design §1 row 7), the story moved on
 * (story-design §4.3): A walks out of the scene that's over, and stands in the yard where it left
 * them, Kell beside them, with B's seat following onto the town's place; out through the gate, the
 * map's lead is the Drowned Rat at evening, the boundary's; the yard's locked once they're out. B saw
 * every move as A did. (Walking on to the Rat is the whole story's step 32, in a game of its own.)
 */
export async function backToTheMap(stack: Stack, a: Player, b: Player, game: bigint): Promise<void> {
  step("14a. Back to the map after the ending: where the scene left A, B with them; the story on to the Rat at evening; the yard locked once they're out");
  check("A's scene is over", a.conn.rows()?.scene.status === "ended");
  const from = { a: a.events.length, b: b.events.length };
  check("A walks out (walk toward out)", (await a.conn.walk({ toward: "out" })) === undefined);
  const out = await mapUntil(a, "A to be back on the map", 10_000, v => !v.ex.scene && v);
  check(`A is in the yard where the scene left them, Kell beside them: ${whereabouts(out)}, followed by ${out.ex.followers.map(f => f.name).join(", ")}`, inYard(out.ex.at) && out.ex.followers.some(f => f.id === "kell"));
  await Promise.all([a, b].map(p => homeUntil(p, `${p.name}'s seat to leave the scene`, 10_000, r => r.seat?.gameId === game && r.seat.sceneId === undefined)));
  const town = (await stack.sql("SELECT * FROM place")).find(p => String(p.game_id) === String(game) && p.key === "map:caerwyn");
  const seated = (await stack.sql("SELECT * FROM player")).filter(p => String(p.game_id) === String(game));
  check(`A's and B's seats are on the town's place (${town?.key}), with no scene`, !!town && seated.length === 2 && seated.every(p => String(p.place_id) === String(town.id) && (p.scene_id === null || p.scene_id === undefined)));
  check("a second walk out is refused: unavailable", (await a.conn.walk({ toward: "out" }))?.code === "unavailable");

  const gate = await moved(a, "A walks out through the gate (walk to 42,8)", () => a.conn.walk({ to: { x: 42, y: 8 } }));
  check(`A is out in the lane: ${whereabouts(gate)}`, gate.ex.at.x === 42 && gate.ex.at.y === 8);
  const lead = await mapUntil(a, "the story to have moved on: the Rat the lead, at evening", 30_000, v => v.lead?.key === "drowned-rat" && v.ex.story.time === "evening" && v);
  check(`the map's lead is the boundary's: "${lead.lead?.title}", at ${lead.ex.story.time}`, lead.lead?.key === "drowned-rat");
  for (const y of [9, 10]) await moved(a, `A steps south to (42,${y})`, () => a.conn.walk({ toward: "south" }));
  const locked = await moved(a, "A steps south into the yard", () => a.conn.walk({ toward: "south" }));
  check(`the yard's locked, and A stays at the gate: ${whereabouts(locked)}, "${locked.said}"`, locked.ex.at.x === 42 && locked.ex.at.y === 10 && /The yard's been locked up for the Assembly/.test(locked.said));

  await mapUntil(b, "B to see A at the gate", 10_000, v => v.acts === locked.acts && v);
  const seenA = exploreEvents(a, from.a), seenB = exploreEvents(b, from.b);
  check(`B saw the same ${seenA.length} explore events as A`, seenA.length >= 5 && JSON.stringify(seenA) === JSON.stringify(seenB));
  ok(`B's map says they're watching: ${b.conn.explore()?.watching}`);
}

/** The map moves' times (map-design §5): the module's "[map] game <id> <action id> <ms> ms" lines, said without a verdict (100 ms is where a search would be cached). */
export async function mapTimes(stack: Stack): Promise<void> {
  const lines = [...(await moduleLog(stack)).matchAll(/\[map\] (game \d+ \S+ \d+ ms(?:: \S+ opens)?)/g)].map(m => m[1]!);
  note(`${lines.length} map moves, as the module logged them: ${lines.join("; ")}`);
  const slow = lines.filter(l => Number(/ (\d+) ms/.exec(l)![1]) >= 100);
  note(`${slow.length} took 100 ms or more${slow.length ? `: ${slow.join("; ")}` : ""}`);
}
