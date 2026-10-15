/**
 * Live check of character creation with the real model: three characters made as the screens make
 * them (the Game's creation: three builds offered from a concept, one chosen, a backstory, the lore
 * check, into the game), one with a backstory written by the player (it fits, so it goes through),
 * one drafted by the GM and taken (what in it doesn't fit, if anything, is caught and fixed), one
 * that contradicts canon and has its fixes accepted (then looked at again); then the clerk's yard
 * for each, where the GM is asked to use the backstory, and where Kell couldn't know it (a leading
 * "You'll remember me": nobody in the story had met them before it began). What
 * was offered, written, flagged and said is printed, and saved with the screens (the cards, the
 * draft, the lore check) and creation's model calls in creation-live/<stamp>/ under the runs directory.
 *
 *   KM_RUNS_DIR=runs/live-check node --experimental-ffi --no-warnings --import tsx src/app/smoke/creation-live.tsx
 *
 * Needs OPENROUTER_API_KEY (or ~/secrets/kingmaker-dev-openrouter.txt, which the game reads itself; it's never printed).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { registerLookCanvas } from "../../game/look/opentui.ts";
import { modelOffline, sessionSpend, setCallLog } from "../../llm/openrouter.ts";
import { playerDocPath, readDoc } from "../../lore/docs.ts";
import { cardText } from "../../rules/builds.ts";
import { effectiveScene, sceneBrief } from "../../runtime/brief.ts";
import { runsDir } from "../../runtime/session.ts";
import { sceneById } from "../../../scenes/index.ts";
import { Game, type Line } from "../game.ts";
import { BackstoryScreen, ChooseScreen } from "../ui/create.tsx";

process.env.KM_GLYPHS ??= "ascii";
registerLookCanvas();
if (modelOffline()) { console.error("This check needs the GM: OPENROUTER_API_KEY, or ~/secrets/kingmaker-dev-openrouter.txt."); process.exit(2); }
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
const OUT = join(runsDir(), "creation-live", stamp);
mkdirSync(OUT, { recursive: true });

const checks: Array<[string, boolean]> = [];
const report: string[] = [];
const say = (line = "") => { console.log(line); report.push(line); };
const note = (what: string, ok: boolean) => { checks.push([what, ok]); say(`${ok ? "ok" : "FAIL"}: ${what}`); };
const flat = (t: string) => t.replace(/\s+/g, " ").trim();
const settle = async (game: Game, ms = 240_000) => { const end = Date.now() + ms; while ((game.busy || game.live) && Date.now() < end) await new Promise(r => setTimeout(r, 250)); };
const replies = (lines: Line[]) => lines.filter(l => l.kind === "narration" || l.kind === "dialogue").map(l => `${l.name ? `${l.name}: ` : ""}${flat(l.text)}`);
/** What's said aloud in a reply: its quotations (the narration's “...”, and dialogue lines whole). */
const spoken = (lines: Line[]) => lines.flatMap(l => l.kind === "dialogue" ? [l.text] : l.kind === "narration" ? [...l.text.matchAll(/[“"]([^”"]+)[”"]/g)].map(m => m[1]!) : []).join(" ");
const secs = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)} s`;
/** Five words in a row said twice (a fix that ran on into the words after it), if there are any. */
const repeated = (t: string): string | undefined => {
  const w = t.toLowerCase().match(/[a-z']+/g) ?? [], seen = new Set<string>();
  for (let i = 0; i + 5 <= w.length; i++) { const k = w.slice(i, i + 5).join(" "); if (seen.has(k)) return k; seen.add(k); }
  return undefined;
};

/** A screen as the game draws it now, saved beside the report. */
async function screen(node: React.ReactNode, name: string): Promise<void> {
  const setup = await testRender(node, { width: 130, height: 42 });
  await act(async () => { await setup.renderOnce(); await new Promise(r => setTimeout(r, 50)); });
  await act(async () => { await setup.renderOnce(); });
  writeFileSync(join(OUT, `${name}.txt`), setup.captureCharFrame());
  await act(async () => { await setup.dispose(); });
}

/** The words a story has of its own, longer ones, that a reply could only have from it. */
const STOP = new Set("because before after always another anything everyone someone something nothing little people thought though through without within whatever whenever wouldn't couldn't shouldn't himself herself myself themselves enough rather really should would could which where there their these those other others every since until while still never again place years things never asked answer around caerwyn sergeant investigator".split(" "));
const ownWords = (story: string) => [...new Set(story.toLowerCase().match(/[a-z][a-z'’-]{5,}/g) ?? [])].map(w => w.replace(/['’]s$/, "")).filter(w => !STOP.has(w));

interface Turn {
  say: string;
  /** What the reply should show, from the backstory as it went into the game. */
  what: string;
  /** Words of the backstory's, and how many of them the reply has to use (not counting what the turn or the scene so far said). */
  uses?: { words: (story: string) => string[]; need: number };
  /** What nobody in the scene should say aloud: what they couldn't know, or what the lore check took out. */
  unsaid?: RegExp;
  /** Only to see: a roll decides what comes of it, so it isn't a pass or a fail. */
  soft?: boolean;
}

interface Case {
  name: string;
  concept: string;
  /** Which of the three to take (0-2). */
  take: number;
  backstory: { kind: "written"; text: string } | { kind: "drafted" } | { kind: "against canon"; text: string; flagged: RegExp; kept: RegExp[] };
  turns: Turn[];
}

const TELL = "(I tell her plainly where I come from, and why I said yes to the King.)";
const CASES: Case[] = [
  {
    name: "Mara Fenn", take: 0,
    concept: "a soft-spoken river-pilot's daughter who reads tides and people alike, and carries a boathook she isn't afraid to use",
    backstory: { kind: "written", text: "I grew up on the Saltmere reach, in my father's pilot-boat, learning which eddies drown men. When the spring flood took him and the boat, I came up the river to Caerwyn with nothing but his boathook and a debt to Widow Harrow, who paid for the burial.\n\nI took this case because the King's man said the pay was coin, not promises, and because I know what a body looks like when the river didn't put it there." },
    turns: [
      // A leading line: nobody in the story had met her before today, so Kell doesn't remember her (the GM yes-anded it into an old acquaintance, and once gave her Prout's visit to the watch house).
      { say: "Sergeant. You'll remember me, I expect.", what: "has Kell answer a claim of old acquaintance truthfully: she's never met her", unsaid: /\bI remember (you|your|the)\b|you came to (the|my) (watch|desk)|we've met|we met (before|last)|last time you|good to see you again|been a while/i },
      { say: `Sergeant, you should know who the King has lent you. ${TELL}`, what: "tells who Mara is from her backstory", uses: { words: () => ["Saltmere", "pilot", "father", "flood", "Harrow", "burial", "boathook", "eddies", "coin"], need: 2 } },
      { say: "(I crouch by the hoist and read Prout the way I was taught on the reach.)", what: "may read the body with her river-pilot's eye (a roll decides how well)", soft: true, uses: { words: () => ["water", "river", "drown", "pilot", "father", "eddies", "tide", "flood", "boathook", "Saltmere"], need: 1 } },
    ],
  },
  {
    name: "Brother Odo", take: 0,
    concept: "a large, gentle hedge-priest who settles arguments by sitting on them",
    backstory: { kind: "drafted" },
    turns: [
      { say: `(I lower myself onto the granary steps with a long sigh and fold my hands.) Sergeant, you'd better know who the King has lent you. ${TELL}`, what: "tells who Odo is from the drafted backstory", uses: { words: ownWords, need: 2 } },
    ],
  },
  {
    name: "Lucan Ashe", take: 1,
    concept: "a charming duellist with a court accent, a borrowed name and an unpaid tailor",
    backstory: { kind: "against canon", text: "I'm the King's nephew, though the court pretends otherwise, and Sergeant Kell is my aunt: she taught me to fence in the watch-house yard. I left the palace after a duel over a card game and have lived on credit and charm since. I owe my tailor, Master Fenwick, forty crowns.", flagged: /Kell|aunt/i, kept: [/Fenwick/, /forty crowns/i] },
    turns: [
      { say: "Sergeant. (I sweep a bow, all court manners.) You know who I am, I take it?", what: "has Kell not know him (she has never met him), and nobody says what she couldn't know", unsaid: /\baunt\b|nephew|showed you the gate|threw you out|Fenwick|forty crowns|card game|I know you[,.!]/i },
    ],
  },
];

const made: Array<{ c: Case; game: Game }> = [];
for (const c of CASES) {
  const short = c.name.split(" ")[0]!.toLowerCase();
  // Creation's calls come before there's a session to log them in: they go beside the report.
  setCallLog(join(OUT, "calls.jsonl"));
  say(`\n=== ${c.name}: ${c.concept} (${c.backstory.kind} backstory)`);
  const game = new Game();
  const t0 = Date.now();
  await game.offerBuilds(c.name, c.concept);
  const offer = game.creation?.offer;
  const options = offer?.options ?? [];
  note(`${c.name}: three builds offered by the model in ${secs(t0)}, three different classes, each made by the engine`, game.screen === "choose" && options.length === 3 && new Set(options.map(o => o.build.classId)).size === 3 && options.every(o => o.from === "model") && !offer?.note);
  if (offer?.note) say(`(${offer.note})`);
  options.forEach((o, i) => say(`${i + 1}. [${o.from}] ${cardText(o).replace(/\n/g, "\n   ")}`));
  await screen(<ChooseScreen game={game} />, `${short}-1-cards`);
  game.chooseBuild(c.take);
  say(`Taken: ${game.creation!.chosen!.line}`);

  if (c.backstory.kind === "drafted") {
    const t1 = Date.now();
    await game.draftStory();
    const draft = game.creation!.proposal?.text ?? "";
    note(`${c.name}: Draft one comes back in ${secs(t1)} as a draft to take or leave, not in the box (${draft.split(/\s+/).length} words)`, !!draft && game.creation!.story === "");
    await screen(<BackstoryScreen game={game} />, `${short}-2-draft`);
    say(`Drafted:\n${draft}`);
    game.takeProposal();
  } else {
    game.storyTyped(c.backstory.text);
    say(`Written:\n${game.creation!.story}`);
  }

  const before = game.creation!.story;
  const t2 = Date.now();
  await game.finishStory(game.creation!.story);
  const looks: string[][] = [];
  const quotes: string[] = [];
  // Each look's issues, the fixes accepted (the second look, after the fixes, is the game's own).
  for (let look = 0; game.creation?.issues?.length && look < 3; look++) {
    const issues = game.creation.issues;
    say(`The lore check${game.creation.again ? ", again, with the fixes in" : ""} (${secs(t2)}): ${issues.length} to fix`);
    await screen(<BackstoryScreen game={game} />, `${short}-3-lore-check-${look + 1}`);
    for (const [i, issue] of issues.entries()) say(`${i + 1}. Your story says: "${issue.quote ?? "?"}"\n   The world says: ${issue.problem}\n   A fix that keeps its spirit: "${issue.fix}"`);
    looks.push(issues.map(i => `${i.quote ?? ""} ${i.problem}`));
    quotes.push(...issues.flatMap(i => (i.quote ? [i.quote] : [])));
    if (c.backstory.kind === "written") break;
    while (game.creation?.issues === issues && game.creation.issue < issues.length) {
      const at = game.creation.issue;
      await game.acceptFix();
      if (game.creation?.issues === issues && game.creation.issue === at) break;
    }
    for (let i = 0; i < 240 && game.creation?.busy; i++) await new Promise(r => setTimeout(r, 250));
  }
  if (c.backstory.kind === "against canon") {
    const { flagged, kept } = c.backstory;
    note(`${c.name}: the lore check finds Kell as his aunt (she has never met him), with a fix (${looks.map(l => l.length).join(" then ")} to fix)`, !!looks[0]?.some(l => flagged.test(l)));
    for (let i = 0; i < 240 && game.screen !== "created"; i++) await new Promise(r => setTimeout(r, 250));
    const after = game.session?.player.backstory?.text ?? game.creation!.story;
    note(`${c.name}: with the fixes accepted (and the story checked once more), what didn't fit is gone and the rest kept (${kept.map(k => k.source).join(", ")})`, after !== before && !!game.creation?.again && quotes.every(q => !after.includes(q)) && !repeated(after) && kept.every(k => k.test(after)));
    say(`After the fixes:\n${after}`);
  } else if (c.backstory.kind === "drafted") {
    // The GM's own draft should fit; if it doesn't, the check is there to catch it, and its fixes are taken.
    note(`${c.name}: the lore check passes the GM's draft, or catches what in it doesn't fit, with a fix to take (${looks.length ? looks.map(l => l.length).join(" then ") : "nothing"} to fix)`,
      looks.length === 0 || (looks.length <= 2 && game.creation?.again === true));
    if (looks.length) say(`After the fixes:\n${game.session?.player.backstory?.text ?? game.creation!.story}`);
  } else {
    note(`${c.name}: the lore check lets a ${c.backstory.kind} backstory that fits the world through`, looks.length === 0);
    while (game.creation?.issues?.length) await game.acceptFix();
  }
  for (let i = 0; i < 240 && game.screen !== "created"; i++) await new Promise(r => setTimeout(r, 250));
  const player = game.session?.player;
  const b = player?.backstory;
  note(`${c.name}: into the game with the backstory and what it says of them`, game.screen === "created" && !!b?.summary && !!game.sheet?.story);
  say(`Who they are: ${b?.summary}`);
  say(`Personality: ${b?.personality.join("; ")}\nIdeals: ${b?.ideals.join("; ")}\nBonds: ${b?.bonds.join("; ")}\nFlaws: ${b?.flaws.join("; ")}`);
  const doc = player ? readDoc(game.core!.state.id, playerDocPath(player.name)) : undefined;
  note(`${c.name}: the whole backstory is the player's doc in the session's own lore, and every brief says who they are`,
    !!b && !!doc && doc.body.includes(b.text.slice(0, 40)) && sceneBrief(effectiveScene(sceneById("hanged-clerk"), []), game.session!, { docs: true }).includes(b.summary));
  made.push({ c, game });
}

// The clerk's yard for each, where Kell meets them.
for (const { c, game } of made) {
  say(`\n=== ${c.name} in the clerk's yard`);
  game.begin();
  await game.toLead();
  await settle(game);
  const opening = replies(game.lines);
  note(`${c.name}: the clerk's yard opens with the real GM`, (game.screen as string) === "scene" && opening.length > 0);
  say(`Opening: ${opening.join(" / ")}`);
  const story = game.session!.player.backstory!.text;
  let before = `${opening.join(" ")}`;
  for (const turn of c.turns) {
    const from = game.lines.length;
    await game.input(turn.say);
    await settle(game);
    const said = game.lines.slice(from);
    const answer = replies(said);
    say(`> ${turn.say}`);
    for (const r of answer) say(`  ${r}`);
    const reply = answer.join(" ").toLowerCase();
    const heard = `${before} ${turn.say}`.toLowerCase();
    const used = turn.uses ? turn.uses.words(story).filter(w => reply.includes(w.toLowerCase()) && !heard.includes(w.toLowerCase())) : [];
    const leaked = turn.unsaid?.exec(spoken(said))?.[0];
    const what = `${c.name}: the GM ${turn.what}${turn.uses ? ` (the backstory's own words: ${used.join(", ") || "none"})` : ""}${leaked ? ` (said aloud: "${leaked}")` : ""}`;
    const ok = answer.length > 0 && (!turn.uses || used.length >= turn.uses.need) && !leaked;
    if (turn.soft) say(`${ok ? "seen" : "not this time"}: ${what}`);
    else note(what, ok);
    before += ` ${answer.join(" ")}`;
  }
}

writeFileSync(join(OUT, "report.txt"), `${report.join("\n")}\n`);
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\nThe GM's bar tab for this check: $${sessionSpend().toFixed(3)}. Screens and the report in ${OUT}.`);
console.log(failed ? `FAIL: ${failed}` : "PASS");
process.exit(failed ? 1 : 0);
