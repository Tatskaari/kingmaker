// Copied from the prototype's src/rules/builds.ts:246-295 (askThree, threeBuilds) and src/rules/dnd.ts:289-297 (chooseBuild) with createCharacter's choosing, settling and style (:393-398) as pickBuild, at 44c6d4a: the engine handed in (rules), ask required (null is offline), DEFAULTS[id].plays read through classDefault, the three made one at a time with a turn of the event loop between (the engine is synchronous here), the engine's half from v2/shared/rules.
import { setImmediate as nextTurn } from "node:timers/promises";
import type * as Dnd from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { BUILD_FIELDS, BUILD_GUIDE, BUILD_SCHEMA, buildMenu, classDefault, classesFor, srdId, throughEngine, type Build, type BuildOption, type Offer, type Rules } from "../../shared/rules/index.ts";
import type { Ask } from "../llm/openrouter.ts";

/**
 * Character creation's builds, the model's half (v1-design §3.7): three distinct builds that fit a
 * concept, from one model call, and the model's one build for a concept when the player leaves it to
 * the GM. Each is made legal and made by the rules engine (shared/rules throughEngine), so its card
 * shows what the game will make of it. `ask` is the model, or a stand-in for it; null is offline,
 * and then the class defaults stand in, as the prototype's do with no key.
 */

interface Suggested extends Partial<Build> { plays?: string }

const THREE = ["first", "second", "third"] as const;

/** The model's three builds for a concept (one call): three classes, each a way to play who they are. */
async function askThree(rules: Rules, name: string, concept: string, level: number, ask: Ask): Promise<Suggested[]> {
  const content = rules.content;
  const one = { type: "object", additionalProperties: false, required: [...BUILD_FIELDS, "plays"], properties: { ...BUILD_SCHEMA,
    plays: { type: "string", description: "How they'd play, in one sentence for the player choosing: what they'd do first and what they're good at, in plain words (a feature's name is fine, no numbers)" } } };
  const answer = await ask<Record<(typeof THREE)[number], Suggested>>({
    operation: "rules.builds", effort: "low",
    instructions: `You turn a tabletop character concept into three D&D (2024 rules, SRD 5.2.1) builds for a level ${level} character, for the player to choose one from. Each fits who they are, and the three are different ways to play them: three different classes. If the concept names a class, the first is that class, done as the concept says. ${BUILD_GUIDE}`,
    input: [{ role: "user", content: [`Character concept: ${name}: ${concept}`, buildMenu(level, content)].join("\n\n") }],
    json: { name: "builds", schema: { type: "object", additionalProperties: false, required: [...THREE], properties: Object.fromEntries(THREE.map(k => [k, one])) } },
  });
  return THREE.map(k => answer[k]).filter((b): b is Suggested => !!b && typeof b === "object");
}

/**
 * Three distinct builds that fit a concept, each made legal and made by the engine (its card): the
 * model's, in one call; offline (or if the call fails), the class defaults that best match the
 * concept's words. Three different classes either way: one the model doubled is made up from the
 * defaults. `ask`: the model, or a stand-in for it; null: offline.
 */
export async function threeBuilds(rules: Rules, name: string, concept: string, level: number, options: { ask: Ask | null }): Promise<Offer> {
  const ask = options.ask;
  let suggested: Suggested[] = [];
  let note: string | undefined;
  if (!ask) note = "The GM is offline: three from the class defaults that best match your words.";
  else {
    try { suggested = await askThree(rules, name, concept, level, ask); }
    // What it means first, then why (the error, which is the part a narrow screen can lose).
    catch (error) { note = `The GM couldn't be reached, so here are three from the class defaults that best match your words (${error instanceof Error ? error.message.slice(0, 80) : String(error)}).`; }
  }
  const content = rules.content;
  const picked: Array<{ raw: Partial<Build>; plays: string; from: BuildOption["from"] }> = [];
  for (const s of suggested) {
    const id = typeof s.classId === "string" ? srdId(s.classId) : "";
    const classId = content.classes.has(id) ? id : undefined;
    if (!classId || picked.some(p => p.raw.classId === classId) || picked.length >= 3) continue;
    const { plays, ...raw } = s;
    picked.push({ raw: { ...raw, classId }, plays: plays?.trim() || classDefault(classId).plays, from: "model" });
  }
  for (const d of classesFor(concept)) {
    if (picked.length >= 3) break;
    if (!picked.some(p => p.raw.classId === d)) { const made = classDefault(d, concept); picked.push({ raw: made.build, plays: made.plays, from: "defaults" }); }
  }
  const options3 = await madeOneByOne(rules, picked, level, name);
  return { options: options3, ...(note ? { note } : {}) };
}

/**
 * Each build made by the engine in a turn of the event loop of its own: a build takes up to 160 ms
 * the first time its class is made, all of it synchronous, and the service is streaming other
 * games' replies meanwhile (the prototype's engine calls were async, so its three gave way too).
 */
async function madeOneByOne(rules: Rules, picked: Array<{ raw: Partial<Build>; plays: string; from: BuildOption["from"] }>, level: number, name: string): Promise<BuildOption[]> {
  const made: BuildOption[] = [];
  for (const p of picked) {
    await nextTurn();
    made.push({ ...throughEngine(rules, p.raw, level, name), plays: p.plays, from: p.from });
  }
  return made;
}

// ---------------------------------------------------------------------------------------------
// The model's one build: the prototype's createCharacter with no build given.

/** The model's build for a concept (one call), from the SRD's lists. */
async function chooseBuild(concept: string, level: number, content: Dnd.Content, ask: Ask): Promise<Build> {
  const build = await ask<Build>({
    operation: "rules.build", effort: "low",
    instructions: `You turn a tabletop character concept into a D&D (2024 rules, SRD 5.2.1) build for a level ${level} character. ${BUILD_GUIDE}`,
    input: [{ role: "user", content: [`Character concept: ${concept}`, buildMenu(level, content)].join("\n\n") }],
    json: { name: "build", schema: { type: "object", additionalProperties: false, required: [...BUILD_FIELDS], properties: BUILD_SCHEMA } },
  });
  return build;
}

/**
 * The build the model chooses for a concept, made legal by the engine with a Fighting Style to fit
 * its weapons (the model chose it, so a style is fitted where it gave none), and its card: what the
 * prototype's createCharacter makes when it's given no build. If the model can't be asked (offline)
 * or fails, the engine's own fallbacks stand in (settleBuild's), as they do there. How it plays is
 * its class's line.
 */
export async function pickBuild(rules: Rules, name: string, concept: string, level: number, options: { ask: Ask | null }): Promise<BuildOption> {
  let raw: Partial<Build> = {};
  let from: BuildOption["from"] = "defaults";
  if (options.ask) {
    try {
      raw = await chooseBuild(`${name}: ${concept}`, level, rules.content, options.ask);
      from = "model";
    } catch { /* the class defaults stand in */ }
  }
  const made = throughEngine(rules, raw, level, name);
  return { ...made, plays: classDefault(made.build.classId).plays, from };
}
