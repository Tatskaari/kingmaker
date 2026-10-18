// New (M6): the zoo's exhibits in a game (shared/zoo/exhibits.ts): a visit made (visit_zoo: a game of the zoo's campaign as one of its ready-made characters, on the exhibit's map, its earlier visits gone) and an exhibit opened in it (open_exhibit: a fight exhibit's line-up read off the game's own campaign files and started through startFight, the one way in; again, or with other foes).
import type { Identity } from "spacetimedb";
import type { FightSetup } from "../../../shared/fight/types.ts";
import { andList, refusal } from "../../../shared/protocol/refusals.ts";
import type { CampaignFile } from "../../../shared/scene/files.ts";
import { exhibitIn, exhibitLayout, exhibitsOf, lineUpOf, ZOO, type Exhibit, type ExhibitFiles, type LineUp } from "../../../shared/zoo/exhibits.ts";
import { actorOf, Refused, type TxCtx } from "../context.ts";
import { boardOfRow, fightOf } from "../fight/rows.ts";
import { startFight } from "../fight/start.ts";
import { characterName, createGame, makeCharacterRows } from "../games/create.ts";
import { deleteGameRows } from "../games/delete.ts";
import { mapFilesOf } from "../map/rows.ts";
import { putOnMap } from "../map/start.ts";
import { gameRow, playerRow, type CampaignRow, type GameRow, type PlayerRow } from "../rows.ts";
import { buildOf, buildsOf, campaignFile, campaignNamed, campaignOfGame, documentOf, placeFileOf, sceneDefOf } from "../scenes.ts";

/**
 * The zoo (campaigns/zoo/README.md): a visit is a game of the zoo's campaign, kept apart from the
 * story's games (the title doesn't offer it to carry on), one a player at a time; an exhibit opened in
 * it is set out from the campaign's own files. The combat ring's is a fight: the player (rested: it's
 * practice), its allies and the line-up of foes picked, everyone where the ring's place starts them.
 */

/** Who a visitor is when they don't say (the prototype's zoo visitor). */
export const VISITOR = "Wren Ashdown";

export interface VisitArgs { exhibit: string; build: string; name?: string | undefined; foes?: string | undefined; fast?: boolean | undefined }
export interface OpenArgs { exhibit: string; foes?: string | undefined; fast?: boolean | undefined }

/**
 * visit_zoo: a visit to the zoo, opening one of its exhibits. The caller's earlier visits go (a visit
 * is for seeing an exhibit through, not for keeping), then a game of the zoo's campaign as one of its
 * ready-made characters (`build`; `name`, or the zoo's visitor), on the exhibit's map where its place
 * starts the player, with no lead; and the exhibit opened, with the line-up of foes asked for (or its
 * first). Refused when the zoo isn't installed, or hasn't that exhibit, line-up or build.
 */
export function visitZooReducer(tx: TxCtx, sender: Identity, args: VisitArgs): void {
  const campaign = campaignNamed(tx, ZOO);
  const file = campaignFile(campaign);
  const exhibit = exhibitNamed(file, args.exhibit);
  const lineUp = lineUpNamed(exhibit, args.foes);
  const build = buildNamed(campaign, args.build);
  const name = characterName(args.name || VISITOR);

  leaveEarlierVisits(tx, sender);
  const { game, player } = createGame(tx, campaign, sender, { name, concept: build.concept });
  makeCharacterRows(tx, player, build.build, file.level);
  const layout = layoutOf(tx, game, exhibit, lineUp);
  putOnMap(tx, game, layout.map.id, layout.player);

  openIn(tx, gameRow(tx, game.id), playerRow(tx, player.id), exhibit, lineUp, args.fast ?? false);
  tx.log(`[zoo] game ${game.id}: ${name} (${args.build}) visits ${exhibit.id}`);
}

/**
 * open_exhibit: one of the game's campaign's exhibits opened again, the host's, out of a scene: a
 * fight exhibit's fight started afresh (whatever fight was on goes: "again"), with the line-up asked
 * for, or with none the one its last fight had (else its first); at the last fight's pace unless it
 * says (fast: the other side's turns at once, for QA).
 */
export function openExhibitReducer(tx: TxCtx, sender: Identity, args: OpenArgs): void {
  const { game, player } = hostsGame(tx, sender);
  const exhibit = exhibitNamed(campaignFile(campaignOfGame(tx, game)), args.exhibit, game);
  const last = lastFight(tx, game, exhibit);
  const lineUp = lineUpNamed(exhibit, args.foes || last?.foes);

  openIn(tx, game, player, exhibit, lineUp, args.fast ?? last?.fast ?? false);
}

/** A fight exhibit's fight, as its files set it out (a fight is the only kind of exhibit so far). */
function openIn(tx: TxCtx, game: GameRow, player: PlayerRow, exhibit: Exhibit, lineUp: LineUp, fast: boolean): void {
  if (!exhibit.fight) throw new Refused(refusal("not_built"));
  startFight(tx, player, exhibitSetup(tx, game, exhibit, lineUp, player, { fast }));
}

/**
 * A fight exhibit's fight, set out with a line-up from the game's campaign's files (shared/zoo/exhibits.ts
 * exhibitLayout): on its map, the player where its place starts them, its allies and the line-up's
 * foes each as their cast card has them (statblock, weapon) and fighting as the exhibit says, its lit
 * things to knock over; the player rested (practice) and their sheet left as it was.
 */
export function exhibitSetup(tx: TxCtx, game: GameRow, exhibit: Exhibit, lineUp: LineUp, player: { name: string }, options: { fast?: boolean } = {}): FightSetup {
  const layout = layoutOf(tx, game, exhibit, lineUp);
  return {
    title: exhibit.title,
    place: lowerFirst(layout.place.name),
    map: { key: layout.map.id },
    combatants: [
      { id: "player", name: player.name, side: "player", role: "player", at: layout.player },
      ...layout.fighters.map(f => ({
        id: f.id, castId: f.id, name: f.card.name, side: f.side, role: f.role, at: f.at,
        ...(f.card.statblock ? { statblock: f.card.statblock } : {}), ...(f.card.weapon ? { weapon: f.card.weapon } : {}),
      })),
    ],
    ...(layout.props.length ? { props: layout.props } : {}),
    fresh: true,
    ...(options.fast ? { fast: true } : {}),
    zoo: { exhibit: exhibit.id, foes: lineUp.id },
  };
}

// ---------------------------------------------------------------------------------------------

/** The exhibit's layout with a line-up, from the game's campaign: its scene's file, its place's, and the maps. */
function layoutOf(tx: TxCtx, game: GameRow, exhibit: Exhibit, lineUp: LineUp): ReturnType<typeof exhibitLayout> {
  const scene = documentOf(sceneDefOf(tx, game, exhibit.scene));
  const files: ExhibitFiles = { scenes: [scene], places: scene.place ? [placeFileOf(tx, game, scene.place)] : [], maps: mapFilesOf(tx, game) };
  return exhibitLayout(exhibit, lineUp, files);
}

/** The game the caller hosts, its seat's: out of a scene still being played. */
function hostsGame(tx: TxCtx, sender: Identity): { game: GameRow; player: PlayerRow } {
  const actor = actorOf(tx, sender);
  const player = actor.id === undefined ? undefined : (tx.db.player.id.find(actor.id) ?? undefined);
  if (!player) throw new Refused(refusal("not_in_game"));
  const game = gameRow(tx, player.gameId);
  if (player.id !== game.hostId) throw new Refused(refusal("not_controller", { name: playerRow(tx, game.hostId).name }));
  const scene = player.sceneId === undefined ? undefined : tx.db.scene.id.find(player.sceneId);
  if (scene && scene.status !== "ended") throw new Refused(refusal("scene_on"));
  return { game, player };
}

/** The campaign's exhibit of that id; no_exhibit, naming those there are, when there's none (a story's campaign has none). */
function exhibitNamed(file: CampaignFile, id: string, game?: GameRow): Exhibit {
  const exhibit = exhibitIn(file, id);
  if (exhibit) return exhibit;
  const where = game && game.campaign !== ZOO ? `in ${file.title} (the zoo's are in the zoo)` : "in the zoo";
  throw new Refused(refusal("no_exhibit", { exhibit: id, exhibits: andList(exhibitsOf(file).map(e => e.id)), where }));
}

/** A fight exhibit's line-up of that id, or its first with none; no_line_up, naming those there are. */
function lineUpNamed(exhibit: Exhibit, id: string | undefined): LineUp {
  const lineUp = lineUpOf(exhibit, id);
  if (lineUp) return lineUp;
  throw new Refused(refusal("no_line_up", { exhibit: exhibit.title, foes: id ?? "", lineUps: andList((exhibit.fight?.foes ?? []).map(f => f.id)) }));
}

/** The zoo's ready-made build of that id; no_build, naming those there are. */
function buildNamed(campaign: CampaignRow, id: string): NonNullable<ReturnType<typeof buildOf>> {
  const build = buildOf(campaign, id);
  if (!build) throw new Refused(refusal("no_build", { build: id, builds: andList(Object.keys(buildsOf(campaign))) }));
  return build;
}

/** The line-up and pace the game's last fight of this exhibit had: fighting it again picks the same foes, at the same pace. */
function lastFight(tx: TxCtx, game: GameRow, exhibit: Exhibit): { foes: string; fast: boolean } | undefined {
  const fight = fightOf(tx, game.id);
  const board = fight ? boardOfRow(fight) : undefined;
  return board?.zoo?.exhibit === exhibit.id ? { foes: board.zoo.foes, fast: !!board.fast } : undefined;
}

/** The caller's earlier visits to the zoo: every row of each game of the zoo's campaign they host. */
function leaveEarlierVisits(tx: TxCtx, sender: Identity): void {
  const visits = [...tx.db.player.identity.filter(sender)].filter(p => p.role === "host").map(p => tx.db.game.id.find(p.gameId)).filter((g): g is GameRow => !!g && g.campaign === ZOO);
  for (const game of visits) deleteGameRows(tx, game);
}

const lowerFirst = (t: string) => (/^(The|A|An) /.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
