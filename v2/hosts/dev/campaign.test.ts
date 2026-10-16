import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { installArgsOf, packOf as packOfArgs } from "../../shared/scene/files.ts";
import { checkCampaign, packOf, readCampaignFiles, type CampaignFiles } from "./campaign.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const files = readCampaignFiles(CAERWYN);

/** The campaign with one file changed: JSON edited in place, or Markdown replaced (undefined deletes it). */
function changed(path: string, edit: ((json: any) => void) | string | undefined): CampaignFiles {
  const copy = { ...files };
  if (typeof edit === "function") {
    const json = JSON.parse(copy[path]!);
    edit(json);
    copy[path] = JSON.stringify(json);
  } else if (edit === undefined) delete copy[path];
  else copy[path] = edit;
  return copy;
}

const SCENE = "scenes/hanged-clerk/scene.json", PLACE = "places/granary-yard.json";

test("caerwyn is fit to install: its pack is the structure, its files every file but none hidden", () => {
  const pack = packOf(files);

  assert.deepEqual(checkCampaign(files), []);
  assert.deepEqual(pack.scenes.map(s => s.scene.id), ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning"]);
  assert.match(pack.scenes[0]!.hook, /^This morning a palace clerk, Wendell Prout/);
  assert.deepEqual(pack.places.map(p => p.key), ["granary-yard", "drowned-rat", "heron", "dressing-room"]);
  assert.deepEqual(pack.campaign.quests, { "hanged-clerk": "The Hanged Clerk", "purveyors-man": "The Purveyor's Man", "heron-ledger": "The Heron Ledger" });
  assert.deepEqual(Object.keys(pack.builds), ["cleric", "fighter", "ranger", "rogue", "wizard"]);
  assert.equal(pack.looks.kell?.fg, "#6d9eeb");
  assert.equal(Object.keys(files).filter(p => p.startsWith("lore/")).length, 154);
  assert.ok(files["scenes/hanged-clerk/cast/kell.md"] && files["campaign.json"] && files["builds.json"]);
  assert.ok(!Object.keys(files).some(p => p.split("/").some(part => part.startsWith("."))));
});

test("the pack goes to install_campaign and back unchanged", () => {
  const pack = packOf(files);

  assert.deepEqual(packOfArgs(installArgsOf(pack)), pack);
  assert.equal(installArgsOf(pack).id, "caerwyn@0.1.0");
});

test("a scene without its words, or a card without a section, doesn't load", () => {
  assert.deepEqual(checkCampaign(changed("scenes/hanged-clerk/opening.md", undefined)), ["scenes/hanged-clerk: no opening.md"]);
  assert.deepEqual(checkCampaign(changed("scenes/hanged-clerk/cast/kell.md", "## Look\n\nTall.\n")), ['scenes/hanged-clerk: cast/kell.md has no "## Voice"']);
});

test("a route to nowhere, or a fact nobody wrote, is found", () => {
  const nowhere = changed(SCENE, s => { s.beats.yard.routes[0].to = "the-moon"; });
  const unknownFact = changed(SCENE, s => { s.beats.yard.routes[0].establishes = ["no-such-fact"]; });

  assert.deepEqual(checkCampaign(nowhere), ["scenes/hanged-clerk: yard.not-suicide -> unknown the-moon"]);
  assert.deepEqual(checkCampaign(unknownFact), ["scenes/hanged-clerk: unknown fact no-such-fact", "scenes/hanged-clerk (without its words): unknown fact no-such-fact"]);
});

test("an exit's effects and the afterwards name only facts, cast and things that exist", () => {
  const files2 = changed(SCENE, s => {
    s.exits["case-made"].effects.push({ op: "give", what: "the-crown-jewels", to: "$player" }, { op: "remember", who: "sallow", text: "x" }, { op: "journal", text: "x", if: { established: "nope" } });
    s.afterwards.push({ op: "remove", what: "ghost" });
  });

  assert.deepEqual(checkCampaign(files2), [
    "scenes/hanged-clerk: exit case-made: give names unknown the-crown-jewels",
    "scenes/hanged-clerk: exit case-made: remember names unknown sallow",
    "scenes/hanged-clerk: exit case-made: condition on unknown fact nope",
    "scenes/hanged-clerk: afterwards: remove names unknown ghost",
  ]);
});

test("the place's people are the cast, its things are somewhere, and its lore exists", () => {
  const stranger = changed(PLACE, p => { p.people.sallow = { in: "yard" }; });
  const floating = changed(PLACE, p => { p.things[0].in = "the-sky"; });
  const noLore = changed(SCENE, s => { s.lore.push("Places/Atlantis.md"); });

  assert.deepEqual(checkCampaign(stranger), ["scenes/hanged-clerk: granary-yard's people: sallow isn't in the cast"]);
  assert.deepEqual(checkCampaign(floating), ["places/granary-yard.json: thing elm is in unknown the-sky"]);
  assert.deepEqual(checkCampaign(noLore), ["scenes/hanged-clerk: lore Places/Atlantis.md isn't in lore/"]);
});

const RAT = "scenes/drowned-rat/scene.json", HERON = "scenes/heron-warehouse/scene.json";
/** The campaign's problems but the vocabulary's (which sees a changed next too: vocabulary.test.ts has those). */
const storyChecks = (f: CampaignFiles) => checkCampaign(f).filter(p => !p.startsWith("vocabulary.json"));

test("the story goes on: every exit's next and every overtaken is a scene, an interlude goes on, and what's owed is an earlier scene's", () => {
  const lost = changed(RAT, s => { s.exits["hobb-talks"].next = "the-moon"; s.overtaken = "atlantis"; });
  const stuck = changed("scenes/wharf-night/scene.json", s => { delete s.exits.onward.next; });
  const loose = changed(HERON, s => { delete s.overtaken; });
  const notOwed = changed(RAT, s => { s.essentials["prouts-page"].missed = "hanged-clerk:hat"; });
  const notNeeded = changed(SCENE, s => { delete s.essentials.page.later; });

  assert.deepEqual(storyChecks(lost), [
    "scenes/drowned-rat: exit hobb-talks goes on to the-moon, which isn't one of the campaign's scenes",
    "scenes/drowned-rat: overtaken, the story goes to atlantis, which isn't one of the campaign's scenes",
  ]);
  assert.deepEqual(storyChecks(stuck), ["scenes/wharf-night: an interlude, but none of its exits goes on (the story skips it to where they go)"]);
  assert.deepEqual(storyChecks(loose), ["scenes/heron-warehouse: it assumes things, but doesn't say where the story goes when play has overtaken them (overtaken)"]);
  // (and with nothing owed in, the page the Rat's exits give isn't anywhere the Rat has)
  assert.deepEqual(storyChecks(notOwed).filter(p => !p.endsWith("give names unknown ledger-page")), ["scenes/drowned-rat: essential prouts-page stands in for hanged-clerk:hat, which isn't another scene's essential"]);
  assert.deepEqual(storyChecks(notNeeded), ["scenes/drowned-rat: essential prouts-page stands in for hanged-clerk:page, which the rest of the story doesn't need (it has no later)"]);
});

test("the effects name an op, facts, people, things and quests the story has, onEnd's too", () => {
  const files2 = changed(RAT, s => {
    s.onEnd = [{ op: "follow", who: "moll" }];
    s.exits["taken-in"].effects.push(
      { op: "teleport", what: "hobb" },
      { op: "quest", quest: "lost-cat", do: "advance", stage: "x", text: "x" },
      { op: "attitude", who: "hobb", to: "smitten", text: "x" },
      { op: "promise", by: "$player", to: "sallow", text: "x" },
      { op: "journal", text: "x", if: { established: ["hobb-talked", "nope"] } },
    );
  });
  const fight = changed(HERON, s => { s.exits.fight.effects[0].allies = ["kell", "duchess"]; s.exits.fight.effects[1].at = "the-roof"; });

  assert.deepEqual(checkCampaign(files2), [
    "scenes/drowned-rat: onEnd: follow names unknown moll",
    "scenes/drowned-rat: exit taken-in: teleport isn't an effect the story knows",
    "scenes/drowned-rat: exit taken-in: quest lost-cat isn't one of campaign.json's quests",
    "scenes/drowned-rat: exit taken-in: attitude smitten isn't an attitude",
    "scenes/drowned-rat: exit taken-in: promise names unknown sallow",
    "scenes/drowned-rat: exit taken-in: condition on unknown fact nope",
  ]);
  assert.deepEqual(checkCampaign(fight), ["scenes/heron-warehouse: exit fight: startFight names unknown duchess", "scenes/heron-warehouse: exit fight: startFight is at unknown the-roof"]);
});

test("the Rat may give the player Prout's page, which isn't its own but is owed into it from the granary", () => {
  const rat = packOf(files).scenes.find(s => s.scene.id === "drowned-rat")!.scene;

  assert.ok(rat.exits["hobb-talks"]!.effects.some(e => e.op === "give" && e.what === "ledger-page"));
  assert.equal(rat.essentials["prouts-page"]!.missed, "hanged-clerk:page");
  const unowed = changed(RAT, s => { delete s.essentials["prouts-page"].missed; });
  assert.ok(checkCampaign(unowed).includes("scenes/drowned-rat: exit hobb-talks: give names unknown ledger-page"));
});

test("a build has a concept and every field the engine makes one from, and a look names the cast in one glyph and a colour", () => {
  const noClass = changed("builds.json", b => { delete b.rogue.concept; delete b.rogue.build.classId; b.wizard.build.spells = "fireball"; });
  const badLooks = changed("looks.json", l => { l.duchess = { role: "creature", glyph: "d", fg: "#c08a5a" }; l.kell.fg = "blue"; });

  assert.deepEqual(checkCampaign(noClass), ["builds.json: rogue: no concept", "builds.json: rogue: the build has no classId", "builds.json: wizard: the build's spells isn't a list of ids"]);
  assert.deepEqual(checkCampaign(badLooks), ['looks.json: kell\'s colour "blue" isn\'t #rrggbb', "looks.json: duchess isn't in any scene's cast"]);
});

test("a build names what the rules engine's pack has: its class, species, background, and a subclass of its class", () => {
  const offPack = changed("builds.json", b => { b.rogue.build.speciesId = "kobold"; b.wizard.build.subclassId = "thief"; b.fighter.build.backgroundId = "noble"; });

  assert.deepEqual(checkCampaign(offPack), [
    "builds.json: fighter: its background noble isn't in starter-pack@0.1.0",
    "builds.json: rogue: its species kobold isn't in starter-pack@0.1.0",
    "builds.json: wizard: its subclass thief is the rogue's, not the wizard's",
  ]);
});

test("the rules pack is the vendored one, and creation's world has its docs in lore/ and its places' words as regular expressions", () => {
  const otherPack = changed("campaign.json", c => { c.rulesPack = "starter-pack@0.2.0"; });
  const lostDocs = changed("campaign.json", c => { c.creation.primer = "World/Atlantis.md"; c.creation.places[0].words = "\\b(granary"; });

  assert.deepEqual(checkCampaign(otherPack), ["campaign.json: its rulesPack starter-pack@0.2.0 isn't the rules engine's pack, starter-pack@0.1.0"]);
  assert.deepEqual(checkCampaign(lostDocs).map(p => p.replace(/ \(.*\)$/, "")), [
    "campaign.json: creation: World/Atlantis.md isn't in lore/",
    "campaign.json: creation: Places/Granary Yard.md's words aren't a regular expression",
  ]);
});

test("campaign.json names its first scene and place, and a file that isn't JSON says so", () => {
  const lost = changed("campaign.json", c => { c.firstScene = "the-heron"; });
  const garbled = changed("looks.json", "{ kell: ");

  assert.deepEqual(checkCampaign(lost), ["campaign.json: the first scene the-heron isn't one of its scenes"]);
  assert.equal(checkCampaign(garbled).length, 1);
  assert.match(checkCampaign(garbled)[0]!, /^looks\.json isn't JSON/);
  assert.deepEqual(checkCampaign(changed("builds.json", undefined)), ["builds.json is missing"]);
});
