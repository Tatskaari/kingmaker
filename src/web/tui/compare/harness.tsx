import { act } from "react";
import { writeFileSync } from "node:fs";
import { testRender } from "@opentui/react/test-utils";
import { synthetic, type Scenario } from "./scenarios.tsx";
import { appScenarios } from "./app-scenarios.tsx";

/**
 * Draws the comparison's screens with whichever renderer "@opentui/react/test-utils" is: OpenTUI's
 * own when run as is (tsx), this directory's when bundled with the aliases (run.ts does both).
 * Time stands still and the dice are seeded, so both draw the same moment. Writes what was drawn,
 * the text and each cell's colours, as JSON to the file it's given.
 *
 *   node --import tsx src/web/tui/compare/harness.tsx out.json      (KM_COMPARE_ONLY=name: just that one)
 */

const out = process.argv[2] ?? "compare.json";
const only = process.env.KM_COMPARE_ONLY;

const FIXED_NOW = 1_000_000;
performance.now = () => FIXED_NOW;
const realDateNow = Date.now;
const START = realDateNow();
Date.now = () => START;
let seed = 12345;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const hex = (c: { toInts(): number[] }) => c.toInts().map(v => v.toString(16).padStart(2, "0")).join("");

interface Captured { name: string; width: number; height: number; frame: string; styles: string[][]; error?: string }

async function run(s: Scenario): Promise<Captured> {
  const node = await s.node();
  const setup = await testRender(node, { width: s.width, height: s.height });
  try {
    await setup.renderOnce();
    for (const step of s.steps ?? []) {
      await act(async () => {
        step.run?.();
        if (step.type) await setup.mockInput.typeText(step.type);
        for (const key of step.keys ?? []) setup.mockInput.pressKey(key);
        if (step.click) await setup.mockMouse.click(step.click[0], step.click[1], (step.click[2] ?? 0) as 0);
        if (step.move) await setup.mockMouse.moveTo(step.move[0], step.move[1]);
        if (step.scroll) await setup.mockMouse.scroll(step.scroll[0], step.scroll[1], step.scroll[2]);
        if (step.wait) await new Promise(r => setTimeout(r, step.wait));
      });
      await setup.renderOnce();
    }
    await setup.renderOnce();
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    const spans = (setup as unknown as { captureSpans(): { lines: Array<{ spans: Array<{ fg: { toInts(): number[] }; bg: { toInts(): number[] }; attributes: number; width: number }> }> } }).captureSpans();
    const styles = spans.lines.map(line => line.spans.flatMap(span => Array.from({ length: span.width }, () => `${hex(span.fg)}/${hex(span.bg)}/${span.attributes & 0xff}`)));
    return { name: s.name, width: s.width, height: s.height, frame, styles };
  } finally {
    await setup.dispose();
  }
}

const scenarios: Scenario[] = [...synthetic, ...appScenarios].filter(s => !only || s.name.includes(only));
const results: Captured[] = [];
for (const s of scenarios) {
  try {
    results.push(await run(s));
  } catch (error) {
    results.push({ name: s.name, width: s.width, height: s.height, frame: "", styles: [], error: String((error as Error).stack ?? error) });
  }
}
writeFileSync(out, JSON.stringify(results, null, 1));
process.exit(0);
