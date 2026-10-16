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
  assert.deepEqual(pack.scenes.map(s => s.scene.id), ["hanged-clerk"]);
  assert.match(pack.scenes[0]!.hook, /^This morning a palace clerk, Wendell Prout/);
  assert.deepEqual(pack.places.map(p => p.key), ["granary-yard"]);
  assert.deepEqual(pack.maps.map(m => m.id), ["caerwyn", "drowned-rat", "heron", "palace"]);
  assert.deepEqual([pack.campaign.start.map, pack.campaign.start.at], ["caerwyn", [42, 9]]);
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

test("a build has a concept and every field the engine makes one from, and a look names the cast in one glyph and a colour", () => {
  const noClass = changed("builds.json", b => { delete b.rogue.concept; delete b.rogue.build.classId; b.wizard.build.spells = "fireball"; });
  const badLooks = changed("looks.json", l => { l.sallow = { role: "person", glyph: "$", fg: "#c9a3ff" }; l.kell.fg = "blue"; });

  assert.deepEqual(checkCampaign(noClass), ["builds.json: rogue: no concept", "builds.json: rogue: the build has no classId", "builds.json: wizard: the build's spells isn't a list of ids"]);
  assert.deepEqual(checkCampaign(badLooks), ['looks.json: kell\'s colour "blue" isn\'t #rrggbb', "looks.json: sallow isn't in any scene's cast"]);
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

test("the maps: each builds as the simulation builds it, its ways out land where a person can stand, and the story starts on one", () => {
  const MAP = "maps/caerwyn.json";
  const broken = changed(MAP, m => { m.grid[0] = `${m.grid[0]}Z`; });
  const misnamed = changed("maps/palace.json", m => { m.id = "castle"; });
  const nowhere = changed(MAP, m => { m.exits[0].to.map = "atlantis"; m.exits[1].to.at = { x: 2, y: 1 }; });
  const strays = changed(MAP, m => { m.regions[0].rect.x = 63; m.regions[1].id = "granary-yard"; m.people[0].at = { x: 99, y: 0 }; m.people[1].times = ["teatime"]; });
  const offStart = changed("campaign.json", c => { c.start.at = [2, 2]; });
  const lostStart = changed("campaign.json", c => { c.start.map = "atlantis"; });

  assert.deepEqual(checkCampaign(broken), ['maps/caerwyn.json: it doesn\'t build (caerwyn: no legend entry for "Z" at (64, 0))']);
  assert.deepEqual(checkCampaign(misnamed), [
    "maps/palace.json: its id castle isn't its file's name",
    'maps/caerwyn.json: "Through the palace gate" goes to palace, which isn\'t one of the campaign\'s maps',
  ]);
  assert.deepEqual(checkCampaign(nowhere), [
    'maps/caerwyn.json: "Through the palace gate" goes to atlantis, which isn\'t one of the campaign\'s maps',
    'maps/caerwyn.json: "The Drowned Rat\'s door" lands on (2, 1) in drowned-rat, where nobody can stand',
  ]);
  assert.deepEqual(checkCampaign(strays), [
    "maps/caerwyn.json: a palace guard at (99, 0) is off the map",
    'maps/caerwyn.json: a palace guard\'s times ["teatime"] aren\'t times of day',
    "maps/caerwyn.json: region granary-yard isn't inside the map",
    "maps/caerwyn.json: region granary-yard is caerwyn's too",
  ]);
  assert.deepEqual(checkCampaign(offStart), ["campaign.json: it starts at (2, 2) on caerwyn, where nobody can stand"]);
  assert.deepEqual(checkCampaign(lostStart), ["campaign.json: it starts on the map atlantis, which isn't one of its maps"]);
});
