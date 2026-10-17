import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { LoopConfig } from "./paths.ts";
import { gameOf, loadRound, newRound, parseArms, parseScenes, personas, planGames, type RoundContext, type Shuffle } from "./round.ts";

/** No shuffling: the order asked for, so a plan can be read off. */
const asIs: Shuffle = xs => [...xs];
const config = (): LoopConfig => ({ rounds: mkdtempSync(join(tmpdir(), "km-loop-")), command: "npm run -s loop --" });
const context = (shuffle: Shuffle = asIs): RoundContext => ({ personas: personas(), scenes: ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning"], build: { commit: "abc1234", dirty: false }, now: "2026-10-17T20:00:00.000Z", shuffle });

test("a scene mix: each scene and its number of games; a scene alone gets every persona on every arm", () => {
  assert.deepEqual(parseScenes("hanged-clerk:3, drowned-rat:2,heron-warehouse"), [{ scene: "hanged-clerk", games: 3 }, { scene: "drowned-rat", games: 2 }, { scene: "heron-warehouse" }]);
  assert.throws(() => parseScenes("hanged-clerk:0"), /isn't a scene/);
  assert.throws(() => parseScenes("Hanged Clerk"), /isn't a scene/);
  assert.deepEqual(parseArms(undefined, "runs/loop-stack"), [{ name: "baseline", stack: "runs/loop-stack" }]);
  assert.deepEqual(parseArms("baseline=runs/loop-stack,candidate=../other/runs/loop-stack", "x"), [{ name: "baseline", stack: "runs/loop-stack" }, { name: "candidate", stack: "../other/runs/loop-stack" }]);
  assert.throws(() => parseArms("baseline", "x"), /isn't an arm/);
});

test("the plan: scene by scene, the arms take turns and each persona plays every arm before the next, the deck carrying on across scenes", () => {
  const { arms, games } = planGames({
    scenes: [{ scene: "hanged-clerk", games: 4 }, { scene: "drowned-rat", games: 2 }],
    personas: ["thief", "wizard", "tangent"], arms: [{ name: "baseline", stack: "a" }, { name: "candidate", stack: "b" }],
  }, asIs);
  assert.deepEqual(arms, { k1: { name: "baseline", stack: "a" }, k2: { name: "candidate", stack: "b" } });
  assert.deepEqual(Object.entries(games).map(([id, g]) => `${id} ${g.scene} ${g.arm} ${g.persona}`), [
    "g01 hanged-clerk k1 thief", "g02 hanged-clerk k2 thief", "g03 hanged-clerk k1 wizard", "g04 hanged-clerk k2 wizard",
    "g05 drowned-rat k1 tangent", "g06 drowned-rat k2 tangent",
  ]);

  // A scene with no number: every persona on every arm, `repeat` times, as the prototype's rounds were.
  const every = planGames({ scenes: [{ scene: "hanged-clerk" }], personas: ["thief", "wizard"], arms: [{ name: "baseline", stack: "a" }], repeat: 2 }, asIs);
  assert.deepEqual(Object.values(every.games).map(g => g.persona), ["thief", "wizard", "thief", "wizard"]);
});

test("the names are neutral: the arms and the games are shuffled before they're named", () => {
  const reversed: Shuffle = xs => [...xs].reverse();
  const { arms, games } = planGames({ scenes: [{ scene: "hanged-clerk", games: 2 }], personas: ["thief"], arms: [{ name: "baseline", stack: "a" }, { name: "candidate", stack: "b" }] }, reversed);
  assert.equal(arms.k1!.name, "candidate");
  assert.deepEqual(Object.entries(games).map(([id, g]) => `${id} ${g.arm}`), ["g01 k2", "g02 k1"]);
});

test("a new round: its folder and round.json, its games each with a scene; a round can't be made twice, nor ask for what isn't there", () => {
  const c = config();
  const round = newRound(c, "r1", { scenes: parseScenes("hanged-clerk:3,drowned-rat:2"), personas: ["thief", "absurd"], arms: [{ name: "baseline", stack: "runs/loop-stack" }], maxTurns: 3 }, context());
  assert.deepEqual(round.scenes, [{ scene: "hanged-clerk", games: 3 }, { scene: "drowned-rat", games: 2 }]);
  assert.equal(round.maxTurns, 3);
  assert.equal(Object.keys(round.games).length, 5);
  for (const folder of ["games", "notes", "reviews", "play"]) assert.ok(existsSync(join(c.rounds, "r1", folder)), folder);
  assert.deepEqual(JSON.parse(readFileSync(join(c.rounds, "r1", "round.json"), "utf8")), round);
  assert.deepEqual(loadRound(c, "r1"), round);

  const g = gameOf(round, "g04");
  assert.equal(g.scene, "drowned-rat");
  assert.equal(g.armed.stack, "runs/loop-stack");
  assert.equal(g.who.id, g.persona);
  assert.throws(() => gameOf(round, "g09"), /no game g09 in round r1/);

  assert.throws(() => newRound(c, "r1", { scenes: [{ scene: "hanged-clerk" }], personas: ["thief"], arms: [{ name: "baseline", stack: "s" }] }, context()), /there already/);
  assert.throws(() => newRound(c, "r2", { scenes: [{ scene: "hanged-clerk" }], personas: ["bard"], arms: [{ name: "baseline", stack: "s" }] }, context()), /No persona bard/);
  assert.throws(() => newRound(c, "r2", { scenes: [{ scene: "caerwyn-afternoon" }], personas: ["thief"], arms: [{ name: "baseline", stack: "s" }] }, context()), /no scene to play called caerwyn-afternoon/);
  assert.throws(() => newRound(c, "r2", { scenes: parseScenes("hanged-clerk:1,hanged-clerk:2"), personas: ["thief"], arms: [{ name: "baseline", stack: "s" }] }, context()), /Name each scene once/);
  assert.throws(() => newRound(c, "../r2", { scenes: [{ scene: "hanged-clerk" }], personas: ["thief"], arms: [{ name: "baseline", stack: "s" }] }, context()), /letters, digits/);
  assert.throws(() => loadRound(c, "r9"), /There's no round r9/);
});

test("every persona has a sentence to make a character from, a way to play, and a ready-made build of the campaign's to fall back on", () => {
  const builds = Object.keys(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "builds.json"), "utf8")) as Record<string, unknown>);
  for (const p of personas()) {
    assert.match(p.as, /^[^:]+: .+/, p.id);
    assert.ok(p.style.length > 40, p.id);
    assert.ok(builds.includes(p.build), `${p.id}: ${p.build}`);
  }
});
