/**
 * Records what the prototype's rules engine says of the ready-made wizard's spells, as its scene
 * menu reads them (src/app/game.ts:1840-1851, loadSpellFacts: each spell's range, its effects' kinds,
 * whether it fills an area): the world bridge's client checks its place's menu with them (the
 * sheet's spellFacts column, which the world bridge's contracts add, carries the same).
 *
 *   KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings --import tsx tools/v2/record-spell-facts.mts \
 *     --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2
 *
 * --proto is a checkout of the prototype at 44c6d4a, imported at run time by path; --out is v2. No
 * model is asked. It reads <out>/client/check/fixtures/sheet-wizard.json (its ready spells, in the
 * sheet's order) and writes <out>/client/check/fixtures/spell-facts-wizard.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`usage: record-spell-facts.mts --proto <the prototype at 44c6d4a> --out <v2> (no ${name})`);
  return resolve(process.argv[i + 1]!);
};
const proto = arg("--proto"), out = arg("--out");
const fixtures = join(out, "client", "check", "fixtures");

type Ready = { id: string; name: string; level: number };
type Def = { range?: string; mechanicalEffects?: Array<{ kind: unknown }>; targeting?: { shape?: string } };
const { spellInfo } = await import(pathToFileURL(join(proto, "src", "rules", "dnd.ts")).href) as { spellInfo(id: string): Promise<Def | undefined> };

const wizard = JSON.parse(readFileSync(join(fixtures, "sheet-wizard.json"), "utf8")) as { spellcasting: { spells: Array<{ level: number; spells: Array<{ id: string; name: string; ready: boolean }> }> } };
const ready: Ready[] = wizard.spellcasting.spells.flatMap(g => g.spells.filter(s => s.ready).map(s => ({ id: s.id, name: s.name, level: g.level })));

const facts = [];
for (const s of ready) {
  const def = await spellInfo(s.id).catch(() => undefined);
  facts.push(def ? { ...s, range: def.range, effects: (def.mechanicalEffects ?? []).map(m => String(m.kind)), ...(def.targeting?.shape ? { area: true } : {}) } : s);
}
writeFileSync(join(fixtures, "spell-facts-wizard.json"), `${JSON.stringify(facts, null, 2)}\n`);
console.log(`${facts.length} spells: ${facts.map(f => f.id).join(", ")}`);
