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

export function opSchemaV2(world: SceneWorld): Record<string, unknown> {
  const ids = ["", ...Object.keys(world.entities).filter(id => id !== world.root)];
  return {
    type: "object", additionalProperties: false, required: ["ops"],
    properties: {
      ops: {
        type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["op", "what", "to", "how", "feet", "name", "kind", "text", "add", "remove"],
          properties: {
            op: { type: "string", enum: [...OPS_V2] },
            what: { type: "string", enum: ids }, to: { type: "string", enum: ids },
            how: { type: "string", enum: [...HOWS_V2] }, feet: { type: "integer" },
            name: { type: "string" }, kind: { type: "string", enum: ["", "person", "creature", "object", "item"] }, text: { type: "string" },
            add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}

/** Apply the extended operations in order: the extensions here, the rest through the world module. */
export function applyOpsV2(world: SceneWorld, ops: WorldOpV2[], turn: number, by: "stage" | "rules" = "stage"): { changes: string[]; problems: string[] } {
  const changes: string[] = [];
  const problems: string[] = [];
  for (const op of ops) {
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

function bounds(world: SceneWorld) {
  const r = world.entities[world.root]!.rect!;
  return (p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** `feet` from a reference, on the side the mover already is (or wherever there's room), inside the place. */
function awayFrom(world: SceneWorld, e: Entity, ref: Entity, feet: number): Point {
  const from = positionOf(world, ref.id)!;
  const cur = positionOf(world, e.id) ?? from;
  const inside = bounds(world);
  const preferred = Math.atan2(cur.y - from.y, cur.x - from.x);
  const hasPreference = distance(cur, from) > 1;
  const angles = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8)
    .sort((a, b) => hasPreference ? angleGap(a, preferred) - angleGap(b, preferred) : room(world, from, b) - room(world, from, a));
  for (const a of angles) {
    const p = { x: Math.round(from.x + feet * Math.cos(a)), y: Math.round(from.y + feet * Math.sin(a)) };
    if (inside(p)) return p;
  }
  // No room for the whole distance: as far as the place allows.
  const best = angles.sort((a, b) => room(world, from, b) - room(world, from, a))[0]!;
  const reach = room(world, from, best);
  return { x: Math.round(from.x + reach * Math.cos(best)), y: Math.round(from.y + reach * Math.sin(best)) };
}

function toward(world: SceneWorld, e: Entity, ref: Entity, feet: number): Point {
  const to = positionOf(world, ref.id)!;
  const cur = positionOf(world, e.id) ?? to;
  const d = distance(cur, to);
  const step = Math.max(0, Math.min(feet, d - 3));
  return d ? { x: Math.round(cur.x + ((to.x - cur.x) / d) * step), y: Math.round(cur.y + ((to.y - cur.y) / d) * step) } : cur;
}

const angleGap = (a: number, b: number) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
function room(world: SceneWorld, from: Point, angle: number): number {
  const inside = bounds(world);
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
