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

const SCENE = "scenes/hanged-clerk.kmscene", PLACE = "places/granary-yard.json";
const RAT = "scenes/drowned-rat.kmscene", HERON = "scenes/heron-warehouse.kmscene";
/** A node's data, or a route's, by its id, to edit in place. */
const node = (scene: any, id: string) => scene.nodes.find((n: any) => n.id === id).data;
const route = (scene: any, id: string) => scene.edges.find((e: any) => e.id === id);
/** The campaign's problems but the vocabulary's (vocabulary.test.ts has those). */
const sceneChecks = (f: CampaignFiles) => checkCampaign(f).filter(p => !p.startsWith("vocabulary.json"));

test("caerwyn is fit to install: its pack every scene's file, its files every file but none hidden", () => {
  const pack = packOf(files);

  assert.deepEqual(checkCampaign(files), []);
  assert.deepEqual(pack.scenes.map(s => s.id), ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning", "talk"], "the story's, then the talk template's");
  assert.equal(pack.campaign.talk, "talk");
  assert.match(pack.scenes[0]!.hook, /^This morning a palace clerk, Wendell Prout/);
  assert.deepEqual(pack.scenes[0], JSON.parse(files[SCENE]!), "a scene's file as it is");
  assert.deepEqual(pack.places.map(p => p.key), ["granary-yard", "drowned-rat", "heron", "dressing-room"]);
  assert.deepEqual(pack.campaign.quests, { "hanged-clerk": "The Hanged Clerk", "purveyors-man": "The Purveyor's Man", "heron-ledger": "The Heron Ledger" });
  assert.deepEqual(pack.maps.map(m => m.id), ["caerwyn", "drowned-rat", "heron", "palace"]);
  assert.deepEqual([pack.campaign.start.map, pack.campaign.start.at], ["caerwyn", [42, 9]]);
  assert.deepEqual(Object.keys(pack.builds), ["cleric", "fighter", "ranger", "rogue", "wizard"]);
  assert.equal(pack.looks.kell?.fg, "#6d9eeb");
  assert.equal(Object.keys(files).filter(p => p.startsWith("lore/")).length, 154);
  assert.deepEqual(Object.keys(files).filter(p => p.startsWith("scenes/")), pack.scenes.map(s => `scenes/${s.id}.kmscene`).sort(), "a file a scene, nothing else");
  assert.ok(!Object.keys(files).some(p => p.split("/").some(part => part.startsWith("."))));
});

test("the pack goes to install_campaign and back unchanged", () => {
  const pack = packOf(files);

  assert.deepEqual(packOfArgs(installArgsOf(pack)), pack);
  assert.equal(installArgsOf(pack).id, "caerwyn@0.1.0");
});

test("a scene file that isn't of the format says what's wrong with its shape, and is held to nothing more", () => {
  assert.deepEqual(checkCampaign(changed(SCENE, s => { delete s.truth; s.edges[0].target = "the-moon"; })), [
    "scenes/hanged-clerk.kmscene: it has no truth",
    'scenes/hanged-clerk.kmscene: edges[0] (find-murder)\'s target "the-moon" isn\'t a node of the scene',
  ]);
  assert.deepEqual(checkCampaign(changed(SCENE, "{ nope")), ["scenes/hanged-clerk.kmscene isn't JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3)"]);
  assert.deepEqual(checkCampaign(changed(SCENE, undefined)), ["scenes/hanged-clerk.kmscene is missing"]);
});

test("ids are slugs, the scene's its file's name; the prose it needs is there, and its lore is in lore/", () => {
  const ids = changed(SCENE, s => { s.id = "Hanged_Clerk"; s.nodes[1].id = "The Murder"; s.edges[0].target = "The Murder"; s.edges[0].id = "find murder"; route(s, "signed-murder").data.requires = ["The Murder", "hobb"]; });
  const prose = changed(SCENE, s => { s.premise = " "; s.cast[0].whyHere = ""; node(s, "murder").title = ""; node(s, "failed").closing = ""; });
  const lore = changed(SCENE, s => { s.lore.push("Places/Atlantis.md"); s.cast[1].lore = "Cast/Nobody/public.md"; node(s, "hobb").lore = ["Cast/Big Hobb Mallory/nope.md"]; });

  assert.deepEqual(sceneChecks(ids), [
    "scenes/hanged-clerk.kmscene: its id Hanged_Clerk isn't its file's name",
    'scenes/hanged-clerk.kmscene: the scene id "Hanged_Clerk" isn\'t a slug ([a-z0-9][a-z0-9-]*)',
    'scenes/hanged-clerk.kmscene: the node id "The Murder" isn\'t a slug ([a-z0-9][a-z0-9-]*)',
    'scenes/hanged-clerk.kmscene: the route id "find murder" isn\'t a slug ([a-z0-9][a-z0-9-]*)',
  ]);
  assert.deepEqual(sceneChecks(prose), [
    "scenes/hanged-clerk.kmscene: it has no premise", "scenes/hanged-clerk.kmscene: kell has no whyHere",
    "scenes/hanged-clerk.kmscene: murder has no title", "scenes/hanged-clerk.kmscene: ending failed has no closing",
  ]);
  assert.deepEqual(sceneChecks(lore), [
    "scenes/hanged-clerk.kmscene: lore Places/Atlantis.md isn't in lore/", "scenes/hanged-clerk.kmscene: lore Cast/Nobody/public.md isn't in lore/",
    "scenes/hanged-clerk.kmscene: lore Cast/Big Hobb Mallory/nope.md isn't in lore/",
  ]);
  assert.deepEqual(sceneChecks(changed("scenes/caerwyn-afternoon.kmscene", s => { s.truth = ""; s.premise = ""; })), [], "an interlude needs no truth or premise");
});

test("the routes: none leaves an ending, what one requires is a beat, and only a way into a discovery goes without a condition", () => {
  const routes = changed(SCENE, s => {
    s.edges.push({ ...s.edges[6], id: "after-all", source: "failed", target: "murder-unknown", data: { ...s.edges[6].data, requires: ["hobb"] } });
    route(s, "signed-suicide").data.requires = ["hobb", "failed"];
    route(s, "cart-comes").data.condition = "";
  });

  assert.deepEqual(sceneChecks(routes), [
    "scenes/hanged-clerk.kmscene: route cart-comes has no condition, and only a route into a discovery may go without",
    "scenes/hanged-clerk.kmscene: route signed-suicide requires failed, which isn't a beat",
    "scenes/hanged-clerk.kmscene: route after-all leaves an ending (failed)",
  ]);
});

test("a cue's outer limit counts from and until beats; every cue of the campaign has one", () => {
  const limits = changed(SCENE, s => { route(s, "cart-comes").data.limit = [{ exchanges: 12, after: "murder-unknown" }, { exchanges: 6, until: ["start"] }]; });
  assert.deepEqual(sceneChecks(limits), [
    "scenes/hanged-clerk.kmscene: route cart-comes's outer limit counts from or until murder-unknown, which isn't a beat",
    "scenes/hanged-clerk.kmscene: route cart-comes's outer limit counts from or until start, which isn't a beat",
  ]);
  const cues = Object.entries(files).filter(([path]) => path.endsWith(".kmscene")).flatMap(([path, text]) => (JSON.parse(text!).edges as any[]).filter(e => e.data.phase === "cue").map(e => [path, e.id, e.data.limit?.length ?? 0]));
  assert.ok(cues.length >= 8, `the campaign's cues: ${cues.length}`);
  assert.deepEqual(cues.filter(([, , counts]) => !counts), [], "every cue says when it comes whatever is happening, in exchanges");
});

/** Each scene file of the campaign, parsed. */
const sceneFiles = () => Object.entries(files).filter(([path]) => path.endsWith(".kmscene")).map(([path, text]) => [path, JSON.parse(text!)] as const);

test("a cue into an ending gives way to what the player has under way, and names the routes it would cut short (QA round qa2-1018's H5: the Heron's second bell closed on the barge sailing mid-arrest)", () => {
  const intoEndings = sceneFiles().flatMap(([path, s]) => (s.edges as any[]).filter(e => e.data.phase === "cue" && node(s, e.target).kind === "exit").map(e => ({ path, s, e })));
  assert.deepEqual(intoEndings.map(({ path, e }) => `${path} ${e.id}`), ["scenes/heron-warehouse.kmscene cast-off"], "the campaign's one cue into an ending");
  for (const { s, e } of intoEndings) {
    const good = (s.edges as any[]).filter(r => node(s, r.target).kind === "exit" && node(s, r.target).result === "good").map(r => r.id);
    assert.match(e.data.condition, /Not needed once /);
    assert.ok(good.some(id => e.data.condition.includes(`[${id}]`)), `${e.id} names the good endings' routes it gives way to`);
    assert.doesNotMatch(e.data.condition, /whatever is happening/);
  }
  const heron = JSON.parse(files[HERON]!);
  assert.match(route(heron, "cast-off").data.condition, /Not needed once the player has stopped the loading \([^)]*\), has put the case to the Master's face in front of Kell \(the arrest coming, or said\), is fighting him and the Crakes, or has the true book in hand: then the bell can ring and the barge go in the background, but what's under way plays on to its own end/);
  assert.match(node(heron, "barge-sails").description, /the loading never stopped and the Master never taken: if he came, he saw her off and went home free with his share/, "what's true there can't be true mid-arrest");
  assert.match(node(heron, "barge-sails").closing, /^Close where the player is:/, "and it closes where they stand");
});

test("a route into a bad or mixed ending that could be true at the same moment as a good one's gives way to it, by name (QA round qa2-1018)", () => {
  const KING = "scenes/kings-morning.kmscene";
  // Each route into a bad or mixed ending, and the good routes whose moment, come first, it gives way to.
  const giveWay: Record<string, Record<string, string[]>> = {
    [SCENE]: { "signed-suicide": ["signed-murder"], "case-lost": ["signed-murder"] },
    [RAT]: { "after-him": ["let-him-go"], "wait-for-him": ["let-him-go"], manners: ["let-him-go", "their-man-inside"] },
    [HERON]: { "cast-off": ["in-the-act", "away-with-book"], "give-up": ["away-with-book"], overpowered: ["in-the-act"], attack: ["in-the-act"], ablaze: ["away-with-book", "in-the-act"], sunk: ["away-with-book", "in-the-act"] },
    [KING]: { "put-off": ["king-acts"], "thrown-away": ["king-acts"] },
  };
  // And those that can't be true with a good one at once: Hobb bolted to his master, the trail lost without the Heron, the Master's sword drawn.
  const apart: Record<string, string[]> = { [RAT]: ["got-away", "trail-goes-cold"], [HERON]: ["cornered"] };
  const result = (s: any, id: string) => node(s, route(s, id).target).result;
  for (const [path, s] of sceneFiles()) {
    const worse = (s.edges as any[]).filter(e => node(s, e.target).kind === "exit" && node(s, e.target).result !== "good").map(e => e.id);
    assert.deepEqual([...worse].sort(), [...Object.keys(giveWay[path] ?? {}), ...(apart[path] ?? [])].sort(), `${path}: every route into a bad or mixed ending is weighed`);
    for (const [id, good] of Object.entries(giveWay[path] ?? {})) {
      for (const g of good) {
        assert.equal(result(s, g), "good", `${path}: ${g} goes to a good ending`);
        assert.ok(route(s, id).data.condition.includes(`[${g}]`), `${path}: ${id} gives way to [${g}]`);
      }
    }
  }
});

test("every story scene's clock moves a step at a time and is felt before it strikes (QA round qa2-1018: the corporal's stock beat and the clock standing still)", () => {
  const clerk = JSON.parse(files[SCENE]!), rat = JSON.parse(files[RAT]!), king = JSON.parse(files["scenes/kings-morning.kmscene"]!);
  for (const [path, s] of sceneFiles()) if (s.clock && !s.interlude) assert.match(s.clock, /felt|fewer each time/, `${path}'s clock says how it moves`);
  assert.match(clerk.clock, /the morning is felt moving on, a step nearer noon every few exchanges and never the same sign twice/);
  assert.match(node(clerk, "cart-arrives").pressure, /^Tull's constables [^]*His patience runs down a step every exchange, never the same step twice/);
  assert.match(node(clerk, "cart-arrives").cast.tull, /^Helmet off to the dead[^]*each exchange he waits he does one more thing towards going/, "a newcomer's default role is the stage's note, and the e2e reads its start");
  assert.match(rat.clock, /it's felt coming, a step nearer every few exchanges and never the same sign twice/);
  assert.match(route(rat, "bell-rings").data.condition, /Before it rings, it's felt coming[^]*it rings then, whatever is happening\. Not needed once Hobb has fled\.$/);
  assert.match(king.clock, /about two fewer an exchange \(twenty-eight at the start, fifteen about eight exchanges in, five about twelve\): a number he has called is never called again/);
  assert.deepEqual([route(king, "send-for-sallow").data.limit[0].exchanges, route(king, "time-presses").data.limit[0].exchanges], [8, 12], "fifteen minutes and five, as the cues count them");
});

test("the Rat says once, plainly, how Arlo's challenges count and what the third refusal costs (QA round qa2-1018's g04: his third challenge made early, two refusals said after it, then staged again)", () => {
  const rat = JSON.parse(files[RAT]!);
  const start = node(rat, "start").description;
  assert.equal(JSON.stringify(rat).split("how they count").length - 1, 1, "said in one place");
  assert.match(start, /Arlo's challenges, and how they count: Hobb has refused him twice tonight already, before the player came in[^]*Arlo's next challenge is the third, and it's an event of its own, Arlo's third challenge \[arlos-challenge\]: until it comes[^]*he doesn't put his elbow on Hobb's table\. It comes once[^]*If Hobb refuses it, that's his third refusal, and by the house custom it costs him the champion's chair there and then[^]*There's no fourth challenge\./);
  assert.match(node(rat, "start").cast.arlo, /hasn't made his third challenge yet/, "the co-GM's first role for him doesn't bring it about");
  assert.match(node(rat, "arlos-challenge").description, /It happens once, whichever way it goes\.$/);
  for (const c of rat.cast.filter((c: any) => c.id === "arlo")) assert.match(`${c.wants} ${c.whyHere}`, /Hobb is on two/, "his card counts as the prep does");
});

test("an approach that needs no dice says so up front, in the paths and on the cards (QA round qa2-1018's H4: the promise Cob's card says opens him was rolled for, failed, and lost the scene its lead)", () => {
  for (const [path, s] of sceneFiles()) {
    // The talk template's aren't: a talk has no dice at all (its reply format has no check), and each talk's prep writes its paths afresh.
    if (s.companion) continue;
    for (const n of s.nodes) (n.data.paths ?? []).forEach((p: any, i: number) => { if (!p.check) assert.match(p.earn, /^No dice: /, `${path}: ${n.id}'s path ${i + 1} has no check`); });
    for (const c of s.cast ?? []) for (const secret of c.secrets ?? []) if (/\bOpens\b/.test(secret)) assert.match(secret, /no dice/, `${path}: what opens ${c.id} says it needs no dice`);
  }
  // The paths with a check whose other approaches need none: the free ones first, then the roll.
  const mixed: Array<[string, string, number]> = [
    [SCENE, "murder", 0], [SCENE, "murder", 1], [SCENE, "murder", 4], [SCENE, "motive", 0],
    [RAT, "the-loft", 4], [RAT, "the-heron", 2], [RAT, "prouts-page", 0], [RAT, "prouts-page", 1],
    [HERON, "master-due", 1], [HERON, "true-book", 0], [HERON, "true-book", 1], [HERON, "true-book", 3], [HERON, "true-book", 6],
  ];
  for (const [path, id, i] of mixed) {
    const p = node(JSON.parse(files[path]!), id).paths[i];
    assert.ok(p.check, `${path}: ${id}'s path ${i + 1} has a check`);
    assert.match(p.earn, /^No dice: /, `${path}: ${id}'s path ${i + 1}`);
  }
  assert.match(node(JSON.parse(files[SCENE]!), "motive").paths[0].earn, /^No dice: he holds the left one out himself for someone he trusts, or who promises what answers his fear \(his name kept out of it, nothing to the watch, the men from the loft kept off him\)\. [^]*A polite ask where the boots stay his could go either way \(the check\)/);
  assert.match(node(JSON.parse(files[SCENE]!), "murder").paths[3].earn, /A real fright works too, on a roll \(Intimidation DC 12\)/, "a fright isn't among what needs no dice");
});

test("the Heron's bells are felt coming, and Hep's count falls each time she calls it (QA round qa2-1018: 'Forty to the hatch!' five times over, and no word of the tide all scene)", () => {
  const heron = JSON.parse(files[HERON]!);
  const hep = heron.cast.find((c: any) => c.id === "hep");
  assert.match(heron.clock, /Both bells are felt coming, a step nearer every exchange and never the same sign twice/);
  assert.match(heron.clock, /The barge sailing ends the night only if, by then, the player hasn't stopped the loading, taken the Master on or got the true book in hand/);
  assert.match(route(heron, "master-comes").data.condition, /Before it, it's felt coming: Hep's count falls every time she calls it/);
  assert.match(node(heron, "midnight").description, /From the moment he's in, the tide is felt turning, a little more every exchange/);
  assert.match(node(heron, "midnight").pressure, /from here the tide shows more with every exchange/);
  assert.match(route(heron, "cast-off").data.condition, /Before it rings, the tide is felt coming, more with each exchange after the Master comes in/);
  assert.match(hep.voice, /the number is the count as it stands: a few sacks fewer every time she calls it, never the same twice/);
  assert.match(hep.roles.characterise, /the count as it falls/);
  assert.match(node(heron, "floor").pressure, /^Hep bellows the count, a few sacks fewer than when she last called it/);
  assert.match(node(heron, "floor").cast.hep, /calls the count as it falls: a few fewer every exchange, never the same number twice/);
});

test("the clerk's lead reaches the player before the scene runs out: once the cart has come, the porters' noon break brings Old Wat to tell it, and Kell names him unasked from any description (QA round qa3-1018's H6: g07 and g08 ran out of turns without it)", () => {
  const clerk = JSON.parse(files[SCENE]!);
  const porters = route(clerk, "porters-come");
  assert.deepEqual([porters.source, porters.target, porters.data.phase, porters.data.limit], ["cart-arrives", "porters-break", "cue", [{ exchanges: 4, after: "cart-arrives", until: ["hobb"] }]]);
  assert.match(porters.data.condition, /^Once the cart has come and the player still hasn't the Hobb lead \(who was there, by name, and where to find him\), and the case is being made to Kell or has stalled/);
  assert.match(porters.data.condition, /Not needed while Cob or Moll is in the middle of telling who else was there, or a description has just reached Kell for her to name him from \(let that lead land first\), or once the player has the lead \[hobb\]\.$/, "it never comes over a lead about to land");
  const wat = clerk.cast.find((c: any) => c.id === "wat");
  assert.deepEqual([wat.enters, wat.called], ["porters-break", "the old porter"]);
  assert.match(node(clerk, "porters-break").cast.wat, /^Cap off to the dead clerk, then straight to the Sarge, unasked/);
  assert.match(node(clerk, "hobb").paths.find((p: any) => p.via === "wat").earn, /^No dice: when the porters come in for their noon break, after the cart, he comes to the Sarge and tells it unasked/, "the porters' path has someone to give it");
  assert.equal(node(clerk, "hobb").paths.find((p: any) => p.via === "kell").earn, "No dice: as soon as any description of him reaches her (his size, his bandaged hand, the Rat's arm-wrestling), or at once if one already has, she names him unasked and writes it down, and concludes nothing else.");
  assert.match(node(clerk, "cart-arrives").cast.kell, /If any description of the big man has reached her already, or the moment one does \(his size, his bandaged hand, the Rat's arm-wrestling\), she names him unasked/, "and her note at the cart says so, a description given before the cart too");
});

test("Kell signs Prout in once the case holds and the lead is in her notebook, writing down what she has until then and saying nothing aloud of what's missing (QA round qa3-1018's g05: she signed four turns before the lead, and the closing signed him again)", () => {
  const clerk = JSON.parse(files[SCENE]!);
  const kell = clerk.cast.find((c: any) => c.id === "kell");
  assert.match(node(clerk, "cart-arrives").description, /Kell will sign Prout in as a murder over the Captain's order once the player's case holds and the lead to who was there is in her notebook: [^]*until then writes down what she has, without saying aloud what's missing\./);
  assert.match(node(clerk, "cart-arrives").cast.kell, /Signs Prout in as a murder once the case holds and the lead to who was there is in her notebook; until then she writes what she has, and says nothing aloud of what's missing\./);
  assert.match(node(clerk, "porters-break").cast.kell, /With the lead in her notebook now, she signs Prout in as a murder once the case holds\.$/);
  assert.match(kell.attitude, /once the lead to who was there is in her notebook too, she'll sign Prout in as a murder over the Captain's word; until then she writes down what she has and says nothing aloud of what's missing\./);
});

test("a discovery: a revelation, two paths or more, three for a required one with one free of dice, each path whole and via the cast or a thing; never behind a roll alone", () => {
  const paths = changed(SCENE, s => {
    node(s, "murder").paths = node(s, "murder").paths.slice(0, 1);
    node(s, "hobb").paths = node(s, "hobb").paths.slice(0, 2);
    node(s, "motive").paths[1].earn = " ";
    node(s, "motive").paths[2].via = "silvertop";
    node(s, "cart-arrives").paths = [{ via: "tull", clue: "x", earn: "x", strength: "hook" }];
  });
  const dice = changed(SCENE, s => {
    node(s, "hobb").paths = node(s, "hobb").paths.map((p: any) => ({ ...p, check: { skill: "insight", dc: 10 } }));
    route(s, "find-motive").data.skill = "investigation";
  });

  assert.deepEqual(sceneChecks(paths), [
    "scenes/hanged-clerk.kmscene: discovery murder has 1 path, not two or more",
    "scenes/hanged-clerk.kmscene: discovery motive's path 2 has no earn",
    "scenes/hanged-clerk.kmscene: discovery motive's path 3 is via silvertop, who isn't in the cast",
    "scenes/hanged-clerk.kmscene: discovery hobb is required, but hasn't three paths with one that needs no dice",
    "scenes/hanged-clerk.kmscene: beat cart-arrives has paths but no revelation",
  ]);
  assert.deepEqual(sceneChecks(dice), [
    "scenes/hanged-clerk.kmscene: discovery motive is locked behind a roll: no route into it is free of dice",
    "scenes/hanged-clerk.kmscene: discovery hobb is required, but hasn't three paths with one that needs no dice",
  ]);
});

test("every node can be reached, a good or mixed ending among them; a good ending says what it needs, and what's required is needed by one", () => {
  const stuck = changed(SCENE, s => { route(s, "cart-comes").data.requires = ["cart-arrives"]; });
  const bleak = changed(SCENE, s => { node(s, "murder-unknown").result = "bad"; node(s, "suspicious").result = "bad"; });
  const free = changed(SCENE, s => { delete route(s, "signed-murder").data.requires; route(s, "signed-suicide").data.requires = []; });

  assert.deepEqual(sceneChecks(stuck), [
    "scenes/hanged-clerk.kmscene: cart-arrives can't be reached from the start", "scenes/hanged-clerk.kmscene: murder-unknown can't be reached from the start",
    "scenes/hanged-clerk.kmscene: suspicious can't be reached from the start", "scenes/hanged-clerk.kmscene: porters-break can't be reached from the start",
    "scenes/hanged-clerk.kmscene: it has no good or mixed ending that can be reached",
  ]);
  assert.deepEqual(sceneChecks(bleak), [
    "scenes/hanged-clerk.kmscene: it has no good or mixed ending that can be reached",
    "scenes/hanged-clerk.kmscene: discovery hobb is required, but no route into a good ending requires it",
  ]);
  assert.deepEqual(sceneChecks(free), [
    "scenes/hanged-clerk.kmscene: route signed-murder goes to a good ending (murder-unknown) but requires nothing found",
    "scenes/hanged-clerk.kmscene: discovery hobb is required, but no route into a good ending requires it",
  ]);
});

test("who enters comes on at an event, and the notes the start and the events hold are for the cast", () => {
  const people = changed(SCENE, s => { s.cast[3].enters = "murder"; node(s, "start").cast.sallow = "Waits."; });

  assert.deepEqual(sceneChecks(people), [
    "scenes/hanged-clerk.kmscene: tull enters at murder, which isn't an event beat",
    "scenes/hanged-clerk.kmscene: start has a note for sallow, who isn't in the cast",
  ]);
});

test("an ending's effects and the afterwards name only facts, cast and things that exist; an ending goes on to a scene of the campaign", () => {
  const files2 = changed(SCENE, s => {
    node(s, "murder-unknown").effects.push({ op: "give", what: "the-crown-jewels", to: "$player" }, { op: "remember", who: "sallow", text: "x" }, { op: "journal", text: "x", if: { established: "nope" } });
    node(s, "suspicious").next = "the-moon";
    s.afterwards.push({ op: "remove", what: "ghost" });
  });

  assert.deepEqual(sceneChecks(files2), [
    "scenes/hanged-clerk.kmscene: ending suspicious goes on to the-moon, which isn't one of the campaign's scenes",
    "scenes/hanged-clerk.kmscene: ending murder-unknown: give names unknown the-crown-jewels",
    "scenes/hanged-clerk.kmscene: ending murder-unknown: remember names unknown sallow",
    "scenes/hanged-clerk.kmscene: ending murder-unknown: condition on unknown fact nope",
    "scenes/hanged-clerk.kmscene: afterwards: remove names unknown ghost",
  ]);
});

test("the place's people are the cast, its things are somewhere, and what a beat carries is the place's or carried from another scene", () => {
  const stranger = changed(PLACE, p => { p.people.sallow = { in: "yard" }; });
  const floating = changed(PLACE, p => { p.things[0].in = "the-sky"; });
  const nowhere = changed(SCENE, s => { node(s, "motive").carry.things = ["ledger-page", "the-crown-jewels"]; });

  assert.deepEqual(sceneChecks(stranger), ["scenes/hanged-clerk.kmscene: granary-yard's people: sallow isn't in the cast"]);
  assert.deepEqual(sceneChecks(floating), ["places/granary-yard.json: thing elm is in unknown the-sky"]);
  assert.deepEqual(sceneChecks(nowhere), ["scenes/hanged-clerk.kmscene: beat motive carries the-crown-jewels, which isn't a thing of its place, nor carried from another scene"]);
});

test("the story goes on: every overtaken is a scene, a scene that can be overtaken says what it assumes, and an interlude goes on", () => {
  const lost = changed(RAT, s => { s.overtaken = "atlantis"; });
  const stuck = changed("scenes/wharf-night.kmscene", s => { delete node(s, "onward").next; });
  const loose = changed(HERON, s => { delete s.overtaken; });

  assert.deepEqual(sceneChecks(lost), ["scenes/drowned-rat.kmscene: overtaken, the story goes to atlantis, which isn't one of the campaign's scenes"]);
  assert.deepEqual(sceneChecks(stuck), ["scenes/wharf-night.kmscene: an interlude, but none of its endings goes on (the story skips it to where they go)"]);
  assert.deepEqual(sceneChecks(loose), ["scenes/heron-warehouse.kmscene: it assumes things, but doesn't say where the story goes when play has overtaken them (overtaken)"]);
});

test("the effects name an op, facts, people, things and quests the story has, onEnd's too", () => {
  const files2 = changed(RAT, s => {
    s.onEnd = [{ op: "follow", who: "moll" }];
    node(s, "taken-in").effects.push(
      { op: "teleport", what: "hobb" },
      { op: "quest", quest: "lost-cat", do: "advance", stage: "x", text: "x" },
      { op: "attitude", who: "hobb", to: "smitten", text: "x" },
      { op: "promise", by: "$player", to: "sallow", text: "x" },
      { op: "journal", text: "x", if: { established: ["hobb-talked", "nope"] } },
    );
  });
  const fight = changed(HERON, s => { node(s, "fight").effects = [{ op: "startFight", enemies: [{ asset: "bandit", count: 2, leader: "sallow" }], allies: ["kell", "duchess"], at: "the-roof" }]; });

  assert.deepEqual(sceneChecks(files2), [
    "scenes/drowned-rat.kmscene: onEnd: follow names unknown moll",
    "scenes/drowned-rat.kmscene: ending taken-in: teleport isn't an effect the story knows",
    "scenes/drowned-rat.kmscene: ending taken-in: quest lost-cat isn't one of campaign.json's quests",
    "scenes/drowned-rat.kmscene: ending taken-in: attitude smitten isn't an attitude",
    "scenes/drowned-rat.kmscene: ending taken-in: promise names unknown sallow",
    "scenes/drowned-rat.kmscene: ending taken-in: condition on unknown fact nope",
  ]);
  assert.deepEqual(sceneChecks(fight), ["scenes/heron-warehouse.kmscene: ending fight: startFight names unknown duchess", "scenes/heron-warehouse.kmscene: ending fight: startFight is at unknown the-roof"]);
});

test("the Rat may give the player Prout's page, which isn't its own but the granary's motive carries into it", () => {
  const rat = packOf(files).scenes.find(s => s.id === "drowned-rat")!;
  assert.ok((rat.onEnd ?? []).some(e => e.op === "give" && e.what === "ledger-page"));
  const uncarried = { ...changed(SCENE, s => { delete node(s, "motive").carry.things; }), [RAT]: changed(RAT, s => { delete node(s, "prouts-page").carry.things; })[RAT]! };
  assert.deepEqual(sceneChecks(uncarried), ["scenes/drowned-rat.kmscene: onEnd: give names unknown ledger-page"]);
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

const TALK = "scenes/talk.kmscene";

test("the talk template (town-design §3.6): its companion {companion}, its first cast entry the companion's, its start with their opening role, a told discovery, a goodbye the start leads to, and no place; and everyone who walks with the player has a lore entry to talk from", () => {
  const template = packOf(files).scenes.find(s => s.id === "talk")!;
  assert.deepEqual([template.companion, template.cast[0]!.id, template.cast[0]!.name, template.nodes.map(n => n.id)], ["{companion}", "{companion}", "{name}", ["talk", "told", "goodbye"]]);
  const [start, told] = template.nodes as any[];
  assert.match(start.data.cast["{companion}"], /^Characterise: at their own business/, "the companion's opening role, the co-GM's first note");
  assert.deepEqual([told.data.kind, told.data.paths.length, template.edges.map(e => [e.id, e.source, e.target, e.data.condition === ""])], ["beat", 2, [["goodbye", "talk", "goodbye", false], ["confided", "talk", "told", true]]], "told a discovery, the way into it taken once its revelation has landed");

  const wrong = changed(TALK, t => { t.companion = "kell"; t.cast[0].id = "kell"; t.nodes[1].id = "spilled"; t.edges[1].target = "spilled"; t.nodes[2].id = "farewell"; t.edges[0].target = "farewell"; t.place = "granary-yard"; });
  // (A place's people would be the template's cast, and the role and the paths are for {companion}: the scene checks say so too.)
  assert.deepEqual(checkCampaign(wrong).filter(p => p.includes("the talk template")), [
    'scenes/talk.kmscene: the talk template\'s companion is "kell", not "{companion}"',
    "scenes/talk.kmscene: the talk template's first cast entry isn't the companion's ({companion}, named {name})",
    "scenes/talk.kmscene: the talk template has no discovery told (the one thing they might confide, which each talk's prep fills in)",
    "scenes/talk.kmscene: the talk template has no ending goodbye (where saying goodbye or walking on ends a talk)",
    "scenes/talk.kmscene: the talk template has a place (a talk is wherever the player stopped)",
  ]);
  const roleless = changed(TALK, t => { delete t.nodes[0].data.cast; t.edges[0].source = "told"; });
  assert.deepEqual(checkCampaign(roleless), [
    "scenes/talk.kmscene: the talk template's start has no role for {companion} (their opening role, the co-GM's first note)",
    "scenes/talk.kmscene: the talk template has no way into goodbye from its start (saying goodbye ends a talk wherever it's got to)",
  ]);
  const evented = changed(TALK, t => { delete t.nodes[1].data.revelation; delete t.nodes[1].data.paths; t.edges[1].data.condition = "Kell has told it."; });
  assert.deepEqual(checkCampaign(evented), ["scenes/talk.kmscene: the talk template has no discovery told (the one thing they might confide, which each talk's prep fills in)"], "an event beat told, as the old pipeline had it, isn't a talk's any more");
  const entry = "lore/Cast/Sergeant Agnes Kell/private.md";
  const loreless = changed(entry, files[entry]!.replace('character: "kell"\n', ""));
  assert.deepEqual(checkCampaign(loreless), ["scenes/talk.kmscene: kell walks with the player, but has no lore entry to talk from (a private.md with character: kell)"]);
});
