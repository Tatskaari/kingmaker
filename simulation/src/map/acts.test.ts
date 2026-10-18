import { test } from "node:test";
import assert from "node:assert/strict";
import type { Catalogue } from "../../../shared/rules/aim.ts";
import { actorsHere } from "../../../shared/map/explore.ts";
import { menuText, type MenuCtx } from "../../../shared/map/menu.ts";
import { actionId, moveOf } from "../../../shared/map/moves.ts";
import { exploreOf, keepOf } from "../../../shared/map/rows.ts";
import type { CoGmAnswer, OpenRequest, OpenResponse, ReplyRequest, ReplyResponse, SettleRequest, SettleResponse, TalkPrep } from "../../../shared/protocol/ai.ts";
import { CONFIDED, FAREWELL, GOODBYE, TOLD } from "../../../shared/scene/talk.ts";
import { all, hostWithCampaign, identity, sceneNow } from "../host/testing.ts";
import type { MemoryHost } from "../host/memory.ts";
import { mapRowsOf } from "./rows.ts";

/**
 * The town unit's simulation (docs/town-design.md §3.2-3.7, package S's done-when), on the memory
 * host with the campaign starting on its map and the ready-made wizard: the action menu from the
 * sheet as a client reads it; a Fire Bolt at the watch house door that burns it in the town's
 * changes and draws the guards, refused from where there's no clear line; the town's clock burning
 * it on and stopping once nobody's there; hiding and resting; an act at Kell opening the hanged
 * clerk, the act its first turn with its mechanic forced; a fight on the map recorded and fought by
 * the stand-in; a talk with Kell after the yard on the two-part GM, the waiting Rat untouched, its
 * goodbye said or seen by the co-GM, what she confided on the record; an invented look.
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
/** The settle's answer: the stage manager's operations beside a co-GM that moves nothing. */
const staged = (ops: SettleResponse["ops"] = []): SettleResponse => ({ ops, coGm: { roles: {}, moves: [], log: [] }, usage: none });

/** A new game on the map with the ready-made wizard: Wren in the lane. */
function onMap(seed = 7) {
  const { host, script } = hostWithCampaign(seed, { map: true });
  const wren = identity(1);
  assert.equal(host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "wizard" }), undefined);
  // A moment on, as a player takes one: the engine's ids are pinned to the dice and the clock, which a frozen clock would leave where the character's were made.
  host.advance(1000);
  const game = all(host.db.game)[0]!;
  return {
    host, script, wren, game,
    explore: () => host.db.explore.playerId.find(game.hostId)!,
    town: () => all(host.db.place).find(p => p.key === "map:caerwyn")!,
    wrenNow: () => host.db.player.id.find(game.hostId)!,
    dice: () => host.db.dice.gameId.find(game.id)!,
  };
}

/** The menu's context as a client makes it from the rows: the ExploreState, the sheet's catalogue, the explore row's keep. */
function menuOf(host: MemoryHost, gameId: bigint): MenuCtx {
  return host.transact(tx => {
    const game = tx.db.game.id.find(gameId)!;
    const rows = mapRowsOf(tx, game, tx.db.explore.playerId.find(game.hostId)!);
    const actions = tx.db.sheet.playerId.find(game.hostId)!.actions;
    return { ex: exploreOf(rows), catalogue: actions ? (JSON.parse(actions) as Catalogue) : undefined, keep: keepOf(rows.explore) };
  });
}

test("the action menu is the sheet's: a new wizard's catalogue, and the menu on the map made from the rows, the prototype's ids each one move", () => {
  const { host, wren, game } = onMap();
  const ctx = menuOf(host, game.id);
  assert.deepEqual(ctx.catalogue?.sections.map(s => s.title), ["Cantrips", "1st level", "2nd level", "Class features", "Actions"]);
  assert.deepEqual(ctx.catalogue?.you, { hurt: false, conditions: [] });
  const text = menuText(ctx);
  assert.match(text, /^What you can do \(the app's m; aimed ones take @x,y or _self\):/);
  assert.match(text, /Fire Bolt: 1d10 fire, 120 ft: sets things alight \[cast_fire-bolt@/);
  assert.match(text, /Shield: .*\(not now: a reaction: only in a fight\)/);
  assert.match(text, /Short rest: .*\(not now: nothing to rest off: you're whole and fresh\)/);
  // Every one of the menu's ids is one move, and back.
  for (const id of ["cast_fire-bolt@25,6", "throw@25,6", "feature_second-wind_self", "jump@44,9", "hide", "rest_short", "use_01JPOTION"]) assert.equal(actionId(moveOf(id)!), id);
  // A spell nobody has: there's nothing called that on the menu.
  assert.equal(host.as(wren).cast({ spell: "fireball", at: { x: 25, y: 6 } })?.code, "unavailable");
  assert.equal(host.as(wren).attack({ how: "headbutt", at: { x: 25, y: 6 } })?.code, "unavailable");
});

test("no clear line from the lane to the watch house door: refused in the prototype's words, and nothing written", () => {
  const { host, wren, explore, town, dice } = onMap();
  const before = { row: explore(), town: town(), dice: dice() };
  const refused = host.as(wren).cast({ spell: "fire-bolt", at: { x: 25, y: 6 } });
  assert.deepEqual(refused, { code: "no_line", text: "(Fire Bolt (cantrip): no clear line to there.)" });
  assert.deepEqual([explore(), town(), dice()], [before.row, before.town, before.dice]);
  // Out of its reach, and nothing there: the same, in their words.
  assert.equal(host.as(wren).cast({ spell: "ray-of-frost", at: { x: 20, y: 40 } })?.code, "out_of_reach");
  assert.equal(host.as(wren).leap({ at: { x: 42, y: 2 } })?.code, "too_far");
});

test("a game kept from before the town's clock (published over on SpacetimeDB, or a page's save) has no clock row on its map: a fire there puts it in", () => {
  const { host, wren, town } = onMap();
  host.transact(tx => { for (const row of [...tx.db.placeTick.iter()]) tx.db.placeTick.scheduledId.delete(row.scheduledId); });
  assert.equal(host.as(wren).walk({ to: { x: 22, y: 8 } }), undefined);
  assert.equal(host.as(wren).cast({ spell: "fire-bolt", at: { x: 25, y: 6 } }), undefined);
  assert.deepEqual(all(host.db.placeTick).map(row => row.placeId), [town().id]);
  host.advance(6_000);
  host.tickPlaces();
  assert.equal(town().round, 1, "it burns on");
});

test("a Fire Bolt at the watch house door from the street: it catches, the town keeps it, the guards shout; the clock burns it on, and stops once nobody's there", () => {
  const { host, wren, explore, town } = onMap();
  assert.equal(host.as(wren).walk({ to: { x: 22, y: 8 } }), undefined);
  assert.equal(host.as(wren).cast({ spell: "fire-bolt", at: { x: 25, y: 6 } }), undefined);

  const said = explore().said.split("\n");
  assert.deepEqual(said.slice(0, 2), ["Cast Fire Bolt (cantrip) on the door of the watch house", "Fire Bolt at the door of the watch house: 18 +5 = 23 vs AC 15: hit"]);
  assert.ok(said.includes("The door of the watch house catches fire"), said.join(" | "));
  assert.ok(said.includes("Both palace guards shout at you to stop it."), said.join(" | "));
  const door = (JSON.parse(town().town) as { things: Record<string, { states: string[]; at?: unknown }> }).things["caerwyn:door@25,6"]!;
  assert.ok(door.states.includes("burning"), JSON.stringify(door));
  assert.deepEqual(door.at, { x: 25, y: 6 });
  assert.ok(town().tickedAt, "the town's clock started");
  // The map draws it burning, on both sides alike (the overlay from place.town).
  const drawn = actorsHere(menuOf(host, explore().gameId).ex).find(a => a.id === "caerwyn:door@25,6");
  assert.ok(drawn?.states?.includes("burning"), JSON.stringify(drawn));

  // Twelve seconds on: two rounds burn it on (the log on the map keeps only the news: nothing caught, spread or burned down yet).
  assert.equal(all(host.db.placeTick).length, 1, "the town ticks while she's on the map");
  const hpOf = () => (JSON.parse(town().town) as { things: Record<string, { hp?: number }> }).things["caerwyn:door@25,6"]!.hp!;
  const was = { hp: hpOf(), log: explore().log };
  host.advance(12_000);
  host.tickPlaces();
  assert.equal(town().round, 2);
  assert.match(host.logs.find(l => l.startsWith("[tick_place]"))!, /2 rounds .*The door of the watch house takes \d+ fire damage/);
  assert.ok(hpOf() < was.hp, `it burns on: ${hpOf()} hit points from ${was.hp}`);
  assert.deepEqual(explore().log, was.log);
  // A minute on, ten rounds at most: it burns down, which is news.
  host.advance(60_000);
  host.tickPlaces();
  assert.equal(town().round, 12);
  assert.match(explore().log[explore().log.length - 1]!, /The door of the watch house takes \d+ fire damage and is destroyed/);

  // Into a scene: the next tick finds nobody there, and the clock stops.
  assert.equal(host.as(wren).walk({ toward: "lead" }), undefined);
  host.tickPlaces();
  assert.equal(all(host.db.placeTick).length, 0);
  assert.ok(host.logs.some(l => /\[tick_place\] place \d+: nobody there, the clock stops/.test(l)));
});

test("hide: a Stealth check against the sharpest eyes about; a short rest while whole is refused, not now", () => {
  const { host, wren, explore } = onMap();
  assert.equal(host.as(wren).hide(), undefined);
  const row = explore();
  assert.match(row.said, /^Stealth check to slip out of sight( of [^:]+)?: \d+ [+-] ?\d+ = \d+ vs DC 1\d: (success|failure)/);
  assert.equal(row.hidden, /: success/.test(row.said));
  if (!row.hidden) assert.ok(row.spotted, "seen trying: not again from here");

  assert.deepEqual(host.as(wren).rest({ length: "short" }), { code: "not_now", text: "(Short rest: not now, nothing to rest off: you're whole and fresh.)" });
  assert.equal(explore().acts, row.acts, "a refusal writes nothing");
});

test("Ray of Frost at Kell opens the hanged clerk as walking in does; once the opening's in, the act is its first turn, resolved by the rules as it starts with its mechanic forced, its directive the reply's", async () => {
  const { host, script, wren, game, explore } = onMap();
  const kell = actorsHere(menuOf(host, game.id).ex).find(a => a.ref === "kell")!;
  assert.equal(host.as(wren).cast({ spell: "ray-of-frost", at: kell.at }), undefined);
  assert.match(explore().said, /^You turn to Sergeant Kell\.$/);
  const yard = all(host.db.scene).find(s => s.sceneKey === "hanged-clerk")!;
  assert.equal(yard.status, "opening");
  await host.drain();

  // The opening asked for as walking in asks for it: no slot or roll spent on the map.
  const walked = onMap();
  walked.host.as(walked.wren).walk({ toward: "lead" });
  await walked.host.drain();
  const asked = (s: typeof script) => { const r = s.to("open")[0]!.body as OpenRequest; return { ...r, world: undefined }; };
  assert.deepEqual(asked(script), asked(walked.script));

  const now = sceneNow(host, yard.id);
  const line = now.lines.find(l => l.kind === "player")!;
  assert.deepEqual([line.turn, line.text], [1, "(I cast Ray of Frost at Sergeant Kell)"]);
  assert.equal(now.turns.find(t => t.n === 1)!.mechanic, JSON.stringify({ kind: "cast", spell: "ray-of-frost", targets: ["kell"], from: { backOff: 10 } }), "its mechanic on the turn, chosen already");
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.deepEqual([reply.turn.line.text, reply.outcome.acts?.length], ["(I cast Ray of Frost at Sergeant Kell)", 1], "the act's directive, the reply's");
  assert.ok(now.lines.some(l => l.turn === 1 && l.kind === "roll" && /^Ray of Frost/.test(l.text)), "the scene's rules resolved it");
});

test("hurting a palace guard brings the guards on: the fight is recorded on the map, moves wait for it, and fight_it_out fights it as won", () => {
  const { host, wren, explore, town } = onMap();
  assert.equal(host.as(wren).walk({ to: { x: 11, y: 16 } }), undefined);
  const guard = actorsHere(menuOf(host, explore().gameId).ex).find(a => /palace guard/.test(a.name))!;
  assert.equal(host.as(wren).cast({ spell: "fire-bolt", at: guard.at }), undefined);

  assert.match(explore().said, /Both palace guards come at you, and mean it\./);
  const fight = explore().fight!;
  assert.deepEqual(fight.combatants.map(c => [c.side, c.name, c.glyph]), [["player", "Wren Ashdown", undefined], ["enemy", "the first palace guard", "G"], ["enemy", "the second palace guard", "g"]]);
  assert.deepEqual([fight.map, fight.place], ["caerwyn", "Palace Street"]);
  assert.deepEqual(host.as(wren).walk({ toward: "north" }), { code: "not_now", text: "(There's a fight on: fight it out first.)" });

  assert.equal(host.as(wren).fightItOut(), undefined);
  assert.equal(explore().fight, undefined);
  assert.match(explore().said, /^Fists, steel and a lot of shouting: after a short, ugly scuffle in Palace Street, both palace guards are down/);
  const people = (JSON.parse(town().town) as { people: { states: Record<string, string[]> } }).people.states;
  assert.deepEqual(Object.entries(people).filter(([, s]) => s.includes("down")).length, 2, JSON.stringify(people));
  assert.equal(host.as(wren).fightItOut()?.code, "no_fight");
});

/** A two-part reply, and a talk's settle: the co-GM's moves and roles, and the next lines. */
const replied = (text: string): ReplyResponse => ({ entries: [{ speaker: "gm", kind: "narration", text }], gm: {}, firstTextMs: 3, usage: none });
const settled = (moves: CoGmAnswer["moves"], roles: CoGmAnswer["roles"] = {}, lines: string[] = []): SettleResponse => ({ ops: [], coGm: { roles, moves, log: [] }, talk: { suggestions: lines }, usage: none });
const ROLE = { status: "Walking beside the investigator, notebook away.", mental_state: "At ease; wary of the Rat's name.", conversation_role: "Could let slip she knows the Rat's door; holds back how." };

/** What a talk with Kell opens on (the AI service's prep): the facts, her card, the talk's discovery filled, what's withheld, the lines to open with. */
const PREP: TalkPrep = {
  established: ["Where and when: Granary Lane in Caerwyn, evening."],
  patches: [
    { turn: 0, why: "What Sergeant Agnes Kell might open up about in this talk: the door at the Drowned Rat.", cast: { id: "kell", secrets: ["Shows: a pause at the Rat's name.", "She let a thief go through the Rat's door once."] } },
    { turn: 0, why: "the door at the Drowned Rat: what Sergeant Agnes Kell might confide in this talk, and the ways it can come out.", fill: { id: TOLD, revelation: "She let a thief go through the Rat's door once.", paths: [
      { via: "kell", clue: "It shows before it comes out: a pause at the Rat's name.", earn: "Free, when the talk comes near it.", strength: "hook" },
      { via: "kell", clue: "She let a thief go through the Rat's door once.", earn: "Asked about it, they tell it.", strength: "strong" },
    ] } },
  ],
  confide: { note: "Cast/Kell/notes/rat.md", topic: "the door at the Drowned Rat", what: "She let a thief go once." },
  withheld: ["Cast/Kell/notes/deepest.md"], suggestions: ["How long have you been with the watch?", "What do you make of Prout?"],
};
const GREETING: OpenResponse = { present: ["kell"], entries: [{ speaker: "gm", kind: "narration", text: "Kell looks up from her notebook. \"Investigator.\"" }], opened: [], talk: PREP, usage: none };

/** The yard ended and walked out of, Kell walking with Wren and the Rat waiting: where a talk with her opens. */
async function afterTheYard() {
  const map = onMap();
  const { host, wren, game, explore } = map;
  host.as(wren).walk({ toward: "lead" });
  await host.drain();
  assert.equal(host.as(host.owner).endScene({ game: game.id, exit: "case-made" }), undefined);
  await host.drain();
  assert.equal(host.as(wren).walk({ toward: "out" }), undefined);
  assert.deepEqual(explore().followers.map(f => f.id), ["kell"]);
  const say = async (text: string) => {
    const refused = host.as(wren).say({ text });
    assert.equal(refused, undefined, `"${text}" was refused: ${refused?.text}`);
    await host.drain();
  };
  return { ...map, say };
}

test("after the yard, a word with Kell on the two-part GM: a talk opens with her role and its prep, takes a line (the co-GM's role, the talk's own lines), and walking on leaves the waiting Rat as it was and the record counted", async () => {
  const { host, script, wren, game, wrenNow, say } = await afterTheYard();
  const rat = all(host.db.scene).find(s => s.sceneKey === "drowned-rat")!;
  assert.equal(rat.status, "waiting");
  const ratRows = () => ({
    scene: host.db.scene.id.find(rat.id), gm: host.db.gmState.sceneId.find(rat.id), place: host.db.place.id.find(rat.placeId),
    entities: [...host.db.entity.placeId.filter(rat.placeId)], narrative: [...host.db.narrative.placeId.filter(rat.placeId)], positions: [...host.db.position.placeId.filter(rat.placeId)],
  });
  const before = ratRows();

  script.then("open", GREETING);
  assert.equal(host.as(wren).interact({ verb: "talk", target: "kell" }), undefined);
  const talk = all(host.db.scene).find(s => s.kind === "talk")!;
  assert.deepEqual([talk.sceneKey, talk.title, talk.status, wrenNow().sceneId, wrenNow().placeId], ["talk-kell-1", "A word with Sergeant Agnes Kell", "opening", talk.id, talk.placeId]);
  assert.equal(talk.placeId, all(host.db.place).find(p => p.key === "map:caerwyn")!.id, "on the town's own place");
  const kellId = all(host.db.entity).find(e => e.key === "kell")!.id;
  assert.deepEqual(host.db.onStage.entityId.find(kellId), { entityId: kellId, sceneId: talk.id, role: "cast" }, "Kell on stage in the talk, so a client names and colours her lines; her entity stays in the Rat's place");
  await host.drain();

  const opened = script.to("open").at(-1)!.body as OpenRequest;
  assert.deepEqual([opened.scene.kind, opened.talk?.with, opened.talk?.record.count, opened.talk?.suggest, opened.twoPart], ["talk", "kell", 1, true, true]);
  assert.match(opened.gm.twoPart.roles.kell!.conversation_role, /^Characterise: at their own business in their own manner/, "her opening role, the template's start's, which the greeting reads");
  let gm = sceneNow(host, talk.id).gm;
  assert.deepEqual([gm.withheld, gm.talk?.confide?.topic, gm.patches.map(p => p.fill?.id ?? (p.cast ? "card" : "?"))], [["Cast/Kell/notes/deepest.md"], "the door at the Drowned Rat", ["card", TOLD]]);
  assert.ok(gm.established.includes(PREP.established[0]!));
  assert.deepEqual([gm.twoPart.notes.map(n => n.turn), gm.reached], [[-1], ["talk"]]);
  assert.deepEqual([...host.db.sceneSuggestion.sceneId.filter(talk.id)].map(s => s.text), PREP.suggestions);

  // A line: replied with no decide, then settled by the co-GM (her role) beside the talk's own next lines.
  script.then("reply", replied("Kell's pencil stops. \"Long enough.\""));
  script.then("settle", settled([], { kell: ROLE }, ["Who was the thief?", "Do you regret it?"]));
  await say("How long have you been with the watch?");
  const reply = script.to("reply").at(-1)!.body as ReplyRequest;
  assert.equal(reply.outcome.windDown, undefined);
  const settle = script.to("settle").at(-1)!.body as SettleRequest;
  assert.equal(settle.talk?.suggest, true);
  gm = sceneNow(host, talk.id).gm;
  assert.deepEqual([gm.twoPart.roles.kell!.status, gm.twoPart.notes.map(n => n.turn), gm.turnsInBeat], [ROLE.status, [-1, 1], 1]);
  assert.deepEqual([...host.db.sceneSuggestion.sceneId.filter(talk.id)].map(s => [s.turn, s.text]), [[1, "Who was the thief?"], [1, "Do you regret it?"]]);
  assert.equal(script.to("suggest").filter(s => s.key.includes(`:s${talk.id}:`)).length, 0, "a talk's lines are its settle's");
  // Without new ones (the call failed, or none came), the old ones less the line just said, for this turn.
  script.then("reply", replied("\"A thief I let go.\""));
  script.then("settle", settled([], {}, []));
  await say("Who was the thief?");
  assert.deepEqual([...host.db.sceneSuggestion.sceneId.filter(talk.id)].map(s => [s.turn, s.text]), [[2, "Do you regret it?"]]);

  // Walking on: no reply, the talk over, back on the map; the Rat as it was; the record counted, nothing told.
  assert.equal(host.as(wren).walk({ toward: "out" }), undefined);
  const over = sceneNow(host, talk.id);
  assert.deepEqual([over.scene.status, over.lines.at(-1)?.text], ["ended", "Wren Ashdown walks on"]);
  assert.deepEqual([wrenNow().sceneId, wrenNow().placeId], [undefined, talk.placeId]);
  assert.deepEqual(ratRows(), before);
  assert.equal(host.db.game.id.find(game.id)!.leadScene, "drowned-rat");
  const record = all(host.db.talkRecord)[0]!;
  assert.deepEqual([record.castKey, record.count, record.told, record.stages], ["kell", 1, [], []], "nothing told; a two-part talk stages nothing");
  assert.equal(all(host.db.chapter).filter(c => c.sceneKey.startsWith("talk")).length, 0, "no chapter");
});

test("a talk's goodbye said in so many words closes it with its reply (no settle after); once the co-GM has what she kept back out, it's on her record; and the goodbye in the player's own words, the co-GM's to see, ends a talk at its settle", async () => {
  const { host, script, wren, wrenNow, say } = await afterTheYard();
  script.then("open", GREETING);
  assert.equal(host.as(wren).interact({ verb: "talk", target: "kell" }), undefined);
  await host.drain();
  const talk = all(host.db.scene).find(s => s.sceneKey === "talk-kell-1")!;

  // The co-GM sees it told: its move into the talk's discovery.
  script.then("reply", replied("\"Nan Quill put me out through that door. Twenty years back.\""));
  script.then("settle", settled([{ route: CONFIDED, outcome: "none", why: "She told how Nan put her out." }], {}, ["And you never went back?"]));
  await say("What's the Rat's door to you?");
  assert.deepEqual(sceneNow(host, talk.id).gm.reached, ["talk", TOLD]);

  // "I'll leave you to it.": the way into the goodbye taken as the turn starts, so the reply is the closing, and the talk ends with it.
  const settles = script.to("settle").length;
  script.then("reply", replied("Kell touches her notebook to her brow. \"Investigator.\""));
  await say(FAREWELL);
  const closing = script.to("reply").at(-1)!.body as ReplyRequest;
  assert.equal(closing.outcome.windDown?.exit, GOODBYE, "the goodbye said: its reply is the talk's closing");
  const over = sceneNow(host, talk.id);
  assert.deepEqual([over.scene.status, over.scene.exitKey, over.lines.at(-1)?.text], ["ended", GOODBYE, "Scene ends: Goodbye for now"]);
  assert.equal(script.to("settle").length, settles, "no settle after a closing");
  const record = all(host.db.talkRecord)[0]!;
  assert.deepEqual([record.count, record.told.map(t => [t.note, t.topic])], [1, [["Cast/Kell/notes/rat.md", "the door at the Drowned Rat"]]], "what she confided is on her record");
  assert.equal(host.as(wren).walk({ toward: "out" }), undefined);
  assert.equal(wrenNow().sceneId, undefined);

  // The second talk: a goodbye in the player's own words, which the co-GM takes after the reply that answered it: the talk ends there.
  script.then("open", GREETING);
  assert.equal(host.as(wren).interact({ verb: "talk", target: "kell" }), undefined);
  await host.drain();
  const second = all(host.db.scene).find(s => s.sceneKey === "talk-kell-2")!;
  assert.deepEqual((script.to("open").at(-1)!.body as OpenRequest).story.talks?.kell?.told.map(t => t.topic), ["the door at the Drowned Rat"], "every request says what she's told");
  script.then("reply", replied("\"Mind the stairs.\" Kell is already turning back to her notebook."));
  script.then("settle", settled([{ route: GOODBYE, outcome: "none", why: "The player said goodbye." }], {}, ["Never mind."]));
  await say("Right, I'm off. See you at the Rat, Sergeant.");
  const ended = sceneNow(host, second.id);
  assert.deepEqual([ended.scene.status, ended.scene.exitKey, ended.lines.at(-1)?.text, ended.gm.closing], ["ended", GOODBYE, "Scene ends: Goodbye for now", undefined]);
  assert.deepEqual([...host.db.sceneSuggestion.sceneId.filter(second.id)].map(s => [s.turn, s.text]), PREP.suggestions.map(t => [0, t]), "no lines once it's over");
  assert.equal(all(host.db.talkRecord)[0]!.count, 2);
});

test("Ray of Frost at Kell walking with you opens a talk with the act its first turn: resolved by the rules as its turn starts, its directive the mouthpiece's, with no decide", async () => {
  const { host, script, wren, game, explore } = await afterTheYard();
  const kell = actorsHere(menuOf(host, game.id).ex).find(a => a.ref === "kell")!;
  script.then("open", GREETING);
  assert.equal(host.as(wren).cast({ spell: "ray-of-frost", at: kell.at }), undefined);
  assert.match(explore().said, /Kell/);
  await host.drain();

  const talk = all(host.db.scene).find(s => s.kind === "talk")!;
  const now = sceneNow(host, talk.id);
  const line = now.lines.find(l => l.kind === "player")!;
  assert.deepEqual([line.turn, line.text], [1, "(I cast Ray of Frost at Sergeant Kell)"]);
  assert.ok(now.lines.some(l => l.turn === 1 && l.kind === "roll" && /^Ray of Frost/.test(l.text)), "its dice lines, the talk's rules'");
  const reply = script.to("reply").at(-1)!.body as ReplyRequest;
  assert.deepEqual([reply.outcome.acts?.length, reply.turn.line.text], [1, "(I cast Ray of Frost at Sergeant Kell)"]);
});

test("a thing the stage manager makes gets a look of its own: asked for once by its name, and the next of that name has it at once", async () => {
  const { host, script, wren } = onMap();
  host.as(wren).walk({ toward: "lead" });
  await host.drain();
  const swan = (to: string) => ({ op: "create" as const, what: "", to, how: "", name: "a disgruntled swan", kind: "creature", text: "", add: [], remove: [] });
  script.then("settle", staged([swan("yard")]));
  script.then("look", { looks: { "a disgruntled swan": { glyph: "s", color: "white", motion: "bob", light: false, being: true, group: false } }, usage: none });
  assert.equal(host.as(wren).say({ text: "Is that a swan?" }), undefined);
  await host.drain();

  const asked = script.to("look");
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0]!.body.things, [{ key: "a disgruntled swan", name: "a disgruntled swan", kind: "creature" }]);
  assert.match(asked[0]!.key, /:t1:look$/);
  const looks = all(host.db.look).filter(l => l.role === "invented");
  assert.deepEqual(looks.map(l => [l.glyph, l.fg, l.invention?.motion]), [["s", "white", "bob"]]);
  assert.deepEqual(all(host.db.lookInvention).map(l => l.key), ["a disgruntled swan"]);

  // Another swan of the same name: its look at once, nothing asked.
  script.then("settle", staged([swan("yard")]));
  assert.equal(host.as(wren).say({ text: "And another!" }), undefined);
  await host.drain();
  assert.equal(script.to("look").length, 1);
  assert.equal(all(host.db.look).filter(l => l.role === "invented").length, 2);
});
