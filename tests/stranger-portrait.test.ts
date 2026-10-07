import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { AlertLog } from "../apps/web/src/alerts.js";
import { coalescedRefresh } from "../apps/web/src/debug-live.js";
import { strangerPortrait } from "../apps/web/src/stranger-portrait.js";
import { portraitExpressions, type PortraitExpression } from "../packages/providers/src/conversation-expression.js";

test("every classified expression has a portrait and fear displays amusement", () => {
  for (const expression of Object.keys(portraitExpressions) as PortraitExpression[]) {
    const portrait = strangerPortrait(expression);
    const publicRoot = new URL("../apps/web/public/", import.meta.url);
    assert.ok(existsSync(new URL(portrait.src, publicRoot)));
    assert.match(portrait.alt, new RegExp(expression === "scared" ? "amused" : expression));
  }
  assert.deepEqual(strangerPortrait("scared"), strangerPortrait("amused"));
});

test("portrait URLs stay inside the deployed site at root and GitHub Pages paths", () => {
  for (const sitePath of ["/", "/kingmaker/"]) {
    for (const expression of Object.keys(portraitExpressions) as PortraitExpression[]) {
      const portrait = strangerPortrait(expression);
      for (const documentPath of [sitePath, `${sitePath}index.html`]) {
        const url = new URL(portrait.src, `https://example.github.io${documentPath}`);
        assert.equal(url.pathname, `${sitePath}assets/laughing-stranger/${portrait.expression}.png`);
      }
    }
  }
});

test("portrait updates ignore old replies and replaced games without re-rendering the composer", async () => {
  const requests: any[] = [], image = { src: "", alt: "" };
  let receive!: (event: any) => void;
  const context = createContext({
    URL, AlertLog, coalescedRefresh, strangerPortrait, installDicePreview() {}, devOpenRouterApiKey: "", window: { addEventListener() {} },
    document: { querySelector: (selector: string) => selector === "[data-stranger-portrait]" ? image : null, addEventListener() {} },
    Worker: class {
      addEventListener(_type: string, callback: typeof receive) { receive = callback; }
      postMessage(message: any) { requests.push(message); }
    },
  });
  const source = readFileSync(new URL("../apps/web/src/app.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replaceAll("import.meta.url", JSON.stringify(import.meta.url))
    .replace(/if \(apiKey\) run\(\(\) => configure\(apiKey\)\);\s*else render\(\);/, "");
  runInContext(`${source}\nstate = {phase:'player_creation'}; strangerPortraitState.generation = 0; render = () => { throw Error('Do not clear the composer'); };`, context);
  const assertPortrait = (expression: PortraitExpression) => {
    const { src, alt } = strangerPortrait(expression);
    assert.deepEqual(image, { src, alt });
  };
  const history = () => JSON.parse(runInContext("JSON.stringify(strangerPortraitState.history)", context));
  const refresh = (text: string) => runInContext(`refreshStrangerPortrait([{role:'user',text:'Hello'}, {role:'assistant',text:${JSON.stringify(text)}}]);`, context);
  const reply = async (index: number, expression: string) => {
    receive({ data: { id: requests[index].id, ok: true, value: { expression } } });
    await new Promise(resolve => setImmediate(resolve));
  };
  refresh("First reply"); refresh("First reply");
  assert.equal(requests.length, 1, "Re-renders must not duplicate classification");
  assert.deepEqual(Array.from(requests[0].payload.recentPortraits), ["amused"]);
  refresh("Second reply");
  await reply(1, "serious");
  await reply(0, "angry");
  assertPortrait("serious");
  assert.deepEqual(history(), ["amused", "serious"], "Ignore stale results in displayed history");
  refresh("Third reply");
  runInContext("gameViewGeneration++", context);
  await reply(2, "angry");
  assertPortrait("serious");
  runInContext("strangerPortraitState = {generation: gameViewGeneration, key:'', expression:'amused', history:['amused']}", context);
  refresh("A threat"); await reply(3, "scared");
  assertPortrait("amused");
  assert.deepEqual(history(), ["amused", "amused"], "Remember the displayed fallback, not scared");
  refresh("Another reply");
  receive({ data: { id: requests[4].id, ok: false, error: "Offline" } });
  await new Promise(resolve => setImmediate(resolve));
  assertPortrait("amused");
  assert.deepEqual(history(), ["amused", "amused"], "Failures do not extend displayed history");
  for (let i = 0; i < 6; i++) { refresh(`Repeated reply ${i}`); await reply(5 + i, "amused"); }
  assert.deepEqual(history(), Array(5).fill("amused"));
  assert.deepEqual(Array.from(requests.at(-1).payload.recentPortraits), Array(5).fill("amused"));
});
