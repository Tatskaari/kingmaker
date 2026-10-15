import { test } from "node:test";
import assert from "node:assert/strict";
import { hangedClerkWorld } from "../../scenes/worlds/hanged-clerk.ts";
import { drownedRatWorld } from "../../scenes/worlds/drowned-rat.ts";
import { inventory, startingPurse } from "../world/inventory.ts";
import { buildWorld } from "../world/scene-world.ts";
import { ignite, spill } from "../world/systems.ts";
import { addressOf, lookText, pointedAt, pointOrder, thingActions, type SceneAction, type SceneContext, type SpellFacts } from "./scene-menu.ts";

/**
 * The scene's right-click menu (src/game/scene-menu.ts): what pointing says, what looking says,
 * and what's offered for someone, something carried, something fixed, something burning, the
 * player and the floor, with the lines its deeds send as the player's turn. No model calls.
 */

const SPELLS: SpellFacts[] = [
  { id: "fire-bolt", name: "Fire Bolt", level: 0, range: "120 feet", effects: ["attack"] },
  { id: "light", name: "Light", level: 0, range: "Touch", effects: [] },
  { id: "shield", name: "Shield", level: 1, range: "Self", effects: [] },
  { id: "cure-wounds", name: "Cure Wounds", level: 1, range: "Touch", effects: ["heal"] },
  { id: "burning-hands", name: "Burning Hands", level: 1, range: "Self (15-foot cone)", effects: ["save"], area: true },
];

/** The granary yard as a scene opens it: Kell, Cob and Moll; the player (Tamsin) with a purse and a shortsword in hand. */
function yard() {
  const world = buildWorld("hanged-clerk", hangedClerkWorld, [{ id: "kell", name: "Sergeant Agnes Kell" }, { id: "cob", name: "Cob" }, { id: "moll", name: "Moll" }], { name: "Tamsin Vell" });
  for (const coin of startingPurse()) inventory(world, 0).add("player", coin);
  world.entities["tamsin-shortsword"] = { id: "tamsin-shortsword", name: "Tamsin's shortsword", kind: "item", parent: "player", tags: ["weapon"], states: ["in hand"], notes: [], gear: "shortsword-1" };
  return world;
}
/** Before the player has heard Cob's and Moll's names. */
const UNNAMED: SceneContext = { unnamed: { cob: "the boy in the too-big boots", moll: "the girl in the shawl" }, spells: SPELLS };

const ids = (actions: SceneAction[]) => actions.map(a => a.id);
const find = (actions: SceneAction[], id: string) => { const a = actions.find(x => x.id === id); assert.ok(a, `offers ${id} (has ${ids(actions).join(", ")})`); return a; };
const lines = (actions: SceneAction[] | undefined) => (actions ?? []).map(a => a.line);

test("someone: talk first (their name, or what they're called, to start the line), then look, give, go over, attack, cast", () => {
  const world = yard();
  const cob = thingActions(world, { id: "cob" }, UNNAMED);
  assert.equal(cob.title, "The boy in the too-big boots", "the title keeps his name back until it's heard");
  assert.deepEqual(ids(cob.actions), ["talk", "look", "give", "go", "attack", "cast"]);
  assert.equal(cob.actions[0]!.start, "Boy, ", "talking starts the line with what he's called");
  assert.equal(thingActions(world, { id: "cob" }, { spells: SPELLS }).actions[0]!.start, "Cob, ", "and with his name once it's heard");
  assert.equal(thingActions(world, { id: "kell" }, UNNAMED).actions[0]!.start, "Sergeant Kell, ");
  assert.match(find(cob.actions, "look").look!, /^The boy in the too-big boots\. Under the body, lobbing gutter stones at it\.$/, "looking says what the world has noted of him");
  assert.deepEqual(lines(find(cob.actions, "give").choices), [
    "(I give the boy in the too-big boots one of my silver crowns)", "(I give the boy in the too-big boots one of my shillings)",
    "(I give the boy in the too-big boots one of my pennies)", "(I give the boy in the too-big boots my shortsword)",
  ], "giving offers what the player carries, in their own words");
  assert.equal(find(cob.actions, "go").line, "(I go over to the boy in the too-big boots)");
  assert.equal(find(cob.actions, "attack").line, "(I attack the boy in the too-big boots)");
  assert.deepEqual(lines(find(cob.actions, "cast").choices), [
    "(I cast Fire Bolt at the boy in the too-big boots)", "(I cast Light on the boy in the too-big boots)",
    "(I cast Burning Hands at the boy in the too-big boots)", "(I cast Cure Wounds on the boy in the too-big boots)",
  ], "his spells that reach someone else (not Shield), harm at him, help on him");
  // Kell is beside the player: nothing to go over for.
  assert.ok(!ids(thingActions(world, { id: "kell" }, UNNAMED).actions).includes("go"), "nobody goes over to someone already beside them");
  assert.deepEqual(pointedAt(world, { id: "cob" }, UNNAMED), { title: "The boy in the too-big boots", detail: "under the body, lobbing gutter stones at it" });
});

test("the player: look at yourself (what you carry), and cast on yourself what fits; nothing else", () => {
  const world = yard();
  const me = thingActions(world, { id: "player" }, UNNAMED);
  assert.equal(me.title, "You");
  assert.deepEqual(ids(me.actions), ["look", "cast"]);
  assert.equal(me.actions[0]!.look, "You. You have 2 silver crowns, 6 shillings, 12 pennies and your shortsword (in hand).");
  assert.deepEqual(lines(find(me.actions, "cast").choices), ["(I cast Light on myself)", "(I cast Cure Wounds on myself)", "(I cast Shield on myself)"], "not Fire Bolt or Burning Hands");
  assert.deepEqual(ids(thingActions(world, { id: "player" }, {}).actions), ["look"], "no spells, no casting");
});

test("something carried: yours to give, put down or cast on; someone else's to take from them", () => {
  const world = yard();
  const pennies = Object.values(world.entities).find(e => e.name === "pennies")!;
  const mine = thingActions(world, { id: pennies.id }, UNNAMED);
  assert.equal(mine.title, "12 pennies");
  assert.deepEqual(ids(mine.actions), ["look", "give", "put-down", "cast"], "no taking what you have, nor attacking it");
  assert.deepEqual(lines(find(mine.actions, "give").choices), ["(I give Sergeant Agnes Kell one of my pennies)", "(I give the boy in the too-big boots one of my pennies)", "(I give the girl in the shawl one of my pennies)"]);
  assert.equal(find(mine.actions, "put-down").line, "(I put down one of my pennies)");
  assert.deepEqual(lines(find(mine.actions, "cast").choices), ["(I cast Light on one of my pennies)"], "only what's gentle on your own things");
  assert.equal(find(thingActions(world, { id: "tamsin-shortsword" }, UNNAMED).actions, "put-down").line, "(I put down my shortsword)");
  assert.deepEqual(pointedAt(world, { id: pennies.id }, UNNAMED), { title: "12 pennies", detail: "you have it" });
  // Cob's boots: his to hand over.
  const boots = thingActions(world, { id: "boots" }, UNNAMED);
  assert.deepEqual(ids(boots.actions), ["look", "take", "go", "cast"]);
  assert.equal(find(boots.actions, "take").line, "(I take Prout's good black boots from the boy in the too-big boots)");
  assert.equal(find(boots.actions, "go").line, "(I go over to the boy in the too-big boots)", "going over to it is going over to him");
  assert.deepEqual(pointedAt(world, { id: "boots" }, UNNAMED), { title: "Prout's good black boots", detail: "the boy in the too-big boots has it" });
  assert.match(lookText(world, { id: "boots" }, UNNAMED), /^Prout's good black boots: the boy in the too-big boots has it\. Three sizes too big/);
});

test("something fixed: no taking it; what it's for, going over, breaking it, casting at it", () => {
  const world = yard();
  const rope = thingActions(world, { id: "hoist-rope" }, UNNAMED);
  assert.deepEqual(ids(rope.actions), ["look", "cut", "go", "attack", "cast"], "a rope with Prout on it is cut, not picked up");
  assert.equal(find(rope.actions, "cut").line, "(I cut the hoist rope)");
  assert.equal(find(rope.actions, "attack").line, "(I attack the hoist rope)");
  assert.deepEqual(lines(find(rope.actions, "cast").choices), ["(I cast Fire Bolt at the hoist rope)", "(I cast Light on the hoist rope)", "(I cast Burning Hands at the hoist rope)"], "no healing a rope");
  const door = thingActions(world, { id: "loft-door" }, UNNAMED);
  assert.deepEqual(ids(door.actions), ["look", "open", "go", "attack", "cast"]);
  assert.equal(find(door.actions, "open").line, "(I try to open the loft door)", "a barred door is tried");
  assert.equal(find(thingActions(world, { id: "gate" }, UNNAMED).actions, "close").line, "(I close the yard gate)", "an open one is closed");
  assert.ok(!ids(thingActions(world, { id: "elm" }, UNNAMED).actions).includes("attack"), "nobody attacks a tree the size of a house");
  // Prout hangs from the rope, on the beam: they're under him, each with its own menu.
  const prout = thingActions(world, { id: "prout", under: ["hoist-rope", "hoist-beam"] }, UNNAMED);
  assert.deepEqual(ids(prout.actions), ["look", "get-down", "examine", "go", "cast", "also:hoist-rope", "also:hoist-beam"]);
  assert.equal(find(prout.actions, "get-down").line, "(I get Wendell Prout's body down)");
  assert.equal(find(prout.actions, "examine").line, "(I examine Wendell Prout's body closely)");
  assert.equal(find(prout.actions, "also:hoist-rope").label, "The hoist rope…");
  assert.equal(find(find(prout.actions, "also:hoist-rope").choices!, "cut").line, "(I cut the hoist rope)");
  assert.equal(pointedAt(world, { id: "prout" }, UNNAMED)!.detail, "hanging from the hoist rope", "hanging is said once");
  // Things in or on things: taken from them, and gone over to by them.
  assert.deepEqual(ids(thingActions(world, { id: "granary-roll" }, UNNAMED).actions), ["look", "examine", "read", "go", "attack", "cast"], "the chained roll isn't taken");
  assert.equal(find(thingActions(world, { id: "granary-roll" }, UNNAMED).actions, "go").line, "(I go over to the tally desk)");
  const board = thingActions(world, { id: "loose-board" }, UNNAMED);
  assert.deepEqual(ids(board.actions), ["look", "go-through", "go", "attack", "cast"], "a loose board behind the water butt is a board (no looking inside it, or reading it)");
  assert.equal(find(board.actions, "go-through").line, "(I go through the loose board behind the water butt)");
});

test("something burning: putting it out comes first, and nobody picks it up", () => {
  const world = yard();
  world.entities.satchel!.states.push("burning");
  const satchel = thingActions(world, { id: "satchel" }, UNNAMED);
  assert.equal(satchel.actions[1]!.id, "put-out", "after looking, putting it out");
  assert.equal(satchel.actions[1]!.line, "(I try to put out the fire on Prout's satchel)");
  assert.ok(!ids(satchel.actions).includes("take"), "a burning satchel isn't picked up");
  assert.deepEqual(pointedAt(world, { id: "satchel" }, UNNAMED), { title: "Prout's satchel", detail: "open, empty, burning" });
  assert.match(lookText(world, { id: "satchel" }, UNNAMED), /^Prout's satchel, open, empty, burning\./);
  // A burning slick of oil (a surface): put out, gone over to, cast at; never taken or attacked.
  const rat = buildWorld("drowned-rat", drownedRatWorld, [{ id: "nan-quill", name: "Nan Quill" }], { name: "Odo" });
  const oil = spill(rat, "oil", { x: 20, y: 30 }, 4, 1).surface;
  ignite(rat, oil, 1);
  const slick = thingActions(rat, { id: oil.id }, { spells: SPELLS });
  assert.deepEqual(ids(slick.actions), ["look", "put-out", "go", "cast"]);
  assert.equal(find(slick.actions, "put-out").line, "(I try to put out the fire on the slick of oil)");
  // A lantern that's lit is put out; the fire in the hearth too.
  assert.equal(find(thingActions(rat, { id: "fire" }, {}).actions, "put-out").line, "(I put out the blue driftwood fire)");
});

test("the floor: what it is, and going over there when it's somewhere else", () => {
  const world = yard();
  const lane = { floor: { at: { x: 10, y: 4 }, area: "lane", ground: "cobbles", patch: "water" } };
  assert.deepEqual(pointedAt(world, lane, UNNAMED), { title: "The lane", detail: "cobbles, and a puddle" });
  assert.equal(lookText(world, lane, UNNAMED), "The lane beyond the yard wall, with an old elm leaning over it. Underfoot: cobbles, and a puddle.");
  const menu = thingActions(world, lane, UNNAMED);
  assert.deepEqual(menu.actions.map(a => [a.id, a.line]), [["look", undefined], ["go", "(I go over to the lane)"]]);
  // In the yard, where the player is: over by something, if it's far enough to go to.
  const butt = thingActions(world, { floor: { at: { x: 6, y: 34 }, area: "yard", ground: "cobbles" } }, UNNAMED);
  assert.equal(find(butt.actions, "go").line, "(I go over by the water butt)");
  assert.match(lookText(world, { floor: { at: { x: 40, y: 20 }, area: "loft", ground: "loft", wall: "timber" } }, UNNAMED), /^The tally loft: Up under the granary roof.* A timber wall\.$/, "a wall is a wall, in the area it's in");
  assert.equal(pointedAt(world, { floor: { at: { x: -4, y: 2 }, ground: "void" } }, UNNAMED), undefined, "past the place's edge is nothing");
});

test("while the GM has the floor, only what's instant (looking, starting a line); once the scene's over, only looking", () => {
  const world = yard();
  assert.deepEqual(ids(thingActions(world, { id: "cob" }, { ...UNNAMED, busy: true }).actions), ["talk", "look"]);
  assert.deepEqual(ids(thingActions(world, { id: "satchel" }, { ...UNNAMED, busy: true }).actions), ["look"]);
  assert.deepEqual(ids(thingActions(world, { id: "cob" }, { ...UNNAMED, over: true }).actions), ["look"]);
  assert.deepEqual(ids(thingActions(world, { id: "player" }, { ...UNNAMED, over: true }).actions), ["look"]);
});

test("how the player starts a line to someone, and the order Tab goes through the place", () => {
  const person = (id: string, name: string) => ({ id, name, kind: "person" as const, parent: null, tags: [], states: [], notes: [], cast: id });
  assert.equal(addressOf(person("hep", "Hepzibah Grist"), { aka: { hep: ["Hep"] } }), "Hep");
  assert.equal(addressOf(person("hobb", "Big Hobb Mallory")), "Hobb");
  assert.equal(addressOf(person("sallow", "Master Josiah Sallow")), "Master Sallow");
  assert.equal(addressOf(person("king", "King Aldren")), "King Aldren");
  assert.equal(addressOf(person("nan-quill", "Nan Quill"), { unnamed: { "nan-quill": "the landlady" } }), "Landlady");
  assert.equal(addressOf(person("dilly", "Dilly Sparrow"), { unnamed: { dilly: "the old bargewoman with the cards" } }), "Bargewoman");
  const world = yard();
  const order = pointOrder(world, ["player", "elm", "satchel", "moll", "cob", "kell", "water-butt", "yard-wall", "prout"]);
  assert.deepEqual(order, ["kell", "moll", "cob", "satchel", "prout", "water-butt", "yard-wall", "elm", "player"], "people nearest first, things, what the place is built of, and you last");
});
