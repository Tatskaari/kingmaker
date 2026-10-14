import { applyOps, areaAt, areaOf, distance, positionOf, worldView, type Entity, type Point, type SceneWorld, type WorldOp } from "../../src/world/scene-world.ts";
import { sceneById } from "../../scenes/index.ts";

/**
 * The world language as the eval proposes it (docs/research/gm-world-interface.md), built on the
 * world module without changing it, so the proposals can be measured before they're adopted:
 *
 * - ids only: every "what" and "to" is an id from the world, enforced by the JSON schema (no names,
 *   no "beside moll", no groups: a group selector once moved a whole tavern to the bar);
 * - distance: place "away" from or "toward" something, by so many feet ("thirty feet back down
 *   the lane", which an area or "near" can't say, and which decides who a Fireball catches);
 * - forget: clear notes that have stopped being true (notes otherwise linger until pushed out);
 * - the view shows the player like everyone else (their spot, states and notes), and who's who
 *   (the story often says "the pot-boy", not "Cob").
 */

export interface WorldOpV2 extends Omit<WorldOp, "op"> { op: WorldOp["op"] | "forget"; feet: number }

export const OPS_V2 = ["move", "place", "give", "drop", "create", "state", "note", "forget", "remove", "destroy"] as const;
export const HOWS_V2 = ["", "near", "behind", "beside", "under", "on", "in", "away", "toward"] as const;

export const WORLD_LANGUAGE_V2 = `Operations. Every operation has every field; leave the ones it doesn't use as "", 0 or []. "what" and "to" are always ids from the world (in brackets), never names.
- move: "what" (someone or something) goes to an area ("to" = an area id), or to beside someone or something ("to" = their id).
- place: "what" goes near, behind, beside, under, on or in something ("to", "how"). "behind" also notes it on both. Also distances: "how": "away" puts "what" "feet" feet from "to" (on the far side from where it was, or wherever there's room), "toward" moves "what" "feet" feet closer to "to".
- give: "what" (a thing) is now held by someone, or put in a container ("to").
- drop: "what" is put down ("to": near something, or "" where its holder stands).
- create: someone or something new the story has just brought in: "name", "kind" (person, creature, object, item), "to" (an area, someone or something to be near; for an item, a person "to" means it's in their hands), "text" (who or what they are).
- state: "what" gains ("add") or loses ("remove") states: burning, wet, broken, open, closed, locked, barred, overturned, hidden, prone, unconscious, asleep, lit, dark, slick, poisoned, tied-up, sitting, crouching...
- note: something worth remembering about "what" ("text"), written about it alone (also noted on "to" only when it's true of both).
- forget: "what"'s notes stop being true (it moved on, stopped doing it): clears those containing "text", or all of them when "text" is "".
- remove: someone or something leaves the scene ("text": where to).
- destroy: "what" is wrecked ("text": what's left of it).`;

export function opSchemaV2(world: SceneWorld, options: { freeIds?: boolean } = {}): Record<string, unknown> {
  const ids = ["", ...Object.keys(world.entities).filter(id => id !== world.root)];
  const id = options.freeIds ? { type: "string" } : { type: "string", enum: ids };
  return {
    type: "object", additionalProperties: false, required: ["ops"],
    properties: {
      ops: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["op", "what", "to", "how", "feet", "name", "kind", "text", "add", "remove"],
          properties: {
            op: { type: "string", enum: [...OPS_V2] },
            what: id, to: id,
            how: { type: "string", enum: [...HOWS_V2] }, feet: { type: "integer" },
            name: { type: "string" }, kind: { type: "string", enum: ["", "person", "creature", "object", "item"] }, text: { type: "string" },
            add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}

const STOP = new Set(["the", "a", "an", "of", "and", "with", "his", "her", "their", "its", "s", "by", "to", "in", "on", "at"]);
const words = (t: string) => t.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => w && !STOP.has(w));
const HOW_WORDS: Record<string, string> = { near: "near", by: "near", beside: "beside", next: "beside", behind: "behind", under: "under", beneath: "under", on: "on", onto: "on", atop: "on", in: "in", into: "in", inside: "in", at: "near", to: "" };

/**
 * A forgiving reading of a selector written by a model: an id, a name without its article or
 * possessive ("granary yard doors" is "the granary's yard doors"), or a preposition and a name
 * ("beside moll" is how "beside", to "moll"). Word overlap decides between names, and only a
 * clear winner counts: an ambiguous selector is reported, not guessed.
 */
export function resolveSelector(world: SceneWorld, selector: string): { id?: string; how?: string } {
  let s = selector.trim();
  if (!s) return {};
  if (world.entities[s]) return { id: s };
  let how: string | undefined;
  const away = /^(away from|towards?)\s+(.+)$/i.exec(s);
  const m = away ? undefined : /^(near|by|beside|next to|behind|under|beneath|on|onto|atop|in|into|inside|at|to)\s+(.+)$/i.exec(s);
  if (away) { how = /^away/i.test(away[1]!) ? "away" : "toward"; s = away[2]!; }
  else if (m) { how = HOW_WORDS[m[1]!.toLowerCase().split(" ")[0]!]; s = m[2]!; }
  // "between player and moll": the first of them.
  s = s.replace(/^between\s+/i, "").split(/\s+and\s+/i)[0]!;
  if (world.entities[s]) return { id: s, ...(how ? { how } : {}) };
  const want = words(s);
  if (!want.length) return {};
  const live = Object.values(world.entities).filter(e => !e.states.includes("gone") && e.kind !== "place");
  const scored = live.map(e => {
    const have = new Set([...words(e.name), ...words(e.id.replace(/-/g, " "))]);
    const hits = want.filter(w => have.has(w) || [...have].some(h => h.length > 3 && w.length > 3 && (h.startsWith(w) || w.startsWith(h)))).length;
    return { e, score: hits / want.length, extra: have.size };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.extra - b.extra);
  const [best, next] = scored;
  if (!best || best.score < 0.6 || (next && next.score === best.score && next.extra === best.extra)) return {};
  return { id: best.e.id, ...(how ? { how } : {}) };
}

/** A free-text operation resolved to ids against the world as it stands (the alternative to enforcing ids in the schema). */
export function resolveOp(world: SceneWorld, op: WorldOpV2): { op?: WorldOpV2; problem?: string } {
  const next = { ...op };
  if (op.op !== "create" && op.what) {
    const r = resolveSelector(world, op.what);
    if (!r.id) return { problem: `${op.op}: nothing matches "${op.what}"` };
    next.what = r.id;
  }
  if (op.to) {
    const r = resolveSelector(world, op.to);
    if (!r.id) {
      if (op.op !== "create") return { problem: `${op.op}: nothing matches "${op.to}"` };
      next.to = "";
    } else {
      next.to = r.id;
      if (r.how && !op.how && (op.op === "move" || op.op === "place")) { next.op = "place"; next.how = r.how; }
    }
  }
  return { op: next };
}

/** Apply the extended operations in order: the extensions here, the rest through the world module. With `resolve`, free-text selectors are read forgivingly first. */
export function applyOpsV2(world: SceneWorld, input: WorldOpV2[], turn: number, by: "stage" | "rules" = "stage", options: { resolve?: boolean } = {}): { changes: string[]; problems: string[] } {
  const changes: string[] = [];
  const problems: string[] = [];
  for (const raw of input) {
    let op = raw;
    if (options.resolve) {
      const r = resolveOp(world, raw);
      if (!r.op) { problems.push(r.problem!); continue; }
      op = r.op;
    }
    const e = op.what ? world.entities[op.what] : undefined;
    if ((op.op === "move" || op.op === "place") && (op.how === "away" || op.how === "toward")) {
      const ref = world.entities[op.to];
      if (!e || !ref) { problems.push(`${op.op} ${op.how}: unknown "${!e ? op.what : op.to}"`); continue; }
      const at = op.how === "away" ? awayFrom(world, e, ref, op.feet || 30) : toward(world, e, ref, op.feet || 10);
      e.notes = e.notes.filter(n => n.by !== "author" && !/^(behind|under|on|in|beside) /i.test(n.text));
      e.at = at;
      e.parent = areaAt(world, at).id;
      const text = `${e.name} is ${Math.round(distance(at, positionOf(world, ref.id)!))} ft ${op.how === "away" ? "from" : "nearer"} ${ref.name}`;
      changes.push(text);
      world.log.push({ turn, text, by });
      continue;
    }
    // Saying where someone already is isn't a move: "Kell is in the doorway" mustn't scatter her to
    // a random spot in it, and "beside the bar" when they're at the bar mustn't shuffle them.
    if ((op.op === "move" || op.op === "place") && e && (op.how === "" || op.how === "near")) {
      const dest = world.entities[op.to];
      const here = positionOf(world, e.id), there = dest ? positionOf(world, dest.id) : undefined;
      const holder = e.parent ? world.entities[e.parent] : undefined;
      const loose = !holder || holder.kind === "area" || holder.kind === "place";
      const stays = dest && loose && ((dest.kind === "area" || dest.kind === "place") ? areaOf(world, e.id)?.id === dest.id : !!here && !!there && distance(here, there) <= 5);
      if (stays) {
        // They stay put, but the story has moved them on from the opening tableau: its notes go, as on any move.
        e.notes = e.notes.filter(n => n.by !== "author" && !/^(behind|under|on|in|beside) /i.test(n.text));
        continue;
      }
    }
    if (op.op === "forget") {
      if (!e) { problems.push(`forget: unknown "${op.what}"`); continue; }
      const before = e.notes.length;
      e.notes = e.notes.filter(n => n.by === "rules" || (op.text ? !n.text.toLowerCase().includes(op.text.toLowerCase()) : false));
      if (e.notes.length !== before) changes.push(`forgot ${before - e.notes.length} note(s) on ${e.name}`);
      continue;
    }
    const applied = applyOps(world, [{ ...op, op: op.op }], turn, by);
    changes.push(...applied.changes);
    problems.push(...applied.problems);
  }
  return { changes, problems };
}

/** Inside a rect (an area, or the whole place). Areas stand in for walls: backing off down a lane doesn't put you in the loft. */
function bounds(world: SceneWorld, within?: Entity) {
  const r = (within?.rect ?? world.entities[world.root]!.rect)!;
  return (p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** `feet` from a reference, inside the mover's area: on the side they already are, or wherever there's room; as far as the area allows if it's too small. */
function awayFrom(world: SceneWorld, e: Entity, ref: Entity, feet: number): Point {
  const from = positionOf(world, ref.id)!;
  const cur = positionOf(world, e.id) ?? from;
  const area = areaOf(world, e.id);
  const inside = bounds(world, area);
  const preferred = Math.atan2(cur.y - from.y, cur.x - from.x);
  const hasPreference = distance(cur, from) > 1;
  const angles = Array.from({ length: 32 }, (_, i) => (i * Math.PI) / 16)
    .sort((a, b) => hasPreference ? angleGap(a, preferred) - angleGap(b, preferred) : room(inside, from, b) - room(inside, from, a));
  for (const a of angles) {
    const p = { x: Math.round(from.x + feet * Math.cos(a)), y: Math.round(from.y + feet * Math.sin(a)) };
    if (inside(p)) return p;
  }
  // The area is too small for the whole distance: the farthest point in it.
  const corners = area?.rect ? [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => ({ x: area.rect!.x + i! * area.rect!.w, y: area.rect!.y + j! * area.rect!.h })) : [cur];
  return corners.sort((a, b) => distance(b, from) - distance(a, from))[0]!;
}

function toward(world: SceneWorld, e: Entity, ref: Entity, feet: number): Point {
  const to = positionOf(world, ref.id)!;
  const cur = positionOf(world, e.id) ?? to;
  const d = distance(cur, to);
  const step = Math.max(0, Math.min(feet, d - 3));
  return d ? { x: Math.round(cur.x + ((to.x - cur.x) / d) * step), y: Math.round(cur.y + ((to.y - cur.y) / d) * step) } : cur;
}

const angleGap = (a: number, b: number) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
function room(inside: (p: Point) => boolean, from: Point, angle: number): number {
  let r = 0;
  while (r < 200 && inside({ x: from.x + (r + 1) * Math.cos(angle), y: from.y + (r + 1) * Math.sin(angle) })) r++;
  return r;
}

/**
 * What the stage manager (and the GM) read: the world view with the player listed like everyone
 * else, plus who's who for the people the story may describe without naming them.
 */
export function stageView(world: SceneWorld, options: { full?: boolean; whoIsWho?: boolean } = {}): string {
  const me = world.entities.player;
  const lines = [worldView(world, { full: options.full ?? true })];
  if (me) {
    const area = areaOf(world, "player");
    const near = Object.values(world.entities).filter(x => x.id !== "player" && x.kind !== "area" && x.kind !== "place" && !x.states.includes("gone") && x.at && me.at && distance(x.at, me.at) <= 6).map(x => x.name);
    lines.splice(1, 0, `Where the player stands: ${area?.name ?? "somewhere"}${near.length ? `, by ${near.slice(0, 3).join(", ")}` : ""}${me.states.length ? ` (${me.states.join(", ")})` : ""}${me.notes.length ? `: ${me.notes.slice(-2).map(n => n.text).join("; ")}` : ""}.`);
  }
  if (options.whoIsWho !== false) {
    const cast = whoIsWho(world);
    if (cast) lines.push(`\nWho's who (the story may describe them without naming them):\n${cast}`);
  }
  return lines.join("\n");
}

export function whoIsWho(world: SceneWorld): string {
  let scene;
  try { scene = sceneById(world.scene); } catch { return ""; }
  const people = Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !e.states.includes("gone"));
  return people.map(p => {
    const c = scene.cast.find(x => x.id === (p.cast ?? p.id));
    const look = (c?.look ?? p.description ?? "").split(/(?<=[.;])\s/)[0]!.slice(0, 160);
    return `- ${p.name} [${p.id}]${look ? `: ${look}` : ""}`;
  }).join("\n");
}
