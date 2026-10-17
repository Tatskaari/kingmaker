/**
 * GM loop fixtures: a moment just before a turn that went wrong, kept as the few things that
 * differ from source, so the current engine rebuilds every model input from them (V1's rule:
 * never check in captured prompts). The scene, the prompts and the lore load live; what the
 * fixture holds is the story so far and what play wrote:
 *
 *   case.json        what's being tested: the scene, the turn, the player's line, what went wrong
 *                    (the reply as recorded, the rubric check), what a good reply does, provenance
 *   state.json       the scene's progress before the turn (beat, path, what's established, landed,
 *                    staged secrets, the rules' sheet, earlier scenes): the session minus the parts below
 *   transcript.json  what the player has seen so far, an entry a line
 *   world.json       where everyone and everything is (scenes with a world)
 *   harness.json     what the harness's own agents had written by then (the co-GM's notes,
 *                    whispers, canon and patches, and its results waiting to land): pinned, and
 *                    switchable in case.json (recorded, fresh, none) so a co-GM change can be tested
 *   lore/            the session's docs overlay as it stood (memories, facts, edited notes), over lore/
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import type { SessionState } from "../../runtime/session.ts";
import { sessionDir } from "../../runtime/session.ts";
import { ROOT } from "./paths.ts";

export type HarnessMode = "recorded" | "fresh" | "none";

export interface Finding {
  turn: number; check: string; severity: number; quote: string; why: string; better?: string;
}

export interface LoopCase {
  id: string;
  scene: string;
  /** The turn the reply went wrong on: the fixture is the state after turn - 1. */
  turn: number;
  /** The player's line on that turn, word for word. */
  input: string;
  approach: string;
  /** The co-GM's notes: as recorded, made fresh by today's co-GM before the turn, or none. */
  harness: HarnessMode;
  /** The session's docs overlay (memories, facts): as recorded, or none (source lore only). */
  memory: "recorded" | "none";
  /** What went wrong, as the blind review saw it, and the reply as recorded (the judge's calibration). */
  observed: Finding & { reply: string };
  /** What a good reply does here: an outcome, failing stalls and withholding as well as the failure seen. */
  criterion: string;
  /** The rubric checks this case is about (the judge looks at every check, and these decide pass or fail). */
  checks: string[];
  /** A reply fails the case when it has a finding on one of `checks` at this severity or more. */
  failAt: number;
  samples: number;
  source: { kind: "session" | "report"; path: string; game: string; build?: string; calls?: number[] };
  tags?: string[];
}

/** Session fields that are diagnostics, not inputs to a turn. */
const DROPPED = ["metrics", "speculation", "suggestions", "lateRepairs", "lastRepairTurn"] as const;
/** Session fields the harness's own agents write (the co-GM): kept apart, in harness.json. */
const HARNESS = ["notes", "notesTurn", "whispers", "canon", "patches", "repairs", "decidedRelocations"] as const;
/** Session fields with files of their own. */
const OWN_FILES = ["transcript", "world"] as const;

// ---------------------------------------------------------------------------------------------
// Where a game comes from: a session folder (a QA round's) or a problem report

export interface Doc { path: string; text: string }
export interface GameSource {
  kind: "session" | "report";
  path: string;
  game: string;
  build?: string;
  /** The session after each turn, by turn (the scene's own snapshots). */
  snapshot(turn: number): SessionState | undefined;
  /** The final state. */
  state(): SessionState;
  docs(): Doc[];
  /** The co-GM's results, by file name (repair-NNN.json, repair-NNN-quick.json). */
  repairs(): Array<{ name: string; result: { turn: number; sceneId: string } & Record<string, unknown> }>;
  calls(): Array<Record<string, unknown>>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const walk = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

/** A session folder: runs/sessions/<id> (or a QA round's runs/sessions/<id>). */
export function sessionSource(dir: string): GameSource {
  const state = () => readJson<SessionState>(join(dir, "state.json"));
  return {
    kind: "session", path: dir, game: state().id,
    snapshot(turn) {
      const sceneId = state().sceneId;
      const snaps = join(dir, "snapshots");
      const file = existsSync(snaps) ? readdirSync(snaps).find(f => f === `${sceneId}-turn-${String(turn).padStart(3, "0")}.json`) : undefined;
      return file ? readJson<SessionState>(join(snaps, file)) : undefined;
    },
    state,
    docs: () => walk(join(dir, "docs")).map(f => ({ path: relative(join(dir, "docs"), f), text: readFileSync(f, "utf8") })),
    repairs: () => readdirSync(dir).filter(f => /^repair-\d+(?:-quick)?\.json$/.test(f)).map(name => ({ name, result: readJson(join(dir, name)) })),
    calls: () => existsSync(join(dir, "calls.jsonl")) ? readFileSync(join(dir, "calls.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [],
  };
}

interface ReportDump {
  build?: { commit?: string };
  game: {
    id: string;
    files: { state: SessionState };
    snapshots?: Array<{ name: string; state: SessionState }>;
    docs?: Doc[];
    repairs?: Array<{ name: string; repair: { turn: number; sceneId: string } & Record<string, unknown> }>;
    calls?: { kept?: Array<Record<string, unknown>> };
  };
}

/** A problem report (runs/reports/*.json.gz, ~/Downloads/kingmaker-report-*.json.gz), gzipped or not. */
export function reportSource(path: string): GameSource {
  const raw = readFileSync(path);
  const dump = JSON.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as ReportDump;
  const g = dump.game;
  return {
    kind: "report", path, game: g.id, ...(dump.build?.commit ? { build: dump.build.commit } : {}),
    snapshot: turn => g.snapshots?.find(s => s.state.turn === turn && s.state.sceneId === g.files.state.sceneId)?.state,
    state: () => g.files.state,
    docs: () => g.docs ?? [],
    repairs: () => (g.repairs ?? []).map(r => ({ name: r.name, result: r.repair })),
    calls: () => g.calls?.kept ?? [],
  };
}

export const gameSource = (path: string): GameSource =>
  /\.json(\.gz)?$/.test(path) ? reportSource(path) : sessionSource(path);

// ---------------------------------------------------------------------------------------------
// Docs as they stood before a turn

const metaTurn = (text: string): number | undefined => {
  const m = /^---\n[\s\S]*?^turn:\s*(\d+)\s*$[\s\S]*?^---/m.exec(text);
  return m ? Number(m[1]) : undefined;
};

/** How a note with no turn was set back to the turn: its body as the turn's GM call had it, or the source lore's (the note left out). */
export type Rewind = (d: Doc) => { text: string } | "source" | undefined;

/**
 * The overlay as it stood when the turn began: notes written on or after it go, and so do index
 * lines that link to them. A note with no turn (the player's own page, a place edited in play) is
 * edited all game, so its last version can tell of later turns (r1-1017's yard note had turn 16 in a
 * turn-7 case): `rewind` sets it back, from the turn's own GM call, or to the source lore. A note it
 * can't set back is kept as the game left it, and the README says so.
 */
export function docsBefore(docs: Doc[], turn: number, rewind?: Rewind): { kept: Doc[]; dropped: string[]; undated: string[]; rewound: string[]; toSource: string[] } {
  const later = new Set(docs.filter(d => (metaTurn(d.text) ?? -1) >= turn).map(d => d.path));
  const kept: Doc[] = [];
  const undated: string[] = [];
  const rewound: string[] = [];
  const toSource: string[] = [];
  for (const d of docs) {
    if (later.has(d.path)) continue;
    if (/(^|\/)index\.md$/.test(d.path)) {
      const here = dirname(d.path);
      const text = d.text.split("\n").filter(line => {
        const link = /\]\(([^)]+\.md)\)/.exec(line)?.[1];
        return !link || !later.has(join(here, decodeURI(link)));
      }).join("\n");
      kept.push({ path: d.path, text });
      continue;
    }
    if (metaTurn(d.text) === undefined) {
      const back = rewind?.(d);
      if (back === "source") { toSource.push(d.path); continue; }
      if (back) { rewound.push(d.path); kept.push({ path: d.path, text: back.text }); continue; }
      undated.push(d.path);
    }
    kept.push(d);
  }
  return { kept, dropped: [...later].sort(), undated, rewound, toSource };
}

const plain = (s: string): string => s.replace(/\[[^\]]*\]/g, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim();

/**
 * Sets an undated note back to the turn: the GM's call on that turn (found by its reply) has every
 * note's body as it stood then, each starting at its "# " title and running to the next note, the
 * next block or the end of its message. Without that call, the note is left to the source lore.
 */
export function rewindFromCalls(calls: Array<Record<string, unknown>>, reply: string, lore: string): Rewind {
  const head = plain(reply).slice(0, 60);
  const call = head ? calls.find(c => c.operation === "gm.reply" && typeof c.text === "string" && plain(c.text).startsWith(head)) : undefined;
  const request = call?.request as { instructions?: string; input?: Array<{ content?: unknown }>; messages?: Array<{ content?: unknown }> } | undefined;
  const texts = request ? [request.instructions ?? "", ...(request.input ?? request.messages ?? []).map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))] : [];
  return d => {
    const front = /^---\n[\s\S]*?\n---\n/.exec(d.text)?.[0] ?? "";
    const title = d.text.slice(front.length).split("\n").find(l => l.startsWith("# "));
    for (const t of title ? texts : []) {
      const i = t.indexOf(`${title}\n`);
      if (i < 0) continue;
      const ends = ["\n\n# ", "\n\n### "].map(s => t.indexOf(s, i + 1)).filter(n => n > 0);
      return { text: `${front}${t.slice(i, ends.length ? Math.min(...ends) : t.length).trim()}\n` };
    }
    return existsSync(join(lore, d.path)) ? "source" : undefined;
  };
}

// ---------------------------------------------------------------------------------------------
// Cutting a fixture

export interface ExtractOptions {
  turn: number;
  id: string;
  out: string;
  finding?: Partial<Finding>;
  criterion?: string;
  checks?: string[];
  approach?: string;
}

/** The recorded reply on a turn, as the player read it. */
export function replyOn(state: SessionState, turn: number): string {
  return state.transcript.filter(e => e.turn === turn && (e.scene ?? state.sceneId) === state.sceneId && e.kind !== "player")
    .map(e => e.kind === "roll" ? `🎲 ${e.text}` : e.kind === "system" ? `— ${e.text} —` : e.text).join("\n\n");
}

export function extractFixture(source: GameSource, options: ExtractOptions): LoopCase {
  const { turn, out } = options;
  const final = source.state();
  const before = source.snapshot(turn - 1);
  if (!before) throw new Error(`No snapshot of ${final.sceneId} after turn ${turn - 1} in ${source.path}.`);
  const input = final.transcript.find(e => e.turn === turn && e.kind === "player" && (e.scene ?? final.sceneId) === final.sceneId)?.text;
  if (!input) throw new Error(`No player line on turn ${turn} of ${final.sceneId}.`);
  mkdirSync(out, { recursive: true });

  const rest: Record<string, unknown> = { ...before };
  for (const k of [...DROPPED, ...HARNESS, ...OWN_FILES, "id"]) delete rest[k];
  const harness = Object.fromEntries(HARNESS.filter(k => before[k] !== undefined).map(k => [k, before[k]]));
  // The co-GM's results not yet applied when the turn began: the game applies them at its start.
  // (Keyed as src/runtime/repair.ts's reviewKey: a turn's quick review and its full one.)
  const key = (r: { turn: number; quick?: unknown }) => `${r.turn}${r.quick ? "-quick" : ""}`;
  const applied = new Set((before.repairs ?? []).map(key));
  const pending = source.repairs().filter(r => r.result.sceneId === before.sceneId && r.result.turn < turn && !applied.has(key(r.result)));

  const write = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 1) + "\n");
  write("state.json", rest);
  write("harness.json", { ...harness, pending });
  if (before.world) write("world.json", before.world);
  writeFileSync(join(out, "transcript.json"), `[\n${before.transcript.map(e => JSON.stringify(e)).join(",\n")}\n]\n`);

  const reply = replyOn(final, turn);
  const docs = docsBefore(source.docs(), turn, rewindFromCalls(source.calls(), reply, join(ROOT, "lore")));
  for (const d of docs.kept) {
    const file = join(out, "lore", d.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, d.text);
  }

  const c: LoopCase = {
    id: options.id, scene: before.sceneId, turn, input,
    approach: options.approach ?? before.approach,
    harness: "recorded", memory: "recorded",
    observed: {
      turn, check: options.finding?.check ?? "TODO", severity: options.finding?.severity ?? 3,
      quote: options.finding?.quote ?? "", why: options.finding?.why ?? "", ...(options.finding?.better ? { better: options.finding.better } : {}), reply,
    },
    criterion: options.criterion ?? "TODO: what a good reply does here, as an outcome. Fail stalling and withholding as well as the failure seen.",
    checks: options.checks ?? (options.finding?.check ? [options.finding.check] : []),
    failAt: 3,
    samples: 5,
    source: { kind: source.kind, path: source.path, game: source.game, ...(source.build ? { build: source.build } : {}) },
  };
  write("case.json", c);
  writeFileSync(join(out, "README.md"), readme(c, before, docs, pending.map(p => p.name)));
  return c;
}

function readme(c: LoopCase, before: SessionState, docs: ReturnType<typeof docsBefore>, pending: string[]): string {
  return `# ${c.id}

${c.observed.why || "(What went wrong: fill in from the review.)"}

- **Scene:** \`${c.scene}\`, turn ${c.turn} (the fixture is the session after turn ${c.turn - 1}, beat \`${before.beat}\`).
- **Source:** ${c.source.kind} \`${c.source.path}\`, game \`${c.source.game}\`${c.source.build ? `, built from \`${c.source.build.slice(0, 7)}\`` : ""}.
- **The player said:** ${c.input}
- **What came back (recorded):** ${c.observed.reply.split("\n").join(" ").slice(0, 600)}${c.observed.reply.length > 600 ? "…" : ""}
- **Rubric:** \`${c.observed.check}\`, severity ${c.observed.severity}${c.observed.quote ? `, on "${c.observed.quote}"` : ""}.

## What the fixture holds, and what comes from source

The scene (\`scenes/${c.scene}.ts\`), the prompts (\`prompts/\`) and the lore (\`lore/\`) are loaded live, so a change to any of them is tested. The GM's prompt is rebuilt by the engine from the files here; no captured prompt is kept.

- \`state.json\`: the session after turn ${c.turn - 1}, without the transcript, the world, the co-GM's work and the diagnostics (metrics, speculation, suggestions).
- \`transcript.json\`: ${before.transcript.length} entries, what the player had seen.
- \`world.json\`: ${before.world ? "the scene's world as it stood" : "(none: the scene has no world)"}.
- \`harness.json\`: the co-GM's notes${before.notes ? ` (written on turn ${before.notesTurn})` : " (none in force)"}, whispers, canon and patches${pending.length ? `, and its results waiting to land at the start of turn ${c.turn}: ${pending.join(", ")}` : ""}. \`"harness"\` in case.json: \`recorded\` uses them; \`fresh\` drops the notes, whispers and waiting results and runs today's co-GM on the fixture first; \`none\` drops them all.
- \`lore/\`: the session's docs overlay as it stood: ${docs.kept.length} notes kept${docs.dropped.length ? `, ${docs.dropped.length} written on turn ${c.turn} or later left out (index lines linking to them too)` : ""}.${docs.rewound.length ? ` Notes with no turn are edited all game, so these are set back to the turn's own GM call: ${docs.rewound.map(p => `\`${p}\``).join(", ")}.` : ""}${docs.toSource.length ? ` Left to the source lore (no GM call on the turn to set them back from): ${docs.toSource.map(p => `\`${p}\``).join(", ")}.` : ""}${docs.undated.length ? ` These have no turn and couldn't be set back, so they're as the game left them (a later edit may be in them): ${docs.undated.map(p => `\`${p}\``).join(", ")}.` : ""}

## Reconstruction assumptions

- The co-GM's background results are applied as recorded, in the order the game applies them.
- The dice: the fixture's seed is the session's; a turn's rolls are drawn afresh for each sample.
`;
}

// ---------------------------------------------------------------------------------------------
// Loading a fixture into a session to play the turn

export function readCase(dir: string): LoopCase {
  return readJson<LoopCase>(join(dir, "case.json"));
}

/**
 * The session for one sample of a case: written under the current KM_RUNS_DIR as `id` (its docs
 * overlay and the co-GM's waiting results with it), ready for playerTurn.
 */
export function loadFixture(dir: string, options: { id: string; approach?: string; seed?: number; harness?: HarnessMode; memory?: "recorded" | "none" }): SessionState {
  const c = readCase(dir);
  const harnessMode = options.harness ?? c.harness;
  const rest = readJson<Record<string, unknown>>(join(dir, "state.json"));
  const harness = readJson<Record<string, unknown> & { pending?: Array<{ name: string; result: unknown }> }>(join(dir, "harness.json"));
  const { pending = [], ...pinned } = harness;
  // recorded: everything the co-GM had written; fresh: its standing work (canon, patches) without
  // the notes, whispers and waiting results today's co-GM is about to remake; none: nothing of it.
  const kept = harnessMode === "none" ? {} : harnessMode === "fresh" ? { ...pinned, notes: null, notesTurn: null, whispers: [] } : pinned;
  const state = {
    ...rest,
    canon: [], patches: [], repairs: [], notes: null, notesTurn: null,
    ...kept,
    id: options.id,
    approach: options.approach ?? c.approach,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    transcript: readJson(join(dir, "transcript.json")),
    ...(existsSync(join(dir, "world.json")) ? { world: readJson(join(dir, "world.json")) } : {}),
    metrics: [],
  } as unknown as SessionState;

  const home = sessionDir(options.id);
  mkdirSync(home, { recursive: true });
  if (harnessMode === "recorded") for (const p of pending) writeFileSync(join(home, p.name), JSON.stringify(p.result, null, 1));
  if ((options.memory ?? c.memory) === "recorded") {
    const lore = join(dir, "lore");
    for (const f of walk(lore)) {
      const to = join(home, "docs", relative(lore, f));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(f));
    }
  }
  return state;
}
