// New: the zoo's sound board (docs/sound-design.md): every sound the game makes, by kind, each a line to play on its own: the menus, the dice, the story's moments, each spell in each element, blows by weapon and damage, the world's changes, a fight's, a range of voices saying a line, and the music in each mood (held until the board is left).
import { audition, sfx } from "./cues.ts";
import { MOODS, type Mood } from "./music.ts";
import type { Cue, Sfx } from "./patches.ts";
import { Talker } from "./talker.ts";
import { NARRATOR, PLAYER, voiceOf, type Speaker } from "./voices.ts";

/** A line of the board: what it plays, and what it is. */
export interface BoardLine { label: string; detail: string; play: () => void }

/** A kind of sound on the board, and its lines. */
export interface BoardKind { id: string; title: string; detail: string; lines: BoardLine[] }

const ELEMENTS = ["fire", "cold", "lightning", "thunder", "acid", "poison", "necrotic", "radiant", "force", "psychic"];

const MOOD_WORDS: Record<Mood, string> = {
  title: "the title and making a character: a harp and a recorder, D Dorian",
  town: "the town by day: a lute's oom-pah and a tune, G Mixolydian",
  night: "the town and its scenes by night: a drone, a harp, bells, A minor",
  scene: "a scene's talk: sparse and low, under the voices, A Dorian",
  between: "between scenes and a word with Kell: a harp and bells",
  fight: "a fight: a pumping bass, drums, a chip tune, E Phrygian",
  end: "The End: warm and wide, F Lydian",
};

/** A line Undertale's way: said in a voice, as the scene says a reply. */
const SAMPLE = "Noted. That's a theory, investigator. I can't arrest a theory.";
const talker = new Talker("board");

const play = (name: Sfx, more: Omit<Cue, "sfx"> = {}) => () => sfx(name, more);
const say = (voice: () => ReturnType<typeof voiceOf>) => () => { talker.quiet(); const v = voice(); talker.speak(SAMPLE, () => v); };
const someone = (who: Omit<Speaker, "key"> & { key?: string }) => () => voiceOf({ key: who.key ?? who.description ?? "someone", ...who });

/** The board, kind by kind. */
export function soundBoard(): BoardKind[] {
  return [
    { id: "menus", title: "The menus", detail: "a pick moving, chosen, backed out of, opened and closed, refused, a line sent, a page turned", lines: [
      { label: "Move", detail: "the pick moves", play: play("ui.move") },
      { label: "Choose", detail: "a line chosen", play: play("ui.choose") },
      { label: "Back", detail: "backed out of", play: play("ui.back") },
      { label: "Open", detail: "a menu opens", play: play("ui.open") },
      { label: "Close", detail: "a menu goes away", play: play("ui.close") },
      { label: "Refused", detail: "it can't be done now", play: play("ui.denied") },
      { label: "Send", detail: "a line said in a scene", play: play("ui.send") },
      { label: "Page", detail: "the sheet, the notebook, the help", play: play("ui.page") },
      { label: "Bump", detail: "walking into a wall on the map", play: play("ui.bump") },
    ] },
    { id: "voices", title: "The voices", detail: "a line said a blip a syllable, Undertale's way, in a range of voices", lines: [
      { label: "The narrator", detail: "the GM's narration: a soft tick", play: say(() => NARRATOR) },
      { label: "The player", detail: "when the GM has your character say something", play: say(() => PLAYER) },
      { label: "A woman", detail: "\"she\" in what's said of them", play: say(someone({ key: "kell", description: "a rain cape; she watches people's hands" })) },
      { label: "A man", detail: "\"he\" in what's said of them", play: say(someone({ key: "hobb", description: "he fills the doorway" })) },
      { label: "A child", detail: "the boy in the too-big boots", play: say(someone({ key: "cob", called: "the boy in the too-big boots" })) },
      { label: "An old one", detail: "old and grey-haired", play: say(someone({ key: "nan-quill", description: "an old woman, grey-haired" })) },
      { label: "Someone large", detail: "a big one's lower", play: say(someone({ key: "ogre", size: "large" })) },
      { label: "A dog", detail: "a growl in it", play: say(someone({ key: "dog", tags: ["dog"] })) },
      { label: "A bird", detail: "a chirp", play: say(someone({ key: "crow", tags: ["crow"] })) },
    ] },
    { id: "dice", title: "The dice", detail: "a roll, and how a check went", lines: [
      { label: "A roll", detail: "the dice thrown", play: play("dice.roll") },
      { label: "Two dice", detail: "a roll with advantage", play: play("dice.roll", { count: 2 }) },
      { label: "Success", detail: "a check made", play: play("dice.success") },
      { label: "Failure", detail: "a check missed", play: play("dice.failure") },
      { label: "A natural 20", detail: "or a critical hit", play: play("dice.crit") },
      { label: "A natural 1", detail: "wah wah", play: play("dice.fumble") },
    ] },
    { id: "story", title: "The story", detail: "a scene opening and ending, The End, someone noticing", lines: [
      { label: "A scene opens", detail: "a harp's run up", play: play("story.scene") },
      { label: "A scene ends", detail: "a chord rolled", play: play("story.ended") },
      { label: "The End", detail: "home at last", play: play("story.end") },
      { label: "Noticed", detail: "a \"!\" over someone's head", play: play("story.alert") },
    ] },
    ...(["spell.cast", "spell.bolt", "spell.hit", "spell.area"] as const).map((name, i) => ({
      id: name, title: ["Spells cast", "Spells in flight", "Spells landing", "Spells over an area"][i]!, detail: "in each element", lines: [
        ...ELEMENTS.map(element => ({ label: element[0]!.toUpperCase() + element.slice(1), detail: name, play: play(name, { element, ms: 400, size: 20, ...(element === "force" ? { count: 3 } : {}) }) })),
        { label: "No element", detail: "a spell that does no harm: a sparkle", play: play(name, { ms: 400, size: 20 }) },
      ],
    })),
    { id: "blows", title: "Blows", detail: "swings and shots, hits by their damage, misses, a parry, a fall", lines: [
      { label: "A blade swung", detail: "a sword, a dagger", play: play("blow.swing", { kind: "blade" }) },
      { label: "A club swung", detail: "something blunt", play: play("blow.swing", { kind: "blunt" }) },
      { label: "A bite", detail: "jaws", play: play("blow.swing", { kind: "bite" }) },
      { label: "A shove", detail: "a push", play: play("blow.swing", { kind: "shove" }) },
      { label: "A bow", detail: "the twang, and the arrow", play: play("blow.shot", { kind: "shortbow", ms: 350 }) },
      { label: "A throw", detail: "a stone, a knife", play: play("blow.shot", { kind: "dagger", ms: 350 }) },
      { label: "Slashing", detail: "a hit", play: play("blow.hit", { kind: "slashing" }) },
      { label: "Piercing", detail: "a hit", play: play("blow.hit", { kind: "piercing" }) },
      { label: "Bludgeoning", detail: "a hit", play: play("blow.hit", { kind: "bludgeoning" }) },
      { label: "A critical", detail: "a hit, with a crack and a ring", play: play("blow.hit", { kind: "slashing", critical: true }) },
      { label: "A miss", detail: "a whiff", play: play("blow.miss") },
      { label: "A parry", detail: "steel on steel", play: play("blow.parry") },
      { label: "A fall", detail: "someone goes down", play: play("blow.fall") },
      { label: "A step", detail: "a tile walked in a fight", play: play("blow.step") },
      { label: "Running off", detail: "someone flees", play: play("blow.flee") },
      { label: "Healing", detail: "hit points back", play: play("spell.heal") },
    ] },
    { id: "fight", title: "A fight", detail: "its start, the player's turn, won, lost", lines: [
      { label: "It starts", detail: "the order comes up", play: play("fight.start") },
      { label: "Your turn", detail: "the bar comes to you", play: play("fight.turn") },
      { label: "Won", detail: "the last of them down", play: play("fight.won") },
      { label: "Lost", detail: "you're down", play: play("fight.lost") },
    ] },
    { id: "world", title: "The world", detail: "what the director plays when the world changes", lines: [
      { label: "An explosion", detail: "a barrel of spirits", play: play("world.explosion", { size: 20 }) },
      { label: "Catching fire", detail: "something burns", play: play("world.ignite") },
      { label: "A splash", detail: "a spill, a bucket", play: play("world.splash") },
      { label: "Doused", detail: "water on a fire", play: play("world.douse") },
      { label: "Going out", detail: "steam", play: play("world.steam") },
      { label: "Breaking", detail: "something destroyed", play: play("world.debris") },
      { label: "A puff", detail: "someone comes or goes", play: play("world.poof") },
      { label: "Sparks", detail: "a spark, a flash", play: play("world.sparks") },
      { label: "Freezing", detail: "frost takes it", play: play("world.freeze") },
    ] },
    { id: "music", title: "The music", detail: "each mood, made as it plays (held until you leave the board; quiet goes back)", lines: [
      ...MOODS.map(mood => ({ label: mood[0]!.toUpperCase() + mood.slice(1), detail: MOOD_WORDS[mood], play: () => audition(mood) })),
      { label: "Quiet", detail: "no music", play: () => audition(null) },
    ] },
  ];
}

/** The board left: the music goes back to the screen's, and any line still being said stops. */
export function leaveBoard(): void {
  talker.quiet();
  audition(undefined);
}
