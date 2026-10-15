import { test } from "node:test";
import assert from "node:assert/strict";
import { OVERLAY_OSC } from "./door-art.ts";
import { attachOverlay } from "./opentui.ts";
import { overlayWanted } from "./overlay.ts";

/**
 * The overlay's wiring to a renderer (src/game/look/opentui.ts attachOverlay): nothing at all in a
 * terminal, and in a browser an OSC before a frame only when where the doors are has changed.
 */

type PostProcess = (buffer: unknown, deltaTime: number) => void;

/** A renderer as attachOverlay sees one (src/web/tui's shape: a buffer of arrays, a raw write). */
function fakeRenderer() {
  const steps: PostProcess[] = [];
  const written: string[] = [];
  const renderer = {
    width: 40, height: 12,
    addPostProcessFn: (fn: PostProcess) => { steps.push(fn); },
    writeRaw: (data: string) => { written.push(data); return true; },
  };
  const buffer = { width: 40, height: 12, chars: new Array<string>(480).fill(" "), fg: new Uint32Array(480), bg: new Uint32Array(480) };
  const frame = () => { for (const step of steps) step(buffer, 16); };
  return { renderer: renderer as unknown as Parameters<typeof attachOverlay>[0], steps, written, frame };
}

test("in a terminal the overlay isn't attached: no step in the frame, nothing written, no view asked where its doors are", () => {
  const was = process.env.KM_IN_BROWSER;
  delete process.env.KM_IN_BROWSER;
  try {
    const fake = fakeRenderer();
    assert.equal(attachOverlay(fake.renderer), false);
    assert.equal(fake.steps.length, 0);
    assert.equal(overlayWanted(), false);
  } finally {
    if (was !== undefined) process.env.KM_IN_BROWSER = was;
  }
});

test("KM_DOORS=off keeps the doors out of a browser too", () => {
  process.env.KM_IN_BROWSER = "1";
  process.env.KM_DOORS = "off";
  try {
    const fake = fakeRenderer();
    assert.equal(attachOverlay(fake.renderer), false);
    assert.equal(fake.steps.length, 0);
  } finally {
    delete process.env.KM_DOORS;
    delete process.env.KM_IN_BROWSER;
  }
});

test("in a browser, where the doors are goes out before a frame, once, and again only when it changes", () => {
  process.env.KM_IN_BROWSER = "1";
  try {
    const fake = fakeRenderer();
    assert.equal(attachOverlay(fake.renderer), true);
    assert.equal(overlayWanted(), true);
    fake.frame();
    assert.equal(fake.written.length, 1);
    const sent = fake.written[0]!;
    assert.ok(sent.startsWith(`\x1b]${OVERLAY_OSC};`) && sent.endsWith("\x07"));
    assert.deepEqual(JSON.parse(sent.slice(`\x1b]${OVERLAY_OSC};`.length, -1)), { cols: 40, rows: 12, doors: [] });
    fake.frame();
    fake.frame();
    assert.equal(fake.written.length, 1, "nothing new: nothing sent");
  } finally {
    delete process.env.KM_IN_BROWSER;
  }
});
