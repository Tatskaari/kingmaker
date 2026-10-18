import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import type { CampaignFile } from "../scene/files.ts";
import { canonPaths } from "./world.ts";

/**
 * The lore a backstory is checked against (world.ts), on the campaign's own lore, with its
 * campaign.json `creation` block: the same docs the prototype's code chose with its regular
 * expressions, which are the reference here, copied from ai/docs/backstory.ts at 44c6d4a.
 */

const CAMPAIGN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const world = (JSON.parse(readFileSync(join(CAMPAIGN, "campaign.json"), "utf8")) as CampaignFile).creation;
const paths = readdirSync(join(CAMPAIGN, "lore"), { recursive: true, encoding: "utf8" }).filter(p => p.endsWith(".md")).map(p => p.split(sep).join("/")).sort();

/** The prototype's choice (canonFor's paths, before the docs were read). */
const PLACE_WORDS: Array<[string, RegExp]> = [
  ["Places/Granary Yard.md", /\b(granary|prout|clerk|loft|hoist)\b/i],
  ["Places/Heron Warehouse.md", /\b(heron|warehouse|saltmere|wharf|wharves)\b/i],
  ["Places/The Drowned Rat.md", /\b(drowned rat|the rat|tavern|alehouse|inn)\b/i],
  ["Places/Market Square.md", /\b(market|corn exchange|square)\b/i],
  ["Places/River Stairs.md", /\b(river|stairs|docks?|wharf|wharves|barges?|bargee)\b/i],
  ["Places/Palace Kitchens.md", /\b(kitchens?|cook|scullery)\b/i],
  ["Places/Watch House.md", /\b(watch house|watch-house|cells?|gaol|jail)\b/i],
];
function prototypeChose(story: string): string[] {
  const always = paths.filter(p => (/^World\/[^/]+\.md$/.test(p) && !/(Fronts|Caerwyn now|index)\.md$/.test(p)) || /^Cast\/[^/]+\/public\.md$/.test(p));
  const touched = PLACE_WORDS.filter(([, rx]) => rx.test(story)).map(([p]) => p);
  return [...new Set([...always, ...touched])].filter(p => paths.includes(p));
}

const STORIES = [
  "",
  "I grew up on a turnip farm in the Nine Furrows. My mother drowned in the flood.",
  "I'm the King's nephew, and Sergeant Kell taught me to read at the watch house.",
  "I carry sacks in the King's Granary. The night Prout died I was asleep in the tally loft, and I heard two men on the hoist.",
  "I drank at the Drowned Rat most nights, and I carried sacks for the Heron warehouse on the wharves.",
  "I sold eels in the MARKET SQUARE, washed pots in the palace kitchens and slept in a cell at the gaol; the river barges took me home.",
];

test("the canon list picks what the prototype's regular expressions picked, on the campaign's lore", () => {
  assert.ok(world, "campaign.json has a creation block");
  for (const story of STORIES) assert.deepEqual(canonPaths(paths, story, world), prototypeChose(story), story || "(an empty story)");
});

test("every World doc is canon but how the world stands now, its fronts and its index: nine of them", () => {
  const worldDocs = canonPaths(paths, "", world).filter(p => p.startsWith("World/"));
  assert.equal(worldDocs.length, 9);
  assert.deepEqual(world.notCanon.filter(p => paths.includes(p)), world.notCanon, "each one the world leaves out is in its lore");
  assert.ok(!worldDocs.some(p => world.notCanon.includes(p)));
});

test("a place the story touches comes in by its words, case aside, and a doc the lore hasn't got never does", () => {
  assert.ok(canonPaths(paths, "I slept in the TALLY LOFT.", world).includes("Places/Granary Yard.md"));
  assert.ok(!canonPaths(paths, "I slept in a barn.", world).includes("Places/Granary Yard.md"));
  const elsewhere = { ...world, places: [{ doc: "Places/Nowhere.md", words: "\\bbarn\\b" }] };
  assert.ok(!canonPaths(paths, "I slept in a barn.", elsewhere).includes("Places/Nowhere.md"));
});
