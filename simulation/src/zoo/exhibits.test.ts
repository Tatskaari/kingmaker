import { test } from "node:test";
import assert from "node:assert/strict";
import { boardOfRow, eventsOf, fightOf } from "../fight/rows.ts";
import { all, hostWithCampaign, identity, installZoo } from "../host/testing.ts";

/**
 * The zoo (M6, campaigns/zoo/README.md): a visit to its combat ring (visit_zoo) is a game of the zoo's
 * campaign, kept apart from the story's, with the ring's fight on at once (initiative rolled), set out
 * from the zoo's own files; open_exhibit fights it again (the same foes, everyone fresh) or with
 * another line-up; and each line-up is played to its end by the AI on both sides.
 */

/** A host with Caerwyn and the zoo installed, as the dev stack and the page have them. */
function zooHost(seed = 7) {
  const { host } = hostWithCampaign(seed, { map: true });
  installZoo(host);
  return host;
}

const zooGame = (host: ReturnType<typeof zooHost>) => all(host.db.game).find(g => g.campaign === "zoo")!;

test("a visit to the combat ring: a zoo game as a ready-made fighter, on the ring's map, and Sallow and the Crakes' fight on at once", () => {
  const host = zooHost();
  const wren = identity(1);
  assert.equal(host.as(wren).visitZoo({ exhibit: "ring", build: "fighter" }), undefined);

  const game = zooGame(host);
  assert.deepEqual([game.campaign, game.campaignVersion, game.title], ["zoo", "0.1.0", "The zoo"]);
  const player = host.db.player.id.find(game.hostId)!;
  assert.equal(player.name, "Wren Ashdown", "the zoo's visitor, when they don't say");
  const walker = host.db.explore.playerId.find(player.id)!;
  assert.deepEqual([walker.map, walker.at], ["ring", { x: 7, y: 9 }], "on the ring's map, where its place starts the player");
  assert.equal(game.leadScene, undefined, "a visit has no lead");
  assert.equal(all(host.db.scene).filter(s => s.gameId === game.id).length, 0, "and no scene waits");

  const fight = host.transact(tx => fightOf(tx, game.id))!;
  assert.deepEqual([fight.title, fight.place, fight.mapKey, fight.status], ["The combat ring", "the combat ring", "ring", "on"]);
  const board = boardOfRow(fight);
  assert.deepEqual(board.zoo, { exhibit: "ring", foes: "sallow" }, "the exhibit's first line-up, when none is picked");
  assert.equal(board.time, "afternoon", "at the ring's scene's time of day, for the board's light");
  const who = Object.values(board.units).map(u => [u.id, u.side, u.role, `${u.at.x},${u.at.y}`]).sort();
  assert.deepEqual(who, [
    ["crake-1", "enemy", "bruiser", "6,3"], ["crake-2", "enemy", "bruiser", "10,3"], ["kell", "ally", "ally", "8,9"],
    ["player", "player", "player", "7,9"], ["sallow", "enemy", "villain", "8,2"],
  ]);
  assert.equal(board.units["sallow"]!.weaponName, "Sword-cane", "Sallow's statblock is the ring's duellist's");
  assert.equal(board.units["sallow"]!.maxHp, 33);
  assert.equal(board.units["crake-1"]!.maxHp, 22, "the Crakes are river-bruisers");
  assert.equal(board.units["player"]!.hp, board.units["player"]!.maxHp, "rested: it's practice");
  assert.deepEqual(Object.values(board.props).map(p => [p.id, p.kind, `${p.at.x},${p.at.y}`, p.lit]), [["brazier", "brazier", "4,8", true]]);
  const moments = host.transact(tx => eventsOf(tx, fight.id));
  assert.equal(moments[0]!.kind, "start");
  assert.match(moments[0]!.detail.lines.join("\n"), /Roll for initiative!/);
  assert.equal(moments[0]!.detail.initiative?.length, 5, "initiative rolled for everyone");

  const games = host.view(wren).myGames();
  assert.deepEqual(games.map(g => [g.campaign, g.name]), [["zoo", "Wren Ashdown"]], "my_games says which campaign: the title keeps a visit apart");
});

test("again: open_exhibit sets the ring out afresh with the same foes, everyone whole; with foes, another line-up", () => {
  const host = zooHost(11);
  const wren = identity(1);
  assert.equal(host.as(wren).visitZoo({ exhibit: "ring", build: "wizard", name: "Tamsin Vell", foes: "crakes", fast: true }), undefined);
  const game = zooGame(host);
  const fight = () => host.transact(tx => fightOf(tx, game.id))!;
  const first = fight();
  assert.equal(host.db.player.id.find(game.hostId)!.name, "Tamsin Vell");
  assert.deepEqual(Object.keys(boardOfRow(first).units).sort(), ["crake-1", "crake-2", "kell", "player"], "the Crakes alone");

  // A few turns in, someone's hurt; then again, mid-fight.
  for (let i = 0; i < 40 && fight().status === "on" && !Object.values(boardOfRow(fight()).units).some(u => u.hp < u.maxHp); i++) {
    if (fight().options) assert.equal(host.as(wren).fightTurn({ act: "auto" }), undefined);
    host.fightSteps();
  }
  assert.ok(Object.values(boardOfRow(fight()).units).some(u => u.hp < u.maxHp), "someone was hurt before it was set out again");
  assert.equal(host.as(wren).openExhibit({ exhibit: "ring" }), undefined);
  const again = fight();
  assert.notEqual(again.id, first.id, "a new fight");
  assert.equal(again.status, "on");
  assert.deepEqual(boardOfRow(again).zoo, { exhibit: "ring", foes: "crakes" }, "the same foes");
  assert.equal(boardOfRow(again).fast, true, "at the same pace");
  assert.ok(Object.values(boardOfRow(again).units).every(u => u.hp === u.maxHp), "everyone whole");
  assert.equal(all(host.db.fight).filter(f => f.gameId === game.id).length, 1, "the last fight's rows went");

  assert.equal(host.as(wren).openExhibit({ exhibit: "ring", foes: "dogs" }), undefined);
  const dogs = boardOfRow(fight());
  assert.deepEqual(dogs.zoo, { exhibit: "ring", foes: "dogs" });
  assert.deepEqual(Object.values(dogs.units).filter(u => u.side === "enemy").map(u => [u.id, u.name, u.maxHp]), [["dog-1", "a brindle mastiff", 5], ["dog-2", "a black mastiff", 5], ["dog-3", "a grey mastiff", 5]]);
  assert.equal(host.as(wren).openExhibit({ exhibit: "ring", foes: "sallow" }), undefined);
  assert.ok(boardOfRow(fight()).units["sallow"], "and Sallow with them");
});

test("the zoo's refusals: not installed, no such exhibit, line-up or build, a story's game, a spectator, and a second visit replaces the first", () => {
  const bare = hostWithCampaign(3, { map: true }).host;
  assert.equal(bare.as(identity(1)).visitZoo({ exhibit: "ring", build: "fighter" })?.code, "no_campaign", "the zoo isn't installed");

  const host = zooHost(5);
  const wren = identity(1), tom = identity(2);
  assert.equal(host.as(wren).visitZoo({ exhibit: "theatre", build: "fighter" })?.text, "(There's no exhibit called theatre in the zoo: there's ring.)");
  assert.equal(host.as(wren).visitZoo({ exhibit: "ring", build: "fighter", foes: "wolves" })?.text, "(The combat ring has no line-up called wolves: there's sallow, crakes and dogs.)");
  assert.equal(host.as(wren).visitZoo({ exhibit: "ring", build: "cleric" })?.text, "(There's no ready-made build called cleric: there's fighter, wizard and rogue.)");
  assert.equal(host.as(wren).openExhibit({ exhibit: "ring" })?.code, "not_in_game");

  // A story's game has no exhibits; its own lead stays as it was.
  assert.equal(host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a sellsword", build: "fighter" }), undefined);
  assert.equal(host.as(wren).openExhibit({ exhibit: "ring" })?.text, "(There's no exhibit called ring in Caerwyn (the zoo's are in the zoo): there's none.)");
  const story = all(host.db.game).find(g => g.campaign === "caerwyn")!;

  assert.equal(host.as(wren).visitZoo({ exhibit: "ring", build: "rogue" }), undefined);
  const first = zooGame(host);
  assert.equal(host.as(tom).joinGame({ game: first.id }), undefined);
  assert.equal(host.as(tom).openExhibit({ exhibit: "ring" })?.code, "not_controller", "a spectator watches");

  assert.equal(host.as(wren).visitZoo({ exhibit: "ring", build: "fighter", foes: "dogs" }), undefined);
  const visits = all(host.db.game).filter(g => g.campaign === "zoo");
  assert.equal(visits.length, 1, "one visit a player at a time");
  assert.notEqual(visits[0]!.id, first.id, "the second replaced the first");
  assert.equal(all(host.db.fight).filter(f => f.gameId === first.id).length, 0, "and its fight went with it");
  assert.ok(host.db.game.id.find(story.id), "the story's game is as it was");
  assert.deepEqual(host.view(wren).myGames().map(g => g.campaign).sort(), ["caerwyn", "zoo"]);
});

for (const [foes, build, seed] of [["sallow", "fighter", 2], ["crakes", "wizard", 3], ["dogs", "rogue", 4]] as const) {
  test(`the ring with ${foes}, played to its end by the AI on both sides (the ready-made ${build})`, () => {
    const host = zooHost(seed);
    const wren = identity(1);
    assert.equal(host.as(wren).visitZoo({ exhibit: "ring", build, foes, fast: true }), undefined);
    const game = zooGame(host);
    const fight = () => host.transact(tx => fightOf(tx, game.id))!;
    for (let i = 0; i < 300 && fight().status === "on"; i++) {
      if (fight().options) assert.equal(host.as(wren).fightTurn({ act: "auto" }), undefined);
      host.fightSteps();
    }
    const over = fight();
    assert.equal(over.status, "over", `the ring with ${foes} ends`);
    const moments = host.transact(tx => eventsOf(tx, over.id));
    assert.deepEqual(moments.map(e => e.seq), moments.map((_, i) => i + 1), "numbered in order");
    for (const e of moments) assert.ok(e.caption.trim().length > 5 && !/undefined|NaN/.test(e.caption), `a caption for ${e.kind}: "${e.caption}"`);
    assert.equal(moments[moments.length - 1]!.kind, "over");
    assert.deepEqual(host.logs.filter(l => /\[fight_step\].*stopped|wouldn't pass/.test(l)), [], "no step stopped");
  });
}
