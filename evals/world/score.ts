import { areaOf, distance, positionOf, type Entity, type SceneWorld } from "../../src/world/scene-world.ts";
import type { Expectation, FailureClass, WorldCase } from "./types.ts";

/**
 * Scoring: diff the world before and after into atomic changes (someone moved, something changed
 * hands, a state came or went, something new arrived, someone left, a note), then check them
 * against the case's labels. Precision is over the structural changes a system made (allowed
 * judgement calls are neutral); recall is over the changes the reply established. Notes are
 * scored on their own: they're free text, and an extra note is noise rather than a falsehood.
 */

export type Change =
  | { kind: "move"; id: string; area: string; feet: number }
  | { kind: "held"; id: string; by: string }
  | { kind: "drop"; id: string; area: string }
  | { kind: "state"; id: string; add?: string; remove?: string }
  | { kind: "create"; id: string; name: string; entityKind: string; area: string }
  | { kind: "gone"; id: string }
  | { kind: "note"; id: string; text: string };

const holderOf = (w: SceneWorld, e: Entity): string | undefined => {
  const p = e.parent ? w.entities[e.parent] : undefined;
  return p && p.kind !== "area" && p.kind !== "place" ? p.id : undefined;
};
const gone = (e: Entity | undefined) => !e || e.states.includes("gone");

export function diffWorlds(before: SceneWorld, after: SceneWorld): Change[] {
  const out: Change[] = [];
  for (const a of Object.values(after.entities)) {
    const b = before.entities[a.id];
    if (!b) {
      out.push({ kind: "create", id: a.id, name: a.name, entityKind: a.kind, area: areaOf(after, a.id)?.id ?? "" });
      continue;
    }
    if (a.kind !== "place" && a.kind !== "area") {
      if (a.states.includes("gone") && !b.states.includes("gone")) out.push({ kind: "gone", id: a.id });
      const hb = holderOf(before, b), ha = holderOf(after, a);
      if (ha && ha !== hb) out.push({ kind: "held", id: a.id, by: ha });
      else if (!ha && hb) out.push({ kind: "drop", id: a.id, area: areaOf(after, a.id)?.id ?? "" });
      else if (!ha && !hb) {
        const pb = positionOf(before, b.id), pa = positionOf(after, a.id);
        const feet = pb && pa ? distance(pb, pa) : 0;
        const areaA = areaOf(after, a.id)?.id ?? "";
        if (areaA !== (areaOf(before, b.id)?.id ?? "") || feet >= 4) out.push({ kind: "move", id: a.id, area: areaA, feet: Math.round(feet) });
      }
    }
    for (const s of a.states) if (s !== "gone" && !b.states.includes(s)) out.push({ kind: "state", id: a.id, add: s });
    for (const s of b.states) if (s !== "gone" && !a.states.includes(s)) out.push({ kind: "state", id: a.id, remove: s });
    for (const n of a.notes) if (!b.notes.some(x => x.text === n.text)) out.push({ kind: "note", id: a.id, text: n.text });
  }
  return out;
}

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const rx = (s: string) => new RegExp(s, "i");
const feetBetween = (w: SceneWorld, a: string, b: string) => {
  const pa = positionOf(w, a), pb = positionOf(w, b);
  return pa && pb ? distance(pa, pb) : Infinity;
};
/** Where something is "near" a target: by distance, or by being on, in or held by it. */
const isNear = (w: SceneWorld, id: string, target: string, within: number) => {
  for (let e = w.entities[id], guard = 0; e && guard < 8; e = e.parent ? w.entities[e.parent] : undefined, guard++) if (e.parent === target) return true;
  return feetBetween(w, id, target) <= within;
};

type Kind = "move" | "held" | "drop" | "state" | "create" | "gone" | "note";
export const kindOf = (x: Expectation): Kind =>
  "move" in x ? "move" : "held" in x ? "held" : "drop" in x ? "drop" : "state" in x ? "state" : "create" in x ? "create" : "gone" in x ? "gone" : "note";
export const subjectOf = (x: Expectation): string =>
  "move" in x ? x.move : "held" in x ? x.held : "drop" in x ? x.drop : "state" in x ? x.state : "create" in x ? x.create : "gone" in x ? x.gone : x.note;

/** New entities matching a create expectation (name, kind and, if given, where). */
function created(before: SceneWorld, after: SceneWorld, x: Extract<Expectation, { create: string }>, where: boolean): Entity[] {
  return Object.values(after.entities).filter(e => !before.entities[e.id] && rx(x.create).test(e.name)
    && (!x.kind || list(x.kind).includes(e.kind))
    && (!where || ((!x.to || list(x.to).includes(areaOf(after, e.id)?.id ?? "")) && (!x.near || isNear(after, e.id, x.near, x.within ?? 12)) && (!x.heldBy || e.parent === x.heldBy))));
}

/** Does the expectation hold in `w` (for creations and notes: relative to `before`)? */
function holds(x: Expectation, w: SceneWorld, before: SceneWorld): boolean {
  if ("create" in x) return created(before, w, x, true).length > 0;
  if ("note" in x) return (w.entities[x.note]?.notes ?? []).some(n => !before.entities[x.note]?.notes.some(b => b.text === n.text) && rx(x.text).test(n.text));
  if ("gone" in x) return !!w.entities[x.gone]?.states.includes("gone");
  if ("state" in x) {
    const e = w.entities[x.state];
    if (!e) return false;
    const add = list(x.add), remove = list(x.remove);
    return (!add.length || add.some(s => e.states.includes(s))) && (!remove.length || !remove.some(s => e.states.includes(s)));
  }
  if ("held" in x) return list(x.by).includes(w.entities[x.held]?.parent ?? "");
  if ("drop" in x) {
    const e = w.entities[x.drop];
    return !!e && !holderOf(w, e) && (!x.near || isNear(w, e.id, x.near, x.within ?? 12));
  }
  const e = w.entities[x.move];
  // Carried off by someone isn't a move; sitting in a chair or hiding in a barrel is.
  const holder = e ? holderOf(w, e) : undefined;
  if (gone(e) || (holder && ["person", "creature"].includes(w.entities[holder]!.kind))) return false;
  return (!x.to || list(x.to).includes(areaOf(w, e!.id)?.id ?? ""))
    && (!x.near || isNear(w, e!.id, x.near, x.within ?? 12))
    && (!x.awayFrom || feetBetween(w, e!.id, x.awayFrom) >= (x.beyond ?? 20));
}

/** An expectation is met when it holds after the exchange and didn't before. */
export function met(x: Expectation, before: SceneWorld, after: SceneWorld): boolean {
  if ("create" in x || "note" in x) return holds(x, after, before);
  // "Moved somewhere": any real move counts.
  if ("move" in x && !x.to && !x.near && !x.awayFrom) return diffWorlds(before, after).some(c => c.kind === "move" && c.id === x.move);
  if ("drop" in x) return !!before.entities[x.drop] && !!holderOf(before, before.entities[x.drop]!) && holds(x, after, before);
  return holds(x, after, before) && !holds(x, before, before);
}

/** "unbarred", "not locked": a state written as the absence of another. */
const negation = (s: string) => /^(un|not[- ])(.+)$/.exec(s)?.[2];

/** Does this expectation account for this change? (Strict: only a label of the same kind.) */
function covers(x: Expectation, c: Change, before: SceneWorld, after: SceneWorld, strict = false): boolean {
  if (c.kind === "note") return "note" in x && x.note === c.id && rx(x.text).test(c.text);
  if (c.kind === "create") return "create" in x && created(before, after, x, false).some(e => e.id === c.id);
  if (c.kind === "gone") return "gone" in x && x.gone === c.id;
  if (c.kind === "state") return "state" in x && x.state === c.id && (c.add ? list(x.add).includes(c.add) || list(x.remove).includes(negation(c.add) ?? "") : list(x.remove).includes(c.remove!));
  if (c.kind === "held") return ("held" in x && x.held === c.id && (strict || list(x.by).includes(c.by))) || (!strict && "move" in x && x.move === c.id && holds(x, after, before));
  // A thing put down, or someone moved: either label will do, if it's where the label says.
  if (strict) return ("move" in x && x.move === c.id && c.kind === "move") || ("drop" in x && x.drop === c.id && c.kind === "drop");
  if (("move" in x && x.move === c.id) || ("drop" in x && x.drop === c.id)) return holds(x, after, before);
  // Someone who left also moves off: the exit accounts for it.
  return "gone" in x && x.gone === c.id;
}

const RULES_STATES = new Set(["burning", "damaged", "destroyed", "smouldering", "hurt", "badly hurt", "down", "fallen", "frozen"]);

export interface Failure { class: FailureClass; detail: string }
export interface CaseScore {
  id: string;
  /** Required structural expectations met / total. */
  hits: number; expected: number;
  /** Structural changes made: accounted for by a required label, by an allowed one, or by nothing. */
  explained: number; allowed: number; unexplained: number;
  notes: { expected: number; found: number; extra: number };
  failures: Failure[];
  pass: boolean;
  changes: Change[];
}

const describe = (c: Change) => c.kind === "move" ? `${c.id} moved to ${c.area} (${c.feet} ft)` : c.kind === "held" ? `${c.id} now held by ${c.by}` : c.kind === "drop" ? `${c.id} put down in ${c.area}` : c.kind === "state" ? `${c.id} ${c.add ? `+${c.add}` : `-${c.remove}`}` : c.kind === "create" ? `created "${c.name}" (${c.entityKind}) in ${c.area}` : c.kind === "gone" ? `${c.id} left` : `note on ${c.id}: ${c.text}`;
const describeX = (x: Expectation) => JSON.stringify(x).replace(/"why":"[^"]*",?/, "");

export function scoreCase(c: WorldCase, after: SceneWorld, problems: string[] = []): CaseScore {
  const before = c.world;
  const changes = diffWorlds(before, after);
  const failures: Failure[] = [];
  const required = c.expect.filter(x => kindOf(x) !== "note");
  const requiredNotes = c.expect.filter(x => kindOf(x) === "note");
  const allow = c.allow ?? [];
  const forbid = c.forbid ?? [];
  const missed: Expectation[] = [];
  for (const x of required) {
    if (met(x, before, after)) continue;
    missed.push(x);
    const kind = kindOf(x);
    const subject = subjectOf(x);
    const moved = changes.find(ch => (ch.kind === "move" || ch.kind === "drop" || ch.kind === "held") && ch.id === subject);
    const cls: FailureClass = kind === "move" ? (moved ? "wrong-place" : "missed-move") : kind === "held" || kind === "drop" ? (moved ? "wrong-place" : "missed-transfer") : kind === "state" ? "missed-state" : kind === "create" ? "missed-arrival" : "missed-exit";
    failures.push({ class: cls, detail: `missed ${describeX(x)}${moved && (kind === "move" || kind === "held" || kind === "drop") ? ` (instead: ${describe(moved)})` : ""}` });
  }
  let explained = 0, allowed = 0, unexplained = 0;
  // Each create label accounts for at most `count` new entities.
  const budget = new Map<Expectation, number>();
  const take = (x: Expectation) => { const left = budget.get(x) ?? ("create" in x ? x.count ?? 1 : Infinity); if (left <= 0) return false; budget.set(x, left - 1); return true; };
  for (const ch of changes.filter(x => x.kind !== "note")) {
    const req = required.find(x => covers(x, ch, before, after) && take(x));
    if (req) { explained++; continue; }
    const ok = allow.find(x => covers(x, ch, before, after) && take(x));
    if (ok) { allowed++; continue; }
    unexplained++;
    const bad = forbid.find(x => covers(x, ch, before, after, true));
    if (bad) { failures.push({ class: bad.fail, detail: `${describe(ch)} (forbidden: ${bad.why ?? bad.fail})` }); continue; }
    // Moved, but not where the label says: already reported with the missed label.
    if ((ch.kind === "move" || ch.kind === "held" || ch.kind === "drop") && missed.some(x => subjectOf(x) === ch.id && ["move", "held", "drop"].includes(kindOf(x)))) continue;
    failures.push({ class: classify(c, ch, before, missed), detail: describe(ch) });
  }
  // Forbidden outcomes that aren't single changes (a note, a state that should have stayed).
  for (const x of forbid) {
    if (kindOf(x) === "note" && met(x, before, after)) failures.push({ class: x.fail, detail: `note ${describeX(x)}` });
  }
  const notes = changes.filter(ch => ch.kind === "note");
  const found = requiredNotes.filter(x => met(x, before, after)).length;
  for (const x of requiredNotes) if (!met(x, before, after)) failures.push({ class: "missed-note", detail: `missed ${describeX(x)}` });
  const extra = notes.filter(n => ![...requiredNotes, ...allow].some(x => covers(x, n, before, after))).length;
  for (const s of c.stale ?? []) {
    const visible = (after.entities[s.id]?.notes ?? []).slice(-2);
    const hit = visible.find(n => rx(s.text).test(n.text));
    if (hit && !gone(after.entities[s.id])) failures.push({ class: "stale-note", detail: `${s.id} still shows "${hit.text}"` });
  }
  for (const p of problems) failures.push({ class: "wrong-id", detail: p });
  const structural = failures.filter(f => f.class !== "missed-note");
  return {
    id: c.id, hits: required.length - missed.length, expected: required.length,
    explained, allowed, unexplained, notes: { expected: requiredNotes.length, found, extra },
    failures, pass: structural.length === 0, changes,
  };
}

/** Why an unaccounted-for change is wrong. */
function classify(c: WorldCase, ch: Change, before: SceneWorld, missed: Expectation[]): FailureClass {
  if (ch.kind === "create") {
    const name = ch.name.toLowerCase().replace(/^(a|an|the) /, "");
    const twin = Object.values(before.entities).some(e => {
      const other = e.name.toLowerCase().replace(/^(a|an|the) /, "");
      return other === name || (other.length > 3 && name.includes(other)) || (name.length > 3 && other.includes(name));
    });
    return twin ? "duplicate" : "over-creation";
  }
  if (ch.kind === "gone") return "spurious-exit";
  // The right kind of change, made to the wrong entity.
  const sameKind = missed.filter(x => kindOf(x) === (ch.kind === "drop" ? "move" : ch.kind) && subjectOf(x) !== ch.id);
  if (ch.kind === "move" && sameKind.some(x => "move" in x && list(x.to).includes(ch.area))) return "wrong-id";
  if (ch.kind === "held" && sameKind.some(x => "held" in x && list(x.by).includes(ch.by))) return "wrong-id";
  if (ch.kind === "state") {
    if (sameKind.some(x => "state" in x && (list(x.add).includes(ch.add ?? "") || list(x.remove).includes(ch.remove ?? "")))) return "wrong-id";
    const name = before.entities[ch.id]?.name.toLowerCase() ?? ch.id;
    const touched = c.rules.some(l => l.toLowerCase().includes(name.replace(/^the /, "")));
    if (touched && RULES_STATES.has(ch.add ?? ch.remove ?? "")) return "contradicts-rules";
    return "spurious-state";
  }
  return ch.kind === "held" ? "spurious-transfer" : "spurious-move";
}

export interface Summary {
  cases: number; passed: number;
  precision: number; recall: number; f1: number;
  explained: number; unexplained: number; allowed: number; hits: number; expected: number;
  notes: { expected: number; found: number; extra: number };
  failures: Partial<Record<FailureClass, number>>;
}

export function summarise(scores: CaseScore[]): Summary {
  const sum = (f: (s: CaseScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const explained = sum(s => s.explained), unexplained = sum(s => s.unexplained), hits = sum(s => s.hits), expected = sum(s => s.expected);
  const precision = explained + unexplained ? explained / (explained + unexplained) : 1;
  const recall = expected ? hits / expected : 1;
  const failures: Partial<Record<FailureClass, number>> = {};
  for (const s of scores) for (const f of s.failures) failures[f.class] = (failures[f.class] ?? 0) + 1;
  return {
    cases: scores.length, passed: scores.filter(s => s.pass).length,
    precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    explained, unexplained, allowed: sum(s => s.allowed), hits, expected,
    notes: { expected: sum(s => s.notes.expected), found: sum(s => s.notes.found), extra: sum(s => s.notes.extra) },
    failures,
  };
}

/** Labels must describe changes: a predicate that already held before the exchange is a labelling mistake. */
export function lintCase(c: WorldCase): string[] {
  const issues: string[] = [];
  const ids = new Set(Object.keys(c.world.entities));
  for (const x of [...c.expect, ...(c.allow ?? []), ...(c.forbid ?? [])]) {
    const k = kindOf(x);
    const subject = subjectOf(x);
    if (k !== "create" && !ids.has(subject)) issues.push(`${c.id}: unknown id "${subject}" in ${describeX(x)}`);
    for (const ref of ["near" in x ? x.near : undefined, "awayFrom" in x ? x.awayFrom : undefined, ...("by" in x ? list(x.by) : []), ...("to" in x ? list(x.to) : [])]) {
      if (ref && !ids.has(ref)) issues.push(`${c.id}: unknown id "${ref}" in ${describeX(x)}`);
    }
  }
  for (const x of c.expect) {
    const k = kindOf(x);
    const anywhere = "move" in x && !x.to && !x.near && !x.awayFrom;
    if (k !== "create" && k !== "note" && k !== "drop" && !anywhere && holds(x, c.world, c.world)) issues.push(`${c.id}: already true before the exchange: ${describeX(x)}`);
  }
  return issues;
}
