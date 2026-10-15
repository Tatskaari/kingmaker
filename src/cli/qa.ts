import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { setCallLog } from "../llm/openrouter.ts";
import { Game, type Observation } from "../game/play.ts";
import { town } from "../game/town.ts";
import { mapFights } from "../game/fights.ts";
import { townText } from "../game/views.ts";
import { sheetText } from "../rules/dnd.ts";
import { asciiMap } from "../world/scene-world.ts";
import { sessionDir } from "../runtime/session.ts";
import { transcriptMarkdown } from "../runtime/engine.ts";
import { sceneById } from "../../scenes/index.ts";
import { exploreState } from "../game/town.ts";
import { wingWorld } from "../game/zoo/explorer.ts";
import { loadZoo, newZoo } from "../game/zoo/game.ts";

/**
 * Headless QA for the playable game (V1's QA console, without the socket): observe the game, then
 * act with an action id from the latest observation ("talk_kell", "go_to_lead"), or, in a scene,
 * say something. State is saved between commands, so each command is its own process. It plays the
 * same game as the terminal app: Caerwyn on the isometric map (src/game/town.ts) and tactical
 * fights on the scene's own place (src/game/fights.ts). Or the zoo (qa new --zoo: src/game/zoo), where
 * every exhibit's trigger is an action (use_...), kept apart from the story.
 */

const fights = mapFights();

const USAGE = `Kingmaker playable game: headless QA

  qa new --session <id> --as "Name: concept" [--level 3] [--seed N]   start a game (builds your D&D character)
  qa new --session <id> --zoo [--seed N]       visit the zoo instead: every feature laid out to see and try
  qa observe --session <id>                     what you see, and the actions you can take
  qa act --session <id> --id <action id>        take an action from the latest observation (in a talk, say_1... says that line)
  qa say --session <id> <what you say or do>    in a scene: speak (plain words) or act (*asterisks* or (parentheses));
                                                in a fight the same, or a plain command ("attack sallow", "end turn"), read onto the turn's actions
  qa end --session <id> [--exit <exit id>]      for testing: end the scene now through one of its exits (lists them without --exit)
  qa sheet --session <id>                       your character sheet
  qa map --session <id> [--w 100] [--h 30]      the map where you are (in a scene: its place, and its world from above)
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
  options(o, id);
}

/** The hint and the actions (in a talk, its dialogue choices) without the text: after a turn that's just been shown. */
function options(o: Observation, id: string): void {
  if (o.hint) console.log(`\n(${o.hint} Use: qa say --session ${id} "...")`);
  if (o.actions.length) console.log(`\nACTIONS:\n${o.actions.map(a => `- ${a.id}: ${a.label}`).join("\n")}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  const id = flag(args, "session");
  if (!command || command === "help" || command === "--help" || !id) { console.log(USAGE); return; }
  setCallLog(join(sessionDir(id), "calls.jsonl"));
  if (command === "new" && args.includes("--zoo")) {
    const seed = flag(args, "seed");
    const game = await newZoo({ id, ...(seed ? { seed: Number(seed) } : {}) });
    console.log(`Zoo visit ${game.state.id}: you are ${game.session.player.name}, ${game.session.player.build}.\n`);
    print(game.observe(), id);
    return;
  }
  if (command === "new") {
    const who = flag(args, "as") ?? "Wren Ashdown: a quick-witted investigator lent to the case by the King";
    const level = Number(flag(args, "level") ?? 3);
    const seed = flag(args, "seed");
    const game = await Game.create({ player: who, level, id, ...(seed ? { seed: Number(seed) } : {}), explorer: town, fights });
    console.log(`Game ${game.state.id}: you are ${game.session.player.name}${game.session.player.build ? `, ${game.session.player.build}` : ""}.\n`);
    print(game.observe(), id);
    return;
  }
  if (!Game.exists(id)) throw new Error(`No game ${id}: start one with qa new --session ${id} --as "Name: concept"`);
  const game = Game.hubOf(id) === "zoo" ? loadZoo(id) : Game.load(id, town, fights);
  if (command === "observe") { print(game.observe(), id); return; }
  if (command === "act") {
    const action = flag(args, "id");
    if (!action) throw new Error("Usage: qa act --session <id> --id <action id>");
    console.log(await game.act(action));
    console.log();
    const now = game.observe();
    // In a scene, what just happened was the scene: don't print it twice.
    if (now.mode === "scene") { console.log("MODE: scene"); options(now, id); }
    else print(now, id);
    return;
  }
  if (command === "say") {
    const text = args.join(" ").trim();
    if (!text) throw new Error("Usage: qa say --session <id> <what you say or do>");
    console.log(await game.say(text));
    const now = game.observe();
    // Still in the scene: what just happened was the scene, so only a talk's next choices. A fight shows its board again, as act does.
    if (now.mode !== "scene") { console.log(); print(now, id); } else if (now.actions.length) { console.log(); options(now, id); }
    return;
  }
  if (command === "end") {
    if (game.state.mode !== "scene") throw new Error("Not in a scene.");
    const exit = flag(args, "exit");
    const exits = sceneById(game.session.sceneId).exits.filter(e => !game.session.fought?.includes(e.id));
    if (!exit || !exits.some(e => e.id === exit)) {
      console.log(`${exit ? `No exit "${exit}" here. ` : ""}Exits: ${exits.map(e => `${e.id} (${e.title})`).join(", ")}`);
      if (exit) process.exitCode = 1;
      return;
    }
    console.log(await game.endScene(exit));
    console.log();
    print(game.observe(), id);
    return;
  }
  if (command === "sheet") { console.log(await sheetText(game.session)); return; }
  if (command === "map") {
    // The map as the player sees it (in a scene, its place with everyone where they are now), then the scene's world from above.
    console.log(townText(game.state, game.session, { w: Number(flag(args, "w") ?? 100), h: Number(flag(args, "h") ?? 30) }));
    if (game.state.mode === "scene" && game.session.world) console.log(`\n${asciiMap(game.session.world)}`);
    // A zoo wing's world, from above.
    const wing = game.state.hub === "zoo" && game.state.mode === "explore" ? wingWorld(game.state, exploreState(game.state).map) : undefined;
    if (wing) console.log(`\n${asciiMap(wing)}`);
    return;
  }
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
