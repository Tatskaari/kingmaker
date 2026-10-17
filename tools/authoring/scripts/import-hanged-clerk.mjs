#!/usr/bin/env node
/** Import the real v2 Caerwyn authoring source, without changing the game or a vault. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const campaignDirectory = process.argv[2];
if (!campaignDirectory) {
  console.error('Usage: node scripts/import-hanged-clerk.mjs <v2/campaigns/caerwyn> [output-directory]');
  process.exit(1);
}
const outputDirectory = path.resolve(process.argv[3] ?? fileURLToPath(new URL('../examples/', import.meta.url)));
const sceneDirectory = path.join(campaignDirectory, 'scenes/hanged-clerk');
const scene = JSON.parse(await readFile(path.join(sceneDirectory, 'scene.json'), 'utf8'));
const place = JSON.parse(await readFile(path.join(campaignDirectory, 'places/granary-yard.json'), 'utf8'));
const markdown = {};
async function collectMarkdown(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await collectMarkdown(path.join(directory, entry.name), `${relative}/`);
    else if (entry.name.endsWith('.md')) markdown[relative] = await readFile(path.join(directory, entry.name), 'utf8');
  }
}
await collectMarkdown(sceneDirectory);
const revision = execFileSync('git', ['-C', campaignDirectory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const castPaths = Object.fromEntries(scene.cast.map(person => [person.id, `Cast/${person.name}/public.md`]));
const bodyPath = 'Objects/Wendell Prout.md';
const pagePath = 'Objects/Ledger page.md';
const placePath = 'Places/Granary Yard.md';
const scenePath = 'Scenes/The Hanged Clerk.kmscene';
const positions = {
  yard: [0, 350], doubt: [450, 0], motive: [900, 0],
  'dead-cart': [450, 700], accused: [900, 700],
  'case-made': [1400, -200], 'open-case': [1400, 150], 'wrong-man': [1400, 500],
  'closed-suicide': [1400, 850], 'walked-away': [1400, 1200],
};
const loreForBeat = {
  yard: [castPaths.kell, castPaths.cob, castPaths.moll, bodyPath, pagePath, placePath],
  doubt: [castPaths.kell, castPaths.cob, castPaths.moll, bodyPath, pagePath],
  motive: [castPaths.kell, pagePath],
  'dead-cart': [castPaths.kell, castPaths.tull, bodyPath],
  accused: [castPaths.kell, castPaths.cob, castPaths.moll],
};
function node(id, authored, kind) {
  const [x, y] = positions[id];
  return {
    id, type: 'story', position: { x, y },
    data: {
      kind, title: authored.title, description: markdown[authored.text].trim(),
      lore: kind === 'beat' ? loreForBeat[id] : [castPaths.kell],
      sourceId: id, sourceFile: authored.text,
      ...(kind === 'exit' ? { exitKind: authored.kind, next: authored.next, effects: authored.effects } : {}),
      ...(id === scene.start ? { start: true } : {}),
    },
  };
}
const nodes = [
  ...Object.entries(scene.beats).map(([id, beat]) => node(id, beat, 'beat')),
  ...Object.entries(scene.exits).map(([id, exit]) => node(id, exit, 'exit')),
];
const edges = [];
const titleCase = value => value.replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase());
function addRoute(from, route, scope) {
  const outcomes = route.check
    ? [['success', route.check.onSuccess, route.check.success], ['failure', route.check.onFailure ?? from, route.check.failure]]
    : [['direct', route.to ?? from, '']];
  for (const [branch, target, outcomeText] of outcomes) {
    if (!nodes.some(candidate => candidate.id === target)) throw new Error(`Unresolved target: ${from}.${route.id} → ${target}`);
    edges.push({
      id: `${scope}:${from}:${route.id}:${branch}`, source: from, target, type: 'smoothstep',
      label: `${titleCase(route.id)}${branch === 'direct' ? '' : ` · ${branch}`}${scope === 'anytime' ? ' · anytime' : ''}`,
      data: {
        condition: route.when, phase: route.on, skill: route.check?.skill ?? '', dc: route.check?.dc ?? 0,
        scope, branch, outcomeText, sourceRoute: route,
        ...(route.check && branch === 'failure' && !route.check.onFailure ? { staysInCurrentBeat: true } : {}),
      },
    });
  }
}
for (const [id, beat] of Object.entries(scene.beats)) {
  for (const route of beat.routes) addRoute(id, route, 'beat');
  for (const route of scene.anytime) addRoute(id, route, 'anytime');
}
const provenance = {
  kind: 'v2-authoring-import', revision,
  path: 'v2/campaigns/caerwyn/scenes/hanged-clerk/scene.json',
  note: 'An editable authoring copy, not connected to the game engine. The graph is editable; this source snapshot preserves the original authored content and does not update when the graph is edited. Check routes have separate success/failure edges. A missing failure destination stays at the current beat. Anytime routes are shown from every beat, with scope=anytime; they are not five separate source rules. Runtime eligibility rules may restrict which routes are currently available.',
};
const document = {
  format: 'kingmaker', version: 1, kind: 'scene', id: scene.id, title: scene.title,
  description: `${scene.summary}\n\nImported from the authored v2 scene: five beats, five endings, and the actual routes between them. This is an editable authoring copy, not yet wired into the game engine.`,
  nodes, edges, lore: [...new Set([...Object.values(castPaths), bodyPath, pagePath, ...scene.lore])],
  source: { ...provenance, scene, markdown, place },
};
const scenario = {
  format: 'kingmaker', version: 1, kind: 'scenario', id: 'caerwyn-authoring', title: 'Caerwyn',
  description: 'A local authoring overview of the existing Granary Yard location and The Hanged Clerk scene. Open the map node to edit the place note, or the scene node to edit its real scene file. This is not an imported or executable campaign transition graph; no additional scenes have been invented.',
  nodes: [
    { id: 'granary-yard', type: 'story', position: { x: 0, y: 80 }, data: { kind: 'map', title: 'The Granary Yard', description: place.description, lore: [placePath], file: placePath, sourcePlace: place } },
    { id: 'hanged-clerk', type: 'story', position: { x: 430, y: 80 }, data: { kind: 'scene', title: scene.title, description: scene.summary, lore: [], file: scenePath } },
  ],
  edges: [{ id: 'yard-scene', source: 'granary-yard', target: 'hanged-clerk', type: 'smoothstep', label: 'Investigate the hanged clerk', data: { condition: 'Authoring overview: this scene takes place in the granary yard.', phase: 'navigation', skill: '', dc: 0 } }],
  lore: [placePath, 'World/Caerwyn now.md'],
  source: { kind: 'authoring-overview', note: 'The map-to-scene relationship is an authoring navigation link derived from the scene place field, not a runtime campaign transition.', scenePath: provenance.path, revision },
};
const body = place.things.find(thing => thing.id === 'prout');
const page = place.things.find(thing => thing.id === 'ledger-page');
const notes = {
  [bodyPath]: `---\ntype: object\nname: "Wendell Prout's body"\nvisibility: gm\nsource: "v2/campaigns/caerwyn/places/granary-yard.json#prout"\n---\n# Wendell Prout's body\n\n${body.description}\n\nAt the opening, the body hangs from the hoist rope above the granary yard. The authored starting state is **${body.states.join(', ')}**.\n\n## What the evidence means\n\n${scene.facts['killed-not-suicide']}\n\n## Related content\n\n- [[Places/Granary Yard]]\n- [[Objects/Ledger page]]\n- [[${scenePath}]]\n\n*Imported from the existing v2 authored place and scene, revision ${revision.slice(0, 7)}. This local lore note is an authoring copy, not a live engine object.*\n`,
  [pagePath]: `---\ntype: object\nname: Ledger page\nvisibility: gm\nsource: "v2/campaigns/caerwyn/places/granary-yard.json#ledger-page"\n---\n# Ledger page\n\n${page.description}\n\n## Full discovery\n\n${scene.facts['page-read']}\n\n## Starting location\n\nSewn into the lining of Prout's left boot. Cob is wearing the boots. The authored starting tags are **${page.tags.join(', ')}**.\n\n## Related content\n\n- [[Cast/Cob/public|Cob]]\n- [[Objects/Wendell Prout]]\n- [[Places/Granary Yard]]\n- [[${scenePath}]]\n\n*Imported from the existing v2 authored place and scene, revision ${revision.slice(0, 7)}. This local lore note is an authoring copy, not a live engine item.*\n`,
};
const files = {
  [scenePath]: `${JSON.stringify(document, null, 2)}\n`,
  'Scenarios/Caerwyn.kmscenario': `${JSON.stringify(scenario, null, 2)}\n`,
  ...notes,
};
for (const [relative, contents] of Object.entries(files)) {
  const destination = path.join(outputDirectory, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  // Examples are generated artifacts. Installation into a real vault is a separate, deliberate action.
  await writeFile(destination, contents);
}
console.log(`Imported ${scene.title}: ${nodes.length} nodes, ${edges.length} route branches, ${Object.keys(markdown).length} original Markdown files preserved.`);
console.log(`Wrote ${Object.keys(files).length} files to ${outputDirectory}`);
