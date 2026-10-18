// New (docs/combat-gm.md): a fight breaking out in a scene. The mouthpiece's reply rolls for
// initiative (or says so in so many words), or the co-GM takes the scene into an event with a fight
// (the Heron's blades out). Everyone here takes a side or runs: whoever the reply placed, whoever the
// prep's line-up puts in it, whoever reacted to the player's violence by the side their reaction
// took, the companion beside the player; the rest are the GM's to place, in one call (the sides
// step, pick_sides). Then the scene is at its fight: the player goes on to it, and it's set out on
// the board (story/fight.ts), fought as the zoo's combat ring fights one, and handed back.

import { sideOfPick, type FightSide, type SceneFight } from "../../../shared/gm/fight.ts";
import type { FightNewcomer, Initiative, SidesResponse } from "../../../shared/protocol/ai.ts";
import { idOf } from "../../../shared/protocol/keys.ts";
import { fightsAhead, storyNeeds, takeRoute } from "../../../shared/scene/beats.ts";
import { fighterOf, presentCast, presentFighters } from "../../../shared/scene/graph.ts";
import { beingCalled, unnamed } from "../../../shared/scene/names.ts";
import type { Character, Scene } from "../../../shared/scene/types.ts";
import type { SceneWorld } from "../../../shared/world/scene-world.ts";
import { bystander } from "../../../shared/rules/acts.ts";
import type { TxCtx } from "../context.ts";
import { afterTurn } from "../gm/background.ts";
import { putGm } from "../gm/rows.ts";
import { updateScene } from "../rows.ts";
import { addEntry, entriesOf, writeReply } from "../transcript.ts";
import { finishTurn } from "../turns.ts";
import { placeWorldOf } from "../world/place.ts";
import type { Next } from "./move.ts";
import type { SayPlan } from "./plans.ts";
import { atTurn, type At } from "./say-commits.ts";

/**
 * A fight breaks out (the reply's roll_for_initiative, its words, or the co-GM's move into an event
 * with a fight): everyone here on a side, or running from it. The player is always in it. With them
 * are whoever follows them (the companion, unless the reply set them against the player or had them
 * run) and whoever the reply put beside them; against them, those it put against them (named, they're
 * in it even if the player's blow has felled them already); those it had run run, off the board
 * as it tells it (smoke5-1018: the girl the reply had bolt through the gate stood beside the axe,
 * kept clear), though whoever the story needs never leaves the scene (fight/scene.ts
 * fightIntoWorld: the companion, whoever holds what the player still needs, cowers and is here
 * after it). One that breaks out in the reply while a fight of the prep is on offer (fightsAhead:
 * the Heron's blades out) is that one: the scene goes there by its route, and its line-up fights.
 * Whoever the reply left out who reacted to the player's violence this turn keeps the side their
 * reaction took. Everyone else here who could is the GM's to place (the sides step); with nobody to,
 * the scene is at its fight now. Undefined, and nothing started, when nobody here is against the
 * player or could be.
 */
export function breakOut(tx: TxCtx, at: At, plan: SayPlan, initiative: Initiative, from: "reply" | "settle"): Next<SayPlan> | undefined {
  const world = placeWorldOf(tx, at.scene).world;
  const pool = fightersHere(at, world);
  const ahead = from === "reply" ? fightsAhead(at.graph, at.gm)[0] : undefined;
  const beat = from === "settle" ? at.graph.beats.find(b => b.id === at.gm.beat && b.fight) : ahead?.beat;
  const foeIds = new Set([...initiative.foes, ...(beat?.fight?.foes ?? [])]);
  const fleeIds = new Set((initiative.flee ?? []).filter(id => !foeIds.has(id)));
  const allyIds = new Set([...initiative.allies, ...(beat?.fight?.allies ?? []), ...companionsHere(tx, at).filter(id => !fleeIds.has(id))]);
  // Whoever the reply put on no side who reacted to the player's violence this turn keeps the side their reaction took: going for the player, taking their side, running.
  for (const [id, how] of Object.entries(plan.acted?.reactions ?? {})) {
    if (foeIds.has(id) || allyIds.has(id) || fleeIds.has(id)) continue;
    if (how === "fight") foeIds.add(id);
    else if (how === "join_player") allyIds.add(id);
    else if (how === "flee" || how === "raise_alarm") fleeIds.add(id);
  }
  const sides: Record<string, FightSide> = {};
  for (const c of pool) {
    if (foeIds.has(c.id)) sides[c.id] = "against";
    else if (allyIds.has(c.id)) sides[c.id] = "with";
    else if (fleeIds.has(c.id) && able(world, c.id)) sides[c.id] = "flee";
  }
  const pending = pool.filter(c => !sides[c.id] && able(world, c.id)).map(c => c.id);
  // Who'll come in when it's been going a while (the scene's reinforcements), not here already and not gone: theirs to take a side as they'd take it then.
  const coming = (at.graph.reinforcements ?? []).filter(r => !pool.some(c => c.id === r.id) && !world.entities[r.id]?.states.includes("gone") && !at.gm.absent.includes(r.id));
  if (!Object.values(sides).includes("against") && !pending.length) {
    tx.log(`[scene ${at.scene.id} turn ${plan.n}] no fight: nobody here is against the player (${[...foeIds].join(", ") || "none named"})`);
    return undefined;
  }
  if (ahead) {
    const taken = takeRoute(at.graph, at.gm, ahead.route.id, "none", plan.n);
    if ("error" in taken) tx.log(`[scene ${at.scene.id} turn ${plan.n}] the fight is ${ahead.beat.id}'s, but its route ${ahead.route.id} was refused: ${taken.error}`);
    else { at.gm = taken.gm; tx.log(`[scene ${at.scene.id} turn ${plan.n}] the fight is ${ahead.beat.id}'s: ${ahead.route.id}`); }
  }
  const fight: SceneFight = {
    turn: plan.n, why: initiative.why || beat?.title || "", from, ...(beat ? { beat: beat.id } : {}), sides,
    ...(pending.length || coming.length ? { pending: [...pending, ...coming.map(r => r.id)] } : {}),
  };
  at.gm.fight = fight;
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] a fight breaks out (${fight.why || from}): ${Object.entries(sides).map(([id, s]) => `${id} ${s}`).join(", ")}${pending.length ? `; no side yet: ${pending.join(", ")}` : ""}`);
  if (!fight.pending) return toTheFight(tx, at, plan);
  putGm(tx, at.scene.id, at.gm);
  const newcomers = [...pending.map(id => newcomer(tx, at, world, id)), ...coming.map(r => comer(at, r))];
  return { done: false, plan: { ...plan, step: "sides", sides: { why: fight.why, against: onSideOf(fight, "against"), with: onSideOf(fight, "with"), pending: newcomers } } };
}

/**
 * The sides step's answer: what the table saw as they took them (the GM's, under the reply), each
 * one's side (one the story needs who runs never leaves the scene: fightIntoWorld), then the scene is at its fight.
 */
export function afterSides(tx: TxCtx, plan: SayPlan, answer: SidesResponse): Next<SayPlan> {
  const at = atTurn(tx, plan);
  const fight = at.gm.fight;
  if (!fight) throw new Error(`scene ${at.scene.id}: the sides came back with no fight on`);
  if (answer.entries.length) writeReply(tx, at.scene, plan.n, idOf(plan.turn), answer.entries);
  for (const id of fight.pending ?? []) fight.sides[id] = sideOfPick(answer.sides[id] ?? "flee");
  delete fight.pending;
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] the sides picked: ${Object.entries(fight.sides).map(([id, s]) => `${id} ${s}`).join(", ")}`);
  return toTheFight(tx, at, plan);
}

/**
 * The scene at its fight (story-design §4.3's fighting): who's on which side in a line, nothing more
 * said until it's fought, and the turn done. The player goes on to it (fight_it_out), and it's set
 * out on the board then. A fight against nobody (everyone ran) is no fight: the scene goes on.
 */
function toTheFight(tx: TxCtx, at: At, plan: SayPlan): Next<SayPlan> {
  const fight = at.gm.fight!;
  const world = placeWorldOf(tx, at.scene).world;
  // Whoever the story needs who runs hides from it on the board, but never leaves (smoke6-1018: Cob, who the GM had bolt behind the water butt, out of the gate and gone).
  const keep = keepers(tx, at);
  const stays = onSideOf(fight, "flee").filter(id => keep.has(id));
  if (stays.length) fight.stays = stays; else delete fight.stays;
  const name = (id: string) => nameOf(tx, at, world, id);
  const later = new Set((at.graph.reinforcements ?? []).map(r => r.id).filter(id => !world.entities[id]));
  const list = (side: FightSide) => onSideOf(fight, side).filter(id => !later.has(id)).map(name);
  // Who'll come later is the board's surprise, not the line's.
  const comers = (at.graph.reinforcements ?? []).filter(r => later.has(r.id) && (fight.sides[r.id] === "with" || fight.sides[r.id] === "against")).map(r => `${r.id} ${fight.sides[r.id]} after ${r.after}`);
  if (!list("against").length) {
    delete at.gm.fight;
    addEntry(tx, at.scene, { turn: plan.n, speaker: "system", kind: "system", text: `Nobody stands against you: ${list("flee").length ? `${list("flee").join(", ")} ${list("flee").length === 1 ? "runs" : "run"} for it, and ` : ""}the fight is over before it starts.` });
    putGm(tx, at.scene.id, at.gm);
    afterTurn(tx, plan);
    finishTurn(tx, at.scene.id, idOf(plan.turn));
    return { done: true };
  }
  const words = [
    `Against you: ${list("against").join(", ")}.`,
    ...(list("with").length ? [`Beside you: ${list("with").join(", ")}.`] : []),
    ...(list("flee").length ? [`Running from it: ${list("flee").join(", ")}.`] : []),
    ...(list("clear").length ? [`Keeping clear of it: ${list("clear").join(", ")}.`] : []),
  ];
  addEntry(tx, at.scene, { turn: plan.n, speaker: "system", kind: "system", text: `Roll for initiative! ${words.join(" ")}` });
  putGm(tx, at.scene.id, at.gm);
  updateScene(tx, at.scene.id, { status: "fighting" });
  afterTurn(tx, plan);
  finishTurn(tx, at.scene.id, idOf(plan.turn));
  tx.log(`[scene ${at.scene.id} turn ${plan.n}] at its fight: ${words.join(" ")}${comers.length ? ` Coming: ${comers.join(", ")}.` : ""}`);
  return { done: true };
}

const onSideOf = (fight: SceneFight, side: FightSide) => Object.entries(fight.sides).filter(([, s]) => s === side).map(([id]) => id);

/**
 * Who doesn't leave the scene when they run from a fight: whoever walks with the player (the story's
 * followers, and those the scene's own endings have follow them: Kell in the yard), and whoever
 * holds a discovery the scene can't end well without that the player hasn't made yet (its paths'
 * people: Scrope and the true book), so a fight never takes the story's lead or its proof away.
 */
export function keepers(tx: TxCtx, at: Pick<At, "scene" | "graph" | "gm">): Set<string> {
  return new Set([...companionsHere(tx, at), ...storyNeeds(at.graph, at.gm)]);
}

/** Who follows the player through the story (the follower rows: Kell, from the first scene's end) and is here. */
export function companionsHere(tx: TxCtx, at: Pick<At, "scene" | "graph" | "gm">): string[] {
  const here = new Set(presentCast(at.graph, at.gm).map(c => c.id));
  return [...tx.db.follower.gameId.filter(at.scene.gameId)].map(f => f.castKey).filter(k => here.has(k));
}

/**
 * Everyone here who could be in a fight: the cast here and their groups' members, then the people
 * and creatures in the place's world who have no card (Duchess the dog), none gone.
 */
function fightersHere(at: At, world: SceneWorld): Character[] {
  const here = (id: string) => !world.entities[id]?.states.includes("gone");
  const known = presentFighters(at.graph, at.gm).filter(c => here(c.id));
  const others = Object.values(world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && here(e.id) && !known.some(c => c.id === e.id) && !at.graph.cast.some(c => c.id === e.id));
  return [...known, ...others.map(bystander)];
}

/** Whether someone here can take a side or run: not down, dead or out cold. */
const able = (world: SceneWorld, id: string) => !world.entities[id]?.states.some(s => OUT_OF_IT.has(s));
const OUT_OF_IT: ReadonlySet<string> = new Set(["gone", "down", "dead", "unconscious"]);

/** Someone with no side yet as the GM sees them: who, what the player calls them, what they look like, and (the cast) how they stand with the player and what they never do. */
function newcomer(tx: TxCtx, at: At, world: SceneWorld, id: string): FightNewcomer {
  const c = fighterOf(at.graph, id) ?? (world.entities[id] ? bystander(world.entities[id]!) : undefined);
  const called = calledHere(tx, at, world, id);
  const card = at.graph.cast.some(x => x.id === id);
  return { id, name: c?.name ?? id, ...(called ? { called } : {}), about: [c?.look, ...(card ? [c?.attitude, c?.limits] : [])].filter(Boolean).join(" ").trim() };
}

/** One of the scene's reinforcements as the GM sees them: who, what they look like, when they come and why. */
function comer(at: At, r: NonNullable<Scene["reinforcements"]>[number]): FightNewcomer {
  const card = at.graph.cast.find(c => c.id === r.id);
  return { id: r.id, name: card?.name ?? r.name ?? r.id, about: [card?.look ?? r.look, ...(card ? [card.attitude, card.limits] : [])].filter(Boolean).join(" ").trim(), coming: { after: r.after, why: r.why } };
}

/** Someone as the player knows them: by what they call them until they've heard the name. */
function nameOf(tx: TxCtx, at: At, world: SceneWorld, id: string): string {
  return calledHere(tx, at, world, id) ?? fighterOf(at.graph, id)?.name ?? world.entities[id]?.name ?? id;
}

/**
 * What the player calls someone whose name they haven't heard yet; none once they have. One of the
 * cast by their card's `called`, one of the place's beings with a name of their own by what they are
 * (QA round hobo1-1018: "Combat! In initiative order: Duchess, you." gave the mastiff's name away).
 */
function calledHere(tx: TxCtx, at: { scene: At["scene"]; graph: Scene }, world: SceneWorld, id: string): string | undefined {
  const heard = { transcript: entriesOf(tx, at.scene.id) };
  const card = unnamed(at.graph, heard)[id];
  if (card || fighterOf(at.graph, id)) return card;
  const e = world.entities[id];
  const name = e ? beingCalled(e, heard) : undefined;
  return name && name !== e!.name ? name : undefined;
}
