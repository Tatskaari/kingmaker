import { castSpell, comeTo, jump, levelUp, passTime, rest, skillCheck, useFeature, wrestle } from "../../../rules/dnd.ts";
import { describeRoll } from "../../../runtime/dice.ts";
import type { Skill } from "../../../runtime/scene.ts";
import { T } from "../../map/tiles.ts";
import { BUILDS, wear, wearing } from "../builds.ts";
import { feet, marks, rect, type Ctx, type Exhibit, type Outcome, type Trigger, type Wing } from "../model.ts";
import { cast, floorFor, strike, told } from "./common.ts";
import { toHall } from "./hall.ts";

/**
 * The Rules Room: D&D as the scenes use it (src/rules/dnd.ts), without the GM. Every roll goes
 * through the rules engine with the visitor's own sheet: checks, their own spells (and not anyone
 * else's), blows, grapples and shoves, jumps, class features, rests, a level, and being knocked
 * out. In a scene the decider reads the same things out of what you say ("I grab him"); the
 * Theatre's practice yard is the place to try that with the GM.
 */

const GRID = `
############################################
%..........................................#
%..............T...........................#
%..L.......................................#
%....1...................3.......4.........#
%..............2...........................#
%.a.........b..........c.......d...........#
%..........................................#
%..........................................#
%................~..~~~....................#
%...M.....P......~..~~~.....K......6.......#
%.....C........5.~..~~~....................#
%................~..~~~....................#
%.e......f....g..~..~~~...h......i.........#
%..........................................#
%..........................................#
%..........................................#
%....7..........O..........................#
%.......8..........H.......................#
%..j..........k............................#
%...............9..........................#
X.@.z......................................#
%..........................................#
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
`;

const MARKS = "L1aT2b3c4dMCPef5gKh6i78jOHk9@z";
const at = marks(GRID, MARKS);
const ID = "zoo-rules";
const FLOOR = T("boards");

const station = (name: string, glyph: string, color = "#c8b28a") => ({ name, glyph, color });

/** A check through the engine with your sheet, said as the dice say it. */
async function check(z: Ctx, skill: Skill, dc: number, lead: string, after: (ok: boolean) => string): Promise<Outcome> {
  const roll = await skillCheck(z.session, skill, dc);
  const line = describeRoll(roll);
  return { text: `${lead} ${line}. ${after(roll.success)}`, lines: [line] };
}

/** A jump, and where it leaves you on the map: over the ditch, or in it (wet). */
async function leap(z: Ctx, feetOver: number, runUp: boolean, landing: { x: number; y: number }, lead: string): Promise<Outcome> {
  const j = await jump(z.session, { feet: feetOver, runUp, drop: 0 });
  if (j.made) {
    z.ex.at = { ...landing };
    return { text: `${lead} ${j.lines.join(" · ")}. You land on the far side, and look as if you meant it.`, lines: j.lines };
  }
  const me = z.thing("player");
  if (!me.states.includes("wet")) me.states.push("wet");
  return { text: `${lead} ${j.lines.join(" · ")}. You land in the ditch, which is wet, and so are you.`, lines: j.lines, cues: [{ kind: "effect", effect: "splash", at: { id: "player" }, radius: 2, color: "#7ab8e8" }] };
}

/** The costume rail: the same robes as the hall's wardrobe, for the class features. */
const rail = (id: string): Trigger => ({
  id: `rail-${id}`, label: `Put on ${BUILDS[id]!.robes} from the rail`, at: at["4"]!, ...(id === "fighter" ? { station: station("the costume rail", "▥", "#a07a52") } : {}),
  when: z => wearing(z.session) !== id, expect: ["poof"],
  run: async z => ({ text: `You put on ${BUILDS[id]!.robes}. ${await wear(z.session, id, z.world)}`, cues: [{ kind: "effect", effect: "poof", at: { id: "player" }, radius: 2 }] }),
});

/** A class feature, if you're of the class (the rail's robes are beside it). */
const feature = (id: string, feat: string, classId: string, label: string, target?: string): Trigger => ({
  id, label, at: at["4"]!, when: z => wearing(z.session) === classId,
  run: async z => { const out = await useFeature(z.session, [], feat, target); return { text: told(out.lines), lines: out.lines }; },
});

const sign = (id: string, mark: string, title: string, shows: string[], text: string, triggers: Trigger[] = [], extra: Partial<Exhibit> = {}): Exhibit =>
  ({ id, title, shows, sign: at[mark]!, text, triggers, ...extra });

const exhibits: Exhibit[] = [
  sign("rules", "z", "The Rules Room", [],
    "D&D as the scenes use it, without the GM: every roll is the rules engine's, with your own sheet (c shows it). Change who you are at the costume rail, or in the hall's wardrobe; the wardrobe also puts you back to level five after the milestone bell. In a scene the decider reads all of this out of what you say: try it with the GM in the Theatre's practice yard."),
  sign("checks", "a", "The examination desk (skill checks)", ["Skill checks"],
    "Every check goes through the engine with your sheet, so conditions, expertise and Bardic Inspiration apply. A natural 20 or a natural 1 is marked, and means more than the number. In a scene the GM's prep sets the DC and the method decides the skill (a threat is Intimidation, not Persuasion). The desk sets four.",
    [
      { id: "check-lock", label: "Pick the strongbox's lock (Sleight of Hand, DC 15)", at: at["1"]!, station: station("the examination desk", "▬", "#a07a52"), run: z => check(z, "sleight_of_hand", 15, "You go at the lock with a hairpin.", ok => ok ? "It clicks open. Inside: a note that says WELL DONE." : "The lock wins. It has done this before.") },
      { id: "check-rope", label: "Climb the rope to the ceiling (Athletics, DC 12)", at: at["1"]!, run: z => check(z, "athletics", 12, "You go up the rope.", ok => ok ? "You touch the ceiling. Nobody claps; it's that kind of room." : "You come down the rope, faster than you went up.") },
      { id: "check-penny", label: "Find the penny hidden in the room (Perception, DC 14)", at: at["1"]!, run: z => check(z, "perception", 14, "You look round the room for the penny.", ok => ok ? "It's on top of the door frame, where pennies go." : "There's no penny. There is a penny. You can't see it.") },
      { id: "check-arms", label: "Recall whose coat of arms is over the door (History, DC 10)", at: at["1"]!, run: z => check(z, "history", 10, "You squint at the coat of arms.", ok => ok ? "The Assessors' Guild: three ledgers and a magnifying glass, rampant." : "A bird. Possibly a hat.") },
    ]),
  sign("casting", "b", "The casting circle (your own spells)", ["Casting in a scene", "Spells on things, and spells that make surfaces"],
    "You cast your own spells from your own slots, through the engine: the lowest free slot, cantrips scaling by level, a ritual (ten minutes, no slot) when you say so. A spell you don't have ready, or no slot left, fizzles in the fiction: the wizard has Fire Bolt and no Cure Wounds, whatever the wizard would prefer. Attack spells roll against a thing's armour class.",
    [
      { id: "cast-own", label: "Cast Fire Bolt at the practice target", at: at["2"]!, station: { name: "a chalk circle (cast from here)", glyph: "○", color: "#e8e4d8" }, stand: true, expect: ["bolt"], run: z => cast(z, "fire-bolt", ["practice-target"]) },
      { id: "cast-other", label: "Cast Cure Wounds on yourself (it's not your spell)", at: at["2"]!, stand: true, run: z => cast(z, "cure-wounds", ["player"]) },
      { id: "cast-ritual", label: "Cast Detect Magic as a ritual (no slot)", at: at["2"]!, stand: true, expect: ["sparks"], run: async z => { const out = await castSpell(z.session, [], "detect-magic", [], { ritual: true }); return { text: told(out.lines), lines: out.lines }; } },
    ]),
  sign("running-out", "c", "The hourglass (spells running out)", ["Spells running out"],
    "Spells with a duration end as story time passes: about a minute an exchange in a scene, an hour between scenes, longer for a rest. Cast Detect Magic (concentration, up to ten minutes), then turn the hourglass: ten minutes pass, and so does the spell.",
    [
      { id: "cast-timed", label: "Cast Detect Magic (it lasts ten minutes)", at: at["3"]!, station: station("an hourglass, ten minutes", "⌛", "#e0c890"), expect: ["sparks"], run: z => cast(z, "detect-magic", []) },
      { id: "hourglass", label: "Turn the hourglass: ten minutes pass", at: at["3"]!, run: async z => { const lines = await passTime(z.session, 10); return { text: lines.length ? `Ten minutes pass. ${lines.join(" · ")}.` : "Ten minutes pass. Nothing you had going has run out.", lines }; } },
    ]),
  sign("features", "d", "The costume rail (class features)", ["Class features in a scene"],
    "What a class can do outside a fight too, through the engine's own intents, with their uses and recharges: Second Wind (the fighter heals), Rage (the barbarian), Bardic Inspiration (the bard gives it to someone), Innate Sorcery (the sorcerer). Put on the class's robes from the rail, then use it.",
    [
      rail("fighter"), feature("second-wind", "second-wind", "fighter", "Use Second Wind (the fighter)"),
      rail("barbarian"), feature("rage", "rage", "barbarian", "Rage (the barbarian)"),
      rail("bard"), feature("inspire", "bardic-inspiration", "bard", "Give Big Rodney Bardic Inspiration (the bard)", "sparring-partner"),
      rail("sorcerer"), feature("innate-sorcery", "innate-sorcery", "sorcerer", "Use Innate Sorcery (the sorcerer)"),
      rail("wizard"),
    ],
    { tour: ["rail-fighter", "second-wind", "rail-barbarian", "rage", "rail-bard", "inspire", "rail-sorcerer", "innate-sorcery", "rail-wizard"] }),
  sign("blows", "e", "The practice dummy (a blow)", ["A blow in a scene", "Bystanders"],
    "\"I hit him\" in a scene is one attack through the engine with your weapon, or an improvised one for a thrown chair (1d4, no proficiency). At a thing it's your attack against its armour class and damage to its hit points. People get SRD statblocks the first time they're needed; you never see their hit points, only unhurt, hurt, badly hurt or down. A single blow, not a whole fight: a real fight goes to the map.",
    [
      { id: "hit-dummy", label: "Hit the practice dummy", at: "practice-dummy", run: z => strike(z, "practice-dummy", undefined, "You hit the dummy.") },
      { id: "throw-chair", label: "Throw the chair at the dummy (an improvised weapon)", at: "throwing-chair", expect: ["throw"], run: async z => ({ ...(await strike(z, "practice-dummy", "improvised", "You throw the chair.")), cues: [{ kind: "effect", effect: "throw", from: { id: "player" }, to: { id: "practice-dummy" }, glyph: "╥", color: "#a07a52" }] }) },
      { id: "punch-rodney", label: "Hit Big Rodney (he's paid to stand there)", at: "sparring-partner", run: z => strike(z, "sparring-partner", undefined, "You take a swing at Big Rodney.") },
    ]),
  sign("grapple", "f", "Big Rodney (grapple and shove)", ["Grapple and shove", "Marks of what happened (state tints)"],
    "Grab or shove someone who'd resist and they make a save against your Strength DC: or they're grappled, knocked prone, or pushed back five feet, and the world shows it (prone people lie down). Big Rodney has agreed to all of this for a shilling.",
    [
      { id: "grab-rodney", label: "Grab Big Rodney", at: "sparring-partner", run: async z => { const out = await wrestle(z.session, [], "sparring-partner", "grapple"); return { text: told(out.lines), lines: out.lines }; } },
      { id: "shove-rodney", label: "Shove Big Rodney over", at: "sparring-partner", run: async z => { const out = await wrestle(z.session, [], "sparring-partner", "prone"); return { text: told(out.lines), lines: out.lines }; } },
      { id: "push-rodney", label: "Push Big Rodney back", at: "sparring-partner", run: async z => { const out = await wrestle(z.session, [], "sparring-partner", "push"); return { text: told(out.lines), lines: out.lines }; } },
      { id: "help-rodney-up", label: "Help Big Rodney up", at: "sparring-partner", when: z => z.thing("sparring-partner").states.some(s => s === "prone" || s === "grappled"), run: z => { const e = z.thing("sparring-partner"); e.states = e.states.filter(s => s !== "prone" && s !== "grappled"); return { text: "You help Big Rodney up. He says no hard feelings, and means about half of it." }; } },
    ]),
  sign("jumps", "g", "The long-jump pit (jumping)", ["Jumping"],
    "Long, high or down, with or without a run-up. A long jump covers your Strength score in feet after a ten-foot run-up, half that standing; a high jump is three plus your Strength modifier. Within reach it just happens; up to half as far again is Athletics, DC 10 and a point a foot over; further and you fall short (into water: wet). The narrow ditch is five feet, the wide one fifteen.",
    [
      { id: "jump-narrow", label: "Jump the narrow ditch (5 feet, standing)", at: at["5"]!, station: station("the take-off board", "═", "#e8e4d8"), run: z => leap(z, 5, false, { x: 18, y: 11 }, "You jump the narrow ditch.") },
      { id: "jump-wide", label: "Jump the wide ditch (15 feet, with a run-up)", at: { x: 19, y: 11 }, station: station("the wide ditch's take-off board", "═", "#e8e4d8"), run: z => leap(z, 15, true, { x: 23, y: 11 }, "You take a run at the wide ditch.") },
    ]),
  sign("knocked-out", "j", "The trapdoor (knocked out, and coming to)", ["Knocked out, and coming to"],
    "Outside a fight on the map, 0 hit points knocks you senseless: unconscious but stable. The story goes on round you, and you come to with 1 hit point at the next scene (or as a fight's aftermath begins). The trapdoor is a very long way down; the smelling salts are by it. The cot is over there, for afterwards.",
    [
      { id: "trapdoor", label: "Step through the trapdoor (it's a long way down)", at: at["7"]!, station: station("a trapdoor marked DO NOT", "▫", "#8a6038"), expect: ["poof"],
        run: async z => {
          // A fall, not a jump: the rules' own (1d6 a ten feet, at most 20d6, and prone), without the jump's line.
          const j = await jump(z.session, { feet: Number.POSITIVE_INFINITY, drop: 200 });
          const lines = j.lines.filter(l => !/^Jump:/.test(l));
          const me = z.thing("player");
          const down = /senseless|0 hit points|HP 0\//.test(j.account + lines.join(" "));
          if (down && !me.states.includes("unconscious")) me.states.push("unconscious");
          if (lines.some(l => /You are prone/.test(l)) && !me.states.includes("prone")) me.states.push("prone");
          return { text: `You step through the trapdoor. ${lines.join(" · ")}. ${down ? "Then nothing, for a while." : "You land in a heap, somehow still awake."}`, lines };
        } },
      { id: "salts", label: "Wave the smelling salts (come to)", at: at["8"]!, station: station("smelling salts", "!", "#e8e4d8"),
        run: async z => {
          const me = z.thing("player");
          me.states = me.states.filter(s => s !== "unconscious" && s !== "prone");
          const line = await comeTo(z.session);
          return { text: line ? `${line}. The salts smell of every bad decision at once.` : "You sniff the salts. You were awake already; now you're very awake.", lines: line ? [line] : [] };
        } },
    ]),
  sign("rests", "h", "The cot (rests)", ["Rests"],
    "Rest an hour and it's a short rest: Hit Dice spent while each would still heal most of a die. Sleep the night and it's a long one: everything back, and the slots with it. A scene with a rest gives it before it opens (the King's morning gives a long one).",
    [
      { id: "short-rest", label: "Rest an hour on the cot (a short rest)", at: "cot", run: async z => { const out = await rest(z.session, "short"); return { text: told(out.lines), lines: out.lines }; } },
      { id: "long-rest", label: "Sleep the night on the cot (a long rest)", at: "cot", run: async z => { const out = await rest(z.session, "long"); return { text: told(out.lines), lines: out.lines }; } },
    ]),
  sign("level-up", "i", "The milestone bell (levelling up)", ["Levelling up at a milestone"],
    "Reaching a milestone scene (the King's morning) raises your main class a level as it opens, before the night's rest fills the new hit points: \"Level up! ... HP max 24 → 31. Choices: ...\". It fires offline too. Ring the bell for one; the hall's wardrobe puts you back to five.",
    [{ id: "milestone", label: "Ring the milestone bell (a level)", at: at["6"]!, station: station("the milestone bell", "♪", "#e8c070"), expect: ["sparks"], run: async z => { const lines = await levelUp(z.session); return { text: lines.join(" "), lines, cues: [{ kind: "effect", effect: "sparks", at: { id: "player" }, color: "#ffd75f", amount: 1.5 }] }; } }]),
  sign("bystanders", "k", "The onlookers (bystanders)", ["Bystanders", "Groups and crowds"],
    "People in the world who aren't in the cast (the regulars, a gang, the bargees, a crowd) can be hit or caught in a spell: as commoners, or with a statblock of their own. The heckler has opinions about your technique. A crowd is drawn as several people round its spot, each on its own beat.",
    [
      { id: "missile-heckler", label: "Cast Magic Missile at the heckler", at: at["9"]!, station: { name: "a chalk circle (cast from here)", glyph: "○", color: "#e8e4d8" }, stand: true, expect: ["bolt", "float:damage"], when: z => !z.thing("heckler").states.some(s => s === "down" || s === "unconscious" || s === "dead"), run: z => cast(z, "magic-missile", ["heckler"]) },
      { id: "thunder-crowd", label: "Cast Thunderwave at the crowd", at: at["9"]!, stand: true, expect: ["shockwave"], run: z => cast(z, "thunderwave", ["onlookers"]) },
    ]),
];

export const rules: Wing = {
  id: ID,
  name: "the Rules Room",
  about: "D&D without the GM, through the rules engine with your own sheet: checks, your own spells, blows, grapples, jumps, class features, rests, a level, and being knocked out.",
  entry: at["@"]!,
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "plaster", height: 3 }), "%": T("wall", { style: "plaster", height: 1 }), ".": FLOOR, X: T("door", { style: "plaster", height: 1 }), "~": T("water"),
      ...floorFor(MARKS, FLOOR),
    },
    regions: [{ id: "zoo-rules-pit", name: "the long-jump pit", rect: { x: 14, y: 9, w: 10, h: 5 }, description: "Two ditches of water, a narrow one and a wide one, and a board to jump from." }],
    exits: [{ at: { x: 0, y: 21 }, to: toHall(ID), label: "Back to the hall" }],
  },
  world: {
    name: "The Rules Room", description: "A gymnasium with a desk, a chalk circle, a dummy, two ditches and a man called Big Rodney.",
    size: { w: 44 * 5, h: 24 * 5 },
    areas: [{ id: "gym", name: "the rules room", rect: rect(0, 0, 44, 24) }],
    things: [
      { id: "strongbox", name: "a strongbox", in: "gym", at: feet(at.L!), size: "small", material: "iron", tags: ["container"], states: ["locked"] },
      { id: "practice-target", name: "a practice target", in: "gym", at: feet(at.T!), size: "medium", material: "wood" },
      { id: "practice-dummy", name: "the practice dummy", in: "gym", at: feet(at.M!), size: "medium", material: "cloth", hp: 40, description: "Stuffed, stitched, and patient beyond all reason." },
      { id: "throwing-chair", name: "a chair for throwing", kind: "object", in: "gym", at: feet(at.C!), size: "small", material: "wood" },
      { id: "sparring-partner", name: "Big Rodney", kind: "person", in: "gym", at: feet(at.P!), description: "A sparring partner, paid by the bruise." },
      { id: "cot", name: "a cot", in: "gym", at: feet(at.K!), size: "medium", material: "wood", tags: ["furniture"] },
      { id: "onlookers", name: "a crowd of onlookers", kind: "person", in: "gym", at: feet(at.O!), description: "People who came to watch someone else do exercise, which is the best kind." },
      { id: "heckler", name: "the heckler", kind: "person", in: "gym", at: feet(at.H!), description: "He has notes on your form." },
    ],
    people: { player: { in: "gym", at: feet(at["@"]!) } },
  },
  stats: { "sparring-partner": { statblock: "tough" } },
  dressing: { ground: { gym: "boards" } },
  exhibits,
};
