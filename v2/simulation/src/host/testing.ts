import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Identity } from "spacetimedb";
import type { RollResult } from "../../../shared/dice.ts";
import type { Backstory } from "../../../shared/creation/types.ts";
import type { BackstoriesRequest, BackstoriesResponse, CharactersRequest, CharactersResponse, DecideResponse, NotesResponse, OpenResponse, ReplyResponse, SettleResponse, SuggestResponse, Usage } from "../../../shared/protocol/ai.ts";
import { CREATION_STEPS, type CreationStep } from "../../../shared/protocol/keys.ts";
import { gmFromRow } from "../../../shared/gm/state.ts";
import { rollFor } from "../../../shared/rules/index.ts";
import type { BuildOption, OwnPicks, SrdLists } from "../../../shared/rules/types.ts";
import type { MapFile } from "../../../shared/map/tiles.ts";
import { installArgsOf, type BuildsFile, type CampaignFile, type CampaignPack, type InstallArgs, type LooksFile, type PlaceFile, type SceneFile } from "../../../shared/scene/files.ts";
import type { Skill } from "../../../shared/scene/types.ts";
import { playerRow } from "../rows.ts";
import { engineCall, sessionOf } from "../rules/session.ts";
import { memoryHost, type AiPost, type AiReply, type MemoryHost } from "./memory.ts";

/**
 * Test support for the memory host: the hanged clerk's campaign as install_campaign takes it (the
 * campaign folder's own files), players' identities, and a scripted AI service that answers each
 * endpoint from a queue (or a default) and keeps every request it was sent.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "..", "campaigns", "caerwyn");
const read = (path: string) => readFileSync(join(CAERWYN, path), "utf8");

/** campaigns/caerwyn as install_campaign takes it: no Markdown but each scene's hook. */
export function caerwynPack(): CampaignPack {
  const campaign = JSON.parse(read("campaign.json")) as CampaignFile;
  return {
    campaign,
    scenes: campaign.scenes.map(key => ({ scene: JSON.parse(read(`scenes/${key}/scene.json`)) as SceneFile, hook: read(`scenes/${key}/hook.md`).trim() })),
    places: campaign.places.map(key => JSON.parse(read(`places/${key}.json`)) as PlaceFile),
    builds: JSON.parse(read("builds.json")) as BuildsFile,
    looks: JSON.parse(read("looks.json")) as LooksFile,
    maps: (campaign.maps ?? []).map(key => JSON.parse(read(`maps/${key}.json`)) as MapFile),
  };
}

export const caerwynArgs = (): InstallArgs => installArgsOf(caerwynPack());

/** A player's identity, by a number. */
export const identity = (n: number) => new Identity(BigInt(0x1000 + n));

// ---------------------------------------------------------------------------------------------
// A scripted AI service.

/** A turn's steps (its own, and the notes and the lines beside it), and character creation's (named from the request: /v1/characters' ask, /v1/backstories' op). */
export type Step = "open" | "decide" | "reply" | "settle" | "notes" | "suggest" | CreationStep;

/** What an endpoint answers: the answer itself (200, as JSON), another HTTP reply, a thrown error (a refused connection), or a function of the request that gives one of those. */
export type Scripted = unknown | { http: AiReply } | ((request: any, headers: Record<string, string>) => unknown);

export interface Sent { step: Step; key: string; attempt: string; body: any }

const usage = (calls: number, costUsd: number): Usage => ({ calls, costUsd, byOperation: {} });

/**
 * The answers each endpoint gives when the script has nothing queued for it. The opening and the
 * reply carry no markup, so nothing is noted unless a test says what's said; the lines are four.
 */
export const DEFAULTS: { open: OpenResponse; decide: DecideResponse; reply: ReplyResponse; settle: SettleResponse; notes: NotesResponse; suggest: SuggestResponse } = {
  open: { present: ["kell", "cob", "moll"], entries: [{ speaker: "gm", kind: "narration", text: "Sergeant Kell looks up from her notebook as you come through the gate. \"You'll be the King's investigator.\"" }], opened: [], usage: usage(2, 0.002) },
  decide: { decision: { earned: false, daft: false, outOfCharacter: false }, opened: [], usage: usage(1, 0.0005) },
  reply: { entries: [{ speaker: "gm", kind: "narration", text: "Kell taps her pencil on the notebook. \"Noted.\"" }], gm: { repeated: null }, firstTextMs: 3, usage: usage(1, 0.001) },
  settle: { ops: [], after: { landed: [], hinted: [], unanswered: false, theirs: false }, usage: usage(2, 0.0007) },
  notes: { marks: [], usage: usage(1, 0.0002) },
  suggest: {
    lines: [
      { kind: "say", text: "Who found him, Sergeant?" },
      { kind: "say", text: "Did anyone see him go up to the loft?" },
      { kind: "do", text: "(I look up at the hoist)" },
      { kind: "try", text: "(I try to get the boy talking with a penny)" },
    ],
    dropped: [], usage: usage(2, 0.0008),
  },
};

const STEPS: Record<string, Step> = {
  "/v1/scenes/open": "open", "/v1/turns/decide": "decide", "/v1/turns/reply": "reply", "/v1/turns/settle": "settle", "/v1/turns/notes": "notes", "/v1/turns/suggest": "suggest",
};

/** A creation request's step: the builds asked for, or what's asked of the backstory. */
function creationStepOf(endpoint: string, request: { ask?: { kind?: string }; op?: string }): Step | undefined {
  if (endpoint === "/v1/characters") return request.ask?.kind === "three" ? "offer" : request.ask?.kind === "one" ? "pick" : request.ask?.kind === "own" ? "own" : undefined;
  if (endpoint === "/v1/backstories") return CREATION_STEPS.find(s => s === request.op);
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Character creation's answers, as the AI service gives them (v1-design §3.7): builds.json's builds as the cards on offer.

const READY = (JSON.parse(read("builds.json")) as BuildsFile);

/** One of builds.json's builds as a card on offer (its card's numbers are a stand-in's: the sheet is the engine's). */
export function optionOf(id: string, from: BuildOption["from"] = "model"): BuildOption {
  const build = READY[id]!.build;
  return {
    build, plays: `Plays as a ${id}.`, line: LINES[id]!, from,
    card: { species: build.speciesId, className: build.classId, subclass: build.subclassId, background: build.backgroundId, level: 3, hp: 20, ac: 14, speed: 30, features: [], skills: build.skills },
  };
}

/** The engine's build lines for builds.json's builds (what its sheets say). */
const LINES: Record<string, string> = {
  cleric: "dwarf cleric 3 (Life Domain), acolyte background", fighter: "human fighter 3 (Champion), soldier background",
  ranger: "elf ranger 3 (Hunter), soldier background", rogue: "halfling rogue 3 (Thief), criminal background", wizard: "human wizard 3 (Evoker), sage background",
};

/** What a player picks from to make their own: a few of the SRD's, as the AI service sends them with an own answer. */
export const LISTS: SrdLists = {
  species: ["dwarf", "elf", "gnome", "halfling", "human", "orc"].map(id => ({ id, name: id, about: "" })),
  classes: ["cleric", "fighter", "rogue", "wizard"].map(id => ({ id, name: id, about: "" })),
  subclasses: { cleric: [{ id: "life-domain", name: "Life Domain", about: "" }], fighter: [{ id: "champion", name: "Champion", about: "" }], rogue: [{ id: "thief", name: "Thief", about: "" }], wizard: [{ id: "evoker", name: "Evoker", about: "" }] },
  backgrounds: ["acolyte", "criminal", "sage", "soldier"].map(id => ({ id, name: id, about: "" })),
  level: 3,
  subclassLevel: { cleric: 3, fighter: 3, rogue: 3, wizard: 3 },
};

/** The player's own picks as a card: builds.json's build of that class with their species, subclass and background. */
export function ownOption(picks: OwnPicks): BuildOption {
  const base = optionOf(picks.classId, "own");
  const build = { ...base.build, speciesId: picks.speciesId, backgroundId: picks.backgroundId, subclassId: picks.subclassId ?? "" };
  return { ...base, build, line: `${picks.speciesId} ${picks.classId} 3 (${picks.subclassId ?? "none"}), ${picks.backgroundId} background`, from: "own" };
}

/** A backstory's traits, from its words. */
export const traitsOf = (text: string): Backstory => ({ text, summary: `Who they are: ${text.slice(0, 40)}`, personality: ["Dry"], ideals: ["Truth"], bonds: ["The King"], flaws: ["Debt"] });

type CreationAnswer = (request: any) => CharactersResponse | BackstoriesResponse;

/** Each creation step's answer when the script has none queued: three of builds.json's, the cleric, the player's own, a draft, notes worked in, a story that fits, its traits. */
export const CREATION_DEFAULTS: Record<CreationStep, CreationAnswer> = {
  offer: () => ({ offer: { options: [optionOf("rogue"), optionOf("wizard"), optionOf("fighter")] }, usage: usage(1, 0.002) }),
  pick: () => ({ option: optionOf("cleric"), usage: usage(1, 0.001) }),
  own: (request: CharactersRequest) => ({ option: ownOption((request.ask as { picks: OwnPicks }).picks), lists: LISTS, usage: usage(0, 0) }),
  draft: () => ({ asked: { ok: true, value: "I kept the palace's ledgers for nine years, until the numbers stopped adding up." }, usage: usage(1, 0.001) }),
  work: (request: BackstoriesRequest) => ({ asked: { ok: true, value: `In my own words: ${request.text}` }, usage: usage(1, 0.001) }),
  check: () => ({ checked: { ok: true, value: [] }, usage: usage(1, 0.001) }),
  traits: (request: BackstoriesRequest) => ({ backstory: traitsOf(request.text), usage: usage(1, 0.001) }),
};

/** An answer that isn't 200. */
export const http = (status: number, body: unknown = { error: { code: status === 400 ? "bad_request" : "model_failed", message: "scripted" } }): { http: AiReply } => ({ http: { status, body: JSON.stringify(body) } });

/** The AI service unreachable: the POST throws, as SpacetimeDB's fetch does on a refused connection. */
export const down = () => () => {
  const refused = new Error("error sending request for url (http://11.0.0.1:8787/v1/turns/decide): tcp connect error: Connection refused (os error 111)");
  refused.name = "HttpError";
  throw refused;
};

export function scriptedAi() {
  const sent: Sent[] = [];
  const queues: Record<Step, Scripted[]> = { open: [], decide: [], reply: [], settle: [], notes: [], suggest: [], offer: [], pick: [], own: [], draft: [], work: [], check: [], traits: [] };

  const ai: AiPost = async (endpoint, body, headers) => {
    const request = JSON.parse(body) as { key: string; ask?: { kind?: string }; op?: string };
    const step = STEPS[endpoint] ?? creationStepOf(endpoint, request);
    if (!step) return { status: 404, body: JSON.stringify({ error: { code: "bad_request", message: `no ${endpoint}` } }) };
    sent.push({ step, key: request.key, attempt: headers["x-km-attempt"] ?? "", body: request });

    const next = queues[step].length ? queues[step].shift() : { ...DEFAULTS, ...CREATION_DEFAULTS }[step];
    const answer = typeof next === "function" ? await (next as (r: unknown, h: Record<string, string>) => unknown)(request, headers) : next;
    return isHttp(answer) ? answer.http : { status: 200, body: JSON.stringify(answer) };
  };

  return {
    ai,
    sent,
    /** Answers for a step, in order, before its default comes back. */
    then(step: Step, ...answers: Scripted[]) {
      queues[step].push(...answers);
    },
    /** The requests sent to a step. */
    to: (step: Step) => sent.filter(s => s.step === step),
  };
}

const isHttp = (answer: unknown): answer is { http: AiReply } => typeof answer === "object" && answer !== null && "http" in answer;

/** A promise the test settles when it likes: a POST still in flight. */
export function held<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>(resolve => { settle = resolve; });
  return { promise, settle };
}

/** Lets a drain run until it waits on a POST that's held. */
export const tick = () => new Promise(resolve => setImmediate(resolve));

// ---------------------------------------------------------------------------------------------
// Games.

/** A memory host with the hanged clerk installed, and its scripted AI service. */
export function hostWithCampaign(seed = 7) {
  const script = scriptedAi();
  const host = memoryHost({ ai: script.ai, seed });
  const refused = host.as(host.owner).installCampaign(caerwynArgs());
  if (refused) throw new Error(`the install was refused: ${refused.text}`);
  return { host, script };
}

/** A new game, its opening committed: the scene live and the player's line next. */
export async function openedGame(seed = 7, build = "ranger") {
  const { host, script } = hostWithCampaign(seed);
  const wren = identity(1);
  const refused = host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build });
  if (refused) throw new Error(`new_game was refused: ${refused.text}`);
  await host.drain();
  const scene = all(host.db.scene)[0]!;
  return { host, script, wren, scene, player: host.db.player.id.find(scene.controllerId)! };
}

/** A character made through creation (three builds offered, one chosen, no backstory): the game made, not yet begun. */
export async function madeCharacter(host: MemoryHost, who: Identity, options: { name?: string; index?: number; story?: string } = {}) {
  const made = (refused: { text: string } | undefined) => {
    if (refused) throw new Error(`creation was refused: ${refused.text}`);
  };
  made(host.as(who).startCreation({ campaign: "caerwyn", name: options.name ?? "Tamsin Vell", concept: "a disgraced palace auditor", how: "three" }));
  await host.drain();
  made(host.as(who).chooseBuild({ index: options.index ?? 0 }));
  made(options.story ? host.as(who).finishBackstory({ text: options.story }) : host.as(who).skipBackstory());
  await host.drain();
  const creation = host.view(who).myCreation()!;
  const game = host.db.game.id.find(creation.gameId!)!;
  return { creation, game, player: host.db.player.id.find(game.hostId)! };
}

/** Every row of a table. */
export const all = <T>(table: { iter(): Iterable<T> }): T[] => [...table.iter()];

/** A scene's rows as a test reads them: its turns by n, its transcript's lines in order. */
export function sceneNow(host: MemoryHost, sceneId: bigint) {
  return {
    scene: host.db.scene.id.find(sceneId)!,
    turns: [...host.db.turn.sceneId.filter(sceneId)].sort((a, b) => a.n - b.n),
    lines: [...host.db.transcript.sceneId.filter(sceneId)].sort((a, b) => a.seq - b.seq),
    gm: gmFromRow(host.db.gmState.sceneId.find(sceneId)!),
    jobs: all(host.db.job),
  };
}

/** What the rules engine rolls next for a player's check, as the rows stand now (the check that rolls it writes the count; this writes nothing). */
export function nextCheck(host: MemoryHost, playerId: bigint, skill: Skill, dc: number): RollResult {
  return host.transact(tx => {
    const player = playerRow(tx, playerId);
    const session = sessionOf(tx, player);
    return engineCall(tx, player.gameId, rules => rollFor(rules, session, skill, dc));
  });
}
