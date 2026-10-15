/**
 * Tactical combat (docs/design/playable.md): roll for initiative and fight on the map.
 *
 * A fight is a boardgame.io game (headless Client, one player per combatant, in the order the
 * rules engine rolled for initiative) whose moves call the vendored dnd-srd-engine for every roll
 * and every rule it keeps: the encounter (initiative, whose turn, movement spent, action used,
 * reactions), attacks, spells, saves, damage, conditions and death saves. This module adds the board:
 * 5 ft tiles, paths around walls and people, line of sight and cover, spell areas on tiles, range
 * checks (the engine doesn't check a spell's range), the grain dust and the fire, and the AI.
 *
 *   const setup = heronEncounter(map, session);          // who, where, the dust (CombatSetup)
 *   const combat = await startCombat(setup, session);    // a controller over the boardgame.io client
 *   combat.advance();                                    // everyone before the player takes their turn
 *   combat.options(); combat.act({ kind: "attack", target: "crake-1" }); combat.act({ kind: "end" });
 *   combat.advance();                                    // ...until combat.over()
 *   const result = combat.result();                      // CombatResult for chainScene / resumeAfterFight
 *
 * Or, in the play loop (src/game/play.ts): `fights: tacticalFights()` instead of the stand-in.
 * There a line can be typed as well as an action taken by id (`TacticalFight.say`): typed.ts reads
 * it onto the turn's own actions (plain commands with no model, typed-decider.ts for the rest),
 * typed-plan.ts walks the plan on the board before any of it's done, the fight does it as it does
 * a click, and voice.ts gives the GM's line on what the rules did.
 *
 * Rules decisions:
 * - The grid is 5 ft a tile; diagonals cost 5 ft (2024). Movement goes a step at a time through
 *   the engine, so leaving someone's reach provokes an opportunity attack (taken automatically, by
 *   the player too; Disengage prevents it). You may pass a friend or a body, not stop on them.
 *   Going out through a door is standing in it with 5 ft of movement to spare.
 * - Attacks: melee within reach; ranged within long range (disadvantage beyond normal range),
 *   with a clear shot, half cover from people in the way; Pack Tactics counts allies by side.
 *   Thrown weapons can't be thrown beyond 5 ft yet (the engine's reach check refuses them).
 * - Spells: the player's ready spells whose effects the engine resolves (attack, save, auto-hit,
 *   heal, Sleep-like, buffs), cast with an action or bonus action, from the lowest slot they take
 *   or a higher one asked for (an upcast: `cast_<spell>_<target>_slot<n>`); areas (sphere, cube,
 *   cone, line) are laid on tiles with line of effect from their origin, and catch everyone in them.
 * - A grab and a shove are the engine's Grapple and Shove (2024: the action, and the target's
 *   Strength or Dexterity save against the attacker's Strength DC): grappled, they can't move until
 *   whoever holds them is down, gone or stepped away; knocked over, they get up as their turn starts
 *   for half their movement (the engine leaves standing up to the board); shoved away, a tile
 *   straight back if there's floor there. Something to hand that isn't a weapon is the rules'
 *   unarmed strike (1d4), called an improvised weapon, and proficient as an unarmed strike is (the
 *   2024 rules would leave proficiency out for something that isn't like a weapon you know: a
 *   simplification). A shove takes the whole action, as the engine has it, not one of its attacks.
 * - A word with weight is 2024's Influence action, at someone on the other side within earshot
 *   (60 ft). How they take it is the fight's (`Skirmish.moodOf`, from the AI's own reasons to fight
 *   on or give up): never, for Sallow while his hired hands stand (it's words, and costs nothing);
 *   gladly, for hired hands whose paymaster is down, or anyone the fight's gone out of (no roll);
 *   in two minds, badly hurt, alone or outnumbered; otherwise hostile. A read of who they are (the
 *   decider's) can only make it harder. Otherwise it's a Charisma check by its skill
 *   (intimidation, persuasion, deception, performance), at disadvantage while they're hostile,
 *   against 15 or their Intelligence. Urged to yield, they surrender; to go, they make for the way
 *   out on their turns (giving up if they can't get there); to hold back, their next turn goes by.
 *   A failure can't be tried the same way on them again that fight. A beast understands only a
 *   threat. A look or a think is the Search or Study action: a check that changes nothing on the
 *   board. Talking costs nothing: only urging takes the action.
 * - A typed line is walked on the board before any of it is done (typed-plan.ts): where each
 *   move would leave the player and with what movement, and whether each act could be done from
 *   there, the dice aside. A move before an act goes somewhere the act can be done from (a step
 *   back that keeps the line for the Fire Bolt). What couldn't be done is refused, and nothing's
 *   spent; what the dice then overtake (the one a second blow was for went down to the first)
 *   stops there, and says so.
 * - Spiritual Weapon (a bonus action that swings as it's cast and lasts) wants the action unspent
 *   too, as the engine has it: it isn't offered once the action's gone.
 * - Table talk (what the player typed, who answered, the GM's line on what the rules did) is kept
 *   beside the rules' log, never in it (`note`; `view().log` shows both, in order), and saved with it.
 * - At 0 hit points: the player makes the engine's death saves at the start of their turns (a
 *   natural 20 gets them up). This story doesn't kill the player in a fight: three failures (or
 *   massive damage) leave them out of it and "nearly died", and they're written back at 0 HP,
 *   stable, for the next scene to bring round. Everyone else is out cold (no death saves), except
 *   that massive damage kills a grown combatant outright; the lantern-boy is only ever knocked flat.
 * - Nerve, as the cast's notes have it: the last hired hand standing tests his nerve with the
 *   engine's morale roll (d20 + Wisdom), and so does Sallow when badly hurt. Hired hands whose
 *   paymaster is down, yielding or gone walk out (not beaten, so not arrested). Sallow with nobody
 *   left to fight for him (or his nerve gone) runs if the way out is clear and nobody's on him, and
 *   otherwise yields.
 * - The end: no enemy able to fight is a victory (a "surrender" when the villain yielded, or, with
 *   nobody in charge, when the last of them to drop out of it put their hands up); nobody
 *   able on the player's side is a defeat; the player going out of a door is "fled". On a win, Kell
 *   (if she was in it) arrests the beaten and the yielded.
 * - The Heron's grain dust explodes when fire reaches it (a fire spell's area or line, a broken
 *   lantern, the brazier kicked over, burning sacks next to it): 5d6 fire to everyone in the dust,
 *   Dexterity save DC 13 for half, through the engine's trap rules; then the sacks burn, the fire
 *   spreads along them each round, and starting a turn beside it costs 1d6 fire (DC 10 for half).
 * - Writing back: the session's rules campaign gets the fight (the player's hit points, slots and
 *   conditions; the people the fight made, kept in rules.npcs by cast id) with the encounter closed.
 */

export { engineReady, resumeCombat, startCombat, summarise, type CombatController, type SavedCombat } from "./controller.ts";
export { heronEncounter, type HeronOptions } from "./heron.ts";
export { HERON_LAYOUT, HERON_MAP_ID, heronMap } from "./heron-grid.ts";
export { arenaMap, encounterFor, show as showLine, tacticalFights, TacticalFight, type Field, type TacticalFights, type TacticalOptions } from "./fights.ts";
export { gridStyled, gridText, KEY, legend, type GridOptions } from "./render.ts";
export { headOf } from "./typed-turn.ts";
export { pregenSession, PREGENS } from "./pregen.ts";
export { STATBLOCKS, wellFormed, type CombatStatblock } from "./rules.ts";
export type { PlayerStyle } from "./ai.ts";
export type { ActResult, CombatG, CombatView, LogLine, PlayerAction, PlayerOptions, Prop, Role, Side, Unit, UnitState } from "./model.ts";
