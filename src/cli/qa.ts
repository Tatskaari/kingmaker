import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { setCallLog } from "../llm/openrouter.ts";
import { applyFix, checkLore, finishBackstory, tooLong } from "../lore/backstory.ts";
import { cardText, ownBuild, threeBuilds, throughEngine, type Offer } from "../rules/builds.ts";
import type { Build } from "../rules/dnd.ts";
import type { Backstory } from "../runtime/session.ts";
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

  qa builds --session <id> --as "Name: concept" [--level 3]   three builds that fit, as the game offers them (qa new --build takes one)
  qa new --session <id> --as "Name: concept" [--level 3] [--seed N]   start a game (the model picks your D&D build)
      [--build 1|2|3]                           one of the three builds (qa builds' offer, or a new one)
      [--build own:<species>,<class>,<subclass>,<background>]   one of your own making, from the SRD's ids
      [--backstory "..." | --backstory-file <path>]   your backstory: checked against the lore (what doesn't fit is
                                                      said, with a fix); --accept-fixes takes the fixes (and checks once more)
  qa new --session <id> --zoo [--seed N]       visit the zoo instead: every feature laid out to see and try
  qa observe --session <id>                     what you see, and the actions you can take
  qa act --session <id> --id <action id>        take an action from the latest observation (in a talk, say_1... says that line)
  qa say --session <id> <what you say or do>    in a scene: speak (plain words) or act (*asterisks* or (parentheses))
  qa end --session <id> [--exit <exit id>]      for testing: end the scene now through one of its exits (lists them without --exit)
  qa sheet --session <id>                       your character sheet
  qa map --session <id> [--w 100] [--h 30]      the map where you are (in a scene: its place, and its world from above)
  qa transcript --session <id>                  the story so far
  qa dump --session <id> --output <dir> --description "<what went wrong>"   for bug reports only

Begin with observe; observe again after anything changes.`;

const DEFAULT_WHO = "Wren Ashdown: a quick-witted investigator lent to the case by the King";
const offerFile = (id: string) => join(sessionDir(id), "builds.json");

/**
 * The three builds for a concept, as qa builds offered them (kept with the session, so qa new
 * --build takes one of the same three); a new offer when there's none for this concept and level.
 */
async function offerFor(id: string, who: string, level: number, options: { fresh?: boolean } = {}): Promise<Offer> {
  const name = who.split(":")[0]!.trim(), concept = who.split(":").slice(1).join(":").trim() || who;
  if (!options.fresh && existsSync(offerFile(id))) {
    const kept = JSON.parse(readFileSync(offerFile(id), "utf8")) as { who: string; level: number; offer: Offer };
    if (kept.who === who && kept.level === level) return kept.offer;
  }
  const offer = await threeBuilds(name, concept, level);
  mkdirSync(sessionDir(id), { recursive: true });
  writeFileSync(offerFile(id), JSON.stringify({ who, level, offer }, null, 1));
  if (!options.fresh) console.log(`${offerText(offer)}\n`);
  return offer;
}

/** The three builds as text: each card, and why they're the class defaults when they are. */
function offerText(offer: Offer): string {
  return [...(offer.note ? [offer.note, ""] : []), ...offer.options.map((o, i) => `${i + 1}. ${cardText(o).replace(/\n/g, "\n   ")}`)].join("\n");
}

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
  if (command === "builds") {
    const who = flag(args, "as") ?? DEFAULT_WHO;
    const level = Number(flag(args, "level") ?? 3);
    const offer = await offerFor(id, who, level, { fresh: true });
    console.log(offerText(offer));
    console.log(`\n(qa new --session ${id} --as "${who}" --build 1, 2 or 3 takes one; --build own:<species>,<class>,<subclass>,<background> makes your own.)`);
    return;
  }
  if (command === "new") {
    const who = flag(args, "as") ?? DEFAULT_WHO;
    const level = Number(flag(args, "level") ?? 3);
    const seed = flag(args, "seed");
    const choice = flag(args, "build");
    const file = flag(args, "backstory-file");
    const story = file ? readFileSync(file, "utf8") : flag(args, "backstory");
    const accept = args.includes("--accept-fixes");
    // The build: one of the three, or one of their own; none, and the model picks one for the concept.
    let build: Build | undefined;
    if (choice) {
      const own = /^own:([\w-]+),([\w-]+),([\w-]*),([\w-]+)$/.exec(choice);
      if (own) {
        const made = await ownBuild({ speciesId: own[1]!, classId: own[2]!, ...(own[3] ? { subclassId: own[3] } : {}), backgroundId: own[4]! }, level, who.split(":")[0]!.trim());
        console.log(`Your own: ${made.line}\n${cardText(made)}\n`);
        build = made.build;
      } else {
        const n = Number(choice);
        if (![1, 2, 3].includes(n)) throw new Error(`--build is 1, 2 or 3, or own:<species>,<class>,<subclass>,<background> (not ${choice})`);
        const offer = await offerFor(id, who, level);
        const picked = offer.options[n - 1]!;
        console.log(`Build ${n} of three: ${picked.line}\n${cardText(picked)}\n`);
        build = picked.build;
      }
    }
    // The backstory: checked against the lore (what doesn't fit is said, never changed without --accept-fixes), then what it says of them.
    let backstory: Backstory | undefined;
    // As the game's box has it: no longer than the GM can be given every turn.
    const long = story ? tooLong(story) : undefined;
    if (long) throw new Error(`--backstory: ${long}`);
    if (story?.trim()) {
      const name = who.split(":")[0]!.trim(), concept = who.split(":").slice(1).join(":").trim();
      const line = build ? (await throughEngine(build, level, name)).line : undefined;
      const w = { name, concept, ...(line ? { build: line } : {}) };
      let text = story.trim();
      // Fixes taken are checked once more, as the screens do (a fix can miss too).
      for (let look = 0; look < 2; look++) {
        const checked = await checkLore(text, w);
        if (!checked.ok) console.log(`Backstory: ${checked.why}`);
        else if (!checked.value.length) console.log(look ? "Backstory: with the fixes in, it fits." : "Backstory: it fits the world's lore.");
        let fixes = 0;
        for (const issue of checked.ok ? checked.value : []) {
          console.log(`Backstory${look ? " (checked again)" : ""}: "${issue.quote ?? "(the GM couldn't point at the words)"}" doesn't fit: ${issue.problem}\n  A fix that keeps its spirit: "${issue.fix}"`);
          const fixed = accept ? applyFix(text, issue) : undefined;
          if (fixed !== undefined) { text = fixed; fixes++; console.log("  (fixed: --accept-fixes)"); }
          else console.log(accept ? "  (its words aren't in the backstory: rewrite it yourself)" : "  (not changed: --accept-fixes takes the fixes)");
        }
        if (!fixes) break;
      }
      backstory = await finishBackstory(text, w);
      console.log(`Who you are: ${backstory.summary}\n`);
    }
    const game = await Game.create({ player: who, level, id, ...(seed ? { seed: Number(seed) } : {}), ...(build ? { build } : {}), ...(backstory ? { backstory } : {}), explorer: town, fights });
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
    // Still in the scene: what just happened was the scene, so only a talk's next choices.
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
