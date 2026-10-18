import { test } from "node:test";
import assert from "node:assert/strict";
import { bandOf, BANDS, type Band } from "../../../shared/gm/two-part.ts";
import type { SidePick } from "../../../shared/gm/combat.ts";
import type { CombatMove, CombatRequest, CombatResponse, Initiative, Reply, ReplyResponse, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { keyParts, turnKeyParts } from "../../../shared/protocol/keys.ts";
import type { SceneDocument } from "../../../shared/scene/document.ts";
import { nextCheck, openedGame, sceneNow, type PackOptions } from "../host/testing.ts";

/**
 * A fight in the conversation (docs/combat-gm.md), on the memory host with the hanged clerk: the
 * reply rolls for initiative, everyone rolls once and the order is written; the other side's turns
 * are combat steps until it's the player's, when the scene waits for their line; each of the GM's
 * actions is resolved by the rules on the yard's world (a move in the place, a blow from out of reach
 * refused, one in reach rolled), and the fight's end goes on to the settle.
 */

const usage = { calls: 1, costUsd: 0.001, byOperation: {} };
const answer = (move: CombatMove): CombatResponse => ({ move, entries: [{ speaker: "gm", kind: "narration", text: "narration" in move ? move.narration : move.act.narration }], usage });

/** The GM's pick for everyone with no side yet (pick_sides): `sides`' by id, else they run. */
const picks = (request: CombatRequest, sides: Record<string, SidePick> = {}): CombatMove =>
  ({ kind: "sides", sides: Object.fromEntries(request.combat.pending!.map(p => [p.id, sides[p.id] ?? "flee"])), narration: "Everyone else takes a side, or a door." });

/**
 * A fight in the yard: the reply rolls for initiative (Cob against the player and Kell beside them,
 * unless `initiative` says otherwise), and `plays` is the GM's every move after, but for whoever has
 * no side yet, who's picked by `sides` (else they run).
 */
async function fight(plays: (request: CombatRequest) => CombatMove, options: { sides?: Record<string, SidePick>; initiative?: Initiative; pack?: PackOptions } = {}) {
  const game = await openedGame(7, "fighter", { asIs: true, ...options.pack });
  const { host, wren, scene, script } = game;
  const asked: CombatRequest[] = [];
  const respond = (request: unknown) => { const r = request as CombatRequest; asked.push(r); return answer(r.combat.pending?.length ? picks(r, options.sides) : plays(r)); };
  for (let i = 0; i < 80; i++) script.then("combat", respond);
  const reply: ReplyResponse = { entries: [{ speaker: "gm", kind: "narration", text: "Cob spits and comes at you with the boathook. Roll for initiative!" }], gm: {}, firstTextMs: 3, initiative: options.initiative ?? { foes: ["cob"], allies: ["kell"], why: "Cob won't be taken" }, usage };
  script.then("reply", reply);
  const line = async (text: string) => {
    const refused = host.as(wren).say({ text });
    assert.equal(refused, undefined, `"${text}" was refused: ${refused?.text}`);
    await host.drain();
    return sceneNow(host, scene.id);
  };
  return { ...game, asked, line };
}

/** The player closes on Cob, then hits him; the others pass their turns; the fight ends when the rules say so. */
const closeAndHit = (request: CombatRequest): CombatMove => {
  const c = request.combat;
  if (c.over) return { kind: "end_combat", outcome: c.over.outcome, narration: "Cob is down in the dust." };
  if (c.whose !== "player") return { kind: "end_turn", narration: `${c.whose} circles.` };
  if (c.done.length === 0) return { kind: "act", act: { action: "move", target: "cob", narration: "You close on him." } };
  if (c.done.length === 1) return { kind: "act", act: { action: "attack", target: "cob", narration: "You swing." } };
  return { kind: "end_turn", narration: "Your blow lands where it lands." };
};

test("the reply rolls for initiative: everyone rolls once, the order is written, and the scene goes round it until it's the player's turn", async () => {
  const { line, asked } = await fight(closeAndHit);
  const now = await line("I grab Cob by the collar.");
  const combat = now.gm.combat!;
  assert.ok(combat, "a fight is on");
  assert.deepEqual(new Set(combat.order.map(f => f.id)), new Set(["player", "kell", "cob"]));
  assert.deepEqual(combat.order.map(f => f.side), combat.order.map(f => (f.id === "cob" ? "foes" : "party")));
  const rolls = now.lines.filter(l => l.kind === "roll" && l.text.startsWith("Initiative: "));
  assert.equal(rolls.length, 3);
  assert.ok(now.lines.some(l => l.kind === "system" && /^Combat! In initiative order: /.test(l.text)));
  assert.equal(combat.order[combat.at]!.id, "player", "the scene waits on the player's turn");
  assert.equal(now.lines.at(-1)!.text, "Your turn.");
  assert.ok(asked.filter(r => !r.combat.pending).every(r => r.combat.whose !== "player"), "the others' turns before the player's were the GM's");
  assert.deepEqual(now.turns.map(t => t.phase), ["done", "done"], "the box is open for the player's turn");
});

test("everyone here picks a side or runs (the user's design): one the reply left out is the GM's to pick before the first turn, rolls for initiative and takes their place in the order", async () => {
  const { line, asked } = await fight(closeAndHit, { sides: { moll: "against_player" } });
  const now = await line("I grab Cob by the collar.");
  const first = asked[0]!;
  assert.deepEqual(first.combat.pending?.map(p => [p.id, p.name]), [["moll", "Moll"]], "Moll had no side: the first step is the GM's pick");
  assert.equal(keyParts(first.key)!.step, "combat");
  const combat = now.gm.combat!;
  assert.deepEqual(Object.fromEntries(combat.order.map(f => [f.id, f.side])), { player: "party", kell: "party", cob: "foes", moll: "foes" });
  assert.equal(combat.pending, undefined);
  assert.equal(now.lines.filter(l => l.kind === "roll" && l.text.startsWith("Initiative: ")).length, 4, "Moll rolled as she picked her side");
  assert.ok(now.lines.some(l => l.kind === "system" && l.text === "Joining the fight: the girl in the shawl (against you)."), "as the player knows her");
  assert.ok(asked.slice(1).every(r => !r.combat.pending), "picked once");
});

test("whoever the reply has run from the fight is gone from the scene as it breaks out, with no pick to make; one the GM picks to run goes the same way", async () => {
  const ran = await fight(closeAndHit, { initiative: { foes: ["cob"], allies: ["kell"], flee: ["moll"], why: "Cob won't be taken" } });
  const now = await ran.line("I grab Cob by the collar.");
  assert.ok(ran.asked.every(r => !r.combat.pending), "no pick: everyone here has a side, or ran");
  assert.ok(now.lines.some(l => l.kind === "system" && /^Combat! In initiative order: .*\. Running from it: the girl in the shawl\.$/.test(l.text)));
  assert.deepEqual([now.gm.combat!.order.some(f => f.id === "moll"), now.gm.combat!.fled, now.gm.absent.includes("moll")], [false, ["moll"], true]);

  const picked = await fight(closeAndHit);
  const after = await picked.line("I grab Cob by the collar.");
  assert.ok(after.lines.some(l => l.kind === "system" && l.text === "Running from it: the girl in the shawl."));
  assert.deepEqual([after.gm.combat!.fled, after.gm.absent.includes("moll")], [["moll"], true]);
});

test("who comes when a fight breaks out (the scene's reinforcements): the granary porters and Old Wat at the top of the third round, at the gate, each picked a side or sent running before its first turn", async () => {
  const { line, asked } = await fight(request => {
    const c = request.combat;
    if (c.over) return { kind: "end_combat", outcome: c.over.outcome, narration: "Done." };
    return { kind: "end_turn", narration: "Circles." };
  }, { sides: { moll: "flee", porters: "against_player", wat: "flee" } });
  let now = await line("I grab Cob by the collar.");
  for (let i = 0; i < 6 && !now.lines.some(l => l.text.startsWith("Arriving: ")); i++) now = await line("I wait.");
  const arriving = now.lines.find(l => l.text.startsWith("Arriving: "))!;
  assert.ok(arriving, "they came");
  const rounds = now.lines.filter(l => /^Round \d+\.$/.test(l.text)).map(l => l.text);
  assert.equal(rounds.at(-1), "Round 3.", "after two rounds of fighting");
  assert.match(arriving.text, /^Arriving: .*porters.*, .*\.$/);
  const pick = asked.find(r => r.combat.pending?.some(p => p.id === "porters"))!;
  assert.deepEqual(pick.combat.pending!.map(p => p.id), ["porters", "wat"]);
  assert.match(pick.combat.pending![0]!.arriving!, /loading dock/, "why they came, for the GM");
  assert.match(pick.combat.pending![0]!.about, /sack aprons/, "and their look");
  now = await line("I wait.");
  const combat = now.gm.combat!;
  assert.equal(combat.order.find(f => f.id === "porters")?.side, "foes");
  assert.deepEqual(combat.arrived, ["porters", "wat"]);
  assert.ok(combat.fled!.includes("wat") && now.gm.absent.includes("wat"), "Wat ran");
  assert.ok(now.lines.some(l => l.kind === "system" && /Joining the fight: .*porters.* \(against you\)\. Running from it: .*\./.test(l.text)));
  const later = await line("I wait.");
  assert.equal(later.lines.filter(l => l.text.startsWith("Arriving: ")).length, 1, "they come once");
});

/** The clerk with a brawl: an event with a fight, Cob against the player, the co-GM's to move into from the start. */
const WITH_A_BRAWL: PackOptions = {
  edit: {
    "hanged-clerk": (doc: SceneDocument) => ({
      ...doc,
      nodes: [...doc.nodes, { id: "brawl", type: "story", position: { x: 0, y: 0 }, data: { kind: "beat", title: "A brawl in the yard", description: "Cob fights.", fight: { foes: ["cob"] }, lore: [] } }],
      edges: [...doc.edges, { id: "go-for-cob", source: "start", target: "brawl", type: "smoothstep", label: "Go for Cob", data: { condition: "The player goes for Cob.", phase: "outcome", skill: "", dc: 12 } }],
    }),
  },
};

test("the co-GM's move into an event with a fight the reply didn't start starts it after the settle, with its line-up; over on the same turn, the settle after it is the turn's second (settle-2)", async () => {
  const { host, wren, scene, script } = await openedGame(7, "fighter", { asIs: true, ...WITH_A_BRAWL });
  const asked: CombatRequest[] = [];
  for (let i = 0; i < 20; i++) script.then("combat", (request: unknown) => {
    const r = request as CombatRequest;
    asked.push(r);
    return answer(r.combat.pending?.length ? picks(r, { kell: "with_player" }) : { kind: "end_combat", outcome: "yielded", narration: "Cob throws down the boathook." });
  });
  script.then("reply", { entries: [{ speaker: "gm", kind: "narration", text: "You go for Cob." }], gm: {}, firstTextMs: 3, usage } satisfies ReplyResponse);
  const settles: string[] = [];
  const settled = (moves: SettleResponse["coGm"]) => (request: unknown) => { settles.push((request as SettleRequest).key); return { ops: [], coGm: moves, usage } satisfies SettleResponse; };
  script.then("settle", settled({ roles: {}, moves: [{ route: "go-for-cob", outcome: "none", why: "The player went for Cob." }], log: [] }));
  script.then("settle", settled({ roles: {}, moves: [], log: [] }));
  assert.equal(host.as(wren).say({ text: "I go for Cob." }), undefined);
  await host.drain();
  const now = sceneNow(host, scene.id);
  assert.equal(now.gm.beat, "brawl", "the scene is at the brawl");
  assert.ok(now.lines.some(l => l.kind === "system" && l.text.startsWith("Combat! In initiative order: ")), "the fight broke out after the settle");
  assert.equal(asked[0]!.combat.state.why, "A brawl in the yard");
  assert.deepEqual(asked[0]!.combat.pending?.map(p => p.id).sort(), ["kell", "moll"], "the brawl's line-up has Cob; the rest pick");
  assert.ok(now.lines.some(l => l.kind === "system" && l.text === "The fight is over (they gave up)."));
  assert.equal(now.gm.combat, undefined);
  assert.deepEqual(settles.map(k => turnKeyParts(k)!.step + (turnKeyParts(k)!.ask ? `-${turnKeyParts(k)!.ask}` : "")), ["settle", "settle-2"], "the turn's second settle has a key of its own");
  assert.deepEqual(now.turns.map(t => t.phase), ["done", "done"]);
});

test("a fight that breaks out in the reply while one of the prep's is on offer is that one: the scene goes to it by its route, and its line-up fights", async () => {
  const { line, asked } = await fight(closeAndHit, { initiative: { foes: [], allies: [], flee: ["moll"], why: "a brawl" }, pack: WITH_A_BRAWL });
  const now = await line("I go for Cob.");
  assert.equal(now.gm.beat, "brawl");
  assert.equal(now.gm.path.at(-1)!.via, "go-for-cob");
  assert.equal(now.gm.combat!.order.find(f => f.id === "cob")?.side, "foes", "the brawl's foe, though the reply named none");
  assert.ok(asked.every(r => !r.combat.pending?.some(p => p.id === "cob")));
});

test("the player's turn: their move in the yard, then their blow rolled by the rules, round after round until Cob's down; the fight's end goes on to the settle", async () => {
  const { script, line, asked } = await fight(closeAndHit);
  let now = await line("I grab Cob by the collar.");
  for (let i = 0; i < 10 && now.gm.combat; i++) now = await line("I hit him.");
  assert.equal(now.gm.combat, undefined, "the fight is over");
  const mine = asked.filter(r => r.combat.whose === "player" && r.combat.done.length);
  const moved = mine.find(r => r.combat.done[0]!.act.action === "move")!.combat.done[0]!;
  assert.match(moved.result, /^you moved \d+ ft towards Cob: now (beside them|\d+ ft away)\.$/);
  const hit = mine.find(r => r.combat.done.length === 2)!.combat.done[1]!;
  assert.equal(hit.refused, undefined, "beside him, the blow is in reach");
  assert.match(hit.lines[0]!, /your attack on Cob: \d+/);
  assert.ok(now.lines.some(l => l.kind === "roll" && /your attack on Cob/.test(l.text)), "the dice lines in the transcript");
  assert.ok(now.lines.some(l => l.kind === "system" && l.text === "The fight is over (you won)."));
  const ended = asked.at(-1)!;
  assert.equal(ended.combat.over?.outcome, "won");
  const settle = script.to("settle").at(-1)!.body as SettleRequest;
  assert.match(settle.reply, /^The fight is over: you won\. Cob is down in the dust\.$/);
  const keys = asked.map(r => keyParts(r.key)!);
  assert.ok(keys.every(k => k.step === "combat"));
  assert.equal(new Set(asked.map(r => r.key)).size, asked.length, "every step of the fight has a key of its own");
});

test("a blow from out of reach is refused before anything's rolled, and the GM is told why", async () => {
  const { line, asked } = await fight(request => {
    const c = request.combat;
    if (c.over) return { kind: "end_combat", outcome: c.over.outcome, narration: "Done." };
    if (c.whose !== "player") return c.done.length ? { kind: "end_turn", narration: "Waits." } : { kind: "act", act: { action: "move", target: "player", away: true, narration: "Backs off." } };
    if (c.done.length === 0) return { kind: "act", act: { action: "attack", target: "cob", narration: "You swing at the air." } };
    return { kind: "end_turn", narration: "Nothing." };
  });
  await line("I grab Cob by the collar.");
  await line("I hit him.");
  const mine = asked.find(r => r.combat.whose === "player" && r.combat.done.length === 1)!;
  const me = mine.combat.fighters.find(f => f.id === "player")!;
  const done = mine.combat.done[0]!;
  assert.ok((me.feet.cob ?? 0) > 7, "Cob backed off out of reach");
  assert.equal(done.refused, true);
  assert.match(done.result, /^Out of reach: Cob is \d+ ft away, and a melee blow reaches 5 ft\. move_towards first/);
  assert.deepEqual(done.lines, []);
});

test("a fight only some of a check's outcomes start (toll1-1018: a bluff failed badly, and its outcome called for initiative with nothing after it): it starts on those, and not on the others", async () => {
  for (const starts of [true, false]) {
    const { host, wren, scene, script } = await openedGame(7, "fighter", { asIs: true });
    const band = bandOf(nextCheck(host, scene.controllerId, "deception", 15));
    const outcomes = Object.fromEntries(BANDS.map(b => [b, { speaker: "gm", kind: "narration", text: `Outcome: ${b}.` }])) as Record<Band, Reply>;
    const on = starts ? [band] : BANDS.filter(b => b !== band);
    script.then("reply", { entries: [{ speaker: "gm", kind: "narration", text: "Cob squints at your story." }], gm: {}, firstTextMs: 3, check: { skill: "deception", dc: 15, outcomes }, initiative: { foes: ["cob"], allies: ["kell"], flee: ["moll"], why: "a bluff called", on }, usage } satisfies ReplyResponse);
    assert.equal(host.as(wren).say({ text: "Found it in the gutter, honest." }), undefined);
    await host.drain();
    const now = sceneNow(host, scene.id);
    assert.equal(now.lines.some(l => l.kind === "system" && l.text.startsWith("Combat!")), starts, `the check came up ${band}: a fight ${starts ? "starts" : "doesn't"}`);
    assert.equal(!!now.gm.combat, starts);
  }
});

test("a reply that calls for initiative in its words with no roll_for_initiative (toll2-1018) starts the fight anyway: nobody's side is known, so the GM picks everyone's before the first turn", async () => {
  const { host, wren, scene, script } = await openedGame(7, "fighter", { asIs: true });
  const asked: CombatRequest[] = [];
  for (let i = 0; i < 20; i++) script.then("combat", (request: unknown) => { const r = request as CombatRequest; asked.push(r); return answer(r.combat.pending?.length ? picks(r, { cob: "against_player", moll: "against_player", kell: "with_player" }) : { kind: "end_turn", narration: "Circles." }); });
  script.then("reply", { entries: [{ speaker: "gm", kind: "narration", text: "Cob spits. Roll for initiative!" }], gm: {}, firstTextMs: 3, usage } satisfies ReplyResponse);
  assert.equal(host.as(wren).say({ text: "You little thief." }), undefined);
  await host.drain();
  assert.deepEqual(asked[0]!.combat.pending!.map(p => p.id).sort(), ["cob", "kell", "moll"]);
  const combat = sceneNow(host, scene.id).gm.combat!;
  assert.deepEqual(Object.fromEntries(combat.order.map(f => [f.id, f.side])), { player: "party", kell: "party", cob: "foes", moll: "foes" });
});

test("a fight that breaks out on the player's own blow (toll1-1018: a rapier run in at arm's length left the world's player 25 feet off) starts with them beside its target", async () => {
  const { line, asked, script } = await fight(closeAndHit);
  script.then("act", { mechanic: { kind: "attack", target: "cob" }, usage });
  await line("I punch Cob in the ear.");
  const first = asked[0]!;
  assert.ok(first.combat.fighters.find(f => f.id === "player")!.feet.cob! <= 7, "beside Cob as the fight starts");
});
