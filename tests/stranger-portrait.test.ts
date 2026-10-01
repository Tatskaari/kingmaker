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
import { AlertLog } from "../apps/web/src/alerts.js";

test("every classified expression has a portrait and fear displays amusement", () => {
  for (const expression of Object.keys(portraitExpressions) as PortraitExpression[]) {
    const portrait = strangerPortrait(expression);
    assert.ok(existsSync(new URL(`../apps/web/public${portrait.src}`, import.meta.url)));
    assert.match(portrait.alt, new RegExp(expression === "scared" ? "amused" : expression));
  }
  assert.deepEqual(strangerPortrait("scared"), strangerPortrait("amused"));
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
    ] });
    return { choice: "amused", probabilities: { amused: 1 } };
  });
  const before = runtime.snapshot();
  assert.equal(await runtime.classifyStrangerExpression(), "amused");
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
    URL, AlertLog, strangerPortrait, installDicePreview() {}, devOpenRouterApiKey: "", window: {},
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
  const refresh = (text: string) => runInContext(`refreshStrangerPortrait([{role:'user',text:'Hello'}, {role:'assistant',text:${JSON.stringify(text)}}]);`, context);
  const reply = async (index: number, expression: string) => {
    receive({ data: { id: requests[index].id, ok: true, value: { expression } } });
    await new Promise(resolve => setImmediate(resolve));
  };
  refresh("First reply"); refresh("First reply");
  assert.equal(requests.length, 1, "Re-renders must not duplicate classification");
  refresh("Second reply");
  await reply(1, "serious");
  await reply(0, "angry");
  assert.deepEqual(image, strangerPortrait("serious"));
  refresh("Third reply");
  runInContext("gameViewGeneration++", context);
  await reply(2, "angry");
  assert.deepEqual(image, strangerPortrait("serious"));
  runInContext("strangerPortraitState = {generation: gameViewGeneration, key:'', expression:'amused'}", context);
  refresh("A threat"); await reply(3, "scared");
  assert.deepEqual(image, strangerPortrait("amused"));
  refresh("Another reply");
  receive({ data: { id: requests[4].id, ok: false, error: "Offline" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(image, strangerPortrait("amused"));
});
