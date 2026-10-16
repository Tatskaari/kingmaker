// After the prototype's src/cli/scene.ts at 44c6d4a (status, :250-268; memories, :182-190): the same views of a game the dev stack plays, from its rows (owner SQL) and the AI service's store.
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { memoriesText, statusOf, statusRows, type Row } from "./dev/gm-status.ts";
import { sql } from "./dev/spacetime.ts";
import { readStackFile } from "./dev/stack-file.ts";

/**
 * The GM's side of a game (full-gm-design §4.4), as the prototype's `scene status` and
 * `scene memories` show it: where the scene stands in its beats, its path, the co-GM's notes,
 * whispers, canon and routes, the GM's rulings, the co-GM's reviews (merged or waiting), the memory
 * reviews, the notes disclosure opened, and the background jobs in flight; or, with --memories,
 * every memory the reviews wrote, in full. It reads the running dev stack: its private rows as the
 * database's owner (runs/dev/stack.json has the token), and the AI service's store (runs/dev/ai/).
 * Not for blind QA: it shows what the player hasn't seen.
 */

const USAGE = `Kingmaker: the GM's side of a game

  npm run status -- --game <n>              the GM's side of game n's scene: beat, path, notes, whispers, canon,
                                            patches, rulings, the co-GM's reviews, the memory reviews, the jobs in flight
  npm run status -- --game <n> --memories   every memory the reviews wrote, in full

--game is the number in the game's side panel (the newest game when it's left out). --root is the
stack's folder (runs/dev). Not for blind QA: it shows what the player hasn't seen.`;

const V2 = resolve(import.meta.dirname, "..");

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { game: { type: "string" }, memories: { type: "boolean" }, root: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (values.help) { console.log(USAGE); return 0; }
  if (values.game !== undefined && !/^\d+$/.test(values.game)) { console.error(`--game takes the game's number (its side panel says "Game 1"), not "${values.game}".`); return 1; }
  const root = resolve(values.root ?? join(V2, "runs", "dev"));
  const stack = readStackFile(root);
  if (!stack) { console.error(`There's no stack in ${relative(process.cwd(), root) || root}: start one with npm run dev`); return 1; }
  const query = (q: string) => sql(stack.http, q, stack.owner.token);

  const games = await query("SELECT * FROM game");
  const game = values.game !== undefined ? games.find(g => String(g.id) === values.game) : games.sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!game) { console.error(values.game !== undefined ? `There's no game ${values.game} on this stack.` : "There are no games on this stack yet."); return 1; }
  const store = join(root, "ai", "games", String(game.uid));
  if (values.memories) { console.log(memoriesText(join(store, "docs"), String(game.id))); return 0; }

  const scenes = await query(`SELECT * FROM scene WHERE game_id = ${String(game.id)}`);
  const scene = scenes.sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!scene) { console.error(`Game ${String(game.id)} hasn't begun: it has no scene yet.`); return 1; }
  console.log(JSON.stringify(statusOf(await statusRows(query, store, game as Row, scene as Row)), null, 1));
  return 0;
}

main(process.argv.slice(2)).then(code => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
