import type { Identity, Timestamp } from "spacetimedb";
import { andList, MAX_CONCEPT, MAX_NAME, refusal } from "../../../shared/protocol/refusals.ts";
import type { BuildFile } from "../../../shared/scene/files.ts";
import { actorOf, Refused, runMove, type TxCtx } from "../context.ts";
import { seatPlayer, type CampaignRow, type GameRow } from "../rows.ts";
import { buildOf, buildsOf, campaignFile } from "../scenes.ts";
import { openScene } from "./open-scene.ts";

/**
 * new_game (v0-design §3.3): a game of an installed campaign, its caller the host with a ready-made
 * character (the build's sheet), the game's dice, and its first scene opened at once, which queues
 * the opening's think.
 */

export interface NewGameArgs { campaign: string; name: string; concept: string; build: string }

export function newGameReducer(tx: TxCtx, sender: Identity, args: NewGameArgs): void {
  const campaign = campaignNamed(tx, args.campaign);
  const build = buildNamed(campaign, args.build);
  const name = characterName(args.name);
  const concept = characterConcept(args.concept);

  const game = createGame(tx, campaign, sender, { name, concept, build });

  const file = campaignFile(campaign);
  runMove(tx, openScene, actorOf(tx, sender), { game: game.id, sceneKey: file.firstScene, start: { purse: file.startingPurse, gear: build.gear } });
}

/** The campaign by its name ("caerwyn", its newest version installed) or a version's id ("caerwyn@0.1.0"). */
function campaignNamed(tx: TxCtx, name: string): CampaignRow {
  const versions = [...tx.db.campaign.iter()].filter(c => c.key === name || c.id === name);
  const newest = versions.sort((a, b) => byVersion(b.version, a.version))[0];
  if (!newest) throw new Refused(refusal("no_campaign", { campaign: name }));
  return newest;
}

function buildNamed(campaign: CampaignRow, id: string): BuildFile {
  const build = buildOf(campaign, id);
  if (!build) throw new Refused(refusal("no_build", { build: id, builds: andList(Object.keys(buildsOf(campaign))) }));
  return build;
}

function characterName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME) throw new Refused(refusal("bad_name"));
  return trimmed;
}

/** The concept may be empty ("--new Wren" has none), but not long: it's in every request the game sends. */
function characterConcept(concept: string): string {
  const trimmed = concept.trim();
  if (trimmed.length > MAX_CONCEPT) throw new Refused(refusal("bad_concept"));
  return trimmed;
}

/**
 * A game's uid. It's in every request, key and folder of the AI service's, so it must never repeat,
 * and it's unique by construction, not by chance. The game's id makes it unique in its database. The
 * transaction's time and the database's identity keep it apart from a game with the same id in
 * another database, or in this one after its data was deleted (the AI service may still keep that
 * game's answers under its uid). The uuid's first block only adds spread: SpacetimeDB's generator
 * gives about 3% of transactions the same uuid (v0-design §14). Each part is letters and digits, so
 * the uid is a folder's name and a key's first part as it stands (shared/protocol/keys.ts isGameId).
 * `database` is the identity's hex: its first four digits are c200 in every identity, so twelve after them.
 */
export function gameUid(id: bigint, now: Timestamp, database: string, uuid: string): string {
  return `g${id}-${now.microsSinceUnixEpoch.toString(36)}-${database.slice(4, 16)}-${uuid.slice(0, 8)}`;
}

/** The game and its host: the player (seated, in place of any game they were in), their sheet, the game's dice. */
function createGame(tx: TxCtx, campaign: CampaignRow, sender: Identity, character: { name: string; concept: string; build: BuildFile }): GameRow {
  const file = campaignFile(campaign);
  // The uid takes the game's id, which the insert gives: until then, one no game keeps past its transaction.
  const made = tx.db.game.insert({
    id: 0n, uid: "new", campaign: file.id, campaignVersion: file.version, title: file.title,
    time: file.start.time, day: file.start.day, hostId: 0n, status: "playing", createdAt: tx.now,
  });
  const game = tx.db.game.id.update({ ...made, uid: gameUid(made.id, tx.now, tx.database(), tx.uuid()) });
  const player = tx.db.player.insert({
    id: 0n, identity: sender, gameId: game.id, name: character.name, concept: character.concept, role: "host",
    characterId: undefined, placeId: undefined, sceneId: undefined, online: true, suggestions: true,
  });

  seatPlayer(tx, sender, player.id);
  tx.db.sheet.insert({ playerId: player.id, gameId: game.id, build: character.build.build, skills: JSON.stringify(character.build.skills), statusLine: character.build.status });
  tx.db.dice.insert({ gameId: game.id, seed: tx.seed(), rolls: 0 });
  return tx.db.game.id.update({ ...game, hostId: player.id });
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
