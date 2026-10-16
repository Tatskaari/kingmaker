import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesOf, type Onward } from "./graph.ts";
import type { Exit } from "./types.ts";

/** An exit that goes on to `next` (or nowhere). */
const exit = (id: string, next?: string): Exit => ({ id, kind: "progress", title: id, outcome: "", closing: "", ...(next ? { next } : {}) });

/** The prototype's arc as candidatesOf reads it (scenes/*.ts at 44c6d4a: their exits' ways on, interludes, what each takes for granted). */
const ARC: Record<string, Onward> = {
  "hanged-clerk": { id: "hanged-clerk", exits: [exit("open-case", "caerwyn-afternoon"), exit("own-ending", "caerwyn-afternoon")] },
  "caerwyn-afternoon": { id: "caerwyn-afternoon", interlude: true, exits: [exit("onward", "drowned-rat"), exit("own-ending")] },
  "drowned-rat": { id: "drowned-rat", assumes: ["Big Hobb Mallory is still at large."], overtaken: "wharf-night", exits: [exit("hobb-talks", "wharf-night")] },
  "wharf-night": { id: "wharf-night", interlude: true, assumes: ["The barge hasn't sailed."], overtaken: "heron-warehouse", exits: [exit("onward", "heron-warehouse")] },
  "heron-warehouse": { id: "heron-warehouse", assumes: ["The barge hasn't sailed.", "Sallow isn't in a cell."], overtaken: "kings-morning", exits: [exit("caught-in-the-act", "kings-morning"), exit("fight", "kings-morning")] },
  "kings-morning": { id: "kings-morning", exits: [exit("justice"), exit("after-the-assembly")] },
};
const sceneOf = (key: string) => ARC[key];

test("after the granary the story could go to the Rat, or past it to the Heron or the King, interludes skipped (chainScene's candidates)", () => {
  assert.deepEqual(candidatesOf(ARC["hanged-clerk"]!, "open-case", sceneOf), ["drowned-rat", "heron-warehouse", "kings-morning"]);
  assert.deepEqual(candidatesOf(ARC["hanged-clerk"]!, "own-ending", sceneOf), ["drowned-rat", "heron-warehouse", "kings-morning"]);
  assert.deepEqual(candidatesOf(ARC["drowned-rat"]!, "hobb-talks", sceneOf), ["heron-warehouse", "kings-morning"]);
  assert.deepEqual(candidatesOf(ARC["heron-warehouse"]!, "caught-in-the-act", sceneOf), ["kings-morning"]);
});

test("an exit that goes nowhere is the story's end; an unknown exit or scene ends the list", () => {
  assert.deepEqual(candidatesOf(ARC["kings-morning"]!, "justice", sceneOf), []);
  assert.deepEqual(candidatesOf(ARC["hanged-clerk"]!, "no-such-exit", sceneOf), []);
  assert.deepEqual(candidatesOf({ exits: [exit("on", "nowhere")] }, "on", sceneOf), []);
});

test("six at most, and none twice, even when the scenes go round", () => {
  const ring: Record<string, Onward> = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`s${i}`, { id: `s${i}`, assumes: ["it holds"], overtaken: `s${(i + 1) % 9}`, exits: [] }]));
  assert.deepEqual(candidatesOf({ exits: [exit("on", "s0")] }, "on", key => ring[key]), ["s0", "s1", "s2", "s3", "s4", "s5"]);
  const loop: Record<string, Onward> = { a: { id: "a", assumes: ["x"], overtaken: "b", exits: [] }, b: { id: "b", interlude: true, exits: [exit("on", "a")] } };
  assert.deepEqual(candidatesOf({ exits: [exit("on", "a")] }, "on", key => loop[key]), ["a"]);
});
