import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { castNamed, deedsIn, mightAct, spellNamed, spellsOf, type ActingSheet, type Named } from "./acting.ts";

/**
 * The line check (acting.ts): which of a player's lines in a scene might be an act the rules resolve
 * (a spell, a blow, a shot or a throw, a class feature), so that only they are asked the mechanic
 * question before the reply; the spell a line names, as typed; what a line says the character does.
 */

const PACK = join(import.meta.dirname, "..", "..", "vendor", "dnd-srd-engine", "starter-pack.json");
/** Every spell the rules know, as the engine's content has them. */
const SPELLS: Named[] = (JSON.parse(readFileSync(PACK, "utf8")) as { spells: Named[] }).spells.map(s => ({ id: s.id, name: s.name }));

const WIZARD: ActingSheet = {
  spells: [{ id: "fire-bolt", name: "Fire Bolt" }, { id: "light", name: "Light" }, { id: "magic-missile", name: "Magic Missile" }, { id: "shield", name: "Shield" }, { id: "sleep", name: "Sleep" }],
  weapons: [{ id: "q1", name: "Quarterstaff" }, { id: "d1", name: "Dagger" }], features: [],
};
/** The ready-made rogue of the user's report: no spells, no features with uses. */
const ROGUE: ActingSheet = { spells: [], weapons: [{ id: "r1", name: "Rapier" }, { id: "s1", name: "Shortbow" }, { id: "d1", name: "Dagger" }, { id: "u1", name: "Unarmed Strike" }], features: [] };
const FIGHTER: ActingSheet = { spells: [], weapons: [{ id: "l1", name: "Longsword" }, { id: "c1", name: "Light Crossbow" }], features: [{ id: "second-wind", name: "Second Wind" }] };

const asked = (line: string, sheet = WIZARD) => mightAct(line, sheet, SPELLS);

test("the user's report, turns 9 and 10: a rogue casting Fire Bolt is asked what the rules make of it, though she has no spells", () => {
  assert.equal(asked("(I cast firebolt at the boy)", ROGUE), "casting: cast");
  assert.equal(asked("(I cast firebolt at cob)", ROGUE), "casting: cast");
  assert.equal(asked("Fire Bolt at Cob!", ROGUE), "a spell: Fire Bolt", "a spell by its name, with no word of casting");
});

test("spells, blows, shots, throws and class features are asked, by their words: casting, a spell's name (anyone's), a blow, something swung or thrown at someone, a weapon brought down on them, a feature", () => {
  const acts: Array<[string, string, ActingSheet?]> = [
    ["(I cast Magic Missile at the hoist rope)", "casting: cast"],
    ["I cast Fireball at the elm", "casting: cast"],
    ["Fireball the porters!", "a spell: Fireball"],
    ["(I zap him with a ray of frost)", "a spell: Ray of Frost"],
    ["I thunderwave them all", "a spell: Thunderwave"],
    ["(I shape the gestures and murmur the words of Detect Magic, and look him over)", "casting: magic"],
    ["(I send a spectral Mage Hand up to saw through the rope)", "a spell: Mage Hand"],
    ["(I hold my hand up and put the boy to Sleep)", "a spell: Sleep"],
    ["(I punch Cob in the face)", "a blow: punch"],
    ["*stabs the corporal*", "a blow: stabs"],
    ["I kick the boy", "a blow: kick"],
    ["(I shoot Moll with my shortbow)", "a blow: shoot", ROGUE],
    ["I take a swing at Sergeant Kell with my staff", "a blow: swing at"],
    ["(I throw a stone at the hoist hook)", "a blow: throw a stone at"],
    ["(I loose the hand crossbow at his sword hand.)", "a blow: loose the hand crossbow at"],
    ["*hurls a bottle at the Crake*", "a blow: hurls a bottle at"],
    ["I hit him with my staff", "a blow: hit"],
    ["Take that! (I strike at the corporal with my longsword)", "a blow: strike", FIGHTER],
    ["(I slap Cob)", "a blow: slap cob"],
    ["(I bring my dagger down on his hand)", "a weapon: Dagger", ROGUE],
    ["(I use my Second Wind)", "a feature: Second Wind", FIGHTER],
  ];
  for (const [line, why, sheet] of acts) assert.equal(asked(line, sheet), why, line);
});

test("ordinary lines go straight to the reply: talk, deeds nothing in the rules settles, the past (what happened), and spells' names that are everyday words, written as words", () => {
  const ordinary = [
    "Sergeant, who found him, and when?",
    "*I lean on the wall beneath the girl, voice low and friendly* A penny's mercy for him, aye.",
    "(I hold up a shilling between two fingers so it catches the light)",
    "(I keep watching the gate.)",
    "I'd sooner go to the Mending House myself.",
    "Bring a message for the Captain: the clerk was strangled before he was hung.",
    "(I crouch by the smashed lantern and look for anything trodden through the ink.)",
    "He struck Prout with that cane and strangled him with a cord.",
    "(I swing the loft door open.)",
    "(I draw my rapier and step up beside Kell.)",
    "(I slit the lining of my left boot with my dagger and fish out the page.)",
    "(I slap a silver crown down on the table)",
    "Strike the lad's name from that book, if you'd be so kind.",
    "(I unbuckle my mail and shield, and set them by the butt.)",
    "I think Sallow killed him.",
    "If she casts off before I'm out, write down the time.",
    "(I watch the sacks swing down into the barge's hatch)",
  ];
  for (const line of ordinary) assert.equal(asked(line), undefined, line);
  assert.equal(asked("(I put my hands up)", FIGHTER), undefined);
});

test("the spell a line names, as typed: run together, hyphenated, any case, the longest of several; an everyday word only written as a name", () => {
  assert.equal(spellNamed(SPELLS, "(I cast firebolt at cob)")?.id, "fire-bolt");
  assert.equal(spellNamed(SPELLS, "a Fire-Bolt, then")?.id, "fire-bolt");
  assert.equal(spellNamed(SPELLS, "I MAGIC MISSILE the rope")?.id, "magic-missile");
  assert.equal(spellNamed(SPELLS, "a Mass Cure Wounds for them all")?.id, "mass-cure-wounds");
  assert.equal(spellNamed(SPELLS, "I cast Light on the stone")?.id, "light");
  assert.equal(spellNamed(SPELLS, "the light's poor in here"), undefined);
  assert.equal(spellNamed(SPELLS, "Light the lantern, would you?"), undefined, "a sentence's first word isn't a name");
  assert.equal(spellNamed(SPELLS, "at the Mending House"), undefined, "nor the first word of a longer one");
  assert.equal(spellNamed(SPELLS, "Sergeant, who found him?"), undefined);
});

test("what the character does in a line: its brackets and asterisks, and what it narrates in the first person, but not what they think or say they'll do", () => {
  assert.deepEqual(deedsIn("Morning. (I tip my hat) *grins* I walk over to the butt. I think he jumped. I'll ask Kell."), ["I tip my hat", "grins", "I walk over to the butt."]);
});

test("every spell the rules know, read once from the engine's content", () => {
  const content = { spells: new Map(SPELLS.map(s => [s.id, { ...s }])) } as unknown as Parameters<typeof spellsOf>[0]["content"];
  const first = spellsOf({ content });
  assert.equal(first.length, SPELLS.length);
  assert.equal(spellsOf({ content }), first, "the same list each turn, so its pattern is made once");
});

test("the user's report (kingmaker-report-20261018-144627): a spell of the sheet's cast by its name in what the character does is a cast without asking; a name said aloud, a flourish or a glance isn't", () => {
  const named = (line: string, sheet = WIZARD) => castNamed(line, sheet.spells)?.id;
  const WREN = [...WIZARD.spells, { id: "thunderwave", name: "Thunderwave" }];
  assert.equal(castNamed("You'll never take me alive! (I cast thunderwave at the constables)", WREN)?.id, "thunderwave", "turn 13");
  assert.equal(named("(I cast a firebolt at the elm in rage)"), "fire-bolt", "turn 12, run together");
  assert.equal(named("(I cast sleep on the boy)"), "sleep", "turn 4: an everyday name straight after cast");
  assert.equal(named("I cast Magic Missile at the hoist rope."), "magic-missile", "narrated in the first person");
  assert.equal(named("*casting Light on my staff*"), "light");
  assert.equal(named("Right. So what did you two see? (I summon some fire to my fingertips)"), undefined, "turn 11: no spell named");
  assert.equal(named("Don't make me cast Sleep on you, boy."), undefined, "said aloud, not done");
  assert.equal(named("(I cast a glance at the Shield on the wall)"), undefined, "a glance");
  assert.equal(named("(I cast about for some light)"), undefined, "an everyday word, not after cast");
  assert.equal(named("(I cast Fire Bolt at the boy)", ROGUE), undefined, "not one of hers: the question decides");
});
