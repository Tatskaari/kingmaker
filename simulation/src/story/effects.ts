import type { GmState } from "../../../shared/gm/state.ts";
import type { Cond, Effect } from "../../../shared/scene/files.ts";
import type { Scene } from "../../../shared/scene/types.ts";
import type { TxCtx } from "../context.ts";
import { gameRow, type SceneRow } from "../rows.ts";
import { campaignFile, campaignOfGame } from "../scenes.ts";

/**
 * An ending's effects (story-design §4.3; the prototype's exit scripts as data, content-world A6),
 * read as the prototype's recording world reads a script, each kept only when its facts hold: `if`,
 * every fact named established (or the co-GM's canon, as engine.ts:986 hands the script both);
 * `unless`, none of them. The ones that only write the story are applied, as rows the notebook, the
 * quests and every later request read: quest, flag, attitude (the controller's), journal, follow.
 * The rest (remember, promise, give, remove, create, a fight's set-up) are recorded, a log line each,
 * as the prototype records them all and reads back only the journal.
 */

/** What an ending's effects came to: the applied ones and the recorded ones, a few words each. */
export interface Done { applied: string[]; recorded: string[] }

/** The scene ending, as its effects read it: its row, its graph (the cast's names, the facts' sentences), and its bookkeeping (what's established). */
export interface Ending { scene: SceneRow; graph: Scene; gm: GmState }

export function applyEffects(tx: TxCtx, at: Ending, effects: Effect[]): Done {
  const done: Done = { applied: [], recorded: [] };
  const holds = holdsIn(at);
  for (const effect of effects.filter(holds)) {
    const applied = apply(tx, at, effect);
    if (applied) done.applied.push(applied);
    else done.recorded.push(recordOf(effect));
  }
  return done;
}

/** Every effect, recorded: a fight's (its combat exit's script sets the fight out: the stand-in has none to set). */
export function recordAll(at: Ending, effects: Effect[]): string[] {
  return effects.filter(holdsIn(at)).map(recordOf);
}

/** Whether an effect's facts hold: its `if` facts all established, its `unless` facts none. */
function holdsIn(at: Ending): (e: Cond) => boolean {
  const known = new Set([...at.gm.established, ...at.gm.canon]);
  const isTrue = (id: string) => { const sentence = at.graph.facts?.[id]; return sentence !== undefined && known.has(sentence); };
  return e => listOf(e.if?.established).every(isTrue) && !listOf(e.unless?.established).some(isTrue);
}

const listOf = (facts: string | string[] | undefined): string[] => (facts === undefined ? [] : typeof facts === "string" ? [facts] : facts);

/** An effect that writes the story, written; undefined for one that's only recorded. */
function apply(tx: TxCtx, at: Ending, effect: Effect): string | undefined {
  switch (effect.op) {
    case "quest": return quest(tx, at.scene, effect as QuestEffect);
    case "flag": return flag(tx, at.scene, effect as FlagEffect);
    case "attitude": return attitude(tx, at.scene, effect as AttitudeEffect);
    case "journal": return journal(tx, at.scene, (effect as JournalEffect).text);
    case "follow": return follow(tx, at, (effect as FollowEffect).who);
    default: return undefined;
  }
}

type QuestEffect = Extract<Effect, { op: "quest" }>;
type FlagEffect = Extract<Effect, { op: "flag" }>;
type AttitudeEffect = Extract<Effect, { op: "attitude" }>;
type JournalEffect = Extract<Effect, { op: "journal" }>;
type FollowEffect = Extract<Effect, { op: "follow" }>;

/**
 * A quest started, advanced, completed or failed: by its key, one row a game. One the story hasn't
 * started yet is made as it's first touched, titled as the scenario's quests have it.
 */
function quest(tx: TxCtx, scene: SceneRow, e: QuestEffect): string {
  const old = [...tx.db.quest.gameId.filter(scene.gameId)].find(q => q.key === e.quest);
  const titles = campaignFile(campaignOfGame(tx, gameRow(tx, scene.gameId))).quests ?? {};
  const title = e.title ?? old?.title ?? (Object.prototype.hasOwnProperty.call(titles, e.quest) ? titles[e.quest]! : e.quest);
  const status = e.do === "complete" ? "complete" : e.do === "fail" ? "failed" : e.do === "start" ? "active" : (old?.status ?? "active");
  const stage = e.stage ?? old?.stage;
  if (old) tx.db.quest.id.update({ ...old, title, status, stage, notes: [...old.notes, e.text], updatedAt: tx.now });
  else tx.db.quest.insert({ id: 0n, gameId: scene.gameId, key: e.quest, title, status, stage, notes: [e.text], updatedAt: tx.now });
  return `quest ${e.quest} ${e.do}`;
}

/** A story flag, by its name: the latest ending's word on it stands. */
function flag(tx: TxCtx, scene: SceneRow, e: FlagEffect): string {
  const old = [...tx.db.flag.gameId.filter(scene.gameId)].find(f => f.name === e.name);
  if (old) tx.db.flag.id.update({ ...old, value: e.value, sceneId: scene.id });
  else tx.db.flag.insert({ id: 0n, gameId: scene.gameId, name: e.name, value: e.value, sceneId: scene.id });
  return `flag ${e.name}`;
}

/** How one of the cast stands towards the scene's controller now, and why. */
function attitude(tx: TxCtx, scene: SceneRow, e: AttitudeEffect): string {
  const old = [...tx.db.attitude.gameId.filter(scene.gameId)].find(a => a.castKey === e.who && a.playerId === scene.controllerId);
  const row = { gameId: scene.gameId, castKey: e.who, playerId: scene.controllerId, attitude: e.to, reason: e.text, at: tx.now };
  if (old) tx.db.attitude.id.update({ ...old, ...row });
  else tx.db.attitude.insert({ id: 0n, ...row });
  return `attitude ${e.who} ${e.to}`;
}

/** A line in the investigator's notebook, about this scene, numbered on in the game. */
export function journal(tx: TxCtx, scene: SceneRow, text: string): string {
  const seq = Math.max(0, ...[...tx.db.journal.gameId.filter(scene.gameId)].map(j => j.seq)) + 1;
  tx.db.journal.insert({ id: 0n, gameId: scene.gameId, sceneId: scene.id, seq, text, at: tx.now });
  return "journal";
}

/** Someone of the cast walks with the controller between scenes from now on (Kell, after the granary): once, from the scene that set them walking. */
function follow(tx: TxCtx, at: Ending, who: string): string {
  const already = [...tx.db.follower.gameId.filter(at.scene.gameId)].some(f => f.castKey === who);
  const name = at.graph.cast.find(c => c.id === who)?.name ?? who;
  if (!already) tx.db.follower.insert({ id: 0n, gameId: at.scene.gameId, castKey: who, name, leaderId: at.scene.controllerId, sinceScene: at.scene.sceneKey });
  return `follow ${who}`;
}

/** A recorded effect, in a few words: "remember kell", "give ledger-page", "startFight". */
function recordOf(effect: Effect): string {
  const e = effect as Partial<Record<"who" | "by" | "what" | "name", string>> & { op: string };
  const about = e.op === "remember" ? e.who : e.op === "promise" ? e.by : e.what || e.name;
  return about ? `${e.op} ${about}` : e.op;
}
