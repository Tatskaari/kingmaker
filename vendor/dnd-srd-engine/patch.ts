/**
 * Our fixes to the vendored build and its starter pack, applied after a rebuild (see README.md):
 * `node --no-warnings vendor/dnd-srd-engine/patch.ts`. It changes only what still needs it, so a
 * second run changes nothing.
 *
 * 1. The character's choices in the dice. The engine adds the effects of what a character chose
 *    (an Ability Score Improvement, a fighting style, a species' chosen resistance) to its effect
 *    stack only when it's handed the campaign's pendingChoices. The character sheet hands it them;
 *    most planners didn't, so a level 4 wizard's sheet said save DC 15 and spell attack +7 while
 *    their spells rolled DC 14 and +6 (and the same for weapon attacks, AC, saves and resistances).
 *    Every derivation the build hands a campaign's item instances is now handed its choices too.
 * 2. Archery. The fighter's and the Champion's give +2 to every attack roll; the SRD's (and the
 *    ranger's, in the same pack) is to attack rolls with ranged weapons.
 */
import { readFileSync, writeFileSync } from "node:fs";

const here = (file: string) => new URL(file, import.meta.url);

/**
 * Each object literal handed to a derivation ({character:…,itemInstances:S.itemInstances,content:…})
 * without pendingChoices gets S.pendingChoices beside its item instances. Where S isn't a campaign
 * state it's undefined, and the engine goes without, as before.
 */
export function threadChoices(source: string): { source: string; patched: number; already: number } {
  let out = "", from = 0, patched = 0, already = 0;
  for (let at = source.indexOf("{character:"); at >= 0; at = source.indexOf("{character:", from)) {
    const end = closing(source, at);
    if (end < 0) break;
    const literal = source.slice(at, end + 1);
    const items = /itemInstances:([A-Za-z_$][\w$]*(?:\.state)?)\.itemInstances(?=[,}])/.exec(literal);
    let next = literal;
    if (items && literal.includes("content:")) {
      if (literal.includes("pendingChoices:")) already++;
      else {
        const cut = items.index + items[0].length;
        next = `${literal.slice(0, cut)},pendingChoices:${items[1]}.pendingChoices${literal.slice(cut)}`;
        patched++;
      }
    }
    out += source.slice(from, at) + next;
    from = end + 1;
  }
  return { source: out + source.slice(from), patched, already };
}

/** The brace that closes the one at `at`, past strings; -1 for a template literal, which isn't followed. */
function closing(source: string, at: number): number {
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "`") return -1;
    if (ch === "\"" || ch === "'") {
      for (i++; i < source.length && source[i] !== ch; i++) if (source[i] === "\\") i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

const RANGED = { kind: "eq", path: "event.attackKind", value: "ranged" };

/** Archery's +2, wherever the pack has it on every attack: to ranged attacks only. */
export function rangedArchery(pack: unknown): number {
  let fixed = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o["id"] === "archery" && Array.isArray(o["effects"])) {
      for (const e of o["effects"] as Array<Record<string, unknown>>) {
        if (e["kind"] === "AddModifier" && e["target"] === "attack" && !e["condition"]) { e["condition"] = { ...RANGED }; fixed++; }
      }
    }
    Object.values(o).forEach(walk);
  };
  walk(pack);
  return fixed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const enginePath = here("dnd-srd-engine.js");
  const engine = threadChoices(readFileSync(enginePath, "utf8"));
  if (engine.patched) writeFileSync(enginePath, engine.source);
  if (!engine.patched && !engine.already) throw new Error("No derivation calls found: the build has changed shape, so the patch needs looking at.");
  const packPath = here("starter-pack.json");
  const pack = JSON.parse(readFileSync(packPath, "utf8")) as unknown;
  const archery = rangedArchery(pack);
  if (archery) writeFileSync(packPath, JSON.stringify(pack));
  console.log(`dnd-srd-engine.js: ${engine.patched} derivations handed the character's choices (${engine.already} had them). starter-pack.json: ${archery} Archery made ranged only.`);
}
