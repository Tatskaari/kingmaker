import type { GmState, ScenePatch } from "../../shared/gm/state.ts";
import type { SceneDocument } from "../../shared/scene/document.ts";
import { campaignId, type BuildFile, type BuildsFile, type CampaignFile, type LooksFile, type PlaceFile } from "../../shared/scene/files.ts";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import type { Exit, Scene } from "../../shared/scene/types.ts";
import { refusal } from "../../shared/protocol/refusals.ts";
import { talkOf, talkSceneDocument, type TalkCompanion } from "../../shared/scene/talk.ts";
import { Refused, type TxCtx } from "./context.ts";
import { gameRow, type CampaignRow, type GameRow, type SceneDefRow, type SceneRow } from "./rows.ts";

/**
 * A game's content as the simulation has it: the campaign version it started on, its scenes (each
 * .kmscene file whole, with its words) and its places, installed by install_campaign. A scene's graph
 * is the runtime's Scene made from its file, the improvised ending added, as the AI service's own
 * graph is: the two run the same graph helpers (shared/scene/graph.ts, beats.ts) on it and must agree.
 */

/** The campaign version a game plays: "caerwyn@0.1.0". */
export const gameCampaignId = (game: GameRow) => campaignId({ id: game.campaign, version: game.campaignVersion });

export function campaignOfGame(tx: TxCtx, game: GameRow): CampaignRow {
  const row = tx.db.campaign.id.find(gameCampaignId(game));
  if (!row) throw new Error(`game ${game.id}'s campaign ${gameCampaignId(game)} isn't installed`);
  return row;
}

/** A campaign a player names: by its name ("caerwyn", its newest version installed) or a version's id ("caerwyn@0.1.0"); no_campaign when there's none. */
export function campaignNamed(tx: TxCtx, name: string): CampaignRow {
  const versions = [...tx.db.campaign.iter()].filter(c => c.key === name || c.id === name);
  const newest = versions.sort((a, b) => byVersion(b.version, a.version))[0];
  if (!newest) throw new Refused(refusal("no_campaign", { campaign: name }));
  return newest;
}

/** A campaign version by its parts: what a creation or a game keeps. */
export function campaignVersion(tx: TxCtx, id: string, version: string): CampaignRow {
  const row = tx.db.campaign.id.find(campaignId({ id, version }));
  if (!row) throw new Error(`campaign ${campaignId({ id, version })} isn't installed`);
  return row;
}

export const campaignFile = (row: CampaignRow) => JSON.parse(row.json) as CampaignFile;
export const buildsOf = (row: CampaignRow) => JSON.parse(row.builds) as BuildsFile;
export const looksOf = (row: CampaignRow) => JSON.parse(row.looks) as LooksFile;

/** A ready-made build by its id, if the campaign has it (Object.hasOwn is ES2022: the module's lib is ES2021). */
export function buildOf(row: CampaignRow, id: string): BuildFile | undefined {
  const builds = buildsOf(row);
  return Object.prototype.hasOwnProperty.call(builds, id) ? builds[id] : undefined;
}

/** A scene's def in a game's campaign version; a talk's (talk-<companion>-<n>) is the campaign's talk template, filled for its companion. */
export function sceneDefOf(tx: TxCtx, game: GameRow, sceneKey: string): SceneDefRow {
  const def = tx.db.sceneDef.id.find(`${gameCampaignId(game)}/${sceneKey}`);
  if (def) return def;
  const talk = talkOf(sceneKey);
  if (talk) return talkDefOf(tx, game, sceneKey, talk);
  throw new Error(`${gameCampaignId(game)} has no scene ${sceneKey}`);
}

/**
 * A talk's scene def (docs/town-design.md §3.6), made as it's asked for, never kept: the
 * campaign's talk template (campaign.json's `talk` names it, installed as a scene def of that key)
 * filled for the companion (shared/scene/talk.ts talkSceneDocument: their name, their id, the
 * farewell, and the statblock and weapon of their card in the scene they came from), its hook too.
 */
function talkDefOf(tx: TxCtx, game: GameRow, sceneKey: string, talk: { companion: string; n: number }): SceneDefRow {
  const key = campaignFile(campaignOfGame(tx, game)).talk;
  const template = key ? tx.db.sceneDef.id.find(`${gameCampaignId(game)}/${key}`) : undefined;
  if (!template) throw new Error(`${gameCampaignId(game)} has no talk template for ${sceneKey}`);
  const who = companionCard(tx, game, talk.companion);
  const doc = talkSceneDocument(documentOf(template), who, talk.n);
  return { id: `${gameCampaignId(game)}/${sceneKey}`, campaignId: template.campaignId, key: sceneKey, title: doc.title, hook: doc.hook, json: JSON.stringify(doc) };
}

/** Who a talk is with, as the story's scenes have them: their name, statblock and weapon on the card of the latest scene that has them (or, with none, their cast id). */
function companionCard(tx: TxCtx, game: GameRow, id: string): TalkCompanion {
  const scenes = [...tx.db.scene.gameId.filter(game.id)].filter(s => s.kind !== "talk").sort((a, b) => (a.id > b.id ? -1 : 1));
  for (const s of scenes) {
    const card = documentOf(sceneDefOf(tx, game, s.sceneKey)).cast.find(c => c.id === id);
    if (card) return { id, name: card.name, ...(card.statblock ? { statblock: card.statblock } : {}), ...(card.weapon ? { weapon: card.weapon } : {}) };
  }
  return { id, name: id };
}

/** A place's file in a game's campaign version. */
export function placeFileOf(tx: TxCtx, game: GameRow, placeKey: string): PlaceFile {
  const def = tx.db.placeDef.id.find(`${gameCampaignId(game)}/${placeKey}`);
  if (!def) throw new Error(`${gameCampaignId(game)} has no place ${placeKey}`);
  return JSON.parse(def.json) as PlaceFile;
}

/** A scene's file as its def keeps it (install_campaign held it to the format: shared/scene/document.ts). */
export const documentOf = (def: SceneDefRow) => JSON.parse(def.json) as SceneDocument;

/** A scene's graph from its def: the scene with its words, and the improvised ending; with `patches`, as play has changed it. */
export function graphOf(def: SceneDefRow, patches: ScenePatch[] = []): Scene {
  return effectiveScene(sceneOf(documentOf(def)), patches);
}

/**
 * The graph of a scene being played, as play has changed it (full-gm-design §4.2): the co-GM's routes
 * and bridging beats, and the ways of trying a ruling shut (gm.patches), as the AI service's own graph
 * has them, so a route it offers is one the decide commit finds. `{ patches: [] }`: the scene as
 * authored.
 */
export function sceneGraph(tx: TxCtx, scene: SceneRow, gm: Pick<GmState, "patches">): Scene {
  return graphOf(sceneDefOf(tx, gameRow(tx, scene.gameId), scene.sceneKey), gm.patches);
}

/**
 * Whether a scene plays on the two-part GM's steps (docs/two-part-design.md): a scene of the story
 * does (a talk keeps its own), unless its campaign says its scenes are the old pipeline's
 * (campaign.json's `gm`).
 */
export function playsTwoPart(tx: TxCtx, scene: Pick<SceneRow, "kind" | "gameId">): boolean {
  return scene.kind !== "talk" && campaignFile(campaignOfGame(tx, gameRow(tx, scene.gameId))).gm !== "pipeline";
}

/** An exit of the graph by its id. */
export function exitOf(graph: Scene, id: string): Exit {
  const exit = graph.exits.find(e => e.id === id);
  if (!exit) throw new Error(`${graph.id} has no exit ${id}`);
  return exit;
}

/** Version strings compared part by part, numbers as numbers ("0.10.0" after "0.9.0"). */
function byVersion(a: string, b: string): number {
  const x = a.split("."), y = b.split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? "0", q = y[i] ?? "0";
    const diff = /^\d+$/.test(p) && /^\d+$/.test(q) ? Number(p) - Number(q) : p < q ? -1 : p > q ? 1 : 0;
    if (diff) return diff;
  }
  return 0;
}
