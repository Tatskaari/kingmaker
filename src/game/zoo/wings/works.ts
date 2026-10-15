import { damageThing, joinWorld, worldView, type Entity } from "../../../world/scene-world.ts";
import { spill } from "../../../world/systems.ts";
import { sceneById } from "../../../../scenes/index.ts";
import { T } from "../../map/tiles.ts";
import { feet, marks, point, rect, type Ctx, type Exhibit, type Outcome, type Trigger, type Wing } from "../model.ts";
import { passTurn, syncGear } from "../world.ts";
import { cast, floorFor, resetLever, sandGlass, stage } from "./common.ts";
import { toHall } from "./hall.ts";

/**
 * The Works: the world's physics and bookkeeping, laid out on benches. Everything here is done the
 * way a scene does it: the stage manager's operations (what the GM's reply established, written
 * into the world), the rules for things (damage, immunities, areas), and the physics those call
 * (ignite, douse, spill, chill, bleed, break open). The levers and jugs set them off by hand.
 */

const GRID = `
################################################
%..............................................#
%..............................................#
%..C.S.R.P.....o........._.......W..K..G..A....#
%..............................................#
%.....1........2.........3.....................#
%.a.........b.........c.........d..............#
%..............................................#
%..............................................#
%..............................................#
%...p..B.......Y.........H.......U..N..O..T....#
%..............................................#
%....5.................6.............7.........#
%.e.........f.........g.........h..............#
%..............................................#
%...........................................w..#
%..............................................#
%.....j..........Q.L.......V............J.F....#
%..8.i...l..........................0..........#
%.....k...........9.........................E..#
%.m............n........q........r.............#
%..............................................#
%..........................Z...................#
%.......!.....?.......[........................#
%.....s.....t.......u......v...x...y....]......#
X.@.z..........................................#
%..............................................#
%%%%%%%%%%%%%%%%+%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
`;

const MARKS = "CSRP1ao2b_3cWKGAdpB5eYfH6gUNOT7h8ijklmQL9nVq0JFEwr!s?t[uvxy]@zZ";
const at = marks(GRID, MARKS);
const ID = "zoo-works";
const FLOOR = T("floor", { style: "flags" });

const bench = (name: string, glyph: string, color = "#c8b28a") => ({ name, glyph, color });

/** One of the visitor's weapons that this holder has (what they carry is in the world only while they do something). */
const weaponOf = (z: Ctx, holder: string): Entity | undefined => [...(z.session.carried ?? []), ...Object.values(z.world.entities)].find(e => e.gear && e.tags.includes("weapon") && e.parent === holder);

/** Stage operations, then whatever the sheet makes of the gear that changed hands. */
async function staged(z: Ctx, ops: Parameters<typeof stage>[1], lead: string): Promise<Outcome> {
  const done = stage(z, ops, lead);
  const gear = await syncGear(z);
  return gear.length ? { ...done, text: `${done.text} ${gear.join(" ")}`, lines: [...(done.lines ?? []), ...gear] } : done;
}

/** The testing rig: so much damage of a type to every specimen, through the world's own rules for things. */
function rig(z: Ctx, amount: number, type: string, lead: string): Outcome {
  const lines = ["specimen-stone", "specimen-iron", "specimen-wood", "specimen-trough", "specimen-sack"].flatMap(id => {
    const e = z.world.entities[id];
    if (!e || e.states.includes("destroyed")) return [];
    const said = damageThing(z.world, e, amount, type, z.turn);
    return said.length ? said : [`${e.name.charAt(0).toUpperCase()}${e.name.slice(1)} takes ${amount} ${type} damage`];
  });
  return { text: `${lead} ${lines.join(" · ")}`, lines };
}

const JUGS: Array<[string, string]> = [["water", "a jug of water"], ["oil", "a jug of lamp oil"], ["spirits", "a bottle of gin"], ["ale", "a jug of ale"], ["blood", "a butcher's pail of blood"], ["grease", "a pot of grease"]];

const sign = (id: string, mark: string, title: string, shows: string[], text: string, triggers: Trigger[] = [], extra: Partial<Exhibit> = {}): Exhibit =>
  ({ id, title, shows, sign: at[mark]!, text, triggers, ...extra });

const exhibits: Exhibit[] = [
  sign("works", "z", "The Works", ["Scene worlds"],
    "The machinery under every scene: a world of areas, things and people in feet, with materials, hit points and states, and the physics that make fire burn and water put it out. In a scene the GM says what happens and the stage manager writes it in; here the benches do it by hand. The lever by the far wall puts the Works back as it was: the chair unburnt, the butt unbroken, the butcher's boy's thumb restored, which is more than medicine can do.",
    [resetLever("works-reset", at["]"]!)]),
  sign("kindling", "a", "The kindling bay (catching fire)", ["Catching fire", "Ignite", "Burning things"],
    "Fire catches by material: wood, cloth, paper, rope and leather burn; iron, stone and glass only scorch (\"the flames lick it and die\"); wet things steam and refuse; oil burns on anything, even iron, until it's burned off. The tinderbox sets each of them alight the way the stage manager's ignite does, or a fire spell. A burning thing flickers in flame colours and lights its surroundings.",
    [
      { id: "light-chair", label: "Set light to the wooden chair", at: at["1"]!, station: bench("a tinderbox", "▪", "#c86040"), expect: ["ignite"], when: z => !z.thing("chair").states.includes("burning") && !z.thing("chair").states.includes("destroyed"), run: z => stage(z, [{ op: "ignite", what: "chair" }], "You strike the tinderbox at the chair.") },
      { id: "light-stove", label: "Set light to the iron stove", at: at["1"]!, run: z => stage(z, [{ op: "ignite", what: "stove" }], "You hold the flame to the iron stove.") },
      { id: "light-rug", label: "Set light to the wet rug", at: at["1"]!, run: z => stage(z, [{ op: "ignite", what: "wet-rug" }], "You hold the flame to the wet rug.") },
      { id: "light-pan", label: "Set light to the oiled pan", at: at["1"]!, expect: ["ignite"], when: z => !z.thing("oiled-pan").states.includes("burning"), run: z => stage(z, [{ op: "ignite", what: "oiled-pan" }], "You hold the flame to the oily iron pan.") },
      { id: "douse-chair", label: "Throw a bucket of water over the chair", at: "chair", expect: ["douse"], when: z => z.thing("chair").states.includes("burning"), run: z => stage(z, [{ op: "douse", what: "chair" }], "You throw the bucket over the chair.") },
    ], { tour: ["light-chair", "light-stove", "light-rug", "light-pan", "douse-chair"] }),
  sign("oil-tray", "b", "The oil tray (water on burning oil)", ["Water and dousing", "Douse", "Surfaces on the ground"],
    "Water puts a fire out in a hiss of steam, and leaves the thing scorched, dripping and standing in a puddle. Except burning oil, which floats: water on it spreads it, wider and still burning. Light the drip tray's oil, then do exactly what you shouldn't.",
    [
      { id: "light-oil", label: "Light the oil in the drip tray", at: at["2"]!, station: bench("a bucket and a taper", "▾", "#7aa0c8"), expect: ["ignite"], when: z => !!oilSlick(z) && !oilSlick(z)!.states.includes("burning"), run: z => stage(z, [{ op: "ignite", what: oilSlick(z)!.id }], "You touch the taper to the oil.") },
      { id: "water-oil", label: "Throw the bucket of water on the burning oil", at: at["2"]!, expect: ["splash"], when: z => !!oilSlick(z)?.states.includes("burning"),
        run: z => ({ ...stage(z, [{ op: "douse", what: oilSlick(z)!.id }], "You throw the water on the burning oil, as everyone tells you not to."), cues: [{ kind: "effect", effect: "splash", at: { id: oilSlick(z)!.id }, radius: 3, color: "#7ab8e8" }] }) },
    ]),
  sign("spills", "c", "The jugs (spills and surfaces)", ["Spills and surfaces", "Splash and ripples", "Surfaces on the ground"],
    "Spill water, oil, spirits, ale, blood or grease and it lies on the floor as a patch, joining a puddle of the same stuff if there's one there (growing, up to fifteen feet across) or making a new one, with a splash and ripples in its colour. Oil, spirits and grease onto a fire catch; grease and ice are slick. Pour them out on the stone floor one at a time.",
    JUGS.map(([liquid, jug], i): Trigger => ({
      id: `pour-${liquid}`, label: `Pour out ${jug}`, at: at["3"]!, ...(i === 0 ? { station: bench("a row of jugs", "ö", "#c8c0a0") } : {}), expect: ["splash"],
      run: z => stage(z, [{ op: "spill", what: liquid, to: "spill-floor", feet: 3 }], `You pour out ${jug} on the stone floor.`),
    }))),
  sign("breakables", "d", "The breakables (containers breaking open)", ["Containers breaking open", "Debris and smoke", "Destroying things and bringing them down"],
    "A container broken open spills what it held, sized to the container: the water butt a big puddle, the ale keg a smaller one, the gin jar a pool of spirits (and the drowned rat that was in it). If fire did it, a flammable spill is alight at once. A crate's contents fall out beside it when it's smashed. Debris flies, charred if it was burning.",
    [
      { id: "smash-butt", label: "Smash the water butt", at: "water-butt", expect: ["debris", "splash"], when: z => !z.thing("water-butt").states.includes("destroyed"), run: z => stage(z, [{ op: "break", what: "water-butt", text: "staved in" }], "You stave in the water butt.") },
      { id: "smash-keg", label: "Stave in the ale keg", at: "ale-keg", expect: ["debris", "splash"], when: z => !z.thing("ale-keg").states.includes("destroyed"), run: z => stage(z, [{ op: "break", what: "ale-keg", text: "staved in" }], "You stave in the ale keg. Somewhere a landlord feels a chill.") },
      { id: "burn-jar", label: "Cast Fire Bolt at the gin jar", at: "gin-jar", expect: ["bolt"], when: z => !z.thing("gin-jar").states.includes("destroyed"), run: z => cast(z, "fire-bolt", ["gin-jar"]) },
      { id: "smash-crate", label: "Smash the apple crate", at: "apple-crate", expect: ["debris"], when: z => !z.thing("apple-crate").states.includes("destroyed"), run: z => stage(z, [{ op: "destroy", what: "apple-crate", text: "smashed to kindling" }], "You smash the crate. Apples everywhere, as promised.") },
    ]),
  sign("cold", "e", "The cold store (cold)", ["Cold", "Steam puff"],
    "Cold freezes a puddle to a sheet of ice (slick), puts out a fire (with a puff of steam: it stopped burning without water), and frosts a liquid over. Cold damage does it too: Ray of Frost at the puddle. The frost lamp does it the stage manager's way.",
    [
      { id: "freeze-puddle", label: "Turn the frost lamp on the puddle", at: at["5"]!, station: bench("the frost lamp", "✱", "#bfe6ff"), expect: ["sparks"], when: z => !!coldPuddle(z) && coldPuddle(z)!.tags.includes("water"),
        run: z => ({ ...stage(z, [{ op: "chill", what: coldPuddle(z)!.id }], "The frost lamp hums at the puddle."), cues: [{ kind: "effect", effect: "sparks", at: { id: coldPuddle(z)!.id }, color: "#cfefff", amount: 1.5 }] }) },
      { id: "freeze-fire", label: "Turn the frost lamp on the bonfire", at: at["5"]!, expect: ["steam"], when: z => z.thing("bonfire").states.includes("burning"), run: z => stage(z, [{ op: "chill", what: "bonfire" }], "The frost lamp hums at the bonfire.") },
      { id: "frost-ray-puddle", label: "Cast Ray of Frost at the puddle", at: at["5"]!, expect: ["bolt"], when: z => !!coldPuddle(z) && coldPuddle(z)!.tags.includes("water"), run: z => cast(z, "ray-of-frost", [coldPuddle(z)!.id]) },
    ], { tour: ["freeze-puddle", "freeze-fire"] }),
  sign("butchers", "f", "The butcher's (blood)", ["Blood", "Marks of what happened (state tints)"],
    "A bad wound bloodies someone (they're drawn red) and leaves a small pool of blood under them; going down leaves a bigger one. The rules do it when a blow lands hard; the stage manager's bleed does it when the story says so. The butcher's boy has been warned about the cleaver.",
    [
      { id: "boy-thumb", label: "Hand the butcher's boy the cleaver", at: "butcher-boy", expect: ["splash"], when: z => !z.thing("butcher-boy").states.includes("bloodied"), run: z => stage(z, [{ op: "bleed", what: "butcher-boy", how: "light" }], "He takes the cleaver, and the top off his thumb. \"Ow,\" he says, reasonably.") },
      { id: "boy-faints", label: "Show him the thumb", at: "butcher-boy", expect: ["poof"], when: z => z.thing("butcher-boy").states.includes("bloodied") && !z.thing("butcher-boy").states.includes("unconscious"), run: z => stage(z, [{ op: "state", what: "butcher-boy", add: ["unconscious"] }, { op: "bleed", what: "butcher-boy" }], "He looks at it. He goes down like a sack of the King's grain.") },
    ]),
  sign("chandelier", "g", "The chandelier (bringing things down)", ["Destroying things and bringing them down", "Hanging, overhead, hidden and fallen", "Poof"],
    "A destroyed thing is no longer closed, barred, locked or lit, drops to nothing, and keeps a note of what's left of it. What it held falls out beside it, and anything hanging from it comes down: break the hoist rope and Prout falls; cut the chandelier's rope and the chandelier does. It has been told.",
    [{ id: "cut-chandelier", label: "Cut the chandelier's rope", at: at["6"]!, station: bench("the rope's cleat", "╥", "#c8a878"), expect: ["poof", "debris"], when: z => !z.thing("chandelier-rope").states.includes("destroyed"), run: z => stage(z, [{ op: "break", what: "chandelier-rope", text: "cut through" }], "You cut the rope. The chandelier comes down with a noise like a hundred spoons.") }]),
  sign("immunities", "h", "The testing rig (damage to things, and immunities)", ["Damage to things, and immunities", "Damage numbers, heals and 'unharmed'", "Wrecks and smouldering"],
    "Things take damage to their hit points: half or less and they're damaged, none and they're destroyed. Nothing feels poison or psychic. Stone shrugs off fire, cold, lightning, necrotic and radiant; iron fire, cold, necrotic and radiant; a liquid blows, force, thunder and more. The rig gives every specimen the same dose of one thing at a time, through the world's own rules: \"unharmed\" floats in grey over what didn't mind.",
    [
      { id: "rig-fire", label: "Give every specimen 6 fire", at: at["7"]!, station: bench("the testing rig", "╬", "#9ab0c0"), expect: ["float:unharmed"], run: z => rig(z, 6, "fire", "The rig breathes fire on the specimens.") },
      { id: "rig-blow", label: "Give every specimen 6 bludgeoning", at: at["7"]!, expect: ["float:unharmed"], run: z => rig(z, 6, "bludgeoning", "The rig hits every specimen with a hammer.") },
      { id: "rig-poison", label: "Give every specimen 6 poison", at: at["7"]!, expect: ["float:unharmed"], run: z => rig(z, 6, "poison", "The rig sprays the specimens with poison.") },
      { id: "rig-thunder", label: "Give every specimen 30 thunder", at: at["7"]!, expect: ["float:unharmed", "debris"], run: z => rig(z, 30, "thunder", "The rig shouts at the specimens, extremely loudly.") },
    ]),
  sign("cone", "m", "The straw men (areas catch by shape)", ["Areas catch by shape", "Spells on things, and spells that make surfaces"],
    "A spell's area catches everyone and everything in it that nobody's holding: a sphere or cylinder round where it's aimed, a cube in front of a caster whose range is self, a cone or a line out from the caster. Burning Hands is a 15-foot cone, as wide at its end as half its length: from the chalk circle, aimed at the near straw man, it catches him and the two behind him, and the fourth, further off, isn't in it. Things don't dodge: one roll of the dice for them all. Grease spreads a slick.",
    [
      // Aimed at the near one, straight along the row: the other two are three steps out and one to either side, inside the cone's spread.
      { id: "cone-burning-hands", label: "Cast Burning Hands at the straw men", at: at["8"]!, station: { name: "a chalk circle (cast from here)", glyph: "○", color: "#e8e4d8" }, stand: true, expect: ["ignite"], run: z => cast(z, "burning-hands", ["straw-man-1"]) },
      { id: "cone-grease", label: "Cast Grease on the far straw man", at: at["8"]!, stand: true, expect: ["splash"], run: z => cast(z, "grease", ["straw-man-4"]) },
    ]),
  sign("pay-desk", "n", "The pay desk (inventory and coin)", ["Inventory and coin"],
    "Every item has one owner: a person, a container or a room. Coins are stacks that split and join (\"two of the pennies\"). You came in with two silver crowns, six shillings and twelve pennies (twelve pennies to the shilling, five shillings to the crown); the sheet's purse and the carrying list say what you have now (c on the map). Paying, taking and dropping are the stage manager's give and drop.",
    [
      { id: "pay-penny", label: "Pay the toll-keeper a penny", at: "toll-keeper", run: z => stage(z, [{ op: "give", what: "pennies", to: "toll-keeper", quantity: 1 }], "You pay the toll-keeper a penny. He bites it, which is unhygienic, and customary.") },
      { id: "take-shilling", label: "Pick up the shilling on the table", at: "pay-table", when: z => !!z.world.entities["table-shilling"] && z.world.entities["table-shilling"]!.parent === "pay-table", run: z => stage(z, [{ op: "give", what: "table-shilling", to: "player" }], "You pick up the shilling. Nobody says it's theirs, which in Caerwyn is as good as a deed.") },
      { id: "drop-shilling", label: "Drop a shilling on the floor", at: at["9"]!, station: bench("a chalked square: DROP THINGS HERE", "□", "#e8e4d8"), run: z => stage(z, [{ op: "drop", what: "shillings", to: "drop-square", quantity: 1 }], "You drop a shilling. It rolls, as they do, exactly as far as it can.") },
    ]),
  sign("cloakroom", "q", "The cloakroom (gear in the world)", ["Gear in the world"],
    "Your weapons, armour and shield are in the world as things (\"Wren's dagger\", in hand or worn), so the story can part you from them. Hand one over and it leaves your sheet (\"You no longer have your dagger\"; a fight won't offer it); get it back and it's yours again. Armour coming off changes your AC.",
    [
      { id: "check-weapon", label: "Check your weapon at the cloakroom", at: "attendant", when: z => !!weaponOf(z, "player") && !weaponOf(z, "attendant"), run: z => staged(z, [{ op: "give", what: weaponOf(z, "player")!.id, to: "attendant" }], `You hand over ${weaponOf(z, "player")!.name}. The attendant gives you a ticket with a number on it and the air of a man who has lost things before.`) },
      { id: "fetch-weapon", label: "Ask for your weapon back", at: "attendant", when: z => !!weaponOf(z, "attendant"), run: z => staged(z, [{ op: "give", what: weaponOf(z, "attendant")!.id, to: "player" }], "You hand in your ticket. After a search of real thoroughness, he finds it.") },
    ]),
  sign("stage-desk", "r", "The stage manager's desk", ["The stage manager", "Poof", "Walks and slides (tweens)", "Looks for anything the GM invents"],
    "After every reply in a scene, a model call writes what it established into the world as operations: move, place (near, behind, beside, under, on, in; away or toward so many feet), give and drop, create, state, note, forget, remove, destroy, and the physics verbs. Only real ids; fixed things stay put (\"it's tied off up there\"), and what can't be done is logged \"(not done)\". Here the desk writes them out by hand: watch the porter walk (v looks down from above).",
    [
      { id: "sm-move", label: "Have the porter move to the window", at: at["0"]!, station: bench("the stage manager's desk", "▬", "#a07a52"), expect: ["moves"], run: z => stage(z, [{ op: "move", what: "sm-porter", to: "window" }], "\"Porter to the window,\" says the desk.") },
      { id: "sm-behind", label: "Put the hat stand behind the porter", at: at["0"]!, expect: ["moves"], run: z => stage(z, [{ op: "place", what: "hat-stand", to: "sm-porter", how: "behind" }], "\"Hat stand behind the porter.\"") },
      { id: "sm-create", label: "Make a flock of pigeons by the desk", at: at["0"]!, expect: ["poof"], when: z => !Object.values(z.world.entities).some(e => e.name === "a flock of pigeons" && !e.states.includes("gone")), run: z => stage(z, [{ op: "create", name: "a flock of pigeons", kind: "creature", to: "sm-desk" }], "\"Enter: pigeons.\"") },
      { id: "sm-invent", label: "Make something nobody planned for", at: at["0"]!, expect: ["poof"], when: z => !Object.values(z.world.entities).some(e => e.name === "a brass orrery on a velvet cushion"), run: z => stage(z, [{ op: "create", name: "a brass orrery on a velvet cushion", kind: "object", to: "sm-desk" }], "\"Enter: an orrery.\" The look layer has never heard of one, and draws it from its name.") },
      { id: "sm-bench", label: "Have the bolted-down bench moved", at: at["0"]!, run: z => stage(z, [{ op: "move", what: "bolted-bench", to: "window" }], "\"Bench to the window.\"") },
      { id: "sm-remove", label: "Send the porter home", at: at["0"]!, expect: ["poof"], when: z => !z.thing("sm-porter").states.includes("gone"), run: z => stage(z, [{ op: "remove", what: "sm-porter", text: "home, at last" }], "\"Exit the porter.\"") },
    ]),
  sign("ledger", "s", "The GM's ledger (scene worlds)", ["Scene worlds"],
    "Each scene's world is an entity tree: the place, its areas, its things and people and what they carry, in feet. Things have D&D object stats (armour class by material, hit points by size), tags and states. Every turn the GM is given the world as a ledger of what's where and in what state. Read the Works' own.",
    [{ id: "read-ledger", label: "Read the GM's ledger for the Works", at: at["!"]!, station: bench("the GM's ledger", "▤", "#d8cfa8"), run: z => ({ text: `The ledger reads: ${worldView(z.world).split("\n").slice(0, 14).join(" / ")}` }) }]),
  sign("delegates", "t", "The delegates' bell (entrances and groups)", ["Entrances and groups", "Groups and crowds"],
    "Cast members who arrive at a beat join the world at the way in, a door in your area, logged \"X arrives\". A group's members come in with their leader, each a person of their own (the talking Crake, the silent Crake, the lantern-boy). Ring for the delegation from the Nine Furrows.",
    [
      { id: "ring-delegates", label: "Ring for the delegation", at: at["?"]!, station: bench("the delegates' bell", "♪", "#e8c070"), expect: ["poof"], when: z => !z.world.entities.delegate || z.world.entities.delegate.states.includes("gone"),
        run: z => {
          for (const id of ["delegate", "delegate-clerk", "delegate-guard"]) delete z.world.entities[id];
          const joined = joinWorld(z.world, [{ id: "delegate", name: "the Nine Furrows delegate", members: [{ id: "delegate-clerk", name: "the delegate's clerk" }, { id: "delegate-guard", name: "the delegate's guard", statblock: "guard" }] }], z.turn);
          return { text: `Ding. In through the door: ${joined.join(", ")}. The delegate looks at the Works as if it owed the Nine Furrows money.`, lines: joined.map(n => `${n} arrives`) };
        } },
      { id: "dismiss-delegates", label: "See the delegation out", at: at["?"]!, expect: ["poof"], when: z => !!z.world.entities.delegate && !z.world.entities.delegate.states.includes("gone"),
        run: z => stage(z, [{ op: "remove", what: "delegate" }, { op: "remove", what: "delegate-clerk" }, { op: "remove", what: "delegate-guard" }], "The delegation leaves, in order of precedence.") },
    ]),
  sign("works-time", "u", "Time passes (the tick)", ["Fire over time (the tick)", "Wrecks and smouldering", "Clouds and haze"],
    "Each turn of story time: whatever's burning takes 1d10 fire and sets flammable things within five feet alight; burned-out wrecks smoulder a turn and go out; oil burns off things that don't burn; a burning patch burns what stands in it and spreads, then burns out to a scorch mark and smoke; clouds drift off; puddles dry after twenty turns. Set some of the Works alight, then turn the glass.",
    [sandGlass("works-sandglass", at["["]!)], { tour: ["works-sandglass", "works-sandglass", "works-sandglass"] }),
  sign("afterwards", "v", "Afterwards", ["Afterwards"],
    "What happens to a place offstage when its scene ends, whatever the ending, applied before the map takes the place over: in the Hanged Clerk, Prout is taken off the hoist (to the watch house under a sheet, or onto the dead-cart). It waits if a fight comes first. The hoist by this sign has a waxwork of Prout on it: run the Hanged Clerk's own afterwards on it, the very operation its scene ends with, and watch him go. (Rehearse the Hanged Clerk in the Theatre, and the card at its end says what became of the place.)",
    [{ id: "run-afterwards", label: "Run the Hanged Clerk's afterwards on the hoist", at: at.Z!, station: bench("a hoist, borrowed from Pinch Lane", "╥", "#a07a52"), expect: ["poof"],
      when: z => !!z.world.entities.prout && !z.world.entities.prout.states.includes("gone"),
      run: z => {
        const changes = z.ops(sceneById("hanged-clerk").afterwards ?? []);
        return { text: `The Hanged Clerk is over, and what happens to Pinch Lane offstage happens here, by the same operation: ${changes.map(c => `${c.charAt(0).toUpperCase()}${c.slice(1)}`).join("; ")}.`, lines: changes };
      } }]),
  sign("exit-scripts", "x", "Exit scripts", ["Exit scripts (world-update scripts)"],
    "Each ending runs its authored script into a recording world as the scene ends: quests started, advanced or failed; flags; items for you (Prout's page, Hobb's token, the true book); attitudes, memories and promises; the notebook's lines; and a fight's line-up. Every booth in the Theatre has them: end one (/end works offline) and open the notebook (j)."),
  sign("dust-store", "y", "A dust explosion in a scene", ["A dust explosion in a scene"],
    "Fire in a dusty area sets the dust off: the area is exploded and burning, every thing in it takes 4d6 fire, and anyone standing in it makes a serious fire save. In the arc only the Heron's re-sacking floor is dusty. The Burning Gallery's flour store does it on purpose, and the Arena's grain floor does it in a fight."),
];

const oilSlick = (z: Ctx) => Object.values(z.world.entities).find(e => e.kind === "surface" && e.tags.includes("oil") && e.parent === "oil-bay" && !e.states.includes("gone"));
const coldPuddle = (z: Ctx) => Object.values(z.world.entities).find(e => e.kind === "surface" && (e.tags.includes("water") || e.tags.includes("ice")) && e.parent === "cold-store" && !e.states.includes("gone"));

export const works: Wing = {
  id: ID,
  name: "the Works",
  about: "The world's physics and bookkeeping on benches: fire, water, spills, cold, blood, breaking, damage, coin, gear and the stage manager.",
  entry: at["@"]!,
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "brick", height: 3 }), "%": T("wall", { style: "brick", height: 1 }), ".": FLOOR, X: T("door", { style: "brick", height: 1 }), "+": T("door", { style: "brick", height: 1 }),
      ...floorFor(MARKS, FLOOR),
    },
    regions: [],
    exits: [{ at: { x: 0, y: 25 }, to: toHall(ID), label: "Back to the hall" }],
  },
  world: {
    name: "The Works", description: "A long brick workshop on flagstones, with benches of things set out to burn, break, spill and freeze.",
    size: { w: 48 * 5, h: 28 * 5 },
    areas: [
      { id: "works-floor", name: "the works floor", rect: rect(0, 0, 48, 28) },
      { id: "oil-bay", name: "the oil bay", rect: rect(12, 1, 7, 4) },
      { id: "cold-store", name: "the cold store", rect: rect(1, 8, 9, 4) },
      { id: "spill-bay", name: "the spill bay", rect: rect(21, 1, 8, 4) },
    ],
    things: [
      { id: "chair", name: "a wooden chair", in: "works-floor", at: feet(at.C!), size: "medium", material: "wood", tags: ["furniture"] },
      { id: "stove", name: "an iron stove", in: "works-floor", at: feet(at.S!), size: "medium", material: "iron" },
      { id: "wet-rug", name: "a wet rug", in: "works-floor", at: feet(at.R!), size: "medium", material: "cloth", states: ["wet"] },
      { id: "oiled-pan", name: "an oily iron pan", in: "works-floor", at: feet(at.P!), size: "small", material: "iron", states: ["oiled"] },
      { id: "drip-tray", name: "a drip tray", kind: "feature", in: "oil-bay", at: feet(at.o!), size: "medium", material: "iron", tags: ["fixed"] },
      { id: "spill-floor", name: "the stone spill floor", kind: "feature", in: "spill-bay", at: feet(at._!), size: "large", material: "stone", tags: ["fixed"] },
      { id: "water-butt", name: "a water butt", in: "works-floor", at: feet(at.W!), size: "large", material: "wood", tags: ["container", "water"] },
      { id: "ale-keg", name: "an ale keg", in: "works-floor", at: feet(at.K!), size: "medium", material: "wood", tags: ["container", "ale"] },
      { id: "gin-jar", name: "a gin jar", in: "works-floor", at: feet(at.G!), size: "small", material: "glass", tags: ["container", "spirits"], description: "A big glass jar of gin with a drowned rat in it, for reasons nobody will go into." },
      { id: "jar-rat", name: "a drowned rat", kind: "item", in: "gin-jar", size: "tiny", material: "flesh" },
      { id: "apple-crate", name: "a crate of apples", in: "works-floor", at: feet(at.A!), size: "medium", material: "wood", tags: ["container"] },
      { id: "apples", name: "a heap of apples", kind: "item", in: "apple-crate", size: "small", material: "flesh" },
      { id: "bonfire", name: "a small bonfire", in: "cold-store", at: feet(at.B!), size: "medium", material: "wood", tags: ["fire", "light"], states: ["burning", "lit"] },
      { id: "butcher-boy", name: "the butcher's boy", kind: "person", in: "works-floor", at: feet(at.Y!), description: "Apprenticed to a butcher, against medical advice." },
      { id: "beam", name: "a beam overhead", kind: "feature", in: "works-floor", at: feet(at.H!), size: "large", material: "wood", tags: ["fixed"] },
      { id: "chandelier-rope", name: "the chandelier's rope", kind: "item", in: "beam", size: "small", material: "rope", tags: ["hanging", "fixed"] },
      { id: "chandelier", name: "an iron chandelier", in: "chandelier-rope", size: "medium", material: "iron", tags: ["light"], states: ["hanging", "lit"] },
      { id: "specimen-stone", name: "a stone block", in: "works-floor", at: feet(at.U!), size: "medium", material: "stone" },
      { id: "specimen-iron", name: "an iron anvil", in: "works-floor", at: feet(at.N!), size: "medium", material: "iron" },
      { id: "specimen-wood", name: "a wooden post", in: "works-floor", at: feet(at.O!), size: "medium", material: "wood" },
      { id: "specimen-trough", name: "a trough of water", in: "works-floor", at: feet(at.T!), size: "large", material: "liquid", tags: ["water"], hp: 40 },
      { id: "specimen-sack", name: "a sack of sawdust", in: "works-floor", at: feet({ x: 44, y: 12 }), size: "small", material: "cloth" },
      { id: "straw-man-1", name: "a straw man", in: "works-floor", at: feet(at.i!), size: "medium", material: "cloth" },
      { id: "straw-man-2", name: "a second straw man", in: "works-floor", at: feet(at.j!), size: "medium", material: "cloth" },
      { id: "straw-man-3", name: "a third straw man", in: "works-floor", at: feet(at.k!), size: "medium", material: "cloth" },
      { id: "straw-man-4", name: "a fourth straw man, further off", in: "works-floor", at: feet(at.l!), size: "medium", material: "cloth" },
      { id: "toll-keeper", name: "the toll-keeper", kind: "person", in: "works-floor", at: feet(at.Q!), description: "A toll-keeper with a toll and no road." },
      { id: "pay-table", name: "a pay table", in: "works-floor", at: feet(at.L!), size: "medium", material: "wood", tags: ["furniture", "container"] },
      { id: "table-shilling", name: "shillings", kind: "item", in: "pay-table", size: "tiny", material: "silver", quantity: 1, description: "A shilling somebody left." },
      { id: "drop-square", name: "the chalked square", kind: "feature", in: "works-floor", at: feet(at["9"]!), size: "small", material: "stone", tags: ["fixed"] },
      { id: "attendant", name: "the cloakroom attendant", kind: "person", in: "works-floor", at: feet(at.V!), description: "Takes your things, gives you a ticket, and is the last man in the zoo to trust with either." },
      { id: "sm-desk", name: "the stage manager's desk", kind: "feature", in: "works-floor", at: feet(at["0"]!), size: "medium", material: "wood", tags: ["fixed"] },
      { id: "sm-porter", name: "a porter", kind: "person", in: "works-floor", at: feet(at.J!), description: "A porter who goes where he's told, which makes him invaluable to the stage manager." },
      { id: "hat-stand", name: "a hat stand", in: "works-floor", at: feet(at.F!), size: "medium", material: "wood" },
      { id: "bolted-bench", name: "a bench bolted to the floor", kind: "object", in: "works-floor", at: feet(at.E!), size: "large", material: "wood", tags: ["fixed"] },
      { id: "window", name: "the window", kind: "feature", in: "works-floor", at: feet(at.w!), size: "medium", material: "glass", tags: ["fixed"] },
      { id: "delegates-door", name: "the delegates' door", kind: "feature", in: "works-floor", at: feet({ x: 16, y: 27 }), size: "medium", material: "wood", tags: ["door"], states: ["closed"] },
      // The Hanged Clerk's hoist, in miniature: its afterwards (remove "prout") finds him here by his id.
      { id: "works-hoist", name: "a hoist beam", kind: "feature", in: "works-floor", at: feet(at.Z!), size: "large", material: "wood", tags: ["fixed"] },
      { id: "works-hoist-rope", name: "the hoist rope", kind: "item", in: "works-hoist", size: "small", material: "rope", tags: ["hanging", "fixed"] },
      { id: "prout", name: "the waxwork of Wendell Prout", kind: "object", in: "works-hoist-rope", size: "medium", material: "cloth", tags: ["body"], states: ["hanging"], description: "A waxwork of the hanged clerk, very like, in darned stockings and no boots. Somebody has hung a label on him: AFTERWARDS." },
    ],
    people: { player: { in: "works-floor", at: feet(at["@"]!) } },
  },
  setup: world => {
    spill(world, "oil", point(at.o!), 4, 0);
    spill(world, "water", point(at.p!), 4, 0);
  },
  dressing: { ground: { "works-floor": "flags", "oil-bay": "flags", "cold-store": "flags", "spill-bay": "flags" } },
  exhibits,
};
