// After the prototype's src/cli/scene.ts at 44c6d4a: its status command (:250-268, the fields and the summaries of path and patches; its rulings went with considered rolls) and its memories command (:182-190, a doc's heading and body: the GM's notes on each person now, since the memories became those), read from a game's rows and the AI service's store.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDoc } from "../../ai/docs/docs.ts";
import { isNotesPath } from "../../ai/docs/notes.ts";
import { gmFromRow, type GmRow, type GmState, type ScenePatch } from "../../shared/gm/state.ts";

/**
 * The GM's side of a game, as `npm run status` prints it (full-gm-design §4.4): the prototype's
 * `scene status` fields from the scene's gm_state row (beat, path, patches, and the world bridge's
 * threat, hold, brawl and who left; the old co-GM's notes, canon and reviews went with it), and what
 * the prototype kept in files: the memory
 * reviews (the AI service's memory-reviews.jsonl) and the GM's notes on each person they keep
 * (`--notes`, as `scene memories` printed a doc). Pure: hosts/status.ts reads the rows and the files.
 */

/** A row as the owner's SQL gives it: snake_case columns, an empty option null, a time in microseconds. */
export type Row = Record<string, unknown>;

/** What the status is made from: the game's rows, and the AI service's lines on its memory reviews. */
export interface StatusRows {
  game: Row;
  scene: Row;
  gm?: Row;
  turns: Row[];
  jobs: Row[];
  /** memory-reviews.jsonl's lines, as JSON. */
  reviews: unknown[];
  /** The story between scenes (story-design §4.1): the game's chapters, quests, flags, followers and attitudes. */
  story?: StoryRows;
}

/** The game's story rows, by game. */
export interface StoryRows { chapters: Row[]; quests: Row[]; flags: Row[]; followers: Row[]; attitudes: Row[] }

/**
 * What statusOf reads for a game's scene: its gm_state, turns and jobs by owner SQL
 * (`query`), and the memory reviews' lines from the game's folder in the AI service's store.
 */
export async function statusRows(query: (q: string) => Promise<Row[]>, store: string, game: Row, scene: Row): Promise<StatusRows> {
  const id = String(scene.id), byGame = `WHERE game_id = ${String(game.id)}`;
  const [[gm], turns, jobs, chapters, quests, flags, followers, attitudes] = await Promise.all([
    query(`SELECT * FROM gm_state WHERE scene_id = ${id}`), query(`SELECT * FROM turn WHERE scene_id = ${id}`),
    // A job's scene is an option column: the whole table, read for this scene's (statusOf).
    query("SELECT * FROM job"),
    ...["chapter", "quest", "flag", "follower", "attitude"].map(table => query(`SELECT * FROM ${table} ${byGame}`)),
  ]);
  return {
    game, scene, ...(gm ? { gm } : {}), turns, jobs, reviews: reviewLines(join(store, "memory-reviews.jsonl")),
    story: { chapters: chapters!, quests: quests!, flags: flags!, followers: followers!, attitudes: attitudes! },
  };
}

/** The background moves (full-gm-design §4.2): a memory review runs after a turn, holding nothing. */
const BACKGROUND = ["remember"];

/** The scene's background jobs in flight, as "remember t3" (by the turn they're for: its key's). */
export function backgroundOf(jobs: Row[], sceneId: string): string[] {
  return jobs.filter(j => String(j.scene_id) === sceneId && BACKGROUND.includes(String(j.move)))
    .map(j => `${String(j.move)} ${/:(t\d+):/.exec(String(j.key))?.[1] ?? "?"}`);
}

/** One memory review's line: the turn it reviewed, what the attention filter flagged, and what each agent did. */
interface ReviewLine { turn?: number; reviewed?: number; flags?: string[]; reviews?: Array<{ kind?: string; changes?: string[]; error?: string }> }

/** The GM's side of the game's scene, as JSON prints it: every field there, empty or not. */
export function statusOf(rows: StatusRows): Record<string, unknown> {
  const gm = rows.gm ? gmFromRow(camel(rows.gm) as GmRow) : undefined;
  const players = rows.turns.filter(t => Number(t.n) > 0).sort((a, b) => Number(a.n) - Number(b.n));
  const firstText = players.flatMap(t => (t.first_text_at !== null && t.first_text_at !== undefined ? [(Number(t.first_text_at) - Number(t.started_at)) / 1000] : []));
  return {
    game: Number(rows.game.id), uid: String(rows.game.uid), scene: String(rows.scene.scene_key), status: String(rows.scene.status), turn: Number(rows.scene.turns),
    ...(gm ? gmFields(gm) : { gm: "(no gm_state row for this scene)" }),
    memoryReviews: rows.reviews.map(r => reviewLine(r as ReviewLine)),
    jobs: rows.jobs.filter(j => String(j.scene_id) === String(rows.scene.id)).sort((a, b) => Number(a.id) - Number(b.id)).map(jobLine),
    latency: { avgFirstTextMs: average(firstText) },
    costUsd: (rows.turns.reduce((sum, t) => sum + Number(t.cost_micros ?? 0), 0) / 1e6).toFixed(5),
    story: storyFields(rows.game, rows.story ?? { chapters: [], quests: [], flags: [], followers: [], attitudes: [] }),
  };
}

/**
 * The story between scenes (story-design §4.1): where the game stands (its status, its time, the
 * lead and a boundary in flight), each chapter (a played scene's ending, its hand-off's first line,
 * what its boundary cost and what it skipped), the quests, the flags, who walks with the player and
 * the attitudes, as the prototype's session.history and story state have them.
 */
function storyFields(game: Row, story: StoryRows): Record<string, unknown> {
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const onward = text(game.onward);
  return {
    status: text(game.status), time: text(game.time),
    lead: game.lead_scene === null || game.lead_scene === undefined ? null : `${String(game.lead_scene)}${game.lead_text ? `: ${String(game.lead_text)}` : ""}`,
    onward: onward ? `${onward}${game.onward_note ? ` (${String(game.onward_note)})` : ""}` : null,
    chapters: [...story.chapters].sort((a, b) => Number(a.seq) - Number(b.seq)).map(c => {
      const skipped = (c.skipped as Array<{ scene_key?: string; sceneKey?: string }> | undefined ?? []).map(k => k.scene_key ?? k.sceneKey);
      const handOff = String(c.summary ?? "").split("\n")[0] || (String(game.status) === "ended" ? "(The End: no boundary after it)" : "(no hand-off yet: the boundary is in flight)");
      return `${Number(c.seq)}. ${String(c.scene_key)} -> ${String(c.exit_key)} (${String(c.ending)}): ${handOff} [${Number(c.calls)} calls, $${(Number(c.cost_micros ?? 0) / 1e6).toFixed(4)}${skipped.length ? `; skipped ${skipped.join(", ")}` : ""}]`;
    }),
    quests: story.quests.map(q => `${String(q.key)} (${String(q.status)}${q.stage ? `, ${String(q.stage)}` : ""}): ${(q.notes as string[] | undefined ?? []).at(-1) ?? String(q.title)}`),
    flags: story.flags.map(f => `${String(f.name)} = ${String(f.value)}`),
    followers: story.followers.map(f => `${String(f.cast_key)} (${String(f.name)}), since ${String(f.since_scene)}`),
    attitudes: story.attitudes.map(a => `${String(a.cast_key)}: ${String(a.attitude)}${a.reason ? ` (${String(a.reason)})` : ""}`),
  };
}

/** The bookkeeping's fields, the prototype's first, an empty one as null. */
function gmFields(gm: GmState): Record<string, unknown> {
  return {
    beat: gm.beat, turnsInBeat: gm.turnsInBeat,
    path: gm.path.map(p => `${p.turn}: ${p.from} -> ${p.to} via ${p.via} (${p.source})${p.roll ? ` [${p.roll.skill} ${p.roll.total}/${p.roll.dc}]` : ""}`),
    ended: gm.ended?.exitId ?? null,
    established: gm.established,
    patches: gm.patches.map(patchLine),
    landed: gm.landed, hinted: gm.hinted,
    // The world bridge's (world-bridge-design §3.3): what the last reply left hanging, a hold on the player, a fight that broke out, and who's away.
    threat: gm.threat ? `${gm.threat.turn}: ${gm.threat.kind === "attack" ? `an attack by ${gm.threat.by}` : `${gm.threat.hazard}, ${gm.threat.severity}`}` : null,
    held: gm.held ?? null,
    brawl: gm.brawl ? `${gm.brawl.turn}: ${gm.brawl.cause}; against ${gm.brawl.against.join(", ") || "nobody"}${gm.brawl.allies.length ? `; with ${gm.brawl.allies.join(", ")}` : ""}${gm.brawl.fled.length ? `; fled ${gm.brawl.fled.join(", ")}` : ""}` : null,
    absent: gm.absent,
    // What the boundary handed on to this scene (story-design §4.1), and the fights fought in it.
    adjustments: gm.adjustments, opening: gm.opening ?? null, lead: gm.lead ?? null,
    owed: gm.owed.map(o => `${o.from}/${o.id}${o.hinted ? " (hinted)" : ""}: ${[...o.things].reverse().join(" in ")}${o.holders.length ? ` with ${o.holders.join(", ")}` : ""}${o.where ? ` at ${o.where}` : ""}`),
    fought: gm.fought,
    // The two-part GM's (docs/two-part-design.md): what's reached, a closing on its way, each person's role now, and the co-GM's latest note.
    reached: gm.reached, closing: gm.closing ? `${gm.closing.exitId} (turn ${gm.closing.turn})` : null,
    roles: Object.entries(gm.twoPart?.roles ?? {}).map(([id, r]) => `${id}: ${[r.status, r.mental_state, r.conversation_role].filter(Boolean).join(" | ")}`),
    coGmNote: gm.twoPart?.notes.at(-1) ? `turn ${gm.twoPart.notes.at(-1)!.turn}` : null,
    moved: gm.twoPart?.moved ?? null, heldOnce: gm.twoPart?.held ?? null,
  };
}

/** A patch as the prototype's status summarises it. */
function patchLine(p: ScenePatch): string {
  return p.beat ? `beat ${p.beat.id}` : p.transition ? `${p.transition.beat} + ${p.transition.transition.when}` : p.close ? `${p.close.beat} - ${p.close.id}`
    : p.essential ? `essential ${p.essential.id}, brought over (${p.essential.missed}): ${p.essential.placedWith.join("; ")}`
    // A talk's discovery, filled for it or not its (the talk's prep).
    : p.fill ? `${p.fill.id} filled: ${p.fill.revelation} (${p.fill.paths.map(path => `${path.strength}: ${path.clue} What earns it: ${path.earn}`).join(" / ")})`
    : p.drop ? `${p.drop} dropped: ${p.why}`
    : `${p.cast?.id} keeps back: ${p.cast?.secrets.join(" ")}`;
}

/** A memory review: "<turn>: <flags> — <what the agents did>", and an agent's failure. */
function reviewLine(line: ReviewLine): string {
  const changes = (line.reviews ?? []).flatMap(r => r.changes ?? []);
  const errors = (line.reviews ?? []).flatMap(r => (r.error ? [`${r.kind ?? "review"} failed: ${r.error}`] : []));
  return `${line.turn ?? line.reviewed ?? "?"}: ${line.flags?.length ? line.flags.join(", ") : "nothing flagged"}${changes.length ? ` — ${changes.join("; ")}` : ""}${errors.length ? ` [${errors.join("; ")}]` : ""}`;
}

/** A job of the scene's, in flight or failed: its move and step, its state, its tries and its error. */
function jobLine(row: Row): string {
  const attempts = Number(row.attempts ?? 0);
  return `${String(row.move)}/${String(row.step)}: ${String(row.state)}${attempts > 1 ? `, attempt ${attempts}` : ""}${row.error !== null && row.error !== undefined ? ` (${String(row.error)})` : ""}`;
}

const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

/**
 * A row in the module's own names: snake_case columns (and the fields of a column's objects, if the
 * SQL gives them so) as camelCase, and an empty option (null) as undefined, as the bindings have them.
 */
export function camel(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(camel);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), camel(v)]));
  return value;
}

/** memory-reviews.jsonl's lines (none when it isn't there); a line that isn't JSON is skipped. */
export function reviewLines(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap(line => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line) as unknown]; } catch { return []; }
  });
}

/**
 * The GM's notes on each person in a game's docs (its copy of the lore: Cast/<name>/notes.md, or
 * characters/<id>/notes.md for someone without lore), in full, as the prototype's `scene memories`
 * printed a doc, with the scene and turn each was last brought up to date on. Says so when there are none.
 */
export function notesText(docs: string, game: string): string {
  const paths = walk(docs).filter(isNotesPath).sort();
  if (!paths.length) return `(No notes yet: play has given nobody any in game ${game}.)`;
  return paths.map(path => {
    const doc = parseDoc(path, readFileSync(join(docs, path), "utf8"));
    return `## ${path}  [${doc.meta.visibility}${doc.meta.scene ? `, last ${doc.meta.scene} turn ${doc.meta.turn ?? "?"}` : ""}]\n${doc.body}\n`;
  }).join("\n");
}

/** The Markdown files under a folder, by their paths in it ("/" between parts). */
function walk(root: string, dir = ""): string[] {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).flatMap(e => {
    const path = dir ? `${dir}/${e.name}` : e.name;
    return e.isDirectory() ? walk(root, path) : e.name.endsWith(".md") ? [path] : [];
  });
}
