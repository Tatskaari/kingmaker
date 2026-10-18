import { STEP_ENDPOINT, type BackstoriesRequest, type BackstoryOp, type CharactersAsk, type CharactersRequest } from "../../shared/protocol/ai.ts";
import { keyParts, type CreationStep, type Step } from "../../shared/protocol/keys.ts";
import type { OwnPicks } from "../../shared/rules/types.ts";
import { Failure } from "./context.ts";

/**
 * What each think's endpoint reads of its request (v0-design §5.2, v1-design §3.7, full-gm-design
 * §4.1, world-bridge-design §3.1, story-design §4.4, town-design §3.6-3.8: a talk's open and settle,
 * the looks' things), checked before any model is asked, whichever
 * GM answers, and before a kept answer or the day's ceiling is looked at. A request without it is
 * the sender's mistake: 400 bad_request, which the module doesn't retry, rather than the endpoint's
 * TypeError, a 500 the module would retry for ten minutes (or an answer made from undefined, kept by
 * its key). It checks what the code reads, by the path it reads it at, not every field of the types.
 */
export function checkRequest(step: Step | CreationStep, body: unknown): void {
  const endpoint = STEP_ENDPOINT[step];
  if (endpoint === "/v1/characters") charactersAsk(body as CharactersRequest);
  else if (endpoint === "/v1/backstories") backstoryOp(body as BackstoriesRequest);
  else missingFrom(NEEDS[step as Step], body);
}

/** POST /v1/characters' ask, or a 400 for a request the endpoint can't read, or an ask that isn't its key's step's. */
export function charactersAsk(req: CharactersRequest): CharactersAsk {
  const step = keyParts(req.key)?.step as CreationStep;
  missing([
    !(typeof req.who?.name === "string" && req.who.name.trim()) && "who.name",
    typeof req.who?.concept !== "string" && "who.concept",
    !(Number.isInteger(req.level) && req.level >= 1 && req.level <= 20) && "a level from 1 to 20",
    req.ask?.kind === "own" && !picksRead(req.ask.picks) && "own's picks { speciesId, classId, subclassId?, backgroundId }",
  ]);
  if (STEP_ASK[step] !== req.ask?.kind) throw new Failure(400, "bad_request", `the ask is ${JSON.stringify(req.ask?.kind)}, not the key's step's (${step}: ${STEP_ASK[step]})`);
  return req.ask;
}

/** POST /v1/backstories' op, or a 400 for a request the endpoint can't read, or an op that isn't its key's step. */
export function backstoryOp(req: BackstoriesRequest): BackstoryOp {
  const step = keyParts(req.key)?.step;
  missing([
    !(typeof req.who?.name === "string" && req.who.name.trim()) && "who.name",
    typeof req.who?.concept !== "string" && "who.concept",
    req.who?.build !== undefined && typeof req.who.build !== "string" && "who.build (a line)",
    typeof req.text !== "string" && "the text (empty for a draft)",
  ]);
  if (req.op !== step) throw new Failure(400, "bad_request", `the op is ${JSON.stringify(req.op)}, not the key's step (${step})`);
  return req.op;
}

/** A part of a request, by its name in the 400, and whether a request has it. */
type Need = [what: string, has: (request: unknown) => boolean];

/** The GM's bookkeeping as the view copies it (gm/view.ts): its beat, its count, and its lists. */
const GM_LISTS = ["path", "established", "landed", "hinted", "opened", "pressureOffered", "patches", "entered", "absent"];
/** The world's rows as rowsToWorld reads them: the place, and a list of each component. */
const WORLD_LISTS = ["entity", "position", "area", "material", "health", "stack", "surface", "creature", "playerCharacter", "gear", "narrative", "gmNote", "worldLog"];

/** What a view of the scene is built from (gm/view.ts's ViewSource): an open's own, a turn's in its context ("turn."). */
const viewNeeds = (base: string): Need[] => [
  [`${base}gm (the scene's bookkeeping)`, r => isText(r, `${base}gm.beat`) && isNumber(r, `${base}gm.turnsInBeat`) && GM_LISTS.every(k => isList(r, `${base}gm.${k}`))],
  [`${base}world (the place's rows)`, r => isText(r, `${base}world.place.key`) && WORLD_LISTS.every(k => isList(r, `${base}world.${k}`))],
  [`${base}party (the controller's sheet, with a name and a concept)`, r => isText(r, `${base}party.0.name`) && isText(r, `${base}party.0.concept`)],
  [`${base}pc (the controller's character's key)`, r => /^pc:/.test(String(at(r, `${base}pc`)))],
];

const SCENE_AT: Need = ["turn.scene { key, turn }", r => isText(r, "turn.scene.key") && isNumber(r, "turn.scene.turn")];
const TRANSCRIPT: Need = ["turn.transcript", r => isList(r, "turn.transcript")];

/** Every think on a turn reads its context: the scene, the line, the transcript, and what the view is built from. */
const TURN: Need[] = [SCENE_AT, ["turn.line { text }", r => isText(r, "turn.line.text")], TRANSCRIPT, ...viewNeeds("turn.")];

/** A job beside a turn (its suggested lines) or after it (the memory reviews, the co-GM) reads the scene's context, which has no line (v5-design §3.6). */
const SCENE: Need[] = [SCENE_AT, TRANSCRIPT, ...viewNeeds("turn.")];

const STREAM: Need = ["stream { turn } (the draft it streams to)", r => isText(r, "stream.turn")];

/** The turn a job after it reviews. */
const REVIEWED: Need = ["reviewed (the turn reviewed)", r => isNumber(r, "reviewed")];

/** What a boundary reads besides the ended scene's context: the exit it ended by, and the scenes the story could go to (story-design §4.4). */
const BOUNDARY: Need[] = [
  ["exit (the exit the scene ended by)", r => isText(r, "exit")],
  ["candidates (the scenes the story could go to, at least one)", r => isList(r, "candidates") && (at(r, "candidates") as unknown[]).length > 0 && (at(r, "candidates") as unknown[]).every(c => typeof c === "string")],
];

/** A talk's open, when it's one (a scene's open has none): with whom, where, their record, the earlier talks' entries and whether lines are suggested. */
const TALK_OPEN: Need = [
  "talk { with, where, record { count, told }, earlier, suggest } (a talk's, when it's sent)",
  r => at(r, "talk") === undefined || (isText(r, "talk.with") && isText(r, "talk.where") && isNumber(r, "talk.record.count") && isList(r, "talk.record.told") && isList(r, "talk.earlier") && typeof at(r, "talk.suggest") === "boolean"),
];

const NEEDS: Record<Step, Need[]> = {
  open: [["scene { key }", r => isText(r, "scene.key")], ...viewNeeds(""), STREAM, TALK_OPEN],
  reactions: [...TURN, ["act { what, victims, property } (what the rules decided the player did)", r => isText(r, "act.what") && isList(r, "act.victims") && isList(r, "act.property")]],
  reply: [
    ...TURN, ["outcome { directives }", r => isList(r, "outcome.directives")], STREAM,
    ["outcome.windDown { exit } (the wind-down's, when it's sent)", r => at(r, "outcome.windDown") === undefined || isText(r, "outcome.windDown.exit")],
  ],
  settle: [
    ...TURN, ["reply (the reply's text)", r => isText(r, "reply")], ["lines (the turn's dice lines)", r => isList(r, "lines")], ["settled (what was settled before it)", r => isList(r, "settled")],
    ["talk { suggest } (a talk's, when it's sent)", r => at(r, "talk") === undefined || typeof at(r, "talk.suggest") === "boolean"],
    ["check { skill, dc, total, success, band } (the turn's check, when it's sent)", r => at(r, "check") === undefined || (isText(r, "check.skill") && isNumber(r, "check.dc") && isNumber(r, "check.total") && typeof at(r, "check.success") === "boolean" && isText(r, "check.band"))],
  ],
  suggest: [...SCENE, ["offered (the scene's last set)", r => isList(r, "offered")]],
  remember: [...SCENE, REVIEWED],
  boundary: [...SCENE, ...BOUNDARY],
  look: [["things [{ key, name }] (what to invent a look for, at least one)", r => isList(r, "things") && (at(r, "things") as unknown[]).length > 0 && (at(r, "things") as Array<{ key?: unknown; name?: unknown }>).every(t => typeof t?.key === "string" && typeof t.name === "string")]],
};

/** The value at a dotted path of the parsed JSON ("turn.party.0.name"), or undefined where the path breaks. */
function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => (v !== null && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined), value);
}

const isText = (r: unknown, path: string) => typeof at(r, path) === "string";
const isNumber = (r: unknown, path: string) => typeof at(r, path) === "number";
const isList = (r: unknown, path: string) => Array.isArray(at(r, path));

/** A 400 naming what a request is missing, if anything. */
function missing(gaps: Array<string | false>): void {
  const named = gaps.filter(Boolean);
  if (named.length) throw new Failure(400, "bad_request", `the request is missing ${named.join(", ")}`);
}

function missingFrom(needs: Need[], body: unknown): void {
  missing(needs.map(([what, has]) => !has(body) && what));
}

/** Which ask each character step's key is for. */
const STEP_ASK: Partial<Record<CreationStep, CharactersAsk["kind"]>> = { offer: "three", pick: "one", own: "own" };

const picksRead = (p: OwnPicks | undefined) => !!p && [p.speciesId, p.classId, p.backgroundId].every(id => typeof id === "string") && (p.subclassId === undefined || typeof p.subclassId === "string");
