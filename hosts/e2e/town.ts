import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import type { ExploreView } from "../../client/explore/rows.ts";
import { actorsHere } from "../../shared/map/explore.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import { FAREWELL } from "../../shared/scene/talk.ts";
import * as verbs from "../../client/headless.ts";
import { onTop } from "../dev/fake.ts";
import type { Stack } from "../dev/stack.ts";
import { bigints, callLog, check, doneTurn, mapUntil, moduleLog, nextTurn, note, ok, pause, restartAi, seconds, step, until, type Player } from "./kit.ts";

/**
 * The e2e's steps for the town between scenes (town-design §4, the integrator's): a new wizard's
 * game on the map, through the client's connection. A Fire Bolt with no clear line from the lane,
 * refused in the prototype's words and writing nothing; from the street, the watch house door alight
 * in the place's town, the guards shouting, a spectator's map drawing it, and the town's clock
 * (tick_place, SpacetimeDB's schedule) burning it on. Ray of Frost at Kell from the lane: the hanged
 * clerk opens as walking in does, and once the opening's in the act is turn 1, its mechanic on the
 * turn's row. A thing the stage manager makes in the yard gets a look of its own (look.invent).
 * Then, the yard ended, a word with Kell between scenes, played on the two-part GM: a talk opens with
 * her greeting (the mouthpiece's, from her opening role) and lines to choose, told the GM's notes on
 * her (the memory reviews' line, and what the yard's ending says of her), a line chosen brings her
 * reply and new lines beside the co-GM, and walking on puts the player back on the map
 * with the waiting Rat exactly as it was; a second talk's goodbye said closes it with her reply. The
 * menu acts' times, as the module logged them.
 */

const WREN = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard who has read about fire extensively", build: "wizard" };
/** The watch house door, up the street (town-design §1.1 step 2), and the street outside it, where the bolt has a clear line (from the lane it hasn't). */
const DOOR = { x: 25, y: 6 };
const STREET = { x: 22, y: 8 };
const LANE = { x: 42, y: 9 };
/** The stage manager makes a swan with opinions every turn while this is on (ai's README: an invented look on the fake). */
const SWAN = { op: "create", what: "", to: "yard", how: "", feet: 0, name: "a disgruntled swan", kind: "creature", text: "A swan with opinions.", add: [], remove: [], quantity: 0 };
/** Step 20 left $10 in today's ledger, so the AI service keeps its ceiling raised. */
const RAISED = { KM_AI_DAILY_USD: "100" };

/** The town's own place's row (map:caerwyn) in a game, by the owner's SQL. */
async function townRow(stack: Stack, game: string): Promise<Record<string, any>> {
  return (await stack.sql(`SELECT * FROM place WHERE game_id = ${game}`)).find(p => p.key === "map:caerwyn")!;
}

/** The door's state in a place's town (JSON TownChanges), as the overlay keeps it. */
function doorIn(town: string): { states: string[]; hp?: number } | undefined {
  return town ? (JSON.parse(town) as { things?: Record<string, { states: string[]; hp?: number }> }).things?.["caerwyn:door@25,6"] : undefined;
}

/** A map move by the action menu, made and its row come back (the explore row's count of moves gone up). */
async function acted(p: Player, what: string, move: () => ReturnType<Player["conn"]["walk"]>): Promise<ExploreView> {
  const before = p.conn.explore()?.acts ?? -1;
  const refused = await move();
  check(`${what}${refused ? `: refused, ${refused.code} ${refused.text}` : ""}`, refused === undefined);
  return await mapUntil(p, `${p.name}'s move to come back`, 10_000, v => v.acts > before && v);
}

/**
 * 36–39. The town. `lead` is a client with the dev stack's owner (end_scene, as /end does); `b`
 * watches its game.
 */
export async function theTown(stack: Stack, root: string, lead: Player, b: Player, fake: FakeOptions): Promise<void> {
  step("36. The action menu on the map: Fire Bolt with no clear line refused, writing nothing; from the street the watch house door catches, the guards shout, and the town's clock burns it on");
  const quiet = onTop(fake, { streamMs: 0, suggestDelayMs: 0 });
  await restartAi(stack, quiet, RAISED);
  const was = lead.conn.explore()?.game;
  check(`${lead.name}'s new_game (${WREN.name}, the ready-made ${WREN.build}) is made`, (await lead.conn.newGame(WREN)) === undefined);
  const start = await mapUntil(lead, `${lead.name}'s new game on the map, in the lane`, 10_000, v => v.game !== was && !v.ex.scene && v.catalogue && v);
  const game = start.game;
  check(`the sheet carries the menu's catalogue: ${start.catalogue!.sections.map(s => s.title).join(", ")}`, start.catalogue!.sections.some(s => s.title === "Cantrips") && start.catalogue!.sections.some(s => s.title === "Actions"));
  check(`B's join_game(${game}) is made`, (await b.conn.joinGame(BigInt(game))) === undefined);
  await mapUntil(b, "B to see the map", 10_000, v => v.game === game && v);

  const refused = await lead.conn.act("cast", { spell: "fire-bolt", at: DOOR, self: undefined });
  check(`from the lane (${LANE.x},${LANE.y}): ${refused?.code}, "${refused?.text}"`, refused?.code === "no_line" && refused.text === "(Fire Bolt (cantrip): no clear line to there.)");
  await pause(500);
  const unmoved = await townRow(stack, game);
  check("it wrote nothing: the town's changes empty, no move counted", unmoved.town === "" && lead.conn.explore()!.acts === start.acts);

  await acted(lead, `${lead.name} walks up the street (walk to ${STREET.x},${STREET.y})`, () => lead.conn.walk({ to: STREET }));
  // The dice are the game's: a miss is a miss, and a cantrip can be cast again, as a player would.
  let cast: ExploreView | undefined;
  for (let n = 1; n <= 6 && !cast?.said.includes("catches fire"); n++) {
    cast = await acted(lead, `Fire Bolt at the watch house door (cast fire-bolt at ${DOOR.x},${DOOR.y})${n > 1 ? `, try ${n}` : ""}`, () => lead.conn.act("cast", { spell: "fire-bolt", at: DOOR, self: undefined }));
    note(cast.said.split("\n")[1] ?? cast.said);
  }
  const said = cast!.said.split("\n");
  check(`it says the prototype's lines: "${said.slice(0, 2).join(" / ")}", the door catches fire, and the town reacts: "${said.find(l => /shout/.test(l))}"`,
    /^Cast Fire Bolt \(cantrip\) on the door of the watch house$/.test(said[0] ?? "") && said.includes("The door of the watch house catches fire") && said.some(l => /shout at you to stop it/.test(l)));
  const lit = await townRow(stack, game);
  check(`the town keeps it: the door ${doorIn(String(lit.town))?.states.join(", ")} in place.town, the clock started`, !!doorIn(String(lit.town))?.states.includes("burning") && lit.ticked_at !== null && lit.ticked_at !== undefined);
  await mapUntil(b, "B's map to draw the door alight", 10_000, v => v.game === game && actorsHere(v.ex).some(a => a.id === "caerwyn:door@25,6" && a.states?.includes("burning")));
  ok("B's map draws the door burning (the town's changes, from the place's row)");

  const hp = doorIn(String(lit.town))!.hp ?? 0;
  const t0 = performance.now();
  let burned = lit;
  for (const by = t0 + 30_000; Number(burned.round) < Number(lit.round) + 2 && performance.now() < by; await pause(1000)) burned = await townRow(stack, game);
  const door = doorIn(String(burned.town));
  check(`the town's clock burns it on (tick_place every 6 s): round ${String(lit.round)} to ${String(burned.round)} in ${seconds(performance.now() - t0)}, the door's hit points ${hp} to ${door?.hp ?? "gone"}`,
    Number(burned.round) >= Number(lit.round) + 2 && (door?.hp === undefined || door.hp < hp));

  step("37. Ray of Frost at Kell from the lane: the hanged clerk opens as walking in does, and once the opening's in, the act is turn 1, its mechanic on the turn's row");
  await acted(lead, `${lead.name} walks back to the lane (walk to ${LANE.x},${LANE.y})`, () => lead.conn.walk({ to: LANE }));
  const kell = actorsHere(lead.conn.explore()!.ex).find(a => a.ref === "kell")!;
  check(`Kell waits in the yard, at (${kell?.at.x},${kell?.at.y})`, !!kell);
  check(`Ray of Frost at her (cast ray-of-frost at ${kell.at.x},${kell.at.y})`, (await lead.conn.act("cast", { spell: "ray-of-frost", at: kell.at as Tile2, self: undefined })) === undefined);
  const opened = await until(lead, "the yard to open", 30_000, r => r.scene.title === "The Hanged Clerk" && r);
  await doneTurn(lead, 0);
  const first = await doneTurn(lead, 1);
  const line = first.transcript.find(t => t.turn === 1 && t.kind === "player");
  check(`turn 1 is the act: "${line?.text}", with its dice line`, line?.text === "(I cast Ray of Frost at Sergeant Kell)" && first.transcript.some(t => t.turn === 1 && t.kind === "roll" && /^Ray of Frost/.test(t.text)));
  const [turn1] = await stack.sql(`SELECT * FROM turn WHERE scene_id = ${opened.scene.id} AND n = 1`);
  const mechanic = typeof turn1?.mechanic === "string" ? turn1.mechanic : JSON.stringify(turn1?.mechanic, bigints);
  check(`its mechanic is on the turn's row (forced: the rules resolve it before the reply): ${mechanic}`, /ray-of-frost/.test(mechanic) && /kell/.test(mechanic));
  await until(b, "B to see the yard", 10_000, r => r.scene.id === opened.scene.id);
  ok("B's seat went into the yard with the lead");

  step("38. An invented look: a swan the stage manager makes in the yard gets a glyph and colour of its own (look.invent), on its look row");
  await restartAi(stack, onTop(quiet, { byName: { world_ops: { ops: [SWAN] } } }), RAISED);
  const n = nextTurn(lead);
  check(`${lead.name} says "Is that a swan?"`, (await lead.conn.say("Is that a swan?")) === undefined);
  await doneTurn(lead, n);
  const t1 = performance.now();
  let invented: Record<string, any> | undefined;
  for (const by = t1 + 30_000; !invented && performance.now() < by; await pause(500)) {
    const swans = (await stack.sql(`SELECT * FROM entity WHERE game_id = ${game}`)).filter(e => e.name === "a disgruntled swan").map(e => String(e.id));
    invented = (await stack.sql("SELECT * FROM look")).find(l => swans.includes(String(l.entity_id)) && l.invention !== null && l.invention !== undefined);
  }
  check(`its look row is invented ${invented ? `(${String(invented.role)}: "${String(invented.glyph)}" in ${String(invented.fg)})` : ""}, ${seconds(performance.now() - t1)} after the turn`, !!invented && invented.role === "invented");
  await restartAi(stack, quiet, RAISED);

  step("39. A word with Kell between scenes, on the two-part GM: the yard ended, a talk opens with her greeting and lines, told the GM's notes on her; a line chosen brings her reply and new ones; walking on leaves the waiting Rat as it was; the next talk's goodbye closes it");
  const ended = { text: [] as string[] };
  check("the yard ended as the owner (end --exit murder-unknown)", await verbs.end(lead.conn, "murder-unknown", { print: t => ended.text.push(t), progress: () => {} }) === 0);
  await until(lead, "the Rat to wait as the lead", 60_000, r => r.story?.game.leadScene === "drowned-rat" && r.story.game.onward === undefined && r);
  const rat = await ratRows(stack, game);
  check(`the Drowned Rat waits (${String(rat.scene?.status)})`, rat.scene?.status === "waiting");
  check("walk out (walk toward out)", (await lead.conn.walk({ toward: "out" })) === undefined);
  // Kell walks with them once a scene is played (setStory, from the scene rows the client holds): a frame may come before them.
  const out = await mapUntil(lead, `${lead.name} back on the map, Kell walking with them`, 10_000, v => !v.ex.scene && v.ex.followers.some(f => f.id === "kell") && v);
  ok(`out on the map at (${out.ex.at.x},${out.ex.at.y}), Kell walking with them: ${out.ex.followers.map(f => f.name).join(", ")}`);

  check("a word with Kell (interact talk kell)", (await lead.conn.interact({ verb: "talk", target: "kell" })) === undefined);
  const talk = await until(lead, "the talk to open", 30_000, r => r.scene.kind === "talk" && r);
  const greeted = await doneTurn(lead, 0);
  const lines = greeted.suggestions.filter(s => s.turn === 0).sort((x, y) => x.ord - y.ord);
  check(`"${talk.scene.title}": her greeting, and ${lines.length} lines to choose: ${lines.map(l => `"${l.text}"`).join(", ")}`, talk.scene.title === "A word with Sergeant Agnes Kell" && lines.length >= 2 && lines.length <= 4);
  const kellRow = (await stack.sql(`SELECT * FROM entity WHERE game_id = ${game}`)).find(e => e.key === "kell")!;
  const [kellLook] = await stack.sql(`SELECT * FROM look WHERE entity_id = ${String(kellRow.id)}`);
  const here = lead.conn.view()?.present ?? [];
  check(`Kell is here in the talk, by her name and in her look's colour: ${here.map(p => `${p.name} (${p.color})`).join(", ") || "nobody"}`, here.some(p => p.key === "kell" && p.name === "Sergeant Agnes Kell" && p.color === kellLook?.fg));
  const [gameRow] = await stack.sql(`SELECT uid FROM game WHERE id = ${game}`);
  const uid = String(gameRow!.uid);
  const greeting = callLog(root, uid).filter(c => !c.started && c.operation === "two-part.opening" && String(c.key).endsWith(`:s${talk.scene.id}:t0:open`)).at(-1) as { request?: { input?: Array<{ content: string }> } } | undefined;
  const told = greeting?.request?.input?.map(m => m.content).join("\n") ?? "";
  check("her greeting is the mouthpiece's (two-part.opening), from her opening role (the co-GM's note -1)", /Character role for Sergeant Agnes Kell:\nConversation role: Characterise: at their own business/.test(told));
  check("her greeting was told the GM's notes on her (the memory reviews' line, and what the yard's ending says of her)", /## The GM's notes on Sergeant Agnes Kell from play \(what's happened with them\)\n[\s\S]*Watched everything the King’s investigator did in the yard/.test(told) && told.includes("The Hanged Clerk, as it ended: The King's investigator proved Prout was murdered"));
  await until(b, "B's seat to follow into the talk", 10_000, r => r.scene.id === talk.scene.id);
  ok("B's seat went into the talk with the lead");
  check(`${lead.name} chooses the first: "${lines[0]!.text}"`, (await lead.conn.say(lines[0]!.text)) === undefined);
  const replied = await doneTurn(lead, 1);
  const next = await until(lead, "her next lines", 10_000, r => r.suggestions.some(s => s.turn === 1) && r);
  check(`her reply, and ${next.suggestions.filter(s => s.turn === 1).length} new lines`, replied.transcript.some(t => t.turn === 1 && t.kind === "narration") && next.suggestions.filter(s => s.turn === 1).length >= 2);
  const asked = callLog(root, uid).filter(c => c.started && String(c.key).includes(`:s${talk.scene.id}:t1:`));
  check(`played on the two-part GM: ${[...new Set(asked.map(c => c.operation))].join(", ")} for its turn`, asked.some(c => c.operation === "two-part.reply") && asked.some(c => c.operation === "two-part.co-gm"));
  check(`the goodbye is a line too ("${FAREWELL}"): not said here; walking on (walk toward out)`, (await lead.conn.walk({ toward: "out" })) === undefined);
  const back = await mapUntil(lead, `${lead.name} back on the map after the talk`, 10_000, v => !v.ex.scene && v);
  const [talked] = await stack.sql(`SELECT * FROM scene WHERE id = ${talk.scene.id}`);
  const last = (await stack.sql(`SELECT * FROM transcript WHERE scene_id = ${talk.scene.id}`)).sort((x, y) => Number(x.seq) - Number(y.seq)).at(-1);
  check(`back on the map, the talk ${String(talked?.status)} ("${String(last?.text)}"), the lead still the Rat: "${back.lead?.title}"`, talked?.status === "ended" && /walks on$/.test(String(last?.text)) && back.lead?.key === "drowned-rat");
  const after = await ratRows(stack, game);
  check("the waiting Rat's scene, gm_state and place rows are as they were", JSON.stringify(after, bigints) === JSON.stringify(rat, bigints));
  const [record] = await stack.sql(`SELECT * FROM talk_record WHERE game_id = ${game}`);
  check(`Kell's talk record: count ${String(record?.count)}`, record?.cast_key === "kell" && Number(record.count) === 1);

  check("a second word with Kell (interact talk kell)", (await lead.conn.interact({ verb: "talk", target: "kell" })) === undefined);
  const again = await until(lead, "the second talk to open", 30_000, r => r.scene.kind === "talk" && r.scene.id !== talk.scene.id && r);
  await doneTurn(lead, 0);
  check(`${lead.name} says the goodbye ("${FAREWELL}")`, (await lead.conn.say(FAREWELL)) === undefined);
  const closed = await until(lead, "the talk to close", 30_000, r => r.scene.id === again.scene.id && r.scene.status === "ended" && r);
  const [second] = await stack.sql(`SELECT * FROM scene WHERE id = ${again.scene.id}`);
  const farewell = closed.transcript.filter(t => t.turn === 1);
  check(`it closes with her reply: "${farewell.find(t => t.kind === "narration")?.text.slice(0, 60)}…", then "${farewell.at(-1)?.text}" (exit ${String(second?.exit_key)})`, farewell.some(t => t.kind === "narration") && farewell.at(-1)?.text === "Scene ends: Goodbye for now" && second?.exit_key === "goodbye");
  const closing = callLog(root, uid).filter(c => c.started && String(c.key).includes(`:s${again.scene.id}:t1:`)).map(c => c.operation);
  check(`the goodbye's reply was the closing (${[...new Set(closing)].join(", ")}), with no settle after it`, closing.includes("two-part.closing") && !closing.includes("two-part.co-gm"));
  check("walk out (walk toward out)", (await lead.conn.walk({ toward: "out" })) === undefined);
  await mapUntil(lead, `${lead.name} back on the map after the goodbye`, 10_000, v => !v.ex.scene && v);
  const [counted] = await stack.sql(`SELECT * FROM talk_record WHERE game_id = ${game}`);
  check(`Kell's talk record: count ${String(counted?.count)}`, Number(counted?.count) === 2);

  const log = await moduleLog(stack);
  const acts = [...log.matchAll(/\[map\] (game \d+ (?:cast_|feature_|attack@|throw@|shove@|grapple@|lift@|jump@|hide|rest_|use_)\S* \d+ ms)/g)].map(m => m[1]!);
  note(`the menu acts' times, as the module logged them: ${acts.join("; ") || "none logged"}`);
  const ticks = [...log.matchAll(/\[tick_place\] place \d+: (\d+ rounds? \d+ ms)/g)].map(m => m[1]!);
  note(`the town's ticks: ${ticks.slice(0, 8).join("; ")}${ticks.length > 8 ? `, and ${ticks.length - 8} more` : ""}`);
}

/** The Rat's rows the talk mustn't touch: its scene, its gm_state and its place, by the owner's SQL. */
async function ratRows(stack: Stack, game: string): Promise<{ scene?: Record<string, unknown>; gm?: Record<string, unknown>; place?: Record<string, unknown> }> {
  const scene = (await stack.sql(`SELECT * FROM scene WHERE game_id = ${game}`)).find(s => s.scene_key === "drowned-rat");
  if (!scene) return {};
  const [gm] = await stack.sql(`SELECT * FROM gm_state WHERE scene_id = ${String(scene.id)}`);
  const place = (await stack.sql(`SELECT * FROM place WHERE game_id = ${game}`)).find(p => String(p.id) === String(scene.place_id));
  return { scene, gm, place };
}
