import type { Identity } from "spacetimedb";
import { refusal } from "../../shared/protocol/refusals.ts";
import { campaignId, packOf, type CampaignPack, type InstallArgs } from "../../shared/scene/files.ts";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { sceneOf } from "../../shared/scene/load.ts";
import { validateScene } from "../../shared/scene/types.ts";
import { isAdmin } from "./access.ts";
import { Refused, type TxCtx } from "./context.ts";

/**
 * install_campaign (v0-design §8): a campaign version's structure (campaign.json, each scene's
 * scene.json and hook, its places, builds and looks), from the database's owner. Every scene must
 * load as the simulation will read it; re-installing a version replaces it whole (a game keeps the
 * version it started on, so a real release bumps the version). The words go to the AI service.
 */
export function installCampaignReducer(tx: TxCtx, sender: Identity, args: InstallArgs): void {
  if (!isAdmin(tx, sender)) throw new Refused(refusal("not_admin"));

  const pack = loadedPack(args);

  replaceVersion(tx, args, pack);
  tx.log(`installed ${args.id}: ${pack.scenes.map(s => s.scene.id).join(", ")}; ${pack.places.map(p => p.key).join(", ")}; builds ${Object.keys(pack.builds).join(", ")}`);
}

/** The pack, if it parses and every scene loads; else the bad_pack refusal saying why. */
function loadedPack(args: InstallArgs): CampaignPack {
  const pack = parsed(args);
  const problem = packProblem(args, pack);
  if (problem) throw new Refused(refusal("bad_pack", { why: problem }));
  return pack;
}

function parsed(args: InstallArgs): CampaignPack {
  try {
    return packOf(args);
  } catch (e) {
    throw new Refused(refusal("bad_pack", { why: `its JSON doesn't parse (${String(e)})` }));
  }
}

/** The first thing wrong with a pack: its id, a scene that doesn't load or names a place it hasn't got. */
function packProblem(args: InstallArgs, pack: CampaignPack): string | undefined {
  if (args.id !== campaignId(pack.campaign)) return `its id ${args.id} isn't campaign.json's ${campaignId(pack.campaign)}`;
  if (!pack.scenes.some(s => s.scene.id === pack.campaign.firstScene)) return `it has no first scene ${pack.campaign.firstScene}`;
  for (const { scene } of pack.scenes) {
    const problem = sceneProblem(scene, pack);
    if (problem) return `scene ${scene.id}: ${problem}`;
  }
  return undefined;
}

function sceneProblem(file: CampaignPack["scenes"][number]["scene"], pack: CampaignPack): string | undefined {
  try {
    const problems = validateScene(effectiveScene(sceneOf(file), []));
    if (problems.length) return problems.join("; ");
  } catch (e) {
    return String(e);
  }
  const place = file.place ?? pack.campaign.startPlace;
  return pack.places.some(p => p.key === place) ? undefined : `its place ${place} isn't in the pack`;
}

/** The version's rows, all of them new: the campaign, each scene's def (scene.json whole, and its hook) and each place's. */
function replaceVersion(tx: TxCtx, args: InstallArgs, pack: CampaignPack): void {
  tx.db.sceneDef.campaignId.delete(args.id);
  tx.db.placeDef.campaignId.delete(args.id);
  tx.db.campaign.id.delete(args.id);

  const c = pack.campaign;
  tx.db.campaign.insert({ id: args.id, key: c.id, version: c.version, title: c.title, json: args.campaign, builds: args.builds, looks: args.looks, installedAt: tx.now });
  for (const { scene, hook } of pack.scenes) {
    tx.db.sceneDef.insert({ id: `${args.id}/${scene.id}`, campaignId: args.id, key: scene.id, title: scene.title, hook, json: JSON.stringify(scene) });
  }
  for (const place of pack.places) {
    tx.db.placeDef.insert({ id: `${args.id}/${place.key}`, campaignId: args.id, key: place.key, json: JSON.stringify(place) });
  }
}
