import type { Identity } from "spacetimedb";
import type { Backstory } from "../../../shared/creation/types.ts";
import { MAX_CONCEPT, MAX_NAME, refusal } from "../../../shared/protocol/refusals.ts";
import { createCharacter } from "../../../shared/rules/index.ts";
import type { Build, Rules, RulesSession } from "../../../shared/rules/types.ts";
import type { CampaignFile } from "../../../shared/scene/files.ts";
import { Refused, type TxCtx } from "../context.ts";
import { seatPlayer, type CampaignRow, type GameRow, type PlayerRow } from "../rows.ts";
import { engineCall, insertCharacter, pocketsFor, sessionOf } from "../rules/session.ts";
import { campaignFile, sceneFileOf } from "../scenes.ts";
import type { Start } from "../world/place.ts";

/**
 * A new game and its host's character (v1-design §3.5-3.6): the game, its host's player seated, the
 * game's dice; then the character made by the rules engine from a build, as rows. new_game makes
 * both at once from a ready-made build; character creation makes them when the backstory is settled
 * (creation/make.ts), and `begin` sets off later.
 */

/** Who the host plays, and the game's uid (a new one, or the creation's). */
export interface Who { uid: string; name: string; concept: string }

/** A character's name as a player gives it: trimmed, and no longer than a name may be (bad_name). */
export function characterName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME) throw new Refused(refusal("bad_name"));
  return trimmed;
}

/** A concept may be empty ("--new Wren" has none), but not long: it's in every request the game sends (bad_concept). */
export function characterConcept(concept: string): string {
  const trimmed = concept.trim();
  if (trimmed.length > MAX_CONCEPT) throw new Refused(refusal("bad_concept"));
  return trimmed;
}

/**
 * A new game's id, or a creation's (which its game takes): the transaction's time in microseconds,
 * then tx.uuid()'s randomness, as a UUID. It names the game's folder and every key at the AI
 * service, so it must never come round again; and the module's randomness does: its generator is
 * seeded from the transaction's timestamp through a 32-bit hash that gives far fewer seeds than
 * timestamps (new_game hit a taken game.uid 4 times in 50 when the id was tx.uuid() alone). No
 * two transactions share a time, so the time keeps every id apart.
 */
export function newUid(tx: TxCtx): string {
  const hex = tx.now.microsSinceUnixEpoch.toString(16).padStart(13, "0") + tx.uuid().replace(/-/g, "").slice(13);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** How long the character took, in host milliseconds, for the module's log. */
export interface Made { createMs: number; sheetMs: number }

/** The game and its host: the player (seated, in place of any game they were in) and the game's dice. */
export function createGame(tx: TxCtx, campaign: CampaignRow, sender: Identity, who: Who): { game: GameRow; player: PlayerRow } {
  const file = campaignFile(campaign);
  const game = tx.db.game.insert({
    id: 0n, uid: who.uid, campaign: file.id, campaignVersion: file.version, title: file.title,
    time: firstSceneTime(tx, campaign, file), day: file.start.day, hostId: 0n, status: "playing", createdAt: tx.now,
  });
  const player = tx.db.player.insert({
    id: 0n, identity: sender, gameId: game.id, name: who.name, concept: who.concept, role: "host",
    characterId: undefined, placeId: undefined, sceneId: undefined, online: true, lastPlayedAt: tx.now,
  });

  seatPlayer(tx, sender, player.id);
  tx.db.dice.insert({ gameId: game.id, seed: tx.seed(), rolls: 0 });
  return { game: tx.db.game.id.update({ ...game, hostId: player.id }), player };
}

/**
 * The host's character, made by the rules engine from a build (the prototype's createSession with a
 * build: engine.ts:106-125): level 1, its choices, levelled up to the campaign's level, its kit
 * equipped, hit points the average, so no die is drawn. Its rules_state and its sheet, with the
 * backstory they wrote when there is one, and the campaign's starting purse in its pockets.
 */
export function makeCharacterRows(tx: TxCtx, player: PlayerRow, build: Build, level: number, backstory?: Backstory): Made {
  const session = newSession(tx, player, backstory);
  const started = tx.elapsedMs();

  engineCall(tx, player.gameId, rules => createCharacter(rules, session, level, build));
  const made = tx.elapsedMs();
  engineCall(tx, player.gameId, rules => writeCharacter(tx, player, session, rules));

  return { createMs: made - started, sheetMs: tx.elapsedMs() - made };
}

/** What a character takes into the game's first scene: the campaign's purse, and their gear but what the story has parted them from. */
export function startOf(tx: TxCtx, campaign: CampaignRow, playerId: bigint): Start {
  const state = tx.db.rulesState.playerId.find(playerId);
  const gear = state ? state.gear.filter(g => !state.gone.includes(g.id)).map(g => ({ id: g.id, name: g.name, kind: g.kind, ...(g.slot ? { slot: g.slot } : {}) })) : [];
  return { purse: campaignFile(campaign).startingPurse, gear };
}

// ---------------------------------------------------------------------------------------------

/** The session a new character is made on: the game's uid and dice, nothing rolled, and their backstory when they wrote one (createSession's). */
function newSession(tx: TxCtx, player: PlayerRow, backstory: Backstory | undefined): RulesSession {
  const session = sessionOf(tx, player);
  return { ...session, player: { ...session.player, ...(backstory?.text.trim() ? { backstory } : {}) } };
}

function writeCharacter(tx: TxCtx, player: PlayerRow, session: RulesSession, rules: Rules): void {
  insertCharacter(tx, player, session, rules, pocketsFor(tx, player, undefined));
}

/** The game's clock starts at its first scene's time (as the prototype's Game.create has it), else the campaign's. */
function firstSceneTime(tx: TxCtx, campaign: CampaignRow, file: CampaignFile): string {
  const def = tx.db.sceneDef.id.find(`${campaign.id}/${file.firstScene}`);
  return (def ? sceneFileOf(def).time : undefined) ?? file.start.time;
}

