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
  assert.deepEqual(Object.keys(pack.builds), ["ranger", "rogue", "wizard"]);
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

test("a build has all 18 skills, and a look names the cast in one glyph and a colour", () => {
  const noStealth = changed("builds.json", b => { delete b.rogue.skills.stealth; });
  const badLooks = changed("looks.json", l => { l.sallow = { role: "person", glyph: "$", fg: "#c9a3ff" }; l.kell.fg = "blue"; });

  assert.deepEqual(checkCampaign(noStealth), ["builds.json: rogue: no stealth (a build has all 18 skills)"]);
  assert.deepEqual(checkCampaign(badLooks), ['looks.json: kell\'s colour "blue" isn\'t #rrggbb', "looks.json: sallow isn't in any scene's cast"]);
});

test("campaign.json names its first scene and place, and a file that isn't JSON says so", () => {
  const lost = changed("campaign.json", c => { c.firstScene = "the-heron"; });
  const garbled = changed("looks.json", "{ kell: ");

  assert.deepEqual(checkCampaign(lost), ["campaign.json: the first scene the-heron isn't one of its scenes"]);
  assert.equal(checkCampaign(garbled).length, 1);
  assert.match(checkCampaign(garbled)[0]!, /^looks\.json isn't JSON/);
  assert.deepEqual(checkCampaign(changed("builds.json", undefined)), ["builds.json is missing"]);
});
