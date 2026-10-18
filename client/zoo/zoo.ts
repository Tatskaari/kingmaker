// New (M6): the zoo as the client sees it (campaigns/zoo/README.md): its exhibits and ready-made builds from the installed zoo's row, the player's visit kept apart from the story's games, a fight that came from an exhibit with its line-ups, and the moves that make a visit, fight it again or pick other foes.
import type { BuildsFile, CampaignFile } from "../../shared/scene/files.ts";
import { exhibitIn, exhibitsOf, lineUpOf, ZOO, type Exhibit, type LineUp } from "../../shared/zoo/exhibits.ts";
import type { Backend, GameRow, HomeRows, Rejection } from "../backend.ts";
import type { FightView } from "../fight/view.ts";

/**
 * The zoo (shared/zoo/exhibits.ts): a campaign of its own, installed beside the story's, whose
 * exhibits a visit opens. The title offers it (z), the terminal opens one (npm run zoo -- ring), the
 * page too (?zoo=ring), and headless play (play new --zoo ring); a zoo fight's screen fights it again
 * (r) or with other foes (f). What's here reads the rows the client has and makes the moves.
 */

/** One of the zoo's ready-made characters: its id ("fighter"), what it's called on the menu, and its concept. */
export interface ZooBuild { id: string; title: string; concept: string }

/** The zoo as installed: its exhibits, and who a visitor can be. */
export interface Zoo { title: string; exhibits: Exhibit[]; builds: ZooBuild[] }

/** The installed zoo (its newest version), from the campaigns' rows; undefined when it isn't installed. */
export function zooOf(rows: Pick<HomeRows, "campaigns">): Zoo | undefined {
  const row = rows.campaigns.filter(c => c.key === ZOO).sort((a, b) => (a.version < b.version ? 1 : -1))[0];
  if (!row) return undefined;
  const file = parsed<Partial<CampaignFile>>(row.json) ?? {};
  const builds = parsed<BuildsFile>(row.builds ?? "") ?? {};
  return {
    title: row.title,
    exhibits: exhibitsOf(file),
    builds: Object.entries(builds).map(([id, b]) => ({ id, title: `The ${id}`, concept: b.concept })),
  };
}

/** Whether a game is a zoo visit (its summary says which campaign). */
export const isVisit = (game: Pick<GameRow, "campaign">) => game.campaign === ZOO;

/** The player's visit to the zoo, if they have one: the one played last. */
export function visitOf(rows: Pick<HomeRows, "games">): GameRow | undefined {
  return rows.games.filter(isVisit).sort((a, b) => Number(b.lastPlayedAt.microsSinceUnixEpoch - a.lastPlayedAt.microsSinceUnixEpoch))[0];
}

/** A fight that came from one of the zoo's exhibits: the exhibit, its line-ups, and the one being fought. */
export interface ZooFight { exhibit: Exhibit; lineUps: LineUp[]; foes: LineUp }

/** The fight's exhibit, when it came from one of the installed zoo's (its board says which, and with which line-up). */
export function zooFightOf(view: Pick<FightView, "board">, rows: Pick<HomeRows, "campaigns">): ZooFight | undefined {
  const from = view.board.zoo;
  const zoo = from ? zooOf(rows) : undefined;
  const exhibit = from && zoo ? exhibitIn({ exhibits: zoo.exhibits }, from.exhibit) : undefined;
  const foes = exhibit ? lineUpOf(exhibit, from!.foes) : undefined;
  return exhibit && foes ? { exhibit, lineUps: exhibit.fight?.foes ?? [], foes } : undefined;
}

/** What a visit opens with: the exhibit, who the player is, and (optionally) the foes, the visitor's name, and the other side's turns at once. */
export interface VisitWith { exhibit: string; build: string; foes?: string | undefined; name?: string | undefined; fast?: boolean | undefined }

/** A visit to the zoo, opening an exhibit (visit_zoo: a visit before goes). */
export function visit(game: Pick<Backend, "act">, how: VisitWith): Promise<Rejection | undefined> {
  return game.act("visitZoo", { exhibit: how.exhibit, build: how.build, name: how.name, foes: how.foes, fast: how.fast });
}

/** The fight's exhibit again, with the same foes, everyone whole (open_exhibit with none named). */
export function again(game: Pick<Backend, "act">, fight: ZooFight): Promise<Rejection | undefined> {
  return game.act("openExhibit", { exhibit: fight.exhibit.id, foes: undefined, fast: undefined });
}

/** The fight's exhibit with another of its line-ups. */
export function pickFoes(game: Pick<Backend, "act">, fight: ZooFight, foes: string): Promise<Rejection | undefined> {
  return game.act("openExhibit", { exhibit: fight.exhibit.id, foes, fast: undefined });
}

/** The ready-made build a visit is as, when it doesn't say: the zoo's first (the fighter). */
export const firstBuild = (zoo: Zoo) => zoo.builds[0]?.id ?? "fighter";

function parsed<T>(json: string): T | undefined {
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}
