// Copied from the prototype's src/runtime/brief.ts:169-343 and 391-473 at 44c6d4a: the GM's prep and its per-turn note, reading a TurnView (gm/view.ts) for the session. The rest of the file is v2/shared/scene/graph.ts and names.ts (not offstageCast, strangers or asHeard, which V0 doesn't use).

import { currentBeat, openRoutes, presentCast, targetTitle } from "../../shared/scene/graph.ts";
import { unnamed } from "../../shared/scene/names.ts";
import type { Character, Exit, Scene, Transition } from "../../shared/scene/types.ts";
import { titleCase } from "../../shared/dice.ts";
import { PHYSICS } from "../../shared/world/systems.ts";
import { worldView, type Entity } from "../../shared/world/scene-world.ts";
import type { TurnView, ViewEntry } from "./view.ts";

const bullets = (items: readonly string[] | undefined, none = "- (nothing in particular)") => items?.length ? items.map(i => `- ${i}`).join("\n") : none;

function castBlock(scene: Scene, c: Character, present: boolean): string {
  const lines = [
    `### ${c.name}${c.group ? ` (${c.group})` : ""}`,
    `- Look: ${c.look}`,
    `- Voice: ${c.voice}`,
    `- Wants: ${c.wants}`,
    ...(c.fears ? [`- Fears: ${c.fears}`] : []),
    `- Knows:\n${c.knows.map(k => `  - ${k}`).join("\n")}`,
    ...(c.secrets?.length ? [`- Secrets (they come out only when earned):\n${c.secrets.map(s => `  - ${s}`).join("\n")}`] : []),
    `- Attitude at the start, and what brings them round (your prep: they never spell it out): ${c.attitude}`,
  ];
  if (!present && c.enters) lines.push(`- Not on stage yet: arrives when the scene reaches "${targetTitle(scene, c.enters)}".`);
  return lines.join("\n");
}

function exitBlock(exit: Exit): string {
  return `- ${exit.title}: ${exit.outcome}`;
}

/**
 * Who the player character is, in a line for a model's brief: their name and concept, and from their
 * backstory (character creation's) who they are, in a sentence or two.
 */
export function playerWho(state: TurnView): string {
  const p = state.player;
  return `${p.name}: ${p.concept}${p.backstory?.summary ? `. ${p.backstory.summary}` : ""}`;
}

/**
 * Whether the player character is a man or a woman, as their backstory's summary (written in the
 * third person at character creation) or their concept has it, when it plainly says: Tull and Hobb
 * called a woman "sir" nine times, while Kell wrote "she".
 */
export function genderOf(player: Pick<TurnView["player"], "concept" | "backstory">): "woman" | "man" | undefined {
  const text = `${player.backstory?.summary ?? ""} ${player.concept}`;
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const she = count(/\b(she|her|hers|herself|woman|girl|lady)\b/gi);
  const he = count(/\b(he|him|his|himself|man|boy|lad)\b/gi);
  if (she > 2 * he) return "woman";
  if (he > 2 * she) return "man";
  return undefined;
}

/** How people speak of and to the player character. */
function addressLine(player: TurnView["player"]): string {
  const gender = genderOf(player);
  if (gender === "woman") return " She's a woman: people speak of her as she and her, and address her as they'd address a woman (mistress, missus, miss or madam, as fits who's talking), never as sir.";
  if (gender === "man") return " He's a man: people speak of him as he and him, and address him as they'd address a man (sir, mister or master, as fits who's talking).";
  return " Nothing says whether they're a man or a woman: until the player shows it, people address them by name or by what they're here as, not as sir or madam.";
}

/**
 * The player character's own backstory, for the GM: who they are in short (every brief), and where
 * the whole of it is (`inNotes`: the GM's notes from the docs service have it, so it isn't repeated;
 * otherwise it's here in full). Their past, known in the story only where someone would know it.
 */
function backstoryBrief(state: TurnView, inNotes: boolean): string {
  const b = state.player.backstory;
  if (!b?.text.trim()) return "";
  // A trait in its own words may end in a full stop ("I owe Fat Jory three crowns."): the list has its own.
  const bare = (t: string) => t.trim().replace(/[.;:,]+$/, "");
  const traits = ([["personality", b.personality], ["ideals", b.ideals], ["bonds", b.bonds], ["flaws", b.flaws]] as const).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.map(bare).join("; ")}`);
  return [
    `\nWho they are, from their own backstory: ${b.summary}${traits.length ? ` (${traits.join(". ")}.)` : ""}`,
    inNotes ? "The whole of their backstory, in their own words, is in your notes (the player character's doc)." : `Their backstory, in their own words:\n${b.text.trim().split(/\n+/).map(l => `> ${l}`).join("\n")}`,
    "It's their past, and true for them: let it colour the world when it would (a face from home, an old debt coming due, a name that means something to them), but people in the story know of it only what they'd plausibly know (someone from that past, something that was public) or what the player tells or shows them. Nobody brings it up out of nowhere. What it says of the story's own people and places is what they believe or heard: where your prep says otherwise, your prep is the truth. And it's all there is of their past: nobody adds to it (a prison, a crime, a debt or a trade it doesn't have), not even in passing.",
    "When the player tells someone of their past without saying it word for word (\"I tell her where I'm from\"), they tell it as their backstory has it: show what they told, in its own details, and how the listener takes it.",
  ].join("\n");
}

/**
 * Who knew the player character before the story began: none of its people (whoever sent for them
 * aside). Without it the GM yes-ands a leading line ("Sergeant, you'll remember me") into an old
 * acquaintance, and puts the scene's own secrets in it (Prout's visit to the watch house, as theirs).
 */
const STRANGER = "Before the story began, none of its people had met them (whoever sent for them aside): they know them only from what's happened in play since, and of their past only what they'd plausibly know or have been told. If the player claims an old acquaintance with one of them (\"You'll remember me\"), it isn't so, and that person says so in their own way; people from the player's own past are another matter.";

/**
 * Where something the story still owes the player is (the page in Cob's boot), as the GM is told
 * it: "what it's in stays where the world has it" came back as "The folded page remains sewn
 * inside Cob's left boot in the scullery", to a player who had never met Cob.
 */
const OWED_PLACE = "its things are where the world has them, with whoever has them, out of the player's sight until they find them or someone shows them; the narration never says where they are";

/**
 * What in the place is out of the player's sight: hidden (by its author, or in play), or inside
 * something that is, and neither theirs nor what they've come across (an essential's things, once
 * it has landed). The GM is told where it is, with that status: listed like anything else, a page
 * sewn into a lining was narrated as staying there.
 */
export function outOfSight(scene: Scene, state: TurnView): Entity[] {
  const world = state.world;
  if (!world) return [];
  const found = foundThings(scene, state);
  const hidden = (e: Entity) => (e.tags.includes("hidden") || e.states.includes("hidden")) && !found.has(e.id);
  const upFrom = (e: Entity): Entity[] => {
    const chain: Entity[] = [];
    for (let p: Entity | undefined = e, n = 0; p && n < 12 && p.kind !== "area" && p.kind !== "place"; p = p.parent ? world.entities[p.parent] : undefined, n++) chain.push(p);
    return chain;
  };
  return Object.values(world.entities).filter(e => {
    if (e.player || e.kind === "area" || e.kind === "place" || e.states.includes("gone") || e.states.includes("destroyed")) return false;
    const chain = upFrom(e);
    return !chain.some(p => p.player) && chain.some(hidden);
  });
}

/** The things of what the player has come across here: an essential's, and what's owed them once it has landed. */
function foundThings(scene: Scene, state: TurnView): Set<string> {
  const landed = new Set(state.landed ?? []);
  const ids = (scene.essentials ?? []).filter(e => landed.has(e.id)).flatMap(e => e.things ?? []);
  for (const o of state.owed ?? []) {
    const here = scene.essentials?.find(e => e.missed === `${o.from}:${o.id}`);
    if (here && landed.has(here.id)) ids.push(...(o.essential.things ?? []));
  }
  return new Set(ids);
}

/**
 * The story so far, for the GM: every scene's hand-off, earliest first, each with the facts play
 * settled there, and the last scene's last moments word for word. Every one, not only the last: the
 * King's GM never knew Hobb had confessed at the Rat, two scenes back, when the rest were story notes
 * that disclosure had to open (and didn't, turn after turn).
 */
function storySoFar(state: TurnView): string {
  const last = state.history.at(-1)!;
  const scenes = state.history.map(h => [h.summary.trim(), ...(h.facts?.length ? [`Settled in play there:\n${bullets(h.facts)}`] : [])].join("\n"));
  return [
    `## What happened just before this scene\nThis is what actually happened in the story, scene by scene, the last one just before this. Where it disagrees with this prep about the state of the fiction (who is where, who has what, what was said, who admitted what), what happened wins: adapt the prep to it. It doesn't change what this scene is about. It's your knowledge, not everyone's: people here know only what they saw, did or have been told (here, or earlier where they were there), so someone who wasn't there knows nothing of it until they hear it, and doesn't ask about it, refer to it or guess at it before then.`,
    scenes.join("\n\n"),
    ...(last.lastMoments?.length ? [`The last moments, word for word:\n${last.lastMoments.map(m => `> ${m}`).join("\n")}`] : []),
  ].join("\n\n");
}

/** Stable prep for the GM: everything that doesn't change turn to turn (cache-friendly prefix). */
export function sceneBrief(scene: Scene, state: TurnView, options: { secrets?: boolean; hideEssentials?: boolean; docs?: boolean } = {}): string {
  options = { secrets: true, ...options };
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const cast = scene.cast.map(c => castBlock(scene, options.secrets ? c : { ...c, secrets: [] }, present.has(c.id))).join("\n\n");
  return [
    `# Your prep for this scene: ${scene.title}`,
    `## The place\n${scene.setting}`,
    `## What this scene is about\n${scene.premise}`,
    ...(scene.background?.length ? [`## Background\n${bullets(scene.background)}`] : []),
    ...(state.history.length ? [storySoFar(state)] : []),
    ...(state.adjustments?.length ? [`## Where the prep is out of date\nThe story has moved on from parts of this prep. These are true now, and they override anything in the prep that says otherwise. Like the story so far, they're your knowledge: people here know of them only what they saw, were there for or have been told. Where one is the world answering what the player did (an account given against them, a claim, someone demanding a reckoning), it comes up in this scene through the people it names, in their own words and acts, before the scene ends: a consequence never just vanishes.\n${bullets(state.adjustments)}`] : []),
    `## The people here\n${cast}`,
    `## Ways this scene can end\nThese are the only ways it can close. The player's choices decide which; don't force one.\n${scene.exits.map(exitBlock).join("\n")}`,
    ...(scene.essentials?.length && !options.hideEssentials ? [`## What the player needs to come across\nThe author placed these somewhere specific. Players often go elsewhere: when they do, don't let the scene starve. Move the thing to whatever they are engaging with (another person who could know it, an object, an event), or nudge softly (a remark, a telltale detail, a chance to notice or remember), so it reaches them through the path they chose. Each says whether the player has come across it. Until they have, it's behind the screen: they don't know it, and it comes out only through play (someone who knows it telling them, a thing found, a sign they notice), never in the narration's own words; nobody here says it, writes it down or acts on it as known unless they know it themselves (their card says so, or they've just seen it).\n${scene.essentials.map(e => `- ${e.what} (placed with: ${e.placedWith.join("; ")}). It opens up: ${e.unlocks}${e.missed ? ` [missed in an earlier scene, and the story still needs it: ${OWED_PLACE}]` : ""}${state.landed?.includes(e.id) ? " [already come across]" : state.hinted?.includes(e.id) ? " [already hinted at: the player has had a sign of it. Don't point at it again; let them take it up, or let it reach them another way]" : " [not come across yet]"}`).join("\n")}`] : []),
    ...(scene.limits?.length ? [`## What this scene can't offer\nIf the player reaches for one of these, let the world say no honestly, in the fiction, and show them what is possible instead.\n${bullets(scene.limits)}`] : []),
    `## The player character\n${state.player.name}: ${state.player.concept}.${state.player.build ? ` In game terms: ${state.player.build}; their spells, weapons and gear are what their sheet says.` : ""} They are the only player character.${addressLine(state.player)} Other people only know their name if they've been told it. ${STRANGER}${skillSummary(state)}${backstoryBrief(state, !!options.docs)}`,
    `## Table rules (for out-of-character questions)\n${state.rules
      ? "- The game runs D&D rules: it rolls the dice for checks, saving throws, spells, attacks and rests, and you're told each result (🎲). You never roll, ask for a roll or invent numbers.\n- The player can see their character sheet out of game (/sheet). Levels come at story milestones. A real fight moves to the battle map."
      : "- The game rolls a d20 plus a skill modifier at the scene's key moments; you'll be told the result. You don't roll or promise rolls yourself.\n- There's no experience or loot system yet."}\n- Scenes play in order; a scene can be brief, but it can't be skipped.\n- Your prep (what the scene is about, secrets, how it can end) stays behind the screen.`,
  ].join("\n\n");
}

function transitionLine(scene: Scene, t: Transition): string {
  if (t.check) {
    const fail = t.check.onFailure ? targetTitle(scene, t.check.onFailure) : "the scene carries on from here";
    return `- ${t.when} The dice decide (${titleCase(t.check.skill)}): success leads to ${targetTitle(scene, t.check.onSuccess)}; failure means ${fail}.`;
  }
  return `- ${t.when} Leads to ${targetTitle(scene, t.to!)}.`;
}

/** Strongest and weakest skills, so the GM narrates competence consistently and can answer "what am I good at?". */
function skillSummary(state: TurnView): string {
  const mods = Object.entries(state.player.modifiers).filter((e): e is [string, number] => typeof e[1] === "number").sort((a, b) => b[1] - a[1]);
  if (!mods.length) return "";
  const show = (xs: Array<[string, number]>) => xs.map(([k, v]) => `${titleCase(k)} ${v >= 0 ? "+" : ""}${v}`).join(", ");
  return `\nGood at: ${show(mods.slice(0, 4))}. Weak at: ${show(mods.slice(-3).reverse())}. (Skill modifiers for the dice; talk about them in plain words, not numbers, unless the player asks out of character.)`;
}


/** The per-turn note: where we are, what moves things on, co-GM notes and this reply's direction. */
const GUARD_NOTE: Record<string, string> = {
  surface: "nothing has shown yet. What would show first is something that doesn't fit: a dodge, a slip, a reaction they can't quite hide.",
  tell: "something has shown. If the player picks at it, their guard goes up, and something personal shows (someone or something they care about that bears on it).",
  stirred: "guard up. If the player keeps at it, what they're torn between comes out, in their own words: a worry, or a question to the player that shows it, never terms.",
  torn: "torn, in the open. Next, the thing itself comes out (told, bargained over or refused, depending on how the player has treated them), one piece at a time as the questions reach it.",
  settled: "settled. They answer follow-ups as far as what they know.",
};

/** Staged secrets: where each holder present stands, and the one step they can take next. */
function guardNote(scene: Scene, state: TurnView): string | undefined {
  const holders = presentCast(scene, state).filter(c => c.secrets?.length);
  if (!holders.length || !state.guard) return undefined;
  return `## How far people have opened up\nPeople give up what they're hiding the way they would at a good table: something that doesn't fit shows first; picked at, their guard goes up and something personal shows; kept at, what they're torn between comes out in their own words; only then does the thing itself come out, told, bargained over or refused, depending on how the player has treated them. A reply takes someone one step at most, and only when the player has given them a reason; proof, or leverage that really reaches them, can take them straight to the end. Nothing that's out goes back in.\n${holders.map(c => `- ${c.name}: ${GUARD_NOTE[state.guard?.[c.id]?.stage ?? "surface"]}`).join("\n")}`;
}

/** Does this reply close the scene? (Its directives say so, by their opening words.) */
const closes = (directive: string[]) => directive.some(d => d.startsWith("This reply closes the scene") || d.startsWith("The scene is ending"));

export function nowNote(scene: Scene, state: TurnView, directive: string[], options: { castNotes?: boolean; remind?: string } = {}): string {
  const beat = currentBeat(scene, state);
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const castNotes = Object.entries(beat.cast ?? {}).filter(([id]) => present.has(id))
    .map(([id, note]) => `- ${scene.cast.find(c => c.id === id)?.name ?? id}: ${note}`);
  const transitions = openRoutes([...beat.transitions, ...(scene.anytime ?? [])], state);
  const strangers = Object.entries(unnamed(scene, state)).filter(([id]) => present.has(id)).map(([id, called]) => { const c = scene.cast.find(x => x.id === id)!; return `- ${c.name}${c.aka?.length ? ` (${c.aka.join(", ")})` : ""}: "${called}"`; });
  const unseen = outOfSight(scene, state);
  const parts = [
    `## Where the scene is now: ${beat.title}\n${beat.direction}`,
    // Cast notes are a beat's opening agenda: once voiced, re-sending them turns them into repeated lines.
    ...(options.castNotes !== false && castNotes.length && state.turnsInBeat === 0 ? [`What people are after in this part of the scene (they pursue it naturally, react first to what just happened, and don't repeat themselves):\n${castNotes.join("\n")}`] : []),
    // The second reply in a beat still has the agenda, with its status: Kell told Prout's visit again a turn after telling it.
    ...(options.castNotes !== false && castNotes.length && state.turnsInBeat === 1 ? [`What people are after in this part of the scene. The last reply began it: whatever of it they've already said or done there is said and done, so they don't say or do it again; they go on to what's next in it, or react to what's new:\n${castNotes.join("\n")}`] : []),
    ...(options.castNotes !== false && castNotes.length && state.turnsInBeat > 1 ? [`People have already made their wants known here (${castNotes.map(n => n.split(":")[0]!.slice(2)).join(", ")}): now they act on them, wait, change tack or give ground; they don't restate them.`] : []),
    // Pressure is for stalls, and fires once: offered every turn, it gets replayed word for word.
    ...(beat.pressure && state.turnsInBeat >= 2 && !state.pressureOffered?.includes(beat.id) ? [`The scene has been sitting here a while. If it's stalling or drifting, the world can push: ${beat.pressure}`] : []),
    `(The scene has been at this point for ${state.turnsInBeat} exchange${state.turnsInBeat === 1 ? "" : "s"}.)`,
    `## What moves the scene on from here\n${transitions.map(t => transitionLine(scene, t)).join("\n")}`,
    ...(guardNote(scene, state) ? [guardNote(scene, state)!] : []),
    // Co-GM notes steer the middle of a scene; a closing works from what happened, not stale steering.
    // An ending held for the player's answer isn't a closing: the notes are for that answer (the
    // Heron's note to stage Sallow initialling the page was kept from the GM while the barge was held).
    ...(!state.closing && !closes(directive) && (state.notes || state.whispers?.length) ? [`## Notes from your co-GM (for you, written a moment ago: let them shape what people do, but nobody recites them; if the player has since chosen otherwise, the player's choice wins)\n${[state.notes ?? "", ...(state.whispers ?? []).map(w => `- On ${scene.cast.find(c => c.id === w.to)?.name ?? w.to}'s mind: ${w.note}`)].filter(Boolean).join("\n")}`] : []),
    ...(state.canon.length || state.established.length ? [`## Details established in play (keep them true)\nWhat has happened and been found, in the order it happened.${state.world ? " Where people are and what they're doing now is the world's, below: a detail here about where someone was or what they were doing was true then, and where the world says otherwise, they've moved on (people who have left don't come back unless the story brings them)." : ""}\n${bullets([...state.established, ...state.canon])}`] : []),
    ...(playerNow(state) ? [playerNow(state)!] : []),
    ...(state.world ? [`## The world right now\nWhere everyone and everything is, and what state it's in (ids in brackets). Keep to it, since it's updated after every reply: people and things are where it says, and what's destroyed, burning or gone stays that way until the story changes it. Details it doesn't list are yours to invent, consistent with it. It's as things stood before the player's turn: what the player does in it (shutting a book and buttoning it into their coat, picking something up, crossing the room) has happened by your reply, and the world catches up after it. It's the truth behind the screen, not what the player has seen: of what people carry, the player sees what's out in the open (worn, in hand, held up), and of the rest (in a pocket, a fist, a lining, a box) they know only what they've seen or been told.${unseen.length ? ` Out of the player's sight, and nobody has shown or told them of it: ${unseen.map(e => `${e.name} [${e.id}]`).join("; ")}. Until they find it, the narration doesn't mention it or where it is.` : ""}\n${PHYSICS}\n\n${worldView(state.world)}`] : []),
    // Last before the reply's form and directions: those, the details above and the world all use the names.
    ...(strangers.length ? [`## Names the player hasn't heard yet\nUntil someone in the story says their name, the narration (and anyone who wouldn't know it) doesn't use it: call them what the player would. Your prep, the details established, the world and your directions use their names; your narration doesn't, until someone says it.\n${strangers.join("\n")}`] : []),
    // A word on the reply's form comes before what it must do, which has the last word.
    ...(options.remind ? [options.remind] : []),
    ...(directive.length ? [`## For this reply\n${directive.join("\n\n")}`] : []),
  ];
  return parts.join("\n\n");
}

/** The player's state from the rules, when it should show in the story: hurt, or under a condition. */
function playerNow(state: TurnView): string | undefined {
  const status = state.rules?.status;
  if (!status) return undefined;
  const hp = /^HP (\d+)\/(\d+)/.exec(status);
  const hurt = !!hp && Number(hp[1]) < Number(hp[2]);
  const conditions = status.split(", ").slice(1).filter(p => !p.startsWith("spell slots") && !/^\d/.test(p));
  return hurt || conditions.length ? `## The player character now\n${status}. Let it show: someone hurt moves and looks hurt.` : undefined;
}

export function sceneEntries(state: TurnView): ViewEntry[] {
  return state.transcript.filter(e => (e.scene ?? state.sceneId) === state.sceneId);
}

export function speakerName(scene: Scene, state: TurnView, speaker: string): string {
  if (speaker === "player") return state.player.name;
  if (speaker === "gm") return "GM";
  return scene.cast.find(c => c.id === speaker)?.name ?? speaker;
}

/** Script-style transcript, used for actors, deciders and the repair agent. */
export function scriptTranscript(scene: Scene, state: TurnView, entries = sceneEntries(state)): string {
  return entries.map(e => {
    if (e.kind === "roll" || e.kind === "system") return `[${e.text}]`;
    const name = speakerName(scene, state, e.speaker);
    return e.speaker === "player" ? `${name} (player): ${e.text}` : `${name}: ${e.text}`;
  }).join("\n\n");
}
