import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoundaryRequest, OpenRequest } from "../../../shared/protocol/ai.ts";
import { installArgsOf } from "../../../shared/scene/files.ts";
import { getGm, putGm } from "../gm/rows.ts";
import type { MemoryHost } from "../host/memory.ts";
import { all, caerwynPack, crossedTo, http, identity, openedGame, sceneNow } from "../host/testing.ts";
import { FIGHT_NOT_PLAYED, FIGHT_SUMMARY, STANDIN_LINE } from "./words.ts";

/**
 * The story between scenes (story-design §4.3, package B's done-when), on the memory host with the AI
 * service scripted: a scene's end through any exit and what it writes; the boundary crossed, the next
 * scene waiting with what was handed on; Go on into it with the player, what they carry, Kell and
 * what's owed; the Heron's fight and its stand-in; the King's morning as a summons; The End; and the
 * owner's end_scene and carry_on.
 */

/** The tests' own hanged clerk (host/testing.ts TEST_CLERK): its endings' effects are what these tests read. */
const HANGED_CLERK = caerwynPack().scenes.find(s => s.id === "hanged-clerk")!;
const fact = (id: string) => HANGED_CLERK.facts![id]!;

/** A new game in the yard, its opening in; `end` ends the scene being played through an exit, as the owner. */
async function game(seed = 7) {
  const opened = await openedGame(seed);
  const { host } = opened;
  const gameId = opened.scene.gameId;
  return {
    ...opened, gameId,
    end: (exit: string) => host.as(host.owner).endScene({ game: gameId, exit }),
    gameRow: () => host.db.game.id.find(gameId)!,
    scenes: () => [...host.db.scene.gameId.filter(gameId)].sort((a, b) => (a.id < b.id ? -1 : 1)),
    sceneOf: (key: string) => [...host.db.scene.gameId.filter(gameId)].find(s => s.sceneKey === key),
    establish: (sceneId: bigint, ...sentences: string[]) => host.transact(tx => { const gm = getGm(tx, sceneId); gm.established.push(...sentences); putGm(tx, sceneId, gm); }),
  };
}

const byGame = <T extends { gameId: bigint }>(table: { iter(): Iterable<T> }, gameId: bigint) => all(table).filter(r => r.gameId === gameId);
const entityByKey = (host: MemoryHost, gameId: bigint, key: string) => [...host.db.entity.byGameKey.filter([gameId, key])][0];
const placeKeyOf = (host: MemoryHost, placeId: bigint) => host.db.place.id.find(placeId)!.key;
const endLine = (host: MemoryHost, exit: string) => host.logs.find(l => l.startsWith(`[end hanged-clerk ${exit}]`));

// ---------------------------------------------------------------------------------------------
// The scene's end, and what it writes.

test("each of the hanged clerk's endings writes its quest, flag, attitude, journal and follower rows, does what its world operations say, and logs the rest", async () => {
  const expected: Record<string, { quests: Array<[string, string, string, string | undefined]>; flag: string; attitudes: Array<[string, string]>; journal: string[]; recorded: string; world: string[] }> = {
    "case-made": {
      quests: [["hanged-clerk", "The Hanged Clerk", "complete", undefined], ["purveyors-man", "The Purveyor's Man", "active", undefined]],
      flag: "murder, Sallow named", attitudes: [["kell", "friendly"]],
      journal: ["Wendell Prout didn't hang himself. The trail leads to Master Sallow of the Royal Purveyor's office."], recorded: "remember kell", world: ["give ledger-page"],
    },
    "open-case": {
      quests: [["hanged-clerk", "The Hanged Clerk", "active", "murder_unnamed"]], flag: "murder, unnamed", attitudes: [],
      journal: ["Prout was murdered. The watch has it down as persons unknown."], recorded: "remember kell", world: ["give ledger-page"],
    },
    "wrong-man": {
      quests: [["hanged-clerk", "The Hanged Clerk", "failed", undefined]], flag: "murder, blamed on a granary child", attitudes: [["cob", "hostile"], ["kell", "unfriendly"], ["moll", "hostile"]],
      journal: ["We had one of the granary kids taken in for the clerk's murder. The sergeant thinks we're wrong."], recorded: "remember kell", world: ["remove cob", "remove moll"],
    },
    "closed-suicide": {
      quests: [["hanged-clerk", "The Hanged Clerk", "failed", undefined]], flag: "suicide", attitudes: [["kell", "wary"]],
      journal: ["The clerk behind the granary was filed as a suicide."], recorded: "nothing", world: [],
    },
    "walked-away": { quests: [["hanged-clerk", "The Hanged Clerk", "failed", undefined]], flag: "suicide", attitudes: [["kell", "wary"]], journal: [], recorded: "remember kell", world: [] },
  };

  for (const [exit, want] of Object.entries(expected)) {
    const { host, scene, player, gameId, end, establish } = await game();
    establish(scene.id, fact("page-read"));
    assert.equal(end(exit), undefined, `end_scene ${exit} was refused`);

    const quests = byGame(host.db.quest, gameId).map(q => [q.key, q.title, q.status, q.stage]).sort();
    assert.deepEqual(quests, want.quests, `${exit}: the quests`);
    assert.deepEqual(byGame(host.db.flag, gameId).map(f => [f.name, f.value, f.sceneId]), [["prout_death", want.flag, scene.id]], `${exit}: the flag`);
    assert.deepEqual(byGame(host.db.attitude, gameId).map(a => [a.castKey, a.attitude]).sort(), want.attitudes, `${exit}: the attitudes`);
    assert.ok(byGame(host.db.attitude, gameId).every(a => a.playerId === player.id), "an attitude is towards the controller");
    assert.deepEqual(byGame(host.db.journal, gameId).map(j => [j.text, j.sceneId, j.seq]), want.journal.map((t, i) => [t, scene.id, i + 1]), `${exit}: the journal`);
    assert.deepEqual(byGame(host.db.follower, gameId).map(f => [f.castKey, f.name, f.leaderId, f.sinceScene]), [["kell", "Sergeant Agnes Kell", player.id, "hanged-clerk"]], `${exit}: Kell follows, whichever way it ends (onEnd)`);
    const line = endLine(host, exit);
    assert.ok(line?.includes(`· recorded: ${want.recorded}`), `${exit}: the log line records the rest: ${line}`);
    assert.ok(line?.startsWith(`[end hanged-clerk ${exit}] forced: applied:`), String(line));
    for (const op of want.world) assert.ok(line!.split(" · ")[0]!.includes(op), `${exit}: ${op} applied: ${line}`);
    assert.ok(!line!.includes("not done"), String(line));

    // What its world operations say is so in the yard's rows: the page in the player's keeping, out of the boot; the children gone.
    const pc = entityByKey(host, gameId, `pc:${player.id}`)!;
    const page = entityByKey(host, gameId, "granary-yard/ledger-page")!;
    assert.equal(page.parentId === pc.id, want.world.includes("give ledger-page"), `${exit}: the page is ${want.world.includes("give ledger-page") ? "" : "not "}the player's`);
    for (const who of ["cob", "moll"]) assert.equal(entityByKey(host, gameId, who)!.gone, want.world.includes(`remove ${who}`), `${exit}: ${who} ${want.world.includes(`remove ${who}`) ? "is" : "isn't"} gone`);
  }
});

test("an effect is kept only when its facts hold: wrong-man with Moll taken in, and the ledger page only once it's been read", async () => {
  const { host, scene, gameId, end, establish } = await game();
  establish(scene.id, fact("moll-taken"));
  end("wrong-man");
  assert.deepEqual(byGame(host.db.attitude, gameId).map(a => [a.castKey, a.attitude, a.reason]).sort(), [
    ["cob", "hostile", "The player had their friend taken in for murder."],
    ["kell", "unfriendly", "Made to arrest a child for murder on no evidence."],
    ["moll", "hostile", "Taken in for a murder they didn't do, on the player's word."],
  ]);
  const line = endLine(host, "wrong-man")!;
  assert.ok(line.includes("applied: follow kell; remove moll; attitude moll hostile; attitude cob hostile; remove cob;"), line);
  assert.ok(line.includes("· recorded: remember kell · afterwards: 1 changed"), line);
  // Each taken off the yard as the operation that held says: Moll to the cells, Cob gone to ground.
  const noted = (who: string) => { const e = entityByKey(host, gameId, who)!; return [e.gone, host.db.narrative.entityId.find(e.id)!.notes.at(-1)!.text]; };
  assert.deepEqual([noted("moll"), noted("cob")], [[true, "the watch-house cells"], [true, "gone to ground somewhere in the granary quarter"]]);

  const other = await game();
  other.end("open-case");
  assert.ok(endLine(other.host, "open-case")!.includes("· recorded: remember kell ·"), "no page read, no page given");
  assert.equal(entityByKey(other.host, other.gameId, "granary-yard/ledger-page")!.parentId, entityByKey(other.host, other.gameId, "granary-yard/boots")!.id, "the page is still in the boot");
});

test("the end: Scene ends, the chapter, afterwards (Prout's body taken away), and the boundary queued with the scene as it ended", async () => {
  const { host, scene, gameId, end, gameRow } = await game();
  const prout = entityByKey(host, gameId, "granary-yard/prout")!;
  assert.equal(prout.gone, false);

  assert.equal(end("open-case"), undefined);
  const now = sceneNow(host, scene.id);
  assert.deepEqual([now.scene.status, now.scene.exitKey], ["ended", "open-case"]);
  assert.equal(now.lines.at(-1)!.text, "Scene ends: Murder by persons unknown");
  assert.deepEqual(now.gm.ended, { exitId: "open-case", turn: 0 });
  assert.equal(host.db.entity.id.find(prout.id)!.gone, true, "afterwards: Prout's body is taken away");

  const chapter = host.db.chapter.sceneId.find(scene.id)!;
  assert.deepEqual([chapter.seq, chapter.sceneKey, chapter.title, chapter.exitKey, chapter.ending, chapter.summary], [1, "hanged-clerk", "The Hanged Clerk", "open-case", "Murder by persons unknown", ""]);
  assert.deepEqual(chapter.lastMoments, [now.lines[0]!.text], "the opening is all that's been said");
  assert.equal(gameRow().onward, "moving");

  const [job] = now.jobs.filter(j => j.move === "crossBoundary");
  assert.deepEqual([job!.step, job!.key, job!.gameId, job!.sceneId, job!.turnId, job!.endpoint], ["boundary", `${gameRow().uid}:s${scene.id}:t0:boundary`, gameId, scene.id, undefined, "/v1/scenes/boundary"]);
  const request = JSON.parse(job!.request) as BoundaryRequest;
  assert.deepEqual([request.exit, request.candidates], ["open-case", ["drowned-rat", "heron-warehouse", "kings-morning"]]);
  assert.equal(request.turn.transcript.at(-1)!.text, "Scene ends: Murder by persons unknown");
  assert.equal(request.turn.world.entity.find(e => e.key === "granary-yard/prout")!.gone, true, "the world as afterwards left it");
  assert.deepEqual(request.turn.story.flags, { prout_death: "murder, unnamed" });
  assert.equal(request.turn.story.history, undefined, "nothing before the first scene");
});

test("a combat exit goes fighting: its effects recorded, no chapter, no boundary, the place as it was; a line waits for the fight", async () => {
  const pack = caerwynPack();
  const brawl = { id: "brawl", type: "story" as const, position: { x: 0, y: 0 }, data: { kind: "exit" as const, title: "A brawl in the yard", description: "A brawl.", closing: "Fists.", result: "mixed" as const, exitKind: "combat" as const, next: "caerwyn-afternoon", effects: [{ op: "startCombat", what: "cob" }] as never, lore: [] } };
  const scenes = pack.scenes.map(s => (s.id === "hanged-clerk" ? { ...s, nodes: [...s.nodes, brawl] } : s));
  const opened = await openedGame();
  const { host, scene, wren } = opened;
  host.as(host.owner).installCampaign(installArgsOf({ ...pack, scenes }));
  const gameId = scene.gameId;

  assert.equal(host.as(host.owner).endScene({ game: gameId, exit: "brawl" }), undefined);
  const now = sceneNow(host, scene.id);
  assert.deepEqual([now.scene.status, now.scene.exitKey, now.scene.endedAt], ["fighting", "brawl", undefined]);
  assert.equal(now.lines.at(-1)!.text, "Scene ends: A brawl in the yard");
  assert.ok(!host.db.chapter.sceneId.find(scene.id), "no chapter");
  assert.equal(entityByKey(host, gameId, "granary-yard/prout")!.gone, false, "afterwards waits for the fight");
  assert.deepEqual(now.jobs.filter(j => j.move === "crossBoundary"), []);
  assert.equal(host.db.game.id.find(gameId)!.onward, undefined);
  assert.ok(host.logs.includes("[end hanged-clerk brawl] forced: a fight · recorded: startCombat cob"));
  assert.equal(host.as(wren).say({ text: "Stop!" })?.code, "not_now");
  assert.equal(host.as(wren).walk({ toward: "lead" })?.code, "scene_on");
});

// ---------------------------------------------------------------------------------------------
// The boundary, and the next scene waiting.

test("the boundary's commit leaves the Rat waiting with what was handed on, the lead and evening; Kell and Cob move in, the page in Cob's boots", async () => {
  const { host, script, scene, player, gameId, end, gameRow, sceneOf } = await game();
  const yard = scene.placeId;
  const kell = entityByKey(host, gameId, "kell")!, cob = entityByKey(host, gameId, "cob")!;
  const boots = entityByKey(host, gameId, "granary-yard/boots")!, page = entityByKey(host, gameId, "granary-yard/ledger-page")!;
  const stones = entityByKey(host, gameId, "granary-yard/gutter-stones")!;
  const owed = [{ from: "hanged-clerk", id: "page", hinted: true, things: ["granary-yard/boots", "granary-yard/ledger-page"], holders: ["cob"], where: "sewn into the left boot, with Cob" }];
  const patch = { turn: 0, essential: { id: "page", what: "Prout's page", placedWith: ["Cob's boots"], carriers: ["cob"], unlocks: "the King's proof", missed: "hanged-clerk:page" }, why: "Brought over from hanged-clerk" };
  script.then("boundary", (request: BoundaryRequest) => ({
    ...crossedTo(request, "drowned-rat", {
      adjustments: ["Kell is with the investigator."], opening: "Open on the Rat's door at dusk.", lead: "Kell says the big man drinks at the Drowned Rat.",
      patches: [patch], hinted: ["page"], skipped: [], owed,
    }),
    handOff: 'Previous scene, "The Hanged Clerk", ended: Murder by persons unknown (hanged-clerk: open-case).\n- Prout was murdered.',
    lastMoments: ["Kell: Noted."], fronts: ["The Purveyor's men: a step ticked."],
  }));

  end("open-case");
  assert.equal(gameRow().onward, "moving");
  await host.drain();

  const chapter = host.db.chapter.sceneId.find(scene.id)!;
  assert.match(chapter.summary, /^Previous scene, "The Hanged Clerk", ended/);
  assert.deepEqual([chapter.lastMoments, chapter.fronts, chapter.calls, chapter.costMicros], [["Kell: Noted."], ["The Purveyor's men: a step ticked."], 3, 3000n]);

  const rat = sceneOf("drowned-rat")!;
  assert.deepEqual([rat.status, rat.time, rat.title, rat.controllerId, rat.turns], ["waiting", "evening", "The Drowned Rat", player.id, 0]);
  assert.equal(placeKeyOf(host, rat.placeId), "drowned-rat");
  assert.equal(host.db.place.id.find(rat.placeId)!.sceneId, rat.id);
  const gm = getGmOf(host, rat.id);
  assert.deepEqual([gm.beat, gm.adjustments, gm.opening, gm.lead, gm.absent, gm.hinted], ["start", ["Kell is with the investigator."], "Open on the Rat's door at dusk.", "Kell says the big man drinks at the Drowned Rat.", [], ["page"]]);
  assert.deepEqual(gm.patches, [patch]);
  assert.deepEqual(gm.owed, [{ ...owed[0]!, things: ["drowned-rat/boots", "drowned-rat/ledger-page"] }], "what's owed, its things where they are now");
  assert.deepEqual([gameRow().leadScene, gameRow().leadText, gameRow().time, gameRow().onward, gameRow().onwardNote], ["drowned-rat", "Kell says the big man drinks at the Drowned Rat.", "evening", undefined, undefined]);

  // Kell and Cob are in the Rat now, the same entities; the page goes on in Cob's boots; his gutter stones stay in the yard, where he stood.
  for (const [who, before] of [["kell", kell], ["cob", cob]] as const) {
    const now = host.db.entity.id.find(before.id)!;
    assert.deepEqual([now.key, now.placeId], [who, rat.placeId], `${who} moved in, their entity kept`);
    assert.equal(host.db.position.entityId.find(before.id)!.placeId, rat.placeId);
  }
  assert.equal(host.db.entity.id.find(cob.id)!.called, "the pot-boy", "Cob as the Rat would call him");
  assert.deepEqual([host.db.entity.id.find(boots.id)!.key, host.db.entity.id.find(boots.id)!.placeId, host.db.entity.id.find(boots.id)!.parentId], ["drowned-rat/boots", rat.placeId, cob.id]);
  assert.deepEqual([host.db.entity.id.find(page.id)!.key, host.db.entity.id.find(page.id)!.parentId], ["drowned-rat/ledger-page", boots.id]);
  const left = host.db.entity.id.find(stones.id)!;
  assert.deepEqual([left.placeId, placeKeyOf(host, left.placeId), host.db.entity.id.find(left.parentId!)!.key], [yard, "granary-yard", "granary-yard/yard"]);
  assert.deepEqual([host.db.position.entityId.find(stones.id)!.x, host.db.position.entityId.find(stones.id)!.y], [30, 24], "at Cob's spot under the body");
  assert.equal(entityByKey(host, gameId, "moll")!.placeId, yard, "Moll isn't in the Rat: she stays in the yard");
  assert.equal(host.db.player.id.find(player.id)!.sceneId, scene.id, "the seat stays on the yard until Go on");
});

test("someone the boundary keeps away isn't in the Rat, and what they hold of what's owed stays with them", async () => {
  const { host, script, scene, gameId, end, sceneOf } = await game();
  const owed = [{ from: "hanged-clerk", id: "page", hinted: false, things: ["granary-yard/boots", "granary-yard/ledger-page"], holders: ["cob"] }];
  script.then("boundary", (request: BoundaryRequest) => crossedTo(request, "drowned-rat", { absent: ["cob"], owed }));
  end("closed-suicide");
  await host.drain();

  const rat = sceneOf("drowned-rat")!;
  assert.deepEqual(getGmOf(host, rat.id).absent, ["cob"]);
  assert.equal(entityByKey(host, gameId, "cob")!.placeId, scene.placeId);
  assert.equal(entityByKey(host, gameId, "granary-yard/boots")!.placeId, scene.placeId);
  assert.equal(entityByKey(host, gameId, "kell")!.placeId, rat.placeId);
  assert.deepEqual(getGmOf(host, rat.id).owed[0]!.things, ["granary-yard/boots", "granary-yard/ledger-page"]);
});

// ---------------------------------------------------------------------------------------------
// Go on.

test("walk: refused before and during; then the Rat opens with the player, what they carry, Kell and the page with Cob; the seats follow", async () => {
  const { host, script, scene, wren, player, gameId, end, sceneOf } = await game();
  const tam = identity(2);
  assert.equal(host.as(tam).joinGame({ game: gameId }), undefined);

  assert.equal(host.as(wren).walk({ toward: "lead" })?.code, "scene_on");
  const owed = [{ from: "hanged-clerk", id: "page", hinted: true, things: ["granary-yard/boots", "granary-yard/ledger-page"], holders: ["cob"] }];
  script.then("boundary", (request: BoundaryRequest) => crossedTo(request, "drowned-rat", { owed }));
  end("open-case");
  assert.equal(host.as(wren).walk({ toward: "lead" })?.code, "no_lead", "the story hasn't moved on yet");
  await host.drain();

  assert.equal(host.as(tam).walk({ toward: "lead" })?.code, "not_controller");
  assert.equal(host.as(wren).walk({ toward: "north" })?.code, "no_way");
  assert.equal(host.as(wren).walk({ to: { x: 3, y: 4 } })?.code, "no_way");

  const pc = entityByKey(host, gameId, `pc:${player.id}`)!;
  const carried = [...host.db.entity.placeId.filter(scene.placeId)].filter(e => e.parentId === pc.id);
  assert.deepEqual(carried.map(e => e.name), ["silver crowns", "shillings", "pennies", "Wren's longbow", "Wren's shortsword", "Wren's studded leather"]);
  const kell = entityByKey(host, gameId, "kell")!;

  assert.equal(host.as(wren).walk({ toward: "lead" }), undefined);
  const rat = sceneOf("drowned-rat")!;
  assert.deepEqual([rat.status, host.db.player.id.find(player.id)!.sceneId, host.db.player.id.find(player.id)!.placeId], ["opening", rat.id, rat.placeId]);
  assert.equal(host.db.player.id.find(player.id)!.characterId, pc.id, "the player's character is the same entity");
  assert.deepEqual(host.view(tam).mySeat()?.sceneId, rat.id, "the spectator follows");

  const moved = host.db.entity.id.find(pc.id)!;
  assert.deepEqual([moved.placeId, moved.key], [rat.placeId, `pc:${player.id}`]);
  for (const thing of carried) {
    const now = host.db.entity.id.find(thing.id)!;
    assert.deepEqual([now.placeId, now.key, now.parentId], [rat.placeId, thing.key.replace("granary-yard/", "drowned-rat/"), pc.id], `${thing.name} goes with them`);
  }
  assert.equal(host.db.entity.id.find(kell.id)!.placeId, rat.placeId);
  assert.equal(entityByKey(host, gameId, "drowned-rat/ledger-page")!.parentId, entityByKey(host, gameId, "drowned-rat/boots")!.id);
  assert.equal(entityByKey(host, gameId, "drowned-rat/boots")!.parentId, entityByKey(host, gameId, "cob")!.id);
  assert.equal([...host.db.entity.placeId.filter(scene.placeId)].filter(e => e.parentId === pc.id).length, 0, "nothing's left holding on to them in the yard");

  // The world the opening is asked about: the Rat's, in the prototype's order (its own, then what's carried, then what's owed).
  const ents = [...host.db.entity.placeId.filter(rat.placeId)].sort((a, b) => a.ord - b.ord);
  assert.deepEqual(ents.map(e => e.ord), ents.map((_, i) => i + 1));
  const at = (key: string) => ents.findIndex(e => e.key === key);
  assert.ok(at(`pc:${player.id}`) < at("drowned-rat/door") && at("drowned-rat/door") < at("drowned-rat/pennies") && at("drowned-rat/pennies") < at("drowned-rat/boots"), "people, things, carried, owed");

  const stage = [...host.db.onStage.sceneId.filter(rat.id)].map(s => host.db.entity.id.find(s.entityId)!.key).sort();
  assert.ok(stage.includes("kell") && stage.includes("cob") && stage.includes(`pc:${player.id}`), stage.join(", "));

  await host.drain();
  assert.equal(sceneOf("drowned-rat")!.status, "live");
  const open = script.to("open").at(-1)!.body as OpenRequest;
  assert.equal(open.scene.key, "drowned-rat");
  assert.equal(open.key, `${host.db.game.id.find(gameId)!.uid}:s${rat.id}:t0:open`);
  assert.deepEqual(open.story.history!.map(h => [h.sceneId, h.exitId, h.journal]), [["hanged-clerk", "open-case", ["Prout was murdered. The watch has it down as persons unknown."]]]);
  assert.ok(open.story.earlier!.every(e => e.scene === "hanged-clerk" && e.markup === undefined));
  assert.equal(open.story.earlier!.at(-1)!.text, "Scene ends: Murder by persons unknown");
  assert.deepEqual(open.gm.owed[0]!.things, ["drowned-rat/boots", "drowned-rat/ledger-page"]);
  assert.equal(open.world.entity.filter(e => e.key === `pc:${player.id}`).length, 1);
  assert.equal(host.as(wren).walk({ toward: "lead" })?.code, "scene_on");
});

// ---------------------------------------------------------------------------------------------
// What the endings hand over, on into the next scenes.

/** The Rat's facts, as the campaign's own Rat has them. */
const RAT = caerwynPack().scenes.find(s => s.id === "drowned-rat")!;

test("what an ending hands over goes on with the player: the yard's page into the Rat and on, the Heron's true book into the King's morning", async () => {
  const { host, wren, player, scene, gameId, end, establish, sceneOf } = await game();
  const go = async () => { assert.equal(host.as(wren).walk({ toward: "lead" }), undefined); await host.drain(); };
  const pc = entityByKey(host, gameId, `pc:${player.id}`)!;
  const theirs = (placeId: bigint) => [...host.db.entity.placeId.filter(placeId)].filter(e => e.parentId === pc.id).map(e => e.key);

  establish(scene.id, fact("page-read"));
  end("open-case");
  assert.ok(theirs(scene.placeId).includes("granary-yard/ledger-page"), "open-case gives the page once it's been read");
  await host.drain();
  await go();
  const rat = sceneOf("drowned-rat")!;
  assert.ok(theirs(rat.placeId).includes("drowned-rat/ledger-page"), `the page goes on with them into the Rat: ${theirs(rat.placeId).join(", ")}`);

  // The Rat's own give of the page (onEnd, once it's out) finds it in their hands already: done, nothing moved.
  establish(rat.id, RAT.facts!["page-out"]!);
  end("hobb-talks");
  assert.ok(host.logs.find(l => l.startsWith("[end drowned-rat hobb-talks]"))!.includes("give ledger-page"));
  await host.drain();
  await go();
  const heron = sceneOf("heron-warehouse")!;
  const book = entityByKey(host, gameId, "heron/true-book")!;
  assert.notEqual(book.parentId, pc.id, "the true book is on Scrope's desk");

  end("proof-taken");
  assert.equal(host.db.entity.id.find(book.id)!.parentId, pc.id, "proof-taken puts the true book in their hands");
  await host.drain();
  const king = sceneOf("kings-morning")!;
  assert.equal(king.status, "live", "the summons opens at once");
  const carried = theirs(king.placeId);
  for (const key of ["dressing-room/ledger-page", "dressing-room/true-book", "dressing-room/pennies"]) assert.ok(carried.includes(key), `${key} in the King's morning: ${carried.join(", ")}`);
  assert.deepEqual(theirs(heron.placeId), [], "nothing of theirs left at the Heron");
});

test("caught in the act, the true book goes with Sallow as evidence, as its words say, unless the player has it in hand", async () => {
  const HERON = caerwynPack().scenes.find(s => s.id === "heron-warehouse")!;
  const caught = async (inHand: boolean) => {
    const { host, wren, player, gameId, end, establish, sceneOf } = await game();
    const go = async () => { assert.equal(host.as(wren).walk({ toward: "lead" }), undefined); await host.drain(); };
    end("open-case");
    await host.drain();
    await go();
    end("hobb-talks");
    await host.drain();
    await go();
    if (inHand) establish(sceneOf("heron-warehouse")!.id, HERON.facts!["book-in-hand"]!);
    end("caught-in-the-act");
    const book = entityByKey(host, gameId, "heron/true-book")!;
    const note = host.db.narrative.entityId.find(book.id)!.notes.at(-1)?.text;
    const out = { gone: book.gone, theirs: book.parentId === entityByKey(host, gameId, `pc:${player.id}`)!.id, note, journal: byGame(host.db.journal, gameId).at(-1)!.text };
    await host.drain();
    return { ...out, king: [...host.db.entity.placeId.filter(sceneOf("kings-morning")!.placeId)].some(e => e.key.endsWith("true-book")) };
  };
  assert.deepEqual(await caught(false), { gone: true, theirs: false, note: "evidence: gone with Master Sallow to the watch-house", journal: "The true book went with him as evidence: every 'lost' wagon, initialled J.S.", king: false });
  const kept = await caught(true);
  assert.deepEqual([kept.gone, kept.theirs, kept.king, kept.journal], [false, true, true, "We caught Sallow at the Heron with the King's grain, and Kell arrested him."], "in her hands, she keeps it, into the King's morning");
});

test("an ending's world operation on something that isn't in its world isn't done, and nothing is handed over in its place", async () => {
  const { host, wren, player, gameId, end, establish, sceneOf } = await game();
  end("open-case");
  await host.drain();
  assert.equal(host.as(wren).walk({ toward: "lead" }), undefined);
  await host.drain();

  // Nobody read the page in the yard and the story owed the Rat nothing, so it's still in the boot in the yard: the Rat's give of it has nothing to give.
  const rat = sceneOf("drowned-rat")!;
  establish(rat.id, RAT.facts!["page-out"]!);
  const pc = entityByKey(host, gameId, `pc:${player.id}`)!;
  const before = [...host.db.entity.placeId.filter(rat.placeId)].filter(e => e.parentId === pc.id).map(e => e.key);
  end("hobb-talks");
  const line = host.logs.find(l => l.startsWith("[end drowned-rat hobb-talks]"))!;
  assert.ok(line.includes("· not done: give ledger-page (nothing here is ledger-page)"), line);
  assert.ok(line.split(" · ")[0]!.includes("remove hobb"), "the rest of its world operations are done");
  assert.deepEqual([...host.db.entity.placeId.filter(rat.placeId)].filter(e => e.parentId === pc.id).map(e => e.key), before, "nothing new in their hands");
  assert.equal(entityByKey(host, gameId, "granary-yard/ledger-page")!.parentId, entityByKey(host, gameId, "granary-yard/boots")!.id, "the page where it was");
  assert.equal(entityByKey(host, gameId, "hobb")!.gone, true, "Hobb's gone from the Rat");
});

test("Hobb's token, handed over in the Rat, is in the player's keeping in the Heron's world, and Hobb is there as the Heron has him", async () => {
  const { host, script, wren, player, gameId, end, sceneOf } = await game();
  const go = async () => { assert.equal(host.as(wren).walk({ toward: "lead" }), undefined); await host.drain(); };
  end("open-case");
  await host.drain();
  await go();
  const pc = entityByKey(host, gameId, `pc:${player.id}`)!;
  const token = entityByKey(host, gameId, "drowned-rat/heron-token")!;
  assert.equal(token.parentId, entityByKey(host, gameId, "hobb")!.id, "round Hobb's neck");

  // He gives it up when asked: the stage manager hands it over, as it would after the reply.
  const give = { op: "give" as const, what: "drowned-rat/heron-token", to: `pc:${player.id}`, how: "", name: "", kind: "", text: "", add: [], remove: [] };
  script.then("settle", { ops: [give], coGm: { roles: {}, moves: [], log: [] }, usage: { calls: 0, costUsd: 0, byOperation: {} } });
  assert.equal(host.as(wren).say({ text: "How does a body get in, Hobb? Give me your token." }), undefined);
  await host.drain();
  assert.equal(host.db.entity.id.find(token.id)!.parentId, pc.id, "in her hands in the Rat");

  end("hobb-talks");
  assert.equal(host.db.entity.id.find(token.id)!.parentId, pc.id, "Hobb goes to his night's work; the token stays with her");
  await host.drain();
  await go();
  const heron = sceneOf("heron-warehouse")!;
  assert.deepEqual([host.db.entity.id.find(token.id)!.key, host.db.entity.id.find(token.id)!.placeId, host.db.entity.id.find(token.id)!.parentId], ["heron/heron-token", heron.placeId, pc.id]);
  const hobb = entityByKey(host, gameId, "hobb")!;
  assert.deepEqual([hobb.placeId, hobb.gone], [heron.placeId, false], "Hobb on the Heron's hoist, as its place puts him");
});

test("a thorough end (the GM loop's, for a scene it skips) takes what each discovery it reaches is in, and leaves what isn't in its world", async () => {
  const { host, wren, player, gameId, end } = await game();
  end("open-case");
  await host.drain();
  assert.equal(host.as(wren).walk({ toward: "lead" }), undefined);
  await host.drain();
  const pc = entityByKey(host, gameId, `pc:${player.id}`)!;

  // The page stayed in the boot in the yard (nobody read it, the story owed the Rat nothing): Hobb's token is here to take, the page isn't.
  assert.equal(host.as(host.owner).endScene({ game: gameId, exit: "hobb-talks", thorough: true }), undefined);
  const line = host.logs.find(l => l.startsWith("[end drowned-rat] thorough:"))!;
  assert.match(line, /reached the-loft, the-master, the-heron, way-out, prouts-page; taken: heron-token; left: ledger-page \(nothing here is ledger-page\)$/);
  assert.equal(entityByKey(host, gameId, "drowned-rat/heron-token")!.parentId, pc.id, "the token in her hands");
  assert.equal(entityByKey(host, gameId, "granary-yard/ledger-page")!.parentId, entityByKey(host, gameId, "granary-yard/boots")!.id, "the page where it was");
  assert.ok(host.logs.find(l => l.startsWith("[end drowned-rat hobb-talks]"))!.includes("not done: give ledger-page (nothing here is ledger-page)"), "nor does the Rat's own give of it find it");
  assert.match(host.db.sheet.playerId.find(player.id)!.pockets, /heron token/, "the sheet's pockets have it");
});

// ---------------------------------------------------------------------------------------------
// On through the arc: the Heron's fight, the King's summons, The End.

test("the Heron's fight goes fighting, fight_it_out picks it up, its next ending crosses to the King's morning, which opens at once; the King's ending is The End", async () => {
  const { host, script, wren, player, gameId, end, gameRow, sceneOf } = await game();
  const go = async () => { assert.equal(host.as(wren).walk({ toward: "lead" }), undefined); await host.drain(); };

  end("open-case");
  await host.drain();
  await go();
  end("hobb-talks");
  await host.drain();
  const heronLead = sceneOf("heron-warehouse")!;
  assert.deepEqual([heronLead.status, heronLead.time, gameRow().time], ["waiting", "night", "night"], "the wharf-night interlude is skipped");
  assert.deepEqual((script.to("boundary").at(-1)!.body as BoundaryRequest).candidates, ["heron-warehouse", "kings-morning"]);
  await go();

  const heron = sceneOf("heron-warehouse")!;
  assert.equal(heron.status, "live");
  assert.equal(host.as(host.owner).endScene({ game: gameId, exit: "fight" }), undefined);
  assert.equal(sceneOf("heron-warehouse")!.status, "fighting");
  assert.ok(!host.db.chapter.sceneId.find(heron.id), "no chapter");
  assert.equal(host.as(identity(9)).fightItOut()?.code, "not_in_game");

  assert.equal(host.as(wren).fightItOut(), undefined);
  let now = sceneNow(host, heron.id);
  assert.deepEqual([now.scene.status, now.scene.exitKey, now.scene.turns], ["live", undefined, now.turns.at(-1)!.n]);
  assert.deepEqual(now.lines.slice(-2).map(l => [l.text, l.kind]), [[STANDIN_LINE, "system"], [`The fight: ${FIGHT_SUMMARY}`, "system"]]);
  assert.deepEqual([now.gm.fought, now.gm.ended, now.gm.established.at(-1)], [["fight"], undefined, `The fight is over: ${FIGHT_SUMMARY}`]);
  assert.equal(byGame(host.db.journal, gameId).at(-1)!.text, FIGHT_NOT_PLAYED);
  assert.deepEqual([now.turns.at(-1)!.phase, now.scene.turnId], ["replying", now.turns.at(-1)!.id]);
  assert.equal(host.as(wren).say({ text: "Who's hurt?" })?.code, "turn_in_flight");
  assert.equal(host.as(wren).fightItOut()?.code, "no_fight");

  await host.drain();
  const aftermath = script.to("open").at(-1)!.body as OpenRequest;
  assert.deepEqual([aftermath.scene.key, aftermath.aftermath, aftermath.key.endsWith(`:t${now.turns.at(-1)!.n}:open`)], ["heron-warehouse", { summary: FIGHT_SUMMARY }, true]);
  assert.equal(aftermath.transcript!.at(-1)!.text, `The fight: ${FIGHT_SUMMARY}`);
  now = sceneNow(host, heron.id);
  assert.deepEqual([now.scene.status, now.turns.at(-1)!.phase, now.lines.at(-1)!.turn], ["live", "done", now.turns.at(-1)!.n]);

  // The next ending crosses to the King's morning, which comes to the player: it opens straight away.
  assert.equal(end("caught-in-the-act"), undefined);
  await host.drain();
  const king = sceneOf("kings-morning")!;
  assert.deepEqual([king.status, king.time, gameRow().time, gameRow().leadScene], ["live", "next-morning", "next-morning", "kings-morning"]);
  assert.equal(host.db.player.id.find(player.id)!.sceneId, king.id, "the seat moved with the summons");
  assert.equal(placeKeyOf(host, king.placeId), "dressing-room");
  assert.equal(entityByKey(host, gameId, `pc:${player.id}`)!.placeId, king.placeId);
  const history = (script.to("open").at(-1)!.body as OpenRequest).story.history!;
  assert.deepEqual(history.map(h => h.sceneId), ["hanged-clerk", "drowned-rat", "heron-warehouse"]);
  assert.ok(!history.flatMap(h => h.journal ?? []).includes(FIGHT_NOT_PLAYED), "the stand-in's word on the fight isn't the story's");

  // The King's ending goes nowhere: The End.
  assert.equal(end("justice"), undefined);
  assert.deepEqual([gameRow().status, gameRow().leadScene, gameRow().onward], ["ended", undefined, undefined]);
  assert.deepEqual(byGame(host.db.chapter, gameId).map(c => [c.seq, c.sceneKey, c.exitKey, c.summary === ""]), [
    [1, "hanged-clerk", "open-case", false], [2, "drowned-rat", "hobb-talks", false], [3, "heron-warehouse", "caught-in-the-act", false], [4, "kings-morning", "justice", true],
  ]);
  assert.deepEqual(all(host.db.job).filter(j => j.move === "crossBoundary"), []);
  assert.equal(host.as(wren).walk({ toward: "lead" })?.code, "story_over");
  assert.equal(host.as(wren).carryOn()?.code, "story_over");
  assert.deepEqual(host.view(wren).myGames(), [], "a game at The End is no longer one to continue");
});

// ---------------------------------------------------------------------------------------------
// The owner's end, and carrying on.

test("end_scene: the owner's only; no scene, no such exit (the endings listed), a turn still being answered; a settling turn let go of", async () => {
  const { host, script, wren, gameId, end, scene } = await game();
  assert.equal(host.as(wren).endScene({ game: gameId, exit: "open-case" })?.code, "not_admin");
  assert.equal(host.as(host.owner).endScene({ game: 999n, exit: "open-case" })?.code, "unknown");
  const none = end("nowhere");
  assert.equal(none?.code, "no_exit");
  assert.match(none!.text, /^\(There's no ending called nowhere here: there's case-made \(The case is made\), .* and own-ending \(An ending of their own\)\.\)$/);
  assert.match(end("")!.text, /^\(The endings here: case-made/);

  script.then("reply", () => new Promise(() => {}));
  host.as(wren).say({ text: "Who found him?" });
  void host.drain();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(end("open-case")?.code, "turn_in_flight");

  const other = await game();
  other.script.then("settle", () => new Promise(() => {}));
  other.host.as(other.wren).say({ text: "Who found him?" });
  void other.host.drain();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const settling = sceneNow(other.host, other.scene.id);
  assert.equal(settling.turns.at(-1)!.phase, "settling");
  assert.equal(other.end("open-case"), undefined);
  const after = sceneNow(other.host, other.scene.id);
  assert.deepEqual([after.scene.status, after.scene.turnId, after.turns.at(-1)!.phase], ["ended", undefined, "done"]);
  assert.ok(!after.jobs.some(j => j.move === "say"), "the settle's job is dropped");
  void scene;
});

test("carry_on: a boundary the AI service refused leaves the story stuck, saying why; carry_on queues it again and it crosses", async () => {
  const { host, script, wren, gameId, end, gameRow, sceneOf } = await game();
  assert.equal(host.as(wren).carryOn()?.code, "not_stuck");
  script.then("boundary", http(400));
  end("open-case");
  await host.drain();

  assert.equal(gameRow().onward, "failed");
  assert.match(gameRow().onwardNote!, /^The GM couldn't answer: 400 bad_request/);
  assert.equal(sceneOf("drowned-rat"), undefined);
  assert.equal(host.as(wren).walk({ toward: "lead" })?.code, "no_lead");

  assert.equal(host.as(wren).carryOn(), undefined);
  assert.equal(gameRow().onward, "moving");
  await host.drain();
  assert.deepEqual([gameRow().onward, gameRow().leadScene, sceneOf("drowned-rat")?.status], [undefined, "drowned-rat", "waiting"]);
  assert.equal(script.to("boundary").length, 2);
  assert.equal(new Set(script.to("boundary").map(s => s.key)).size, 1, "asked again under the same key");
  assert.equal(host.as(wren).carryOn()?.code, "not_stuck");
});

test("a boundary waiting to try again says so on the way on, and is moving again once it's answered", async () => {
  const { host, script, end, gameRow } = await game();
  script.then("boundary", http(503));
  end("open-case");
  await host.drain();
  assert.deepEqual([gameRow().onward, gameRow().onwardNote], ["waiting", "The GM has lost the thread for a moment: trying again."]);
  host.advance(1500);
  await host.drain();
  assert.deepEqual([gameRow().onward, gameRow().onwardNote, gameRow().leadScene], [undefined, undefined, "drowned-rat"]);
});

test("my_games says where the story is heading while the next scene waits", async () => {
  const { host, wren, end } = await game();
  end("open-case");
  assert.equal(host.view(wren).myGames()[0]!.where, "The Hanged Clerk, over");
  await host.drain();
  assert.equal(host.view(wren).myGames()[0]!.where, "heading for The Drowned Rat");
});

function getGmOf(host: MemoryHost, sceneId: bigint) {
  return host.transact(tx => getGm(tx, sceneId));
}
