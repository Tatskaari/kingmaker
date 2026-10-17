// One-off (M2): the campaign's scene folders (scene.json and its Markdown, the format before M2) as .kmscene files (docs/scene-format.md), for the scenes M2 doesn't re-author by hand: the two interludes and the talk template, and the hanged clerk as it stood, as the tests' own fixture. Run from the repo's root: node --no-warnings --import tsx tools/scene-folders.mts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScene, type CastMember, type Path, type Route, type SceneDocument, type SceneNode } from "../shared/scene/document.ts";
import type { CastFile, RouteFile, SceneFile } from "../shared/scene/files.ts";
import { items, sections } from "../shared/scene/load.ts";

const SCENES = join("campaigns", "caerwyn", "scenes");

/** What a folder doesn't say that the format asks for: why each person's here, how each ending went, a discovery's paths, the scene's own extras. */
interface Extra {
  /** The words the start's opening is put after its play note with ("As the talk opens"). */
  opens: string;
  whyHere: Record<string, string>;
  results: Record<string, "good" | "mixed" | "bad">;
  /** An essential's paths, by its id: the folder has only where it was placed. */
  paths?: Record<string, Path[]>;
  /** Whether a discovery made of an essential gets a route into it from the start. */
  routesIntoDiscoveries: boolean;
  /** Top-level fields of the file's own (a fixture's note). */
  top?: Record<string, unknown>;
  truth?: string;
  /** Routes the folder hadn't got, after its own. */
  edges?: Route[];
}

function convert(key: string, extra: Extra): SceneDocument {
  const dir = join(SCENES, key);
  const read = (path: string) => readFileSync(join(dir, path), "utf8");
  const file = JSON.parse(read("scene.json")) as SceneFile;
  const beats = Object.entries(file.beats);
  const prose = (path: string) => sections(read(path));

  // The start: its play note, then the opening, as the format's one description of it.
  const start = beats.find(([id]) => id === file.start)!;
  const startProse = prose(start[1].text);
  const opening = read("opening.md").trim();
  const nodes: SceneNode[] = [{
    id: file.start, type: "story", position: { x: 0, y: 200 },
    data: {
      kind: "start", title: start[1].title,
      description: `${startProse.lead}\n\n${extra.opens}: ${opening[0]!.toLowerCase()}${opening.slice(1)}`,
      ...castNotes(startProse.parts), lore: [],
    },
  }];
  // The other beats are events: turns the scene takes, with the people's notes and the pressure.
  beats.filter(([id]) => id !== file.start).forEach(([id, b], i) => {
    const { lead, parts } = prose(b.text);
    nodes.push({ id, type: "story", position: { x: 400, y: 60 + 160 * i }, data: { kind: "beat", title: b.title, description: lead, ...castNotes(parts), ...(parts.has("Pressure") ? { pressure: parts.get("Pressure")! } : {}), lore: [] } });
  });
  // Each essential is a discovery the story carries: its paths where it was placed, and who carries it.
  Object.entries(file.essentials).forEach(([id, e], i) => {
    const paths = extra.paths?.[id] ?? [
      ...e.placedWith.map(via => ({ via, clue: via, earn: "", strength: "suggestive" as const })),
      ...(e.carriers ?? []).filter(c => !e.placedWith.includes(c)).map(via => ({ via, clue: e.what, earn: "", strength: "suggestive" as const })),
    ];
    nodes.push({
      id, type: "story", position: { x: 400, y: 60 + 160 * (beats.length - 1 + i) },
      data: { kind: "beat", title: e.what.split(/[:.;(]/)[0]!.trim(), description: e.what, revelation: e.what, paths, carry: { unlocks: e.unlocks, ...(e.later ? { later: e.later } : {}), ...(e.things ? { things: e.things } : {}) }, lore: [] },
    });
  });
  Object.entries(file.exits).forEach(([id, e], i) => {
    const { parts } = prose(e.text);
    nodes.push({
      id, type: "story", position: { x: 800, y: 60 + 160 * i },
      data: { kind: "exit", title: e.title, description: parts.get("Outcome") ?? "", closing: parts.get("Closing") ?? "", result: extra.results[id]!, exitKind: e.kind, ...(e.next ? { next: e.next } : {}), effects: e.effects, lore: [] },
    });
  });

  // The routes, the start's first: one the same id as another beat's is that one's with its beat's name after it (a route's id is the scene's).
  const edges: Route[] = [];
  const taken = new Set<string>();
  for (const [beat, b] of [start, ...beats.filter(([id]) => id !== file.start)]) for (const r of b.routes) edges.push(edgeOf(r, beat, taken));
  for (const r of file.anytime) edges.push(edgeOf(r, file.start, taken));
  if (extra.routesIntoDiscoveries) for (const id of Object.keys(file.essentials)) edges.push(edgeOf({ id: `find-${id}`, on: "outcome", when: "", to: id }, file.start, taken));
  edges.push(...(extra.edges ?? []));

  const doc: SceneDocument & Record<string, unknown> = {
    format: "kingmaker", version: 2, kind: "scene", id: file.id, title: file.title, description: file.summary, lore: file.lore,
    ...(file.time ? { time: file.time } : {}), ...(file.place ? { place: file.place } : {}), ...(file.interlude ? { interlude: true } : {}),
    ...(file.rest ? { rest: file.rest } : {}), ...(file.milestone ? { milestone: true } : {}),
    ...extra.top,
    hook: read("hook.md").trim(), setting: read("setting.md").trim(), premise: read("premise.md").trim(), truth: extra.truth ?? "",
    ...(startProse.parts.has("Pressure") ? { clock: startProse.parts.get("Pressure")! } : {}),
    limits: items(read("limits.md")),
    cast: file.cast.map(c => memberOf(c, read(c.card), extra.whyHere[c.id] ?? "")),
    facts: file.facts,
    ...(file.background?.length ? { background: file.background } : {}),
    ...(file.assumes?.length ? { assumes: file.assumes } : {}), ...(file.overtaken ? { overtaken: file.overtaken } : {}),
    ...(file.onEnd?.length ? { onEnd: file.onEnd } : {}),
    ...(file.afterwards.length ? { afterwards: file.afterwards } : {}),
    ...(file.fronts ? { fronts: file.fronts } : {}),
    ...(file.kind === "talk" ? { companion: "{companion}" } : {}),
    nodes, edges,
  };
  return doc;
}

/** A beat's "## Cast" notes as the node's cast notes. */
function castNotes(parts: Map<string, string>): { cast?: Record<string, string> } {
  const notes = items(parts.get("Cast")).map(i => /^([\w{}-]+):\s*(.*)$/.exec(i)!).map(m => [m[1]!, m[2]!] as const);
  return notes.length ? { cast: Object.fromEntries(notes) } : {};
}

function edgeOf(r: RouteFile, beat: string, taken: Set<string>): Route {
  const id = taken.has(r.id) ? `${r.id}-${beat}` : r.id;
  if (taken.has(id)) throw new Error(`route ${id} twice`);
  taken.add(id);
  const establishes = [...(r.establishes ?? []), ...(r.check?.establishes?.success ?? [])];
  return {
    id, source: beat, target: r.check ? r.check.onSuccess : r.to!, type: "smoothstep", label: id.replace(/-/g, " ").replace(/^./, c => c.toUpperCase()),
    data: {
      condition: r.when, phase: r.on === "cue" ? "cue" : "outcome",
      skill: r.check?.skill ?? "", dc: r.check?.dc ?? 12,
      ...(r.check?.onFailure ? { onFailure: r.check.onFailure } : {}),
      ...(establishes.length ? { establishes } : {}),
    },
  };
}

function memberOf(c: CastFile, card: string, whyHere: string): CastMember {
  const { parts } = sections(card);
  const need = (k: string) => { const v = parts.get(k); if (v === undefined) throw new Error(`${c.card}: no ## ${k}`); return v; };
  return {
    id: c.id, name: c.name, ...(c.called ? { called: c.called } : {}), ...(c.aka ? { aka: c.aka } : {}),
    look: need("Look"), voice: need("Voice"), wants: need("Wants"), ...(parts.has("Fears") ? { fears: parts.get("Fears")! } : {}),
    whyHere, knows: items(need("Knows")), ...(parts.has("Secrets") ? { secrets: items(parts.get("Secrets")) } : {}),
    attitude: need("Attitude"),
    ...(c.enters ? { enters: c.enters } : {}), ...(c.group ? { group: c.group } : {}), ...(c.members ? { members: c.members } : {}),
    ...(c.statblock ? { statblock: c.statblock } : {}), ...(c.weapon ? { weapon: c.weapon } : {}),
  };
}

function write(path: string, doc: SceneDocument): void {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  parseScene(text, path);
  writeFileSync(path, text);
  console.log(`${path}: ${doc.nodes.length} nodes, ${doc.edges.length} routes`);
}

// ---------------------------------------------------------------------------------------------

const KELL_BETWEEN = "Lent to the King's investigator, she walks with them between scenes; her own errand at this hour (her card says what it is) takes her the same way.";

/** The lead, as an interlude's discovery: Kell's errand (free) and the town's gossip (asking around). */
const leadPaths = (where: string): Path[] => [
  { via: "kell", clue: `Her own errand: she says where she's going (${where}) and when, once, and goes, with the investigator or without.`, earn: "Free: she says it unasked, once, or when the investigator asks where she's off to.", strength: "strong" },
  { via: "gossip in the town", clue: "Porters, shopkeepers and bargees pass on what everyone on the stairs knows.", earn: "Asking around: a question, a coin or a pie for the talkative.", strength: "suggestive" },
];

write(join(SCENES, "talk.kmscene"), convert("talk", {
  opens: "As the talk opens", routesIntoDiscoveries: false, results: { goodbye: "good" },
  whyHere: { "{companion}": "Walking with the player between scenes; the player has stopped for a word with them." },
  truth: "Nothing in a talk is hidden from the GM but what {name} keeps back of their own story: their lore and memories say what it is, and how far they've come towards telling it. A talk moves nothing in the story on.",
  // How the talk reaches told: the game words this route for each talk, from what that talk may bring out (ai/gm/talk.ts prepareTalk), and with nothing to bring out there's none.
  edges: [{
    id: "confided", source: "talk", target: "told", type: "smoothstep", label: "Told",
    data: { condition: "{name} has told the player the one thing they were keeping back in this talk: the heart of it, in their own words, even if not every detail. (The game words this route for each talk, from what that talk may bring out.)", phase: "outcome", skill: "", dc: 12 },
  }],
}));
write(join(SCENES, "caerwyn-afternoon.kmscene"), convert("caerwyn-afternoon", {
  opens: "As it opens", routesIntoDiscoveries: true, results: { onward: "good" }, whyHere: { kell: KELL_BETWEEN },
  paths: { lead: leadPaths("down the river stairs to the Drowned Rat, at dusk") },
}));
write(join(SCENES, "wharf-night.kmscene"), convert("wharf-night", {
  opens: "As it opens", routesIntoDiscoveries: true, results: { onward: "good" }, whyHere: { kell: KELL_BETWEEN },
  paths: { lead: leadPaths("downriver to the Heron, to see its night loading with her own eyes") },
}));
write(join("shared", "scene", "testdata", "hanged-clerk.kmscene"), convert("hanged-clerk", {
  opens: "As the scene opens", routesIntoDiscoveries: false,
  results: { "case-made": "good", "open-case": "good", "wrong-man": "bad", "closed-suicide": "bad", "walked-away": "bad" },
  whyHere: {},
  top: { fixture: "The tests' own hanged clerk: the campaign's before M2 re-authored it (its scene.json and Markdown, in git history), in the scene format by tools/scene-folders.mts, so the tests of the code that plays a scene don't follow the campaign's content. Its beats are stages with the old routes between them (a route of the same id as one in an earlier beat has that beat's name after it), its essentials discoveries with nothing leading to them, and it has no truth or whyHere. Never installed by the campaign." },
}));
