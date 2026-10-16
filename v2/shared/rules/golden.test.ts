import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import type { RollResult } from "../dice.ts";
import type { Skill } from "../scene/types.ts";
import { createCharacter, pocketsOf, rollFor, sheetData, sheetRows, sheetText } from "./character.ts";
import { rulesFrom } from "./engine.ts";
import type { Build, RulesSession, SheetData, SrdFile } from "./types.ts";

/**
 * v2's rules code against the prototype's, on what tools/v2/record-v1-golden.mts recorded from it at
 * 44c6d4a (golden/README.md): the same builds make the same characters (sheet data, status and build
 * lines, modifiers, refresh's lists, the QA console's text), and the same dice roll the same checks,
 * though v2's engine is one per isolate, reseeded, and its campaigns are loaded once and kept.
 */

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as unknown;
const rules = rulesFrom(E, read("../../vendor/dnd-srd-engine/starter-pack.json"), read("../../vendor/srd-spells/spells.json") as SrdFile);
const PURSE = (read("../../campaigns/caerwyn/campaign.json") as { startingPurse: Array<{ name: string; quantity: number }> }).startingPurse;

interface Golden {
  case: string; name: string; concept: string; build: Build; seed: number; level: number;
  line: string; buildLine: string; modifiers: Record<string, number>; status: string; rules: Record<string, unknown>; sheet: SheetData; text: string;
}
const { sheets } = read("./golden/sheets.json") as { sheets: Golden[] };
type Rolled = RollResult & { seed: number };
const checks = read("./golden/checks.json") as { case: string; skills: Skill[]; dcs: number[]; fresh: Rolled[]; chained: Rolled[] };

/** A game's session before anything has happened, as the prototype's recorder made it. */
const fresh = (name: string, concept: string, seed: number): RulesSession => ({ id: "golden", seed, rollCount: 0, player: { name, concept, modifiers: {} } });

/** The engine's ids (random each time) as #1, #2… in the order they first appear, as the recorder masked them. */
function masked<T>(value: T): T {
  const ids = new Map<string, string>();
  const walk = (x: unknown): unknown => typeof x === "string" ? (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(x) ? (ids.get(x) ?? ids.set(x, `#${ids.size + 1}`).get(x)) : x)
    : Array.isArray(x) ? x.map(walk)
    : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
    : x;
  return walk(value) as T;
}

test("eight characters: the sheet, lines, modifiers and refresh's lists are the prototype's", () => {
  assert.equal(sheets.length, 8);
  for (const g of sheets) {
    const session = fresh(g.name, g.concept, g.seed);
    const line = createCharacter(rules, session, g.level, g.build);
    const { campaign: _campaign, npcs: _npcs, ...kept } = session.rules!;
    assert.equal(line, g.line, g.case);
    assert.equal(session.player.build, g.buildLine, g.case);
    assert.deepEqual(session.player.modifiers, g.modifiers, g.case);
    assert.equal(sheetRows(rules, session).statusLine, g.status, g.case);
    assert.deepEqual(masked(kept), g.rules, `${g.case}: refresh's lists`);
    // Before the story begins: the sheet's data with the campaign's starting purse laid over, as the row's pockets will be.
    assert.deepEqual({ ...sheetData(rules, session), ...pocketsOf(session, PURSE) }, g.sheet, `${g.case}: the sheet's data`);
  }
});

test("the QA console's sheet, from the data: the prototype's lines, but for the feats (the sheet's, the background's among them) and Thieves' Cant", () => {
  for (const g of sheets) {
    const proto = g.text.split("\n");
    const conditions = proto.findIndex(l => l.startsWith("Conditions: "));
    // The prototype printed only the feats taken since level 1 (none, for these); the sheet lists every one.
    const expected = [...proto.slice(0, conditions), ...(g.sheet.feats.length ? [`Feats: ${g.sheet.feats.join(", ")}`] : []), ...proto.slice(conditions)]
      .map(l => (l.startsWith("Languages: ") ? l.replace("Thieves-cant", "Thieves' Cant") : l));
    assert.ok(!proto.some(l => l.startsWith("Feats: ")), `${g.case}: the prototype's had no feats taken`);
    assert.deepEqual(sheetText(g.sheet).split("\n"), expected, g.case);
  }
});

test("checks on the ready-made rogue roll as the prototype's: 900 on the character as made (one campaign, cached), and nine in a row on each of three seeds", () => {
  const g = sheets.find(s => s.case === checks.case)!;
  const base = fresh(g.name, g.concept, 1);
  createCharacter(rules, base, g.level, g.build);
  const combos = checks.skills.flatMap(skill => checks.dcs.map(dc => ({ skill, dc })));
  // Each the next of the seed's dice, on the campaign as made: the prototype made an engine and loaded the campaign for each.
  const once: Rolled[] = [];
  for (let seed = 1; seed <= 100; seed++) {
    for (const [k, { skill, dc }] of combos.entries()) once.push({ seed, ...rollFor(rules, { ...base, seed, rollCount: k, rules: { ...base.rules! } }, skill, dc) });
  }
  assert.deepEqual(once, checks.fresh);
  assert.equal(new Set(once.map(r => r.die)).size, 20, "every face of the die");
  assert.ok(once.some(r => r.critical === "success") && once.some(r => r.critical === "failure"));
  // In a row: each on the campaign the one before committed.
  const chained: Rolled[] = [];
  for (let seed = 1; seed <= 3; seed++) {
    const session = { ...base, seed, rollCount: 0, rules: { ...base.rules! } };
    for (const { skill, dc } of combos) chained.push({ seed, ...rollFor(rules, session, skill, dc) });
    assert.equal(session.rollCount, 9);
  }
  assert.deepEqual(chained, checks.chained);
});
