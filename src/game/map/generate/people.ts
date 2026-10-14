import { resetLooks } from "../../look/appearance.ts";
import { CAST, castOf } from "../looks.ts";
import type { PersonPlan } from "./plan.ts";

/**
 * Letters and colours for a generated place's people who aren't in the game's cast table
 * (src/game/map/looks.ts CAST: Kell is a blue K everywhere). The chandler and her apprentice get
 * their own, distinct from each other and from the cast who are there: an initial if it's free, then
 * another letter of their name, and a colour of their own. Registered in the cast table while the
 * place is in play (install.ts), the map, the look layer and the app all draw them the same way.
 */

export interface PersonLook { name: string; glyph: string; color: string }

/** Hues for people: bright on dark ground, clear of fire-red and water-blue, and of each other. */
const HUES = ["#e8c170", "#9be36b", "#c79bf2", "#f0a0c0", "#8fd8c8", "#f0b880", "#a8b8f0", "#e0a0ff", "#c8e0a0", "#f4e0b0", "#d9c27e", "#b8d870"];
const TITLES = /^(the|a|an|sergeant|corporal|captain|master|mister|mistress|missus|mrs|mr|miss|big|little|old|young|lady|lord|sir|dame|father|mother|brother|sister|doctor|dr|goodwife|goodman|granny|uncle|aunt|widow)\s+/i;

/** Who registered whom: an id can be in two places at once (two runs of the same place). */
const owners = new Map<string, Array<{ place: string; look: PersonLook }>>();

/** In the game's own cast table (not put there by a generated place)? */
const castMember = (id: string) => !!castOf(id) && !owners.has(id) && !owners.has(id.replace(/-\d+$/, ""));

/** The letters to try for a name, best first: its initial, the initials of its other words, its other letters, then any. */
function lettersFor(name: string): string[] {
  let bare = name.replace(/\(.*?\)/g, "").trim();
  for (let i = 0; i < 3 && TITLES.test(bare); i++) bare = bare.replace(TITLES, "");
  const words = bare.split(/[^A-Za-z]+/).filter(Boolean);
  const out = [...words.map(w => w[0]!), ...words.join("").slice(1)].map(c => c.toUpperCase());
  return [...new Set([...out, ..."ABCDEFGHIJKLMNOPRSTUVWXY"])];
}

/** Looks for the people not in the cast table: distinct letters and colours, after those of the cast who are there. */
export function peopleLooks(people: Array<Pick<PersonPlan, "id" | "name">>): Record<string, PersonLook> {
  const known = people.filter(p => castMember(p.id)).map(p => castOf(p.id)!);
  const letters = new Set(known.map(k => k.glyph.toUpperCase()));
  const colors = new Set(known.map(k => k.color));
  const out: Record<string, PersonLook> = {};
  for (const p of people) {
    if (castMember(p.id)) continue;
    const glyph = lettersFor(p.name).find(l => !letters.has(l)) ?? "P";
    letters.add(glyph);
    const color = HUES.find(h => !colors.has(h)) ?? HUES[Object.keys(out).length % HUES.length]!;
    colors.add(color);
    out[p.id] = { name: p.name, glyph, color };
  }
  return out;
}

/** Put a place's people in the cast table (the map, the look layer and the app draw from it). */
export function registerPeople(place: string, looks: Record<string, PersonLook>): void {
  for (const [id, look] of Object.entries(looks)) {
    if (castMember(id)) continue; // the game's own cast is never overwritten
    const list = (owners.get(id) ?? []).filter(o => o.place !== place);
    list.push({ place, look });
    owners.set(id, list);
    CAST[id] = { ...look };
  }
  // Looks are cached by name: anyone drawn before they had a letter is looked at again.
  resetLooks();
}

/** Take them out again (whoever else has the same id keeps theirs). */
export function unregisterPeople(place: string): void {
  for (const [id, list] of [...owners]) {
    const left = list.filter(o => o.place !== place);
    if (left.length === list.length) continue;
    if (left.length) { owners.set(id, left); CAST[id] = { ...left.at(-1)!.look }; }
    else { owners.delete(id); delete CAST[id]; }
  }
  resetLooks();
}
