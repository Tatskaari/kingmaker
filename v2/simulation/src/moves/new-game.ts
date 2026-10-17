import type { Identity } from "spacetimedb";
import { andList, refusal } from "../../../shared/protocol/refusals.ts";
import type { BuildFile } from "../../../shared/scene/files.ts";
import { actorOf, Refused, runMove, type TxCtx } from "../context.ts";
import { characterConcept, characterName, createGame, makeCharacterRows, startOf } from "../games/create.ts";
import type { CampaignRow } from "../rows.ts";
import { buildOf, buildsOf, campaignFile, campaignNamed } from "../scenes.ts";
import { openScene } from "./open-scene.ts";

/**
 * new_game (v0-design §3.3, v1-design §3.3): a game of an installed campaign, its caller the host
 * with a ready-made character, made by the rules engine from builds.json's build, and the game's
 * first scene opened at once, which queues the opening's think. No AI is asked for anything until
 * the opening.
 */

export interface NewGameArgs { campaign: string; name: string; concept: string; build: string }

export function newGameReducer(tx: TxCtx, sender: Identity, args: NewGameArgs): void {
  const started = tx.elapsedMs();
  const campaign = campaignNamed(tx, args.campaign);
  const build = buildNamed(campaign, args.build);
  const name = characterName(args.name);
  const concept = characterConcept(args.concept);

  const { game, player } = createGame(tx, campaign, sender, { name, concept });
  const made = makeCharacterRows(tx, player, build.build, campaignFile(campaign).level);

  runMove(tx, openScene, actorOf(tx, sender), { game: game.id, sceneKey: campaignFile(campaign).firstScene, start: startOf(tx, campaign, player.id) });
  tx.log(`[rules] newGame ${Math.round(tx.elapsedMs() - started)} ms (createCharacter ${Math.round(made.createMs)}, sheetData ${Math.round(made.sheetMs)})`);
}

/** builds.json's ready-made build of that id; no_build, naming those there are, when there's none. */
function buildNamed(campaign: CampaignRow, id: string): BuildFile {
  const build = buildOf(campaign, id);
  if (!build) throw new Refused(refusal("no_build", { build: id, builds: andList(Object.keys(buildsOf(campaign))) }));
  return build;
}
