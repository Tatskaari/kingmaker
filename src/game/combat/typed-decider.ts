import type { ChoiceQuestion, Decider, Decision } from "../../llm/decide.ts";
import { FEET, feetBetween, steps } from "./grid.ts";
import type { CheckSkill, InfluenceSkill, Mood, Unit, Urge } from "./model.ts";
import { health } from "./rules.ts";
import { SEARCH_SKILLS } from "./skirmish.ts";
import type { Reading } from "./typed.ts";
import { planned } from "./typed-plan.ts";
import { areaCatch, attacksLeft, besideThem, cap, economy, examplesFor, listOf, ORDINAL, slugOf, spellReachWhy, urgeSteps, usesOf, whyNotCast, type Step, type Turn } from "./typed-turn.ts";
import { asWorded } from "./typed-words.ts";

/**
 * A typed line read by the decider (typed.ts), with this turn's own actions as its options, so it
 * chooses rather than invents: which act (every act the rules allow now, at everyone it can reach,
 * and for the rest why not), a move and whether it comes before or after, a second act, a bonus
 * action, an upcast, who's spoken to, and whether they're urged to stop, how, and how they'd take
 * it. The answers come out as the fight's own action ids; the economy and the board (typed-plan.ts)
 * are checked after, by typed.ts.
 */

/**
 * One thing the player could do this turn, as the decider is offered it. `kind`: what it is,
 * whoever it's at (for how sure the read is). `ask`: it in the player's own terms, when it isn't
 * the label's lead ("end your turn"), for asking which they meant.
 */
interface Deed { key: string; label: string; kind: string; steps?: Step[]; refusal?: string; warn?: string; ask?: string }

const READ = "plain words are what their character says out loud; what they do is in *asterisks* or (parentheses), or plainly narrated (\"I swing at him\"), or a bare command (\"attack the crake\")";

export async function decided(text: string, turn: Turn, decider: Decider): Promise<Reading> {
  const deeds = deedsOf(turn);
  const decision = await decider.decide(stateOf(text, turn), questionsFor(turn, deeds), "fight.typed");
  const reading = await readingOf(decision, text, turn, deeds, decider);
  return { ...reading, decision: reading.decision ?? decision };
}

// ---------------------------------------------------------------------------------------------
// The options: everything the player could do this turn, and why not for the rest.

function deedsOf(turn: Turn): Deed[] {
  return [...weaponDeeds(turn), ...thingDeeds(turn), ...spellDeeds(turn), ...turnDeeds(turn), ...otherDeeds()];
}

/** Blows, shots, a grab and a shove, at everyone on the other side it can reach (closing in first), and why not for the rest. */
function weaponDeeds(turn: Turn): Deed[] {
  const out: Deed[] = [];
  const { o, me, s } = turn;
  const canAttack = attacksLeft(turn) > 0;
  const melee = me.weapons.find(w => s.t.item(w)?.attackKind !== "ranged");
  for (const u of turn.others.filter(v => v.side === "enemy" && v.state === "fighting" && v.role !== "coward")) {
    const offered = o.attacks.filter(a => a.target === u.id);
    for (const a of offered) out.push({ key: `attack:${u.id}:${slugOf(a.weaponName)}`, kind: `attack:${slugOf(a.weaponName)}`, label: `Attack ${u.name} with your ${a.weaponName} (${a.bonus >= 0 ? "+" : ""}${a.bonus}${a.advantage ? `, ${a.advantage}` : ""}${a.note ? `, ${a.note}` : ""})`, steps: [{ id: `attack_${u.id}_with_${slugOf(a.weaponName)}`, uses: "attack" }] });
    const beside = steps(me.at, u.at) <= 1;
    const reach = beside || besideThem(u.at, turn);
    const close: Step[] = beside ? [] : [{ id: `close_${u.id}`, uses: "move" }];
    const far = feetBetween(me.at, u.at);
    if (canAttack && reach && melee && !offered.some(a => a.weapon === melee)) out.push({ key: `attack:${u.id}:close`, kind: "attack:close", label: `Close in on ${u.name} and attack with your ${s.namer().weapon(melee)}`, steps: [...close, { id: `attack_${u.id}_with_${slugOf(s.namer().weapon(melee))}`, uses: "attack" }] });
    if (canAttack && reach) out.push({ key: `improvised:${u.id}`, kind: "improvised", label: `Hit ${u.name} with something to hand, not a weapon (a stool, a bottle, a fist, a kick)${beside ? "" : ", closing in first"}`, steps: [...close, { id: `attack_${u.id}_with_improvised`, uses: "attack" }] });
    if (canAttack && !offered.length && !reach) out.push({ key: `cannot:attack:${u.id}`, kind: "cannot:attack", label: `A weapon attack on ${u.name} (not this turn: out of reach)`, refusal: `${cap(u.called)} is out of reach (${far} ft), and you can't get beside them this turn.` });
    // Hand to hand with someone only a shot can reach: why not, and what can.
    if (canAttack && offered.length && !reach && melee) out.push({ key: `cannot:close:${u.id}`, kind: "cannot:close", label: `Get to ${u.name} and fight hand to hand (not this turn: ${far} ft off)`, refusal: `${cap(u.called)} is ${far} ft off: you can't get beside them this turn (your ${offered[0]!.weaponName} reaches them from here).` });
    if (!o.actionUsed && reach) {
      out.push({ key: `shove:${u.id}`, kind: "shove", label: `Shove ${u.name} over, to the floor (they save or go down; it takes the whole action)${beside ? "" : ", closing in first"}`, steps: [...close, { id: `shove_${u.id}`, uses: "action" }] });
      out.push({ key: `push:${u.id}`, kind: "shove", label: `Shove ${u.name} away, back 5 ft (they save or go; the whole action)${beside ? "" : ", closing in first"}`, steps: [...close, { id: `push_${u.id}`, uses: "action" }] });
      out.push({ key: `grapple:${u.id}`, kind: "grapple", label: `Grab hold of ${u.name}, to stop them going anywhere (they save or they're held; the whole action)${beside ? "" : ", closing in first"}`, steps: [...close, { id: `grapple_${u.id}`, uses: "action" }] });
    }
  }
  return out;
}

/** Things in the place: a lantern to shoot down, a lantern or a brazier to bring down from beside it. */
function thingDeeds(turn: Turn): Deed[] {
  const out: Deed[] = [];
  const { o } = turn;
  for (const a of o.attacks.filter(a => turn.props.some(p => p.id === a.target))) out.push({ key: `attack:${a.target}`, kind: "attack:thing", label: `Hit the ${turn.props.find(p => p.id === a.target)!.name} with your ${a.weaponName}${a.note ? ` (${a.note})` : ""}`, steps: [{ id: `attack_${a.target}`, uses: "attack" }] });
  for (const p of turn.props.filter(p => p.state === "standing" && p.lit)) {
    const beside = o.props.some(x => x.id === p.id);
    if (beside) out.push({ key: `use:${p.id}`, kind: "use", label: `${p.kind === "brazier" ? "Kick over" : "Bring down"} the ${p.name}${turn.s.G.dust.length ? " (fire, near the dust)" : ""}`, steps: [{ id: `use_${p.id}`, uses: "action" }] });
    else if (!o.actionUsed && besideThem(p.at, turn)) out.push({ key: `use:${p.id}`, kind: "use", label: `Get to the ${p.name} and ${p.kind === "brazier" ? "kick it over" : "bring it down"}`, steps: [{ id: `close_${p.id}`, uses: "move" }, { id: `use_${p.id}`, uses: "action" }] });
  }
  return out;
}

/**
 * Their spells: each at everyone it can reach now (an area with who it would catch; a fire spell at
 * a lantern too), and for whoever it can't reach, why not; the spells they can't cast now, and why.
 */
function spellDeeds(turn: Turn): Deed[] {
  const out: Deed[] = [];
  const { o, me, s } = turn;
  for (const sp of o.spells) {
    const uses = usesOf(sp.id, turn);
    const heal = !!s.t.kit.engine.content.spells.get(sp.id)?.mechanicalEffects?.some(m => m.kind === "heal");
    const kind = heal ? "cast:heal" : `cast:${sp.id}`;
    const costs = uses === "bonus" ? ", a bonus action" : uses === "both" ? ", a bonus action and its first swing the action" : "";
    const slot = sp.slot ? ` (${ORDINAL[sp.slot]}-level slot${costs})` : ` (cantrip${costs})`;
    if (sp.targeting === "self") { out.push({ key: `cast:${sp.id}`, kind, label: `Cast ${sp.name} on yourself${slot}`, steps: [{ id: `cast_${sp.id}`, uses }] }); continue; }
    for (const t of sp.targets) {
      const caught = sp.targeting === "area" ? areaCatch(sp, s.unit(t.id)!.at, turn) : undefined;
      const catches = caught?.friends.length ? `, catching ${listOf(caught.friends)} too` : "";
      out.push({ key: `cast:${sp.id}:${t.id}`, kind, label: `Cast ${sp.name}${sp.area ? ` (a ${sp.area.size}-foot ${sp.area.shape})` : ""} ${sp.area ? "centred on" : t.id === me.id ? "on" : "at"} ${t.id === me.id ? "yourself" : t.name}${slot}${catches}`, steps: [{ id: sp.targeting === "area" ? `cast_${sp.id}_at_${t.id}` : `cast_${sp.id}_${t.id}`, uses }], ...(catches ? { warn: `${sp.name} at ${s.unit(t.id)!.called} would catch ${listOf(caught!.friends)} too.` } : {}) });
    }
    // Whoever it can't reach this turn (on the other side, or a friend for a heal): why not, in its own words.
    const meant = turn.others.filter(u => u.state === "fighting" && u.role !== "coward" && (heal ? u.side === "ally" : u.side === "enemy"));
    for (const u of meant.filter(u => !sp.targets.some(t => t.id === u.id))) out.push({ key: `cannot:cast:${sp.id}:${u.id}`, kind: "cannot:cast", label: `Cast ${sp.name} at ${u.name} (not this turn: out of reach or out of sight)`, refusal: spellReachWhy(sp, u, turn) });
    // A fire spell at a lantern in the beams or the brazier: it comes down burning.
    if (sp.fire && sp.targeting === "unit") for (const p of turn.props.filter(p => p.state === "standing" && feetBetween(me.at, p.at) <= Math.max(sp.range, FEET))) out.push({ key: `cast:${sp.id}:${p.id}`, kind, label: `Cast ${sp.name} at the ${p.name}${slot} (it comes down burning${s.G.dust.length ? ", by the dust" : ""})`, steps: [{ id: `cast_${sp.id}_${p.id}`, uses }] });
  }
  // Their own spells that can't be cast now, and why: a refusal in its own words, not a fizzle.
  const sheet = s.t.sheet(me.engineId);
  for (const sp of (sheet.spellcasting?.spellsByLevel ?? []).flatMap(g => g.spells)) if (!o.spells.some(x => x.id === sp.spellId) && !out.some(d => d.key === `cannot:cast:${sp.spellId}`)) out.push({ key: `cannot:cast:${sp.spellId}`, kind: "cannot:cast", label: `Cast ${sp.name} (not now)`, refusal: whyNotCast(sp.spellId, turn) });
  return out;
}

/** The turn's own: Dash, Dodge, Disengage, leaving, only moving, ending it; and with the action gone, why not for what takes it. */
function turnDeeds(turn: Turn): Deed[] {
  const out: Deed[] = [];
  const { o } = turn;
  const bonus = o.spells.some(sp => usesOf(sp.id, turn) === "bonus");
  if (o.actionUsed && attacksLeft(turn) === 0) out.push({ key: "spent", kind: "spent", label: "Anything that takes their action: an attack, a spell, a shove or a grab, knocking something over, dodging, dashing (not now: their action's spent this turn)", refusal: `Your action's spent this turn: you can still move${bonus && !o.bonusActionUsed ? ", cast a spell that takes a bonus action" : ""}, or end your turn.` });
  if (o.dash) out.push({ key: "dash", kind: "dash", label: "Dash: double movement this turn (the action)", steps: [{ id: "dash", uses: "action" }], ask: "dash" });
  if (o.dodge) out.push({ key: "dodge", kind: "dodge", label: "Dodge: keep their guard up and their head down, all defence, so attacks on them have disadvantage until their next turn (the action)", steps: [{ id: "dodge", uses: "action" }], ask: "dodge" });
  if (o.disengage) out.push({ key: "disengage", kind: "disengage", label: "Disengage: move away this turn without being swung at (the action; the move comes after it)", steps: [{ id: "disengage", uses: "action" }], ask: "disengage" });
  if (o.leave) out.push({ key: "leave", kind: "leave", label: `Leave the fight, out through ${o.leave}`, steps: [{ id: "leave", uses: "move" }], ask: "leave the fight" });
  else if (turn.s.G.exits.length && (o.movementLeft >= FEET || o.dash)) out.push({ key: "leave", kind: "leave", label: "Run for the way out and leave the fight", steps: [{ id: "make_for_the_door", uses: "move" }, { id: "leave", uses: "move" }], ask: "leave the fight" });
  if (o.dash && turn.s.G.exits.length && !o.leave) out.push({ key: "dash_out", kind: "leave", label: "Dash for the way out and leave the fight (the Dash is the action)", steps: [{ id: "dash", uses: "action" }, { id: "make_for_the_door", uses: "move" }, { id: "leave", uses: "move" }], ask: "dash for the way out" });
  if (o.movementLeft >= FEET) out.push({ key: "move_only", kind: "move_only", label: "Only move: go somewhere on the floor (the move answer says where), and nothing else", steps: [], ask: "just move" });
  out.push({ key: "end", kind: "end", label: "End their turn, or wait and do nothing", steps: [{ id: "end_turn", uses: "end" }], ask: "end your turn" });
  return out;
}

const NOT_YET = "That isn't part of a fight on the map yet (hiding and taking cover, class features like Second Wind or Cunning Action, jumping and climbing, throwing, and reactions aren't): m lists what is.";

/** What isn't an act on the board: a look or a think, words, a question to the GM, and what the fight can't play. */
function otherDeeds(): Deed[] {
  return [
    { key: "check:search", kind: "check", label: "Look for something, or read someone: Perception, Insight, Medicine or Survival (the Search action)", ask: "look for something" },
    { key: "check:study", kind: "check", label: "Work something out, or recall what they know: Arcana, History, Investigation, Nature or Religion (the Study action)", ask: "work something out" },
    { key: "speak_only", kind: "speak_only", label: "Nothing done: only words said aloud (a taunt, a question, an order, a threat, a plea)", ask: "just talk" },
    { key: "ooc", kind: "ooc", label: "A question to the GM about the game, out of character (what can I do, how far can I move)", ask: "ask what you can do" },
    { key: "not_theirs", kind: "not_theirs", label: "Casting a spell, or working magic, that isn't any of the spells listed here", ask: "work magic you haven't got" },
    { key: "not_yet", kind: "not_yet", label: "Something fights don't do yet: hiding or taking cover (behind something), a class feature (Second Wind, Action Surge, Cunning Action, Rage), jumping or climbing, throwing a weapon or a thing at someone, a reaction", refusal: NOT_YET, ask: "do something fights don't do yet" },
    { key: "not_possible", kind: "not_possible", label: "Something none of these is: an act the fight can't play, or aimed at someone or something that isn't here", ask: "do something else" },
  ];
}

/** Where they could move to this turn, by what's on the floor (for a move before or after the deed). */
function movesOf(turn: Turn): Record<string, string> {
  if (turn.o.movementLeft < FEET) return {};
  const out: Record<string, string> = {};
  for (const u of turn.others.filter(v => v.state !== "dead" && steps(turn.me.at, v.at) > 1 && besideThem(v.at, turn))) out[`close:${u.id}`] = `Next to ${u.name}`;
  for (const p of turn.props.filter(p => steps(turn.me.at, p.at) > 1 && besideThem(p.at, turn))) out[`close:${p.id}`] = `To the ${p.name}`;
  if (turn.s.G.exits.length && !turn.o.leave) out["door"] = "To the way out";
  if (turn.actions.some(a => a.id === "back_off")) out["away"] = "Away from them: back off, out of their reach";
  return out;
}

// ---------------------------------------------------------------------------------------------
// The questions.

function questionsFor(turn: Turn, deeds: Deed[]): Record<string, ChoiceQuestion> {
  const moves = movesOf(turn);
  const foes = turn.o.hear;
  const earshot = turn.others.filter(u => (u.state === "fighting" || u.state === "surrendered") && feetBetween(turn.me.at, u.at) <= 60);
  const bonus = deeds.filter(d => d.steps?.some(s => s.uses === "bonus" || s.uses === "both"));
  const acts = deeds.filter(d => d.steps?.some(s => s.uses === "action" || s.uses === "attack" || s.uses === "both"));
  // The slots above a castable spell's lowest that are left: an upcast to ask about.
  const higher = [2, 3, 4, 5, 6, 7, 8, 9].filter(l => turn.s.freeSlots(turn.me, l) > 0 && turn.o.spells.some(sp => sp.level > 0 && sp.slot < l));
  const q: Record<string, ChoiceQuestion> = {
    deed: {
      instructions: `A player in a tactical tabletop fight has typed their turn (latest_line): ${READ}. Which of these is what their character does with this turn? Choose by what they mean, not the exact words: a spell by its name or what it does, a weapon by what it is, a person by what they're called or where they stand. If they only talk, choose speak_only. If it's none of these, choose not_possible (or not_theirs for magic they haven't got, not_yet for what fights don't do yet).`,
      criteria: Object.fromEntries(deeds.map(d => [d.key, d.label])),
    },
    said_to: {
      instructions: "Whom are the words they say out loud addressed to (what's outside any *asterisks* or (brackets), or what's in quotes)? A name at the start of the words says who.",
      criteria: { nobody: "They say nothing aloud: it's all deeds.", room: "Everyone, or nobody in particular.", ...Object.fromEntries(earshot.map(u => [u.id, `${u.name} (${u.side === "enemy" ? "on the other side" : u.side === "ally" ? "on their side" : "not in it"}${u.state === "surrendered" ? ", who has given up" : ""})`])) },
    },
    urge: {
      instructions: "Is the player trying, by words or by a show (a roar, brandishing a weapon, a menacing step), to make someone on the other side stop fighting: give up, leave, or hold back? It counts whether or not it would work: a demand to surrender (\"Give it up!\", \"Drop it!\"), a threat, an offer, an argument, a lie, or a show of force to scare them off. Only a taunt or a battle cry meant to rile them rather than stop them doesn't.",
      criteria: { no: "No: nobody is being urged to stop.", yield: "To give up: surrender, drop their weapon, put their hands up, give it up.", go: "To leave the fight: run, clear off, get out, walk away.", hold: "To hold back: stop, wait, stay where they are, think again for a moment." },
    },
  };
  if (Object.keys(moves).length) {
    q.move = {
      instructions: "Besides the deed, does the player's own character move somewhere this turn: stepping back or away, closing in on someone, going over to something, running for the way out? Choose where. Only their own feet count: telling someone else to get back or clear off isn't the player moving. (A deed that says it closes in first has that move already.)",
      criteria: { no: "No: they don't move, besides the deed.", ...moves },
    };
    q.move_when = {
      instructions: "If they move, does the move come before the deed or after it? Go by the order the line tells them in: \"I step back and fire\" and \"stepping away, I cast\" move first; \"I fire and step back\" and \"I cast, then run\" move after.",
      criteria: { before: "The move comes first, then the deed.", after: "The deed comes first, then the move." },
    };
  }
  if (acts.length > 1 && attacksLeft(turn) + (turn.o.actionUsed ? 0 : 1) > 1) {
    q.deed2 = {
      instructions: "Does the line ask for a second act besides the deed (and any move or bonus-action spell): a second blow (\"twice\", \"and then the other one\"), a stab after a shove? Choose it, or none.",
      criteria: { none: "No second act.", ...Object.fromEntries(acts.map(d => [d.key, d.label])) },
    };
  }
  if (foes.length) {
    q.urged = { instructions: "If so, whom?", criteria: { none: "Nobody, or nobody in earshot.", ...Object.fromEntries(foes.map(f => [f.id, `${turn.s.unit(f.id)?.name ?? f.name}${f.understands ? "" : " (an animal: only a threat gets through)"}`])) } };
    q.urge_how = { instructions: "If so, by what means?", criteria: { none: "Not trying to.", intimidation: "Intimidation: threats, menace, a show of force.", persuasion: "Persuasion: an honest appeal, an argument, an offer.", deception: "Deception: a lie, a bluff, a trick.", performance: "Performance: a show, a joke, putting them off their stroke." } };
    q.urge_mood = {
      instructions: "If so, is there anything about who that person is (what they want, what they fear, what they're here for) that would make them less ready to stop than the fight's state suggests (how_they_stand)? Only who they are: how the fight's going is already counted.",
      criteria: { none: "Nothing more: as the fight stands for them.", hostile: "They'd want real pressure: it goes against what they're here for.", unwilling: "Never: it's against who they are, or they can't make sense of it." },
    };
  }
  if (bonus.length) q.bonus = { instructions: "Besides the deed, do they also cast a spell that takes a bonus action (a word of healing called to a friend, a spiritual weapon), however the line puts it? Only if the line asks for it.", criteria: { none: "No.", ...Object.fromEntries(bonus.map(d => [d.key, d.label])) } };
  if (higher.length) q.slot = { instructions: "If they cast a levelled spell, do they say they use a higher-level slot for it than its lowest?", criteria: { lowest: "No: the lowest it takes (or they cast no levelled spell).", ...Object.fromEntries(higher.map(l => [`slot${l}`, `A ${ORDINAL[l]}-level slot`])) } };
  return q;
}

/** The fight as the decider needs it: the turn, where everyone is and how, what's about, what just happened, the line. */
function stateOf(text: string, turn: Turn): Record<string, unknown> {
  const { s, me, o } = turn;
  const G = s.G;
  const use = s.usage(me);
  const near = (at: { x: number; y: number }) => (steps(me.at, at) <= 1 ? "right beside you" : `${feetBetween(me.at, at)} ft away`);
  const conditions = (u: Unit) => u.conditions.filter(c => !/active$/.test(c));
  return {
    fight: `${G.place ?? "the Heron"}, round ${G.round}`,
    your_turn: [`HP ${me.hp}/${me.maxHp}`, `${o.movementLeft} ft of movement left`, `action ${o.actionUsed ? "used" : "ready"}`, `bonus action ${use?.bonusActionUsed ? "used" : "ready"}`, ...(conditions(me).length ? [conditions(me).join(", ")] : [])].join("; "),
    you: `${me.name}, with ${me.weapons.map(w => s.namer().weapon(w)).join(" and ") || "bare hands"}`,
    others: turn.others.map(u => `${u.name}${turn.aliases?.[u.id]?.length ? ` (known as ${turn.aliases[u.id]!.join(", ")})` : ""} (${u.side === "enemy" ? "on the other side" : u.side === "ally" ? "on your side" : "not in it"}; ${u.state === "fighting" ? health(u) : u.state}${conditions(u).length ? `, ${conditions(u).join(", ")}` : ""}): ${near(u.at)}`),
    ...(o.hear.length ? { how_they_stand: o.hear.map(h => `${turn.s.unit(h.id)?.name ?? h.name}: ${h.mood === "unwilling" ? `never (${h.why})` : h.mood === "willing" ? `gladly (${h.why})` : h.mood === "wavering" ? `in two minds (${h.why})` : `only under real pressure (${h.why})`}`) } : {}),
    things: turn.props.map(p => `the ${p.name} (${p.state}${p.lit && p.state === "standing" ? ", lit" : ""}): ${near(p.at)}`),
    ...(G.dust.length ? { hazards: "grain dust hangs over part of the floor: fire in it explodes" } : {}),
    recent: G.log.slice(-8).map(l => l.text),
    latest_line: text,
  };
}

// ---------------------------------------------------------------------------------------------
// The answers.

const answer = (d: Decision, id: string) => d.answers[id]?.choice;

/**
 * The parts of a turn the line may or may not ask for (a move, a second act, a bonus spell, a
 * higher slot, an urge): taken only on a clear read, since a wrong one spends something or moves
 * the player unasked. Unclear, it's the quiet answer.
 */
const CLEAR = 0.5;
function clear(d: Decision, id: string, quiet: string): string {
  const a = d.answers[id];
  return a && (a.probabilities?.[a.choice] ?? 1) >= CLEAR ? a.choice : quiet;
}

/** A move it's sure of, somewhere (for a line that only moves). */
const surelyMoving = (d: Decision) => whereTo(d) !== "no" && (d.answers["move"]?.probabilities?.[whereTo(d)] ?? 1) >= SURE.enough;

/**
 * Where they move: the place it's surest of, if it's well ahead of not moving at all (the places
 * on the floor thin out its chances, as the deeds do); otherwise no move.
 */
function whereTo(d: Decision): string {
  const a = d.answers["move"];
  if (!a || a.choice === "no") return "no";
  const p = a.probabilities?.[a.choice] ?? 1;
  return p >= SURE.least && p >= SURE.lead * (a.probabilities?.["no"] ?? 0) ? a.choice : "no";
}

/**
 * How sure the read of an act is, by kind, whoever it's at ("a fire bolt at the one in the good
 * coat" splits between three people who might be in a good coat, but it's a Fire Bolt all the same;
 * a heal is a heal, Cure Wounds or Healing Word; a shove's a shove, over or away): the chance of
 * each kind, most likely first. The one aimed at is the decider's best of the kind it chose.
 */
function kinds(d: Decision, id: string, deeds: Deed[]): Array<{ kind: string; p: number; key: string }> {
  const a = d.answers[id];
  if (!a) return [];
  const kindOf = (key: string) => deeds.find(x => x.key === key)?.kind ?? key;
  const out = new Map<string, { kind: string; p: number; key: string }>();
  for (const [key, p] of Object.entries(a.probabilities ?? { [a.choice]: 1 })) {
    const kind = kindOf(key);
    const was = out.get(kind);
    out.set(kind, { kind, p: (was?.p ?? 0) + p, key: was && (a.probabilities?.[was.key] ?? 0) >= p ? was.key : key });
  }
  return [...out.values()].sort((x, y) => y.p - x.p);
}

/**
 * A deed that spends something wants a read this sure: its kind well ahead of any other (the many
 * options thin out the chances, so the lead matters more than the sum), or most of it. Unsure, it
 * says what it couldn't choose between, and spends nothing.
 */
const SURE = { least: 0.4, lead: 2, enough: 0.6 };
function unsure(ranked: ReturnType<typeof kinds>, deeds: Deed[], examples: string, moving: boolean): string | undefined {
  const [top, next] = ranked;
  if (!top || top.kind === "speak_only") return undefined;
  if (top.p >= SURE.enough || (top.p >= SURE.least && top.p >= SURE.lead * (next?.p ?? 0))) return undefined;
  // Only moving, ahead of anything else, and where to clear: the move question is sure of it.
  if (top.kind === "move_only" && moving && top.p >= SURE.lead * (next?.p ?? 0)) return undefined;
  const words = (key: string) => { const d = deeds.find(x => x.key === key); return d?.ask ?? d?.label.replace(/ \(.*$/, "").replace(/^\w/, c => c.toLowerCase()); };
  const a = words(top.key), b = next ? words(next.key) : undefined;
  if (a && b && next!.p >= SURE.least / 2) return `Not sure whether you mean to ${a} or ${b}: say which, in plainer words, or m for every option.`;
  return `Not sure what you mean to do there: try plainer words (${examples}), or m for every option.`;
}

/** The decider's answers as steps: the act (as the line's own words have it), a move before or after it, a second act, a bonus spell, an upcast, a word with weight. */
async function readingOf(decision: Decision, text: string, turn: Turn, deeds: Deed[], decider: Decider): Promise<Reading> {
  // The kind it's surest of, at whoever (or with whatever) it rated best of that kind.
  const ranked = kinds(decision, "deed", deeds);
  const key = ranked[0]?.key ?? answer(decision, "deed") ?? "not_possible";
  const deed = deeds.find(d => d.key === key);
  const speech = speechOf(decision, text, key);
  const extra = { by: "decider" as const, decision, ...(speech ? { speech } : {}) };
  const refused = refusalOf(ranked, key, deed, deeds, turn, surelyMoving(decision));
  if (refused) return { ...extra, steps: [], refusal: refused };
  const act = await actOf(key, deed, text, turn, decider);
  if ("refusal" in act) return { ...extra, steps: [], refusal: `${act.refusal} Nothing's spent.` };
  // A bonus spell besides the deed (not the same thing twice: a heal is the deed's).
  const bonus = deeds.find(d => d.key === clear(decision, "bonus", "none") && d.kind !== deed?.kind);
  const second = secondOf(decision, deeds, deed, act.steps, turn, bonus);
  const urged = urgeOfDecision(decision, turn, [...act.steps, ...second.steps]);
  const plan = upcastIn(composed(decision, deed, [...act.steps, ...(urged.step ? [urged.step] : [])], [...second.steps, ...(bonus?.steps ?? [])]), clear(decision, "slot", "lowest"));
  if (key === "move_only" && !plan.length) return { ...extra, steps: [], refusal: "Move where? Click a blue tile, or say where to (\"move to the brazier\"). Nothing's spent." };
  if (!plan.length && !speech) return { ...extra, steps: [], refusal: "Nothing to do there: say something, or do something. Nothing's spent." };
  const note = [act.note, second.note, urged.note].filter(Boolean).join(" ");
  return planned(plan, turn, { ...extra, ...(note ? { note } : {}), ...(deed?.warn ? { warn: deed.warn } : {}) });
}

/**
 * Words said aloud, and to whom, or the room: for a line that's only words, whoever the decider
 * best reads them as for (who answers costs nothing); beside a deed, only on a clear read (else
 * the GM says what the deed did, rather than whoever it was done to answering it).
 */
function speechOf(decision: Decision, text: string, key: string): Reading["speech"] | undefined {
  const to = key === "speak_only" ? answer(decision, "said_to") ?? "room" : clear(decision, "said_to", "nobody");
  if (to === "nobody" && key !== "speak_only") return undefined;
  return { words: text, to: to === "nobody" ? "room" : to };
}

/** A deed that isn't one (a question, magic they haven't got, nothing the fight plays, why not), or an unsure read of one: why, and nothing's spent. */
function refusalOf(ranked: ReturnType<typeof kinds>, key: string, deed: Deed | undefined, deeds: Deed[], turn: Turn, moving: boolean): string | undefined {
  const examples = examplesFor(turn);
  if (key === "ooc") return oocAnswer(turn, deeds);
  if (key === "not_theirs") return "That isn't magic you have: the sheet (s) shows your spells. Nothing's spent.";
  if (key === "not_possible") return `That isn't something this fight can do: m lists every option, or try a plain command (${examples}). Nothing's spent.`;
  if (deed?.refusal) return `${deed.refusal} Nothing's spent.`;
  // A deed that spends something wants a confident read; words cost nothing, and an unsure read of them is still words.
  const doubt = key === "speak_only" ? undefined : unsure(ranked, deeds, examples, moving);
  return doubt ? `${doubt} Nothing's spent.` : undefined;
}

/** The act's steps: a look or a think (which skill, how hard), or the deed's, as the line's own words have it (typed-words.ts). */
async function actOf(key: string, deed: Deed | undefined, text: string, turn: Turn, decider: Decider): Promise<{ steps: Step[]; note?: string } | { refusal: string }> {
  if (key.startsWith("check:")) return { steps: await checkSteps(key.slice(6) as "search" | "study", text, turn, decider) };
  return asWorded(text, deed?.steps ?? [], turn);
}

/**
 * The move the line asks for besides the deed, before it or after it (a Dash or a Disengage is
 * always before the move it's for; a deed that closes in first has its move before already, and a
 * way out has its own), with whatever else the turn does after the deed.
 */
function composed(decision: Decision, deed: Deed | undefined, act: Step[], also: Step[]): Step[] {
  const where = deed?.key === "speak_only" ? "no" : whereTo(decision);
  const move = where === "no" ? undefined : moveStep(where);
  if (!move || act.some(s => s.id === "leave")) return [...act, ...also];
  if (deed?.key === "move_only") return [move];
  const after = deed?.kind === "dash" || deed?.kind === "disengage" || (answer(decision, "move_when") ?? "after") === "after";
  if (after) return [...act, ...also, move];
  return act.some(s => s.uses === "move") ? [...act, ...also] : [move, ...act, ...also];
}

const moveStep = (where: string): Step => ({ id: where === "door" ? "make_for_the_door" : where === "away" ? "back_off" : `close_${where.slice(6)}`, uses: "move" });

/**
 * A second act the line asks for: done when the turn has it (a second blow from a fighter's two
 * attacks), and otherwise said not to have happened (a shove takes the whole action, so the stab
 * after it doesn't).
 */
function secondOf(decision: Decision, deeds: Deed[], deed: Deed | undefined, act: Step[], turn: Turn, bonus: Deed | undefined): { steps: Step[]; note?: string } {
  // As sure as a deed's kind needs to be, and surer than that there's none.
  const ranked = kinds(decision, "deed2", deeds);
  const none = ranked.find(r => r.kind === "none")?.p ?? 0;
  const top = ranked.find(r => r.kind !== "none");
  const second = top && top.p >= SURE.least && top.p > none ? deeds.find(d => d.key === top.key) : undefined;
  // The deed read again isn't a second act, unless it's a blow (a fighter's second swing); nor is the bonus spell.
  const again = second && second.kind === deed?.kind && !/^(?:attack:|improvised)/.test(second.kind);
  if (!second?.steps?.length || !act.length || again || second.key === bonus?.key) return { steps: [] };
  const steps = second.steps.filter(s => s.uses !== "move" || !act.some(a => a.id === s.id));
  if ("steps" in economy([...act, ...steps], turn)) return { steps };
  const one = act.some(s => s.uses === "action" || s.uses === "both") ? "That took your whole action" : "Your attacks were spent";
  return { steps: [], note: `${one}, so ${second.label.replace(/ \(.*$/, "").replace(/^\w/, c => c.toLowerCase())} didn't happen as well.` };
}

/** An upcast asked for: the levelled spell in the plan from that slot. */
function upcastIn(plan: Step[], slot: string | undefined): Step[] {
  const n = slot?.startsWith("slot") ? Number(slot.slice(4)) : undefined;
  if (!n) return plan;
  return plan.map(s => (s.id.startsWith("cast_") && !/_slot\d$/.test(s.id) ? { ...s, id: `${s.id}_slot${n}` } : s));
}

/**
 * A word with weight (the Influence action): urging someone on the other side to give it up. How
 * they take it is the fight's (Skirmish.moodOf); the decider's read of who they are can only make
 * it harder, and only on a clear read. It takes the action, so it's words only if the deed has the
 * action, or it's ears that never would.
 */
function urgeOfDecision(d: Decision, turn: Turn, plan: Step[]): { step?: Step; note?: string } {
  const urge = clear(d, "urge", "no");
  const who = clear(d, "urged", "none");
  if (urge === "no" || who === "none") return {};
  const u = turn.s.unit(who);
  const heard = turn.o.hear.find(h => h.id === who);
  if (!u) return {};
  if (heard?.mood === "unwilling") return { note: `${cap(heard.why)}: that's just words, and costs nothing.` };
  const read = clear(d, "urge_mood", "none");
  if (read === "unwilling") return { note: `${cap(u.called)} won't hear of it: that's just words, and costs nothing.` };
  if (plan.some(s => s.uses === "action" || s.uses === "attack" || s.uses === "both")) return { note: `Urging ${u.called} would take your action too: it's just words this turn.` };
  const how = (answer(d, "urge_how") ?? "none") === "none" ? "intimidation" : answer(d, "urge_how") as InfluenceSkill;
  const steps = urgeSteps({ kind: "unit", u }, how, urge as Urge, turn, u.called, read === "hostile" ? "hostile" as Mood : undefined);
  return "refusal" in steps ? { note: `${steps.refusal.replace(/\.$/, "").replace(/: it's just words$/, "")}: it's just words.` } : { step: steps.steps[0]! };
}

/** A look or a think: a second small call for which skill, and how hard (only on those turns). */
async function checkSteps(kind: "search" | "study", text: string, turn: Turn, decider: Decider): Promise<Step[]> {
  const skills: readonly CheckSkill[] = kind === "search" ? SEARCH_SKILLS : ["investigation", "arcana", "history", "nature", "religion"];
  const TEXT: Record<CheckSkill, string> = {
    perception: "Perception: spotting, noticing, listening", insight: "Insight: reading someone, catching a lie or a mood", medicine: "Medicine: seeing how badly someone's hurt", survival: "Survival: tracks, signs, a way through",
    investigation: "Investigation: working out how something works or what it's for", arcana: "Arcana: magic, spells, what's enchanted", history: "History: who someone is, what happened here", nature: "Nature: animals, plants, the weather", religion: "Religion: gods, rites, the holy and unholy",
  };
  const d = await decider.decide(stateOf(text, turn), {
    skill: { instructions: "The player's character is looking for something or working something out (latest_line). Which skill decides it?", criteria: Object.fromEntries(skills.map(s => [s, TEXT[s]])) },
    difficulty: { instructions: "How hard is it, in the middle of a fight, given what they're after?", criteria: { easy: "Easy: most people would manage it.", moderate: "Moderate: a real chance of missing it.", hard: "Hard: it would take skill and luck." } },
  }, "fight.check");
  const skill = (answer(d, "skill") ?? skills[0]) as CheckSkill;
  const dc = { easy: 10, moderate: 13, hard: 16 }[answer(d, "difficulty") ?? "moderate"] ?? 13;
  return [{ id: `check_${skill}_${dc}`, uses: "action" }];
}

/** Out of character, "what can I do?": the turn's options, from the rules. */
function oocAnswer(turn: Turn, deeds: Deed[]): string {
  const doable = deeds.filter(d => d.steps?.length && !d.key.startsWith("cannot")).map(d => d.label.replace(/ \(.*\)$/, "").toLowerCase());
  const head = `${turn.o.movementLeft} ft of movement, your action ${turn.o.actionUsed ? "spent" : "ready"}`;
  return `This turn you have ${head}. You could ${doable.slice(0, 5).join("; ") || "end your turn"}${doable.length > 5 ? "; and more" : ""}. m lists every option.`;
}
