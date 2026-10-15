import { test } from "node:test";
import assert from "node:assert/strict";
import { markupOf, parseMarkup, speechIn, stripMarkup, withSpeakers, type Marked } from "./markup.ts";
import { namesFor, type Speaker } from "./speakers.ts";

const PEOPLE: Speaker[] = [
  { id: "crust", names: namesFor("Madam Crust", "the pie-seller") },
  { id: "kell", names: namesFor("Sergeant Agnes Kell") },
  { id: "dab", names: namesFor("Dab Wick", "the ferryman") },
];

/** The marked phrases of a parse, as they read. */
const phrases = (m: Marked) => m.marks.map(x => `${x.kind}:${m.text.slice(x.start, x.end)}`);
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

test("a note on a line of its own lights up its phrase where it already stands", () => {
  const m = parseMarkup("Dab won't take you across.\n\n(won't take you across)[why: The stairs carry their own, and you're nobody's.]");
  assert.equal(m.text, "Dab won't take you across.");
  assert.deepEqual(phrases(m), ["why:won't take you across"]);
  // Its phrase not in the reply: the words are shown, rather than lost.
  const n = parseMarkup("(The tide's turning)[know: Lightermen don't cast off on a turning tide.]\n\nDab spits.");
  assert.equal(n.text, "The tide's turning\n\nDab spits.");
  assert.deepEqual(phrases(n), ["know:The tide's turning"]);
});

test("words with no markup keep every character: their quotes are found, their brackets left alone", () => {
  const text = "(You cast Fireball.) Nan sighs [sic]. “Out,” she says.\n\n“Now.”";
  const speech = speechIn(text);
  assert.deepEqual(speech.map(s => text.slice(s.start, s.end)), ["“Out,”", "“Now.”"]);
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
];

test("as it streams, what's shown only grows, never shows markup, and agrees with the whole reply", () => {
  for (const raw of SAMPLES) {
    const whole = parseMarkup(raw);
    let shown = "";
    for (let cut = 0; cut <= raw.length; cut++) {
      const part = parseMarkup(raw.slice(0, cut), { final: false });
      assert.ok(part.text.trimEnd().startsWith(shown.trimEnd()), `shown text went back at ${cut}: ${JSON.stringify(shown)} -> ${JSON.stringify(part.text)}`);
      assert.ok(whole.text.startsWith(part.text.trimEnd()), `at ${cut} the stream showed ${JSON.stringify(part.text)}, not the start of ${JSON.stringify(whole.text)}`);
      assert.doesNotMatch(part.text, /\[(why|know|you|Kell|Dab|the pie-seller)\b|\]\(|\)\[/i, `markup shown at ${cut}`);
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
  // Someone the player knows only by sight, told by what they're called ("the boy in the too-big boots" is the scene's boy).
  const yard = [...PEOPLE, { id: "cob", names: namesFor("Cob", "the boy in the too-big boots") }];
  const o = withSpeakers(parseMarkup("A scrawny boy in enormous boots lobs a stone at the body. “Hold still!” [the boy] “Nearly got him.”"), yard);
  assert.deepEqual(o.speech.map(s => s.speaker), ["cob", "cob"]);
});

test("written back out, the markup reads the same", () => {
  for (const raw of SAMPLES.slice(0, 2)) {
    const m = withSpeakers(parseMarkup(raw), PEOPLE);
    const again = parseMarkup(markupOf(m, id => ({ crust: "Madam Crust", kell: "Kell", dab: "Dab" })[id]));
    assert.equal(again.text, m.text);
    assert.deepEqual(again.marks.map(x => [x.start, x.end, x.kind, x.note]), m.marks.map(x => [x.start, x.end, x.kind, x.note]));
    assert.deepEqual(again.speech.map(s => [s.start, s.end]), m.speech.map(s => [s.start, s.end]));
  }
});
