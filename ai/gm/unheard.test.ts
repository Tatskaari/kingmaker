import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialGm } from "../../shared/gm/state.ts";
import type { PlaceFile } from "../../shared/scene/files.ts";
import { effectiveScene, presentCast } from "../../shared/scene/graph.ts";
import { loadScene } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { buildWorld, joinWorld } from "../../shared/world/scene-world.ts";
import { CAERWYN } from "./fixtures.ts";
import { asKnown, shortOf, unheardOf, type Unheard } from "./unheard.ts";
import type { TurnView } from "./view.ts";

/**
 * The names the player hasn't heard, out of the narration (unheard.ts), on replies QA round
 * qa1-1018's games had (runs/loop/qa1-1018/calls), as the model wrote them: Moll, Hep, Dilly and the
 * dog Duchess named before anyone said their names.
 */

const sceneText = (id: string) => readFileSync(join(CAERWYN, "scenes", `${id}.kmscene`), "utf8");
const sceneFile = (id: string): Scene => effectiveScene(loadScene(sceneText(id)), []);
/** A scene's place, as its file names it. */
const placeOf = (scene: Scene): PlaceFile => JSON.parse(readFileSync(join(CAERWYN, "places", `${(JSON.parse(sceneText(scene.id)) as { place: string }).place}.json`), "utf8")) as PlaceFile;

/** A scene's view at its start, its world as it opens, with these lines said so far. */
function viewOf(scene: Scene, transcript: TurnView["transcript"] = []): TurnView {
  const view: TurnView = {
    ...initialGm({ start: scene.start }), turnsInBeat: 1, id: "test-game", sceneId: scene.id, turn: 1,
    player: { name: "Nell Fitch", concept: "a thief", modifiers: {} }, fought: [], owed: [], history: [], transcript, twoPart: { roles: {}, notes: [] },
  };
  const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name }));
  view.world = buildWorld(scene.id, placeOf(scene), cast, view.player);
  joinWorld(view.world, cast, 0);
  return view;
}

const person = (id: string, name: string, called: string, aka?: string[]): Unheard => ({ id, name, called, short: shortOf(called), here: true, ...(aka ? { aka } : {}) });
const moll = person("moll", "Moll", "the girl in the shawl");
const cob = person("cob", "Cob", "the boy in the too-big boots");

test("who the player hasn't heard named, with what to call them: the cast with a `called`, and the place's named creatures by what they are", () => {
  const clerk = sceneFile("hanged-clerk");
  const yard = unheardOf(clerk, viewOf(clerk));
  assert.deepEqual(yard.map(u => [u.id, u.called, u.short, u.here]), [
    ["cob", "the boy in the too-big boots", "the boy", true],
    ["moll", "the girl in the shawl", "the girl", true],
    ["tull", "the corporal", "the corporal", false],
  ]);
  // Once someone has said it (Cob, of himself), it's heard.
  const heard = unheardOf(clerk, viewOf(clerk, [{ turn: 1, speaker: "gm", kind: "narration", text: "“Cob don’t take orders off palace pigeons.”" }]));
  assert.deepEqual(heard.map(u => u.id), ["moll", "tull"]);

  const heron = sceneFile("heron-warehouse");
  const wharf = unheardOf(heron, viewOf(heron));
  assert.deepEqual(wharf.find(u => u.id === "duchess"), { id: "duchess", name: "Duchess", called: "the mastiff", short: "the mastiff", here: true });
  assert.deepEqual(wharf.find(u => u.id === "hep"), { id: "hep", name: "Hepzibah Grist", aka: ["Hep"], called: "the forewoman with the sack-needle", short: "the forewoman", here: true });
  assert.equal(wharf.find(u => u.id === "sallow")?.here, false, "Sallow comes at midnight");
  assert.ok(!wharf.some(u => u.id === "gang" || u.id === "bargees"), "the place's people go by what they are, not a name");
});

test("the round's replies: a name nobody has said is what the player calls them, in full the first time, at a sentence's start with a capital", () => {
  // g02 turn 1: Cob names himself in his line; Moll is named by the narration, a turn before Cob says it.
  assert.equal(asKnown(
    "The boy catches the penny against his waistcoat.\n\n[Cob] “Cob don’t take orders off palace pigeons.” He pockets the penny anyway. “But Cob can decide he’s got better things to do.” The next stone drops to the cobbles. Moll snorts from the wall. [Moll] “Look at that. A whole penny’s worth of mercy.” Kell makes a short note. [Kell] “Payment received. Stone-throwing stopped. Noted.” Cob stamps in his oversized boots, pleased with the sound.",
    [moll, cob]).text,
    "The boy catches the penny against his waistcoat.\n\n[Cob] “Cob don’t take orders off palace pigeons.” He pockets the penny anyway. “But Cob can decide he’s got better things to do.” The next stone drops to the cobbles. The girl in the shawl snorts from the wall. [Moll] “Look at that. A whole penny’s worth of mercy.” Kell makes a short note. [Kell] “Payment received. Stone-throwing stopped. Noted.” Cob stamps in his oversized boots, pleased with the sound.");
  // g07 turn 1: nobody in the yard ever says Moll's name.
  assert.equal(asKnown("Kell returns your greeting with a brief nod. The boy lowers his next stone, apparently disappointed. Moll watches from the wall, one fist closed around something.", [moll, cob]).text,
    "Kell returns your greeting with a brief nod. The boy lowers his next stone, apparently disappointed. The girl in the shawl watches from the wall, one fist closed around something.");
  // g05 turn 1: Hep by the name she goes by.
  const hep = person("hep", "Hepzibah Grist", "the forewoman with the sack-needle", ["Hep"]);
  assert.equal(asKnown("The brass token at the grille would bring the bolt back; otherwise, Hep’s voice cuts through the door: [the forewoman with the sack-needle] “Forty to the hatch! If you’ve got hands, use them!”", [hep]).text,
    "The brass token at the grille would bring the bolt back; otherwise, the forewoman’s voice cuts through the door: [the forewoman with the sack-needle] “Forty to the hatch! If you’ve got hands, use them!”");
  // g06 turn 11.
  const dilly = person("dilly", "Dilly Sparrow", "the old bargewoman with the cards");
  assert.equal(asKnown("[Big Hobb Mallory] “I held him while he did it.” Dilly’s face tightens, but she keeps the room’s attention elsewhere with a quiet turn of her cards. Hobb swallows.", [dilly]).text,
    "[Big Hobb Mallory] “I held him while he did it.” The old bargewoman’s face tightens, but she keeps the room’s attention elsewhere with a quiet turn of her cards. Hobb swallows.");
  // g01 turn 10, and g05 turn 15: the dog, mid-sentence.
  const duchess = person("duchess", "Duchess", "the mastiff");
  assert.equal(asKnown("A key turns at the land door; the old watchman holds it open, while Duchess wakes and growls.", [duchess]).text,
    "A key turns at the land door; the old watchman holds it open, while the mastiff wakes and growls.");
  assert.equal(asKnown("Behind you, Duchess wakes and growls at her master’s ankles.", [duchess]).text, "Behind you, the mastiff wakes and growls at her master’s ankles.");
});

test("what someone owns, and a second mention, go by the short way; a title goes with the name; written words, lines said and tags keep their names", () => {
  // g04 turn 15.
  assert.equal(asKnown("[Cob] “First in gets first pick, does it? Cob’s writing that down.” You can’t reach the desk from here. But behind you, near the water butt, Moll’s gaze flicks toward the gate, then back to you. Moll shrugs.", [moll]).text,
    "[Cob] “First in gets first pick, does it? Cob’s writing that down.” You can’t reach the desk from here. But behind you, near the water butt, the girl’s gaze flicks toward the gate, then back to you. The girl shrugs.");
  const sallow = person("sallow", "Master Josiah Sallow", "the gentleman with the silver-topped cane");
  assert.equal(asKnown("Master Sallow’s cane taps the boards. The page is countersigned ‘J. Sallow, for the Royal Purveyor’, and then J. Sallow is a name you know.", [sallow]).text,
    "The gentleman’s cane taps the boards. The page is countersigned ‘J. Sallow, for the Royal Purveyor’, and then J. Sallow is a name you know.", "read on the page, the name is known from there on");
  const duchess = person("duchess", "Duchess", "the mastiff");
  assert.equal(asKnown("Duchess’ bowl rattles by the brazier. [Saul Tench] “Easy, Duchess.” Duchess settles.", [duchess]).text,
    "The mastiff’s bowl rattles by the brazier. [Saul Tench] “Easy, Duchess.” Duchess settles.", "said aloud, it's heard");
  assert.equal(asKnown("[Moll] “Shut it.” The boy goes quiet.", [moll]).text, "[Moll] “Shut it.” The boy goes quiet.", "a tag is the screen's");
  assert.deepEqual(asKnown("[Moll] “Shut it.” Moll glares.", [moll]), { text: "[Moll] “Shut it.” The girl in the shawl glares.", heard: [] }, "and nobody hears a tag");
  assert.deepEqual(asKnown("“Shut it, Moll,” the boy says. Moll glares.", [moll]), { text: "“Shut it, Moll,” the boy says. Moll glares.", heard: ["moll"] });
  assert.equal(asKnown("“Look at that,” Moll says.", [moll]).text, "“Look at that,” the girl in the shawl says.", "after a comma, no capital");
  assert.equal(asKnown("Big Hobb lifts a sack.", [person("hobb", "Big Hobb Mallory", "the big man with the bandaged hand")]).text, "The big man with the bandaged hand lifts a sack.");
  assert.equal(asKnown("A cobbled lane, a molly-coddled boy, and cob walls.", [moll, cob]).text, "A cobbled lane, a molly-coddled boy, and cob walls.", "a name is a whole word, as written");
  assert.equal(asKnown("Moll snorts.", []).text, "Moll snorts.");
});

test("as the reply streams, what's shown only grows, and ends as the whole reply has it", () => {
  const replies: Array<[string, Unheard[]]> = [
    ["The next stone drops to the cobbles. Moll snorts from the wall. [Moll] “Look at that.” Moll’s fist stays shut. [Cob] “Cob heard that, Moll!” Moll laughs.", [moll, cob]],
    ["Master Sallow’s cane taps. The order is signed ‘J. Sallow, for the Royal Purveyor’, and J. Sallow is the hand. Sallow smiles.", [person("sallow", "Master Josiah Sallow", "the gentleman with the silver-topped cane")]],
    ["Big Hobb lifts a sack; [Big Hobb Mallory] “Not yet, missus.” Hobb’s hand shakes.", [person("hobb", "Big Hobb Mallory", "the big man with the bandaged hand")]],
  ];
  for (const [raw, people] of replies) {
    const whole = asKnown(raw, people).text;
    let shown = "";
    for (let i = 0; i <= raw.length; i++) {
      const now = asKnown(raw.slice(0, i), people, { partial: true }).text;
      assert.ok(now.startsWith(shown), `shown at ${i} grows what was shown: ${JSON.stringify(now.slice(-30))}`);
      assert.ok(whole.startsWith(now), `shown at ${i} is the start of the whole: ${JSON.stringify(now.slice(-30))}`);
      shown = now;
    }
    assert.equal(asKnown(raw, people, { partial: false }).text, whole);
  }
  // A name may be on its way: its first letters wait, and so does a title.
  assert.equal(asKnown("The stone drops. Mo", [moll], { partial: true }).text, "The stone drops. ");
  assert.equal(asKnown("The cane belongs to Master ", [person("sallow", "Master Josiah Sallow", "the gentleman with the silver-topped cane")], { partial: true }).text, "The cane belongs to ");
});
