import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { fromJsonString } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../packages/contracts/src/index.js";
import { JevClient } from "../packages/providers/src/jev.js";
import { OpenRouterClient } from "../packages/providers/src/openrouter.js";
import { portraitExpressions, type PortraitExpression } from "../packages/providers/src/conversation-expression.js";
import { BrowserGameRuntime } from "../apps/web/src/runtime.js";
import { strangerPortrait } from "../apps/web/src/stranger-portrait.js";
import { coalescedRefresh } from "../apps/web/src/debug-live.js";
import { AlertLog } from "../apps/web/src/alerts.js";

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

test("the classifier sees Stranger speech and the player, excluding setup and tools", async t => {
  const scenario = fromJsonString(ScenarioSchema, readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8"));
  const runtime = new BrowserGameRuntime(scenario, "test");
  assert.equal(await runtime.classifyStrangerExpression(), undefined);
  const saved = runtime.snapshot();
  saved.gameMasterHistory = [
    { role: "user", content: "[Crossroads character creation] Hidden setup" },
    { role: "assistant", content: null, tool_calls: [{ id: "tool", type: "function", function: { name: "offer_replies", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "tool", content: "Internal result" },
    { role: "assistant", content: "What do you want?" },
  ];
  runtime.restore(saved);
  t.mock.method(OpenRouterClient.prototype, "complete", async () => ({ role: "assistant", content: "He laughs. A splendid joke!" }));
  await runtime.talkToGameMaster("I want to make them laugh.");
  t.mock.method(JevClient.prototype, "choose", async (input: any) => {
    assert.deepEqual(input, { characterId: "gm", history: [
      { speakerId: "gm", text: "What do you want?" },
      { speakerId: "player", text: "I want to make them laugh." },
      { speakerId: "gm", text: "He laughs. A splendid joke!" },
    ], recentPortraits: ["serious", "neutral", "amused", "amused", "amused"] });
    return { choice: "amused", probabilities: { amused: 1 } };
  });
  const before = runtime.snapshot();
  assert.equal(await runtime.classifyStrangerExpression(["angry", "serious", "neutral", "amused", "amused", "amused"]), "amused");
  await assert.rejects(runtime.classifyStrangerExpression(["invented"]), /Invalid portrait history/);
  assert.deepEqual(runtime.snapshot(), before);
  assert.equal(runtime.recentTranscripts()[0]!.kind, "conversation_expression");
  t.mock.method(JevClient.prototype, "choose", async () => { throw new Error("Offline"); });
  assert.equal(await runtime.classifyStrangerExpression(), undefined);
  assert.equal(runtime.recentTranscripts()[0]!.status, "error");
});

test("portrait updates ignore old replies and replaced games without re-rendering the composer", async () => {
  const requests: any[] = [], image = { src: "", alt: "" };
  let receive!: (event: any) => void;
  const context = createContext({
    URL, AlertLog, coalescedRefresh, strangerPortrait, installDicePreview() {}, devOpenRouterApiKey: "", window: {},
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
