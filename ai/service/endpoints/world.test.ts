import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fakeFetch, type FakeOptions, type Request } from "../../llm/fake-openrouter.ts";
import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { DecideRequest, Entry, ReactionsRequest, SheetRow } from "../../../shared/protocol/ai.ts";
import type { Act } from "../../../shared/rules/types.ts";
import type { PlaceFile } from "../../../shared/scene/files.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { keysFor, worldToRows, type PlaceRows } from "../../../shared/world/rows.ts";
import { buildWorld, joinWorld } from "../../../shared/world/scene-world.ts";
import { callContext } from "../calls.ts";
import { campaigns } from "../campaigns.ts";
import { withTestClerk } from "../../gm/fixtures.ts";
import type { AiContext } from "../context.ts";
import { folderStores } from "../folder-stores.ts";
import { streamSink } from "../stream.ts";
import { pipeline } from "./pipeline.ts";

/**
 * A turn's thinks with the world bridge (world-bridge-design §3.1, package C), on the stand-in for
 * OpenRouter, for a wizard with her spells, weapons and features on her sheet: the decision's act
 * for the rules (which spell at what, a route's roll held behind it and let go on also, a roll wanted
 * that the act settles, or that it's only the means to), and the reactions of everyone who saw the
 * violence (and none when nobody did). (The threat a reply left hanging, read in the old pipeline's
 * settle, is director.test.ts's now, parked for combat; the old reply's directives went with it.)
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "..", "campaigns", "caerwyn");
const GAME = "0d1e2f3a-0000-4000-8000-0000000000c7";
const MISSILE = "(I cast Magic Missile at the hoist rope)";

const SCRATCH = mkdtempSync(join(tmpdir(), "km-world-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

/** The campaign installed in a fresh store, and a request's context on the stand-in, its calls kept. */
async function setUp(options: FakeOptions = {}) {
  const stores = folderStores(mkdtempSync(join(SCRATCH, "store-")));
  const installed = campaigns(stores.campaigns, stores.docs);
  await installed.put("caerwyn", "0.1.0", withTestClerk(filesOf(CAERWYN)));
  const campaign = installed.use("caerwyn", "0.1.0");
  const fake = fakeFetch(options);
  const contextFor = (key: string): AiContext => {
    const { calls, usage } = callContext({ fetch: fake.fetch, apiKey: "test" }, stores, { game: GAME, key, attempt: 1 });
    const stream = (turn: string) => streamSink({ url: "http://stdb.test", db: "kingmaker", token: "t", periodMs: 0, fetch: async () => new Response(""), log: () => {} }, { turn, attempt: 1, started: performance.now() });
    return { campaign, calls, usage, attempt: 1, stream };
  };
  const rows = (gm: GmState) => {
    const place = JSON.parse(readFileSync(join(CAERWYN, "places", "granary-yard.json"), "utf8")) as PlaceFile;
    const people = presentCast(campaign.scene("hanged-clerk"), gm).map(c => ({ id: c.id, name: c.name }));
    const world = buildWorld("hanged-clerk", place, people, { name: "Wren Ashdown" });
    joinWorld(world, people, 0);
    return worldToRows(world, keysFor("granary-yard", "hanged-clerk", "pc:1"));
  };
  return { fake, contextFor, rows };
}

/** The ready-made wizard as her sheet row has her: what the rules keep ready, by the engine's ids. */
const WIZARD: SheetRow = {
  name: "Wren Ashdown", concept: "an absent-minded hedge-wizard of the Invisible College", build: "human wizard 3 (Evoker), sage background",
  skills: { arcana: 5, history: 5, insight: 3, investigation: 5, persuasion: 1 }, status: "HP 20/20, spell slots 1st 4/4, 2nd 2/2",
  spells: [{ id: "fire-bolt", name: "Fire Bolt", level: 0 }, { id: "magic-missile", name: "Magic Missile", level: 1 }, { id: "burning-hands", name: "Burning Hands", level: 1 }, { id: "scorching-ray", name: "Scorching Ray", level: 2 }],
  weapons: [{ id: "quarterstaff", name: "Quarterstaff" }, { id: "dagger", name: "Dagger" }],
  features: [],
};
const game = { id: GAME, campaign: "caerwyn", version: "0.1.0" };
const player = { id: "1", name: "Wren Ashdown" };
const opening: Entry = { turn: 0, speaker: "gm", kind: "narration", text: "Rain on the cobbles. A body hangs from the hoist, and a boy in boots too big for him throws stones at it." };
const said = (n: number, text: string): Entry => ({ turn: n, speaker: "player:1", kind: "player", text });

function turnOf(n: number, gm: GmState, rows: PlaceRows, transcript: Entry[], party: SheetRow[] = [WIZARD]) {
  const line = transcript.findLast(e => e.kind === "player")!.text;
  return { scene: { id: "1", key: "hanged-clerk", kind: "scene" as const, turn: n }, pc: "pc:1", gm, transcript, line: { speaker: "player:1", text: line }, world: rows, party, present: [], story: { time: "morning", day: 1, flags: {} } };
}

/** A decide on the yard's first turn, the player's line as given. */
async function decided(options: FakeOptions, line: string, party: SheetRow[] = [WIZARD]) {
  const { fake, contextFor, rows } = await setUp(options);
  const gm = initialGm({ start: "yard" });
  const req: DecideRequest = { key: `${GAME}:s1:t1:decide`, game, player, turn: turnOf(1, gm, rows(gm), [opening, said(1, line)], party), landed: [] };
  const { decision } = await pipeline.decide(req, contextFor(req.key));
  return { decision, sent: fake.sent };
}

test("decide: the rules' act on a scripted cast, at what the player aimed it, its details asked in a second small call with the world", async () => {
  const { decision, sent } = await decided({ choices: { mechanic: "cast", spell: "magic-missile", aim_thing: "hoist-rope" } }, MISSILE);

  assert.deepEqual(decision.mechanic, { kind: "cast", spell: "magic-missile", targets: ["hoist-rope"] });
  assert.equal(decision.route, undefined);
  assert.equal("details" in decision, false, "what the details call needed isn't part of the answer");
  // (Disclosure asks the Decisions API too: the director's calls are found by their questions.)
  const before = sent.find(b => b.questions?.earned), details = sent.find(b => b.questions?.spell);
  assert.ok(before!.questions!.mechanic, "the turn's one decision asks what the rules resolve");
  assert.deepEqual(Object.keys(details!.questions!.spell!.criteria), ["fire-bolt", "magic-missile", "burning-hands", "scorching-ray", "not_theirs"], "her spells, from the sheet");
  assert.equal(details!.questions!.spell!.criteria["magic-missile"], "Magic Missile (1st-level)");
  assert.equal(Object.keys(details!.questions!.aim_thing!.criteria)[0], "hoist-rope", "what the line names first, of what's near enough to aim at");
  assert.deepEqual(Object.keys(details!.questions!).filter(k => k.startsWith("aim_")), ["aim_kell", "aim_cob", "aim_moll", "aim_self", "aim_thing"]);
  assert.match(JSON.stringify((details as Request & { state?: { world?: string } }).state?.world), /hoist rope/, "where they act from means something: the world is in the call");

  // A quiet turn asks nothing more; a sheet with no build isn't asked what the rules resolve at all.
  const quiet = await decided({}, "Sergeant, who found him?");
  assert.equal(quiet.decision.mechanic, undefined);
  assert.equal(quiet.sent.filter(b => b.questions?.earned || b.questions?.spell || b.questions?.target).length, 1, "the turn's one decision, and no details call");
  const { build: _, ...plain } = WIZARD;
  const none = await decided({ choices: { mechanic: "cast" } }, MISSILE, [plain]);
  assert.equal(none.sent.find(b => b.questions?.earned)!.questions!.mechanic, undefined);
  assert.equal(none.decision.mechanic, undefined);
});

test("decide: a route's roll is held behind the rules' act, and let go on also; a roll wanted is the act's to settle, unless it's only the means", async () => {
  const throwAt = "(I hurl my dagger at the rope above the corpse, then get right up to Prout to examine his neck)";
  const blow = { attempt: "examine-body", mechanic: "attack", target: "hoist-rope", weapon: "dagger" };
  const held = await decided({ choices: blow }, throwAt);
  assert.deepEqual(held.decision.mechanic, { kind: "attack", target: "hoist-rope", weapon: "dagger" });
  assert.equal(held.decision.route, undefined, "no Medicine roll while the rules resolve the throw");
  const asked = held.sent.find(b => b.questions?.target)!;
  // (The tests' hanged clerk has its routes in the scene format, whose checks give no reason: the question names the act by the route's condition.)
  assert.match((asked.questions!.also as { instructions?: string }).instructions ?? "", /this Medicine check is for \(The player examines Prout's neck, head or hands up close/);

  const released = await decided({ choices: { ...blow, also: "yes" } }, throwAt);
  assert.deepEqual(released.decision.route, { id: "examine-body", phase: "attempt", check: { skill: "medicine", dc: 12 } });
  assert.equal(released.decision.mechanic?.kind, "attack");

  // A roll wanted, and the rules' act: the act settles it (the means question rides the details call, and says no).
  const cast = { roll_call: "new", mechanic: "cast", spell: "magic-missile", aim_thing: "hoist-rope" };
  const settled = await decided({ choices: cast }, MISSILE);
  assert.equal(settled.decision.considered, undefined);
  assert.equal(settled.decision.mechanic?.kind, "cast");
  assert.ok(settled.sent.find(b => b.questions?.spell)!.questions!.means_only);
  assert.equal(settled.sent.find(b => b.questions?.earned)!.questions!.means_only, undefined);
  // Only the means to something risky the rules don't settle: the GM rules on that too, after the rules.
  const means = await decided({ choices: { ...cast, means_only: "yes" } }, "(I cast Magic Missile at the hoist rope and dive to catch the body as it falls)");
  assert.ok(means.decision.considered && means.decision.considered.probability >= 0.7);
  assert.equal(means.decision.mechanic?.kind, "cast");
  // No act: the roll wanted is the GM's, as before.
  assert.ok((await decided({ choices: { roll_call: "new" } }, "*crouches by Cob* Take the left boot off yourself.")).decision.considered);
});

const AT_COB: Act = { what: "cast Magic Missile at the boy in the too-big boots", victims: ["cob"], property: [] };

function reactionsRequest(gm: GmState, rows: PlaceRows, act: Act = AT_COB): ReactionsRequest {
  const lines: Entry[] = [{ turn: 1, speaker: "dice", kind: "roll", text: "Cast Magic Missile (1st-level slot) on the boy in the too-big boots" }];
  return { key: `${GAME}:s1:t1:reactions`, game, player, turn: turnOf(1, gm, rows, [opening, said(1, "(I cast Magic Missile at the boy)"), ...lines]), act };
}

test("reactions: everyone who saw it reacts, the hurt first, by the names the player knows; the GM is told what was decided", async () => {
  const { fake, contextFor, rows } = await setUp({ choices: { react_kell: "intervene", react_cob: "flee", react_moll: "cower" } });
  const gm = initialGm({ start: "yard" });
  const answer = await pipeline.reactions(reactionsRequest(gm, rows(gm)), contextFor(`${GAME}:s1:t1:reactions`));

  assert.deepEqual(answer.reactions, { cob: "flee", kell: "intervene", moll: "cower" });
  assert.equal(answer.directive, "Rules: that was violence, and everyone here reacts at once, each in their own way (decided: play it so): the boy in the too-big boots flees: gets out of the place; Sergeant Agnes Kell steps in to stop it, without fighting; the girl in the shawl cowers where they are. Show each reaction briefly, in the same reply as the act itself, and keep everyone to their reaction.");
  const asked = fake.sent.find(b => b.questions) as Request & { state?: Record<string, unknown> };
  assert.deepEqual(Object.keys(asked.questions!), ["react_cob", "react_kell", "react_moll"], "the hurt first");
  assert.deepEqual([asked.state?.what_the_player_did, asked.state?.hurt_or_caught], [AT_COB.what, ["the boy in the too-big boots"]]);
  assert.equal(answer.usage.byOperation["director.reactions"]?.calls, 1);

  // Anyone fighting: the GM ends on the fight breaking out.
  const fight = await setUp({ choices: { react_kell: "fight", react_cob: "flee", react_moll: "cower" } });
  const brawl = await pipeline.reactions(reactionsRequest(gm, fight.rows(gm)), fight.contextFor(`${GAME}:s1:t1:reactions`));
  assert.equal(brawl.reactions.kell, "fight");
  assert.match(brawl.directive ?? "", /Sergeant Agnes Kell fights: goes for the player;.* It's a fight now: end on the moment it breaks out, before anyone's blow lands\.$/);
});

test("reactions: nobody to see it, no reactions and no model call", async () => {
  const { fake, contextFor, rows } = await setUp();
  const gm: GmState = { ...initialGm({ start: "yard" }), absent: ["kell", "cob", "moll"] };
  const answer = await pipeline.reactions(reactionsRequest(gm, rows(gm), { what: "set the yard gate alight", victims: [], property: ["gate"] }), contextFor(`${GAME}:s1:t1:reactions`));
  assert.deepEqual(answer.reactions, {});
  assert.equal(answer.directive, undefined);
  assert.deepEqual(fake.asked, []);
});
