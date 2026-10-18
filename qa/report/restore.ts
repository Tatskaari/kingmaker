// After the prototype's src/report/restore.ts at 44c6d4a (restoreDump: its game as a new session, under a new id, never overwriting): the game's rows made a new game in a stack by its owner's restore_game, and its docs given to the AI service there, where it wrote a session's folder.
import { gamePath } from "../../shared/protocol/ai.ts";
import { isGameId } from "../../shared/protocol/keys.ts";
import { refusalIn } from "../../shared/protocol/refusals.ts";
import { stampOf, type Report } from "../../shared/report/format.ts";
import { gameOf } from "./inspect.ts";

/**
 * A report's game restored (V16, M5: `npm run report -- restore`): made a new game in a local stack,
 * as it was reported, for a session to carry on from that moment (`npm run play -- observe`, or the
 * client's Continue). Its rows go to the simulation through restore_game, which only the database's
 * owner may make (simulation/src/games/restore.ts: new ids, the session's identity its host, its jobs
 * in flight made again); its docs (the GM's notes among them) to the AI service, under the new
 * game's uid. A uid no game has: the report's, with the time it was restored. Nothing of the game it
 * came from is touched.
 */

/** The stack it's restored into, as its stack.json has it (hosts/dev/stack-file.ts): SpacetimeDB and its owner, the AI service and its bearer. */
export interface StackAt {
  /** SpacetimeDB from the host (http://127.0.0.1:<port>) and the database. */
  http: string;
  db: string;
  ownerToken: string;
  /** The AI service from the host, and the bearer it wants. */
  ai: string;
  bearer: string;
}

/** A game restored: its new uid, the game it came from, and how many docs went with it. */
export interface Restored { uid: string; from: string; docs: number; turn?: string }

export async function restoreReport(report: Report, stack: StackAt, identity: string, options: { uid?: string; now?: Date; fetch?: typeof fetch } = {}): Promise<Restored> {
  const game = gameOf(report);
  if (!game) throw new Error(`This report has no game to restore: ${report.game && "error" in report.game ? report.game.error : "none had been played"}.`);
  const uid = options.uid ?? newUid(game.uid, options.now ?? new Date());
  const send = options.fetch ?? fetch;

  await restoreRows(send, stack, { rows: JSON.stringify(game.rows), identity, uid });
  const docs = "error" in game.ai ? [] : game.ai.docs.docs;
  if (docs.length) await giveDocs(send, stack, uid, docs);

  return { uid, from: game.id, docs: docs.length, ...turnUnderWay(report) };
}

/** A new game's uid: the report's, with when it was restored, kept to a game id's shape. */
function newUid(uid: string, now: Date): string {
  const made = `${uid.slice(0, 70)}-r${stampOf(now.toISOString()).replace("-", "")}`;
  if (!isGameId(made)) throw new Error(`"${made}" won't do as a game's id`);
  return made;
}

/** restore_game as the stack's owner, over SpacetimeDB's HTTP API: why not, when it wasn't made. */
async function restoreRows(send: typeof fetch, stack: StackAt, args: { rows: string; identity: string; uid: string }): Promise<void> {
  const answer = await send(`${stack.http.replace(/\/+$/, "")}/v1/database/${encodeURIComponent(stack.db)}/call/restore_game`, {
    method: "POST", headers: { authorization: `Bearer ${stack.ownerToken}`, "content-type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(60_000),
  });
  if (answer.ok) return;
  const text = await answer.text();
  throw new Error(refusalIn(text)?.text ?? `restore_game: ${answer.status} ${text.trim() || answer.statusText}`);
}

/** The game's docs given to the AI service under its new uid. */
async function giveDocs(send: typeof fetch, stack: StackAt, uid: string, docs: Array<{ path: string; text: string }>): Promise<void> {
  const answer = await send(`${stack.ai.replace(/\/+$/, "")}${gamePath(uid, "docs")}`, {
    method: "PUT", headers: { authorization: `Bearer ${stack.bearer}`, "content-type": "application/json" }, body: JSON.stringify({ game: uid, docs }), signal: AbortSignal.timeout(30_000),
  });
  if (!answer.ok) throw new Error(`the AI service wouldn't take the game's docs: ${answer.status} ${(await answer.text()).slice(0, 300)}`);
}

/** A turn under way (or failed) as it was reported: it thinks again once restored (a failed one waits for /retry). */
function turnUnderWay(report: Report): { turn?: string } {
  const scene = report.where.scene;
  return scene && scene.phase && scene.phase !== "done" ? { turn: `turn ${scene.turn} of ${scene.title} was ${scene.phase}` } : {};
}
