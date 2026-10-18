import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fakeFetch, type FakeOptions, type Request } from "../../llm/fake-openrouter.ts";
import { initialGm, type GmState } from "../../../shared/gm/state.ts";
import type { Entry, ReactionsRequest, SheetRow } from "../../../shared/protocol/ai.ts";
import type { Act } from "../../../shared/rules/types.ts";
import type { PlaceFile } from "../../../shared/scene/files.ts";
import { loadPlace, placePath } from "../../../shared/scene/scenario.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import { keysFor, worldToRows, type PlaceRows } from "../../../shared/world/rows.ts";
import { buildWorld, joinWorld } from "../../../shared/world/scene-world.ts";
import { callContext } from "../calls.ts";
import { campaigns } from "../campaigns.ts";
import { mechanicOf } from "../../gm/director.ts";
import { withTestClerk } from "../../gm/fixtures.ts";
import { rulesOptions } from "../../gm/mechanics.ts";
import { turnSource } from "../../gm/view.ts";
import type { AiContext } from "../context.ts";
import { folderStores } from "../folder-stores.ts";
import { streamSink } from "../stream.ts";
import { pipeline } from "./pipeline.ts";
import { director, sceneAndView } from "./turn.ts";

/**
 * A turn's thinks with the world bridge (world-bridge-design §3.1, package C), on the stand-in for
 * OpenRouter, for a wizard with her spells, weapons and features on her sheet, both parked for combat
 * (nothing in a scene's play asks them since the old pipeline's decide went): what the rules resolve
 * of her line (which spell at what, the world in the details call), and the reactions of everyone who
 * saw the violence (and none when nobody did). (A route's roll held behind the act, and a roll wanted
 * that the act settles, went with decide's one decision; the threat a reply left hanging, read in the
 * old pipeline's settle, is director.test.ts's now, and the old reply's directives went with it.)
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
    const place: PlaceFile = loadPlace(readFileSync(join(CAERWYN, placePath("granary-yard")), "utf8"));
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

/**
 * What the rules resolve of the player's line on the yard's first turn, as the old pipeline's decide
 * asked it of the director (mechanicOf, parked for combat: nothing in play asks it since that decide
 * went), with what rulesOptions offers from the sheet and the world; nothing asked for a sheet with no build.
 */
async function ruled(options: FakeOptions, line: string, party: SheetRow[] = [WIZARD]) {
  const { fake, contextFor, rows } = await setUp(options);
  const gm = initialGm({ start: "yard" });
  const ctx = contextFor(`${GAME}:s1:t1:reply`);
  const { scene, view } = sceneAndView(ctx, "hanged-clerk", turnSource({ game, turn: turnOf(1, gm, rows(gm), [opening, said(1, line)], party) }));
  const rules = rulesOptions(scene, view, line);
  const { mechanic } = rules ? await mechanicOf(director(ctx.calls), scene, view, line, rules) : {};
  return { mechanic, sent: fake.sent };
}

test("parked for combat: the rules' act on a scripted cast, at what the player aimed it, its details asked in a second small call with the world", async () => {
  const { mechanic, sent } = await ruled({ choices: { mechanic: "cast", spell: "magic-missile", aim_thing: "hoist-rope" } }, MISSILE);

  assert.deepEqual(mechanic, { kind: "cast", spell: "magic-missile", targets: ["hoist-rope"] });
  const [question, details] = sent;
  assert.deepEqual(Object.keys(question!.questions!), ["mechanic"], "what the rules resolve, in a call of its own");
  assert.deepEqual(Object.keys(details!.questions!.spell!.criteria), ["fire-bolt", "magic-missile", "burning-hands", "scorching-ray", "not_theirs"], "her spells, from the sheet");
  assert.equal(details!.questions!.spell!.criteria["magic-missile"], "Magic Missile (1st-level)");
  assert.equal(Object.keys(details!.questions!.aim_thing!.criteria)[0], "hoist-rope", "what the line names first, of what's near enough to aim at");
  assert.deepEqual(Object.keys(details!.questions!).filter(k => k.startsWith("aim_")), ["aim_kell", "aim_cob", "aim_moll", "aim_self", "aim_thing"]);
  assert.match(JSON.stringify((details as Request & { state?: { world?: string } }).state?.world), /hoist rope/, "where they act from means something: the world is in the call");

  // A quiet turn asks nothing more; a sheet with no build isn't asked what the rules resolve at all.
  const quiet = await ruled({}, "Sergeant, who found him?");
  assert.equal(quiet.mechanic, undefined);
  assert.equal(quiet.sent.length, 1, "the question, and no details call");
  const { build: _, ...plain } = WIZARD;
  const none = await ruled({ choices: { mechanic: "cast" } }, MISSILE, [plain]);
  assert.deepEqual([none.sent.length, none.mechanic], [0, undefined]);
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
