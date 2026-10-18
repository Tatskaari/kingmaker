// Copied from the prototype's src/runtime/boundary.test.ts at 44c6d4a, whole: the lore is the campaign's (campaigns/caerwyn/lore), the scenes the test story's (fixtures.ts), and a session is a TurnView.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { errandsOf, readDoc, writeDoc } from "../docs/docs.ts";
import { strangers } from "./brief.ts";
import { CAERWYN, sceneById, stateIn } from "./fixtures.ts";
import type { TurnView, ViewEntry } from "./view.ts";

/**
 * What the scene boundary's verdict is given besides play, without model calls: what the people the
 * story goes on with do between scenes (their lore's "What they do next"), and whose names the
 * player hasn't heard, so the lead and the opening tell the way on from what's true and known.
 */

const overlays = mkdtempSync(join(tmpdir(), "km-boundary-"));
after(() => rmSync(overlays, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(overlays, game) });

const heard = (...texts: string[]): TurnView => stateIn("hanged-clerk", {
  transcript: texts.map((text, i): ViewEntry => ({ turn: i, scene: "hanged-clerk", speaker: "gm", kind: "narration", text })),
});

test("someone's errands are the 'What they do next' of their gm.md, as this game's copy has it", () => {
  const kell = errandsOf("s-errands", "kell");
  assert.ok(kell, "Kell's lore says what she does next");
  assert.match(kell, /\*\*The afternoon\*\*: .*Purveyor's flour wagons.*follows the big man/);
  assert.doesNotMatch(kell, /^## /m, "the section, not its heading or the next section");
  assert.doesNotMatch(kell, /Her lines/);
  assert.match(errandsOf("s-errands", "cob")!, /\*\*Otherwise\*\*/);
  assert.equal(errandsOf("s-errands", "tull"), undefined, "Tull's lore has no such section");
  assert.equal(errandsOf("s-errands", "nobody"), undefined, "no lore, no errands");
  // Play can change them: the game's copy is what's read.
  const path = "Cast/Sergeant Agnes Kell/gm.md";
  const doc = readDoc("s-changed", path)!;
  writeDoc("s-changed", { ...doc, body: doc.body.replace(/- \*\*The afternoon\*\*: [^\n]*/, "- **The afternoon**: she sits with Prout in the cold room.") });
  assert.match(errandsOf("s-changed", "kell")!, /sits with Prout in the cold room/);
  assert.match(errandsOf("s-errands", "kell")!, /Purveyor's flour wagons/, "another game's copy is untouched");
});

test("strangers: the people across a boundary whose names the player hasn't heard, by what they'd call them", () => {
  const scenes = ["hanged-clerk", "drowned-rat", "heron-warehouse"].map(sceneById);
  const hook = sceneById("hanged-clerk").hook;
  const none = strangers(scenes, heard("A boy lobs stones at the hanged clerk."), [hook]);
  const names = none.map(s => s.name);
  assert.ok(names.includes("Big Hobb Mallory") && names.includes("Cob") && names.includes("Moll") && names.includes("Master Josiah Sallow"));
  assert.ok(!names.includes("Sergeant Agnes Kell"), "people with no 'called' count as known");
  // As the first scene to card them has it: the granary's boy, not yet the Rat's pot-boy.
  assert.equal(none.find(s => s.name === "Cob")!.called, "the boy in the too-big boots");
  assert.equal(none.find(s => s.name === "Big Hobb Mallory")!.called, "the big man with the bandaged hand");
  // A name heard anywhere in play (or a hook the player was shown) is known: any part of it but a title.
  const some = strangers(scenes, heard("“Shut it, Cob.”", "Tull reads his order: 'at the request of Master J. Sallow'."), [hook]).map(s => s.name);
  assert.ok(!some.includes("Cob") && !some.includes("Master Josiah Sallow"));
  assert.ok(some.includes("Big Hobb Mallory") && some.includes("Moll"));
  assert.ok(!strangers(scenes, heard("Nobody here."), [hook, "Everybody on the stairs knows Big Hobb."]).some(s => s.name === "Big Hobb Mallory"));
  assert.ok(strangers(scenes, heard("A big man, very big."), [hook]).some(s => s.name === "Big Hobb Mallory"), "'Big' is a title, not his name");
});
