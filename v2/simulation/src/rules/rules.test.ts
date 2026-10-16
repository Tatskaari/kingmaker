import { test } from "node:test";
import assert from "node:assert/strict";
import type { SettleResponse } from "../../../shared/protocol/ai.ts";
import type { SheetData } from "../../../shared/rules/types.ts";
import type { WorldOp } from "../../../shared/world/scene-world.ts";
import { all, hostWithCampaign, identity, madeCharacter, openedGame, sceneNow } from "../host/testing.ts";

/**
 * The rules engine in the simulation (v1-design §3.6), on the memory host: a ready-made character
 * made by the engine, the same as creation makes it; its ids a pure function of the rows; and the
 * story parting the player from their gear, which their sheet follows.
 */

const blank = { what: "", to: "", how: "", name: "", kind: "", text: "", add: [] as string[], remove: [] as string[] };
const settled = (ops: WorldOp[]): SettleResponse => ({ ops, after: { landed: [], hinted: [], unanswered: false, theirs: false }, usage: { calls: 1, costUsd: 0, byOperation: {} } });

test("new_game makes each of builds.json's five through the engine: the sheet's numbers, its data and the campaign's purse", () => {
  const { host } = hostWithCampaign();
  const expected: Record<string, [string, string]> = {
    cleric: ["dwarf cleric 3 (Life Domain), acolyte background", "HP"], fighter: ["human fighter 3 (Champion), soldier background", "HP"],
    ranger: ["elf ranger 3 (Hunter), soldier background", "HP"], rogue: ["halfling rogue 3 (Thief), criminal background", "HP 24/24"], wizard: ["human wizard 3 (Evoker), sage background", "HP 20/20, spell slots 1st 4/4, 2nd 2/2"],
  };
  Object.keys(expected).forEach((build, i) => {
    assert.equal(host.as(identity(i + 1)).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "", build }), undefined, build);
    const player = host.db.player.id.find(host.view(identity(i + 1)).mySeat()!.playerId)!;
    const sheet = host.db.sheet.playerId.find(player.id)!;
    const data = JSON.parse(sheet.data) as SheetData;
    assert.equal(sheet.build, expected[build]![0]);
    assert.ok(sheet.statusLine.startsWith(expected[build]![1]), sheet.statusLine);
    assert.deepEqual([sheet.level, sheet.hp > 0, sheet.maxHp >= sheet.hp, sheet.ac > 10, Object.keys(JSON.parse(sheet.skills)).length], [3, true, true, true, 18]);
    assert.deepEqual([data.name, data.level, data.classes[0]!.id], ["Wren Ashdown", 3, build]);
    assert.ok(!("purse" in data), "the purse is the pockets'");
    assert.equal(JSON.parse(sheet.pockets).purse.length, 3, "the purse in their hands at the opening");
  });
  assert.equal(all(host.db.rulesState).length, 5);
  assert.match(host.logs.join("\n"), /\[rules\] newGame \d+ ms \(createCharacter \d+, sheetData \d+\)/);
});

test("a character made through creation is the ready-made one for the same build: the engine's sheet, but for who they are", async () => {
  const { host } = hostWithCampaign();
  const { player } = await madeCharacter(host, identity(1), { name: "Wren Ashdown", index: 0 });
  host.as(identity(2)).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a disgraced palace auditor", build: "rogue" });
  const readyMade = host.db.player.id.find(host.view(identity(2)).mySeat()!.playerId)!;

  const rowsOf = (playerId: bigint) => {
    const { playerId: _id, gameId: _game, pockets: _pockets, ...rows } = host.db.sheet.playerId.find(playerId)!;
    return JSON.parse(masked(JSON.stringify(rows))) as unknown;
  };
  assert.deepEqual(rowsOf(player.id), rowsOf(readyMade.id));
});

/** The engine's ids (each game's own, pinned to its dice) masked: what's left is the character. */
const masked = (text: string) => text.replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, "<id>");

test("the same seed and rows make the same campaign: the engine's ids and times are pinned to the dice and the transaction", async () => {
  const campaignOf = async () => {
    const { host } = await openedGame(11, "wizard");
    return all(host.db.rulesState)[0]!.campaign;
  };
  const first = await campaignOf();
  assert.equal(await campaignOf(), first);
  assert.match(first, /"at":"2026-10-16T09:00:00.000Z"/, "the transaction's time");
});

test("the story parts them from their dagger: a dice line, the dagger gone from the sheet, one roll drawn; given back, it's theirs again", async () => {
  const { host, script, wren, scene, player } = await openedGame(7, "rogue");
  const dagger = "granary-yard/wren-dagger";
  const rolls = () => host.db.dice.gameId.find(scene.gameId)!.rolls;
  const weapons = () => host.db.sheet.playerId.find(player.id)!.weapons.map(w => w.name);
  assert.deepEqual(weapons(), ["Rapier", "Shortbow", "Dagger", "Unarmed Strike"]);
  const before = rolls();

  script.then("settle", settled([{ ...blank, op: "give", what: dagger, to: "kell" }]));
  host.as(wren).say({ text: "*I hand Kell my dagger.* Hold this." });
  await host.drain();

  const lines = sceneNow(host, scene.id).lines.filter(l => l.kind === "roll").map(l => l.text);
  assert.deepEqual(lines, ["You no longer have your dagger"]);
  assert.deepEqual(host.db.rulesState.playerId.find(player.id)!.gone.length, 1);
  assert.deepEqual(weapons(), ["Rapier", "Shortbow", "Unarmed Strike"]);
  assert.equal(rolls(), before + 1);
  assert.match(host.logs.join("\n"), /\[rules\] carryGear 1 \d+ ms/);

  script.then("settle", settled([{ ...blank, op: "give", what: dagger, to: `pc:${player.id}` }]));
  host.as(wren).say({ text: "Thank you, Sergeant." });
  await host.drain();
  assert.deepEqual(sceneNow(host, scene.id).lines.filter(l => l.kind === "roll").map(l => l.text), ["You no longer have your dagger", "You have your dagger again"]);
  assert.deepEqual([host.db.rulesState.playerId.find(player.id)!.gone, weapons(), rolls()], [[], ["Rapier", "Shortbow", "Dagger", "Unarmed Strike"], before + 2]);

  host.as(wren).say({ text: "Nothing changes hands." });
  await host.drain();
  assert.equal(rolls(), before + 2, "a settle that moves no gear draws nothing");
});

test("their pockets follow the world: a coin handed over leaves their purse on the sheet", async () => {
  const { host, script, wren, player } = await openedGame(7, "ranger");
  const purse = () => (JSON.parse(host.db.sheet.playerId.find(player.id)!.pockets) as { purse: Array<{ name: string; quantity: number }> }).purse;
  assert.deepEqual(purse(), [{ name: "silver crowns", quantity: 2 }, { name: "shillings", quantity: 6 }, { name: "pennies", quantity: 12 }]);

  const crowns = [...host.db.entity.placeId.filter(host.db.player.id.find(player.id)!.placeId!)].find(e => e.name === "silver crowns")!;
  script.then("settle", settled([{ ...blank, op: "give", what: crowns.key, to: "kell" }]));
  host.as(wren).say({ text: "*I press the crowns into Kell's hand.*" });
  await host.drain();
  assert.deepEqual(purse().map(p => p.name), ["shillings", "pennies"]);
});
