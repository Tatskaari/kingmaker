import { sceneById, SCENES } from "../../../../scenes/index.ts";
import type { Character } from "../../../runtime/scene.ts";
import { boundaryPreview } from "../../../runtime/engine.ts";
import { APPROACHES } from "../../../runtime/approaches.ts";
import { buildWorld } from "../../../world/scene-world.ts";
import { zooFronts } from "../fronts.ts";
import { actorsFromWorld, sceneTrigger, type MapOverlay } from "../../map/index.ts";
import { T, type PlaceRegion } from "../../map/tiles.ts";
import type { MapActor, Tile2, TileMap } from "../../types.ts";
import { marks, rect, type Ctx, type Exhibit, type Outcome, type Plan, type Trigger, type Wing } from "../model.ts";
import { COBBLES, floorFor } from "./common.ts";
import { toHall } from "./hall.ts";

/**
 * The theatre: booths round a courtyard, each a scene of the zoo's own (scenes/zoo), played with
 * the real GM. Step through a booth's door, or talk to whoever's waiting in it, and its scene opens
 * on its own place, framed on the map, with its world drawn from above beside the transcript. Each
 * is short, and its sign says what it's for and what to try. A scene played leaves its booth as it
 * left it, until it's played again (or the lever puts them all back). Offline the GM can't speak:
 * each scene still opens, its place drawn, and /end <exit> takes any of its endings.
 *
 * The repertory board rehearses any scene of the story, or of the scene harness, out of order: the
 * zoo's own session plays it on its own place (the story's maps, for the arc's), and nothing done in
 * a rehearsal reaches the story.
 */

const GRID = `
##################################################
%WWWWWWWWWW.WWWWWWWWWW.WWWWWWWWWW.WWWWWWWWWW.....#
%WffffffffW.WbbbbbbbbW.WccccccccW.WooooooooW.....#
%WffffffffW.WbbbbbbbbW.WccccccccW.WooooooooW.....#
%WffffffffW.WbbbbbbbbW.WccccccccW.WooooooooW.....#
%WffffffffW.WbbbbbbbbW.WccccccccW.WooooooooW.....#
%WffffffffW.WbbbbbbbbW.WccccccccW.WooooooooW.....#
%WffffffffW.WbbbbbbbbW.WccccccccW.WooooooooW.....#
%WWWW+WWWWW.WWWW+WWWWW.WWWW+WWWWW.WWWW+WWWWW.....#
%................................................#
%...1..........2..........3..........4...........#
%.................................==============.#
%.................................=yyyyyddyyyyy=.#
%.....g...s.......................=yyyyyddyyyyy=.#
%...................q...........5.=yyyyyddyyyyy=.#
%.................................Gyyyyyddyyyyy=.#
%.................................=yyyyyddyyyyy=.#
%...........R.....................=yyyyyddyyyyy=.#
%.........r.......................=yyyyyddyyyyy=.#
%.................................=yyyyyddyyyyy=.#
%.................................==============.#
%................................................#
%........h....m....k....p.........WWWWWWWWWWWW...#
%.................................WttttttttttW...#
%...............................6.WttttttttttW...#
%.................................+ttttttttttW...#
X.................................WttttttttttW...#
%.@.a.............................WttttttttttW...#
%.................................WWWWWWWWWWWW...#
%................................................#
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%#
`;

const MARKS = "@a123456Rrghmkpqs";
const at = marks(GRID, MARKS);
const ID = "zoo-theatre";

/** A booth: its scene, its floor (the region the scene is played in), where its world's corner is, its door. */
interface Booth { sceneId: string; id: string; name: string; label: string; rect: { x: number; y: number; w: number; h: number }; origin: Tile2; door: Tile2; description: string }

const BOOTHS: Booth[] = [
  { sceneId: "zoo-pie-stall", id: "zoo-theatre-pie", name: "the pie stall", label: "Step up to the pie stall", rect: { x: 2, y: 2, w: 8, h: 6 }, origin: { x: 1, y: 1 }, door: { x: 5, y: 8 }, description: "A booth set up as a pie stall: one pie left, and a pie-seller who knows it." },
  { sceneId: "zoo-belfry", id: "zoo-theatre-belfry", name: "the belfry", label: "Climb into the belfry", rect: { x: 13, y: 2, w: 8, h: 6 }, origin: { x: 12, y: 1 }, door: { x: 16, y: 8 }, description: "A booth set up as a bell tower's ringing chamber, open to the drizzle." },
  { sceneId: "zoo-card-sharp", id: "zoo-theatre-cards", name: "the card room", label: "Go into the card room", rect: { x: 24, y: 2, w: 8, h: 6 }, origin: { x: 23, y: 1 }, door: { x: 27, y: 8 }, description: "A booth set up as a low card room with one lamp and one winner." },
  { sceneId: "zoo-ledger", id: "zoo-theatre-ledger", name: "the ledger office", label: "Go into the ledger office", rect: { x: 35, y: 2, w: 8, h: 6 }, origin: { x: 34, y: 1 }, door: { x: 38, y: 8 }, description: "A booth set up as a cramped office with a lost ledger and a cat." },
  { sceneId: "zoo-practice-yard", id: "zoo-theatre-yard", name: "the practice yard", label: "Go into the practice yard", rect: { x: 35, y: 12, w: 12, h: 8 }, origin: { x: 34, y: 11 }, door: { x: 34, y: 15 }, description: "A fenced yard with a ditch down the middle and things in it to be hit, burned, jumped over and thrown about." },
  { sceneId: "zoo-tavern", id: "zoo-theatre-tavern", name: "the Cracked Tankard", label: "Go into the Cracked Tankard", rect: { x: 35, y: 23, w: 10, h: 5 }, origin: { x: 34, y: 22 }, door: { x: 34, y: 25 }, description: "A booth set up as a low tavern, two porters on their feet over a ha'penny." },
];

/** The booths as the zoo's rooms: stepping into one opens its scene. */
export const THEATRE_ROOMS = BOOTHS.map(b => ({ sceneId: b.sceneId, map: ID, name: b.name, rooms: [b.rect], region: b.id, door: b.door }));

/** Who's there when a scene opens (not those who come in at a later beat). */
const atStart = (cast: Character[]) => cast.filter(c => !c.enters);

const previews = new Map<string, MapActor[]>();

/**
 * Whoever's waiting in a scene's place, and its things, before it's played (presence for the zoo's
 * rooms): its people open its scene when spoken to, by what the player would call them. Once played,
 * the map keeps its things as the scene left them (the overlay), so only its people are added.
 */
export function roomPreviews(rooms: Array<{ sceneId: string; map: string; region: string }>, mapId: string, map: TileMap, overlay?: MapOverlay): MapActor[] {
  const out: MapActor[] = [];
  for (const room of rooms) {
    if (room.map !== mapId) continue;
    let actors = previews.get(room.sceneId);
    if (!actors) {
      const scene = sceneById(room.sceneId);
      const region = map.regions.find(r => r.id === room.region)!;
      const world = buildWorld(scene.id, scene.world!, atStart(scene.cast).map(c => ({ id: c.id, name: c.called ?? c.name })), { name: "you" });
      actors = actorsFromWorld(region, world, { map, player: false }).map(a => {
        const host = (a.kind === "person" || a.kind === "creature") && scene.cast.some(c => c.id === (a.ref ?? a.id));
        return { ...a, id: `${scene.id}:${a.id}`, ...(host ? { interaction: sceneTrigger(scene.id, "talk", `Talk to ${a.name}`) } : {}) };
      });
      previews.set(room.sceneId, actors);
    }
    const played = !!overlay?.scenes[room.sceneId];
    out.push(...actors.filter(a => !played || ((a.kind === "person" || a.kind === "creature") && !overlay!.scenes[room.sceneId]!.things.some(t => t.ref === a.ref))).map(a => ({ ...a, at: { ...a.at } })));
  }
  return out;
}

/** The approaches the house-style lever goes round (src/runtime/approaches.ts), the game's own first. */
const STYLES = ["v2", "v2-straight", "actors", "v2-pressure"];

/**
 * The boundary desk: the last scene the visitor played, handed across a scene boundary exactly as
 * the story hands one on (boundaryPreview), without going anywhere: a booth goes to the next booth,
 * with the zoo's own fronts; a rehearsed scene of the story to its own next scene, with the story's.
 */
async function crossAtDesk(z: Ctx): Promise<Outcome> {
  const s = z.session;
  const last = s.history.at(-1);
  if (!last || last.sceneId !== s.sceneId) return { text: "The boundary clerk looks up from his ledger. \"Nothing to hand on. Play a booth, or rehearse a scene, and bring me how it ended.\"" };
  const scene = sceneById(last.sceneId);
  const exit = scene.exits.find(e => e.id === last.exitId);
  const order = [...BOOTHS.map(b => b.sceneId)];
  // A booth goes on to the next booth; a scene of the story to its own next, with the story's fronts;
  // one the story goes nowhere from (the harness's) to the first booth, with the zoo's.
  const story = !scene.id.startsWith("zoo-") && !!exit?.next;
  const nextId = story ? exit!.next! : order[(order.indexOf(scene.id) + 1) % order.length]!;
  const next = sceneById(nextId);
  const b = await boundaryPreview(s, next.id, story ? undefined : zooFronts(s.id));
  const moved = b.fronts.map(f => f.replace(/^ticked: /, "ticked ").replace(/^struck: /, "struck out ").replace(/^bill: /, "a bill to come due: "));
  return {
    text: [
      `The boundary clerk takes ${scene.title} (${exit?.title ?? last.exitId}) and does on paper what the story does between scenes.`,
      `The hand-off: ${b.handoff.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim() || b.handoff}`,
      `The next scene, ${next.title}, checked against it: ${b.adjustments.length ? b.adjustments.join(" ") : "nothing in its prep is out of date (or the model wasn't asked)."}`,
      b.opening ? `Its opening, as it stands now: ${b.opening}` : `Its opening stands as written.`,
      b.lead ? `How you'd hear of it: ${b.lead}` : "",
      `The fronts: ${moved.length ? `${moved.join("; ")}.` : "nothing moved (nothing in motion was touched, or the model wasn't asked)."}`,
    ].filter(Boolean).join(" "),
  };
}

/** How the tour plays the rehearsals it takes (the rest end at their first ending that isn't a fight). */
const REHEARSALS: Record<string, Plan> = {
  "hanged-clerk": { exit: "case-made", say: ["Good morning, Sergeant. Who found him?", "I'd like to look at the rope."] },
  "heron-warehouse": { exit: "fight", after: "caught-in-the-act", fight: [] },
  "kings-morning": { exit: "justice" },
  "warren-hostage": { exit: "fight", after: "escorted", fight: [] },
};

/** Rehearse a scene of the story's or the harness's: the repertory board's choices. */
const REPERTORY: Trigger[] = SCENES.map(s => ({
  id: `rehearse-${s.id}`, label: `Rehearse ${s.title}${s.interlude ? " (an interlude)" : ""}`, at: at.R!,
  ...(s.id === SCENES[0]!.id ? { station: { name: "the repertory board", glyph: "▥", color: "#c9a94a" } } : {}),
  expect: ["scene"], plan: REHEARSALS[s.id] ?? { exit: s.exits.find(e => e.kind !== "combat")?.id ?? s.exits[0]!.id },
  run: () => ({ text: `The house lights go down. ${s.title}, from the top: ${s.hook}`, open: s.id }),
}));

const sign = (id: string, mark: string, title: string, shows: string[], text: string, triggers: Trigger[] = [], extra: Partial<Exhibit> = {}): Exhibit =>
  ({ id, title, shows, sign: at[mark]!, text, triggers, ...extra });

const exhibits: Exhibit[] = [
  sign("theatre", "a", "The Theatre", ["The scene screen", "Opening a scene from the map"],
    "Booths round a courtyard, each a scene with the real GM, short enough to finish in a few turns. Step through a booth's door, or talk to whoever's waiting in it, and the scene opens: type what you say, or *what you do*. Each booth's sign says what it's for and what to try. Offline the GM can't speak, but the scene still opens on its place, and /exits then /end <id> takes any of its endings (and runs its script into the notebook)."),
  sign("pie-stall", "1", "The Last Pie", ["The GM's turn", "Authored checks", "The method decides the roll", "Simply happens (no dice)", "What has happened (outcome routes)", "Earned payoffs", "Consequences for daft acts", "'No, but' limits", "Out-of-character questions", "Pacing cues", "Beat pressure"],
    "One pie left, and the pie-seller knows it. Try: \"I'll give you tuppence\" (haggling is a Persuasion check); \"*leans on the counter* Threepence, or the dog gets it\" (a threat rolls Intimidation, not Persuasion: the method decides, and she remembers); paying her price (no dice: it simply happens); minding the stall for her (a kindness earns the pie free); \"these pies are a disgrace\" (a daft act gets a bill); \"can I pay you next week?\" (no credit: an honest no, with somewhere to go); \"(how do checks work?)\" (out of character, answered out of character). Dawdle and a rival buyer arrives (a pacing cue).",
    [], { needsModel: true, scene: { id: "zoo-pie-stall", exit: "bought", say: ["Good morning! How much for the last pie?", "*leans on the counter* Threepence, or the dog gets it.", "Fine. Fourpence, then."] } }),
  sign("belfry", "2", "The Noon Bell", ["Pacing cues", "Endings: closing, escalating, the last chance", "Freeform risky checks", "Threats hanging over the player", "An ending of their own, and walking out", "Stuck and drifting scenes", "Weather (gallery only)"],
    "A pigeon has nested in the noon bell, and it's a few minutes to noon. Try: talking the bell-ringer round; climbing the ladder to move the nest (an Athletics check); something no route covers, like climbing the frame or wedging the clapper (a freeform roll, risky either way, and a slip leaves a danger hanging over you that lands next turn); doing nothing (the clock runs on: a minute to noon, then noon, which you didn't choose, so it warns you first and waits a turn); or walking out (an ending of your own). It's drizzling in the arches: the only weather in the game, from this booth's dressing, seen from above.",
    [], { needsModel: true, scene: { id: "zoo-belfry", exit: "spared", say: ["Is that a pigeon in the bell?", "*climbs up the bell frame to wedge the clapper with my hat*", "Could you hold off ringing it, just this once?"] } }),
  sign("cards", "3", "The Silver Dice", ["Names held back", "Staged secrets", "Pressure rolls (the v2-pressure approach, scene harness)", "Reactions to violence"],
    "A woman winning every throw. Until someone says her name, she's \"the woman with the silver dice\": in the narration, the dice lines and the barks. What she hides comes out a step at a time (a tell, guard up, torn, told), only when you give her reason; pressing her is ruled yes, no, or a roll from the stakes and your leverage. Try watching her hands (Perception), asking to see the dice, pressing her about money, and, if you must, grabbing her wrist: the two gamblers react, each their own way. This booth turns on staged secrets and pressure rolls for itself.",
    [], { needsModel: true, scene: { id: "zoo-card-sharp", exit: "paid-back", say: ["*watches her hands as she throws*", "*leans in* You owe somebody money, don't you? Who?", "May I see those dice?"] } }),
  sign("ledger", "4", "The Lost Ledger", ["Essentials and relocation", "The co-GM", "Memory (the docs service)", "Entrances and groups"],
    "The ledger's lost and the auditor's coming. Where it is (under the cat) is something this scene needs you to find: if you search elsewhere, it comes to you through whoever you're dealing with. Try something nobody planned for (the quick co-GM gets three seconds to add a way). Dawdle and the auditor arrives with his two assistants, each a person of their own at the door; Madam Crust comes in behind them for her receipt, remembering you if you met at the pie stall (memories written in the background after each turn).",
    [], { needsModel: true, scene: { id: "zoo-ledger", exit: "found", say: ["Where did you last see the ledger?", "*looks under the cat*"] } }),
  sign("yard", "5", "The Practice Yard", ["Casting in a scene", "Spells on things, and spells that make surfaces", "A blow in a scene", "Grapple and shove", "Jumping", "Class features in a scene", "Rests", "Bystanders", "Spells running out"],
    "The rules in a scene, read by the GM's decider and decided by the engine. Try: \"(I cast Fireball at the haystack)\" (your own spells from your own slots, or a fizzle); \"I hit the dummy\" (one attack); \"I grab Wim\" and \"I shove him over\" (he saves against your Strength); \"I jump the ditch with a run-up\" (Strength against the gap: fall short and you're in it); \"(I cast Grease by the barrel)\"; \"I take a breather\" (Second Wind, in the fighter's mail); \"I rest for an hour\" (a short rest). The Rules Room does all this without the GM.",
    [], { needsModel: true, scene: { id: "zoo-practice-yard", exit: "done", say: ["(I cast Fire Bolt at the haystack)", "I jump the ditch with a run-up.", "I grab Wim, then try to shove him over.", "That's me done, thank you, Mistress Hobble."] } }),
  sign("tavern", "6", "The Cracked Tankard", ["Roll for initiative", "After the fight", "Reactions to violence"],
    "Two porters about to fight over a ha'penny. Settle it (a check) and nobody goes through the window. Lay hands on one, egg them on, or let it boil over, and it ends in \"Roll for initiative!\": a fight on the tavern's own floor, everyone where its world has them, its lantern on the beam to bring down, and Kell beside you if she's walking with you. You can still talk in it (type, as you did in the scene): tell them it's a ha'penny, and see who listens. When it's over the scene picks up for the aftermath, and ends when it's swept up. Offline: /end fight goes straight to the fight, then /end swept-up.",
    [], { needsModel: true, scene: { id: "zoo-tavern", exit: "fight", after: "swept-up", say: ["Gentlemen, it's a ha'penny."], fight: ["say:Gentlemen! It's a ha'penny. Put the stools down before somebody loses an ear.", "say:shove the big porter over"] } }),
  sign("repertory", "r", "The repertory board (rehearsals)", ["The Hanged Clerk", "The interludes", "The Drowned Rat", "The Heron Warehouse", "The King's Morning", "Other scenes (scene harness only)", "Afterwards", "Exit scripts (world-update scripts)", "Kell in the story's scenes", "Levelling up at a milestone", "Roll for initiative"],
    "Any scene of the story, or of the scene harness, from the top, out of order: the zoo's own session plays it on its own place (the arc's are on the story's maps: you're taken there and back), with its cast, its checks, its cues and its endings. Nothing done in a rehearsal reaches the story. Offline, /exits lists a scene's endings and /end <id> takes one: its exit script writes the notebook, and its afterwards (Prout taken down) is applied. Rehearse the Heron and end it with /end fight for the map fight; the King's Morning levels you up as it opens (the hall's wardrobe puts you back to five).",
    REPERTORY, { tour: ["rehearse-hanged-clerk", "rehearse-heron-warehouse", "rehearse-kings-morning", "rehearse-warren-hostage"] }),
  sign("gm", "g", "The GM's turn", ["The GM's turn"],
    "Everything you say in a scene is one call to the GM (Luna), which narrates and voices everyone in the house's comic style, from the scene's prep and a note on where things stand now, streamed as it comes. Before it, the decider has read your turn (a route, a roll, a spell, something the scene can't offer); after it, what happened is judged and the stage manager writes it into the world. A reply that repeats itself word for word is asked for again."),
  sign("boundary", "h", "The scene boundary, and fronts", ["The scene boundary", "Fronts: the world moves between scenes"],
    "The zoo's scenes are exhibits, not a story: each ends back on the map with nothing handed on. In the story, a scene's end is where the model writes the hand-off (how things stand), checks the coming scenes against what happened (a scene play has settled is skipped), rewrites the next opening, and moves the world's fronts on (the Purveyor's man, dear bread). The boundary desk does all of that, on paper, for the last booth you played: its hand-off, the next booth's prep checked and its opening rewritten, and the zoo's own fronts moved on (Madam Crust's pies, the noon bell, the auditor's round). A rehearsed scene of the story goes to its own next scene, with the story's fronts, in this visit's copy. It needs the model: offline you get the plain hand-off.",
    [{ id: "boundary-desk", label: "Take your last scene across the boundary (the boundary desk)", at: { x: 10, y: 22 }, station: { name: "the boundary desk", glyph: "▬", color: "#a07a52" },
      run: z => crossAtDesk(z) }], { needsModel: true }),
  sign("prompter", "s", "The prompter's box", ["Suggested lines"],
    "A moment after every reply in a booth, the prompter offers a few lines you might say or do next, over the box, numbered: something to say, something to do, a risky try in the dice's yellow (choose it and the scene rolls for it, as it would if you'd typed it), and, once a scene's near its end, a way out. A number or a click puts one in the box, to send as it is or change; typing anything puts them away. They're made from what you know, and the GM's own judge reads them against what you don't: no name you haven't heard, no clue you haven't found. The prompter is never in a hurry, and nothing waits for him. /suggestions off, or the Esc menu, sends him home. He needs the model.",
    [], { needsModel: true }),
  sign("memory", "m", "What people remember", ["Memory (the docs service)"],
    "The lore docs and each person's memory index are in the GM's prep; each turn the notes that bear on the moment are opened; after each turn a background review writes first-person memories. In the zoo: meet Madam Crust at the pie stall, then meet her again in the ledger office, where she walks in remembering. It needs the model (and a minute between: the reviews run in the background)."),
  sign("cogm", "k", "The co-GM", ["The co-GM", "Stuck and drifting scenes"],
    "On a turn the decider judges off the graph (a way through no route covers), the reply waits up to three seconds for the quick co-GM, which can add a route with a roll, move an essential, or leave notes. Every few turns the full co-GM reviews the scene in the background. After each reply the scene is judged on track, drifting or stuck; the reply after a stuck exchange has to break the loop. The ledger office and the belfry are good places to wander off the graph."),
  sign("approaches", "p", "Approaches", ["Approaches (scene harness and evals)"],
    "The same scenes run other ways, in the scene harness (npm run scene): one GM voice (the game's v2), actors who each know only what they know, speculative replies, a holding beat while the co-GM works, staged secrets, pressure rolls, a plain style. The game always plays v2. The house-style lever beside this sign changes how the booths here play, for this visit: v2, v2 played straight, actors, or v2 with pressure rolls (the card room switches staged secrets and pressure rolls on for itself either way). Pull it, then play a booth.",
    [{ id: "approach-lever", label: "Pull the house-style lever (the booths play another way)", at: { x: 25, y: 22 }, station: { name: "the house-style lever", glyph: "╤", color: "#c8b28a" },
      run: z => {
        const next = STYLES[(STYLES.indexOf(z.session.approach) + 1) % STYLES.length] ?? "v2";
        z.session.approach = next;
        return { text: `Clunk. The booths now play ${next}: ${APPROACHES[next]!.description}${next === "v2" ? " (The game's own.)" : " (Pull again for the next; v2 is the game's own.)"}` };
      } }], { tour: ["approach-lever", "approach-lever", "approach-lever", "approach-lever"] }),
  sign("left-as-it-was", "q", "Places as their scenes left them", ["Places as their scenes left them", "A scene's place on the map", "Roofs off and cutaways"],
    "A scene's place on the map shows its live world while it's played (people where they stand, the fires, the puddles; /map in a scene shows it with its roof off), and afterwards keeps what the scene did to it: things broken, moved or burning, what was spilled. Play the practice yard and set fire to the haystack, then come out and look. Walk into a booth and its roof comes off and its front walls are cut down so you can see in. The lever puts every booth back.",
    [{ id: "theatre-reset", label: "Pull the lever: put the booths back", at: { x: 21, y: 14 }, station: { name: "the booths' lever", glyph: "╥", color: "#9ab0c0" },
      run: z => { for (const b of BOOTHS) delete z.ex.overlay.scenes[b.sceneId]; return { text: "Clunk. Stagehands in black reset every booth, very quietly, the way stagehands do." }; } }]),
];

export const theatre: Wing = {
  id: ID,
  name: "the Theatre",
  about: "Short scenes with the GM, in booths round a courtyard, and rehearsals of the story's own scenes.",
  entry: at["@"]!,
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "civic", height: 3 }), "%": T("wall", { style: "stone", height: 1 }), ".": COBBLES,
      W: T("wall", { style: "timber", height: 2 }), "+": T("door", { style: "timber", height: 2 }), "=": T("fence", { style: "fence" }), G: T("door", { style: "fence", height: 1 }),
      X: T("door", { style: "stone", height: 1 }),
      f: T("boards", { roof: "plaster", roofHeight: 2 }), b: T("floor", { style: "flags", roof: "timber", roofHeight: 2 }), c: T("floor", { style: "carpet", roof: "plaster", roofHeight: 2 }),
      o: T("boards", { roof: "timber", roofHeight: 2 }), t: T("boards", { roof: "tar", roofHeight: 2 }), y: T("dirt"), d: T("water"),
      ...floorFor(MARKS, COBBLES),
    },
    regions: BOOTHS.map((b): PlaceRegion => ({ id: b.id, name: b.name, rect: b.rect, sceneId: b.sceneId, worldOrigin: b.origin, trigger: "enter", label: b.label, description: b.description })),
    exits: [{ at: { x: 0, y: 26 }, to: toHall(ID), label: "Back to the hall" }],
  },
  world: {
    name: "The Theatre", description: "A courtyard of booths, each a scene waiting for someone to walk into it.",
    size: { w: 50 * 5, h: 31 * 5 },
    areas: [{ id: "courtyard", name: "the courtyard", rect: rect(0, 0, 50, 31) }],
    things: [],
    people: { player: { in: "courtyard", at: [12.5, 137.5] } },
  },
  dressing: { ground: { courtyard: "cobbles" } },
  exhibits,
};

/** Each booth's scene's place, for the map to play it in. */
export const THEATRE_PLACES = BOOTHS.map(b => ({ sceneId: b.sceneId, region: b.id, door: b.door, outside: { x: b.door.x === b.origin.x ? b.door.x - 1 : b.door.x, y: b.door.x === b.origin.x ? b.door.y : b.door.y + 1 } }));
