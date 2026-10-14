import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { setCallLog } from "../llm/openrouter.ts";
import { Game, type Observation } from "../game/play.ts";
import { places } from "../game/places.ts";
import { tacticalFights } from "../game/combat/fights.ts";
import { battlefield } from "../game/map/index.ts";
import { heronMap } from "../game/combat/heron-grid.ts";
import { sheetText } from "../rules/dnd.ts";
import { asciiMap } from "../world/scene-world.ts";
import { sessionDir } from "../runtime/session.ts";
import { transcriptMarkdown } from "../runtime/engine.ts";

/**
 * Headless QA for the playable game (V1's QA console, without the socket): observe the game, then
 * act with an action id from the latest observation ("talk_kell", "go_river_stairs"), or, in a
 * scene, say something. State is saved between commands, so each command is its own process.
 */

/** Tactical combat on the map module's Heron (its battlefield, reconciled from the scene's world). */
const fights = tacticalFights({ map: session => (session.world ? battlefield(session.sceneId, session.world)?.map : undefined) ?? heronMap() });

const USAGE = `Kingmaker playable game: headless QA

  qa new --session <id> --as "Name: concept" [--level 3] [--seed N]   start a game (builds your D&D character)
  qa observe --session <id>                     what you see, and the actions you can take
  qa act --session <id> --id <action id>        take an action from the latest observation
  qa say --session <id> <what you say or do>    in a scene: speak (in quotes) or act (plain words)
  qa sheet --session <id>                       your character sheet
  qa map --session <id>                         a sketch of the current scene's place (in scenes that have one)
  qa transcript --session <id>                  the story so far
  qa dump --session <id> --output <dir> --description "<what went wrong>"   for bug reports only

Begin with observe; observe again after anything changes.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

function print(o: Observation, id: string): void {
  console.log(`MODE: ${o.mode}\n\n${o.text}`);
  if (o.hint) console.log(`\n(${o.hint} Use: qa say --session ${id} "...")`);
  if (o.actions.length) console.log(`\nACTIONS:\n${o.actions.map(a => `- ${a.id}: ${a.label}`).join("\n")}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  const id = flag(args, "session");
  if (!command || command === "help" || command === "--help" || !id) { console.log(USAGE); return; }
  setCallLog(join(sessionDir(id), "calls.jsonl"));
  if (command === "new") {
    const who = flag(args, "as") ?? "Wren Ashdown: a quick-witted investigator lent to the case by the King";
    const level = Number(flag(args, "level") ?? 3);
    const seed = flag(args, "seed");
    const game = await Game.create({ player: who, level, id, ...(seed ? { seed: Number(seed) } : {}), explorer: places, fights });
    console.log(`Game ${game.state.id}: you are ${game.session.player.name}${game.session.player.build ? `, ${game.session.player.build}` : ""}.\n`);
    print(game.observe(), id);
    return;
  }
  if (!Game.exists(id)) throw new Error(`No game ${id}: start one with qa new --session ${id} --as "Name: concept"`);
  const game = Game.load(id, places, fights);
  if (command === "observe") { print(game.observe(), id); return; }
  if (command === "act") {
    const action = flag(args, "id");
    if (!action) throw new Error("Usage: qa act --session <id> --id <action id>");
    console.log(await game.act(action));
    console.log();
    const now = game.observe();
    // In a scene, what just happened was the scene: don't print it twice.
    if (now.mode === "scene") console.log(`MODE: scene\n(${now.hint} Use: qa say --session ${id} "...")`);
    else print(now, id);
    return;
  }
  if (command === "say") {
    const text = args.join(" ").trim();
    if (!text) throw new Error("Usage: qa say --session <id> <what you say or do>");
    console.log(await game.say(text));
    if (game.state.mode !== "scene") { console.log(); print(game.observe(), id); }
    return;
  }
  if (command === "sheet") { console.log(await sheetText(game.session)); return; }
  if (command === "map") { console.log(game.session.world ? asciiMap(game.session.world) : "(No map for this place yet.)"); return; }
  if (command === "transcript") { console.log(transcriptMarkdown(game.session, { allScenes: true })); return; }
  if (command === "dump") {
    const output = flag(args, "output");
    const description = flag(args, "description") ?? "";
    if (!output || !isAbsolute(output)) throw new Error("dump needs an absolute --output directory");
    if (existsSync(output)) throw new Error(`${output} already exists`);
    mkdirSync(dirname(output), { recursive: true });
    cpSync(sessionDir(id), output, { recursive: true });
    writeFileSync(join(output, "REPORT.md"), `# QA dump: ${id}\n\n${description}\n\nMode: ${game.state.mode}; scene: ${game.session.sceneId}; turn ${game.session.turn}.\n`);
    console.log(output);
    return;
  }
  console.log(USAGE);
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
