/**
 * Records the prototype's GM calls for the AI service's prompt parity test: V0's (v0-design §10.2,
 * gm-port §16.1) and V5's (v5-design §4.2), on the hanged clerk.
 *
 *   node --no-warnings tools/record-golden.mts [--proto <a checkout of the prototype>] [--out <dir>] [--scenes <dir>]
 *
 * --proto is the repo this script is in when absent (its src/ is the prototype), --out is that
 * repo's v2/ai/gm/golden/hanged-clerk, and --scenes its v2/ai/gm/testdata/scenes. To record from
 * another commit, check it out in a worktree and name it with --proto.
 *
 * It plays the hanged clerk on the prototype under its stand-in for OpenRouter (fakeOpenRouter, so
 * no model is asked and nothing leaves the machine), with suggested lines on: createSession (the
 * wizard pregen's build, no backstory) and openScene, then three playerTurns: a plain question to
 * Kell; catch-moll, the decider's attempt scripted; and an out-of-character question. The GM's
 * replies are tools/v2/golden-replies.json's (marked up: speaker tags, a why, a you, a know), and
 * each moment's stand-in is told the notes the notes' writer writes and the lines the suggester
 * suggests, and that the judge finds the second line it's asked about gives away what's held.
 *
 * It wraps the stand-in's fetch to keep every call's body with a copy of the session as it stood,
 * names each call by its operation from the prototype's own call log, and writes:
 * - a file per step (the opening, and each turn's decide, reply and settle): the session at the
 *   step's first call and every call the step made, and for the opening and the replies, who says
 *   each line as the reply streams in a word at a time and once it's whole;
 * - for each moment, the notes on its reply and the lines suggested after it, each from the session
 *   frozen at its call: the prototype's writeNotes, knowledgeCard, propose and vetting run again on
 *   that copy under a fresh stand-in told the same, so the judge is asked on the state the lines were
 *   asked on (in the game it's asked after an await, while the turn moves on);
 * - the prototype's own scenes that v2/ai's copied tests play (testdata/scenes), as authored.
 *
 * It reads the prototype and imports it at run time; it writes only under --out, --scenes and a
 * temporary folder (the prototype's runs, call log and cost ledger go there: KM_RUNS_DIR,
 * KM_CALL_LOG, KM_COST_LEDGER). It lives with the prototype's tools, which may reach into v2; v2
 * never imports it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(import.meta.dirname, "..");
const arg = (name: string, otherwise: string) => { const i = process.argv.indexOf(name); return resolve(i < 0 ? otherwise : process.argv[i + 1] ?? otherwise); };
const PROTO = arg("--proto", REPO);
const OUT = arg("--out", join(REPO, "v2", "ai", "gm", "golden", "hanged-clerk"));
const SCENES_OUT = arg("--scenes", join(REPO, "v2", "ai", "gm", "testdata", "scenes"));
const REPLIES = (JSON.parse(readFileSync(join(REPO, "tools", "v2", "golden-replies.json"), "utf8")) as { replies: Array<{ moment: string; text: string }> }).replies;

// The prototype's run output, somewhere that isn't the repo; set before its modules load (they read these as they load).
const runs = mkdtempSync(join(tmpdir(), "km-golden-"));
process.env.KM_RUNS_DIR = runs;
process.env.KM_CALL_LOG = join(runs, "calls.jsonl");
process.env.KM_COST_LEDGER = join(runs, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "sk-or-golden-recording-no-model";
delete process.env.KM_PROMPTS_DIR;
process.chdir(runs);

const proto = (path: string) => import(pathToFileURL(join(PROTO, path)).href);
const { createSession, openScene, playerTurn } = await proto("src/runtime/engine.ts");
const { fakeOpenRouter } = await proto("src/llm/fake-openrouter.ts");
const { PREGENS } = await proto("src/game/combat/pregen.ts");
const { knownToAll, writeNotes } = await proto("src/runtime/notes.ts");
const { propose, suggested, vetting } = await proto("src/runtime/suggest.ts");
const { knowledgeCard, speakersOf } = await proto("src/runtime/knowledge.ts");
const { parseMarkup, withSpeakers } = await proto("src/runtime/markup.ts");
const { readReply } = await proto("src/runtime/voices.ts");
const { effectiveScene } = await proto("src/runtime/brief.ts");
const { sceneById, SCENES, ZOO_SCENES } = await proto("scenes/index.ts");

/** The stand-in's options for a moment, as fakeOpenRouter takes them. */
interface Fake { replies: string[]; choices: Record<string, string>; byName: { notes: { notes: Written[] } }; suggestions: string }
/** A note as the notes' writer gives it (the prototype's notes.ts Written). */
interface Written { on: string; words: string; kind: "why" | "know" | "you"; note: string; turn: number; lore: string }

/** The judge finds the second line it's asked about gives away what's held, at every moment. */
const JUDGE = { line_2: "gives_away" };

/**
 * What the script plays: the player, and each moment's line, the GM's reply, the decider's scripted
 * choices, the notes the writer writes and the lines the suggester suggests. Between them the notes
 * land on a mark of the GM's (M1), on spoken lines (L…) and on words of the reply, with a know from a
 * lore doc (written "@<its path>" here, its D id in that call when the moment's played), a you on
 * the player's turn, and notes that don't land (a you on nothing the player did, a know with no
 * doc); each set of lines has a name from the Rat (unheard: the vocabulary's), a way out (too
 * early), a line in the GM's markup, and lines that fit.
 */
const PLAYER = "Wren Ashdown: a hedge wizard from the fens, with more questions than answers";
const MOMENTS: Array<{ step: string; line?: string; fake: Fake }> = [
  { step: "open", fake: {
    replies: [reply("open")], choices: { ...JUDGE },
    byName: { notes: { notes: [
      { on: "L1", words: "Cob’s warming up", kind: "why", note: "Moll has been jeering at him from the wall, so he throws harder.", turn: 0, lore: "" },
      { on: "", words: "Behind the King’s Granary", kind: "know", note: "The granary yard is where the city's grain is counted before the palace takes its share.", turn: 0, lore: "@Places/Granary Yard.md" },
      { on: "L2", words: "I haven’t written that down", kind: "you", note: "You were too late to see him cut down.", turn: 0, lore: "" },
    ] } },
    suggestions: ["say: Is Hobb the one who found him?", "leave: (I leave Kell to her notebook and walk off)", "say: [you] “Who found him?”", "say: Sergeant, who found him?", "do: (I look up at the shut loft door)", "try: (I try to coax the boy down off his stones with a penny)"].join("\n"),
  } },
  { step: "t1", line: "Sergeant, who found him?", fake: {
    replies: [reply("t1")], choices: { ...JUDGE },
    byName: { notes: { notes: [
      { on: "M1", words: "", kind: "why", note: "He calls the watch bluebottles, and Sergeant Kell is the watch.", turn: 0, lore: "" },
      { on: "L5", words: "", kind: "why", note: "Moll wants it to be a jump, and says so before anyone asks her.", turn: 0, lore: "" },
      { on: "", words: "The sky is still a flat grey", kind: "know", note: "It rained all night.", turn: 0, lore: "" },
    ] } },
    suggestions: ["say: Hobb, was it you who carried him up?", "leave: (I tip my hat and leave the yard)", "do: (I wave the boy over) [Cob]", "say: Who was on the wall last night?", "do: (I look closely at the hoist)", "try: (I try to read the girl's face while she talks)"].join("\n"),
  } },
  { step: "t2", line: "Moll, you say you saw him jump. From that wall you'd have had your back to the hoist. What did you really see?", fake: {
    replies: [reply("t2")], choices: { attempt: "catch-moll", ...JUDGE },
    byName: { notes: { notes: [
      { on: "M1", words: "Moll’s smirk thins at your question", kind: "you", note: "You told her that from the wall she’d have had her back to the hoist.", turn: 2, lore: "" },
      { on: "L2", words: "The rest is not yet stated", kind: "why", note: "Kell writes down only what a witness says, word for word.", turn: 0, lore: "" },
      { on: "", words: "Her pencil pauses", kind: "you", note: "You once broke a pencil of hers.", turn: 0, lore: "" },
    ] } },
    suggestions: ["say: Does Hobb owe you money, Moll?", "leave: (I leave the yard to the pigeons)", "say: [Moll] “Fine.”", "say: Moll, what did you see at midnight?", "do: (I look up at the hoist beam)", "try: (I try to catch the boy's eye without Moll seeing)"].join("\n"),
  } },
  { step: "t3", line: "(Out of character: what can I actually do here?)", fake: {
    replies: [reply("t3")], choices: { ooc: "out_of_character", ...JUDGE },
    byName: { notes: { notes: [
      { on: "M1", words: "", kind: "know", note: "The office buys everything the palace eats and burns, by the King’s old right.", turn: 0, lore: "@World/Royal Purveyor's Office.md" },
      { on: "", words: "Kell waits, pencil poised", kind: "why", note: "She writes down whatever you decide to do next.", turn: 0, lore: "" },
      { on: "", words: "rumbles past the gate", kind: "know", note: "Wagons go past the granary all day.", turn: 0, lore: "" },
    ] } },
    suggestions: ["say: Where does Hobb drink?", "leave: (I head out of the gate after the wagon)", "say: [you] “Fine.”", "say: Sergeant, whose wagon was that?", "do: (I go and look at the barred loft door)", "try: (I try to get up to the loft door without anyone stopping me)"].join("\n"),
  } },
];

function reply(moment: string): string {
  const found = REPLIES.find(r => r.moment === moment);
  if (!found) throw new Error(`tools/v2/golden-replies.json has no reply for ${moment}`);
  return found.text;
}

/** Every call the stand-in answers: the step it's in, its body, and the session as it stood (and, for a notes or a suggest call, the whole of it, to run again). */
interface Recorded { step: string; url: string; body: Record<string, unknown>; session: unknown; frozen?: Session }
type Session = Record<string, unknown> & { sceneId: string; patches: unknown[]; transcript: Array<{ kind: string; turn: number; text: string; marked?: { speech: unknown[] } }>; suggestions?: { scene: string; lines: Array<{ text: string }> } };
const recorded: Recorded[] = [];
let session: Session | undefined;
let step = "open";

/** The stand-in for this step, its fetch wrapped to keep each call with the session as it stood. */
function standIn(options: Fake): () => void {
  const fake = fakeOpenRouter(options);
  const answer = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> & { text?: { format?: { name?: string } }; instructions?: string };
    const frozen = body.text?.format?.name === "notes" || suggesting(body) ? structuredClone(session) : undefined;
    recorded.push({ step, url, body, session: snapshot(), ...(frozen ? { frozen } : {}) });
    return answer(input, init);
  };
  return () => fake.restore();
}

const suggesting = (body: { instructions?: string }) => !!body.instructions?.startsWith("You suggest what the player might");

/**
 * The session now, as the parity test reads it: the rules engine's own state (a serialised campaign,
 * 10 KB) left out, and the timings no prompt shows and every recording changes: the turns'
 * (metrics), and how long the last lines took to suggest.
 */
function snapshot(of: unknown = session): unknown {
  const copy = structuredClone(of) as { rules?: Record<string, unknown>; metrics?: unknown; suggestions?: { ms?: number } };
  if (copy.rules) delete copy.rules.campaign;
  delete copy.metrics;
  delete copy.suggestions?.ms;
  return copy;
}

// The opening, then three turns, each moment on its own stand-in; the lines suggested after each are in before the next.
const notesFiles: unknown[] = [];
const suggestFiles: unknown[] = [];
for (const moment of MOMENTS) {
  step = moment.step;
  session ??= await createSession({ sceneId: "hanged-clerk", approach: "v2", player: PLAYER, level: 3, seed: 1234, id: "golden-hanged-clerk", build: PREGENS.wizard.build }) as Session;
  withLoreIds(moment.fake, session);
  const done = standIn(moment.fake);
  if (moment.step === "open") await openScene(session, {}, { suggest: true });
  else await playerTurn(session, moment.line, {}, { suggest: true });
  await suggested(session!);
  done();
  notesFiles.push(...await notesAgain(moment));
  suggestFiles.push(...await linesAgain(moment));
}

const calls = nameCalls(recorded);
writeSteps(calls);
writeMoments(notesFiles, suggestFiles);
writeScenes();
rmSync(runs, { recursive: true, force: true });

// ---------------------------------------------------------------------------------------------
// The notes and the lines, again on the session frozen at their calls.

/**
 * A note's lore written by its doc's path ("@World/Royal Purveyor's Office.md"), as its D id in what
 * the writer will be sent at this moment: the refs knownToAll gives now, before the moment, which its
 * line doesn't change (it names nobody new).
 */
function withLoreIds(fake: Fake, state: Session): void {
  const scene = effectiveScene(sceneById(state.sceneId), state.patches);
  const refs = knownToAll(scene, state).refs as Array<{ id: string; path: string }>;
  for (const note of fake.byName.notes.notes.filter(n => n.lore.startsWith("@"))) {
    const ref = refs.find(r => r.path === note.lore.slice(1));
    if (!ref) throw new Error(`${note.lore.slice(1)} isn't a doc the notes' writer is given here`);
    note.lore = ref.id;
  }
}

/** What a fresh stand-in told a moment's options is sent while `run` runs. */
async function sentWhile<T>(options: Fake, run: () => Promise<T>): Promise<{ result: T; sent: Array<Record<string, unknown>> }> {
  const fake = fakeOpenRouter(options);
  try {
    const result = await run();
    return { result, sent: fake.sent as Array<Record<string, unknown>> };
  } finally {
    fake.restore();
  }
}

/** The moment's notes call, again: the reply (its words, who says each line, the GM's marks as it wrote them), what the writer was sent, the marks placed and linked, and each link's card. */
async function notesAgain(moment: (typeof MOMENTS)[number]) {
  const frozen = recorded.filter(r => r.step === moment.step && r.frozen && (r.body.text as { format?: { name?: string } } | undefined)?.format?.name === "notes");
  return Promise.all(frozen.map(async call => {
    const state = call.frozen!;
    const scene = effectiveScene(sceneById(state.sceneId), state.patches);
    const at = state.transcript.length - 1;
    const entry = state.transcript[at]!;
    const read = readReply(scene, state, moment.fake.replies[0]!) as { text: string; marked: { speech: unknown[] }; drafted: unknown[] };
    if (read.text !== entry.text || JSON.stringify(read.marked.speech) !== JSON.stringify(entry.marked?.speech)) throw new Error(`${moment.step}: the reply read again isn't the entry the notes were written on`);
    const reply = { text: entry.text, speech: entry.marked!.speech, drafted: read.drafted };
    const { result, sent } = await sentWhile(moment.fake, () => writeNotes(scene, state, reply, state.transcript.slice(0, at)) as Promise<{ marks: Array<{ link?: unknown }> }>);
    if (JSON.stringify(sent[0]) !== JSON.stringify(call.body)) throw new Error(`${moment.step}: the notes call made again isn't the game's`);
    const cards = result.marks.map(m => (m.link ? knowledgeCard(state, m.link) ?? null : null));
    return { file: `${moment.step}.notes.json`, moment: moment.step, fake: moment.fake, session: snapshot(state), reply: { at, ...reply }, body: sent[0], marks: result.marks, cards };
  }));
}

/** The moment's suggest call, again: what was offered last, both calls' bodies (the lines, the judge), every field of the vetting, and the lines and what was dropped and why. */
async function linesAgain(moment: (typeof MOMENTS)[number]) {
  const frozen = recorded.filter(r => r.step === moment.step && r.frozen && suggesting(r.body as { instructions?: string }));
  return Promise.all(frozen.map(async call => {
    const state = call.frozen!;
    const scene = effectiveScene(sceneById(state.sceneId), state.patches);
    const { result, sent } = await sentWhile(moment.fake, () => propose(state) as Promise<{ lines: unknown[]; dropped: unknown[] }>);
    const asked = sent.find(suggesting);
    if (JSON.stringify(asked) !== JSON.stringify(call.body)) throw new Error(`${moment.step}: the suggest call made again isn't the game's`);
    const judged = sent.find(b => !!(b.questions as Record<string, unknown> | undefined)?.line_1);
    const offered = state.suggestions?.scene === state.sceneId ? state.suggestions.lines.map(l => l.text) : [];
    return { file: `${moment.step}.suggest.json`, moment: moment.step, fake: moment.fake, session: snapshot(state), offered, bodies: { suggest: asked, ...(judged ? { judge: judged } : {}) }, vetting: vetting(scene, state), lines: result.lines, dropped: result.dropped };
  }));
}

// ---------------------------------------------------------------------------------------------

/** Each call's operation, from the prototype's own call log: a decision by its whole request, a reply by its instructions and input. */
function nameCalls(calls: Recorded[]): Array<Recorded & { operation: string }> {
  const log = readFileSync(join(runs, "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l) as { operation: string; request?: { instructions?: string; input?: unknown } & Record<string, unknown>; text?: string; answers?: unknown });
  const done = log.filter(e => e.request && (e.text !== undefined || e.answers !== undefined));
  const used = new Set<number>();
  return calls.map(call => {
    const same = (e: (typeof done)[number]) => call.url.endsWith("/decisions")
      ? JSON.stringify(e.request) === JSON.stringify(call.body)
      : e.request!.instructions === call.body.instructions && JSON.stringify(e.request!.input) === JSON.stringify(call.body.input);
    const at = done.findIndex((e, i) => !used.has(i) && same(e));
    if (at < 0) throw new Error(`a call to ${call.url} in ${call.step} isn't in the call log`);
    used.add(at);
    return { ...call, operation: done[at]!.operation };
  });
}

/**
 * One file per step: the opening, and each turn's decide (disclosure and the director's before),
 * reply and settle (the stage manager and the director's after). The opening's and each reply's
 * file has who says each line as it streams, a word at a time, and once it's whole. The notes and
 * the lines are the moments' own files.
 */
function writeSteps(calls: Array<Recorded & { operation: string }>): void {
  const stepOf = (c: { step: string; operation: string }) => /^(notes|scene\.suggest)/.test(c.operation) ? undefined
    : c.step === "open" ? "open"
    : /^(memory\.disclose|director\.(before|ooc))/.test(c.operation) ? `${c.step}-decide`
    : /^gm\./.test(c.operation) ? `${c.step}-reply`
    : /^(world\.stage|director\.after)$/.test(c.operation) ? `${c.step}-settle`
    : undefined;
  mkdirSync(OUT, { recursive: true });
  const steps = new Map<string, Array<Recorded & { operation: string }>>();
  for (const c of calls) {
    const name = stepOf(c);
    if (name) steps.set(name, [...(steps.get(name) ?? []), c]);
  }
  for (const [i, [name, list]] of [...steps].entries()) {
    const moment = MOMENTS.find(m => m.step === name.split("-")[0])!;
    const gm = list.find(c => /^gm\./.test(c.operation));
    const file = { step: name, ...(moment.line ? { line: moment.line } : {}), fake: moment.fake, session: list[0]!.session, calls: list.map(c => ({ operation: c.operation, body: c.body })), ...(gm ? { speakers: speakersAsWritten(gm.session as Session, moment.fake.replies[0]!) } : {}) };
    writeFileSync(join(OUT, `${String(i).padStart(2, "0")}-${name}.json`), JSON.stringify(file, null, 1) + "\n");
  }
  console.log(`${calls.length} calls, ${steps.size} steps written to ${OUT}: ${[...steps].map(([n, l]) => `${n} (${l.map(c => c.operation).join(", ")})`).join("; ")}`);
}

/**
 * Who says each line of a reply, on the session at its call: as the prototype's screen hears it
 * streamed a word at a time (voices.ts's streamed: each time the words shown grow, the markup taken
 * out), and once it's whole (readReply).
 */
function speakersAsWritten(state: Session, raw: string) {
  const scene = effectiveScene(sceneById(state.sceneId), state.patches);
  const people = speakersOf(scene, state);
  const player = state.transcript.findLast(e => e.kind === "player")?.text;
  const streamed: Array<{ text: string; speech: unknown[] }> = [];
  let shown = "", sofar = "";
  for (const word of raw.match(/\S+\s*/g) ?? [raw]) {
    sofar += word;
    const parsed = parseMarkup(sofar, { final: false }) as { text: string };
    if (parsed.text === shown) continue;
    shown = parsed.text;
    const { text, speech } = withSpeakers(parsed, people, { player }) as { text: string; speech: unknown[] };
    streamed.push({ text, speech });
  }
  const whole = readReply(scene, state, raw) as { text: string; marked: { speech: unknown[] }; drafted: unknown[] };
  return { streamed, whole: { text: whole.text, speech: whole.marked.speech, drafted: whole.drafted } };
}

/** Each moment's notes and lines, a file each. */
function writeMoments(notes: unknown[], lines: unknown[]): void {
  for (const f of [...notes, ...lines] as Array<{ file: string }>) {
    const { file, ...body } = f;
    writeFileSync(join(OUT, file), JSON.stringify(body, null, 1) + "\n");
  }
  console.log(`notes: ${(notes as Array<{ moment: string; marks: unknown[] }>).map(n => `${n.moment} ${n.marks.length}`).join(", ")}; lines: ${(lines as Array<{ moment: string; lines: unknown[]; dropped: unknown[] }>).map(l => `${l.moment} ${l.lines.length} (${l.dropped.length} dropped)`).join(", ")}`);
}

/** The prototype's scenes that v2/ai's copied tests play, as authored (SCENES and ZOO_SCENES have them; their exits' scripts, code, drop out). */
function writeScenes(): void {
  mkdirSync(SCENES_OUT, { recursive: true });
  const ids = ["drowned-rat", "heron-warehouse", "kings-morning", "zoo-ferry", "zoo-pie-stall"];
  for (const id of ids) {
    const scene = [...SCENES, ...ZOO_SCENES].find((s: { id: string }) => s.id === id);
    writeFileSync(join(SCENES_OUT, `${id}.json`), JSON.stringify(scene, null, 1) + "\n");
  }
  console.log(`${ids.length} scenes written to ${SCENES_OUT}`);
}
