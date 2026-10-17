import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Build, SheetData } from "../../../shared/rules/types.ts";
import { hostWithCampaign, identity, optionOf } from "../host/testing.ts";
import { masked } from "../../../shared/rules/golden/masked.ts";

/**
 * makeCharacter on the memory host (v1-design §3.5, §4.1): the game made from a creation takes its
 * uid, and the sheet the engine makes for the chosen build is the prototype's, as R's goldens
 * recorded it (shared/rules/golden/sheets.json: builds.json's five and the three Tamsin Vell is
 * offered, before the story begins, the engine's ids masked).
 */

interface Golden { case: string; name: string; concept: string; build: Build; buildLine: string; status: string; sheet: SheetData }
const { sheets } = JSON.parse(readFileSync(new URL("../../../shared/rules/golden/sheets.json", import.meta.url), "utf8")) as { sheets: Golden[] };

test("each of the prototype's eight characters, made through creation, has its sheet: the data and pockets, the status and build lines", async () => {
  assert.equal(sheets.length, 8);
  const { host, script } = hostWithCampaign();

  for (const [i, g] of sheets.entries()) {
    const who = identity(100 + i);
    script.then("offer", { offer: { options: [{ ...optionOf("rogue"), build: g.build, line: g.buildLine }] }, usage: { calls: 1, costUsd: 0, byOperation: {} } });
    host.as(who).startCreation({ campaign: "caerwyn", name: g.name, concept: g.concept, how: "three" });
    await host.drain();
    host.as(who).chooseBuild({ index: 0 });
    assert.equal(host.as(who).skipBackstory(), undefined, g.case);

    const creation = host.view(who).myCreation()!;
    const game = host.db.game.id.find(creation.gameId!)!;
    const sheet = host.db.sheet.playerId.find(game.hostId)!;
    assert.equal(game.uid, creation.uid, `${g.case}: the game takes the creation's uid`);
    assert.deepEqual([sheet.build, sheet.statusLine], [g.buildLine, g.status], g.case);
    assert.deepEqual(masked({ ...JSON.parse(sheet.data), ...JSON.parse(sheet.pockets) }), g.sheet, `${g.case}: the sheet's data, the pockets laid over`);
  }
});

