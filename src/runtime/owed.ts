import { areaOf, type Entity, type SceneWorld } from "../world/scene-world.ts";
import { effectiveScene } from "./brief.ts";
import type { Essential, Scene } from "./scene.ts";
import type { Owed, SessionState } from "./session.ts";

/**
 * What the story still owes the player. A scene's essential that the rest of the story needs
 * (`later`: Prout's page, whose countersignature the King's morning needs) doesn't fall through the
 * cracks between scenes when the player misses it. When the scene ends without them coming across
 * it, it goes into the next scene that holds, as one of that scene's essentials, and on again until
 * they do. It goes through the boundary's own machinery:
 *
 * - the record says what was missed: `landed` and `hinted`, judged after every reply, and the
 *   world, which says where its things are now (`owedAtEnd`);
 * - the boundary's verdict, the call that judges what the next scenes `assume` and where their prep
 *   is out of date, also judges, for the first scene that holds, whether the player came across it
 *   after all, and whether it can come up there: if that scene has prepped for it (`missed`), its
 *   prep, and if not, where it is there and who could bring it out (`placedWith` and `carriers`,
 *   from that scene's people);
 * - it goes into that scene as a patch to its prep, so the GM's brief, the deciders and the co-GM
 *   see it as one of the scene's essentials, with its routes; `landed` and `hinted` track it there
 *   as they track any essential (a sign already given stays given), and once the player has come
 *   across it, it's owed no more (`bringOver`);
 * - its things stay where they are, with whoever has them, and go with them into each next scene's
 *   world (`placeOwedThings`): the page is still sewn into the boot, on Cob's feet.
 *
 * What was found isn't offered again: a scene's prep for something the player didn't miss is never
 * the scene's (`effectiveScene` keeps it out), and nor are its routes.
 */

/** An owed essential's name across scenes: the scene it was placed in, and its id there ("hanged-clerk:page"). */
export const owedKey = (o: Pick<Owed, "from" | "id">) => `${o.from}:${o.id}`;

/** What the boundary's verdict says of something owed, for the first scene that holds. */
export interface OwedVerdict {
  id: string;
  /** The player did come across it in the last scene, whatever the record says: it's owed no more. */
  found: boolean;
  /** It can come up in that scene (unknown when the verdict wasn't about the scene the story goes to). */
  here?: boolean;
  /** Where it is there, and who could bring it out (when that scene has no prep of its own for it). */
  placedWith: string[];
  carriers: string[];
  why: string;
}

const parentOf = (world: SceneWorld, e: Entity) => (e.parent ? world.entities[e.parent] : undefined);

/** Something and everything inside it, however deep (each once). */
function within(world: SceneWorld, outer: Entity): Entity[] {
  const out: Entity[] = [outer];
  const seen = new Set<string>([outer.id]);
  for (let i = 0; i < out.length; i++) {
    for (const e of Object.values(world.entities)) {
      if (e.parent === out[i]!.id && !seen.has(e.id) && !e.states.includes("gone")) { seen.add(e.id); out.push(e); }
    }
  }
  return out;
}

/**
 * Where an essential's things are as a world leaves them: with someone (the things, outermost first,
 * to go with them into the next world), with the player (who carries them on anyway), lying in the
 * place, or destroyed. Undefined when none of them is in this world (they're where they were).
 */
export function trace(world: SceneWorld, ids: string[]): { things: Entity[]; holders: string[]; where: string } | undefined {
  const present = ids.map(id => world.entities[id]).filter((e): e is Entity => !!e);
  if (!present.length) return undefined;
  const things: Entity[] = [];
  const holders: string[] = [];
  const where: string[] = [];
  const taken = new Set<string>();
  for (const e of present) {
    if (taken.has(e.id)) continue; // already going, inside another of them
    if (e.states.includes("destroyed") || e.states.includes("gone")) { where.push(`${e.name}: ${e.states.includes("destroyed") ? "destroyed" : "gone"}`); continue; }
    // Up the tree to whoever has it: a person, the player, or nobody (it's lying in the place).
    const chain = [e];
    let holder: Entity | undefined;
    for (let p = parentOf(world, e), n = 0; p && n < 12; p = parentOf(world, p), n++) {
      if (p.kind === "area" || p.kind === "place") break;
      if (p.kind === "person" || p.kind === "creature") { holder = p; break; }
      chain.push(p);
    }
    const what = chain.map(c => c.name).join(", in ");
    if (holder?.player) { holders.push("player"); where.push(`${what}: the player has it`); continue; }
    if (!holder || holder.states.includes("dead")) { where.push(`${what}: left in ${areaOf(world, e.id)?.name ?? "the place"}${world.entities[world.root] ? `, ${world.entities[world.root]!.name}` : ""}`); continue; }
    // Someone has it: it goes with them, and so does whatever's in it. (Somewhere else already, it's still theirs.)
    for (const t of within(world, chain.at(-1)!)) {
      taken.add(t.id);
      const copy = structuredClone(t);
      delete copy.at; // where its holder is
      copy.notes = copy.notes.slice(-2);
      things.push(copy);
    }
    holders.push(holder.cast ?? holder.id);
    where.push(`${what}, with ${holder.name}`);
  }
  return { things, holders: [...new Set(holders)], where: where.join("; ") };
}

/**
 * What the story still owes the player as a scene ends: what it owed before that the player didn't
 * come across here, and this scene's own essentials that the story needs later and they didn't
 * come across. Each says where its things are now, from this scene's world.
 */
export function owedAtEnd(authored: Scene, state: SessionState): Owed[] {
  const scene = effectiveScene(authored, state.patches);
  const landed = new Set(state.landed ?? []);
  const hinted = new Set(state.hinted ?? []);
  const now = (o: Owed): Owed => {
    const traced = state.world && o.essential.things?.length ? trace(state.world, o.essential.things) : undefined;
    if (!traced) return o; // not in this world: where it was
    const { things: _things, holders: _holders, where: _where, ...rest } = o;
    return { ...rest, ...(traced.things.length ? { things: traced.things } : {}), ...(traced.holders.length ? { holders: traced.holders } : {}), ...(traced.where ? { where: traced.where } : {}) };
  };
  const out: Owed[] = [];
  for (const o of state.owed ?? []) {
    // Its form here, if the boundary brought it over: come across here, it's owed no more.
    const here = scene.essentials?.find(e => e.missed === owedKey(o));
    if (here && landed.has(here.id)) continue;
    out.push(now(here && hinted.has(here.id) ? { ...o, hinted: true } : o));
  }
  for (const e of authored.essentials ?? []) {
    if (!e.later || e.missed || landed.has(e.id) || out.some(o => o.from === authored.id && o.id === e.id)) continue;
    out.push(now({ from: authored.id, id: e.id, essential: e, ...(hinted.has(e.id) ? { hinted: true } : {}) }));
  }
  return out;
}

/** For the boundary's verdict: what the story still owes the player, and where it is now. */
export function owedText(owed: Owed[]): string {
  return [
    "## What the story still needs the player to come across",
    "Each was placed in a scene already played, the player hasn't come across it there (as far as the record of play goes), and the story needs it later. Its things are where the last scene left them, with whoever has them.",
    ...owed.map(o => `- [${owedKey(o)}] ${o.essential.what}${o.essential.later ? ` Needed later: ${o.essential.later}` : ""} Where it is now: ${o.where ?? o.essential.placedWith.join("; ")}.${o.hinted ? " The player has had a sign of it already." : ""}`),
  ].join("\n");
}

/** An upcoming scene's own prep for what's owed (for if the player missed it), for the verdict. */
export function owedPrep(scene: Scene, owed: Owed[]): string | undefined {
  const own = owed.flatMap(o => {
    const e = scene.essentials?.find(x => x.missed === owedKey(o));
    return e ? [`- [${owedKey(o)}] placed with: ${e.placedWith.join("; ")}`] : [];
  });
  return own.length ? `Its own prep for what the story still needs, if the player missed it:\n${own.join("\n")}` : undefined;
}

export const OWED_INSTRUCTION = "5. owed: one for each thing under \"What the story still needs the player to come across\", by its id in brackets, judged for that first upcoming scene that still holds. found: the player did come across it in the last scene after all (it was plainly told, shown or found in play; a hint, a guess or an offer isn't finding it). here: it can come up in that scene, because the things it's in, or someone who has it or knows it, will be there (things stay where they are, with whoever has them, and nobody knows what they couldn't have learned); when that scene has its own prep for it, whether that prep fits how things stand now. placedWith and carriers, only when it can come up there and that scene has no prep of its own for it (otherwise empty lists): where it is in that scene, in a few words each (people, objects, moments), and who there could bring it out, by their ids in brackets (whoever has it, or someone they'd trust with it). why: a few words.";

/** The verdict's answer about what's owed (carriers: the upcoming scenes' people). */
export function owedSchema(people: string[]) {
  return {
    type: "array",
    items: { type: "object", additionalProperties: false, required: ["id", "found", "here", "placedWith", "carriers", "why"], properties: {
      id: { type: "string" }, found: { type: "boolean" }, here: { type: "boolean" },
      placedWith: { type: "array", items: { type: "string" } },
      carriers: { type: "array", items: people.length ? { type: "string", enum: people } : { type: "string" } },
      why: { type: "string" },
    } },
  };
}

/**
 * Where something owed is in the next scene, as one of its essentials: the scene's own prep for it,
 * or the boundary's placing; or nowhere, when it can't come up there (it stays owed).
 */
export function placing(o: Owed, next: Scene, v: OwedVerdict | undefined): Essential | undefined {
  const key = owedKey(o);
  const id = next.essentials?.some(e => e.id === o.id) ? `${o.from}-${o.id}` : o.id;
  const where = [o.where ?? o.essential.placedWith.join("; ")];
  // The player has its things (the boots, the page unread in them): it can come up anywhere, where it is,
  // whatever a scene's prep for someone else having it says.
  if (o.holders?.includes("player")) return { id, what: o.essential.what, placedWith: where, carriers: [], unlocks: o.essential.unlocks, missed: key };
  if (v?.here === false) return undefined;
  const own = next.essentials?.find(e => e.missed === key);
  if (own) return own;
  const cast = new Set(next.cast.map(c => c.id));
  // Things stay where they are: what's in someone's hands comes up only where they'll be.
  if (o.holders?.length && !o.holders.some(h => cast.has(h))) return undefined;
  const judged = v?.here === true;
  const carriers = [...new Set(judged ? v!.carriers : [...(o.holders ?? []), ...(o.essential.carriers ?? [])])].filter(c => cast.has(c));
  // Without the verdict: only where someone who has it, or carried it, will be.
  if (!judged && !carriers.length) return undefined;
  const placedWith = judged ? v!.placedWith.map(p => p.trim()).filter(Boolean) : [];
  return { id, what: o.essential.what, placedWith: placedWith.length ? placedWith : where, carriers, unlocks: o.essential.unlocks, missed: key };
}

/**
 * Across the boundary, once the next scene's own state has started: what's still owed goes on with
 * the story, and what can come up in the next scene is one of its essentials there (a sign already
 * given counting as given). Found after all, it's owed no more.
 */
export function bringOver(state: SessionState, next: Scene, owed: Owed[], verdict: OwedVerdict[] | undefined): void {
  const kept: Owed[] = [];
  for (const o of owed) {
    const v = verdict?.find(x => x.id === owedKey(o));
    if (v?.found) continue;
    kept.push(o);
    const placed = placing(o, next, v);
    if (!placed) continue;
    state.patches.push({ turn: state.turn, essential: placed, why: `Brought over from ${o.from}, where the player missed it${o.essential.later ? `: ${o.essential.later}` : ""}` });
    if (o.hinted) state.hinted = [...new Set([...(state.hinted ?? []), placed.id])];
  }
  if (kept.length) state.owed = kept;
  else delete state.owed;
}

/**
 * The things of what's owed go with whoever has them: into the world they're in now, once they're
 * in it (at the start, or when they come on stage), as they were (the page still in the boot).
 * Something already here by the same id stays as it is. Returns the names of what came in.
 */
export function placeOwedThings(state: SessionState): string[] {
  const world = state.world;
  if (!world) return [];
  const placed: string[] = [];
  for (const o of state.owed ?? []) {
    const things = o.things ?? [];
    const ids = new Set(things.map(t => t.id));
    for (const outer of things.filter(t => !t.parent || !ids.has(t.parent))) {
      const holder = outer.parent ? world.entities[outer.parent] : undefined;
      if (!holder || holder.player || (holder.kind !== "person" && holder.kind !== "creature") || world.entities[outer.id]) continue;
      // The outer thing and everything in it, as they were.
      const going = [outer];
      for (let i = 0; i < going.length; i++) going.push(...things.filter(t => t.parent === going[i]!.id && !going.includes(t)));
      if (going.some(t => world.entities[t.id])) continue;
      for (const t of going) world.entities[t.id] = structuredClone(t);
      placed.push(outer.name);
    }
  }
  return placed;
}

/** What the boundary did with what's owed, in a line each (the zoo's boundary desk). */
export function carryLines(owed: Owed[], next: Scene, verdict: OwedVerdict[] | undefined): string[] {
  return owed.map(o => {
    const v = verdict?.find(x => x.id === owedKey(o));
    const what = o.essential.what.length > 100 ? `${o.essential.what.slice(0, 100).replace(/[\s,;:]+\S*$/, "")}…` : o.essential.what.replace(/\.$/, "");
    if (v?.found) return `${what}: found after all (${v.why || "the scene played it out"}), so it's owed no more.`;
    const placed = placing(o, next, v);
    return placed
      ? `${what}: still owed, and it comes up in ${next.title} (${placed.placedWith.join("; ")}).`
      : `${what}: still owed, but it can't come up in ${next.title}${v?.why ? ` (${v.why})` : ""}; it waits for a later scene.`;
  });
}
