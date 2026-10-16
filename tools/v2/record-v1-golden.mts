/**
 * Records the prototype's side of V1's parity (v1-design §4.2): what v2's rules code, creation
 * endpoints, GM and client are checked against.
 *
 *   KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings tools/v2/record-v1-golden.mts \
 *     --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2
 *
 * --proto is a checkout of the prototype at 44c6d4a, imported at run time by path (never this
 * stack's src/, whose backstory code is V1's); --out is v2. No model is asked and nothing leaves the
 * machine: every call goes to the prototype's stand-in for OpenRouter (fakeOpenRouter), under a key
 * that only looks real (set here, whatever the environment had, so the key file is never read). The
 * prototype's run output, call log and cost ledger go to a temporary folder. It writes:
 *
 * 1. <out>/ai/rules/golden/: creation's model calls, a file a case: threeBuilds for the create
 *    screen's three example concepts (Tamsin's answered with three real suggestions, the others with
 *    the least JSON), createCharacter with no build (rules.build), and the backstory's draft, work,
 *    check (a story naming the granary, so a place's doc is read) and traits, each with what it was
 *    asked, the stand-in's answers, every request body, and what the prototype made of it.
 * 2. <out>/shared/rules/golden/: the sheets of builds.json's five and of the three Tamsin is offered
 *    (seed 7: sheetData, sheetText, statusLine, refresh's lists, ids masked in order), and the
 *    ready-made rogue's checks: three skills × three DCs on each of seeds 1-100 (900), and nine in a
 *    row on each of seeds 1-3, each on the campaign the one before committed.
 * 3. <out>/ai/gm/golden/hanged-clerk-backstory/: a GM session with a backstory (the rogue, seed 4242):
 *    the opening, then "I look closely at the body." with the decider's attempt examine-body, in the
 *    format of V0's hanged-clerk golden (tools/record-golden.mts), whose stand-in code this copies.
 * 4. <out>/client/check/fixtures/: the offline offer for Tamsin's concept, srdLists(3), an own build
 *    (orc, rogue, thief, criminal), and the ready-made wizard's and fighter's SheetData.
 *
 * Recording twice gives the same files, but for the GM session's: there, as in V0's, the engine's
 * random ids for the character and their gear differ, which no prompt shows. Elsewhere they're masked.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`usage: record-v1-golden.mts --proto <the prototype at 44c6d4a> --out <v2> (no ${name})`);
  return resolve(process.argv[i + 1]!);
};
const PROTO = arg("--proto");
const OUT = arg("--out");

// The prototype's run output, somewhere that isn't the repo; set before its modules load (they read these as they load).
const runs = mkdtempSync(join(tmpdir(), "km-v1-golden-"));
process.env.KM_RUNS_DIR = runs;
process.env.KM_CALL_LOG = join(runs, "calls.jsonl");
process.env.KM_COST_LEDGER = join(runs, "cost-ledger.jsonl");
const FAKE_KEY = "sk-or-golden-recording-no-model";
process.env.OPENROUTER_API_KEY = FAKE_KEY;
delete process.env.KM_PROMPTS_DIR;
process.chdir(runs);

const proto = (path: string) => import(pathToFileURL(join(PROTO, path)).href);
const { fakeOpenRouter } = await proto("src/llm/fake-openrouter.ts");
const { threeBuilds, ownBuild, srdLists } = await proto("src/rules/builds.ts");
const { createCharacter, sheetData, sheetText, statusLine, rollFor, settleBuild, styleFor, srdContent } = await proto("src/rules/dnd.ts");
const { draftBackstory, workIn, checkLore, finishBackstory } = await proto("src/lore/backstory.ts");
const { createSession, openScene, playerTurn } = await proto("src/runtime/engine.ts");
const { PREGENS } = await proto("src/game/combat/pregen.ts");

// ---------------------------------------------------------------------------------------------
// Who is made, and what the stand-in says.

const LEVEL = 3;
/** The create screen's three examples (src/app/ui/create.tsx). */
const EXAMPLES = [
  { slug: "tamsin", name: "Tamsin Vell", concept: "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier" },
  { slug: "odo", name: "Brother Odo", concept: "a large, gentle hedge-priest who settles arguments by sitting on them" },
  { slug: "pell", name: "Pell Marrow", concept: "a Nine Furrows weather-witch who is never wrong about rain and rarely right about people" },
];
const TAMSIN = { name: EXAMPLES[0]!.name, concept: EXAMPLES[0]!.concept };
/** What a model might suggest for Tamsin: three classes, written as a model writes them. */
const TAMSIN_BUILDS = {
  first: { classId: "rogue", subclassId: "thief", speciesId: "human", backgroundId: "sage", abilities: ["DEX", "INT", "CHA", "WIS", "CON", "STR"], skills: ["investigation", "insight", "deception", "sleight-of-hand"], feat: "skilled", cantrips: [], spells: [], weapons: ["rapier", "dagger"], armor: "leather-armor", shield: false, style: "none", plays: "Reads the books and the people who cook them: Sneak Attack for the ones who lie to your face." },
  second: { classId: "bard", subclassId: "college-of-lore", speciesId: "human", backgroundId: "criminal", abilities: ["CHA", "DEX", "INT", "CON", "WIS", "STR"], skills: ["persuasion", "deception", "insight", "investigation"], feat: "alert", cantrips: ["vicious-mockery", "message"], spells: ["dissonant-whispers", "charm-person", "detect-magic", "comprehend-languages", "silence"], weapons: ["rapier"], armor: "leather-armor", shield: false, style: "none", plays: "A sharp tongue made sharper: you talk your way in and mock your way out." },
  third: { classId: "fighter", subclassId: "champion", speciesId: "elf", backgroundId: "soldier", abilities: ["DEX", "CON", "INT", "WIS", "STR", "CHA"], skills: ["insight", "perception"], feat: "alert", cantrips: [], spells: [], weapons: ["rapier", "shortbow"], armor: "studded-leather", shield: false, style: "Dueling", plays: "The borrowed rapier is the point: you were a duellist before you were an auditor." },
};
/** What a model might choose for Tamsin alone (createCharacter with no build: rules.build). */
const TAMSIN_BUILD = { classId: "Rogue", subclassId: "Thief", speciesId: "Human", backgroundId: "Sage", abilities: ["Dexterity", "Intelligence", "Wisdom", "Charisma", "Constitution", "Strength"], skills: ["Investigation", "Insight", "Perception", "Deception"], feat: "Skilled", cantrips: [], spells: [], weapons: ["Rapier", "Dagger"], armor: "Leather Armor", shield: false, style: "none" };

const WHO = { ...TAMSIN, build: "human rogue 3 (Thief), sage background" };
const DRAFT = "I kept the Exchequer's ledgers for nine years, and I was good at it: good enough to notice that the Rivergate tolls came in a shilling short every week, and foolish enough to say so. The shillings went somewhere with a title, and I went out of the palace with nothing but a borrowed rapier and a reputation.\n\nThis morning they found Wendell Prout hanged behind the King's Granary, and the King sent for me. He remembered that I count things nobody else wants counted. I said yes because nobody listened to me the last time, and I'd like to be listened to once.";
const NOTES = "auditor 9 yrs, exchequer. found the rivergate tolls short. sacked for it. owe Fat Jory three crowns for the rapier. sister Bet in the Nine Furrows";
const WORKED = "I was an auditor at the Exchequer for nine years, until I found the Rivergate tolls short and was sacked for saying so. The rapier I carry I bought from Fat Jory, and I still owe him three crowns for it. My sister Bet lives out in the Nine Furrows, and she's the only one who wrote to me after.";
/** The lore check's story: the nephew (a tie the lore would record), and the granary, so the check reads its doc. */
const NEPHEW = "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns, and I used to sleep in the granary loft when I couldn't pay my rent.";
const ISSUE = { quote: "I'm the King's nephew, though nobody at court will say so.", problem: "The King has no nephew the court would hide: Caerwyn's lore would know of one.", fix: "I grew up in the palace kitchens, where the King's cooks still remember my mother." };
const TRAITS = { summary: "Tamsin Vell, sacked from the Exchequer for finding the Rivergate tolls short, owes Fat Jory three crowns and took the King's case to be listened to once.", personality: ["sharp-tongued", "counts everything"], ideals: ["the books should balance"], bonds: ["Fat Jory, who she owes", "her sister Bet"], flaws: ["can't let a wrong sum go"] };

/** The GM session's backstory (one that passed the check) and what the stand-in says (as V0's golden: a tagged line in the opening). */
const BACKSTORY = { text: WORKED, ...TRAITS };
const OPENING = "Rain beads on the hoist rope. A small grey clerk turns above the cobbles while a scrawny boy in enormous boots lobs gutter stones at him, and a girl on the wall top swears at both of them. [Sergeant Agnes Kell] “You'll be the King's auditor, then. The Captain calls it suicide.” A stone clangs off the hoist hook.";
const LOOK = { line: "I look closely at the body.", choices: { attempt: "examine-body" }, reply: "You climb the hoist ladder until Prout's boots are level with your nose. Under the rope's slanting burn there's another mark, thin and level, low round his neck." };

// ---------------------------------------------------------------------------------------------
// 1. Creation's model calls.

/** Each case under its own stand-in: what it was asked, the answers, the calls, and what came of it. Returns Tamsin's offer (her three, for the sheets). */
async function recordCreation(): Promise<{ options: Array<{ build: Record<string, unknown> }> }> {
  const dir = join(OUT, "ai", "rules", "golden");
  mkdirSync(dir, { recursive: true });
  const cases: Array<{ file: string; about: string; fn: string; args: Record<string, unknown>; byName: Record<string, unknown>; run: () => Promise<unknown> }> = [
    { file: "builds-tamsin", about: "threeBuilds for the first example concept, the model answering with three real suggestions (names where ids belong, a doubled-up style)", fn: "threeBuilds",
      args: { ...TAMSIN, level: LEVEL }, byName: { builds: TAMSIN_BUILDS }, run: () => threeBuilds(TAMSIN.name, TAMSIN.concept, LEVEL) },
    ...EXAMPLES.slice(1).map(e => ({ file: `builds-${e.slug}`, about: `threeBuilds for ${e.name}, the model answering with the least JSON (no class it names: all three from the defaults)`, fn: "threeBuilds",
      args: { name: e.name, concept: e.concept, level: LEVEL }, byName: {}, run: () => threeBuilds(e.name, e.concept, LEVEL) })),
    { file: "build-tamsin", about: "createCharacter with no build: the model chooses one (rules.build), written as names; what the prototype settled it to and the character made", fn: "chooseBuild",
      args: { ...TAMSIN, level: LEVEL }, byName: { build: TAMSIN_BUILD }, run: () => chosen(TAMSIN) },
    { file: "backstory-draft", about: "draftBackstory (Draft one) for Tamsin's chosen build", fn: "draftBackstory", args: { who: WHO }, byName: { backstory: { story: DRAFT } }, run: () => draftBackstory(WHO) },
    { file: "backstory-work", about: "workIn (Work it in): her notes, every word kept", fn: "workIn", args: { notes: NOTES, who: WHO }, byName: { backstory: { story: WORKED } }, run: () => workIn(NOTES, WHO) },
    { file: "backstory-check", about: "checkLore on a story that claims kin to the King and names the granary (so Places/Granary Yard.md is read): one issue", fn: "checkLore",
      args: { story: NEPHEW, who: WHO }, byName: { lore_check: { issues: [ISSUE] } }, run: () => checkLore(NEPHEW, WHO) },
    { file: "backstory-traits", about: "finishBackstory (the traits) on her worked-in story", fn: "finishBackstory", args: { text: WORKED, who: WHO }, byName: { traits: TRAITS }, run: () => finishBackstory(WORKED, WHO) },
  ];
  let offer: unknown;
  for (const c of cases) {
    const { result, calls } = await recorded(c.byName, c.run);
    if (c.file === "builds-tamsin") offer = result;
    write(dir, c.file, { about: c.about, fn: c.fn, args: c.args, byName: c.byName, calls, result });
  }
  readme(dir, CREATION_README);
  console.log(`creation: ${cases.length} cases in ${dir}`);
  return offer as { options: Array<{ build: Record<string, unknown> }> };
}

/** The character the model chooses for a concept, as createCharacter makes it with no build: the settled build (as it settles and styles one), its line, and the sheet. */
async function chosen(who: { name: string; concept: string }): Promise<unknown> {
  const state = session(who.name, who.concept, 7);
  const line = await createCharacter(state, LEVEL);
  const settled = settleBuild(TAMSIN_BUILD, LEVEL, content);
  const style = settled.style ? undefined : styleFor(settled, content);
  return { line, buildLine: state.player.build, build: style ? { ...settled, style } : settled, status: state.rules.status };
}

// ---------------------------------------------------------------------------------------------
// 2. Sheets and checks.

/** builds.json's five, and Tamsin's three, made at seed 7: everything the prototype's sheet code says of each. */
async function recordSheets(offer: { options: Array<{ build: Record<string, unknown> }> }): Promise<void> {
  const characters = [
    ...Object.entries(builds).map(([id, b]) => ({ case: id, name: "Wren Ashdown", concept: b.concept, build: b.build })),
    ...offer.options.map((o, i) => ({ case: `tamsin-${i + 1}`, name: TAMSIN.name, concept: TAMSIN.concept, build: o.build })),
  ];
  const sheets = [];
  for (const c of characters) {
    const state = session(c.name, c.concept, 7);
    const line = await createCharacter(state, LEVEL, c.build);
    const { campaign: _campaign, npcs: _npcs, ...rules } = state.rules;
    sheets.push(masked({ ...c, seed: 7, level: LEVEL, line, buildLine: state.player.build, modifiers: state.player.modifiers, status: await statusLine(state), rules, sheet: await sheetData(state), text: await sheetText(state) }));
  }
  const dir = join(OUT, "shared", "rules", "golden");
  mkdirSync(dir, { recursive: true });
  write(dir, "sheets", { about: "The prototype's sheet code for builds.json's five and the three builds Tamsin Vell is offered, made at seed 7 (the engine's ids masked in order)", sheets });
  console.log(`sheets: ${sheets.length} characters`);
}

const CHECK_SKILLS = ["perception", "investigation", "persuasion"] as const;
const CHECK_DCS = [10, 13, 16];

/**
 * The ready-made rogue's checks. Fresh: for each seed 1-100, the nine (skill, DC) each the next of
 * that seed's dice (rollCount 0 to 8) on the character as made, as a check in any turn rolls on the
 * campaign the turn found. Chained: for seeds 1-3, the nine in a row on one session, each on the
 * campaign the one before committed.
 */
async function recordChecks(): Promise<void> {
  const base = session("Wren Ashdown", builds.rogue!.concept, 1);
  await createCharacter(base, LEVEL, builds.rogue!.build);
  const combos = CHECK_SKILLS.flatMap(skill => CHECK_DCS.map(dc => ({ skill, dc })));
  const fresh = [], chained = [];
  for (let seed = 1; seed <= 100; seed++) {
    for (const [k, { skill, dc }] of combos.entries()) fresh.push({ seed, ...(await rollFor({ ...base, seed, rollCount: k, rules: { ...base.rules } }, skill, dc)) });
  }
  for (let seed = 1; seed <= 3; seed++) {
    const state = { ...base, seed, rollCount: 0, rules: { ...base.rules } };
    for (const { skill, dc } of combos) chained.push({ seed, ...(await rollFor(state, skill, dc)) });
  }
  const dir = join(OUT, "shared", "rules", "golden");
  const rows = (list: unknown[]) => `[\n${list.map(r => `  ${JSON.stringify(r)}`).join(",\n")}\n ]`;
  writeFileSync(join(dir, "checks.json"), `{"about": "The prototype's rollFor on the ready-made rogue (builds.json, Wren Ashdown): fresh, for each seed 1-100 the nine checks (skills × DCs) each the next of that seed's dice on the character as made; chained, for seeds 1-3 the nine in a row, each on the campaign the one before committed",\n "case": "rogue", "skills": ${JSON.stringify(CHECK_SKILLS)}, "dcs": ${JSON.stringify(CHECK_DCS)},\n "fresh": ${rows(fresh)},\n "chained": ${rows(chained)}}\n`);
  readme(dir, SHEETS_README);
  console.log(`checks: ${fresh.length} fresh, ${chained.length} chained`);
}

// ---------------------------------------------------------------------------------------------
// 3. A GM session with a backstory, in V0's golden format.

/** Every call the stand-in answers in the session: the step it's in, its body, and the session as it stood. */
interface Recorded { step: string; url: string; body: Record<string, unknown>; session: unknown }

async function recordSession(): Promise<void> {
  const calls: Recorded[] = [];
  let state: Record<string, unknown> | undefined;
  let step = "open";
  const stand = (options: { replies: string[]; choices?: Record<string, string> }) => standIn(options, (url, body) => calls.push({ step, url, body, session: snapshot(state) }));
  const opened = stand({ replies: [OPENING] });
  state = await createSession({ sceneId: "hanged-clerk", approach: "v2", player: `${TAMSIN.name}: ${TAMSIN.concept}`, level: LEVEL, seed: 4242, id: "golden-hanged-clerk-backstory", build: PREGENS.rogue.build, backstory: BACKSTORY });
  await openScene(state);
  opened();
  step = "t1";
  const looked = stand({ replies: [LOOK.reply], choices: LOOK.choices });
  await playerTurn(state, LOOK.line);
  looked();
  const dir = join(OUT, "ai", "gm", "golden", "hanged-clerk-backstory");
  writeSteps(dir, nameCalls(calls));
  readme(dir, SESSION_README);
}

/** The session now, as V0's parity test reads it: the rules engine's own state (a serialised campaign) left out. */
function snapshot(state: Record<string, unknown> | undefined): unknown {
  const copy = structuredClone(state) as { rules?: Record<string, unknown> } | undefined;
  if (copy?.rules) delete copy.rules.campaign;
  return copy;
}

/** Each call's operation, from the prototype's own call log: a decision by its whole request, a reply by its instructions and input (tools/record-golden.mts's nameCalls). */
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

/** One file per step, as V0's: the opening, and the turn's decide (disclosure, the director's before), reply and settle (the stage manager, the director's after). The notes on marks, a later vertical's, are left out (tools/record-golden.mts's writeSteps). */
function writeSteps(dir: string, calls: Array<Recorded & { operation: string }>): void {
  const stepOf = (c: { step: string; operation: string }) => c.operation === "notes" ? undefined
    : c.step === "open" ? "open"
    : /^(memory\.disclose|director\.(before|ooc))/.test(c.operation) ? `${c.step}-decide`
    : /^gm\./.test(c.operation) ? `${c.step}-reply`
    : /^(world\.stage|director\.after)$/.test(c.operation) ? `${c.step}-settle`
    : undefined;
  mkdirSync(dir, { recursive: true });
  const steps = new Map<string, Array<Recorded & { operation: string }>>();
  for (const c of calls) {
    const name = stepOf(c);
    if (name) steps.set(name, [...(steps.get(name) ?? []), c]);
  }
  for (const [i, [name, list]] of [...steps].entries()) {
    const turn = name === "open" ? undefined : LOOK;
    const file = { step: name, ...(turn ? { line: turn.line, choices: turn.choices } : {}), replies: [turn ? turn.reply : OPENING], session: list[0]!.session, calls: list.map(c => ({ operation: c.operation, body: c.body })) };
    writeFileSync(join(dir, `${String(i).padStart(2, "0")}-${name}.json`), JSON.stringify(file, null, 1) + "\n");
  }
  console.log(`session: ${calls.length} calls, ${steps.size} steps: ${[...steps].map(([n, l]) => `${n} (${l.map(c => c.operation).join(", ")})`).join("; ")}`);
}

// ---------------------------------------------------------------------------------------------
// 4. The client's fixtures.

async function recordFixtures(): Promise<void> {
  const dir = join(OUT, "client", "check", "fixtures");
  mkdirSync(dir, { recursive: true });
  // Offline: the key says so (modelOffline reads it at each call).
  process.env.OPENROUTER_API_KEY = "offline";
  write(dir, "offer-tamsin", await threeBuilds(TAMSIN.name, TAMSIN.concept, LEVEL));
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  write(dir, "srd-lists", await srdLists(LEVEL));
  write(dir, "own-option", await ownBuild({ speciesId: "orc", classId: "rogue", subclassId: "thief", backgroundId: "criminal" }, LEVEL, TAMSIN.name));
  for (const [id, name] of [["wizard", "Pell Marrow"], ["fighter", "Wren Ashdown"]] as const) {
    const state = session(name, builds[id]!.concept, 7);
    await createCharacter(state, LEVEL, builds[id]!.build);
    write(dir, `sheet-${id}`, await sheetData(state));
  }
  readme(dir, FIXTURES_README);
  console.log(`fixtures: written to ${dir}`);
}

// ---------------------------------------------------------------------------------------------
// The stand-in, the session, and the files.

/** The prototype's stand-in for OpenRouter, its fetch wrapped to see each call; returns its restore. */
function standIn(options: { replies?: string[]; byName?: Record<string, unknown>; choices?: Record<string, string> }, seen: (url: string, body: Record<string, unknown>) => void): () => void {
  const fake = fakeOpenRouter(options);
  const answer = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen(url, JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return answer(input, init);
  };
  return () => fake.restore();
}

/** What a case made, and every model call it made on the way (in order, with its operation from the call log). */
async function recorded(byName: Record<string, unknown>, run: () => Promise<unknown>): Promise<{ result: unknown; calls: Array<{ operation: string; body: Record<string, unknown> }> }> {
  const calls: Recorded[] = [];
  const done = standIn({ byName }, (url, body) => calls.push({ step: "creation", url, body, session: undefined }));
  try {
    const result = await run();
    return { result: masked(result), calls: nameCalls(calls).map(c => ({ operation: c.operation, body: c.body })) };
  } finally { done(); }
}

/** A session with nothing in it but the player, as createSession starts one. */
function session(name: string, concept: string, seed: number): Record<string, any> {
  return { id: "golden", sceneId: "hanged-clerk", approach: "v2", seed, rollCount: 0, player: { name, concept, modifiers: {} },
    turn: 0, beat: "", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null, patches: [], repairs: [], transcript: [], metrics: [], history: [] };
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** The engine's ids (ULIDs, which differ every time) as #1, #2… in the order they first appear. */
function masked<T>(value: T): T {
  const ids = new Map<string, string>();
  const walk = (x: unknown): unknown => typeof x === "string" ? (ULID.test(x) ? (ids.get(x) ?? ids.set(x, `#${ids.size + 1}`).get(x)) : x)
    : Array.isArray(x) ? x.map(walk)
    : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
    : x;
  return walk(value) as T;
}

function write(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(value, null, 1) + "\n");
}

function readme(dir: string, text: string): void {
  writeFileSync(join(dir, "README.md"), text.replace(/^\n/, ""));
}

// ---------------------------------------------------------------------------------------------
// The READMEs, for each folder written.

const HOW = `Recorded by \`tools/v2/record-v1-golden.mts\` from the prototype at \`44c6d4a\`, under its stand-in for OpenRouter (no model asked):

\`\`\`sh
KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings tools/v2/record-v1-golden.mts \\
  --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2
\`\`\`

Record again only when a case is added: the prototype's code these come from is fixed at \`44c6d4a\`.`;

const CREATION_README = `
# The creation calls

The prototype's model calls in character creation, a file a case, for the AI service's prompt parity (v1-design §4.2): for the same request, \`POST /v1/characters\` and \`POST /v1/backstories\` must ask what the prototype asks, byte for byte.

${HOW}

Each file has \`about\` (the case), \`fn\` and \`args\` (what was called, with what), \`byName\` (the stand-in's answer for each schema name; none is the least JSON that fits), \`calls\` (each request body as sent to OpenRouter, in order, with its operation) and \`result\` (what the prototype made of the answer, the engine's ids masked).

| File | Call | Operation |
|---|---|---|
| builds-tamsin.json | \`threeBuilds\` for Tamsin Vell, three real suggestions (written as names, a fighter's style "Dueling") | \`rules.builds\` |
| builds-odo.json, builds-pell.json | \`threeBuilds\` for Brother Odo and Pell Marrow, the least JSON: all three from the class defaults | \`rules.builds\` |
| build-tamsin.json | \`createCharacter\` with no build: the model's choice (\`chooseBuild\`, the prompt's concept is "Name: concept"); \`result.build\` is it settled and styled as the prototype does | \`rules.build\` |
| backstory-draft.json | \`draftBackstory\` for her chosen build | \`backstory.draft\` |
| backstory-work.json | \`workIn\`, her notes kept | \`backstory.work\` |
| backstory-check.json | \`checkLore\` on the nephew story, which names the granary (its place doc in the lore) | \`backstory.check\` |
| backstory-traits.json | \`finishBackstory\` | \`backstory.traits\` |
`;

const SHEETS_README = `
# The rules' golden sheets and checks

What the prototype's rules code makes, for \`shared/rules\`'s parity (v1-design §4.1): v2's \`golden.test.ts\` makes the same characters through its own copy and compares.

${HOW}

- **sheets.json:** builds.json's five ready-made builds (as Wren Ashdown, with each build's concept) and the three builds Tamsin Vell is offered in \`ai/rules/golden/builds-tamsin.json\`, each made by \`createCharacter\` at level 3 with seed 7: its line, the build line and modifiers it leaves on the player, \`statusLine\`, \`refresh\`'s lists (\`rules\`: spells, weapons, features, gear, prefer, status, pc), \`sheetData\` (before the story begins, so the purse is the starting one) and \`sheetText\`. The engine's ids are masked as #1, #2… in the order they first appear in each character's record, since they're random.
- **checks.json:** the ready-made rogue's checks through the engine (\`rollFor\`), perception, investigation and persuasion at DC 10, 13 and 16. \`fresh\`: for each seed 1-100, the nine each the next of that seed's dice (rolls one to nine) on the character as made, as each turn's check rolls on the campaign it found (900). \`chained\`: for seeds 1-3, the nine in a row on one session, each on the campaign the one before committed (27).
`;

const SESSION_README = `
# A GM session with a backstory

The prototype's GM calls on the hanged clerk for a player with a backstory, in the format of [../hanged-clerk](../hanged-clerk/README.md), for the AI service's parity: the opening writes the player's doc with the backstory before disclosure, and the GM's brief says who they are from it (v1-design §4.2).

${HOW}

| Step | What the player does | The stand-in |
|---|---|---|
| open | \`createSession\` (Tamsin Vell, the rogue pregen's build, a backstory that passed the lore check, seed 4242) and \`openScene\` | the GM's opening, with a tagged line |
| t1 | "I look closely at the body." | \`attempt: examine-body\`: the Medicine check rolls through the rules engine |

The dice: the opening's \`comeTo\` is the session's first roll (no line: she isn't down), so the check is its second (\`rollCount\` 2 in t1's settle). The session in each file is as it stood at the step's first call, the rules' campaign left out.

Recording again gives the same calls; the files differ only in the rules engine's random ids for the character and their gear, which no prompt shows.
`;

const FIXTURES_README = `
# The client's fixtures

What the prototype's creation and sheet code made, for the client's screens and screen check (v1-design §4.4), which draw them as the rows will carry them.

${HOW}

| File | What |
|---|---|
| offer-tamsin.json | \`threeBuilds\` offline for Tamsin Vell's concept: three from the class defaults, with the offline note |
| srd-lists.json | \`srdLists(3)\`: what the player picks from to make their own |
| own-option.json | \`ownBuild\` (orc, rogue, thief, criminal) for Tamsin Vell |
| sheet-wizard.json | the ready-made wizard's \`SheetData\` (Pell Marrow, seed 7), the starting purse in it |
| sheet-fighter.json | the ready-made fighter's (Wren Ashdown, seed 7) |
`;

// ---------------------------------------------------------------------------------------------
// The recording: after everything above is defined.

const content = await srdContent();
const builds = JSON.parse(readFileSync(join(OUT, "campaigns", "caerwyn", "builds.json"), "utf8")) as Record<string, { concept: string; build: Record<string, unknown> }>;

const tamsinOffer = await recordCreation();
await recordSheets(tamsinOffer);
await recordChecks();
await recordSession();
await recordFixtures();
rmSync(runs, { recursive: true, force: true });
