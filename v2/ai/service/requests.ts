import type { Step } from "../../shared/protocol/keys.ts";
import { Failure } from "./context.ts";

/**
 * What each think's endpoint reads of its request (v0-design §5.2), checked before any model is
 * asked, whichever GM answers. A request without it is the sender's mistake: 400 bad_request, which
 * the module doesn't retry, rather than the endpoint's TypeError, a 500 the module would retry for
 * ten minutes (or an answer made from undefined, kept by its key). It checks what the code reads,
 * by the path it reads it at, not every field of the types.
 */
export function checkRequest(step: Step, body: unknown): void {
  const missing = NEEDS[step].filter(([, has]) => !has(body)).map(([what]) => what);
  if (missing.length) throw new Failure(400, "bad_request", `the request is missing ${missing.join(", ")}`);
}

/** A part of a request, by its name in the 400, and whether a request has it. */
type Need = [what: string, has: (request: unknown) => boolean];

/** The GM's bookkeeping as the view copies it (gm/view.ts): its beat, its count, and its lists. */
const GM_LISTS = ["path", "established", "landed", "hinted", "opened", "oocTurns", "pressureOffered", "canon", "patches", "entered", "absent", "whispers"];
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

/** A job beside a turn (its notes, its suggested lines) reads the scene's context, which has no line (v5-design §3.6). */
const SCENE: Need[] = [SCENE_AT, TRANSCRIPT, ...viewNeeds("turn.")];

const STREAM: Need = ["stream { turn } (the draft it streams to)", r => isText(r, "stream.turn")];

const NEEDS: Record<Step, Need[]> = {
  open: [["scene { key }", r => isText(r, "scene.key")], ...viewNeeds(""), STREAM],
  decide: TURN,
  reply: [...TURN, ["decision", r => isObject(r, "decision")], ["outcome { directives }", r => isList(r, "outcome.directives")], STREAM],
  settle: [...TURN, ["reply (the reply's text)", r => isText(r, "reply")], ["lines (the turn's dice lines)", r => isList(r, "lines")], ["settled (what was settled before it)", r => isList(r, "settled")]],
  notes: [...SCENE, ["reply { seq, text, speech, drafted }", r => isNumber(r, "reply.seq") && isText(r, "reply.text") && isList(r, "reply.speech") && isList(r, "reply.drafted")]],
  suggest: [...SCENE, ["offered (the scene's last set)", r => isList(r, "offered")]],
};

/** The value at a dotted path of the parsed JSON ("turn.party.0.name"), or undefined where the path breaks. */
function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => (v !== null && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined), value);
}

const isText = (r: unknown, path: string) => typeof at(r, path) === "string";
const isNumber = (r: unknown, path: string) => typeof at(r, path) === "number";
const isList = (r: unknown, path: string) => Array.isArray(at(r, path));
const isObject = (r: unknown, path: string) => { const v = at(r, path); return v !== null && typeof v === "object" && !Array.isArray(v); };
