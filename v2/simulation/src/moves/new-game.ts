import type { Identity } from "spacetimedb";
import { andList, MAX_NAME, refusal } from "../../../shared/protocol/refusals.ts";
import { actorOf, Refused, runMove, type TxCtx } from "../context.ts";
import { seatPlayer, type CampaignRow, type GameRow } from "../rows.ts";
import { buildOf, buildsOf, campaignFile } from "../scenes.ts";
import { openScene } from "./open-scene.ts";
import { READY_MADE, type ReadyMade } from "./ready-made.ts";

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

  const game = createGame(tx, campaign, sender, { name, concept: args.concept.trim(), build });

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

/** builds.json's build of that id, as V0 dumped its sheet (ready-made.ts, until the engine makes it: a build without one isn't built yet). */
function buildNamed(campaign: CampaignRow, id: string): ReadyMade {
  if (!buildOf(campaign, id)) throw new Refused(refusal("no_build", { build: id, builds: andList(Object.keys(buildsOf(campaign))) }));
  const sheet = READY_MADE[id];
  if (!sheet) throw new Refused(refusal("not_built"));
  return sheet;
}

function characterName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME) throw new Refused(refusal("bad_name"));
  return trimmed;
}

/** The game and its host: the player (seated, in place of any game they were in), their sheet, the game's dice. */
function createGame(tx: TxCtx, campaign: CampaignRow, sender: Identity, character: { name: string; concept: string; build: ReadyMade }): GameRow {
  const file = campaignFile(campaign);
  const game = tx.db.game.insert({
    id: 0n, uid: tx.uuid(), campaign: file.id, campaignVersion: file.version, title: file.title,
    time: file.start.time, day: file.start.day, hostId: 0n, status: "playing", createdAt: tx.now,
  });
  const player = tx.db.player.insert({
    id: 0n, identity: sender, gameId: game.id, name: character.name, concept: character.concept, role: "host",
    characterId: undefined, placeId: undefined, sceneId: undefined, online: true, lastPlayedAt: tx.now,
  });

  seatPlayer(tx, sender, player.id);
  tx.db.sheet.insert({
    playerId: player.id, gameId: game.id, build: character.build.build, skills: JSON.stringify(character.build.skills), statusLine: character.build.status,
    level: character.build.level, hp: 0, maxHp: 0, ac: 0, slots: [], conditions: [], spells: [], weapons: [], features: [], data: "", pockets: "", backstory: undefined,
  });
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
