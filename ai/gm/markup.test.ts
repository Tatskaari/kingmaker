// Copied from the prototype's src/runtime/markup.test.ts at 44c6d4a, whole: the scenes come from the test story (fixtures.ts: the hanged clerk as campaigns/caerwyn has it, the Heron, the King's morning and the Rat as the prototype's tests had them), and a session is a TurnView. Since M2 a mark is only taken out of the words (the game keeps no notes), so markupOf writes back the speakers alone and its round trip keeps the words and who says them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneById, stateIn } from "./fixtures.ts";
import { speakersOf } from "./knowledge.ts";
import { markupOf, parseMarkup, speechIn, stripMarkup, withSpeakers, type Marked, type Parsed } from "./markup.ts";
import { speaker, type Speaker } from "./speakers.ts";
import type { TurnView } from "./view.ts";

const PEOPLE: Speaker[] = [
  speaker("crust", "Madam Crust", "the pie-seller"),
  speaker("kell", "Sergeant Agnes Kell"),
  speaker("dab", "Dab Wick", "the ferryman"),
];

/** The marked phrases of a parse, as they read. */
const phrases = (m: Parsed) => m.marks.map(x => `${x.kind}:${m.text.slice(x.start, x.end)}`);
const lines = (m: Marked) => m.speech.map(s => m.text.slice(s.start, s.end));

test("plain prose is left as it is, its quotes taken as spoken lines", () => {
  const m = parseMarkup("Kell sighs. “Fine.”\n\nThe rain comes on.");
  assert.equal(m.text, "Kell sighs. “Fine.”\n\nThe rain comes on.");
  assert.deepEqual(lines(m), ["“Fine.”"]);
  assert.equal(m.marks.length, 0);
  assert.equal(m.stats.quotes, 1);
  assert.equal(m.stats.tagged, 0);
});

test("a speaker's tag is hidden and names the line after it", () => {
  const m = parseMarkup("Kell folds her arms. [Kell] “On what evidence?”\n\n[the pie-seller]: “Threepence.”");
  assert.equal(m.text, "Kell folds her arms. “On what evidence?”\n\n“Threepence.”");
  assert.deepEqual(m.speech.map(s => s.tag), ["Kell", "the pie-seller"]);
  assert.deepEqual(lines(m), ["“On what evidence?”", "“Threepence.”"]);
  assert.equal(m.stats.tagged, 2);
});

test("a note on a phrase, in the sketch's order and in Markdown's", () => {
  const a = parseMarkup("She folds her arms: (she won't serve you)[why: You called her pies a disgrace in front of the queue.]. Next!");
  assert.equal(a.text, "She folds her arms: she won't serve you. Next!");
  assert.deepEqual(phrases(a), ["why:she won't serve you"]);
  assert.equal(a.marks[0]!.note, "You called her pies a disgrace in front of the queue.");
  const b = parseMarkup("Nan points at [the rules board](know: Every regular knows the Rat's seven rules by heart; most have broken one.) by the door.");
  assert.equal(b.text, "Nan points at the rules board by the door.");
  assert.deepEqual(phrases(b), ["know:the rules board"]);
  const c = parseMarkup("He remembers (the eel you kicked) [you: You booted his eel basket into the river on your way down.] and spits.");
  assert.equal(c.text, "He remembers the eel you kicked and spits.");
  assert.deepEqual(phrases(c), ["you:the eel you kicked"]);
});

test("a note inside a spoken line, and a line inside a marked phrase", () => {
  const m = parseMarkup("[Nan] “Not (in my house)[why: Rule two of the Rat: no blades out.], my duck.” She takes the knife.");
  assert.equal(m.text, "“Not in my house, my duck.” She takes the knife.");
  assert.deepEqual(lines(m), ["“Not in my house, my duck.”"]);
  assert.deepEqual(phrases(m), ["why:in my house"]);
  const n = parseMarkup("The ferryman spits. (“Not for the watch.”)[why: The stairs say the watch has never once come down them for a gentleman.]");
  assert.equal(n.text, "The ferryman spits. “Not for the watch.”");
  assert.deepEqual(lines(n), ["“Not for the watch.”"]);
  assert.deepEqual(phrases(n), ["why:“Not for the watch.”"]);
});

test("the prompt's own examples read as the prompt says", () => {
  const why = withSpeakers(parseMarkup("The pie-seller folds her arms. [the pie-seller] “(Not for you, my lamb.)[why: You called her pies a disgrace in front of the whole queue.]”"), PEOPLE);
  assert.equal(why.text, "The pie-seller folds her arms. “Not for you, my lamb.”");
  assert.deepEqual(phrases(why), ["why:Not for you, my lamb."]);
  assert.deepEqual(why.speech.map(s => s.speaker), ["crust"]);
  const know = parseMarkup("“Not before (the Assembly)[know: Every hundred years the kingdoms meet at one court.], it won't.”");
  assert.equal(know.text, "“Not before the Assembly, it won't.”");
  assert.deepEqual(phrases(know), ["know:the Assembly"]);
  const you = parseMarkup("The carter hasn't forgotten (the business with his cart)[you: You tipped his cart over to block the lane.].");
  assert.equal(you.text, "The carter hasn't forgotten the business with his cart.");
  assert.deepEqual(phrases(you), ["you:the business with his cart"]);
  const kell = withSpeakers(parseMarkup("[Kell] “Out.” She turns to the boy. [Kell] “You too.”"), PEOPLE);
  assert.deepEqual(kell.speech.map(s => s.speaker), ["kell", "kell"]);
});

test("brackets that are only brackets stay, and stray markup goes", () => {
  assert.equal(stripMarkup("(You cast Fireball.) The haystack goes up."), "(You cast Fireball.) The haystack goes up.");
  assert.equal(stripMarkup("A shrug (a small one) [and a sigh]."), "A shrug (a small one) and a sigh.");
  assert.equal(stripMarkup("Kell nods. [Kell] She turns to the boy."), "Kell nods. She turns to the boy.");
  assert.equal(stripMarkup("[why: Nobody saw this coming.] The bell rings."), "The bell rings.");
  assert.equal(stripMarkup("The price is [three pence]."), "The price is three pence.");
});

test("malformed notes fall back to plain words, never to markup", () => {
  const a = parseMarkup("She won't budge (on the price)[why: She's been robbed blind all week\nThe dog sighs.");
  assert.equal(a.text, "She won't budge on the price\nThe dog sighs.");
  assert.equal(a.marks.length, 0);
  assert.equal(a.stats.malformed, 1);
  // A note with no kind is taken as a reason.
  const b = parseMarkup("(The gate stays shut)[You walked out on the Captain's deal yesterday.]");
  assert.deepEqual(phrases(b), ["why:The gate stays shut"]);
  assert.equal(b.stats.unlabelled, 1);
  // The note written first, then its phrase.
  const c = parseMarkup("He bows [know: Kläggenheim bows from the waist, and expects the same.](from the waist).");
  assert.equal(c.text, "He bows from the waist.");
  assert.deepEqual(phrases(c), ["know:from the waist"]);
});

test("a marked sentence that lost its full stop gets it back, outside the mark", () => {
  const m = parseMarkup("(She takes your coins as if they hurt)[why: Your insult stung.] The dog watches the pie go.");
  assert.equal(m.text, "She takes your coins as if they hurt. The dog watches the pie go.");
  assert.deepEqual(phrases(m), ["why:She takes your coins as if they hurt"]);
  // Mid-sentence, or already stopped, it's left alone.
  assert.equal(stripMarkup("She (won't serve you)[why: Rude.] today."), "She won't serve you today.");
  assert.equal(stripMarkup("(She won't serve you.)[why: Rude.] Next!"), "She won't serve you. Next!");
});

test("a label after a finished sentence isn't shown: its note goes on the sentence it's about", () => {
  // As the model wrote them in the evals: a summary in brackets, not words of the reply.
  const m = parseMarkup("The goblins vanish into the hedges. Skrag's last curse trails after them.\n\nTam emerges. “They'll come back for her,” he says. (the goblins scatter)[why: Your threat and steady aim break their nerve.] The road goes quiet.");
  assert.equal(m.text, "The goblins vanish into the hedges. Skrag's last curse trails after them.\n\nTam emerges. “They'll come back for her,” he says. The road goes quiet.");
  assert.deepEqual(phrases(m), ["why:The goblins vanish into the hedges."]);
  // About nothing in the reply: dropped, words and all.
  const n = parseMarkup("“There!” (the kitchen door is too small)[know: The kitchen entrance can't take wagons.] “Show it the tree's safe.”");
  assert.equal(n.text, "“There!” “Show it the tree's safe.”");
  assert.equal(n.marks.length, 0);
  // A speech tag after a line is words of the reply, marked where it stands.
  const o = parseMarkup("“Fine.” (she says, not meaning it)[why: You haggled her down to tuppence.] Then she sighs.");
  assert.equal(o.text, "“Fine.” she says, not meaning it. Then she sighs.");
  assert.deepEqual(phrases(o), ["why:she says, not meaning it"]);
});

test("a note straight after a line, with no words of its own, is on the line; after a sentence, on the sentence", () => {
  // As the model wrote it in the zoo's ferry booth.
  const m = withSpeakers(parseMarkup("The ferryman looks up. [the ferryman] “No.” He lets it sit. [the ferryman] “Not you, now.”[why: You insulted the eel-wife on her own landing.] The eel-wife shakes the eel."), PEOPLE);
  assert.equal(m.text, "The ferryman looks up. “No.” He lets it sit. “Not you, now.” The eel-wife shakes the eel.");
  assert.deepEqual(phrases(m), ["why:“Not you, now.”"]);
  const n = parseMarkup("Dab keeps mending. He won't carry for the watch.[know: The river stairs leave the watch to its own business.] The river tugs.");
  assert.deepEqual(phrases(n), ["know:He won't carry for the watch."]);
  // Mid-sentence, it has nothing to hang on.
  assert.equal(parseMarkup("He looks [why: rude] at you.").marks.length, 0);
});

test("a note on a line of its own lights up its phrase where it already stands", () => {
  const m = parseMarkup("Dab won't take you across.\n\n(won't take you across)[why: The stairs carry their own, and you're nobody's.]");
  assert.equal(m.text, "Dab won't take you across.");
  assert.deepEqual(phrases(m), ["why:won't take you across"]);
  // Its phrase not in the reply: the words are shown, rather than lost.
  const n = parseMarkup("(The tide's turning)[know: Lightermen don't cast off on a turning tide.]\n\nDab spits.");
  assert.equal(n.text, "The tide's turning\n\nDab spits.");
  assert.deepEqual(phrases(n), ["know:The tide's turning"]);
});

test("both in square brackets, [phrase][kind: note]: words where they're written, or a label on words just said", () => {
  // As the model wrote them in whole scenes: the words had vanished, as a stray tag.
  const a = parseMarkup("At your demand, he lifts the chained [Warden’s Book][know: The toll house’s record of its rules.] from the counter.");
  assert.equal(a.text, "At your demand, he lifts the chained Warden’s Book from the counter.");
  assert.deepEqual(phrases(a), ["know:Warden’s Book"]);
  // Just after the words it's about: not shown again, the note on them where they stand.
  const b = withSpeakers(parseMarkup("[Tam Hollis] “As for Garrow, he’s a toll-house warden. [Garrow][know: A warden collects the King’s road tolls.] Sour as a plum left in the rain.”"), PEOPLE);
  assert.equal(b.text, "“As for Garrow, he’s a toll-house warden. Sour as a plum left in the rain.”");
  assert.deepEqual(phrases(b), ["know:Garrow"]);
  const c = parseMarkup("[Kell] “He kept the accounts in the tally loft.” [The tally loft][know: Where the palace’s grain accounts are kept.] “The Captain called it suicide.”");
  assert.equal(c.text, "“He kept the accounts in the tally loft.” “The Captain called it suicide.”");
  assert.deepEqual(phrases(c), ["know:the tally loft"]);
  // The same label in the other orders.
  assert.deepEqual(phrases(parseMarkup("“Up in the tally loft.” (The tally loft)[know: Where the accounts are kept.] Kell sniffs.")), ["know:the tally loft"]);
  assert.deepEqual(phrases(parseMarkup("“Up in the tally loft.” [The tally loft](know: Where the accounts are kept.) Kell sniffs.")), ["know:the tally loft"]);
  // Words said before, but carrying a new sentence on: shown where they're written.
  const d = parseMarkup("Kell says the Assembly is close. [The Assembly][know: Every hundred years the kingdoms meet.] waits for no one.");
  assert.equal(d.text, "Kell says the Assembly is close. The Assembly waits for no one.");
  assert.deepEqual(phrases(d), ["know:The Assembly"]);
  // A tag before a line is still a tag.
  assert.deepEqual(parseMarkup("[Kell] [Dab] “No.”").speech.map(x => x.tag), ["Dab"]);
});

test("a tag before a marked line, and notes in the wrong brackets, as the model wrote them in the ferry booth", () => {
  // The line had been lost, taken as a note on the tag in Markdown's order.
  const a = withSpeakers(parseMarkup("Dab looks up. [the ferryman] (“Not for the watch.”)[why: The stairs do nothing for the watch.] He spits."), PEOPLE);
  assert.equal(a.text, "Dab looks up. “Not for the watch.” He spits.");
  assert.deepEqual(phrases(a), ["why:“Not for the watch.”"]);
  assert.deepEqual(a.speech.map(s => s.speaker), ["dab"]);
  // A note in round brackets after a line, and in both kinds: on the line, never shown.
  const b = parseMarkup("[the pie-seller] “A yard, then, my duck.”(why: You apologised and paid her price.)\n\n[the pie-seller] “Peg’s my name.”[(know: Eels on the stairs are a penny a yard.)] She sniffs. He frowns (why: rude) at you.");
  assert.equal(b.text, "“A yard, then, my duck.”\n\n“Peg’s my name.” She sniffs. He frowns at you.");
  assert.deepEqual(phrases(b), ["why:“A yard, then, my duck.”", "know:“Peg’s my name.”"]);
  assert.equal(b.marks[1]!.note, "Eels on the stairs are a penny a yard.");
  // A tag after its line, at the end of the line of text: the line's.
  const t = withSpeakers(parseMarkup("Dab sighs. “She won’t speak for you.” [the ferryman]\n\nThe drover keeps walking. “Not my business.” [Kell] She turns."), PEOPLE);
  assert.equal(t.text, "Dab sighs. “She won’t speak for you.”\n\nThe drover keeps walking. “Not my business.” She turns.");
  assert.deepEqual(t.speech.map(s => s.tag), ["the ferryman", undefined]);
  // A marked phrase in square brackets: read without them.
  const c = parseMarkup("[Garrow] “The levy.” He sighs. [(Able, perhaps; willing is not a quality I can enter.)[why: The notice makes the levy voluntary.]] “So. One penny.”");
  assert.equal(c.text, "“The levy.” He sighs. Able, perhaps; willing is not a quality I can enter. “So. One penny.”");
  assert.deepEqual(phrases(c), ["why:Able, perhaps; willing is not a quality I can enter."]);
});

test("words with no markup keep every character: their quotes are found, their brackets left alone", () => {
  const text = "(You cast Fireball.) Nan sighs [sic]. “Out,” she says.\n\n“Now.”";
  const speech = speechIn(text);
  assert.deepEqual(speech.map(s => text.slice(s.start, s.end)), ["“Out,”", "“Now.”"]);
});

test("a tag that's its sentence's subject is its words, and Markdown's bold is read without its stars", () => {
  assert.equal(stripMarkup("“He keeps it hid.” [Kell] taps her pencil once."), "“He keeps it hid.” Kell taps her pencil once.");
  assert.equal(stripMarkup("“Not here.” **[Kell]**’s pencil stops."), "“Not here.” Kell’s pencil stops.");
  assert.equal(stripMarkup("The stone reads **CAERWYN — 7 MILES**. Kell sniffs."), "The stone reads CAERWYN — 7 MILES. Kell sniffs.");
  // A stray tag before a sentence of its own still goes.
  assert.equal(stripMarkup("Kell nods. [Kell] She turns."), "Kell nods. She turns.");
  // A bracket at a line's end is a bracket once the line ends, and stays one as the next line comes (a kind's label is read on the bracket's own line only).
  assert.equal(parseMarkup("She shrugs. [\n", { final: false }).text, "She shrugs. [\n");
  assert.equal(parseMarkup("She shrugs. [\nyou: the door is shut.", { final: false }).text, "She shrugs. [\nyou: the door is shut.");
});

test("a line that never closes ends with its paragraph", () => {
  const m = parseMarkup("[Kell] “Wait for me here.\n\nThe rain comes on.");
  assert.deepEqual(lines(m), ["“Wait for me here."]);
});

/** Replies with every kind of markup, for the streaming checks. */
const SAMPLES = [
  "Kell folds her arms. [Kell] “On what evidence?”\n\nThe pie-seller sniffs. [the pie-seller] “Threepence, my lamb, and (not a penny less)[why: You haggled her down at breakfast, and she's not having it twice.].”",
  "[Dab] “Across? (Not for you)[why: The stairs carry their own, and you're nobody's.].” He nods at [the river watch](know: The river watch walks the stairs in fours after dark, or not at all.). (You cast Light.) Nothing.\n\n(the eel)[you: You kicked her basket.]",
  "A shrug (a small one) [and a sigh]. [why: dropped] “Fine,” she says, “fine.” [Kell] “Is it?”",
  "The dog sighs [know: A dog of the stairs sighs for pie.](enormously).\n\n(enormously)[know: duplicate]",
  "“Unclosed quote, and (an unclosed note)[why: never closes\nNext line [Kell] “Hi.”",
  "He lifts the chained [Warden’s Book][know: The toll house’s record.] from the counter. [Garrow] “Mind the spine. The Book stays here.” [The Book] [know: It never leaves the counter.] He sniffs. [Nan][why: unclosed",
  "Dab looks up. [the ferryman] (“Not for the watch.”)[why: The stairs do nothing for the watch.] He spits. [the pie-seller] “A yard, then.”(why: You paid her price.)\n\n“Peg’s my name.”[(know: A penny a yard.)] He sighs. [(Able, perhaps.)[why: The notice says so.]] “So.” (why: never closes",
  // The tag inside the line's quotes, and the line's own quotes after it (the QA pass's barbarian, at the granary and the Rat).
  "Kell steps between you. “[Sergeant Kell] “No. He’s a child.”” The girl drops from the wall. “[the girl in the shawl] “Touch him again and I’ll make you regret having hands.”” Her fist stays tight.",
  "Kell opens her notebook again. “[Sergeant Agnes Kell] ‘Hobb. What’s on the string round your neck?’”\n\nHobb’s eyes flick to her. “[Dilly Sparrow] ‘Let him breathe, my lamb.’” She doesn’t move.",
];

test("as it streams, what's shown only grows, never shows markup, and agrees with the whole reply", () => {
  for (const raw of SAMPLES) {
    const whole = parseMarkup(raw);
    let shown = "";
    for (let cut = 0; cut <= raw.length; cut++) {
      const part = parseMarkup(raw.slice(0, cut), { final: false });
      assert.ok(part.text.trimEnd().startsWith(shown.trimEnd()), `shown text went back at ${cut}: ${JSON.stringify(shown)} -> ${JSON.stringify(part.text)}`);
      assert.ok(whole.text.startsWith(part.text.trimEnd()), `at ${cut} the stream showed ${JSON.stringify(part.text)}, not the start of ${JSON.stringify(whole.text)}`);
      assert.doesNotMatch(part.text, /\[(why|know|you|Kell|Dab|Garrow|Nan|the pie-seller|the ferryman)\b|\((why|know|you)\s*:|\]\(|\)\[|\]\s?\[|\[\(/i, `markup shown at ${cut}`);
      for (const m of part.marks) assert.ok(whole.marks.some(w => w.start === m.start && w.end === m.end && w.kind === m.kind && w.note === m.note), `a mark the whole reply hasn't at ${cut}`);
      shown = part.text;
    }
  }
});

test("streamed in pieces of any size, the end is the same as parsing it whole", () => {
  for (const raw of SAMPLES) {
    for (const size of [1, 3, 7, 20]) {
      let acc = "";
      let last = parseMarkup("", { final: false });
      for (let i = 0; i < raw.length; i += size) { acc += raw.slice(i, i + size); last = parseMarkup(acc, { final: false }); }
      const end = parseMarkup(acc);
      assert.deepEqual(end, parseMarkup(raw));
      assert.ok(end.text.startsWith(last.text.trimEnd()));
    }
  }
});

test("who says each line: the tag, a speech tag carrying on, or the prose", () => {
  const m = withSpeakers(parseMarkup("[Madam Crust] “Threepence,” she says, not looking up, “and not a penny less.”\n\n“Fourpence,” says the ferryman.\n\n[you] “Done.”\n\n[a passing gull] “Ark.”"), PEOPLE);
  assert.deepEqual(m.speech.map(s => s.speaker), ["crust", "crust", "dab", "you", undefined]);
  // A new sentence that isn't a speech tag doesn't carry the speaker on.
  const n = withSpeakers(parseMarkup("[Kell] “Out!” The boy flinches. “Me?”"), PEOPLE);
  assert.deepEqual(n.speech.map(s => s.speaker), ["kell", undefined]);
  // Someone only looked at between two lines isn't speaking: the one who was goes on.
  const looked = withSpeakers(parseMarkup("Kell speaks evenly. “I'm lent, not on duty.” Her gaze stays on the pie-seller. “I'm asking for a word.”\n\n[Madam Crust] “Forty still to go.” Her gaze settles on Kell. “The watch has questions?”"), PEOPLE);
  assert.deepEqual(looked.speech.map(s => s.speaker), ["kell", "kell", "crust", "crust"]);
  // A pause between two lines of one speaker, and a name said in the line before, don't change who's speaking.
  assert.deepEqual(withSpeakers(parseMarkup("[the ferryman] “No.” A beat. “Not for the watch.”"), PEOPLE).speech.map(s => s.speaker), ["dab", "dab"]);
  assert.deepEqual(withSpeakers(parseMarkup("[Kell] “Madam Crust had to tell you.” Her voice stays low. “I don't want trouble for her.”"), PEOPLE).speech.map(s => s.speaker), ["kell", "kell"]);
  // A tag that's only what someone is ("[Porter]", "[A porter]") isn't someone the player knows by it.
  const porters = [...PEOPLE, speaker("hobb", "Big Hobb Mallory", "the big porter with the bandaged hand")];
  assert.deepEqual(withSpeakers(parseMarkup("A porter turns toward the grille. [Porter] “Who's there?” [the big porter] “Me.”"), porters).speech.map(s => s.speaker), [undefined, "hobb"]);
  // Words quoted in narration aren't a line said, even the player's own echoed (QA round qa2-1018: they read as the player speaking mid-sentence).
  assert.deepEqual(withSpeakers(parseMarkup("At “the Purveyor's office,” her pencil stills. Kell mouths the word “trout”."), PEOPLE).speech, []);
  // Someone the player knows only by sight, told by what they're called ("the boy in the too-big boots" is the scene's boy).
  const yard = [...PEOPLE, speaker("cob", "Cob", "the boy in the too-big boots")];
  const o = withSpeakers(parseMarkup("A scrawny boy in enormous boots lobs a stone at the body. “Hold still!” [the boy] “Nearly got him.”"), yard);
  assert.deepEqual(o.speech.map(s => s.speaker), ["cob", "cob"]);
});

test("written back out, the markup reads the same: the words, and who says each line (a note taken out stays out)", () => {
  for (const raw of SAMPLES.slice(0, 2)) {
    const m = withSpeakers(parseMarkup(raw), PEOPLE);
    const again = parseMarkup(markupOf(m, id => ({ crust: "Madam Crust", kell: "Kell", dab: "Dab" })[id]));
    assert.equal(again.text, m.text);
    assert.deepEqual(again.marks, []);
    assert.deepEqual(again.speech.map(s => [s.start, s.end]), m.speech.map(s => [s.start, s.end]));
  }
});

// --- Who says what in whole scenes, as the QA pass's players saw it go wrong (their raw replies).

/** The people of a scene, as the screen finds speakers among them: those here, those away. */
function castOf(sceneId: string, extra: Partial<TurnView> = {}): Speaker[] {
  const scene = sceneById(sceneId);
  const state = stateIn(sceneId, {
    id: `markup-${sceneId}`, player: { name: "Wren Ashdown", concept: "a halfling thief", modifiers: {} },
    turn: 1, beat: scene.start, turnsInBeat: 1, ...extra,
  });
  return speakersOf(scene, state);
}
const speakers = (raw: string, people: Speaker[]) => withSpeakers(parseMarkup(raw), people).speech.map(s => s.speaker);

test("the tag inside a line's quotes, with the line's own quotes after it: the tag and one pair of quotes go", () => {
  const people = castOf("hanged-clerk");
  const a = withSpeakers(parseMarkup("A woman in a rain cape steps away from the open gate, notebook in hand. “[Sergeant Kell] “Sergeant Kell. The Captain’s view is suicide. Mine is that I haven’t looked yet, investigator.””\n\nA stone clangs off the hoist hook."), people);
  assert.equal(a.text, "A woman in a rain cape steps away from the open gate, notebook in hand. “Sergeant Kell. The Captain’s view is suicide. Mine is that I haven’t looked yet, investigator.”\n\nA stone clangs off the hoist hook.");
  assert.deepEqual(lines(a), ["“Sergeant Kell. The Captain’s view is suicide. Mine is that I haven’t looked yet, investigator.”"]);
  assert.deepEqual(a.speech.map(s => s.speaker), ["kell"]);
  // In single quotes inside the double ones: the line reads in double quotes, its apostrophes kept.
  const b = parseMarkup("Kell opens her notebook again. “[Sergeant Agnes Kell] ‘Hobb. What’s on the string round your neck?’”\n\nHobb’s eyes flick to her.");
  assert.equal(b.text, "Kell opens her notebook again. “Hobb. What’s on the string round your neck?”\n\nHobb’s eyes flick to her.");
  assert.deepEqual(b.speech.map(s => s.tag), ["Sergeant Agnes Kell"]);
  // No line is only a quote mark, with nobody's words in it.
  for (const raw of SAMPLES) { const m = parseMarkup(raw); for (const s of m.speech) assert.match(m.text.slice(s.start, s.end), /\p{L}/u); }
  assert.deepEqual(speechIn("He said ““No.”” and left.").map(s => s.end - s.start > 1), [true]);
});

test("a line is someone's who's here, by their name, their rank or what they are; someone away only by their name", () => {
  // The Heron, with Hobb in the cells: a porter the GM made up isn't him (the thief's T45).
  const heron = castOf("heron-warehouse", { absent: ["hobb"] });
  assert.deepEqual(speakers("The door opens just wide enough for a grain-white porter to look you over.\n\n[the porter] “Hobb’s hand, is it? You’re short for him.”", heron), [undefined]);
  // Someone away the narration brings in by what they're called is them (the wizard's T54).
  assert.deepEqual(speakers("In the open doorway, two bruisers crowd past the watchman. The gentleman behind them carries a silver-topped cane.\n\n[the gentleman] “Clerk. I trust the count is ready.”", heron), ["sallow"]);
  // "He calls": the watchman (the wizard's T47).
  assert.deepEqual(speakers("For a few seconds, the old watchman follows it down the wharf, lantern raised. Then your magic runs out.\n\nHe stops. “Eh? Who’s there?” he calls into the dark.", heron), ["saul"]);
  // The King is "the King" (the thief's T53 and T54, as written).
  const king = castOf("kings-morning");
  assert.deepEqual(speakers("The King looks at the inked initials again. “Then Master Sallow must answer for this—and for Wendell.” His gaze lifts to you. “What is to be done with the man?”", king), ["king", "king"]);
  assert.deepEqual(speakers("The King’s mouth opens, then closes.\n\n[King Aldren] “Garran, ask Master Sallow to step in.”\n\nHolt turns to the open door. A minute later, lavender precedes a pink, well-fed gentleman.\n\n[Master Sallow] “Majesty. I’m told there are concerns about the grain.”\n\nThe King keeps the true book open between his hands. “How fortunate. We have the figures here, too.” His teacup points at the ledgers. “Master Sallow, what does ‘lost to goblins’ mean in your accounts?”", king), ["king", "sallow", "king", "king"]);
  // Not the valets he sends away (the goals tester's g7), and "he" is the King (the wizard's opening).
  assert.deepEqual(speakers("The King dismisses the valets with a look and lifts his teacup. “Milk in first, one sugar, the cup warmed. Wendell was particular.” His eyes settle on you. “You’ll take it black, I think. What did you find, Investigator?”", [...king, speaker("valets", "the valets")]), ["king", "king"]);
  assert.deepEqual(speakers("The King’s cup stops halfway to his mouth.\n\nFor a moment, he looks not at the book but at the tea. “Milk first,” he says softly. “He would have been cross.”", king), ["king", "king"]);
  // Not the one who spoke last when "he" can't be them (Kell, in g15's T3), nor whoever a speech tag in the next paragraph names (g15's T1).
  assert.deepEqual(speakers("Kell lowers her eyes to the notebook. “I should have listened.”\n\nThe King’s teacup dips. For a moment he says nothing. Then he sets it carefully on the side table. “He wrote to me, too.”", king), ["kell", "king"]);
  assert.deepEqual(speakers("Kell opens her oilcloth notebook. “I can swear to that entry.” Her pencil rests against the page. “I cannot swear that Sallow killed him.”\n\nHolt snaps his watch shut. “The Purveyor’s party is in the gallery.”", king), ["kell", "kell", "holt"]);
});

test("who says a line untagged, as the narration says: its own attribution before the last speaker carried over", () => {
  const yard = castOf("hanged-clerk");
  // "…,” he blurts: Cob, not Kell, whose questions the sentence before was about (the barbarian's T2).
  assert.deepEqual(speakers("Cob’s fist thumps into your gut and bounces off. His next breath catches. The threat does what Kell’s quiet questions did not.\n\n“Cob was up there,” he blurts, white-faced. “In the loft. Last night.” His voice breaks.", yard), ["cob", "cob"]);
  // "Her eyes flick to Sergeant Kell’s notebook": the girl, not Kell (the robustness tester's rb-1m).
  assert.deepEqual(speakers("From the wall, the girl gives a short laugh. [Moll] “Careful, Cob. Bluebottles bring notebooks.” Her eyes flick to Sergeant Kell’s open notebook. “Though she’s let him off twice before.”", yard), ["moll", "moll"]);
  // "A woman in a rain cape": Kell, not the boy who spoke before her (rb-1b2's opening, untagged), and "[the woman]" is her too (g4).
  assert.deepEqual(speakers("Below, a scrawny boy in enormous black boots lobs gutter stones at the body. “Cob says he’s dead already!” From the wall, a sharp-faced girl swears at him.\n\nA woman in a rain cape steps away from the open gate, notebook in hand. “Sergeant Agnes Kell. The Captain calls it suicide.” Her eyes flick to the satchel by her boot. “I’m not writing either down yet, investigator.”", yard), ["cob", "kell", "kell"]);
  assert.deepEqual(speakers("A woman in a rain cape steps away from the gate. [the woman] “Sergeant Kell. The Captain calls it suicide.”", yard), ["kell"]);
  // A speech tag in the next paragraph isn't this line's: “Noted.” is Kell's, not the player's (rb-1m2's T4).
  assert.deepEqual(speakers("Kell’s pencil moves across her notebook.\n\n[Sergeant Agnes Kell] “Witness: a boy who says he was in the loft.” She looks up. “Noted.”\n\n“You said the boots stayed mine.” His hand closes around the left one.", yard), ["kell", "kell", undefined]);
  // At the Rat Cob is the pot-boy: "the boy" who stops at your crown, not Kell, who spoke before him (g10's T2).
  const rat = castOf("drowned-rat");
  assert.deepEqual(speakers("Kell turns to the landlady, leaving you to the boy. “I’m lent, not on duty.” Her pencil stays tucked in her notebook.\n\nThe boy stops at your silver crown. His eyes flick to the big man by the fire, then back to the coin. “A whole crown, eh? Cob could buy himself a horse.” He reaches for the silver. “Not out here. Not with the big cove looking.” His voice drops. “And what happens to Cob after?”", rat), ["kell", "cob", "cob", "cob"]);
  // Someone brought in that nobody can name isn't the last speaker carried over.
  assert.deepEqual(speakers("[Kell] “Out.” A porter shoves past with a sack. “Mind yourself.”", yard), ["kell", undefined]);
  // The sentence leading in starts after the line before it: Hobb's whisper is his, not Hep's, whose call came just before (QA round qa1-1018, g05's T6).
  assert.deepEqual(speakers("[Big Hobb Mallory] “Not yet, missus.” He glances toward the land door. “At the bell.” Across the floor Hep calls, [Hepzibah Grist] “Thirty-eight to the hatch! Keep those seams shut!” Hobb lowers his voice further. “When he comes, don’t let him see me looking at you.”", castOf("heron-warehouse")), ["hobb", "hobb", "hep", "hobb"]);
});

test("who says a line, on QA round qa2-1018's own replies: the big man by what he's called, a quote inside a sentence nobody's, and a tag naming a stranger theirs", () => {
  const rat = castOf("drowned-rat");
  // "The big man’s shoulders tighten." leads into his refusal (g04's T2, untagged as written; T6 the same).
  assert.deepEqual(speakers("The landlady follows your glance to the fireside corner, where the biggest man keeps his face lowered over his pot. “Poorly’s a measure I don’t sell, my duck. He’s champion eleven years. Ask him.” The old bargewoman’s cards whisper over the table. The young lighterman by the door taps his elbow down and grins. “Third challenge, Hobb. You can’t duck me all night.” The big man’s shoulders tighten. “Not tonight, Arlo.”", rat), ["nan-quill", "arlo", "hobb"]);
  assert.deepEqual(speakers("Before the old bargewoman can deal again, the young lighterman plants his elbow on Hobb’s table. [Arlo Quarry] “Come on, Hobb. Third time. House says the chair goes if you refuse.” The room quiets around the challenge. The big man stares into his pot. “Not tonight, Arlo.”", rat), ["arlo", "hobb"]);
  // "…,” the big man says": his, not Arlo's, whom the sentence before was about (g07's T2).
  assert.deepEqual(speakers("The landlady’s gaze settles on the coin. [the landlady] “Wagers paid at the bar, my duck. And the champion decides whether he plays.” The lighterman plants his elbow on the table, still looking toward the corner. “Not tonight, Arlo,” the big man says, quietly. The room waits to see whether you leave the wager standing.", rat), ["nan-quill", "hobb"]);
  assert.deepEqual(speakers("[the big man] “Not tonight.”", rat), ["hobb"], "a tag that's what he's called, two words");
  // Someone else's tag, whoever they are: not the lead-in's subject's, nor the last speaker's.
  assert.deepEqual(speakers("[Arlo Quarry] “Third time.” The lighterman grins at the corner. “Not tonight, Arlo,” a porter says.", rat), ["arlo", undefined]);
  assert.deepEqual(speakers("Hobb raises the brass heron token to the grille. From within, a voice asks, “Who’s the clerk?”", rat), [undefined]);
  // At “granary rope,” his face drains: the player's words quoted in a sentence aren't a line, the player's or anyone's (g04's T7).
  const t7 = withSpeakers(parseMarkup("His eyes rise to yours, then flick toward the closed door. At “granary rope,” his face drains of colour. [Big Hobb Mallory] “Sir.” His voice is low and careful. “I don’t want to hang.” He looks down at the table. “I only held him. I only held the rope.”"), rat);
  assert.deepEqual(t7.speech.map(s => [t7.text.slice(s.start, s.end), s.speaker]), [["“Sir.”", "hobb"], ["“I don’t want to hang.”", "hobb"], ["“I only held him. I only held the rope.”", "hobb"]]);
  // A sentence about the mastiff at his boots goes on about him: the watchman's line, not nobody's (g03's T1).
  assert.deepEqual(speakers("Kell gives one short nod and stays by the door, whistle ready. The old watchman squints at the brass token, then turns his right ear toward you. At his boots, the mastiff opens one eye and sniffs. “Hobb sent you, you say?” He glances at the dog. “She says you smell of river and trouble.”", castOf("heron-warehouse")), ["saul", "saul"]);
});

test("words written and read aren't anyone's line", () => {
  const yard = castOf("hanged-clerk");
  const page = withSpeakers(parseMarkup("The page lists a dozen grain wagons for the King’s Road, each marked “lost to goblins,” each countersigned “J. Sallow, for the Royal Purveyor.” At the bottom, in pencil: “Not goblins. Who pays the hedge-folk?”\n\nKell reads over your shoulder. “I should have listened.”"), yard);
  assert.deepEqual(page.speech.map(s => [page.text.slice(s.start, s.end), s.speaker]), [["“I should have listened.”", "kell"]]);
  const ledger = withSpeakers(parseMarkup("The ledger opens onto close columns of figures: each “lost” King’s Road wagon listed by its number. At the foot of the monthly entries: “Hedge-folk, the usual: forty heron pennies.” Every entry bears the countersignature “J. Sallow, for the Royal Purveyor.”"), yard);
  assert.deepEqual(ledger.speech, []);
  // A crowd's shout the narration goes on with isn't a line said.
  assert.deepEqual(withSpeakers(parseMarkup("Then he looks toward the window, where “Lost to goblins!” rises from the crowd."), castOf("kings-morning")).speech, []);
});
