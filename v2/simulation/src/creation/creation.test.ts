import { test } from "node:test";
import assert from "node:assert/strict";
import type { LoreIssue } from "../../../shared/creation/types.ts";
import type { BackstoriesRequest, CharactersRequest } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import { all, hostWithCampaign, identity, LISTS, optionOf, traitsOf } from "../host/testing.ts";
import type { MemoryHost } from "../host/memory.ts";
import { backstoryOf, chosenOf, issuesOf, offerOf, ownOf, proposalOf } from "./rows.ts";

/**
 * Character creation on the memory host (v1-design §3.3, §3.5, §4.1): each way of choosing a build
 * to a made character, the backstory's draft, notes worked in, lore check, fixes and traits, each
 * AI step a job of the creation's answered by the scripted service.
 */

const TAMSIN = { campaign: "caerwyn", name: "Tamsin Vell", concept: "a disgraced palace auditor with a ledger-keeper's eye" };
const NEPHEW = "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns.";

const creationOf = (host: MemoryHost, who = identity(1)) => host.view(who).myCreation()!;

/** A creation started and its first step answered. */
async function started(how = "three") {
  const { host, script } = hostWithCampaign();
  const tamsin = identity(1);
  assert.equal(host.as(tamsin).startCreation({ ...TAMSIN, how }), undefined);
  await host.drain();
  return { host, script, tamsin };
}

/** Three builds offered, and the second chosen: at the backstory. */
async function atBackstory() {
  const at = await started();
  assert.equal(at.host.as(at.tamsin).chooseBuild({ index: 1 }), undefined);
  return at;
}

test("three builds offered for a concept: the offer job's request, then its answer on the row and the GM idle", async () => {
  const { host, script } = hostWithCampaign();
  const tamsin = identity(1);
  host.as(tamsin).startCreation({ ...TAMSIN, how: "three" });

  const asked = creationOf(host);
  assert.deepEqual([asked.step, asked.busy, asked.how, asked.name, asked.concept, asked.campaign, asked.campaignVersion], ["choose", "builds", "three", "Tamsin Vell", TAMSIN.concept, "caerwyn", "0.1.0"]);
  assert.deepEqual(all(host.db.job).map(j => [j.move, j.step, j.state, j.endpoint, j.gameId, j.sceneId, j.turnId]), [["creation", "offer", "queued", "/v1/characters", undefined, undefined, undefined]]);

  await host.drain();

  const [request] = script.to("offer");
  const body = request!.body as CharactersRequest;
  assert.deepEqual(keyParts(body.key), { game: asked.uid, rev: asked.rev, step: "offer" });
  assert.deepEqual([body.game, body.who, body.level, body.ask], [{ id: asked.uid, campaign: "caerwyn", version: "0.1.0" }, { name: "Tamsin Vell", concept: TAMSIN.concept }, 3, { kind: "three" }]);

  const offered = creationOf(host);
  assert.deepEqual(offerOf(offered)!.options.map(o => o.build.classId), ["rogue", "wizard", "fighter"]);
  assert.deepEqual([offered.step, offered.busy, offered.rev, offered.calls, offered.costMicros], ["choose", undefined, asked.rev + 1, 1, 2000n]);
  assert.deepEqual(all(host.db.job), []);
});

test("the same name and concept again go back to the builds offered, asking for nothing; a new concept is a new offer, the backstory kept", async () => {
  const { host, script, tamsin } = await started();
  const first = creationOf(host);
  host.as(tamsin).creationBack();
  assert.equal(creationOf(host).step, "concept");

  host.as(tamsin).startCreation({ ...TAMSIN, name: " Tamsin Vell ", how: "three" });
  assert.deepEqual([creationOf(host).step, creationOf(host).uid, creationOf(host).busy], ["choose", first.uid, undefined]);
  assert.equal(all(host.db.job).length, 0, "nothing asked");

  host.as(tamsin).setBackstory({ text: NEPHEW });
  host.as(tamsin).startCreation({ ...TAMSIN, concept: "a hedge-priest", how: "three" });
  await host.drain();
  const second = creationOf(host);
  assert.notEqual(second.uid, first.uid);
  assert.deepEqual([second.concept, second.story, second.version], ["a hedge-priest", NEPHEW, first.version + 1]);
  assert.equal(script.to("offer").length, 2);
});

test("three: a build chosen, a backstory that fits the lore, its traits, and the game made from them under the creation's uid", async () => {
  const { host, script, tamsin } = await atBackstory();
  const chosen = creationOf(host);
  assert.deepEqual([chosen.step, chosenOf(chosen)!.build.classId], ["backstory", "wizard"]);

  assert.equal(host.as(tamsin).finishBackstory({ text: NEPHEW }), undefined);
  assert.equal(creationOf(host).busy, "check");
  await host.drain();

  const [check] = script.to("check"), [traits] = script.to("traits");
  assert.deepEqual([(check!.body as BackstoriesRequest).op, (check!.body as BackstoriesRequest).who, (check!.body as BackstoriesRequest).text], ["check", { name: "Tamsin Vell", concept: TAMSIN.concept, build: optionOf("wizard").line }, NEPHEW]);
  assert.equal((traits!.body as BackstoriesRequest).text, NEPHEW);
  assert.equal(keyParts(traits!.key)!.game, chosen.uid);

  const made = creationOf(host);
  const game = host.db.game.id.find(made.gameId!)!;
  const player = host.db.player.id.find(game.hostId)!;
  const sheet = host.db.sheet.playerId.find(player.id)!;
  assert.deepEqual([made.step, made.busy, made.unchecked], ["made", undefined, undefined]);
  assert.deepEqual(backstoryOf(made), traitsOf(NEPHEW));
  assert.deepEqual([game.uid, game.title, game.time, player.name, player.concept, player.role], [made.uid, "Caerwyn", "morning", "Tamsin Vell", TAMSIN.concept, "host"]);
  assert.equal(sheet.build, "human wizard 3 (Evoker), sage background");
  assert.deepEqual(JSON.parse(sheet.backstory!), traitsOf(NEPHEW));
  assert.deepEqual(JSON.parse(sheet.pockets), { purse: [{ name: "silver crowns", quantity: 2 }, { name: "shillings", quantity: 6 }, { name: "pennies", quantity: 12 }], carrying: [] }, "the campaign's purse, before the story begins");
  assert.equal(host.db.seat.identity.find(tamsin)?.playerId, player.id);
  assert.equal(host.db.dice.gameId.find(game.id)!.rolls, 0, "no die drawn: hit points are the average");
  assert.ok(host.db.rulesState.playerId.find(player.id)!.campaign.length > 1000);
  assert.deepEqual(all(host.db.scene), [], "not begun");
  assert.match(host.logs.join("\n"), /\[rules\] makeCharacter \d+ ms \(createCharacter \d+, sheetData \d+\)/);
});

test("model: the GM picks a build for the concept, and nothing written goes straight in", async () => {
  const { host, script, tamsin } = await started("model");
  const picked = creationOf(host);
  assert.equal((script.to("pick")[0]!.body as CharactersRequest).ask.kind, "one");
  assert.deepEqual([picked.how, picked.step, picked.busy, chosenOf(picked)!.build.classId], ["model", "backstory", undefined, "cleric"]);

  assert.equal(host.as(tamsin).skipBackstory(), undefined);
  const made = creationOf(host);
  assert.deepEqual([made.step, made.story, made.backstory], ["made", "", undefined]);
  const sheet = host.db.sheet.playerId.find(host.db.game.id.find(made.gameId!)!.hostId)!;
  assert.equal(sheet.build, "dwarf cleric 3 (Life Domain), acolyte background");
  assert.equal(sheet.backstory, undefined);
  assert.deepEqual([script.to("check").length, script.to("traits").length], [0, 0]);
});

test("own: their picks made by the engine; a pick overtaken by the next is dropped; a refusal noted, the lists kept", async () => {
  const { host, script } = hostWithCampaign();
  const pell = identity(2);
  let pickAgain: unknown;
  script.then("own", (request: CharactersRequest) => {
    pickAgain = host.as(pell).pickOwn({ speciesId: "gnome", classId: "wizard", subclassId: "evoker", backgroundId: "sage" });
    return { option: optionOf("rogue", "own"), lists: LISTS, usage: { calls: 0, costUsd: 0, byOperation: {} } };
  });
  script.then("own", { refusal: "There's no species called kobold: there's dwarf, elf, gnome, halfling, human and orc.", lists: LISTS, usage: { calls: 0, costUsd: 0, byOperation: {} } });

  host.as(pell).startCreation({ campaign: "caerwyn", name: "Pell Marrow", concept: "a hedge-wizard", how: "own:orc,rogue,thief,criminal" });
  assert.deepEqual(ownOf(creationOf(host, pell))!.picks, { speciesId: "orc", classId: "rogue", subclassId: "thief", backgroundId: "criminal" });
  await host.drain();

  assert.equal(pickAgain, undefined);
  const own = creationOf(host, pell);
  assert.deepEqual(script.to("own").map(s => (s.body as CharactersRequest).ask), [
    { kind: "own", picks: { speciesId: "orc", classId: "rogue", subclassId: "thief", backgroundId: "criminal" } },
    { kind: "own", picks: { speciesId: "gnome", classId: "wizard", subclassId: "evoker", backgroundId: "sage" } },
  ]);
  assert.match(host.logs.join("\n"), /:own attempt 1\] dropped: its creation has moved on/);
  assert.deepEqual([own.step, own.busy, own.note], ["custom", undefined, "The rules engine couldn't make that one: There's no species called kobold: there's dwarf, elf, gnome, halfling, human and orc."]);
  assert.deepEqual([ownOf(own)!.option, ownOf(own)!.lists], [undefined, LISTS], "the overtaken answer's card never landed; the lists came with the refusal");

  assert.equal(host.as(pell).pickOwn({ speciesId: "gnome", classId: "rogue", subclassId: "evoker", backgroundId: "sage" }), undefined);
  assert.deepEqual(ownOf(creationOf(host, pell))!.picks, { speciesId: "gnome", classId: "rogue", subclassId: "thief", backgroundId: "sage" }, "a subclass the class hasn't got: its first");
  assert.deepEqual(host.as(pell).takeOwn(), { code: "still_making", text: "(The rules engine is still making it.)" });
  await host.drain();

  assert.equal(host.as(pell).takeOwn(), undefined);
  const taken = creationOf(host, pell);
  assert.deepEqual([taken.step, chosenOf(taken)!.from, chosenOf(taken)!.build.speciesId, taken.note], ["backstory", "own", "gnome", undefined]);
  host.as(pell).skipBackstory();
  assert.equal(host.db.sheet.playerId.find(host.db.game.id.find(creationOf(host, pell).gameId!)!.hostId)!.build, "gnome rogue 3 (Thief), sage background");
});

test("make my own from the card picked out: its picks made by the engine, kept when they go back and come again", async () => {
  const { host, script, tamsin } = await started();
  assert.equal(host.as(tamsin).makeOwn({ from: 1 }), undefined);
  const making = creationOf(host);
  assert.deepEqual([making.step, making.busy, ownOf(making)!.picks], ["custom", "own", { speciesId: "human", classId: "wizard", subclassId: "evoker", backgroundId: "sage" }]);
  await host.drain();
  assert.deepEqual([creationOf(host).busy, ownOf(creationOf(host))!.option!.from, ownOf(creationOf(host))!.lists], [undefined, "own", LISTS]);

  host.as(tamsin).pickOwn({ speciesId: "orc", classId: "wizard", subclassId: "evoker", backgroundId: "sage" });
  await host.drain();
  host.as(tamsin).creationBack();
  assert.equal(creationOf(host).step, "choose");
  host.as(tamsin).makeOwn({ from: 3 });
  assert.equal(ownOf(creationOf(host))!.picks.speciesId, "orc", "their own picks kept, not the card's");
  await host.drain();
  assert.deepEqual(script.to("own").map(s => (s.body as CharactersRequest).ask.kind), ["own", "own", "own"]);
});

test("a draft: asked with nothing to work from, shown, and left; then taken, the box starting again with it", async () => {
  const { host, script, tamsin } = await atBackstory();
  host.as(tamsin).setBackstory({ text: "notes" });
  const before = creationOf(host);
  assert.equal(before.rev, creationOf(host).rev, "typing moves nothing on");

  host.as(tamsin).draftBackstory({ text: "my notes" });
  assert.equal(creationOf(host).busy, "draft");
  await host.drain();
  const drafted = creationOf(host);
  assert.deepEqual([(script.to("draft")[0]!.body as BackstoriesRequest).text, drafted.story, drafted.busy], ["", "my notes", undefined]);
  assert.deepEqual(proposalOf(drafted), { kind: "draft", text: "I kept the palace's ledgers for nine years, until the numbers stopped adding up." });

  host.as(tamsin).leaveProposal();
  assert.deepEqual([creationOf(host).proposal, creationOf(host).story], [undefined, "my notes"]);

  host.as(tamsin).draftBackstory({ text: "my notes" });
  await host.drain();
  host.as(tamsin).takeProposal();
  const taken = creationOf(host);
  assert.deepEqual([taken.story, taken.version, taken.proposal, taken.note], ["I kept the palace's ledgers for nine years, until the numbers stopped adding up.", drafted.version + 1, undefined, "It's yours now: change anything you like."]);
});

test("notes worked in: in their voice, shown to take; the GM unable to, it says why in the note", async () => {
  const { host, script, tamsin } = await atBackstory();
  host.as(tamsin).workInBackstory({ text: "auditor. caught the Treasurer. sacked." });
  await host.drain();
  assert.deepEqual([(script.to("work")[0]!.body as BackstoriesRequest).who.build, proposalOf(creationOf(host))], [optionOf("wizard").line, { kind: "work", text: "In my own words: auditor. caught the Treasurer. sacked." }]);

  script.then("work", { asked: { ok: false, why: "The GM couldn't be reached to work it in: it stays as you wrote it.", reason: "the GM couldn't be reached" }, usage: { calls: 1, costUsd: 0, byOperation: {} } });
  host.as(tamsin).takeProposal();
  host.as(tamsin).workInBackstory({ text: "more notes" });
  await host.drain();
  assert.deepEqual([creationOf(host).note, creationOf(host).proposal, creationOf(host).story], ["The GM couldn't be reached to work it in: it stays as you wrote it.", undefined, "more notes"]);
});

test("the lore check finds two issues: each fix accepted in turn, the story checked once more with them in, then its traits", async () => {
  const { host, script, tamsin } = await atBackstory();
  const issues: LoreIssue[] = [
    { quote: "I'm the King's nephew", problem: "The King has no nephew.", fix: "I'm a distant cousin of the King's steward" },
    { quote: "Fat Jory", problem: "Nobody in Caerwyn is called Fat Jory.", fix: "a moneylender on the wharves" },
  ];
  script.then("check", { checked: { ok: true, value: issues }, usage: { calls: 1, costUsd: 0.001, byOperation: {} } });

  host.as(tamsin).finishBackstory({ text: NEPHEW });
  await host.drain();
  const shown = creationOf(host);
  assert.deepEqual([issuesOf(shown), shown.issue, shown.busy, shown.step], [issues, 0, undefined, "backstory"]);

  host.as(tamsin).acceptFix();
  const first = creationOf(host);
  assert.deepEqual([first.story, first.issue, first.version], ["I'm a distant cousin of the King's steward, though nobody at court will say so. I owe Fat Jory three crowns.", 1, shown.version + 1]);

  host.as(tamsin).acceptFix();
  const fixed = "I'm a distant cousin of the King's steward, though nobody at court will say so. I owe a moneylender on the wharves three crowns.";
  assert.deepEqual([creationOf(host).story, creationOf(host).again, creationOf(host).busy, creationOf(host).issues], [fixed, true, "check", undefined]);
  await host.drain();

  assert.deepEqual(script.to("check").map(s => (s.body as BackstoriesRequest).text), [NEPHEW, fixed], "checked once more with the fixes in");
  assert.equal((script.to("traits")[0]!.body as BackstoriesRequest).text, fixed);
  assert.deepEqual([creationOf(host).step, creationOf(host).unchecked], ["made", undefined]);
});

test("a second look that still finds an issue: its fix taken goes to the traits, not a third check", async () => {
  const { host, script, tamsin } = await atBackstory();
  const issue = (quote: string, fix: string): LoreIssue => ({ quote, problem: "Not so.", fix });
  script.then("check", { checked: { ok: true, value: [issue("nephew", "godson")] }, usage: { calls: 1, costUsd: 0, byOperation: {} } });
  script.then("check", { checked: { ok: true, value: [issue("Fat Jory", "a moneylender")] }, usage: { calls: 1, costUsd: 0, byOperation: {} } });

  host.as(tamsin).finishBackstory({ text: NEPHEW });
  await host.drain();
  host.as(tamsin).acceptFix();
  await host.drain();
  assert.deepEqual([issuesOf(creationOf(host))!.length, creationOf(host).again], [1, true]);

  host.as(tamsin).acceptFix();
  assert.equal(creationOf(host).busy, "traits");
  await host.drain();
  assert.deepEqual([script.to("check").length, creationOf(host).step], [2, "made"]);
});

test("rewriting an issue: it stays over the box, and Done checks the new words; a fix whose quote has gone is theirs to rewrite", async () => {
  const { host, script, tamsin } = await atBackstory();
  const nephew: LoreIssue = { quote: "the King's nephew", problem: "The King has no nephew.", fix: "the steward's godson" };
  script.then("check", { checked: { ok: true, value: [nephew] }, usage: { calls: 1, costUsd: 0, byOperation: {} } });
  host.as(tamsin).finishBackstory({ text: NEPHEW });
  await host.drain();

  host.as(tamsin).rewriteIssue();
  assert.deepEqual([JSON.parse(creationOf(host).rewriting!), creationOf(host).issues], [nephew, undefined]);

  script.then("check", { checked: { ok: true, value: [nephew] }, usage: { calls: 1, costUsd: 0, byOperation: {} } });
  host.as(tamsin).finishBackstory({ text: "I'm the King's long-lost cousin." });
  assert.equal(creationOf(host).rewriting, undefined);
  await host.drain();
  host.as(tamsin).acceptFix();
  assert.deepEqual([JSON.parse(creationOf(host).rewriting!), creationOf(host).story], [nephew, "I'm the King's long-lost cousin."], "the quote isn't in the story now");
});

test("a lore check nobody could make: the backstory goes in, and the sheet says why (as written, or with the fixes unchecked)", async () => {
  const unreachable = { checked: { ok: false, why: "The GM couldn't be reached to check it.", reason: "the GM couldn't be reached" }, usage: { calls: 0, costUsd: 0, byOperation: {} } };

  const plain = await atBackstory();
  plain.script.then("check", unreachable);
  plain.host.as(plain.tamsin).finishBackstory({ text: NEPHEW });
  await plain.host.drain();
  assert.deepEqual([creationOf(plain.host).step, creationOf(plain.host).unchecked], ["made", "Your backstory went in as you wrote it, without the lore check: the GM couldn't be reached."]);

  const fixedUp = await atBackstory();
  fixedUp.script.then("check", { checked: { ok: true, value: [{ quote: "nephew", problem: "No.", fix: "godson" }] }, usage: { calls: 1, costUsd: 0, byOperation: {} } }, unreachable);
  fixedUp.host.as(fixedUp.tamsin).finishBackstory({ text: NEPHEW });
  await fixedUp.host.drain();
  fixedUp.host.as(fixedUp.tamsin).acceptFix();
  await fixedUp.host.drain();
  assert.deepEqual([creationOf(fixedUp.host).step, creationOf(fixedUp.host).unchecked], ["made", "Your backstory went in with the fixes you took, but nobody checked them again: the GM couldn't be reached."]);
});

test("back a screen: from the builds to the concept, from the backstory to the builds with the box's text kept, and what the GM was doing let go", async () => {
  const { host, script, tamsin } = await atBackstory();
  host.as(tamsin).draftBackstory({ text: "" });
  host.as(tamsin).creationBack({ story: "half a story" });
  const back = creationOf(host);
  assert.deepEqual([back.step, back.busy, back.story], ["choose", undefined, "half a story"]);
  await host.drain();
  assert.equal(script.to("draft").length, 1);
  assert.equal(creationOf(host).proposal, undefined, "the draft asked before going back never lands");

  host.as(tamsin).creationBack();
  assert.equal(creationOf(host).step, "concept");
});

test("each AI step of a creation is keyed by its uid, its rev and the step, and never by a game", async () => {
  const { host, script, tamsin } = await atBackstory();
  host.as(tamsin).finishBackstory({ text: NEPHEW });
  await host.drain();
  const uid = creationOf(host).uid;
  assert.deepEqual(script.sent.map(s => [keyParts(s.key)!.game, s.step]), [[uid, "offer"], [uid, "check"], [uid, "traits"]]);
  const revs = script.sent.map(s => (keyParts(s.key) as { rev: number }).rev);
  assert.deepEqual(revs, [...revs].sort((a, b) => a - b));
  assert.equal(new Set(script.sent.map(s => s.key)).size, 3);
});
